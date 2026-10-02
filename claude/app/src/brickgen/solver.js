// Lazy-greedy part selection on the fractional volume field.
import { G } from './constants.js';

class Heap {                       // min-heap on [key, k, b, j, i] compared lexicographically (same tie-break as the Python reference)
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  static lt(x, y) { for (let t = 0; t < 5; t++) { if (x[t] < y[t]) return true; if (x[t] > y[t]) return false; } return false; }
  push(e) { const a = this.a; a.push(e); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!Heap.lt(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && Heap.lt(a[l], a[m])) m = l; if (r < a.length && Heap.lt(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; }
    }
    return top;
  }
  peek() { return this.a[0]; }
  static from(arr) { const h = new Heap(); arr.sort((x, y) => (Heap.lt(x, y) ? -1 : Heap.lt(y, x) ? 1 : 0)); h.a = arr; return h; }
}

export class Solver {
  constructor(M, nl, nz, nx, opts, mirror = null) {
    this.M0 = M.slice(); this.M = M.slice(); this.C = new Float32Array(M.length);
    this.NL = nl; this.NZs = nz; this.NXs = nx; this.NZc = nz / G; this.NXc = nx / G;
    this.pieces = []; this.o = opts; this.mirror = mirror; this.ver = 0; this.Iver = -1; this.log = () => {};
  }
  idx(l, z, x) { return (l * this.NZs + z) * this.NXs + x; }

  attachMirrors(variants) {
    if (!this.mirror) return variants;
    const ax = this.mirror[0];
    for (const v of variants) {
      if (v.mv !== undefined) continue;
      const nz = v.d * G, nx = v.w * G, h = v.h;
      const sm = new Set(v.studs.map(([a, b]) => (ax === 'x' ? `${v.w - 1 - a},${b}` : `${a},${v.d - 1 - b}`)));
      v.mv = null;
      for (const u of variants) {
        if (u.c.id !== v.c.id || u.w !== v.w || u.d !== v.d || u.h !== h || u.studs.length !== sm.size) continue;
        if (!u.studs.every(([a, b]) => sm.has(`${a},${b}`))) continue;
        let same = true;
        for (let l = 0; l < h && same; l++) for (let z = 0; z < nz && same; z++) for (let x = 0; x < nx; x++) {
          const vm = ax === 'x' ? v.V[(l * nz + z) * nx + (nx - 1 - x)] : v.V[(l * nz + (nz - 1 - z)) * nx + x];
          if (Math.abs(u.V[(l * nz + z) * nx + x] - vm) > 1e-3) { same = false; break; }
        }
        if (same) { v.mv = u; break; }
      }
    }
    return variants;
  }
  mirrorOf(v, b, j, i) { const [ax, c2] = this.mirror; return ax === 'x' ? [b, j, c2 - i - v.w] : [b, c2 - j - v.d, i]; }
  straddles(v, b, j, i) {
    if (!this.mirror) return false;
    const [ax, c2] = this.mirror; const lo = ax === 'x' ? i : j, n = ax === 'x' ? v.w : v.d;
    if (!(2 * lo < c2 && c2 < 2 * (lo + n))) return false;
    const [, j2, i2] = this.mirrorOf(v, b, j, i);
    return !(v.mv === v && j2 === j && i2 === i);
  }

  /** exact fit of variant v at (level b, cell j, cell i): [net, matched, symdiff] or null */
  evaluate(v, b, j, i, tol) {
    if (b + v.h > this.NL || (j + v.d) * G > this.NZs || (i + v.w) * G > this.NXs || b < 0 || j < 0 || i < 0) return null;
    if (this.mirror && this.straddles(v, b, j, i)) return null;
    const pz = v.d * G, px = v.w * G, V = v.V, M = this.M, C = this.C;
    let ov = 0, over = 0;
    for (let l = 0; l < v.h; l++) for (let z = 0; z < pz; z++) {
      const base = this.idx(b + l, j * G + z, i * G), vb = (l * pz + z) * px;
      for (let x = 0; x < px; x++) {
        const vv = V[vb + x], w = M[base + x];
        if (C[base + x] + vv > 1.002) return null;
        ov += w < vv ? w : vv; over += Math.abs(vv - w);
      }
    }
    ov /= G * G; over /= G * G;
    const box = v.h * v.w * v.d;
    if (ov / v.vtot < tol.min_cov || over / box > tol.max_err) return null;
    if (v.c.kind === 'tile' && b + 1 < this.NL) {      // studless skin: tile only where the top is exposed
      let s = 0;
      for (let z = 0; z < pz; z++) { const base = this.idx(b + 1, j * G + z, i * G); for (let x = 0; x < px; x++) s += this.M0[base + x]; }
      if (s / (pz * px) > this.o.tileExposure) return null;
    }
    const net = ov - (tol.w_err ?? this.o.wErr) * over - tol.piece_pen + ((tol.bonus || {})[v.c.kind] || 0);
    return [net, ov, over];
  }

  /** cell-level integral image of the remaining field (box sums at stud-aligned positions only) */
  integral() {
    if (this.Iver === this.ver) return this.I;
    const L = this.NL, Z = this.NZc, X = this.NXc, I = new Float64Array((L + 1) * (Z + 1) * (X + 1));
    const at = (l, z, x) => (l * (Z + 1) + z) * (X + 1) + x;
    for (let l = 0; l < L; l++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      let s = 0;
      for (let dz = 0; dz < G; dz++) { const base = this.idx(l, z * G + dz, x * G); for (let dx = 0; dx < G; dx++) s += this.M[base + dx]; }
      I[at(l + 1, z + 1, x + 1)] = s + I[at(l, z + 1, x + 1)] + I[at(l + 1, z, x + 1)] + I[at(l + 1, z + 1, x)]
        - I[at(l, z, x + 1)] - I[at(l, z + 1, x)] - I[at(l + 1, z, x)] + I[at(l, z, x)];
    }
    this.I = I; this.Iat = at; this.Iver = this.ver; return I;
  }

