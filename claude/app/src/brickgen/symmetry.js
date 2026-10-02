// Mirror-symmetry detection: reflect surface samples about vertical planes x = c / z = c and measure the mean distance to the surface.
import { PointGrid } from './nn.js';
import { mulberry32 } from './mesh.js';

export function detectSymmetry(pts, n = 4000, seed = 0) {
  const N = pts.length / 3, rng = mulberry32(seed + 7);
  const idx = Array.from({ length: Math.min(n, N) }, () => Math.floor(rng() * N));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < pts.length; k += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pts[k + c]); hi[c] = Math.max(hi[c], pts[k + c]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const grid = new PointGrid(pts, 64), out = [], cap = 0.05 * diag;   // distances capped: a clearly asymmetric plane need not be measured exactly
  const meanErr = (ax, c, set) => {
    let sum = 0;
    for (const i of set) {
      const q = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]; q[ax] = 2 * c - q[ax];
      sum += Math.min(cap, Math.sqrt(grid.knn(q[0], q[1], q[2], 1, cap)[0][0]));
    }
    return sum / set.length / diag;
  };
  const coarse = idx.slice(0, 600);
  for (const ax of [0, 2]) {                 // coarse scan of 13 plane positions, then the best one measured with all samples
    const c0 = (lo[ax] + hi[ax]) / 2, ext = hi[ax] - lo[ax]; let bc = c0, be = Infinity;
    for (let s = 0; s < 13; s++) { const c = c0 + (-0.03 + 0.005 * s) * ext, e = meanErr(ax, c, coarse); if (e < be) { be = e; bc = c; } }
    out.push({ axis: ax === 0 ? 'x' : 'z', ax, plane: bc, err: meanErr(ax, bc, idx) });
  }
  return out.sort((a, b) => a.err - b.err);
}
