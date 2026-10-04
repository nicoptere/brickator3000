// Fractional volume field M[level][z][x] (5x5 samples per stud, one level per plate) from exact vertical ray hits.
import { STUD, PLATE, G, SAMP, PAD } from './constants.js';
import { bounds } from './mesh.js';
import { connectIslands, decimateFloaters } from './islands.js';

/** scale so the reference side = n studs; returns shifted copies (x += ox, z += oz) */
export function normalize(tris, pts, n, ox, oz, ref = 'min3') {
  const { lo, hi } = bounds(tris);
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const base = ref === 'min3' ? Math.min(ext[0], ext[1], ext[2]) : Math.max(ext[0], ext[2]);
  const s = n * STUD / base;
  const f = (a) => {
    const o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) { o[i] = (a[i] - lo[0]) * s + ox; o[i + 1] = (a[i + 1] - lo[1]) * s; o[i + 2] = (a[i + 2] - lo[2]) * s + oz; }
    return o;
  };
  return { tris: f(tris), pts: pts ? f(pts) : null, s, lo };
}

/** every hit of a vertical ray through every sample column: grouped per column, sorted by height, with facing (-1 = surface looks down).
 *  `step` is the ray spacing in LDU: SAMP is one ray per field cell, SAMP / s gives s x s rays per cell (see spansVolume). */
export function columnHits(tris, NX, NZ, step = SAMP) {
  const ex = 0.00137, ez = 0.00291;
  let cap = 1 << 16, n = 0;
  let sid = new Int32Array(cap), ys = new Float32Array(cap), fc = new Int8Array(cap);
  const push = (s, y, f) => {
    if (n === cap) {
      cap *= 2;
      const a = new Int32Array(cap); a.set(sid); sid = a; const b = new Float32Array(cap); b.set(ys); ys = b; const c = new Int8Array(cap); c.set(fc); fc = c;
    }
    sid[n] = s; ys[n] = y; fc[n] = f; n++;
  };
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5], cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
    const i0 = Math.max(0, Math.ceil((x0 - ex) / step - 0.5)), i1 = Math.min(NX - 1, Math.floor((x1 - ex) / step - 0.5));
    const k0 = Math.max(0, Math.ceil((z0 - ez) / step - 0.5)), k1 = Math.min(NZ - 1, Math.floor((z1 - ez) / step - 0.5));
    if (i1 < i0 || k1 < k0) continue;
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const f = ny < 0 ? -1 : 1;
    for (let k = k0; k <= k1; k++) {
      const Z = (k + 0.5) * step + ez;
      for (let i = i0; i <= i1; i++) {
        const X = (i + 0.5) * step + ex;
        const l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / den;
        if (l1 < 0) continue;
        const l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / den;
        if (l2 < 0) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < 0) continue;
        push(k * NX + i, l1 * ay + l2 * by + l3 * cy, f);
      }
    }
  }
  // bucket by column, sort each column by height
  const NC = NX * NZ, start = new Int32Array(NC + 1);
  for (let h = 0; h < n; h++) start[sid[h] + 1]++;
  for (let c = 0; c < NC; c++) start[c + 1] += start[c];
  const pos = start.slice(0, NC), Y = new Float32Array(n), F = new Int8Array(n);
  for (let h = 0; h < n; h++) { const p = pos[sid[h]]++; Y[p] = ys[h]; F[p] = fc[h]; }
  for (let c = 0; c < NC; c++) {
    const a = start[c], b = start[c + 1];
    for (let p = a + 1; p < b; p++) {                    // insertion sort (few hits per column)
      const y = Y[p], f = F[p]; let q = p - 1;
      while (q >= a && Y[q] > y) { Y[q + 1] = Y[q]; F[q + 1] = F[q]; q--; }
      Y[q + 1] = y; F[q + 1] = f;
    }
  }
  return { start, Y, F };
}

/** column hits -> solid intervals -> fractional slab volume. "hollow": intervals from enter/exit hit pairs in position order
 * (the standard even-odd point-in-solid rule) — keeps the air between biplane wings and under bellies, AND keeps a concave
 * interior (a cup, a bowl) hollow, regardless of face winding. "envelope": always solid from the lowest to the highest hit
 * (the crude, deliberate opt-in for when a shape is known-simple and robustness against noisy geometry matters more). */
