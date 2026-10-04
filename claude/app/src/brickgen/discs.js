// Disc layers: where a plate level's cross-section is a circle, build that level the way a builder does - rows of plates along the
// Bresenham outline, the rows turned 90 degrees on every other level so the layers interlock - instead of letting the greedy fill
// tile it into an irregular patchwork with fragments along the edge. Phase 'A1-disc' in run.js, option `discs`.
//
// The greedy fill and this recipe give the same OUTLINE (a cell is inside when its centre is); the difference is the pattern:
// regular rows with no 1x1s inside them, and every plate crossing several plates of the layer below. Detection is a circle fit
// (Kasa's algebraic least squares) on the boundary cells of each solid component of the level, accepted when the component is
// round enough (IoU of the cell set against the fitted disc, and the rms distance of the boundary cells to the circle).
// `discsExposed` restricts the recipe to layers whose top is at least partly exposed - what a round table top or a bowl's rim is -
// so that the skin phases keep the sloped caps of a sphere, where slopes and curved parts do the work.
import { G } from './constants.js';

/** cell-level fill of a level: mean of the 25 samples */
function cellFill(S, l, M = S.M) {
  const NX = S.NXc, NZ = S.NZc, out = new Float32Array(NX * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    let s = 0;
    for (let dz = 0; dz < G; dz++) { const base = S.idx(l, z * G + dz, x * G); for (let dx = 0; dx < G; dx++) s += M[base + dx]; }
    out[z * NX + x] = s / (G * G);
  }
  return out;
}

/** 4-connected components of cells with fill >= thr: array of arrays of [x, z] */
function components(F, NX, NZ, thr) {
  const seen = new Uint8Array(NX * NZ), out = [];
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const k = z * NX + x; if (seen[k] || F[k] < thr) continue;
    const comp = [], stack = [k]; seen[k] = 1;
    while (stack.length) {
      const c = stack.pop(), cz = (c / NX) | 0, cx = c - cz * NX; comp.push([cx, cz]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = cx + dx, Z = cz + dz; if (X < 0 || X >= NX || Z < 0 || Z >= NZ) continue;
        const q = Z * NX + X; if (!seen[q] && F[q] >= thr) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Kasa circle fit of points (cell centres): returns { cx, cz, R, rms } or null */
export function fitCircle(pts) {
  // minimise sum (x^2 + z^2 + D x + E z + F)^2 - a 3x3 linear system
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, n = pts.length, bx = 0, bz = 0, b0 = 0;
  for (const [x, z] of pts) { const r = x * x + z * z; sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; bx += r * x; bz += r * z; b0 += r; }
  const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], B = [-bx, -bz, -b0];
  // Gaussian elimination
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
    if (Math.abs(A[i][i]) < 1e-9) return null;
    for (let r = i + 1; r < 3; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c]; B[r] -= f * B[i]; }
  }
  const X = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = B[i]; for (let c = i + 1; c < 3; c++) s -= A[i][c] * X[c]; X[i] = s / A[i][i]; }
  const cx = -X[0] / 2, cz = -X[1] / 2, R2 = cx * cx + cz * cz - X[2]; if (R2 <= 0) return null;
  const R = Math.sqrt(R2); let e = 0; for (const [x, z] of pts) { const d = Math.hypot(x - cx, z - cz) - R; e += d * d; }
  return { cx, cz, R, rms: Math.sqrt(e / n) };
}

/** split a run of n cells into catalogue plate lengths, longest first but never leaving a lone 1 when it can be avoided (7 = 4 + 3, 5 = 3 + 2) */
function splitRun(n, lengths) {
  const out = [];
  while (n > 0) {
    let L = lengths.find((l) => l <= n);
    if (n - L === 1 && L > 2) L = lengths.find((l) => l <= n - 2) ?? L;      // leave a 2 rather than a 1
    out.push(L); n -= L;
  }
  return out;
}

/**
 * place disc layers. cat: the catalogue (for the 1xN plates); opts: { minR, tol, iou, exposed }. Returns { layers, pieces }.
 */
