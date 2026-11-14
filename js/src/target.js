// BrickPack Target SDF & Sub-Voxel Coverage Field:
//   - Inside/outside from Generalized Winding Number (Barnes-Hut on a 4 LDU lattice + exact trilinear interior)
//   - Surface band exact BVH closest point distance + GWN sign -> box-filtered coverage t = clamp(0.5 - phi / H, 0, 1)
//   - Interoperable `.sdf.json` + `.sdf.bin` continuous SDF volume encoder/decoder (CPU + WebGPU compute)

import { BVH, pointTri2 } from './geom/bvh.js';
import { windingGridPlan, windingGridFill } from './geom/winding.js';
import { packBVH, packPoints } from './gpu/index.js';
import { STUD, PLATE, H, SX, SY } from './units.js';
import { blur3 } from './field.js';

export function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
  }
  return { lo, hi };
}

/**
 * Fit scale within +-tol of s0 and X/Z lattice phase shifts so dominant planar faces
 * align onto stud boundaries in X/Z and plate boundaries in Y.
 */
export function latticeFit(tris, s0, lo, tol = 0.05, steps = 100, minGain = 0.1) {
  const faces = [[], [], []];
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const a2 = Math.hypot(n[0], n[1], n[2]);
    if (a2 === 0) continue;
    for (let ax = 0; ax < 3; ax++) {
      if (Math.abs(n[ax]) / a2 >= 0.9) {
        faces[ax].push([(tris[t + ax] + tris[t + 3 + ax] + tris[t + 6 + ax]) / 3 - lo[ax], a2]);
      }
    }
  }
  const period = [STUD, PLATE, STUD];
  const resultant = (ax, s) => {
    let c = 0, sn = 0, tot = 0;
    for (const [p, a] of faces[ax]) {
      const ang = (2 * Math.PI * s * p) / period[ax];
      c += a * Math.cos(ang); sn += a * Math.sin(ang); tot += a;
    }
    return tot ? { r: Math.hypot(c, sn) / tot, phase: (Math.atan2(sn, c) / (2 * Math.PI)) * period[ax], tot } : { r: 0, phase: 0, tot: 0 };
  };
  const scoreAt = (s) => {
    const rx = resultant(0, s), rz = resultant(2, s);
    let cy = 0, ty = 0;
    for (const [p, a] of faces[1]) { cy += a * Math.cos((2 * Math.PI * s * p) / PLATE); ty += a; }
    return { s, score: rx.r + rz.r + (ty ? cy / ty : 0), rx, rz, ry: { r: ty ? cy / ty : 0 } };
  };
  const base = scoreAt(s0);
  let best = base;
  for (let k = 0; k <= steps; k++) {
    const c = scoreAt(s0 * (1 - tol + (2 * tol * k) / steps));
    if (c.score > best.score) best = c;
  }
  if (best.score - base.score < minGain) best = base;
  const shiftOf = (res) => {
    const ph = ((res.phase % STUD) + STUD) % STUD;
    return ph < STUD / 2 ? -ph : STUD - ph;
  };
  return { s: best.s, s0, shift: [shiftOf(best.rx), shiftOf(best.rz)], score: best.score, score0: base.score };
}

