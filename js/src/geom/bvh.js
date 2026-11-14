// Triangle BVH: closest ray hit, nearest point, and the fast generalised
// winding number (Barill et al. 2018: dipole far field, exact near field).

const hyp = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);


export class BVH {
  constructor(V, F, { leaf = 4 } = {}) {
    const LEAF = leaf;
    this.V = V; this.F = F;
    const m = F.length / 3;
    this.m = m;
    const C = new Float64Array(3 * m);
    const tlo = new Float64Array(3 * m), thi = new Float64Array(3 * m);
    for (let f = 0; f < m; f++)
      for (let k = 0; k < 3; k++) {
        const a = V[3 * F[3 * f] + k], b = V[3 * F[3 * f + 1] + k], c = V[3 * F[3 * f + 2] + k];
        C[3 * f + k] = (a + b + c) / 3;
        tlo[3 * f + k] = Math.min(a, b, c); thi[3 * f + k] = Math.max(a, b, c);
      }
    const idx = new Int32Array(m);
    for (let i = 0; i < m; i++) idx[i] = i;
    const maxN = 2 * m + 8;
    const lo = new Float64Array(3 * maxN), hi = new Float64Array(3 * maxN);
    const left = new Int32Array(maxN), start = new Int32Array(maxN), count = new Int32Array(maxN);
    let nn = 0;
    // explicit right pointers
    this._right = new Int32Array(maxN);
    const right = this._right;
    const build2 = (s, e) => {
      const node = nn++;
      let l0 = Infinity, l1 = Infinity, l2 = Infinity, h0 = -Infinity, h1 = -Infinity, h2 = -Infinity;
      let c0 = Infinity, c1 = Infinity, c2 = Infinity, d0 = -Infinity, d1 = -Infinity, d2 = -Infinity;
      for (let i = s; i < e; i++) {
        const f = idx[i];
        if (tlo[3 * f] < l0) l0 = tlo[3 * f]; if (tlo[3 * f + 1] < l1) l1 = tlo[3 * f + 1]; if (tlo[3 * f + 2] < l2) l2 = tlo[3 * f + 2];
        if (thi[3 * f] > h0) h0 = thi[3 * f]; if (thi[3 * f + 1] > h1) h1 = thi[3 * f + 1]; if (thi[3 * f + 2] > h2) h2 = thi[3 * f + 2];
        const x = C[3 * f], y = C[3 * f + 1], z = C[3 * f + 2];
        if (x < c0) c0 = x; if (y < c1) c1 = y; if (z < c2) c2 = z;
        if (x > d0) d0 = x; if (y > d1) d1 = y; if (z > d2) d2 = z;
      }
      lo[3 * node] = l0; lo[3 * node + 1] = l1; lo[3 * node + 2] = l2;
      hi[3 * node] = h0; hi[3 * node + 1] = h1; hi[3 * node + 2] = h2;
      if (e - s <= LEAF) { left[node] = -1; start[node] = s; count[node] = e - s; return node; }
      const ex0 = d0 - c0, ex1 = d1 - c1, ex2 = d2 - c2;
      const ax = ex0 >= ex1 && ex0 >= ex2 ? 0 : ex1 >= ex2 ? 1 : 2;
      const mid = (s + e) >> 1;
      nthElement(idx, s, e, mid, C, ax);
      count[node] = 0;
      left[node] = build2(s, mid);
      right[node] = build2(mid, e);
      return node;
    };
    build2(0, m);
    this.nn = nn; this.lo = lo; this.hi = hi; this.left = left; this.start = start; this.count = count; this.idx = idx;
    this.stack = new Int32Array(256);
  }