export function placeDiscs(S, cat, variants, o, log = () => {}) {
  const NX = S.NXc, NZ = S.NZc, NL = S.NL;
  const minR = o.discMinR ?? 2, tolRms = o.discRms ?? 0.45, minIoU = o.discIoU ?? 0.85, exposedOnly = o.discsExposed ?? true;
  // 1 x N plates of the analytic catalogue, by length, as solver variants (rot 0 = along x, rot 90 = along z)
  const plates = {}; for (const v of variants) if (v.c.kind === 'plate' && v.c.source === 'analytic' && v.h === 1 && (v.d === 1 || v.w === 1)) { const L = Math.max(v.w, v.d); if (L === 1) plates[1] = { x: v, z: v }; else (plates[L] ||= {})[v.w >= v.d ? 'x' : 'z'] = v; }
  const lengths = Object.keys(plates).map(Number).filter((L) => plates[L].x && plates[L].z).sort((a, b) => b - a);
  if (!lengths.length) return { layers: 0, pieces: 0 };
  const any = { min_cov: 0, max_err: 1, piece_pen: 0 };
  let layers = 0, pieces = 0;
  for (let l = 0; l < NL; l++) {
    // the layer itself from the remaining field; what is above it from the FULL solid (a crust-carved interior is not exposure)
    const F = cellFill(S, l), above = l + 1 < NL ? cellFill(S, l + 1, S.Mfull || S.M0) : null;
    for (const comp of components(F, NX, NZ, 0.5)) {
      if (comp.length < Math.PI * minR * minR * 0.8) continue;
      const set = new Set(comp.map(([x, z]) => z * NX + x));
      // the OUTER outline: a hollowed model (crust) makes every cross-section a ring, so holes are filled before the fit - cells of
      // the component's bounding box that cannot be reached from its border without crossing the component
      let x0 = NX, x1 = -1, z0 = NZ, z1 = -1; for (const [x, z] of comp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const W = x1 - x0 + 3, H = z1 - z0 + 3, outside = new Uint8Array(W * H), stack = [0]; outside[0] = 1;
      while (stack.length) { const c = stack.pop(), cz = (c / W) | 0, cx = c - cz * W; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = cx + dx, Z = cz + dz; if (X < 0 || X >= W || Z < 0 || Z >= H) continue; const q = Z * W + X; if (outside[q] || set.has((Z + z0 - 1) * NX + X + x0 - 1)) continue; outside[q] = 1; stack.push(q); } }
      const filled = new Set(); for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!outside[z * W + x]) filled.add((z + z0 - 1) * NX + x + x0 - 1);
      const boundary = []; for (const k of filled) { const z = (k / NX) | 0, x = k - z * NX; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !filled.has((z + dz) * NX + x + dx))) boundary.push([x, z]); }
      const fit = fitCircle(boundary.map(([x, z]) => [x + 0.5, z + 0.5])); if (!fit || fit.R < minR || fit.rms > tolRms) continue;
      // roundness: the cells whose centre lies inside the fitted circle vs the filled component
      let inter = 0, disc = 0;
      for (let z = Math.max(0, Math.floor(fit.cz - fit.R - 1)); z <= Math.min(NZ - 1, Math.ceil(fit.cz + fit.R + 1)); z++) for (let x = Math.max(0, Math.floor(fit.cx - fit.R - 1)); x <= Math.min(NX - 1, Math.ceil(fit.cx + fit.R + 1)); x++) {
        if (Math.hypot(x + 0.5 - fit.cx, z + 0.5 - fit.cz) <= fit.R) { disc++; if (filled.has(z * NX + x)) inter++; }
      }
      const iou = inter / (disc + filled.size - inter); if (iou < minIoU) continue;
      // exposed gate: the recipe is for plateaus (a table top, the top of a cylinder, the flat cap of a dome), not for the sloped
      // flank of a sphere - there every layer shows a thin ring and rows of plates would build a staircase where a slope part does
      // better. The ring's mean width in studs = exposed cells / outline length; `discRing` studs or more qualifies (default 1.5)
      let ring = Infinity;
      if (above) { let exp = 0; for (const [x, z] of comp) if (above[z * NX + x] < 0.5) exp++; ring = exp / boundary.length; if (exposedOnly && (exp < 0.15 * comp.length || ring < (o.discRing ?? 1.5))) continue; }
      // the recipe: rows along x on even levels, along z on odd ones, over the component's own cells (not the ideal disc: the
      // outline stays what the field says, the fit only decided that this is a disc)
      const alongX = l % 2 === 0, rows = new Map();
      for (const [x, z] of comp) { const key = alongX ? z : x, pos = alongX ? x : z; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(pos); }
      let placed = 0;
      for (const [key, cells] of rows) {
        cells.sort((a, b) => a - b);
        let s = 0;
        while (s < cells.length) {
          let e = s; while (e + 1 < cells.length && cells[e + 1] === cells[e] + 1) e++;        // a contiguous run
          let at = cells[s];
          for (const L of splitRun(e - s + 1, lengths)) {
            const v = alongX ? plates[L].x : plates[L].z, i = alongX ? at : key, j = alongX ? key : at;
            const r = S.evaluate(v, l, j, i, any);
            if (r) { S.place(v, l, j, i, r[1], r[2], 'A1-disc'); placed++; }
            at += L;
          }
          s = e + 1;
        }
      }
      if (placed) { layers++; pieces += placed; log(`disc layer at level ${l}: R ${fit.R.toFixed(1)} studs at (${fit.cx.toFixed(1)}, ${fit.cz.toFixed(1)}), ${comp.length} cells, iou ${iou.toFixed(2)}, ring ${ring.toFixed(1)}, ${placed} plates ${alongX ? 'along x' : 'along z'}`); }
    }
  }
  return { layers, pieces };
}
