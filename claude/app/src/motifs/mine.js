// Motif mining: recurring groups of pieces in human-built models.
// A motif is the content of a window (W studs x D studs x H plates) of a model that (1) no piece crosses (every piece is either fully
// inside or fully outside), (2) touches no "unknown" cell (parts the engine cannot express), (3) holds >= 2 pieces, and (4) is tight
// (some piece touches each of its six faces). Its key is the sorted list of (part, rotation, offset) of its pieces, canonicalised
// over the four yaw rotations, so the same assembly is counted whatever its orientation in the model.
// The six window faces are tested with 2D prefix sums of "a piece straddles this plane here" / "a piece starts (ends) on this plane
// here", so a window costs a handful of lookups and a model costs ~1 s for all window sizes.
import { partFrames } from './placements.js';

export const DEFAULT_SIZES = (() => {
  const out = []; const WD = [1, 2, 3, 4, 5, 6, 8, 10, 12], H = [1, 2, 3, 4, 5, 6, 8, 9, 12];
  for (const w of WD) for (const d of WD) for (const h of H) if (w * d * h >= 2 && w * d * h <= 512) out.push([w, d, h]);
  return out;
})();

/** 3D prefix sum (dims nx, nz, nl; index (b * nz + j) * nx + i) -> array of (nl+1)*(nz+1)*(nx+1) */
function prefix3(src, nx, nz, nl) {
  const X = nx + 1, Z = nz + 1, P = new Int32Array((nl + 1) * Z * X);
  for (let b = 0; b < nl; b++) for (let j = 0; j < nz; j++) { let row = 0; for (let i = 0; i < nx; i++) { row += src[(b * nz + j) * nx + i]; P[((b + 1) * Z + j + 1) * X + i + 1] = row + P[((b + 1) * Z + j) * X + i + 1] + P[(b * Z + j + 1) * X + i + 1] - P[(b * Z + j) * X + i + 1]; } }
  return P;
}
const sum3 = (P, X, Z, i0, i1, j0, j1, b0, b1) => P[(b1 * Z + j1) * X + i1] - P[(b0 * Z + j1) * X + i1] - P[(b1 * Z + j0) * X + i1] - P[(b1 * Z + j1) * X + i0] + P[(b0 * Z + j0) * X + i1] + P[(b0 * Z + j1) * X + i0] + P[(b1 * Z + j0) * X + i0] - P[(b0 * Z + j0) * X + i0];