  /** Closest hit along o + t d (two-sided), t in (tmin, tmax). Returns t or Infinity; face in this.hitFace. */
  ray(ox, oy, oz, dx, dy, dz, tmin = 1e-6, tmax = Infinity) {
    const { V, F, lo, hi, left, start, count, idx } = this, right = this._right;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const st = this.stack;
    let sp = 0, best = tmax, bf = -1;
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp];
      // slab test
      let t0 = (lo[3 * n] - ox) * ix, t1 = (hi[3 * n] - ox) * ix;
      let tn = Math.min(t0, t1), tf = Math.max(t0, t1);
      t0 = (lo[3 * n + 1] - oy) * iy; t1 = (hi[3 * n + 1] - oy) * iy;
      tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
      t0 = (lo[3 * n + 2] - oz) * iz; t1 = (hi[3 * n + 2] - oz) * iz;
      tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
      if (!(tf >= tn) || tf < tmin || tn > best) continue;
      if (left[n] < 0) {
        for (let i = start[n], e = start[n] + count[n]; i < e; i++) {
          const f = idx[i];
          const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
          const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
          const e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-14) continue;
          const id = 1 / det;
          const sx = ox - V[a], sy = oy - V[a + 1], sz = oz - V[a + 2];
          const u = (sx * px + sy * py + sz * pz) * id;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * id;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * id;
          if (t > tmin && t < best) { best = t; bf = f; }
        }
      } else {
        if (sp + 2 > st.length) { const s2 = new Int32Array(st.length * 2); s2.set(st); this.stack = s2; return this.ray(ox, oy, oz, dx, dy, dz, tmin, tmax); }
        st[sp++] = right[n]; st[sp++] = left[n];
      }
    }
    this.hitFace = bf;
    return best;
  }

  /** Squared distance from p to the mesh. */
  nearest2(px, py, pz, bound = Infinity) {
    const { V, F, lo, hi, left, start, count, idx } = this, right = this._right;
    const st = this.stack;
    let sp = 0, best = bound;
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp];
      const dx = Math.max(lo[3 * n] - px, 0, px - hi[3 * n]);
      const dy = Math.max(lo[3 * n + 1] - py, 0, py - hi[3 * n + 1]);
      const dz = Math.max(lo[3 * n + 2] - pz, 0, pz - hi[3 * n + 2]);
      if (dx * dx + dy * dy + dz * dz >= best) continue;
      if (left[n] < 0) {
        for (let i = start[n], e = start[n] + count[n]; i < e; i++) {
          const f = idx[i];
          const d2 = pointTri2(px, py, pz, V, 3 * F[3 * f], 3 * F[3 * f + 1], 3 * F[3 * f + 2]);
          if (d2 < best) best = d2;
        }
      } else {
        // visit nearer child first
        const l = left[n], r = right[n];
        const dl = boxDist2(lo, hi, l, px, py, pz), dr = boxDist2(lo, hi, r, px, py, pz);
        if (sp + 2 > st.length) { const s2 = new Int32Array(st.length * 2); s2.set(st); this.stack = s2; return this.nearest2(px, py, pz, bound); }
        if (dl < dr) { st[sp++] = r; st[sp++] = l; } else { st[sp++] = l; st[sp++] = r; }
      }
    }
    return best;
  }

  /** Precompute dipole data for winding numbers. */
  prepareWinding() {
    const { V, F, left, start, count, idx, nn } = this, right = this._right;
    const nx = new Float64Array(nn), ny = new Float64Array(nn), nz = new Float64Array(nn);
    const cx = new Float64Array(nn), cy = new Float64Array(nn), cz = new Float64Array(nn), ar = new Float64Array(nn), rad = new Float64Array(nn);
    const Mm = new Float64Array(9 * nn); // sum (a n) (c - centre)^T
    const post = (n) => {
      if (left[n] < 0) {
        let sx = 0, sy = 0, sz = 0, px = 0, py = 0, pz = 0, sa = 0;
        for (let i = start[n], e = start[n] + count[n]; i < e; i++) {
          const f = idx[i], a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
          const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
          const wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
          const qx = 0.5 * (uy * wz - uz * wy), qy = 0.5 * (uz * wx - ux * wz), qz = 0.5 * (ux * wy - uy * wx);
          const A = hyp(qx, qy, qz);
          sx += qx; sy += qy; sz += qz; sa += A;
          px += A * (V[a] + V[b] + V[c]) / 3; py += A * (V[a + 1] + V[b + 1] + V[c + 1]) / 3; pz += A * (V[a + 2] + V[b + 2] + V[c + 2]) / 3;
        }
        nx[n] = sx; ny[n] = sy; nz[n] = sz; ar[n] = sa;
        cx[n] = sa ? px / sa : 0; cy[n] = sa ? py / sa : 0; cz[n] = sa ? pz / sa : 0;
        for (let i = start[n], e = start[n] + count[n]; i < e; i++) {
          const f = idx[i], a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
          const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
          const wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
          const q = [0.5 * (uy * wz - uz * wy), 0.5 * (uz * wx - ux * wz), 0.5 * (ux * wy - uy * wx)];
          const d = [(V[a] + V[b] + V[c]) / 3 - cx[n], (V[a + 1] + V[b + 1] + V[c + 1]) / 3 - cy[n], (V[a + 2] + V[b + 2] + V[c + 2]) / 3 - cz[n]];
          for (let r = 0; r < 3; r++) for (let t = 0; t < 3; t++) Mm[9 * n + 3 * r + t] += q[r] * d[t];
        }
      } else {
        const l = left[n], r = right[n];
        post(l); post(r);
        nx[n] = nx[l] + nx[r]; ny[n] = ny[l] + ny[r]; nz[n] = nz[l] + nz[r];
        const sa = ar[l] + ar[r]; ar[n] = sa;
        cx[n] = sa ? (cx[l] * ar[l] + cx[r] * ar[r]) / sa : 0;
        cy[n] = sa ? (cy[l] * ar[l] + cy[r] * ar[r]) / sa : 0;
        cz[n] = sa ? (cz[l] * ar[l] + cz[r] * ar[r]) / sa : 0;
        for (const ch of [l, r]) {
          const N3 = [nx[ch], ny[ch], nz[ch]], d = [cx[ch] - cx[n], cy[ch] - cy[n], cz[ch] - cz[n]];
          for (let a = 0; a < 3; a++) for (let t = 0; t < 3; t++) Mm[9 * n + 3 * a + t] += Mm[9 * ch + 3 * a + t] + N3[a] * d[t];
        }
      }
      // radius: farthest bbox corner from the centre
      const lo = this.lo, hi = this.hi;
      const ex = Math.max(Math.abs(lo[3 * n] - cx[n]), Math.abs(hi[3 * n] - cx[n]));
      const ey = Math.max(Math.abs(lo[3 * n + 1] - cy[n]), Math.abs(hi[3 * n + 1] - cy[n]));
      const ez = Math.max(Math.abs(lo[3 * n + 2] - cz[n]), Math.abs(hi[3 * n + 2] - cz[n]));
      rad[n] = hyp(ex, ey, ez);
    };
    post(0);
    this.w = { nx, ny, nz, cx, cy, cz, rad, Mm };
    return this;
  }

  /** Generalised winding number at q (beta = accuracy, 2 as in Barill et al.). */
  winding(qx, qy, qz, beta = 2) {
    const { V, F, left, start, count, idx } = this, right = this._right;
    const { nx, ny, nz, cx, cy, cz, rad, Mm } = this.w;
    const st = this.stack;
    let sp = 0, w = 0;
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp];
      const dx = cx[n] - qx, dy = cy[n] - qy, dz = cz[n] - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = beta * rad[n];
      if (d2 > r * r) {
        const d = Math.sqrt(d2), i3 = 1 / (d2 * d), i5 = i3 / d2, o = 9 * n;
        // order 0 + order 1 (Barill et al. 2018): N.G(x) + sum M_ij dG_i/dx_j, x = centre - q
        const xMx = dx * (Mm[o] * dx + Mm[o + 1] * dy + Mm[o + 2] * dz)
                  + dy * (Mm[o + 3] * dx + Mm[o + 4] * dy + Mm[o + 5] * dz)
                  + dz * (Mm[o + 6] * dx + Mm[o + 7] * dy + Mm[o + 8] * dz);
        w += (dx * nx[n] + dy * ny[n] + dz * nz[n]) * i3 + (Mm[o] + Mm[o + 4] + Mm[o + 8]) * i3 - 3 * xMx * i5;
        continue;
      }
      if (left[n] < 0) {
        for (let i = start[n], e = start[n] + count[n]; i < e; i++) {
          const f = idx[i], a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
          const ax = V[a] - qx, ay = V[a + 1] - qy, az = V[a + 2] - qz;
          const bx = V[b] - qx, by = V[b + 1] - qy, bz = V[b + 2] - qz;
          const cx_ = V[c] - qx, cy_ = V[c + 1] - qy, cz_ = V[c + 2] - qz;
          const la = Math.sqrt(ax * ax + ay * ay + az * az), lb = Math.sqrt(bx * bx + by * by + bz * bz), lc = Math.sqrt(cx_ * cx_ + cy_ * cy_ + cz_ * cz_);
          const num = ax * (by * cz_ - bz * cy_) - ay * (bx * cz_ - bz * cx_) + az * (bx * cy_ - by * cx_);
          const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx_ + by * cy_ + bz * cz_) * la + (cx_ * ax + cy_ * ay + cz_ * az) * lb;
          w += 2 * Math.atan2(num, den);
        }
      } else {
        if (sp + 2 > st.length) { const s2 = new Int32Array(st.length * 2); s2.set(st); this.stack = s2; return this.winding(qx, qy, qz, beta); }
        st[sp++] = right[n]; st[sp++] = left[n];
      }
    }
    return w / (4 * Math.PI);
  }
}

