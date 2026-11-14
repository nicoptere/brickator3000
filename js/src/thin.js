// Thin features: a minimum LEGO thickness for the parts of the mesh no part could represent at this scale.
//
// The packer maximises the overlap of parts with the mesh's exact volume. A wing, a sail, a leg or a mast thinner than a plate
// holds too little volume for any part to pay off: the best fit leaves it out, and the build loses it. Here the target is
// thickened where the mesh is thin, to what the smallest part can show - a plate vertically (8 LDU), a stud horizontally
// (20 LDU) - and only along the thin axes, so that a sheet becomes a plate-thick sheet, a wall a one-stud wall, a rod a column of
// 1 x 1 parts. The fit stays measured against the original volume (engine.js).
//
// On the target's 4 LDU sub-voxels (x, z: 5 per stud, y: 2 per plate):
//   material M   = the solid (coverage >= 1/2) and the band around the surface (a sub-voxel the surface passes through: open
//                  sheets with no inside, and features thinner than a sub-voxel, exist only there)
//   core O       = where a plate-sized box (5 x 3 x 5) fits inside M and is at least half filled: what parts can represent as it
//                  is; thin = M away from it (by half a box: the surface band of a body is not thin)
//   thin along a = a thin sub-voxel whose run of M along axis a is shorter than the part's size along a (x, z 5, y 2), or holds
//                  less than half a part's worth of coverage (a sheet's surface band is often a plate thick while the sheet is far
//                  thinner): the axes along which it is thinner than a part (a slope or the rim of a round body: none of them)
//   features     = connected thin regions at least `minLen` long (2 studs): legs, masts, struts, sails, wings. A short thin bit
//                  is left to the fit. And only on a model at least `minModel` studs on its smallest side (4): below that the
//                  "thin" parts are as large as the model itself, and the plain fit gives the cleaner little sculpture; nor under
//                  `smallModel` (8) when the thickening would add more than the model's own volume
//   thickened    = per sub-voxel of a feature, along each thin axis the cell that holds the middle of its run: the plate cell
//                  along y (levels of 2 sub-voxels), the stud cell along x / z on the grid phase the build will use (the phase is
//                  returned and the engine packs on it); coverage 1 there. Whole cells, so a 1 x 1 part fills them exactly and the
//                  sub-voxels of one feature agree on them (a rod becomes one column, not a smear across two).
//
// What it does not know: a wire is a rod like a leg. Rigging and bracing wires (a ship, a biplane's trusses) are thickened too,
// and at a scale where they come close together they fill in. The Studio's "Keep thin parts" switch turns it off.
import { SX, SY } from './units.js';
import { choosePhase } from './pack.js';

// 1-D passes along one axis of an (X, Y, Z) grid, index (y * Z + z) * X + x
function lines(X, Y, Z, axis, fn) {
  const n = axis === 0 ? X : axis === 1 ? Y : Z, step = axis === 0 ? 1 : axis === 1 ? X * Z : X;
  if (axis === 0) { for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) fn((y * Z + z) * X, step, n); }
  else if (axis === 1) { for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) fn(z * X + x, step, n); }
  else { for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) fn(y * Z * X + x, step, n); }
}
/** out[v] = 1 iff A is 1 on the whole window [v + lo, v + hi] along the axis (outside the grid counts as 0) */
function allIn(A, X, Y, Z, axis, lo, hi) {
  const out = new Uint8Array(A.length), buf = new Int32Array(Math.max(X, Y, Z) + 1);
  lines(X, Y, Z, axis, (o, step, n) => {
    buf[0] = 0; for (let k = 0; k < n; k++) buf[k + 1] = buf[k] + A[o + k * step];          // prefix sums along the line
    for (let k = 0; k < n; k++) { const a = k + lo, b = k + hi; if (a >= 0 && b < n && buf[b + 1] - buf[a] === b - a + 1) out[o + k * step] = 1; }
  });
  return out;
}
/** out[v] = 1 iff A is 1 somewhere on [v + lo, v + hi] along the axis */
function anyIn(A, X, Y, Z, axis, lo, hi) {
  const out = new Uint8Array(A.length), buf = new Int32Array(Math.max(X, Y, Z) + 1);
  lines(X, Y, Z, axis, (o, step, n) => {
    buf[0] = 0; for (let k = 0; k < n; k++) buf[k + 1] = buf[k] + A[o + k * step];
    for (let k = 0; k < n; k++) { const a = Math.max(0, k + lo), b = Math.min(n - 1, k + hi); if (b >= a && buf[b + 1] - buf[a] > 0) out[o + k * step] = 1; }
  });
  return out;
}
/** per sub-voxel of A, the length of the run of A through it along the axis (0 outside A), and the run's start */
function runs(A, X, Y, Z, axis) {
  const len = new Int32Array(A.length), start = new Int32Array(A.length);
  lines(X, Y, Z, axis, (o, step, n) => {
    for (let k = 0; k < n;) {
      if (!A[o + k * step]) { k++; continue; }
      let e = k; while (e < n && A[o + e * step]) e++;
      for (let q = k; q < e; q++) { len[o + q * step] = e - k; start[o + q * step] = k; }
      k = e;
    }
  });
  return { len, start };
}
/** out[v] = the sum of A over the window [v, v + n - 1] along the axis (outside the grid counts as 0) */
function sumIn(A, X, Y, Z, axis, n) {
  const out = new Float32Array(A.length), buf = new Float64Array(Math.max(X, Y, Z) + 1);
  lines(X, Y, Z, axis, (o, step, len) => {
    buf[0] = 0; for (let k = 0; k < len; k++) buf[k + 1] = buf[k] + A[o + k * step];
    for (let k = 0; k < len; k++) out[o + k * step] = buf[Math.min(len, k + n)] - buf[k];
  });
  return out;
}
/** per sub-voxel, the coverage summed over its run (runs() r) along the axis */
function mass(t, r, X, Y, Z, axis) {
  const out = new Float32Array(t.length);
  lines(X, Y, Z, axis, (o, step, n) => {
    for (let k = 0; k < n;) {
      const v = o + k * step, len = r.len[v]; if (!len) { k++; continue; }
      let s = 0; for (let q = k; q < k + len; q++) s += t[o + q * step];
      for (let q = k; q < k + len; q++) out[o + q * step] = s;
      k += len;
    }
  });
  return out;
}
/** first sub-voxel of the cell of width w (cells from offset o, n of them) that holds position c */
const cellStart = (c, o, w, n) => o + w * Math.min(n - 1, Math.max(0, Math.floor((c - o) / w)));

