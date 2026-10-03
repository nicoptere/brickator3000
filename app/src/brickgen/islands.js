// Islands of the source volume: decimating the tiny ones, and a minimum spanning tree of thin tubes that glue the
// rest together BEFORE the solver runs. These are two independent concerns behind two independent options
// (`decimate`, `islands`) that happen to share the same component labelling:
//
//  0. occupied voxels of the padded field (fill >= occ, or surface points splatted there) are labelled in 6-connected
//     components ("islands"); islands smaller than `islandDrop` (a fraction of the biggest) AND smaller than
//     `islandDropMax` (an absolute voxel count) are obliterated — noise, debris, stray non-manifold specks that are
//     not worth building and not worth a tube to. This is `decimateFloaters`, controlled by `o.decimate` alone.
//  1-3. if `o.islands` is also on, what's left (after decimation) gets joined: a multi-source Dijkstra floods the
//     empty voxels from every island at once (steps cost 1 in x / z, 2 in level = 4 / 4 / 8 LDU); where two floods
//     meet we get an edge between two islands (the cheapest per pair) = the geodesic Voronoi adjacency graph; Kruskal
//     on those edges = minimum spanning tree; each tree edge is traced back to both islands through the parent
//     pointers, which gives a thin 6-connected voxel path (2-4 LDU wide: one 4x4x8 LDU voxel, dilated one voxel when
//     tubeWidth >= 8). The tube voxels are written into the field (M = 1) and returned as a mask T; the solver
//     forces a 1x1 plate in every free stud cell crossed by T.
import { PLATE } from './constants.js';

const NB = [[1, 0, 0, 2], [-1, 0, 0, 2], [0, 1, 0, 1], [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1]];   // dl, dz, dx, cost

/** label 6-connected components of the occupied voxels and erase the tiny ones in place (M, P). Pure cleanup — no
 * tubes, independent of `o.islands`. Returns the surviving components' labelling, for `connectIslands` to reuse. */
export function decimateFloaters(M, P, nl, NZ, NX, o) {
  const N = nl * NZ * NX, plane = NZ * NX;
  const occ = new Uint8Array(N);
  const minPts = o.islandThinPoints ?? 2;
  for (let k = 0; k < N; k++) occ[k] = M[k] >= (o.islandOcc ?? 0.25) || P[k] >= minPts ? 1 : 0;

  // ---- components
  const lab = new Int32Array(N), stack = new Int32Array(N);
  const size = [0];
  let K = 0;
  for (let s = 0; s < N; s++) {
    if (!occ[s] || lab[s]) continue;
    K++; let sp = 0, cnt = 0; stack[sp++] = s; lab[s] = K;
    while (sp) {
      const v = stack[--sp]; cnt++;
      const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
      if (l > 0 && occ[v - plane] && !lab[v - plane]) { lab[v - plane] = K; stack[sp++] = v - plane; }
      if (l < nl - 1 && occ[v + plane] && !lab[v + plane]) { lab[v + plane] = K; stack[sp++] = v + plane; }
      if (z > 0 && occ[v - NX] && !lab[v - NX]) { lab[v - NX] = K; stack[sp++] = v - NX; }
      if (z < NZ - 1 && occ[v + NX] && !lab[v + NX]) { lab[v + NX] = K; stack[sp++] = v + NX; }
      if (x > 0 && occ[v - 1] && !lab[v - 1]) { lab[v - 1] = K; stack[sp++] = v - 1; }
      if (x < NX - 1 && occ[v + 1] && !lab[v + 1]) { lab[v + 1] = K; stack[sp++] = v + 1; }
    }
    size[K] = cnt;
  }
  const stats = { islands: K, dropped: 0, droppedVoxels: 0, tubes: 0, tubeVoxels: 0, largest: 0, islandsKept: K };
  if (!K) return { lab, occ, K2: 0, stats };
  let big = 0; for (let c = 1; c <= K; c++) big = Math.max(big, size[c]);
  stats.largest = big;

  if (o.decimate ?? true) {
    const drop = new Uint8Array(K + 1), remap = new Int32Array(K + 1);
    let K2 = 0;
    for (let c = 1; c <= K; c++) {
      if (size[c] < (o.islandDrop ?? 0.002) * big && size[c] < (o.islandDropMax ?? 40)) { drop[c] = 1; stats.dropped++; stats.droppedVoxels += size[c]; }
      else remap[c] = ++K2;
    }
    if (stats.dropped) for (let k = 0; k < N; k++) { const c = lab[k]; if (!c) continue; if (drop[c]) { lab[k] = 0; occ[k] = 0; M[k] = 0; P[k] = 0; } else lab[k] = remap[c]; }
    stats.islandsKept = K2;
    return { lab, occ, K2, stats };
  }
  return { lab, occ, K2: K, stats };
}