export function spansVolume(tris, nxc, nzc, nl, o) {
  const ss = Math.max(1, Math.round(o.superSample ?? 1));
  const NX = nxc * G, NZ = nzc * G;
  const NXf = NX * ss, NZf = NZ * ss;                    // ray grid: ss x ss rays per field cell
  const { start, Y, F } = columnHits(tris, NXf, NZf, SAMP / ss);
  const M = new Float32Array(nl * NZ * NX);
  const alt = (a, b, first) => {
    if ((b - a) % 2) return false;
    for (let p = a; p < b; p++) if (F[p] !== ((p - a) % 2 ? -first : first)) return false;
    return true;
  };
  let okD = 0, okU = 0, ncol = 0;
  for (let c = 0; c < NXf * NZf; c++) {
    const a = start[c], b = start[c + 1]; if (a === b) continue;
    ncol++; if (alt(a, b, -1)) okD++; if (alt(a, b, 1)) okU++;
  }
  if (!ncol) return { M, bad: 0 };
  const first = okD >= okU ? -1 : 1, valid = Math.max(okD, okU) / ncol;
  // one ray column at a time: its fill per level is clamped to 1 within that column, then averaged into the field cell
  // it belongs to (weight 1 / ss^2), so a cell is the area average of its rays instead of a single centre sample.
  const col = new Float32Array(nl), w = 1 / (ss * ss);
  const add = (l, v) => { col[l] = Math.min(1, col[l] + v); };
  for (let c = 0; c < NXf * NZf; c++) {
    const a = start[c], b = start[c + 1]; if (a === b) continue;
    const izf = Math.floor(c / NXf), ixf = c % NXf;
    const iz = (izf / ss) | 0, ix = (ixf / ss) | 0;
    let pairs = [];
    // 'hollow' pairs consecutive hits by position (enter/exit/enter/exit...), independent of face orientation: this is the
    // standard even-odd solid test, so it keeps a concave interior (a cup, a bowl) hollow even on a mesh whose winding is
    // locally scrambled (flipped faces, near-duplicate surfaces, stray non-manifold geometry — common on generated/scanned
    // assets) and does not pass the stricter `alt()` orientation check. A trailing unpaired hit (odd count) is dropped.
    // `alt`/`first` above are kept only to report `bad` (diagnostic); they no longer gate which pairing rule is used.
    if (o.mode === 'hollow') { const m = b - a - ((b - a) % 2); for (let p = a; p < a + m; p += 2) pairs.push([Y[p], Y[p + 1]]); }
    else pairs.push([Y[a], Y[b - 1]]);
    const merged = [];
    for (const [lo, hi] of pairs) {
      if (merged.length && lo - merged[merged.length - 1][1] < o.minGap) merged[merged.length - 1][1] = hi;
      else merged.push([lo, hi]);
    }
    let lmin = nl, lmax = -1;
    for (let k = 0; k < merged.length; k++) {
      let [lo, hi] = merged[k];
      if (k === 0 && (lo <= o.snap || b - a === 1)) lo = 0;
      else if (o.minThick && hi - lo < 0.8 * PLATE) { lo = Math.floor((lo + hi) / 2 / PLATE) * PLATE; hi = lo + PLATE; }
      const l0 = Math.max(0, Math.floor(lo / PLATE)), l1 = Math.min(nl - 1, Math.floor(hi / PLATE));
      for (let l = l0; l <= l1; l++) {
        const v = Math.max(0, Math.min(hi, (l + 1) * PLATE) - Math.max(lo, l * PLATE)) / PLATE;
        if (v > 0) { add(l, v); if (l < lmin) lmin = l; if (l > lmax) lmax = l; }
      }
    }
    for (let l = lmin; l <= lmax; l++) { M[(l * NZ + iz) * NX + ix] += col[l] * w; col[l] = 0; }
  }
  return { M, bad: 1 - valid };
}