/** Weld a flat triangle soup into indexed { V, F } */
export function weld(tris) {
  const n = tris.length / 3, F = new Int32Array(n), src = tris instanceof Float32Array ? tris : Float32Array.from(tris);
  const exact = src === tris || tris.every((x, i) => x === src[i]);
  if (!exact) {
    const map = new Map(), V = [];
    for (let k = 0; k < tris.length; k += 3) {
      const key = tris[k] + ',' + tris[k + 1] + ',' + tris[k + 2];
      let id = map.get(key);
      if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(tris[k], tris[k + 1], tris[k + 2]); }
      F[k / 3] = id;
    }
    return { V: Float64Array.from(V), F };
  }
  const u = new Uint32Array(src.buffer, src.byteOffset, src.length);
  let cap = 1; while (cap < 2 * n) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), V = new Float64Array(3 * n), first = new Int32Array(n);
  let nv = 0;
  const bits = (x, k) => (x === 0 ? 0 : u[k]);
  for (let c = 0; c < n; c++) {
    const k = 3 * c, x = src[k], y = src[k + 1], z = src[k + 2];
    let h = Math.imul(bits(x, k) ^ Math.imul(bits(y, k + 1), 0x9e3779b1) ^ Math.imul(bits(z, k + 2), 0x85ebca77), 0xc2b2ae3d);
    h = (h ^ (h >>> 15)) & (cap - 1);
    for (;;) {
      const id = table[h];
      if (id < 0) {
        table[h] = nv; first[nv] = k; V[3 * nv] = x; V[3 * nv + 1] = y; V[3 * nv + 2] = z; F[c] = nv++; break;
      }
      const f = first[id];
      if (src[f] === x && src[f + 1] === y && src[f + 2] === z) { F[c] = id; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  return { V: V.slice(0, 3 * nv), F };
}

/** Build-space similarity frame x_build = x * k + t (LDU) at `studs` scale */
export function frameFor(model, studs, { ref = 'min3', gridAlign = true, margin = 1 } = {}) {
  const { lo, hi } = bounds(model.tris), ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const denom = ref === 'min3' ? Math.max(1e-6, Math.min(...ext)) : Math.max(1e-6, ext[0], ext[2]);
  const s0 = (studs * STUD) / denom;
  const fit = gridAlign ? latticeFit(model.tris, s0, lo, 0.05, 100, 0.15) : { s: s0, shift: [0, 0] };
  const s = fit.s;
  return {
    k: s,
    t: [-lo[0] * s + margin * STUD + fit.shift[0], -lo[1] * s, -lo[2] * s + margin * STUD + fit.shift[1]],
    s0,
    studs,
    lo,
    hi,
  };
}

function nearest2(bvh, qx, qy, qz, best2 = Infinity) {
  const { V, F, lo, hi, left, start, count, idx } = bvh, right = bvh._right, st = bvh.stack;
  let sp = 0; st[sp++] = 0;
  while (sp) {
    const n = st[--sp];
    const dx = Math.max(lo[3 * n] - qx, 0, qx - hi[3 * n]);
    const dy = Math.max(lo[3 * n + 1] - qy, 0, qy - hi[3 * n + 1]);
    const dz = Math.max(lo[3 * n + 2] - qz, 0, qz - hi[3 * n + 2]);
    if (dx * dx + dy * dy + dz * dz >= best2) continue;
    if (left[n] < 0) {
      for (let i = start[n]; i < start[n] + count[n]; i++) {
        const f = idx[i];
        const d2 = pointTri2(qx, qy, qz, V, 3 * F[3 * f], 3 * F[3 * f + 1], 3 * F[3 * f + 2]);
        if (d2 < best2) best2 = d2;
      }
    } else {
      st[sp++] = left[n]; st[sp++] = right[n];
    }
  }
  return best2;
}

function trilinearXYZ(g, u, v, w) {
  const { data, nx, ny, nz } = g;
  const i = Math.min(nx - 2, Math.max(0, u | 0));
  const j = Math.min(ny - 2, Math.max(0, v | 0));
  const k = Math.min(nz - 2, Math.max(0, w | 0));
  const a = u - i, b = v - j, c = w - k;
  const at = (p, q, r) => data[((k + r) * ny + (j + q)) * nx + (i + p)];
  return ((at(0, 0, 0) * (1 - a) + at(1, 0, 0) * a) * (1 - b) + (at(0, 1, 0) * (1 - a) + at(1, 1, 0) * a) * b) * (1 - c)
    + ((at(0, 0, 1) * (1 - a) + at(1, 0, 1) * a) * (1 - b) + (at(0, 1, 1) * (1 - a) + at(1, 1, 1) * a) * b) * c;
}

function* targetSteps(model, frame, log) {
  const t0 = Date.now(), { V: V0, F } = weld(model.tris), V = new Float64Array(V0.length);
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) V[i + a] = V0[i + a] * frame.k + frame.t[a];
  let hx = 0, hy = 0, hz = 0;
  for (let i = 0; i < V.length; i += 3) {
    hx = Math.max(hx, V[i]); hy = Math.max(hy, V[i + 1]); hz = Math.max(hz, V[i + 2]);
  }
  const CX = Math.ceil(hx / STUD) + 2, CY = Math.ceil(hy / PLATE) + 2, CZ = Math.ceil(hz / STUD) + 2;
  const X = CX * SX + SX - 1, Y = CY * SY, Z = CZ * SX + SX - 1, N = X * Y * Z;

  const plan = windingGridPlan(V, F, H, { stride: 3 });
  const wq = yield { kind: 'winding', Q: plan.Q, WV: plan.WV, WF: plan.WF, beta: 1.5 };
  const wg = windingGridFill(plan, wq);
  const g = { data: wg.W, nx: wg.dims[0], ny: wg.dims[1], nz: wg.dims[2] };
  const W = (x, y, z) => {
    const u = (x - wg.lo[0]) / H, v = (y - wg.lo[1]) / H, w = (z - wg.lo[2]) / H;
    return u < 0 || v < 0 || w < 0 || u > g.nx - 1 || v > g.ny - 1 || w > g.nz - 1 ? 0 : trilinearXYZ(g, u, v, w);
  };

  const near = new Uint8Array(N), m = F.length / 3;
  for (let f = 0; f < m; f++) {
    let l0 = Infinity, l1 = Infinity, l2 = Infinity, h0 = -Infinity, h1 = -Infinity, h2 = -Infinity;
    for (let c = 0; c < 3; c++) {
      const p = 3 * F[3 * f + c];
      l0 = Math.min(l0, V[p]); h0 = Math.max(h0, V[p]);
      l1 = Math.min(l1, V[p + 1]); h1 = Math.max(h1, V[p + 1]);
      l2 = Math.min(l2, V[p + 2]); h2 = Math.max(h2, V[p + 2]);
    }
    const x0 = Math.max(0, Math.floor(l0 / H) - 1), x1 = Math.min(X - 1, Math.floor(h0 / H) + 1);
    const y0 = Math.max(0, Math.floor(l1 / H) - 1), y1 = Math.min(Y - 1, Math.floor(h1 / H) + 1);
    const z0 = Math.max(0, Math.floor(l2 / H) - 1), z1 = Math.min(Z - 1, Math.floor(h2 / H) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) near[(y * Z + z) * X + x] = 1;
      }
    }
  }

  const t = new Float32Array(N);
  let nNear = 0;
  for (let i = 0; i < N; i++) nNear += near[i];
  const pts = new Float64Array(3 * nNear), at = new Int32Array(nNear);
  for (let y = 0, q = 0; y < Y; y++) {
    for (let z = 0; z < Z; z++) {
      for (let x = 0; x < X; x++) {
        const i = (y * Z + z) * X + x, px = (x + 0.5) * H, py = (y + 0.5) * H, pz = (z + 0.5) * H;
        if (!near[i]) { t[i] = W(px, py, pz) > 0.5 ? 1 : 0; continue; }
        pts[3 * q] = px; pts[3 * q + 1] = py; pts[3 * q + 2] = pz; at[q++] = i;
      }
    }
  }

  const bvh = new BVH(V, F);
  bvh.prepareWinding();
  const r = yield { kind: 'near', pts, bvh, beta: 2, bound2: 4 * H * H };
  const band = new Uint8Array(N), touch2 = 3 * (H / 2) * (H / 2);
  for (let q = 0; q < nNear; q++) {
    const d = Math.sqrt(r.d2[q]), phi = r.w[q] > 0.5 ? -d : d;
    t[at[q]] = Math.min(1, Math.max(0, 0.5 - phi / H));
    if (r.d2[q] <= touch2) band[at[q]] = 1;
  }
  log(`target: ${X} x ${Y} x ${Z} sub-voxels (${CX} x ${CY} x ${CZ} cells), ${nNear} near surface, ${Date.now() - t0} ms${r.gpu ? ` (${r.gpu})` : ''}`);
  return { t, band, X, Y, Z, cells: [CX, CY, CZ], frame, ms: Date.now() - t0 };
}

