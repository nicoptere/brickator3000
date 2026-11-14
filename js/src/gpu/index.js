// GPU compute for BrickPack: the data-parallel parts of a build, on WebGPU (compute shaders) or, where it is missing, WebGL2
// (fragment shaders into float render targets). Everything else stays on the CPU, and every kernel has a CPU twin, so a machine
// without either API (or a kernel that fails) still builds, just slower.
//
//   bvhQuery   per query point, a walk of the triangle tree: the generalised winding number (Barnes-Hut dipoles far, exact solid
//              angles near; Barill et al. 2018) and / or the squared distance to the mesh within a bound. The target's inside /
//              outside lattice and its near-surface voxels (target.js).
//   deficitSums per (shaped part, anchor), the stencil's missing volume weighted by the field: the candidate gains (pack.js).
//
// The kernels run in float32 (the CPU twins in float64), with compensated sums where it matters: the fields agree to ~1e-6, and a
// packing can differ from the CPU's only where two placements tie to that precision.

import { BVH } from '../geom/bvh.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const isSoftware = (s) => /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(s || '');

/**
 * The first backend that works, in the order asked: prefer 'auto' (WebGPU, then WebGL2; software renderers skipped), 'webgpu',
 * 'webgl2', or 'cpu' (none).
 * Each candidate must pass selfTest against the CPU first (a driver that miscomputes is skipped, not trusted). Resolves to a
 * backend { kind, label, bvhQuery, deficitSums, dispose, selfTest } or null (= compute on the CPU).
 */
export async function createGPU({ prefer = 'auto', log = () => {}, check = true, allowSoftware = prefer !== 'auto' } = {}) {
  const order = prefer === 'cpu' ? [] : prefer === 'webgpu' ? ['webgpu'] : prefer === 'webgl2' ? ['webgl2'] : ['webgpu', 'webgl2'];
  for (const kind of order) {
    let b = null;
    try {
      const t0 = now();
      const mod = kind === 'webgpu' ? await import('./webgpu.js') : await import('./webgl2.js');
      b = await mod.create({ log });
      if (!b) continue;
      // a software rasteriser (SwiftShader, llvmpipe: what browsers fall back to without a usable GPU) is slower than the CPU code
      if (b.software && !allowSoftware) { log(`gpu: ${b.label} is a software renderer, the CPU is faster`); b.dispose(); continue; }
      if (check) {
        b.selfTest = await selfTest(b);
        if (!b.selfTest.ok) { log(`gpu: ${b.label} failed its self-test ${JSON.stringify(b.selfTest.maxErr)}, skipped`); b.dispose(); continue; }
      }
      log(`gpu: ${b.label} (${Math.round(now() - t0)} ms to start)`);
      return b;
    } catch (e) { log(`gpu: ${kind} unavailable (${(e && e.message) || e})`); if (b) try { b.dispose(); } catch { /* gone already */ } }
  }
  return null;
}

/**
 * A BVH (geom/bvh.js, with prepareWinding) flattened for the shaders, in float32:
 *   nodes: 8 vec4 per node = (centre, radius) (dipole N, trace M) (M0..3) (M4..7) (M8, left, right, start) (count, -, -, -)
 *          (lo, -) (hi, -); left = -1 for a leaf, indices as floats (exact below 2^24)
 *   tris:  3 vec4 per triangle, in leaf order (a leaf's triangles are tris[start .. start + count))
 */
export function packBVH(bvh) {
  const { V, F, lo, hi, left, start, count, idx, nn } = bvh, right = bvh._right, w = bvh.w;
  if (!w) throw new Error('packBVH: prepareWinding first');
  if (nn >= 1 << 24 || F.length / 3 >= 1 << 24) throw new Error('packBVH: mesh too large for float indices');
  const nodes = new Float32Array(32 * nn);
  for (let n = 0; n < nn; n++) {
    const o = 32 * n, M = w.Mm, m = 9 * n;
    nodes[o] = w.cx[n]; nodes[o + 1] = w.cy[n]; nodes[o + 2] = w.cz[n]; nodes[o + 3] = w.rad[n];
    nodes[o + 4] = w.nx[n]; nodes[o + 5] = w.ny[n]; nodes[o + 6] = w.nz[n]; nodes[o + 7] = M[m] + M[m + 4] + M[m + 8];
    for (let k = 0; k < 8; k++) nodes[o + 8 + k] = M[m + k];
    nodes[o + 16] = M[m + 8]; nodes[o + 17] = left[n]; nodes[o + 18] = left[n] < 0 ? -1 : right[n]; nodes[o + 19] = start[n];
    nodes[o + 20] = count[n];
    for (let a = 0; a < 3; a++) { nodes[o + 24 + a] = lo[3 * n + a]; nodes[o + 28 + a] = hi[3 * n + a]; }
  }
  const m = F.length / 3, tris = new Float32Array(12 * m);
  for (let k = 0; k < m; k++) {
    const f = idx[k];
    for (let c = 0; c < 3; c++) { const p = 3 * F[3 * f + c]; tris[12 * k + 4 * c] = V[p]; tris[12 * k + 4 * c + 1] = V[p + 1]; tris[12 * k + 4 * c + 2] = V[p + 2]; }
  }
  return { nodes, tris, nn, m };
}

