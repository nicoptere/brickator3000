// Generalised winding numbers on a lattice (from brickgen's decomp/closing.js, now brickpack's own: the target's
// inside / outside away from the surface). Jacobson et al. 2013; Barnes-Hut evaluation over a simplified copy of the surface.
import { BVH } from './bvh.js';
import { bbox, faceNormals } from './geom.js';
import { simplify } from './decimate.js';
import { clusterQuadric } from './cluster.js';

const hyp = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);

export function windingGrid(V, F, h, { stride = 3, evaluate = null, preDecimate = true, timings = null, beta = 1.5, preCluster = true } = {}) {
  const plan = windingGridPlan(V, F, h, { stride, preDecimate, timings, preCluster });
  const T2 = performance.now();
  let wq;
  if (evaluate) wq = evaluate(plan.Q, plan.WV, plan.WF, beta);
  else {
    const bvh = new BVH(plan.WV, plan.WF).prepareWinding(), Q = plan.Q;
    wq = new Float32Array(plan.nq);
    for (let q = 0; q < plan.nq; q++) wq[q] = bvh.winding(Q[3 * q], Q[3 * q + 1], Q[3 * q + 2], beta);
  }
  if (timings) timings.winding = performance.now() - T2;
  return windingGridFill(plan, wq, timings);
}

/**
 * The winding grid in two halves around its expensive part: windingGridPlan -> the query points Q (n x xyz) and the lighter
 * surface (WV, WF) whose winding numbers are wanted there (beta 1.5); windingGridFill(plan, wq) -> { W, dims, lo, h }. Lets a GPU
 * evaluate the queries (target.js).
 */
export function windingGridPlan(V, F, h, { stride = 3, preDecimate = true, timings = null, preCluster = true } = {}) {
  const T0 = performance.now();
  // 1. a lighter copy of the surface for the winding sum (edges ~ 1.5 h)
  let WV = V, WF = F;
  if (preDecimate) {
    const { A } = faceNormals(V, F);
    let area = 0; for (let i = 0; i < A.length; i++) area += A[i];
    const target = Math.round(area / (Math.sqrt(3) / 4 * (1.5 * h) ** 2));
    if (target < 0.8 * F.length / 3) {
      if (preCluster) ({ V: WV, F: WF } = clusterQuadric(V, F, 1.5 * h));
      else ({ V: WV, F: WF } = simplify(V, F, target));
    }
  }
  const T1 = performance.now();
  const { lo: blo, hi: bhi } = bbox(V);
  const lo = blo.map(x => x - 2 * h);
  // fine dims padded so that (n-1) is a multiple of the stride
  const dims = [0, 1, 2].map(k => {
    let n = Math.floor((bhi[k] + 2 * h - lo[k]) / h) + 1;
    return Math.ceil((n - 1) / stride) * stride + 1;
  });
  const [nx, ny, nz] = dims;
  const N = nx * ny * nz;
  const id = (i, j, k) => (k * ny + j) * nx + i;
  // 2-3. coarse cells crossed by the surface (triangle bbox + plane/box test)
  const cx = (nx - 1) / stride, cy = (ny - 1) / stride, cz = (nz - 1) / stride;
  const dirty = new Uint8Array(cx * cy * cz);
  const S = stride * h, half = S / 2 + 0.25 * h, mg = 0.25 * h;
  for (let f = 0; f < WF.length / 3; f++) {
    const a = 3 * WF[3 * f], b = 3 * WF[3 * f + 1], c = 3 * WF[3 * f + 2];
    const x0 = Math.min(WV[a], WV[b], WV[c]) - mg, x1 = Math.max(WV[a], WV[b], WV[c]) + mg;
    const y0 = Math.min(WV[a + 1], WV[b + 1], WV[c + 1]) - mg, y1 = Math.max(WV[a + 1], WV[b + 1], WV[c + 1]) + mg;
    const z0 = Math.min(WV[a + 2], WV[b + 2], WV[c + 2]) - mg, z1 = Math.max(WV[a + 2], WV[b + 2], WV[c + 2]) + mg;
    const ux = WV[b] - WV[a], uy = WV[b + 1] - WV[a + 1], uz = WV[b + 2] - WV[a + 2];
    const vx = WV[c] - WV[a], vy = WV[c + 1] - WV[a + 1], vz = WV[c + 2] - WV[a + 2];
    let px = uy * vz - uz * vy, py = uz * vx - ux * vz, pz = ux * vy - uy * vx;
    const pl = hyp(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const pd = px * WV[a] + py * WV[a + 1] + pz * WV[a + 2];
    const r = half * (Math.abs(px) + Math.abs(py) + Math.abs(pz));
    const a0 = Math.max(0, Math.floor((x0 - lo[0]) / S)), a1 = Math.min(cx - 1, Math.floor((x1 - lo[0]) / S));
    const b0 = Math.max(0, Math.floor((y0 - lo[1]) / S)), b1 = Math.min(cy - 1, Math.floor((y1 - lo[1]) / S));
    const c0 = Math.max(0, Math.floor((z0 - lo[2]) / S)), c1 = Math.min(cz - 1, Math.floor((z1 - lo[2]) / S));
    for (let cc = c0; cc <= c1; cc++) for (let bb = b0; bb <= b1; bb++) for (let aa = a0; aa <= a1; aa++) {
      const ox = lo[0] + (aa + 0.5) * S, oy = lo[1] + (bb + 0.5) * S, oz = lo[2] + (cc + 0.5) * S;
      if (Math.abs(px * ox + py * oy + pz * oz - pd) <= r) dirty[(cc * cy + bb) * cx + aa] = 1;
    }
  }
  // 4. the exact query set: coarse nodes + fine nodes of dirty cells
  const exact = new Uint8Array(N);
  for (let k = 0; k < nz; k += stride) for (let j = 0; j < ny; j += stride) for (let i = 0; i < nx; i += stride) exact[id(i, j, k)] = 1;
  for (let c = 0; c < cz; c++) for (let b = 0; b < cy; b++) for (let a = 0; a < cx; a++) {
    if (!dirty[(c * cy + b) * cx + a]) continue;
    for (let k = c * stride; k <= (c + 1) * stride; k++) for (let j = b * stride; j <= (b + 1) * stride; j++) {
      const o = (k * ny + j) * nx;
      exact.fill(1, o + a * stride, o + (a + 1) * stride + 1);
    }
  }
  let nq = 0;
  for (let n = 0; n < N; n++) nq += exact[n];
  const Q = new Float32Array(3 * nq), qi = new Int32Array(nq);
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n = id(i, j, k);
    if (!exact[n]) continue;
    Q[3 * q] = lo[0] + i * h; Q[3 * q + 1] = lo[1] + j * h; Q[3 * q + 2] = lo[2] + k * h; qi[q++] = n;
  }
  if (timings) { timings.predecimate = T1 - T0; timings.band = performance.now() - T1; timings.queries = nq; timings.nodes = N; timings.windingFaces = WF.length / 3; }
  return { Q, qi, nq, exact, WV, WF, dims, lo, h, stride, N, cx, cy, cz };
}