/** one parity class of a model as dense grids + prefix sums */
export function buildGrid(pieces, unknownBoxes, dims) {
  const [nx, nz, nl] = dims, N = nx * nz * nl, X = nx + 1, Z = nz + 1;
  const occ = new Int32Array(N), unk = new Uint8Array(N), nmin = new Int32Array(N);
  // straddle planes: sx[(b*nz+j)*X+i] = 1 if a piece covers both cell i-1 and cell i at (j, b); same for z (sz, nz+1 planes) and y (sy)
  const sx = new Uint8Array(nl * nz * X), sz = new Uint8Array(nl * Z * nx), sy = new Uint8Array((nl + 1) * nz * nx);
  const ax = new Uint8Array(nl * nz * X), ex = new Uint8Array(nl * nz * X);     // a piece starts / ends on plane i (ax[i] start at cell i, ex[i] end before cell i)
  const az = new Uint8Array(nl * Z * nx), ez = new Uint8Array(nl * Z * nx);
  const ay = new Uint8Array((nl + 1) * nz * nx), ey = new Uint8Array((nl + 1) * nz * nx);
  const cellPieces = new Map();
  pieces.forEach((p, k) => {
    const i0 = p.i, i1 = p.i + p.w, j0 = p.j, j1 = p.j + p.d, b0 = p.b, b1 = p.b + p.h;
    for (let b = b0; b < b1; b++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) occ[(b * nz + j) * nx + i]++;
    for (let b = b0; b < b1; b++) for (let j = j0; j < j1; j++) { for (let i = i0 + 1; i < i1; i++) sx[(b * nz + j) * X + i] = 1; ax[(b * nz + j) * X + i0] = 1; ex[(b * nz + j) * X + i1] = 1; }
    for (let b = b0; b < b1; b++) for (let i = i0; i < i1; i++) { for (let j = j0 + 1; j < j1; j++) sz[(b * Z + j) * nx + i] = 1; az[(b * Z + j0) * nx + i] = 1; ez[(b * Z + j1) * nx + i] = 1; }
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { for (let b = b0 + 1; b < b1; b++) sy[(b * nz + j) * nx + i] = 1; ay[(b0 * nz + j) * nx + i] = 1; ey[(b1 * nz + j) * nx + i] = 1; }
    const c = (b0 * nz + j0) * nx + i0; nmin[c]++;
    if (!cellPieces.has(c)) cellPieces.set(c, []); cellPieces.get(c).push(k);
  });
  for (const u of unknownBoxes) {
    const i0 = Math.max(0, Math.floor(u[0] + 1e-6)), i1 = Math.min(nx, Math.ceil(u[1] - 1e-6)), j0 = Math.max(0, Math.floor(u[2] + 1e-6)), j1 = Math.min(nz, Math.ceil(u[3] - 1e-6)), b0 = Math.max(0, Math.floor(u[4] + 1e-6)), b1 = Math.min(nl, Math.ceil(u[5] - 1e-6));
    for (let b = b0; b < b1; b++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) unk[(b * nz + j) * nx + i] = 1;
  }
  // prefix sums; the plane grids are 3D arrays too (one axis has +1), so prefix3 serves them with the matching dims
  return {
    nx, nz, nl, X, Z, cellPieces, pieces,
    Pocc: prefix3(occ, nx, nz, nl), Punk: prefix3(unk, nx, nz, nl), Pmin: prefix3(nmin, nx, nz, nl),
    Psx: prefix3(sx, X, nz, nl), Pax: prefix3(ax, X, nz, nl), Pex: prefix3(ex, X, nz, nl),
    Psz: prefix3(sz, nx, Z, nl), Paz: prefix3(az, nx, Z, nl), Pez: prefix3(ez, nx, Z, nl),
    Psy: prefix3(sy, nx, nz, nl + 1), Pay: prefix3(ay, nx, nz, nl + 1), Pey: prefix3(ey, nx, nz, nl + 1),
  };
}

/** enumerate clean, tight windows of the given sizes; calls onWindow(i0, j0, b0, w, d, h, pieceIdx[]) */
export function scanWindows(g, sizes, onWindow, { minFill = 0.4, minPieces = 2 } = {}) {
  const { nx, nz, nl, X, Z } = g;
  const X2 = X + 1, Z2 = Z + 1;       // prefix dims of the plane grids: x-planes have X cells along x -> prefix width X+1
  for (const [w, d, h] of sizes) {
    if (w > nx || d > nz || h > nl) continue;
    const box = w * d * h, minOcc = Math.max(minPieces, Math.ceil(minFill * box));
    for (let b0 = 0; b0 + h <= nl; b0++) for (let j0 = 0; j0 + d <= nz; j0++) for (let i0 = 0; i0 + w <= nx; i0++) {
      const i1 = i0 + w, j1 = j0 + d, b1 = b0 + h;
      if (sum3(g.Punk, X, Z, i0, i1, j0, j1, b0, b1)) continue;
      const o = sum3(g.Pocc, X, Z, i0, i1, j0, j1, b0, b1);
      if (o < minOcc) continue;
      if (sum3(g.Pmin, X, Z, i0, i1, j0, j1, b0, b1) < minPieces) continue;
      // no piece crosses a face: straddle sums on the 6 face planes are 0
      if (sum3(g.Psx, X2, Z, i0, i0 + 1, j0, j1, b0, b1) || sum3(g.Psx, X2, Z, i1, i1 + 1, j0, j1, b0, b1)) continue;
      if (sum3(g.Psz, X, Z2, i0, i1, j0, j0 + 1, b0, b1) || sum3(g.Psz, X, Z2, i0, i1, j1, j1 + 1, b0, b1)) continue;
      if (sum3(g.Psy, X, Z, i0, i1, j0, j1, b0, b0 + 1) || sum3(g.Psy, X, Z, i0, i1, j0, j1, b1, b1 + 1)) continue;
      // tight: a piece starts on the low face and one ends on the high face, on every axis
      if (!sum3(g.Pax, X2, Z, i0, i0 + 1, j0, j1, b0, b1) || !sum3(g.Pex, X2, Z, i1, i1 + 1, j0, j1, b0, b1)) continue;
      if (!sum3(g.Paz, X, Z2, i0, i1, j0, j0 + 1, b0, b1) || !sum3(g.Pez, X, Z2, i0, i1, j1, j1 + 1, b0, b1)) continue;
      if (!sum3(g.Pay, X, Z, i0, i1, j0, j1, b0, b0 + 1) || !sum3(g.Pey, X, Z, i0, i1, j0, j1, b1, b1 + 1)) continue;
      const idx = [];
      for (let b = b0; b < b1; b++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const l = g.cellPieces.get((b * nz + j) * nx + i); if (l) idx.push(...l); }
      if (idx.length < minPieces) continue;
      onWindow(i0, j0, b0, w, d, h, idx);
    }
  }
}