/**
 * The shaped variants' deficits for one field shape, concatenated: entry k = (rel offset, weight); per variant (start, count)
 * (box parts: count 0). rel(v) from pack.js deficitRel.
 */
export function packDeficits(variants, X, Z, deficitRel) {
  const info = new Int32Array(2 * variants.length); let total = 0;
  variants.forEach((v, i) => { const c = v.full ? 0 : v.deficit.idx.length; info[2 * i] = total; info[2 * i + 1] = c; total += c; });
  const rel = new Int32Array(Math.max(1, total)), val = new Float32Array(Math.max(1, total));
  variants.forEach((v, i) => { if (v.full) return; const r = deficitRel(v, X, Z), o = info[2 * i]; rel.set(r, o); val.set(v.deficit.val, o); });
  return { info, rel, val, total, key: `${X},${Z}` };
}

/** query points (n x xyz, float64 or float32) as vec4 rows for the shaders */
export function packPoints(P) {
  const n = P.length / 3, out = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) { out[4 * i] = P[3 * i]; out[4 * i + 1] = P[3 * i + 1]; out[4 * i + 2] = P[3 * i + 2]; }
  return out;
}

/**
 * A quick self-check of a backend against the CPU (a small closed mesh): winding inside / outside, distances, deficit sums.
 * Resolves to { ok, maxErr: { winding, dist, deficit }, ms }.
 */
export async function selfTest(gpu) {
  const t0 = now();
  // an icosphere-ish closed mesh: an octahedron subdivided twice, radius 10, centred at (20, 20, 20)
  let V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let s = 0; s < 2; s++) {
    const mid = new Map(), nf = [];
    const m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { const p = V[a].map((x, i) => (x + V[b][i]) / 2), l = Math.hypot(...p); V.push(p.map((x) => x / l)); mid.set(k, V.length - 1); } return mid.get(k); };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]); }
    F = nf;
  }
  const Vf = new Float64Array(V.flatMap((p) => p.map((x) => 20 + 10 * x))), Ff = new Int32Array(F.flat());
  const bvh = new BVH(Vf, Ff); bvh.prepareWinding();
  const pts = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) pts.push(6 + 5.6 * i, 6 + 5.6 * j, 6 + 5.6 * k);
  const P = new Float64Array(pts), n = P.length / 3;
  const g = await gpu.bvhQuery(packBVH(bvh), packPoints(P), { beta: 2, bound2: 64 });
  let ew = 0, ed = 0;
  for (let q = 0; q < n; q++) {
    ew = Math.max(ew, Math.abs(g.w[q] - bvh.winding(P[3 * q], P[3 * q + 1], P[3 * q + 2], 2)));
    ed = Math.max(ed, Math.abs(Math.sqrt(g.d2[q]) - Math.sqrt(bvh.nearest2(P[3 * q], P[3 * q + 1], P[3 * q + 2], 64))));
  }
  // deficit sums: a random field, two fake variants
  const X = 23, Z = 17, N = X * Z * 9, w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = Math.sin(i * 12.9898) * 0.9;
  const info = new Int32Array([0, 0, 0, 5, 5, 3]), rel = new Int32Array([0, 1, X, X * Z, X * Z + 7, 2, 3, 4]), val = new Float32Array([0.5, 1, 0.25, 0.75, 1, 1, 0.5, 0.125]);
  const vi = new Int32Array([1, 2, 1, 2]), base = new Int32Array([0, 10, 40, 100]);
  const ds = await gpu.deficitSums(w, { info, rel, val, total: 8, key: 'selftest' }, { vi, base, n: 4 });
  let ef = 0;
  for (let p = 0; p < 4; p++) { let s = 0; const o = info[2 * vi[p]], c = info[2 * vi[p] + 1]; for (let k = 0; k < c; k++) s += val[o + k] * w[base[p] + rel[o + k]]; ef = Math.max(ef, Math.abs(s - ds[p])); }
  const ok = ew < 1e-3 && ed < 1e-3 && ef < 1e-4;
  return { ok, maxErr: { winding: ew, dist: ed, deficit: ef }, ms: Math.round(now() - t0) };
}
