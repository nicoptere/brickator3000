// Fidelity of a set of parts against the target coverage, on the same 4 LDU sub-voxels: the parts' stencils are rasterised
// (o, fractional), then
//   soft IoU = sum min(t, o) / sum max(t, o)       (t = exact coverage of the sub-voxel by the mesh: target.js)
//   L1 error = sum |t - o| / sum t                 (volume of disagreement relative to the mesh volume)
//   voxel IoU = IoU of (t > 1/2) and (o > 1/2)
// plus connectivity: parts touching through a stud connection (one directly on top of another, overlapping footprint) form a
// component. Studs (optional, off by default) add the exposed studs' volume (r = 6, 4 LDU) above every free stud cell.
import { SX, SY } from './units.js';
import { STUD_COVER } from './dictionary.js';

export function rasterise(pieces, byKey, T, [ox, oz], { studs = false } = {}) {
  const { X, Y, Z } = T, o = new Float32Array(X * Y * Z), [CX, CY, CZ] = T.cells, occ = new Int32Array(CX * CY * CZ).fill(-1);
  let missing = 0;
  pieces.forEach((p, k) => {
    const v = byKey.get(`${p.id}|${p.rot}`); if (!v) { missing++; return; }
    const nx = v.w * SX, nz = v.d * SX, x0 = ox + p.i * SX, y0 = p.b * SY, z0 = oz + p.j * SX;
    for (let l = 0; l < v.L; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const val = v.V[(l * nz + z) * nx + x]; if (!val) continue;
      const X0 = x0 + x, Y0 = y0 + l, Z0 = z0 + z; if (X0 < 0 || Y0 < 0 || Z0 < 0 || X0 >= X || Y0 >= Y || Z0 >= Z) continue;
      const q = (Y0 * Z + Z0) * X + X0; o[q] = Math.min(1, o[q] + val);
    }
    for (let b = p.b; b < p.b + v.h; b++) for (let j = p.j; j < p.j + v.d; j++) for (let i = p.i; i < p.i + v.w; i++) if (i >= 0 && j >= 0 && b >= 0 && i < CX && j < CZ && b < CY) occ[(b * CZ + j) * CX + i] = k;
  });
  if (studs) for (const p of pieces) {
    const v = byKey.get(`${p.id}|${p.rot}`); if (!v) continue;
    const yS = (p.b + v.h) * SY; if (yS >= Y) continue;
    for (const [si, sj] of v.studs) {
      const i = p.i + si, j = p.j + sj, above = p.b + v.h;
      if (above < CY && occ[(above * CZ + j) * CX + i] >= 0) continue;          // covered: the stud is inside the part above
      for (let z = 0; z < SX; z++) for (let x = 0; x < SX; x++) { const q = (yS * Z + oz + j * SX + z) * X + ox + i * SX + x; o[q] = Math.min(1, o[q] + STUD_COVER[z * SX + x]); }
    }
  }
  return { o, occ, missing };
}

export function fidelity(pieces, byKey, T, phase, opts = {}) {
  const { o, occ, missing } = rasterise(pieces, byKey, T, phase, opts), t = T.t;
  let mn = 0, mx = 0, l1 = 0, st = 0, vi = 0, vu = 0;
  for (let q = 0; q < t.length; q++) {
    const a = t[q], b = o[q]; mn += Math.min(a, b); mx += Math.max(a, b); l1 += Math.abs(a - b); st += a;
    const A = a > 0.5, B = b > 0.5; if (A && B) vi++; if (A || B) vu++;
  }
  // components through stud connections
  const [CX, CY, CZ] = T.cells, par = pieces.map((_, k) => k), find = (k) => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  // a part holds the part sitting on its studs (lego/post.js: the finish's rule, so the counts agree); studs from the piece record
  // (the finish) or from its variant
  pieces.forEach((p, k) => {
    const top = p.b + p.h; if (top >= CY || p.snot || !Number.isInteger(p.b) || !Number.isInteger(p.i) || !Number.isInteger(p.j)) return;
    const st = p.studs || (byKey.get(`${p.id}|${p.rot}`) || {}).studs || [];
    for (const [a, b] of st) { const i = p.i + a, j = p.j + b; if (i < 0 || j < 0 || i >= CX || j >= CZ) continue; const u = occ[(top * CZ + j) * CX + i]; if (u >= 0 && u !== k) par[find(u)] = find(k); }
  });
  const comps = new Set(pieces.map((_, k) => find(k))).size;
  const kinds = {}; for (const p of pieces) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  return { pieces: pieces.length, softIoU: mn / mx, l1: l1 / st, voxelIoU: vi / vu, components: comps, kinds, missing };
}