/** ray cast ONCE on a padded grid; grid phases are windows of it. sym = { ax: 0|2, plane, parity } aligns the mirror plane. */
export function prepare(model, n, o, sym = null) {
  const shift = [0, 0]; let mirror = null;
  if (sym) {
    const { lo, hi } = bounds(model.tris);
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const s0 = n * STUD / (o.ref === 'min3' ? Math.min(...ext) : Math.max(ext[0], ext[2]));
    const pn = (sym.plane - lo[sym.ax]) * s0 + PAD;
    const target = sym.parity === 'even' ? 0 : STUD / 2;
    const sh = (((target - pn) % STUD) + STUD) % STUD;
    shift[sym.ax === 0 ? 0 : 1] = sh;
    mirror = { ax: sym.ax, planePadded: pn + sh, parity: sym.parity };
  }
  const nm = normalize(model.tris, model.pts, n, PAD + shift[0], PAD + shift[1], o.ref);
  const { hi } = bounds(nm.tris);
  const nxc = Math.ceil((hi[0] + PAD + STUD) / STUD), nzc = Math.ceil((hi[2] + PAD + STUD) / STUD);
  const nl = Math.ceil(hi[1] / PLATE) + 1;
  let { M, bad } = spansVolume(nm.tris, nxc, nzc, nl, o);
  const NX = nxc * G, NZ = nzc * G;
  if (o.fieldSmooth) M = smoothField(M, nl, NZ, NX, o.fieldSmooth, o.fieldSmoothThin ?? 0.5);
  const P = new Uint16Array(M.length);            // surface-point splat (thin features thinner than the ray spacing)
  for (let k = 0; k < nm.pts.length; k += 3) {
    const ix = Math.min(NX - 1, Math.max(0, Math.floor(nm.pts[k] / SAMP))), iz = Math.min(NZ - 1, Math.max(0, Math.floor(nm.pts[k + 2] / SAMP)));
    const il = Math.min(nl - 1, Math.max(0, Math.floor(nm.pts[k + 1] / PLATE)));
    const idx = (il * NZ + iz) * NX + ix; if (P[idx] < 65535) P[idx]++;
  }
  let crust = null, Mfull = null;
  if (o.crust) { Mfull = M.slice(); crust = carveCrust(M, nl, NZ, NX, o.crustDepth ?? 40); if (!crust.voxels) Mfull = null; }
  let T = null, islands = null;
  if (o.islands) { const r = connectIslands(M, P, nl, NZ, NX, o); T = r.T; islands = r.stats; }
  else if (o.decimate ?? true) { islands = decimateFloaters(M, P, nl, NZ, NX, o).stats; }
  return { M, Mfull, P, T, islands, crust, nl, NX, NZ, ext0: [hi[0] - PAD, hi[1], hi[2] - PAD], s: nm.s, bad, shift, mirror };
}

/** crop of the padded field for grid phase (ox, oz) */
export function window(pre, ox, oz, key = 'M') {
  const a = Math.round((PAD - ox) / SAMP), b = Math.round((PAD - oz) / SAMP);
  const nxo = Math.ceil((pre.ext0[0] + ox) / STUD), nzo = Math.ceil((pre.ext0[2] + oz) / STUD);
  const src = pre[key]; if (!src) return { arr: null, nxc: nxo, nzc: nzo };
  const nx = nxo * G, nz = nzo * G, nl = pre.nl;
  const out = new (key === 'P' ? Uint16Array : key === 'T' ? Uint8Array : Float32Array)(nl * nz * nx);
  for (let l = 0; l < nl; l++) for (let z = 0; z < nz; z++) {
    const sz = z + b; if (sz >= pre.NZ) continue;
    const so = (l * pre.NZ + sz) * pre.NX + a, d = (l * nz + z) * nx;
    const len = Math.min(nx, pre.NX - a);
    out.set(src.subarray(so, so + len), d);
  }
  return { arr: out, nxc: nxo, nzc: nzo };
}