export function windingGridFill(plan, wq, timings = null) {
  const T3 = performance.now(), { qi, nq, exact, dims, lo, h, stride, N, cx, cy, cz } = plan, [nx, ny, nz] = dims;
  const id = (i, j, k) => (k * ny + j) * nx + i;
  const W = new Float32Array(N);
  for (let q = 0; q < nq; q++) W[qi[q]] = wq[q];
  // 6. fill clean cells by trilinear interpolation of the coarse lattice
  for (let k = 0; k < nz; k++) {
    const c = Math.min(cz - 1, Math.floor(k / stride)), fz = k / stride - c;
    for (let j = 0; j < ny; j++) {
      const b = Math.min(cy - 1, Math.floor(j / stride)), fy = j / stride - b;
      for (let i = 0; i < nx; i++) {
        const n = id(i, j, k);
        if (exact[n]) continue;
        const a = Math.min(cx - 1, Math.floor(i / stride)), fx = i / stride - a;
        const I0 = a * stride, J0 = b * stride, K0 = c * stride, s = stride;
        const w000 = W[id(I0, J0, K0)], w100 = W[id(I0 + s, J0, K0)], w010 = W[id(I0, J0 + s, K0)], w110 = W[id(I0 + s, J0 + s, K0)];
        const w001 = W[id(I0, J0, K0 + s)], w101 = W[id(I0 + s, J0, K0 + s)], w011 = W[id(I0, J0 + s, K0 + s)], w111 = W[id(I0 + s, J0 + s, K0 + s)];
        const x0 = w000 + fx * (w100 - w000), x1 = w010 + fx * (w110 - w010), x2 = w001 + fx * (w101 - w001), x3 = w011 + fx * (w111 - w011);
        const y0 = x0 + fy * (x1 - x0), y1 = x2 + fy * (x3 - x2);
        W[n] = y0 + fz * (y1 - y0);
      }
    }
  }
  if (timings) timings.interp = performance.now() - T3;
  return { W, dims, lo, h };
}
