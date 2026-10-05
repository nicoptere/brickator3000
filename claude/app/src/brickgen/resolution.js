// Which resolution? (docs/CURVES.md round 8, paper §"Choosing the resolution".)
//
// "Good" = the high-frequency detail of the mesh survives while its plain areas stay plain. The second half is free: a plain
// area costs the same few big plates at any resolution. The first half is a sampling question (Nyquist, and for surfaces the
// epsilon-sampling of Amenta & Bern 1998: samples closer than a fraction of the local feature size, the distance to the medial
// axis). The field samples the mesh at 4 LDU and the parts at 20 LDU, so the stud is the sampling period that matters, and a
// feature survives when it spans enough studs. Two descriptors of the mesh give the feature sizes, in model units, from the
// engine's own ray caster and the welded mesh:
//
//  thickness  chord lengths of the solid along x, y and z - parallel rays on a fine grid, even-odd pairing (grid.columnHits):
//             the local thickness of walls, limbs, struts, protrusions seen edge-on. This is the shape diameter function of
//             Shapira, Shamir & Cohen-Or 2008 taken along the three axes. A wall thinner than one stud cannot be built; the
//             engine fattens or drops it. Rule: the `autoThickPct` percentile of the chord lengths (count-weighted: every chord is
//             two surface samples) must be at least `autoThick` studs.
//  curvature  radius of curvature of the smooth parts of the surface: per edge of the welded mesh, the dihedral angle between
//             its two faces over the width of the two-face strip (curvatureRadii), with creases (faces more than `autoCrease`
//             degrees apart) excluded - a box edge is sharp at any resolution and must not ask for more. A round surface reads
//             as round only when its radius spans a few studs (a 2-stud radius is a blob): the `autoCurvPct` percentile radius
//             (over the curved edges, weighted by edge length) must span at least `autoCurv` studs.
//
//  N = max(N_thick, N_curv) clamped to [autoMin, autoMax], where N_x = refSide * studs_required / feature_size (the engine's
//  scale puts the reference side at N studs). The constants are calibrated against the rate-distortion knee of the engine
//  itself (test/resolution_bench.mjs: fidelity against a fine reference voxelisation vs piece count, knee by Kneedle - Satopaa
//  et al. 2011): the resolution past which a model gains little fidelity per piece.
import { STUD, PLATE, G, SAMP, PAD } from './constants.js';
import { bounds } from './mesh.js';
import { columnHits, latticeFit, prepare, carveCrust } from './grid.js';
import { weld } from './smooth.js';
import { partVariants, pieceVariant } from './variants.js';

const percentile = (arr, p) => { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; };

/** chord lengths (model units) of the solid along the three axes, on `cols` ray columns across the reference side */
export function chords(tris, { cols = 128, minChord = 0 } = {}) {
  const { lo, hi } = bounds(tris), ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const step = Math.max(ext[0], ext[1], ext[2]) / cols, out = { x: [], y: [], z: [] }, n = tris.length;
  for (const [axis, key] of [[0, 'x'], [1, 'y'], [2, 'z']]) {
    // permute so that the axis becomes y (the ray direction of columnHits); translate to >= 0
    const t = new Float32Array(n), a = axis, b = axis === 1 ? 0 : 1, c = axis === 2 ? 1 : 2;      // (y, other, other) <- (axis, ...)
    const ex = [b, a, c];                                       // new x <- old b, new y <- old axis, new z <- old c
    for (let k = 0; k < n; k += 3) for (let r = 0; r < 3; r++) t[k + r] = tris[k + ex[r]] - lo[ex[r]];
    const NX = Math.max(1, Math.ceil(ext[ex[0]] / step)), NZ = Math.max(1, Math.ceil(ext[ex[2]] / step));
    const { start, Y } = columnHits(t, NX, NZ, step);
    for (let col = 0; col < NX * NZ; col++) {
      const s = start[col], e = start[col + 1], m = (e - s) - ((e - s) % 2);
      for (let p = s; p < s + m; p += 2) { const L = Y[p + 1] - Y[p]; if (L > minChord) out[key].push(L); }
    }
  }
  return { ...out, all: [...out.x, ...out.y, ...out.z], step, ext, refSide: Math.max(ext[0], ext[2]), minSide: Math.min(...ext) };
}