function cpuAnswer(step) {
  if (step.kind === 'winding') {
    const bvh = new BVH(step.WV, step.WF).prepareWinding(), Q = step.Q, n = Q.length / 3, w = new Float32Array(n);
    for (let q = 0; q < n; q++) w[q] = bvh.winding(Q[3 * q], Q[3 * q + 1], Q[3 * q + 2], step.beta);
    return w;
  }
  const { pts, bvh, beta, bound2 } = step, n = pts.length / 3, w = new Float64Array(n), d2 = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const px = pts[3 * q], py = pts[3 * q + 1], pz = pts[3 * q + 2];
    d2[q] = nearest2(bvh, px, py, pz, bound2);
    w[q] = bvh.winding(px, py, pz, beta);
  }
  return { w, d2 };
}

export function targetField(model, frame, { log = () => {} } = {}) {
  const it = targetSteps(model, frame, log);
  let x = it.next();
  while (!x.done) x = it.next(cpuAnswer(x.value));
  return x.value;
}

export async function targetFieldAsync(model, frame, { log = () => {}, gpu = null } = {}) {
  const it = targetSteps(model, frame, log);
  let x = it.next();
  while (!x.done) {
    const step = x.value;
    let ans = null;
    if (gpu) {
      try {
        if (step.kind === 'winding') {
          const bvh = new BVH(step.WV, step.WF).prepareWinding();
          ans = (await gpu.bvhQuery(packBVH(bvh), packPoints(step.Q), { beta: step.beta })).w;
        } else {
          ans = await gpu.bvhQuery(packBVH(step.bvh), packPoints(step.pts), { beta: step.beta, bound2: step.bound2 });
          ans.gpu = gpu.label;
        }
      } catch (e) {
        log(`gpu: ${step.kind} fallback to CPU (${(e && e.message) || e})`);
        ans = null;
      }
    }
    x = it.next(ans || cpuAnswer(step));
  }
  return x.value;
}