/**
 * The thickened coverage of target T (target.js: T.t, T.band). Returns { t (Float32Array, max of T.t and the thickening; T.t
 * itself when nothing is thin), added (sub-voxels raised), thin (sub-voxels found thin), features, phase ([ox, oz], the grid
 * phase the cells are on; null on a model under minModel, flagged small), ms }. Sizes in sub-voxels: { bx: 5, by: 3, bz: 5 } for
 * the core test, { wx: 5, wy: 2, wz: 5 } for the thickness to reach. phase: the grid phase to snap to (default: chosen here).
 */
export function thickenThin(T, { bx = SX, by = 3, bz = SX, wx = SX, wy = SY, wz = SX, minLen = 2 * SX, minModel = 4 * SX, smallModel = 8 * SX, phase = null } = {}) {
  const t0 = Date.now(), { X, Y, Z } = T, N = X * Y * Z, t = T.t, band = T.band, [CX, CY, CZ] = T.cells;
  const M = new Uint8Array(N); for (let i = 0; i < N; i++) M[i] = t[i] >= 0.5 || (band && band[i]) ? 1 : 0;
  // the model's smallest side, in sub-voxels (4 LDU on every axis)
  let l0 = X, l1 = Y, l2 = Z, h0 = -1, h1 = -1, h2 = -1;
  for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) if (M[(y * Z + z) * X + x]) { if (x < l0) l0 = x; if (x > h0) h0 = x; if (y < l1) l1 = y; if (y > h1) h1 = y; if (z < l2) l2 = z; if (z > h2) h2 = z; }
  const side = Math.min(h0 - l0, h1 - l1, h2 - l2) + 1;
  if (side < minModel) return { t, added: 0, thin: 0, features: 0, small: true, phase: null, ms: Date.now() - t0 };
  // the grid phase the build will use (pack.js choosePhase on the mesh's own volume, the default part cost): the stud cells the
  // thickening snaps to. The engine hands it to the packer, which would otherwise choose one on the thickened target
  const [ox, oz] = phase || choosePhase(T, t, 3, 0.5);
  // core: the opening of M by the box (where the box fits: allIn forward windows; the union of those boxes: anyIn backward),
  // the box at least half filled (sumIn): a sheet's surface band can be 3 sub-voxels thick, and a box fits in it
  let F = allIn(M, X, Y, Z, 0, 0, bx - 1); F = allIn(F, X, Y, Z, 1, 0, by - 1); F = allIn(F, X, Y, Z, 2, 0, bz - 1);
  const W = sumIn(sumIn(sumIn(t, X, Y, Z, 0, bx), X, Y, Z, 1, by), X, Y, Z, 2, bz), half = (bx * by * bz) / 2;
  for (let i = 0; i < N; i++) if (F[i] && W[i] < half) F[i] = 0;
  let O = anyIn(F, X, Y, Z, 0, -(bx - 1), 0); O = anyIn(O, X, Y, Z, 1, -(by - 1), 0); O = anyIn(O, X, Y, Z, 2, -(bz - 1), 0);
  // ... and a margin of half a box around it: slivers along the surface of a body are not thin features
  const hx = bx >> 1, hy = by >> 1, hz = bz >> 1;
  let C = anyIn(O, X, Y, Z, 0, -hx, hx); C = anyIn(C, X, Y, Z, 1, -hy, hy); C = anyIn(C, X, Y, Z, 2, -hz, hz);
  const rx = runs(M, X, Y, Z, 0), ry = runs(M, X, Y, Z, 1), rz = runs(M, X, Y, Z, 2);
  // the thin sub-voxels and the axes they are thin along (bits x 1, y 2, z 4)
  const ax = new Uint8Array(N);
  // thin along an axis: a run shorter than the part, or holding less than half a part's worth of coverage (a sheet's surface
  // band is often a plate thick while the sheet itself is far thinner)
  const mx = mass(t, rx, X, Y, Z, 0), my = mass(t, ry, X, Y, Z, 1), mz = mass(t, rz, X, Y, Z, 2);
  for (let v = 0; v < N; v++) if (M[v] && !C[v]) ax[v] = (rx.len[v] < wx || mx[v] < wx / 2 ? 1 : 0) | (ry.len[v] < wy || my[v] < wy / 2 ? 2 : 0) | (rz.len[v] < wz || mz[v] < wz / 2 ? 4 : 0);
  // connected thin regions (26-neighbours) and their extent: only the long ones are features
  const lab = new Int32Array(N).fill(-1), keep = [], queue = new Int32Array(N); let nl = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!ax[s0] || lab[s0] >= 0) continue;
    let qh = 0, qt = 0, lo0 = X, lo1 = Y, lo2 = Z, hi0 = -1, hi1 = -1, hi2 = -1; queue[qt++] = s0; lab[s0] = nl;
    while (qh < qt) {
      const v = queue[qh++], x = v % X, z = ((v / X) | 0) % Z, y = (v / (X * Z)) | 0;
      if (x < lo0) lo0 = x; if (x > hi0) hi0 = x; if (y < lo1) lo1 = y; if (y > hi1) hi1 = y; if (z < lo2) lo2 = z; if (z > hi2) hi2 = z;
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, zz = z + dz; if (xx < 0 || yy < 0 || zz < 0 || xx >= X || yy >= Y || zz >= Z) continue;
        const u = (yy * Z + zz) * X + xx; if (ax[u] && lab[u] < 0) { lab[u] = nl; queue[qt++] = u; }
      }
    }
    keep.push(Math.max(hi0 - lo0, hi1 - lo1, hi2 - lo2) + 1 >= minLen); nl++;
  }
  const out = Float32Array.from(t); let added = 0, thin = 0, features = 0;
  for (const k of keep) if (k) features++;
  for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    const v = (y * Z + z) * X + x;
    if (!ax[v] || !keep[lab[v]]) continue;
    const tx = (ax[v] & 1) !== 0, ty = (ax[v] & 2) !== 0, tz = (ax[v] & 4) !== 0;
    thin++;
    // the box this sub-voxel needs: along each thin axis the cell holding the middle of its run (the plate cell along y, the stud
    // cell at the build's grid phase along x / z), so the sub-voxels of a feature agree on whole cells
    const y0 = ty ? cellStart(ry.start[v] + ry.len[v] / 2, 0, wy, CY) : y, y1 = ty ? Math.min(Y - 1, y0 + wy - 1) : y;
    const x0 = tx ? cellStart(rx.start[v] + rx.len[v] / 2, ox, wx, CX) : x, x1 = tx ? Math.min(X - 1, x0 + wx - 1) : x;
    const z0 = tz ? cellStart(rz.start[v] + rz.len[v] / 2, oz, wz, CZ) : z, z1 = tz ? Math.min(Z - 1, z0 + wz - 1) : z;
    for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
      const u = (yy * Z + zz) * X + xx; if (out[u] < 1) { out[u] = 1; added++; }
    }
  }
  // a small model whose thin features would outweigh it (more added than its own volume): they are as large as the model, and
  // the plain fit gives the cleaner little sculpture (a dragon at 4 studs: its claws and horns would double it)
  if (side < smallModel) { let vol = 0; for (let i = 0; i < N; i++) vol += t[i]; if (added > vol) return { t, added: 0, thin: 0, features: 0, small: true, phase: null, ms: Date.now() - t0 }; }
  return { t: out, added, thin, features, phase: [ox, oz], ms: Date.now() - t0 };
}