/**
 * radii of curvature (model units) across the smooth edges of the welded mesh, with the edge lengths as weights.
 * Per edge shared by two faces: the dihedral angle theta between the face normals and the width of the two-face strip,
 * w = (A1 + A2) / |e|; the surface bends by theta over w, so its radius there is w / theta (exact for a prism approximating a
 * cylinder: w = the arc step, theta = the step angle). Coplanar faces (a flat wall's two triangles, a cap fan) give Infinity, a
 * crease (theta above `crease` degrees) is skipped: a box edge is sharp at any resolution. Vertex normals were tried first and
 * fail on exactly those meshes: averaged over a crease they tilt by 45 degrees, so every flat wall of a box reads as curved.
 */
export function curvatureRadii(tris, { crease = 35 } = {}) {
  const { pos, idx } = weld(tris), nf = idx.length / 3, fn = new Float64Array(nf * 3), fa = new Float64Array(nf), edges = new Map();
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
    fa[f] = L / 2; if (L > 0) { fn[f * 3] = nx / L; fn[f * 3 + 1] = ny / L; fn[f * 3 + 2] = nz / L; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 4294967296 + v : v * 4294967296 + u; const e = edges.get(key); if (e) e.push(f); else edges.set(key, [f]); }
  }
  const radii = [], weights = [], cosCrease = Math.cos(crease * Math.PI / 180); let creaseLen = 0, smoothLen = 0;
  for (const [key, fs] of edges) {
    if (fs.length !== 2) continue;                                                     // boundary or non-manifold edge: no dihedral
    const u = Math.floor(key / 4294967296), v = key - u * 4294967296;
    const le = Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]); if (le < 1e-9) continue;
    const [f, g] = fs, dot = Math.max(-1, Math.min(1, fn[f * 3] * fn[g * 3] + fn[f * 3 + 1] * fn[g * 3 + 1] + fn[f * 3 + 2] * fn[g * 3 + 2]));
    if (dot < cosCrease) { creaseLen += le; continue; }
    const theta = Math.acos(dot), w = (fa[f] + fa[g]) / le;
    radii.push(theta < 1e-6 ? Infinity : w / theta); weights.push(le); smoothLen += le;
  }
  return { radii, weights, creaseLen, smoothLen };
}
/** weighted percentile */
function wpercentile(vals, weights, p) {
  const n = vals.length; if (!n) return 0;
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => vals[a] - vals[b]);
  let tot = 0; for (const wv of weights) tot += wv; let acc = 0;
  for (const k of order) { acc += weights[k]; if (acc >= p * tot) return vals[k]; }
  return vals[order[n - 1]];
}