export function octaves(T, sigmas = [0, 1.5, 3, 6], only = null) {
  return sigmas.map((s, i) => (only && !only.includes(i) ? null : s > 0 ? blur3(T.t, T.X, T.Y, T.Z, s) : T.t));
}

/**
 * Encode a triangle mesh directly into an exact continuous 3D Signed Distance Field grid
 * (interoperable `.sdf.json` + `.sdf.bin` format matching Python's `encode_sdf.py`).
 * Layout: data[(k * ny + j) * nx + i] at world point origin + [i, j, k] * step.
 */
export async function encodeSdfVolume(model, { res = 64, padVoxels = 3, gpu = null, log = () => {} } = {}) {
  const t0 = Date.now();
  const { V, F } = weld(model.tris);
  const b = bounds(model.tris);
  const ext = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
  const maxExt = Math.max(1e-6, ext[0], ext[1], ext[2]);
  const step = maxExt / Math.max(4, res - 2 * padVoxels);
  const origin = [b.lo[0] - padVoxels * step, b.lo[1] - padVoxels * step, b.lo[2] - padVoxels * step];
  const nx = Math.ceil((ext[0] + 2 * padVoxels * step) / step) + 1;
  const ny = Math.ceil((ext[1] + 2 * padVoxels * step) / step) + 1;
  const nz = Math.ceil((ext[2] + 2 * padVoxels * step) / step) + 1;
  const nPts = nx * ny * nz;
  const pts = new Float64Array(nPts * 3);
  let p = 0;
  for (let k = 0; k < nz; k++) {
    const z = origin[2] + k * step;
    for (let j = 0; j < ny; j++) {
      const y = origin[1] + j * step;
      for (let i = 0; i < nx; i++) {
        pts[p++] = origin[0] + i * step;
        pts[p++] = y;
        pts[p++] = z;
      }
    }
  }
  const bvh = new BVH(V, F);
  bvh.prepareWinding();
  let resGpu = null;
  if (gpu) {
    try {
      resGpu = await gpu.bvhQuery(packBVH(bvh), packPoints(pts), { beta: 2, bound2: 1e12 });
    } catch (e) {
      log(`gpu encode fallback to CPU (${e?.message || e})`);
    }
  }
  const sdf = new Float32Array(nPts);
  if (resGpu) {
    for (let q = 0; q < nPts; q++) {
      const d = Math.sqrt(Math.max(0, resGpu.d2[q]));
      sdf[q] = resGpu.w[q] > 0.5 ? -d : d;
    }
  } else {
    for (let q = 0; q < nPts; q++) {
      const px = pts[3 * q], py = pts[3 * q + 1], pz = pts[3 * q + 2];
      const d = Math.sqrt(nearest2(bvh, px, py, pz, Infinity));
      sdf[q] = bvh.winding(px, py, pz, 2) > 0.5 ? -d : d;
    }
  }
  const header = {
    format: 'brickpack-sdf-v1',
    nx,
    ny,
    nz,
    origin,
    step,
    bounds: { lo: b.lo, hi: b.hi },
    hasColor: !!model.hasColor,
    ms: Date.now() - t0,
    compute: resGpu ? gpu.label : 'CPU',
  };
  log(`encoded SDF: ${nx} x ${ny} x ${nz} (${nPts} samples), step=${step.toFixed(5)}, ${header.ms} ms (${header.compute})`);
  return { header, data: sdf };
}