/** average with the mirror image about the plane at c2 * STUD / 2 (sample k <-> 5*c2 - 1 - k) */
export function symmetrize(M, nl, nz, nx, ax, c2) {
  const out = new Float32Array(M.length);
  for (let l = 0; l < nl; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const idx = (l * nz + z) * nx + x;
    let m = 0;
    if (ax === 0) { const xm = G * c2 - 1 - x; if (xm >= 0 && xm < nx) m = M[(l * nz + z) * nx + xm]; }
    else { const zm = G * c2 - 1 - z; if (zm >= 0 && zm < nz) m = M[(l * nz + zm) * nx + x]; }
    out[idx] = (M[idx] + m) / 2;
  }
  return out;
}

/** blend a cell with the mean of its 4 lateral neighbours at weight w, but ONLY where that neighbourhood is sparse
 *  (mean <= `thin`). The field is one vertical ray per cell, so a feature thinner than a cell lands in whichever cell the
 *  ray happens to catch: its column wanders with sub-cell phase, which is why thin struts came out as staircases of plates
 *  instead of poles. Averaging laterally pulls such a feature back onto its centre. A cell inside a surface or a solid body
 *  is sampled reliably and is left exactly as it was, so this costs no fidelity where there is nothing to fix. (This is the
 *  symmetry-free form of what averaging the field with its mirror did by accident on near-symmetric meshes - docs/MOTIFS.md.) */
export function smoothField(M, nl, nz, nx, w, thin = 0.5) {
  if (!(w > 0)) return M;
  const out = new Float32Array(M.length);
  for (let l = 0; l < nl; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = (l * nz + z) * nx + x;
    const a = x > 0 ? M[i - 1] : 0, b = x < nx - 1 ? M[i + 1] : 0, c = z > 0 ? M[i - nx] : 0, d = z < nz - 1 ? M[i + nx] : 0;
    const s = (a + b + c + d) / 4;
    out[i] = s <= thin ? (1 - w) * M[i] + w * s : M[i];
  }
  return out;
}

/** hollow core: erase every solid voxel deeper than `depth` LDU from the nearest air (or the grid boundary, the ground included),
 *  so the solver only fills a shell. Multi-source Dijkstra from the air voxels, steps cost 4 LDU in x / z and 8 LDU in level. */
export function carveCrust(M, nl, NZ, NX, depth) {
  const N = nl * NZ * NX, plane = NZ * NX, solid = new Uint8Array(N);
  let fill = 0; for (let k = 0; k < N; k++) { if (M[k] > 0.5) solid[k] = 1; fill += M[k]; }
  const INF = 1 << 30, dist = new Int32Array(N).fill(INF), unit = SAMP, maxD = Math.ceil(depth / unit);
  const buckets = Array.from({ length: maxD + 3 }, () => []);
  const push = (v, d) => { if (d < dist[v]) { dist[v] = d; if (d <= maxD + 1) buckets[d].push(v); } };
  // sources: solid voxels touching air or the boundary start at one step (4 LDU sideways, 8 LDU vertically)
  for (let v = 0; v < N; v++) {
    if (!solid[v]) continue;
    const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
    if (x === 0 || x === NX - 1 || !solid[v - 1] || !solid[v + 1] || z === 0 || z === NZ - 1 || !solid[v - NX] || !solid[v + NX]) push(v, 1);
    else if (l === 0 || l === nl - 1 || !solid[v - plane] || !solid[v + plane]) push(v, 2);
  }
  for (let c = 0; c < buckets.length; c++) {
    const bk = buckets[c];
    for (let q = 0; q < bk.length; q++) {
      const v = bk[q]; if (dist[v] !== c) continue;
      const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
      if (x + 1 < NX && solid[v + 1]) push(v + 1, c + 1);
      if (x > 0 && solid[v - 1]) push(v - 1, c + 1);
      if (z + 1 < NZ && solid[v + NX]) push(v + NX, c + 1);
      if (z > 0 && solid[v - NX]) push(v - NX, c + 1);
      if (l + 1 < nl && solid[v + plane]) push(v + plane, c + 2);
      if (l > 0 && solid[v - plane]) push(v - plane, c + 2);
    }
  }
  let removed = 0, voxels = 0;
  for (let v = 0; v < N; v++) if (solid[v] && dist[v] > maxD) { removed += M[v]; M[v] = 0; voxels++; }
  return { depth, voxels, frac: fill ? removed / fill : 0 };
}