/** the feature-size criteria of a model, as stud counts: { curv: { radius, studs }, thick: { size, studs }, refSide } (sizes in model units) */
export function featureStuds(model, o = {}) {
  const pThick = o.autoThickPct ?? 0.1, kThick = o.autoThick ?? 1, pCurv = o.autoCurvPct ?? 0.5, kCurv = o.autoCurv ?? 8;
  const ch = chords(model.tris, { cols: o.autoCols ?? 128 });
  const ref = (o.ref ?? 'maxh') === 'min3' ? ch.minSide : ch.refSide;
  const thick = percentile(ch.all, pThick), cr = curvatureRadii(model.tris, { crease: o.autoCrease ?? 35 });
  // the curved part of the surface: edges whose radius is finite and smaller than the model (beyond that the surface is flat for any brick)
  const vals = [], ws = []; for (let k = 0; k < cr.radii.length; k++) if (cr.radii[k] < 2 * ref) { vals.push(cr.radii[k]); ws.push(cr.weights[k]); }
  const radius = vals.length ? wpercentile(vals, ws, pCurv) : Infinity;
  let curvedShare = 0, allW = 0; for (let k = 0; k < cr.weights.length; k++) allW += cr.weights[k]; for (const wv of ws) curvedShare += wv; curvedShare = allW ? curvedShare / allW : 0;
  // the reference side is N studs, so a feature of `size` spans N * size / ref studs; ask for k of them
  return { thick: { p: pThick, size: +thick.toFixed(4), studs: thick > 0 ? +(ref * kThick / thick).toFixed(1) : 0, n: ch.all.length },
    curv: { p: pCurv, radius: isFinite(radius) ? +radius.toFixed(4) : null, studs: isFinite(radius) && radius > 0 ? +(ref * kCurv / radius).toFixed(1) : 0, share: +curvedShare.toFixed(3), n: vals.length }, refSide: ref };
}

/** lattice alignment score (grid.latticeFit) at each candidate stud count: how well the model's planar faces can sit on stud boundaries there */
export function latticeScores(tris, studsList, o = {}) {
  const { lo, hi } = bounds(tris), ref = (o.ref ?? 'maxh') === 'min3' ? Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : Math.max(hi[0] - lo[0], hi[2] - lo[2]);
  return studsList.map((n) => { const r = latticeFit(tris, n * STUD / ref, lo, o.alignTol ?? 0.05, 100, o.alignMinGain ?? 0.15); return { studs: n, score: +r.score.toFixed(3), rescaled: +(r.s / r.s0).toFixed(3) }; });
}

// ------------------------------------------------------------------------------------------------ fidelity across resolutions
// The engine's own IoU is measured against the field at the solution's resolution, so it cannot compare two resolutions. Here
// every candidate - a field or a solution - is rasterised into ONE fine reference voxelisation of the mesh (`refStuds`, no lattice
// fit, no crust, no island joining) and measured there. Two numbers: `iou`, the IoU of the solid against the reference solid,
// with a solution's hollow (the interior the engine carved at `crustDepth` LDU and never fills) counted as solid, since it is
// hidden - comparable across stud counts because the union is always the two solids; and `band`, the same IoU restricted to the
// cells within `bandCells` of the reference surface (the detail lives there; a coarse model is right in the bulk and wrong in the
// band). Fields are compared uncarved, so they need no hollow rule.