export function connectIslands(M, P, nl, NZ, NX, o) {
  const N = nl * NZ * NX, plane = NZ * NX;
  const { lab, occ, K2, stats } = decimateFloaters(M, P, nl, NZ, NX, o);
  const T = new Uint8Array(N);
  if (K2 <= 1) return { T, stats };

  // ---- 2. multi-source Dijkstra over the empty voxels (bucket queue)
  const INF = 1 << 30, dist = new Int32Array(N).fill(INF), par = new Int32Array(N).fill(-1), fl = new Int32Array(N);
  let buckets = [[]];
  const pushB = (c, v) => { while (buckets.length <= c) buckets.push([]); buckets[c].push(v); };
  for (let v = 0; v < N; v++) {
    if (!occ[v]) continue;
    dist[v] = 0; fl[v] = lab[v];
    const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
    const edge = l === 0 || l === nl - 1 || z === 0 || z === NZ - 1 || x === 0 || x === NX - 1 ||
      !occ[v - plane] || !occ[v + plane] || !occ[v - NX] || !occ[v + NX] || !occ[v - 1] || !occ[v + 1];
    if (edge) pushB(0, v);
  }
  // relax the 6 neighbours in NB order (same tie-breaks as the generic loop, without per-step allocation): +l, -l, +z, -z, +x, -x
  const relax = (n, nd, v) => { if (nd < dist[n]) { dist[n] = nd; par[n] = v; fl[n] = fl[v]; pushB(nd, n); } };
  for (let c = 0; c < buckets.length; c++) {
    const bk = buckets[c];
    for (let q = 0; q < bk.length; q++) {
      const v = bk[q]; if (dist[v] !== c) continue;
      const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
      if (l + 1 < nl && !occ[v + plane]) relax(v + plane, c + 2, v);
      if (l > 0 && !occ[v - plane]) relax(v - plane, c + 2, v);
      if (z + 1 < NZ && !occ[v + NX]) relax(v + NX, c + 1, v);
      if (z > 0 && !occ[v - NX]) relax(v - NX, c + 1, v);
      if (x + 1 < NX && !occ[v + 1]) relax(v + 1, c + 1, v);
      if (x > 0 && !occ[v - 1]) relax(v - 1, c + 1, v);
    }
    buckets[c] = null;
  }

  // ---- edges between floods
  const best = new Map();
  const edgeTo = (v, n, a, w) => { const b = fl[n]; if (!b || b === a) return; const wt = dist[v] + dist[n] + w, key = a < b ? a * (K2 + 1) + b : b * (K2 + 1) + a, e = best.get(key); if (!e || wt < e[0]) best.set(key, [wt, v, n, a, b]); };
  for (let v = 0; v < N; v++) {
    const a = fl[v]; if (!a) continue;
    const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
    if (l + 1 < nl) edgeTo(v, v + plane, a, 2);                      // each voxel pair once (+l, +z, +x)
    if (z + 1 < NZ) edgeTo(v, v + NX, a, 1);
    if (x + 1 < NX) edgeTo(v, v + 1, a, 1);
  }

  // ---- 3. Kruskal = MST
  const edges = [...best.values()].sort((p, q) => p[0] - q[0]);
  const uf = new Int32Array(K2 + 1); for (let c = 0; c <= K2; c++) uf[c] = c;
  const find = (c) => { while (uf[c] !== c) { uf[c] = uf[uf[c]]; c = uf[c]; } return c; };
  const trace = (v) => { while (v >= 0 && !occ[v]) { T[v] = 1; stats.tubeVoxels++; v = par[v]; } };
  for (const [wt, v, n, a, b] of edges) {
    const ra = find(a), rb = find(b); if (ra === rb) continue;
    uf[ra] = rb; stats.tubes++;
    trace(v); trace(n);
    stats.longest = Math.max(stats.longest || 0, wt * 4);
  }
  stats.components = 0; for (let c = 1; c <= K2; c++) if (find(c) === c) stats.components++;

  // ---- width: one voxel is 4 LDU; a requested width of 8 LDU or more dilates the tube by one voxel in x / z
  if ((o.tubeWidth ?? 4) >= 8) {
    const src = T.slice();
    for (let v = 0; v < N; v++) {
      if (!src[v]) continue;
      const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
      for (const [dl, dz, dx] of NB) { if (dl) continue; const Z = z + dz, X = x + dx; if (Z < 0 || Z >= NZ || X < 0 || X >= NX) continue; const n = (l * NZ + Z) * NX + X; if (!occ[n]) T[n] = 1; }
    }
  }
  for (let v = 0; v < N; v++) if (T[v]) { M[v] = 1; }
  return { T, stats };
}

/** or-mirror of a tube mask about the plane at c2 * STUD / 2 (same index mapping as grid.symmetrize) */
export function mirrorMask(T, nl, nz, nx, ax, c2, G) {
  const out = T.slice();
  for (let l = 0; l < nl; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const idx = (l * nz + z) * nx + x; if (!T[idx]) continue;
    if (ax === 0) { const xm = G * c2 - 1 - x; if (xm >= 0 && xm < nx) out[(l * nz + z) * nx + xm] = 1; }
    else { const zm = G * c2 - 1 - z; if (zm >= 0 && zm < nz) out[(l * nz + zm) * nx + x] = 1; }
  }
  return out;
}
export const TUBE_LEVEL = PLATE;