// Van Oosterom & Strackee, returns the solid angle (not divided by 4 pi)
function solidAngle(V, a, b, c, qx, qy, qz) {
  const ax = V[a] - qx, ay = V[a + 1] - qy, az = V[a + 2] - qz;
  const bx = V[b] - qx, by = V[b + 1] - qy, bz = V[b + 2] - qz;
  const cx = V[c] - qx, cy = V[c + 1] - qy, cz = V[c + 2] - qz;
  const la = hyp(ax, ay, az), lb = hyp(bx, by, bz), lc = hyp(cx, cy, cz);
  const num = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
  return 2 * Math.atan2(num, den);
}

function boxDist2(lo, hi, n, px, py, pz) {
  const dx = Math.max(lo[3 * n] - px, 0, px - hi[3 * n]);
  const dy = Math.max(lo[3 * n + 1] - py, 0, py - hi[3 * n + 1]);
  const dz = Math.max(lo[3 * n + 2] - pz, 0, pz - hi[3 * n + 2]);
  return dx * dx + dy * dy + dz * dz;
}

// Ericson, Real-Time Collision Detection 5.1.5
export function pointTri2(px, py, pz, V, a, b, c) {
  const abx = V[b] - V[a], aby = V[b + 1] - V[a + 1], abz = V[b + 2] - V[a + 2];
  const acx = V[c] - V[a], acy = V[c + 1] - V[a + 1], acz = V[c + 2] - V[a + 2];
  const apx = px - V[a], apy = py - V[a + 1], apz = pz - V[a + 2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = V[a]; qy = V[a + 1]; qz = V[a + 2]; }
  else {
    const bpx = px - V[b], bpy = py - V[b + 1], bpz = pz - V[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - V[c], cpy = py - V[c + 1], cpz = pz - V[c + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { qx = V[b]; qy = V[b + 1]; qz = V[b + 2]; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = V[a] + v * abx; qy = V[a + 1] + v * aby; qz = V[a + 2] + v * abz; }
    else if (d6 >= 0 && d5 <= d6) { qx = V[c]; qy = V[c + 1]; qz = V[c + 2]; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = V[a] + w * acx; qy = V[a + 1] + w * acy; qz = V[a + 2] + w * acz; }
    else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      qx = V[b] + w * (V[c] - V[b]); qy = V[b + 1] + w * (V[c + 1] - V[b + 1]); qz = V[b + 2] + w * (V[c + 2] - V[b + 2]);
    } else {
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      qx = V[a] + abx * v + acx * w; qy = V[a + 1] + aby * v + acy * w; qz = V[a + 2] + abz * v + acz * w;
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

// quickselect on idx[s..e) by C[3*idx+ax] so that position k holds the k-th
function nthElement(idx, s, e, k, C, ax) {
  let l = s, r = e - 1;
  while (r > l) {
    const pv = C[3 * idx[(l + r) >> 1] + ax];
    let i = l, j = r;
    while (i <= j) {
      while (C[3 * idx[i] + ax] < pv) i++;
      while (C[3 * idx[j] + ax] > pv) j--;
      if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; }
    }
    if (k <= j) r = j; else if (k >= i) l = i; else break;
  }
}