/** key of a group of pieces (relative offsets) in a W x D x H window, canonical over the 4 yaw rotations; returns { key, parts, w, d, h } */
export function canonicalKey(parts, w, d, h, frames) {
  let best = null;
  let cur = parts.map((p) => ({ ...p })), cw = w, cd = d;
  for (let r = 0; r < 4; r++) {
    const key = `${cw},${cd},${h}|` + cur.map((p) => `${p.id}:${p.rot}:${p.di},${p.dj},${p.db}`).sort().join(' ');
    if (best === null || key < best.key) best = { key, parts: cur.map((p) => ({ ...p })), w: cw, d: cd, h };
    // rotate the window by +90: (x, z) -> (z, W - x - w2); piece rot += 90 then canonicalised; footprint (w2, d2) -> (d2, w2)
    cur = cur.map((p) => { const fr = frames.get(p.id), rot = (p.rot + 90) % 360; return { id: p.id, rot: fr.canon[rot], di: p.dj, dj: cw - p.di - p.w2, db: p.db, w2: p.d2, d2: p.w2 }; });
    [cw, cd] = [cd, cw];
  }
  return best;
}

/** split a model's pieces into the 4 (x, z) half-stud parity classes; the other classes become unknown boxes in each class grid */
export function parityClasses(pieces, unknown, dims) {
  const cls = [[], [], [], []];
  for (const p of pieces) cls[((p.i % 1) ? 2 : 0) + ((p.j % 1) ? 1 : 0)].push(p);
  const out = [];
  for (let k = 0; k < 4; k++) {
    if (!cls[k].length) continue;
    const oi = k & 2 ? 0.5 : 0, oj = k & 1 ? 0.5 : 0;
    const ps = cls[k].map((p) => ({ ...p, i: p.i - oi, j: p.j - oj }));
    const unk = unknown.map((u) => [u[0] - oi, u[1] - oi, u[2] - oj, u[3] - oj, u[4], u[5]]);
    for (let m = 0; m < 4; m++) if (m !== k) for (const p of cls[m]) unk.push([p.i - oi, p.i + p.w - oi, p.j - oj, p.j + p.d - oj, p.b, p.b + p.h]);
    out.push({ pieces: ps, unknown: unk, dims: [Math.ceil(dims[0] + 1), Math.ceil(dims[1] + 1), dims[2]] });
  }
  return out;
}

/** accumulate the motifs of one model (already converted with placements.toGrid) into `acc` (Map key -> record) */
export function mineModel(grid, cat, acc, modelId, { sizes = DEFAULT_SIZES, minFill = 0.4, frames = partFrames(cat) } = {}) {
  let windows = 0;
  for (const cls of parityClasses(grid.pieces, grid.unknown, grid.dims)) {
    if (cls.pieces.length < 2) continue;
    const g = buildGrid(cls.pieces, cls.unknown, cls.dims);
    scanWindows(g, sizes, (i0, j0, b0, w, d, h, idx) => {
      windows++;
      const parts = idx.map((k) => { const p = cls.pieces[k]; return { id: p.id, rot: p.rot, di: p.i - i0, dj: p.j - j0, db: p.b - b0, w2: p.w, d2: p.d }; });
      const c = canonicalKey(parts, w, d, h, frames);
      let rec = acc.get(c.key);
      if (!rec) { rec = { w: c.w, d: c.d, h: c.h, parts: c.parts.map((p) => ({ id: p.id, rot: p.rot, i: p.di, j: p.dj, b: p.db })), n: 0, models: new Set() }; acc.set(c.key, rec); }
      rec.n++; rec.models.add(modelId);
    }, { minFill });
  }
  return windows;
}
