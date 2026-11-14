// Vertex clustering with quadric placement (Lindstrom 2000, "out-of-core
// simplification"): one pass, O(n). Used before the edge-collapse decimator when
// the input is far denser than the target, and for the closing's winding mesh.

/** Cluster on a uniform grid of cell size c. Returns { V, F }. */
export function clusterQuadric(V, F, c) {
  const nv = V.length / 3, m = F.length / 3;
  let lx = Infinity, ly = Infinity, lz = Infinity;
  for (let i = 0; i < nv; i++) { lx = Math.min(lx, V[3 * i]); ly = Math.min(ly, V[3 * i + 1]); lz = Math.min(lz, V[3 * i + 2]); }
  // cell key -> cluster id via open addressing on 3 ints
  let cap = 1; while (cap < 2 * nv) cap <<= 1;
  const keys = new Int32Array(3 * cap), used = new Int32Array(cap).fill(-1);
  const cid = new Int32Array(nv);
  let nc = 0;
  for (let i = 0; i < nv; i++) {
    const ix = Math.floor((V[3 * i] - lx) / c), iy = Math.floor((V[3 * i + 1] - ly) / c), iz = Math.floor((V[3 * i + 2] - lz) / c);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
    while (used[h] >= 0 && !(keys[3 * h] === ix && keys[3 * h + 1] === iy && keys[3 * h + 2] === iz)) h = (h + 1) & (cap - 1);
    if (used[h] < 0) { used[h] = nc++; keys[3 * h] = ix; keys[3 * h + 1] = iy; keys[3 * h + 2] = iz; }
    cid[i] = used[h];
  }
  const Q = new Float64Array(10 * nc), S = new Float64Array(4 * nc); // quadric; position sum + count
  for (let i = 0; i < nv; i++) { const k = cid[i]; S[4 * k] += V[3 * i]; S[4 * k + 1] += V[3 * i + 1]; S[4 * k + 2] += V[3 * i + 2]; S[4 * k + 3]++; }
  const keep = new Uint8Array(m);
  for (let f = 0; f < m; f++) {
    const a = F[3 * f], b = F[3 * f + 1], d = F[3 * f + 2];
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2];
    const wx = V[3 * d] - V[3 * a], wy = V[3 * d + 1] - V[3 * a + 1], wz = V[3 * d + 2] - V[3 * a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) continue;
    const area = 0.5 * l; nx /= l; ny /= l; nz /= l;
    const dd = -(nx * V[3 * a] + ny * V[3 * a + 1] + nz * V[3 * a + 2]);
    const q = [nx * nx, nx * ny, nx * nz, nx * dd, ny * ny, ny * nz, ny * dd, nz * nz, nz * dd, dd * dd];
    const ca = cid[a], cb = cid[b], cd = cid[d];
    for (const k of new Set([ca, cb, cd])) for (let t = 0; t < 10; t++) Q[10 * k + t] += area * q[t];
    keep[f] = ca !== cb && cb !== cd && ca !== cd ? 1 : 0;
  }
  // representative: argmin of the cluster quadric, clamped near the cell
  const P = new Float64Array(3 * nc);
  for (let k = 0; k < nc; k++) {
    const mx = S[4 * k] / S[4 * k + 3], my = S[4 * k + 1] / S[4 * k + 3], mz = S[4 * k + 2] / S[4 * k + 3];
    const q = Q.subarray(10 * k, 10 * k + 10);
    // A x = -b with A = [[q0 q1 q2][q1 q4 q5][q2 q5 q7]], b = [q3 q6 q8]; regularise toward the mean
    const eps = 1e-3 * (q[0] + q[4] + q[7] + 1e-12);
    const a00 = q[0] + eps, a01 = q[1], a02 = q[2], a11 = q[4] + eps, a12 = q[5], a22 = q[7] + eps;
    const b0 = -q[3] + eps * mx, b1 = -q[6] + eps * my, b2 = -q[8] + eps * mz;
    const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
    let x = mx, y = my, z = mz;
    if (Math.abs(det) > 1e-18) {
      x = (b0 * (a11 * a22 - a12 * a12) - a01 * (b1 * a22 - a12 * b2) + a02 * (b1 * a12 - a11 * b2)) / det;
      y = (a00 * (b1 * a22 - a12 * b2) - b0 * (a01 * a22 - a12 * a02) + a02 * (a01 * b2 - b1 * a02)) / det;
      z = (a00 * (a11 * b2 - b1 * a12) - a01 * (a01 * b2 - b1 * a02) + b0 * (a01 * a12 - a11 * a02)) / det;
      // keep it within one cell of the vertex mean
      if (Math.abs(x - mx) > c || Math.abs(y - my) > c || Math.abs(z - mz) > c) { x = mx; y = my; z = mz; }
    }
    P[3 * k] = x; P[3 * k + 1] = y; P[3 * k + 2] = z;
  }
  // faces between three distinct clusters, without duplicates
  const seen = new Set(), out = [];
  for (let f = 0; f < m; f++) {
    if (!keep[f]) continue;
    const a = cid[F[3 * f]], b = cid[F[3 * f + 1]], d = cid[F[3 * f + 2]];
    const s = [a, b, d].sort((x, y) => x - y);
    const sk = nc < 200000 ? (s[0] * nc + s[1]) * nc + s[2] : `${s[0]},${s[1]},${s[2]}`;
    if (seen.has(sk)) continue;
    seen.add(sk); out.push(a, b, d);
  }
  return { V: P, F: Int32Array.from(out) };
}
