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
  /** swap the target field mid-solve (run.js fieldCascade): what was consumed stays consumed, the remainder is re-derived from the new field */
  setField(M0) { this.M0 = M0.slice(); for (let k = 0; k < this.M.length; k++) this.M[k] = Math.min(1, Math.max(0, M0[k] - this.C[k])); this.ver++; }

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

  /**
   * Slope alignment (docs/CURVES.md): a shaped part placed where the surface falls away in another direction than the part's own
   * slope is what a doubly curved surface looks like when the greedy only scores volume - slopes at random yaws, 2-wide parts
   * across the grain. The field's top and bottom surfaces give a gradient per stud cell; a variant's template gives its own slope
   * direction; their agreement (cosine), weighted by how steep the field is there, is added to the net: + skinAlign where they
   * agree, - skinAlign across. Flat parts and flat regions get nothing (either gradient ~ 0).
   */
  gradients() {
    if (this.G2) return this.G2;
    const NL = this.NL, NZ = this.NZs, NX = this.NXs, F = this.Mfull || this.M0, Zc = this.NZc, Xc = this.NXc;
    const top = new Float32Array(NZ * NX).fill(-1), bot = new Float32Array(NZ * NX).fill(-1);
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      for (let l = NL - 1; l >= 0; l--) { const m = F[this.idx(l, z, x)]; if (m > 0.05) { top[z * NX + x] = l + m; break; } }
      for (let l = 0; l < NL; l++) { const m = F[this.idx(l, z, x)]; if (m > 0.05) { bot[z * NX + x] = l + 1 - m; break; } }
    }
    // per stud cell: mean central difference over +-1 stud of the sample columns that have a surface on both sides (plates / sample)
    const grad = (h) => {
      const gx = new Float32Array(Zc * Xc), gz = new Float32Array(Zc * Xc);
      for (let cz = 0; cz < Zc; cz++) for (let cx = 0; cx < Xc; cx++) {
        let sx = 0, sz = 0, n = 0;
        for (let dz = 0; dz < G; dz++) for (let dx = 0; dx < G; dx++) {
          const z = cz * G + dz, x = cx * G + dx; if (z < G || z >= NZ - G || x < G || x >= NX - G) continue;
          const k = z * NX + x, a = h[k - G], b = h[k + G], c = h[k - G * NX], d = h[k + G * NX];
          if (h[k] < 0 || a < 0 || b < 0 || c < 0 || d < 0) continue;
          sx += (b - a) / (2 * G); sz += (d - c) / (2 * G); n++;
        }
        if (n) { gx[cz * Xc + cx] = sx / n; gz[cz * Xc + cx] = sz / n; }
      }
      return { gx, gz };
    };
    this.G2 = { top: grad(top), bot: grad(bot) };
    return this.G2;
  }
  /** a variant's own slope: gradient (plates / sample) of its top surface, or of its underside for inverted parts; null when flat */
  static slopeOf(v) {
    if (v.slope !== undefined) return v.slope;
    const pz = v.d * G, px = v.w * G, inv = v.c.kind === 'inverted';
    let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
    for (let z = 0; z < pz; z++) for (let x = 0; x < px; x++) {
      let t = 0; for (let l = 0; l < v.h; l++) t += v.V[(l * pz + z) * px + x];
      if (t < 0.05) continue; if (inv) t = v.h - t;
      n++; sx += x; sz += z; sh += t; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * t; szh += z * t;
    }
    let out = null;
    if (n >= 4) {                                    // least-squares plane t = a x + b z + c
      const mx = sx / n, mz = sz / n, mh = sh / n, cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxh = sxh / n - mx * mh, czh = szh / n - mz * mh;
      const det = cxx * czz - cxz * cxz;
      if (Math.abs(det) > 1e-9) { const a = (cxh * czz - czh * cxz) / det, b = (czh * cxx - cxh * cxz) / det; if (Math.hypot(a, b) > 0.05) out = [a, b]; }   // > ~ 14 deg: a slope, not a plate's rounding
    }
    v.slope = out; return out;
  }
  /** alignment term of variant v over the footprint (j, i): skinAlign * cos(angle between the slopes) * steepness of the field there */
  align(v, j, i) {
    const k = this.o.skinAlign; if (!k || v.parts) return 0;          // single parts only: an assembly's mean gradient says little about it
    const sv = Solver.slopeOf(v); if (!sv) return 0;
    const g = v.c.kind === 'inverted' ? this.gradients().bot : this.gradients().top, Xc = this.NXc;
    if (j < 0 || i < 0 || j + v.d > this.NZc || i + v.w > Xc) return 0;
    let gx = 0, gz = 0;
    for (let dz = 0; dz < v.d; dz++) for (let dx = 0; dx < v.w; dx++) { const q = (j + dz) * Xc + i + dx; gx += g.gx[q]; gz += g.gz[q]; }
    const m = Math.hypot(gx, gz) / (v.w * v.d); if (m < 1e-6) return 0;
    const steep = Math.min(1, m / 0.145);           // 0.145 plates / sample = tan 30 deg: full weight from 30 deg up
    return k * steep * (gx * sv[0] + gz * sv[1]) / (Math.hypot(gx, gz) * Math.hypot(sv[0], sv[1]));
  }

  /**
   * the round family (discs, quarter-round plates, poles) belongs on vertical curved walls (a cylinder, a rounded edge, a rim)
   * and on flat tops (a disc lying on a table), not on the sloped skin in between, where stacked quarter-round plates are a
   * staircase and the slopes do better (docs/CURVES.md round 7). roundBand = [lo, hi] of the top-surface steepness (plates per
   * sample; tan 15 deg = .07, tan 55 deg = .36) inside which a round part is not a candidate.
   */
  roundOk(v, j, i) {
    const band = this.o.roundBand; if (!band || v.c.kind !== 'round') return true;
    const g = this.gradients().top, Xc = this.NXc; let m = 0;
    for (let dz = 0; dz < v.d; dz++) for (let dx = 0; dx < v.w; dx++) { const q = (j + dz) * Xc + i + dx; m += Math.hypot(g.gx[q], g.gz[q]); }
    m /= v.w * v.d;
    return !(m > band[0] && m < band[1]);
  }

  /** exact fit of variant v at (level b, cell j, cell i): [net, matched, symdiff] or null */
  evaluate(v, b, j, i, tol) {
    if (b + v.h > this.NL || (j + v.d) * G > this.NZs || (i + v.w) * G > this.NXs || b < 0 || j < 0 || i < 0) return null;
    if (this.mirror && this.straddles(v, b, j, i)) return null;
    if (!this.roundOk(v, j, i)) return null;
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
    const net = ov - (tol.w_err ?? this.o.wErr) * over - tol.piece_pen * (v.npieces ?? 1) + (v.bonus ?? ((tol.bonus || {})[v.c.kind] || 0)) + this.align(v, j, i);
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
    const I = this.integral(), at = this.Iat, out = [], G2 = G * G, wErr = tol.w_err ?? this.o.wErr, bonusOf = tol.bonus || {};
    // variants sharing a box (h, d, w) share the box sum, so the integral is read once per box per position
    const groups = new Map();
    for (let k = 0; k < variants.length; k++) {
      const v = variants[k];
      if (this.NL < v.h || this.NZc < v.d || this.NXc < v.w) continue;
      const key = v.h * 1000000 + v.d * 1000 + v.w;
      let g = groups.get(key); if (!g) { g = { h: v.h, d: v.d, w: v.w, ks: [], lo: Infinity }; groups.set(key, g); }
      g.ks.push(k); g.lo = Math.min(g.lo, tol.min_cov * v.vtot - 1e-3);
    }
    const Z1 = this.NZc + 1, X1 = this.NXc + 1;
    for (const g of groups.values()) {
      const { h, w, d, ks, lo } = g, box = h * w * d, maxErr = tol.max_err * box + 1e-3, pz = d * G, px = w * G, loG = lo * G2;
      const roundGroup = !!this.o.roundBand && ks.every((k) => variants[k].c.kind === 'round');
      const o1 = h * Z1 * X1, o2 = d * X1, o3 = w, oL = Z1 * X1, wd = w * d * G2, beat = tol.beatFlat ?? this.o.beatFlat ?? 1;        // integral offsets of the box corners from its (b, j, i) corner; oL = one level
      const levM = new Float64Array(h); let levAt = -1;
      for (let b = 0; b + h <= this.NL; b++) for (let j = 0; j + d <= this.NZc; j++) {
        let c0 = (b * Z1 + j) * X1;                        // at(b, j, 0)
        for (let i = 0; i + w <= this.NXc; i++, c0++) {
          const swG = I[c0 + o1 + o2 + o3] - I[c0 + o2 + o3] - I[c0 + o1 + o3] - I[c0 + o1 + o2] + I[c0 + o3] + I[c0 + o2] + I[c0 + o1] - I[c0];
          if (swG < loG) continue;
          if (roundGroup && !this.roundOk(variants[ks[0]], j, i)) continue;
          const sw = swG / G2;
          for (let q = 0; q < ks.length; q++) {
            const k = ks[q], v = variants[k], vs = v.vsum / G2;
            if (sw < tol.min_cov * v.vtot - 1e-3 || Math.abs(sw - vs) > maxErr) continue;
            // exact test (without the collision / tile rules, re-checked at pop time)
            let ov = 0, over = 0, flatErr = -1;
            if (v.full) { ov = swG; over = box * G2 - swG; }                   // solid box: min(m, 1) = m and |1 - m| = 1 - m, both already summed by the integral
            else {
              // per-level bounds: sum_l min(M_l, V_l) >= ov and sum_l |M_l - V_l| <= over, so a failure here is a failure of the exact test too
              if (levAt !== c0) { levAt = c0; for (let l = 0, c = c0; l < h; l++, c += oL) levM[l] = I[c + oL + o2 + o3] - I[c + o2 + o3] - I[c + oL + o3] - I[c + oL + o2] + I[c + o3] + I[c + o2] + I[c + oL] - I[c]; }
              let ub = 0, lb = 0; const lev = v.lev;
              for (let l = 0; l < h; l++) { const a = levM[l], e = lev[l]; ub += a < e ? a : e; lb += a > e ? a - e : e - a; }
              if (ub / G2 / v.vtot < tol.min_cov - 1e-6 || lb / G2 / box > tol.max_err + 1e-6) continue;
              // a shaped part must explain the field better than the best flat stack (0..h full levels) in the same box would; otherwise plates / bricks take it
              if (beat < 1) {
                let above = 0; for (let l = 0; l < h; l++) above += levM[l];                       // error of the empty stack = all the mass
                let flat = above, below = 0;
                for (let l = 0; l < h; l++) { below += wd - levM[l]; above -= levM[l]; const e = below + above; if (e < flat) flat = e; }
                flatErr = flat;
              }
              const V = v.V, M = this.M;
              for (let l = 0; l < h; l++) for (let z = 0; z < pz; z++) {
                const base = this.idx(b + l, j * G + z, i * G), vb = (l * pz + z) * px;
                for (let x = 0; x < px; x++) { const vv = V[vb + x], m = M[base + x]; ov += m < vv ? m : vv; over += Math.abs(vv - m); }
              }
            }
            if (flatErr >= 0 && over > beat * flatErr) continue;
            ov /= G2; over /= G2;
            if (ov / v.vtot < tol.min_cov || over / box > tol.max_err) continue;
            const net = ov - wErr * over - tol.piece_pen * (v.npieces ?? 1) + (v.bonus ?? (bonusOf[v.c.kind] || 0)) + this.align(v, j, i);
            if (net > 0) out.push([-net, k, b, j, i]);
          }
        }
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
    if (v.parts) {                       // compound variant (motifs/library.js): the field update above used its union volume; record its real pieces
      const mi = this.mi = (this.mi || 0) + 1;                                  // one motif placement = one rigid assembly (post.components)
      // an assembly with a sideways part only holds together as mined: the side studs that carry that part belong to another
      // piece of the SAME assembly, so none of its pieces may be merged away afterwards (post.free)
      const rigid = v.parts.some((q) => q.v.ori >= 4);
      for (const q of v.parts) {
        const u = q.v, share = u.vtot / v.vtot;
        this.pieces.push({ id: u.c.id, name: u.c.name, kind: u.c.kind, rot: u.rot, ori: u.ori, b: b + q.db, i: i + q.di, j: j + q.dj, w: u.w, d: u.d, h: u.h,
          studs: q.studs.map((s) => s.slice()), phase, matched: ov * share, over: over * share, motif: v.c.id, mi, ...(u.ori >= 4 ? { snot: true } : {}), ...(rigid ? { rigid: true } : {}) });
      }
      return;
    }
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