  candidates(variants, tol) {
    const I = this.integral(), at = this.Iat, out = [];
    for (let k = 0; k < variants.length; k++) {
      const v = variants[k], h = v.h, w = v.w, d = v.d;
      if (this.NL < h || this.NZc < d || this.NXc < w) continue;
      const box = h * w * d, vs = v.vsum / (G * G), bonus = (tol.bonus || {})[v.c.kind] || 0;
      for (let b = 0; b + h <= this.NL; b++) for (let j = 0; j + d <= this.NZc; j++) for (let i = 0; i + w <= this.NXc; i++) {
        const sw = (I[at(b + h, j + d, i + w)] - I[at(b, j + d, i + w)] - I[at(b + h, j, i + w)] - I[at(b + h, j + d, i)]
          + I[at(b, j, i + w)] + I[at(b, j + d, i)] + I[at(b + h, j, i)] - I[at(b, j, i)]) / (G * G);
        if (sw < tol.min_cov * v.vtot - 1e-3 || Math.abs(sw - vs) > tol.max_err * box + 1e-3) continue;
        // exact test (without the collision / tile rules, re-checked at pop time)
        const pz = d * G, px = w * G, V = v.V, M = this.M;
        let ov = 0, over = 0;
        for (let l = 0; l < h; l++) for (let z = 0; z < pz; z++) {
          const base = this.idx(b + l, j * G + z, i * G), vb = (l * pz + z) * px;
          for (let x = 0; x < px; x++) { const vv = V[vb + x], m = M[base + x]; ov += m < vv ? m : vv; over += Math.abs(vv - m); }
        }
        ov /= G * G; over /= G * G;
        if (ov / v.vtot < tol.min_cov || over / box > tol.max_err) continue;
        const net = ov - (tol.w_err ?? this.o.wErr) * over - tol.piece_pen + bonus;
        if (net > 0) out.push([-net, k, b, j, i]);
      }
    }
    return Heap.from(out);
  }

  runPhase(variants, tol, name) {
    const heap = this.candidates(variants, tol); let placed = 0;
    while (heap.size) {
      const [, k, b, j, i] = heap.pop(), v = variants[k];
      const r = this.evaluate(v, b, j, i, tol);
      if (!r) continue;
      const [net, ov, over] = r;
      if (heap.size && net < -heap.peek()[0] - 1e-6) { if (net > 0) heap.push([-net, k, b, j, i]); continue; }
      if (net <= 0) continue;
      this.place(v, b, j, i, ov, over, name); placed++;
    }
    this.log(`phase ${name}: placed ${placed}`);
    return placed;
  }

  place(v, b, j, i, ov, over, phase, isMirror = false) {
    this._place(v, b, j, i, ov, over, phase);
    if (isMirror || !this.mirror || !v.mv) return;
    const u = v.mv, [b2, j2, i2] = this.mirrorOf(v, b, j, i);
    if (u === v && j2 === j && i2 === i) return;
    if (j2 < 0 || i2 < 0 || (j2 + u.d) * G > this.NZs || (i2 + u.w) * G > this.NXs) return;
    const pz = u.d * G, px = u.w * G; let o2 = 0, e2 = 0;
    for (let l = 0; l < u.h; l++) for (let z = 0; z < pz; z++) {
      const base = this.idx(b2 + l, j2 * G + z, i2 * G), vb = (l * pz + z) * px;
      for (let x = 0; x < px; x++) {
        const vv = u.V[vb + x], m = this.M[base + x];
        if (this.C[base + x] + vv > 1.002) return;
        o2 += m < vv ? m : vv; e2 += Math.abs(vv - m);
      }
    }
    this._place(u, b2, j2, i2, o2 / (G * G), e2 / (G * G), phase + '~m');
  }
  _place(v, b, j, i, ov, over, phase) {
    const pz = v.d * G, px = v.w * G;
    for (let l = 0; l < v.h; l++) for (let z = 0; z < pz; z++) {
      const base = this.idx(b + l, j * G + z, i * G), vb = (l * pz + z) * px;
      for (let x = 0; x < px; x++) { const vv = v.V[vb + x]; this.C[base + x] += vv; this.M[base + x] = Math.min(1, Math.max(0, this.M[base + x] - vv)); }
    }
    this.ver++;
    this.pieces.push({ id: v.c.id, name: v.c.name, kind: v.c.kind, rot: v.rot, b, i, j, w: v.w, d: v.d, h: v.h, studs: v.studs.map((s) => s.slice()), phase, matched: ov, over });
  }
  /** mean fill of every stud cell of the remaining field */
  leftoverCells(src = this.M) {
    const F = new Float32Array(this.NL * this.NZc * this.NXc);
    for (let l = 0; l < this.NL; l++) for (let z = 0; z < this.NZc; z++) for (let x = 0; x < this.NXc; x++) {
      let s = 0; for (let dz = 0; dz < G; dz++) { const base = this.idx(l, z * G + dz, x * G); for (let dx = 0; dx < G; dx++) s += src[base + dx]; }
      F[(l * this.NZc + z) * this.NXc + x] = s / (G * G);
    }
    return F;
  }
}