/** the reference voxelisation; `band(b)` gives (and memoises) the mask of cells within b cells of the solid / air boundary */
export function referenceField(model, refStuds = 96, o = {}) {
  const base = { ...o, gridAlign: false, crust: false, islands: false, decimate: false, mode: 'hollow', snap: 0, minGap: 0, minThick: false, superSample: 1, fieldSmooth: 0, field: 'rays' };
  const ref = prepare({ tris: model.tris, pts: new Float32Array(0) }, refStuds, base), bands = new Map(), deeps = new Map();
  ref.studs = refStuds;
  ref.band = (b) => {
    if (bands.has(b)) return bands.get(b);
    // cells of the solid within b of the air and cells of the air within b of the solid: what carveCrust would NOT carve at that depth, on the field and on its inverse
    const { M, nl, NZ, NX } = ref, out = new Uint8Array(M.length), Ms = M.slice(), Ma = new Float32Array(M.length);
    for (let q = 0; q < M.length; q++) Ma[q] = 1 - M[q];
    carveCrust(Ms, nl, NZ, NX, b * SAMP); carveCrust(Ma, nl, NZ, NX, b * SAMP);
    for (let q = 0; q < M.length; q++) if ((M[q] > 0.5 && Ms[q] > 0.5) || (M[q] <= 0.5 && Ma[q] > 0.5)) out[q] = 1;
    bands.set(b, out); return out;
  };
  // the deep interior for a solution at scale s (LDU per model unit): the engine's crust depth, in reference cells
  ref.deep = (s, o2) => {
    if (!o2.crust) return null;
    const depth = (o2.crustDepth ?? 40) / s * ref.s, key = +depth.toFixed(3); if (deeps.has(key)) return deeps.get(key);
    const Mc = ref.M.slice(); carveCrust(Mc, ref.nl, ref.NZ, ref.NX, depth); const d = new Uint8Array(ref.M.length);
    for (let q = 0; q < Mc.length; q++) if (ref.M[q] > 0.5 && Mc[q] === 0) d[q] = 1;
    deeps.set(key, d); return d;
  };
  return ref;
}
/** IoU of an accumulated solution C against the reference (deep cells count as solid), overall and within the band */
function measure(ref, C, deep, band) {
  let inter = 0, uni = 0, bi = 0, bu = 0;
  for (let q = 0; q < C.length; q++) {
    const m = ref.M[q], c = deep && deep[q] ? Math.max(C[q], m) : C[q], a = m < c ? m : c, b = m < c ? c : m;
    inter += a; uni += b; if (band && band[q]) { bi += a; bu += b; }
  }
  return { iou: uni ? inter / uni : 1, band: band ? (bu ? bi / bu : 1) : null };
}
/**
 * fidelity of a prepared field (grid.prepare at any stud count, lattice fit or not, uncarved) against the reference. The field is
 * piecewise constant on cells at least twice the reference's, so it is pulled: every reference cell takes the value of the field
 * cell its centre falls in (a splat with overlap fractions gives the same numbers to 3 decimals at 50x the cost).
 */
