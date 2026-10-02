// Uniform-grid nearest-neighbour index over 3D points (replaces scipy's cKDTree).
export class PointGrid {
  constructor(pts, cellsPerAxis = 48) {
    this.pts = pts; const n = pts.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pts.length; k += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pts[k + c]); hi[c] = Math.max(hi[c], pts[k + c]); }
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    this.h = ext / cellsPerAxis; this.lo = lo;
    this.dim = [0, 1, 2].map((c) => Math.max(1, Math.ceil((hi[c] - lo[c]) / this.h) + 1));
    const ncell = this.dim[0] * this.dim[1] * this.dim[2];
    const cnt = new Int32Array(ncell + 1), cellOf = new Int32Array(n);
    for (let k = 0; k < n; k++) { const c = this.cellIndex(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]); cellOf[k] = c; cnt[c + 1]++; }
    for (let c = 0; c < ncell; c++) cnt[c + 1] += cnt[c];
    const fill = cnt.slice(0, ncell), items = new Int32Array(n);
    for (let k = 0; k < n; k++) items[fill[cellOf[k]]++] = k;
    this.start = cnt; this.items = items;
  }
  coord(v, c) { return Math.min(this.dim[c] - 1, Math.max(0, Math.floor((v - this.lo[c]) / this.h))); }
  cellIndex(x, y, z) { return (this.coord(x, 0) * this.dim[1] + this.coord(y, 1)) * this.dim[2] + this.coord(z, 2); }
  /** indices + squared distances of the k nearest points */
  knn(x, y, z, k = 1, maxDist = Infinity) {
    const cx = this.coord(x, 0), cy = this.coord(y, 1), cz = this.coord(z, 2), P = this.pts;
    let best = []; // [d2, idx] sorted ascending, length <= k
    const maxR = Math.min(Math.max(...this.dim), Math.ceil(maxDist / this.h) + 1);
    for (let r = 0; r <= maxR; r++) {
      for (let a = cx - r; a <= cx + r; a++) {
        if (a < 0 || a >= this.dim[0]) continue;
        for (let b = cy - r; b <= cy + r; b++) {
          if (b < 0 || b >= this.dim[1]) continue;
          for (let c = cz - r; c <= cz + r; c++) {
            if (c < 0 || c >= this.dim[2]) continue;
            if (Math.max(Math.abs(a - cx), Math.abs(b - cy), Math.abs(c - cz)) !== r) continue;   // shell only
            const cell = (a * this.dim[1] + b) * this.dim[2] + c;
            for (let p = this.start[cell]; p < this.start[cell + 1]; p++) {
              const i = this.items[p], dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
              if (best.length < k || d2 < best[best.length - 1][0]) {
                best.push([d2, i]); best.sort((u, v) => u[0] - v[0]); if (best.length > k) best.pop();
              }
            }
          }
        }
      }
      // every unvisited point is at least r*h away from the query
      if (best.length === k && best[k - 1][0] <= (r * this.h) * (r * this.h)) break;
    }
    if (!best.length) best.push([maxDist * maxDist, -1]);
    return best;
  }
}