/**
 * Sample a continuous `.sdf.json` + `.sdf.bin` grid into BrickPack's 4-LDU sub-voxel target structure `T`.
 * Supports direct packing from pre-encoded SDF files without loading the original polygon mesh!
 */
export function targetFromSdfVolume(hdr, data, studs = 16, { ref = 'min3', margin = 1 } = {}) {
  const { nx, ny, nz, origin, step } = hdr;
  const lo = hdr.bounds?.lo || origin;
  const hi = hdr.bounds?.hi || [origin[0] + (nx - 1) * step, origin[1] + (ny - 1) * step, origin[2] + (nz - 1) * step];
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const denom = ref === 'min3' ? Math.max(1e-6, Math.min(...ext)) : Math.max(1e-6, ext[0], ext[2]);
  const s = (studs * STUD) / denom;
  const frame = {
    k: s,
    t: [-lo[0] * s + margin * STUD, -lo[1] * s, -lo[2] * s + margin * STUD],
    s0: s,
    studs,
    lo,
    hi,
  };
  const hx = ext[0] * s + 2 * margin * STUD;
  const hy = ext[1] * s;
  const hz = ext[2] * s + 2 * margin * STUD;
  const CX = Math.ceil(hx / STUD) + 2, CY = Math.ceil(hy / PLATE) + 2, CZ = Math.ceil(hz / STUD) + 2;
  const X = CX * SX + SX - 1, Y = CY * SY, Z = CZ * SX + SX - 1, N = X * Y * Z;

  const at = (i, j, k) => data[(k * ny + j) * nx + i];
  const sample = (x, y, z) => {
    const u = (x - origin[0]) / step, v = (y - origin[1]) / step, w = (z - origin[2]) / step;
    if (u < 0 || v < 0 || w < 0 || u > nx - 1 || v > ny - 1 || w > nz - 1) return step * 4;
    const i = Math.min(nx - 2, u | 0), j = Math.min(ny - 2, v | 0), k = Math.min(nz - 2, w | 0);
    const a = u - i, b = v - j, c = w - k;
    const l = (p, q, r) => at(i + p, j + q, k + r);
    return ((l(0, 0, 0) * (1 - a) + l(1, 0, 0) * a) * (1 - b) + (l(0, 1, 0) * (1 - a) + l(1, 1, 0) * a) * b) * (1 - c)
      + ((l(0, 0, 1) * (1 - a) + l(1, 0, 1) * a) * (1 - b) + (l(0, 1, 1) * (1 - a) + l(1, 1, 1) * a) * b) * c;
  };

  const t = new Float32Array(N), band = new Uint8Array(N);
  const { k: sk, t: tt } = frame;
  const bandThresh = 0.87 * H;
  for (let y = 0; y < Y; y++) {
    const my = ((y + 0.5) * H - tt[1]) / sk;
    for (let z = 0; z < Z; z++) {
      const mz = ((z + 0.5) * H - tt[2]) / sk;
      for (let x = 0; x < X; x++) {
        const mx = ((x + 0.5) * H - tt[0]) / sk;
        const phiLdu = sample(mx, my, mz) * sk;
        const idx = (y * Z + z) * X + x;
        t[idx] = Math.min(1, Math.max(0, 0.5 - phiLdu / H));
        if (Math.abs(phiLdu) <= bandThresh) band[idx] = 1;
      }
    }
  }
  return { t, band, X, Y, Z, cells: [CX, CY, CZ], frame, ms: 0 };
}
