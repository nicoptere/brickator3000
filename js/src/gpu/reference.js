// The GPU kernels in plain JavaScript, over exactly the packed buffers the shaders read (index.js packBVH / packDeficits): a
// backend for tests (node has neither WebGPU nor WebGL2) that checks the packing, the indexing and the async pipeline. Not for
// speed. Same interface as webgpu.js / webgl2.js.
const leafTris = (tris, k) => [3 * k, 3 * k + 1, 3 * k + 2].map((r) => [tris[4 * r], tris[4 * r + 1], tris[4 * r + 2]]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = (a) => Math.sqrt(dot(a, a));

function pointTri2(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp), cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  let q;
  if (d3 >= 0 && d4 <= d3) q = b;
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  else if (d6 >= 0 && d5 <= d6) q = c;
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
  else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
  const e = sub(p, q); return dot(e, e);
}

function winding(N, tris, q, beta) {
  const st = [0]; let w = 0;
  while (st.length) {
    const o = 32 * st.pop(), c = [N[o], N[o + 1], N[o + 2]], d = sub(c, q), d2 = dot(d, d), r = beta * N[o + 3];
    if (d2 > r * r) {
      const dn = Math.sqrt(d2), i3 = 1 / (d2 * dn), i5 = i3 / d2, M = (k) => N[o + 8 + k];
      const xMx = d[0] * (M(0) * d[0] + M(1) * d[1] + M(2) * d[2]) + d[1] * (M(3) * d[0] + M(4) * d[1] + M(5) * d[2]) + d[2] * (M(6) * d[0] + M(7) * d[1] + N[o + 16] * d[2]);
      w += (d[0] * N[o + 4] + d[1] * N[o + 5] + d[2] * N[o + 6]) * i3 + N[o + 7] * i3 - 3 * xMx * i5;
      continue;
    }
    if (N[o + 17] < 0) {
      for (let k = N[o + 19], e = k + N[o + 20]; k < e; k++) {
        const [A, B, C] = leafTris(tris, k), a = sub(A, q), b = sub(B, q), cc = sub(C, q), la = len(a), lb = len(b), lc = len(cc);
        w += 2 * Math.atan2(dot(a, cross(b, cc)), la * lb * lc + dot(a, b) * lc + dot(b, cc) * la + dot(cc, a) * lb);
      }
    } else st.push(N[o + 18], N[o + 17]);
  }
  return w / (4 * Math.PI);
}

function nearest(N, tris, q, bound2) {
  const boxD2 = (n) => { const o = 32 * n; let s = 0; for (let a = 0; a < 3; a++) { const d = Math.max(N[o + 24 + a] - q[a], 0, q[a] - N[o + 28 + a]); s += d * d; } return s; };
  const st = [0]; let best = bound2;
  while (st.length) {
    const n = st.pop(), o = 32 * n;
    if (boxD2(n) >= best) continue;
    if (N[o + 17] < 0) for (let k = N[o + 19], e = k + N[o + 20]; k < e; k++) best = Math.min(best, pointTri2(q, ...leafTris(tris, k)));
    else { const l = N[o + 17], r = N[o + 18]; if (boxD2(l) < boxD2(r)) st.push(r, l); else st.push(l, r); }
  }
  return best;
}

export function create() {
  return {
    kind: 'reference', label: 'reference (JavaScript)', software: true,
    async bvhQuery(packed, pts, { beta = 0, bound2 = 0 } = {}) {
      const n = pts.length / 4, w = new Float32Array(n), d2 = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const q = [pts[4 * i], pts[4 * i + 1], pts[4 * i + 2]];
        if (beta > 0) w[i] = winding(packed.nodes, packed.tris, q, beta);
        if (bound2 > 0) d2[i] = nearest(packed.nodes, packed.tris, q, bound2);
      }
      return { w, d2 };
    },
    async deficitSums(w, table, pairs) {
      const out = new Float32Array(pairs.n);
      for (let p = 0; p < pairs.n; p++) {
        const v = pairs.vi[p], o = table.info[2 * v], c = table.info[2 * v + 1], b = pairs.base[p]; let s = 0;
        for (let k = o; k < o + c; k++) s += table.val[k] * w[b + table.rel[k]];
        out[p] = s;
      }
      return out;
    },
    dispose() {},
  };
}
