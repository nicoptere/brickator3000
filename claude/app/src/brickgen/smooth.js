// Mesh-level pre-pass: weld the triangle soup into an indexed mesh, then Taubin λ|μ smoothing (a low-pass filter on the surface
// that does not shrink it). Decoupled from the field: it rewrites `model.tris` before `grid.prepare` ever sees them.
//
// Why: a baked / scanned / generated asset carries sub-facet grain. The field samples one vertical ray per 4-LDU cell, so grain of
// a fraction of a cell still flips cells across the solver's coverage thresholds, and a flat face that should take one 2x4 plate
// comes out as a mosaic of 1x1s. Taubin (SIGGRAPH 1995) alternates a positive Laplacian step λ with a negative one μ < −λ: the
// transfer function (1 − λk)(1 − μk) is ≈ 1 below the pass-band k_pb = 1/λ + 1/μ and attenuates above it, so bumps shorter than a
// few edges go, the shape stays. docs/papers/IMPLICIT_FIELDS_AND_MESH_DENOISING.md §5.
import { bounds } from './mesh.js';

/** soup (9 floats / tri) -> { pos: Float32Array(nv*3), idx: Uint32Array(nt*3) }, vertices merged within `eps` of each other */
export function weld(tris, eps = 1e-5) {
  const { lo, hi } = bounds(tris);
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, q = eps * span;   // tolerance relative to the model size
  const map = new Map(), pos = [], idx = new Uint32Array(tris.length / 3);
  for (let k = 0; k < tris.length; k += 3) {
    const key = `${Math.round(tris[k] / q)},${Math.round(tris[k + 1] / q)},${Math.round(tris[k + 2] / q)}`;
    let v = map.get(key);
    if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(tris[k], tris[k + 1], tris[k + 2]); }
    idx[k / 3] = v;
  }
  return { pos: new Float32Array(pos), idx };
}

/** indexed mesh -> soup, in the original triangle order (so per-corner colours stay aligned) */
export function unweld(pos, idx) {
  const out = new Float32Array(idx.length * 3);
  for (let k = 0; k < idx.length; k++) { const v = idx[k] * 3; out[k * 3] = pos[v]; out[k * 3 + 1] = pos[v + 1]; out[k * 3 + 2] = pos[v + 2]; }
  return out;
}

/** vertex adjacency as CSR arrays (unique neighbours) */
export function adjacency(nv, idx) {
  const sets = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const start = new Uint32Array(nv + 1); for (let v = 0; v < nv; v++) start[v + 1] = start[v] + sets[v].size;
  const nb = new Uint32Array(start[nv]); for (let v = 0; v < nv; v++) { let p = start[v]; for (const u of sets[v]) nb[p++] = u; }
  return { start, nb };
}

/** area-weighted vertex normals (unit length) */
export function vertexNormals(pos, idx) {
  const nv = pos.length / 3, n = new Float32Array(nv * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;        // |n| = 2 * area: area weighting for free
    for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
  }
  for (let v = 0; v < n.length; v += 3) { const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1; n[v] /= l; n[v + 1] /= l; n[v + 2] /= l; }
  return n;
}

/** one umbrella step: x <- x + k * (mean of neighbours - x), in place; vertices without neighbours are left alone */
function umbrella(pos, adj, k, tmp) {
  const nv = pos.length / 3;
  for (let v = 0; v < nv; v++) {
    const a = adj.start[v], b = adj.start[v + 1];
    if (a === b) { tmp[v * 3] = pos[v * 3]; tmp[v * 3 + 1] = pos[v * 3 + 1]; tmp[v * 3 + 2] = pos[v * 3 + 2]; continue; }
    let mx = 0, my = 0, mz = 0;
    for (let p = a; p < b; p++) { const u = adj.nb[p] * 3; mx += pos[u]; my += pos[u + 1]; mz += pos[u + 2]; }
    const inv = 1 / (b - a);
    tmp[v * 3] = pos[v * 3] + k * (mx * inv - pos[v * 3]);
    tmp[v * 3 + 1] = pos[v * 3 + 1] + k * (my * inv - pos[v * 3 + 1]);
    tmp[v * 3 + 2] = pos[v * 3 + 2] + k * (mz * inv - pos[v * 3 + 2]);
  }
  pos.set(tmp);
}

/** Taubin λ|μ smoothing of an indexed mesh, `iters` (λ, μ) pairs. Default pass-band k_pb = 1/λ + 1/μ ≈ 0.1. */
export function taubin(pos, idx, iters = 10, lambda = 0.5, mu = -0.53) {
  const adj = adjacency(pos.length / 3, idx), tmp = new Float32Array(pos.length);
  for (let i = 0; i < iters; i++) { umbrella(pos, adj, lambda, tmp); umbrella(pos, adj, mu, tmp); }
  return pos;
}

/** the model with its triangle soup smoothed; colours and everything else untouched. iters <= 0 returns the model itself. */
export function smoothModel(model, iters, lambda, mu) {
  if (!(iters > 0)) return model;
  const { pos, idx } = weld(model.tris);
  taubin(pos, idx, iters, lambda, mu);
  return { ...model, tris: unweld(pos, idx), smoothed: { iters, vertices: pos.length / 3, triangles: idx.length / 3 } };
}