export function fieldFidelity(pre, ref, bandCells = 0) {
  const s = pre.s, sr = ref.s, sh = pre.shift || [0, 0], NX = ref.NX, NZ = ref.NZ, NL = ref.nl, M = pre.Mfull || pre.M, band = bandCells > 0 ? ref.band(bandCells) : null;
  // reference padded LDU -> model units -> field padded LDU (the field put the model's lo at PAD + shift); per axis, the field index of each reference cell centre
  const mapX = new Int32Array(NX), mapZ = new Int32Array(NZ), mapL = new Int32Array(NL);
  for (let i = 0; i < NX; i++) { const X = ((i + 0.5) * SAMP - PAD) / sr * s + PAD + sh[0], ix = Math.floor(X / SAMP); mapX[i] = ix >= 0 && ix < pre.NX ? ix : -1; }
  for (let k = 0; k < NZ; k++) { const Z = ((k + 0.5) * SAMP - PAD) / sr * s + PAD + sh[1], iz = Math.floor(Z / SAMP); mapZ[k] = iz >= 0 && iz < pre.NZ ? iz : -1; }
  for (let l = 0; l < NL; l++) { const il = Math.floor((l + 0.5) * PLATE / sr * s / PLATE); mapL[l] = il >= 0 && il < pre.nl ? il : -1; }
  let inter = 0, uni = 0, bi = 0, bu = 0;
  for (let l = 0; l < NL; l++) { const il = mapL[l];
    for (let k = 0; k < NZ; k++) { const iz = mapZ[k], row = (l * NZ + k) * NX, frow = il >= 0 && iz >= 0 ? (il * pre.NZ + iz) * pre.NX : -1;
      for (let i = 0; i < NX; i++) { const q = row + i, ix = mapX[i], m = ref.M[q], c = frow >= 0 && ix >= 0 ? M[frow + ix] : 0, a = m < c ? m : c, b = m < c ? c : m;
        inter += a; uni += b; if (band && band[q]) { bi += a; bu += b; } } } }
  return { iou: uni ? inter / uni : 1, band: band ? (bu ? bi / bu : 1) : null };
}
/** fidelity of a solution (pipeline.generate result) against the reference: every template sample of every piece is splatted with its overlap fraction */
export function solutionFidelity(r, ref, cat, o = r.options, bandCells = 0) {
  const s = r.align ? r.align.s : r.scale, [ox, oz] = r.offset, sr = ref.s, { NX, NZ, nl: NL } = ref, C = new Float32Array(ref.M.length);
  const vars = partVariants(cat.map((c) => ({ ...c, noSolo: false })), new Set(cat.map((c) => c.kind)));   // every part, the motif-only ones too
  const fx = (X) => (X - ox) / s * sr + PAD, fy = (Y) => Y / s * sr, fz = (Z) => (Z - oz) / s * sr + PAD;   // solution window LDU -> reference padded LDU
  const splat = (x0, x1, y0, y1, z0, z1, v) => {
    const i0 = Math.max(0, Math.floor(x0 / SAMP)), i1 = Math.min(NX - 1, Math.ceil(x1 / SAMP) - 1), k0 = Math.max(0, Math.floor(z0 / SAMP)), k1 = Math.min(NZ - 1, Math.ceil(z1 / SAMP) - 1);
    const l0 = Math.max(0, Math.floor(y0 / PLATE)), l1 = Math.min(NL - 1, Math.ceil(y1 / PLATE) - 1);
    for (let l = l0; l <= l1; l++) { const fyv = Math.min(y1, (l + 1) * PLATE) - Math.max(y0, l * PLATE); if (fyv <= 0) continue;
      for (let k = k0; k <= k1; k++) { const fzv = Math.min(z1, (k + 1) * SAMP) - Math.max(z0, k * SAMP); if (fzv <= 0) continue;
        for (let i = i0; i <= i1; i++) { const fxv = Math.min(x1, (i + 1) * SAMP) - Math.max(x0, i * SAMP); if (fxv <= 0) continue;
          const q = (l * NZ + k) * NX + i; C[q] = Math.min(1, C[q] + v * (fxv / SAMP) * (fzv / SAMP) * (fyv / PLATE)); } } }
  };
  for (const p of r.pieces) {
    if (p.snot) { splat(fx(p.i * STUD), fx((p.i + p.w) * STUD), fy(p.b * PLATE), fy((p.b + p.h) * PLATE), fz(p.j * STUD), fz((p.j + p.d) * STUD), 1); continue; }
    const v = pieceVariant(p, vars); if (!v) continue;
    const pz = v.d * G, px = v.w * G;
    for (let l = 0; l < v.h; l++) for (let z = 0; z < pz; z++) for (let x = 0; x < px; x++) {
      const vv = v.V[(l * pz + z) * px + x]; if (vv < 0.02) continue;
      const X0 = p.i * STUD + x * SAMP, Z0 = p.j * STUD + z * SAMP, Y0 = (p.b + l) * PLATE;
      splat(fx(X0), fx(X0 + SAMP), fy(Y0), fy(Y0 + PLATE), fz(Z0), fz(Z0 + SAMP), vv);
    }
  }
  return measure(ref, C, ref.deep(s, o), bandCells > 0 ? ref.band(bandCells) : null);
}
/** the band width, in reference cells, that is half a stud at `studs`: the surface band one cell thick at the working resolution */
export const bandFor = (ref, studs) => Math.max(1, Math.round(2.5 * ref.studs / studs));
/** Kneedle (Satopaa et al. 2011) on an increasing curve: the index of the point farthest above the chord between its ends */
export function knee(xs, ys) {
  const n = xs.length; if (n < 3) return n - 1;
  const x0 = xs[0], x1 = xs[n - 1], y0 = ys[0], y1 = ys[n - 1]; let best = 0, bd = -Infinity;
  for (let k = 0; k < n; k++) { const xn = (xs[k] - x0) / (x1 - x0 || 1), yn = (ys[k] - y0) / (y1 - y0 || 1), d = yn - xn; if (d > bd) { bd = d; best = k; } }
  return best;
}
