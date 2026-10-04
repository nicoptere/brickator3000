// Fractional volume field M[level][z][x] (5x5 samples per stud, one level per plate) from exact vertical ray hits.
import { STUD, PLATE, G, SAMP, PAD } from './constants.js';
import { bounds } from './mesh.js';
import { connectIslands, decimateFloaters } from './islands.js';
import { buildSDF, occupancyFromSDF, blur3 } from './sdf.js';

/** scale so the reference side = n studs; returns shifted copies (x += ox, z += oz) */
export function normalize(tris, pts, n, ox, oz, ref = 'min3', scale = null) {
  const { lo, hi } = bounds(tris);
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const base = ref === 'min3' ? Math.min(ext[0], ext[1], ext[2]) : Math.max(ext[0], ext[2]);
  const s = scale ?? n * STUD / base;
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
    const [lmin, lmax] = spansToLevels(pairs, b - a === 1, nl, o, col);
    for (let l = lmin; l <= lmax; l++) { M[(l * NZ + iz) * NX + ix] += col[l] * w; col[l] = 0; }
  }
  return { M, bad: 1 - valid };
}

/** solid intervals [lo, hi] (LDU, sorted) of one column -> fractional fill per plate level into `col` (clamped to 1; the caller
 *  zeroes it). The same rules for every field source (rays, sdf.js): close air thinner than minGap, snap the first interval to the
 *  ground when it is within `snap` of it (or when the column had a single hit), fatten sheets thinner than 0.8 plate to one plate.
 *  Returns the [first, last] level touched. */
export function spansToLevels(pairs, single, nl, o, col) {
  const merged = [];
  for (const [lo, hi] of pairs) {
    if (merged.length && lo - merged[merged.length - 1][1] < o.minGap) merged[merged.length - 1][1] = hi;
    else merged.push([lo, hi]);
  }
  let lmin = nl, lmax = -1;
  for (let k = 0; k < merged.length; k++) {
    let [lo, hi] = merged[k];
    if (k === 0 && (lo <= o.snap || single)) lo = 0;
    else if (o.minThick && hi - lo < 0.8 * PLATE) { lo = Math.floor((lo + hi) / 2 / PLATE) * PLATE; hi = lo + PLATE; }
    const l0 = Math.max(0, Math.floor(lo / PLATE)), l1 = Math.min(nl - 1, Math.floor(hi / PLATE));
    for (let l = l0; l <= l1; l++) {
      const v = Math.max(0, Math.min(hi, (l + 1) * PLATE) - Math.max(lo, l * PLATE)) / PLATE;
      if (v > 0) { col[l] = Math.min(1, col[l] + v); if (l < lmin) lmin = l; if (l > lmax) lmax = l; }
    }
  }
  return [lmin, lmax];
}

/** The sub-cell phase of a model's axis-aligned faces along `axis`: the shift in [0, period) that puts the most face area onto a
 *  grid boundary. Area-weighted histogram of the face centroids (faces whose normal is within ~25 deg of the axis) modulo `period`,
 *  smoothed by one bin. A flat face sitting at a fractional offset is what the one-ray-per-cell field turns into a mosaic of partial
 *  cells (test/noise_bench.mjs: 1 LDU of misalignment costs the clean house +60 % pieces) - the phase search in pipeline.setup only
 *  steps by whole cells, this is the sub-cell part. Returns { shift, share } where share is the aligned area fraction. */
export function alignShift(tris, s, lo, axis, period, bins = 16) {
  const hist = new Float64Array(bins); let total = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, a2 = Math.hypot(nx, ny, nz);
    if (a2 === 0) continue;
    const comp = axis === 0 ? nx : axis === 1 ? ny : nz;
    if (Math.abs(comp) / a2 < 0.9) continue;
    const c = ((tris[t + axis] + tris[t + 3 + axis] + tris[t + 6 + axis]) / 3 - lo[axis]) * s;      // normalised position of the face
    const ph = ((c % period) + period) % period;
    hist[Math.min(bins - 1, Math.floor(ph / period * bins))] += a2; total += a2;
  }
  if (!total) return { shift: 0, share: 0 };
  let best = 0, bv = -1;
  for (let b = 0; b < bins; b++) { const v = hist[(b + bins - 1) % bins] + 2 * hist[b] + hist[(b + 1) % bins]; if (v > bv) { bv = v; best = b; } }
  // exact phase: area-weighted circular mean of the faces in the winning bin and its two neighbours (a bin centre would be up to
  // half a bin off, and a shift of that size moves the stud phase too, which costs more than it saves)
  let cs = 0, sn = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, a2 = Math.hypot(nx, ny, nz);
    if (a2 === 0 || Math.abs(axis === 0 ? nx : axis === 1 ? ny : nz) / a2 < 0.9) continue;
    const c = ((tris[t + axis] + tris[t + 3 + axis] + tris[t + 6 + axis]) / 3 - lo[axis]) * s, ph = ((c % period) + period) % period;
    const b = Math.min(bins - 1, Math.floor(ph / period * bins)), db = Math.min(Math.abs(b - best), bins - Math.abs(b - best));
    if (db <= 1) { const ang = ph / period * 2 * Math.PI; cs += a2 * Math.cos(ang); sn += a2 * Math.sin(ang); }
  }
  const phase = ((Math.atan2(sn, cs) / (2 * Math.PI)) * period + period) % period;             // where the faces sit, in [0, period)
  const shift = phase < period / 2 ? -phase : period - phase;                                 // the smallest move onto a boundary, in [-period/2, period/2)
  return { shift, phase, share: hist[best] / total };
}

/** Fit the model to the LEGO lattice: the scale within +-tol of s0 (and, per axis, the shift) that puts the most planar face area on
 *  stud boundaries in x / z and on plate boundaries in y. Score of a scale = sum over the three axes of the circular resultant
 *  |sum a_f exp(2 pi i s p_f / period)| / sum a_f, which is 1 when every face of that axis is lattice-consistent and ~0 for random
 *  positions; the shift per axis is then the phase of that resultant. A model's bounding box is usually set by a beak or a tail, not
 *  by its dominant planes, so "longest side = N studs" leaves those planes at fractional positions - and a flat face at a fractional
 *  plate height is exactly what the one-ray-per-cell field renders as a mosaic of partial plates (test/noise_bench.mjs). */
export function latticeFit(tris, s0, lo, tol = 0.05, steps = 100, minGain = 0.1) {
  // planar faces per axis: [position, area]
  const faces = [[], [], []];
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], a2 = Math.hypot(n[0], n[1], n[2]);
    if (a2 === 0) continue;
    for (let ax = 0; ax < 3; ax++) if (Math.abs(n[ax]) / a2 >= 0.9) faces[ax].push([(tris[t + ax] + tris[t + 3 + ax] + tris[t + 6 + ax]) / 3 - lo[ax], a2]);
  }
  const period = [STUD, PLATE, STUD];
  const resultant = (ax, s) => { let c = 0, sn = 0, tot = 0; for (const [p, a] of faces[ax]) { const ang = 2 * Math.PI * s * p / period[ax]; c += a * Math.cos(ang); sn += a * Math.sin(ang); tot += a; } return tot ? { r: Math.hypot(c, sn) / tot, phase: Math.atan2(sn, c) / (2 * Math.PI) * period[ax], tot } : { r: 0, phase: 0, tot: 0 }; };
  const scoreAt = (s) => {
    const rx = resultant(0, s), rz = resultant(2, s);
    // y is anchored to the ground (the model stands on it), so only its scale can help: score the plate phase at shift 0, i.e. the
    // real part of the resultant, instead of its magnitude
    let cy = 0, ty = 0; for (const [p, a] of faces[1]) { cy += a * Math.cos(2 * Math.PI * s * p / PLATE); ty += a; }
    return { s, score: rx.r + rz.r + (ty ? cy / ty : 0), rx, rz, ry: { r: ty ? cy / ty : 0 } };
  };
  const base = scoreAt(s0); let best = base;
  for (let k = 0; k <= steps; k++) { const c = scoreAt(s0 * (1 - tol + 2 * tol * k / steps)); if (c.score > best.score) best = c; }
  // do no harm: a model with few planar faces (an aircraft, an animal) scores ~0.3 everywhere and would be rescaled on noise; keep
  // the default scale unless the lattice fit gains at least `minGain` (the x / z shifts at that scale are always applied: they
  // never change the model, only where the grid sits)
  if (best.score - base.score < minGain) best = base;
  const shiftOf = (res) => { const ph = ((res.phase % STUD) + STUD) % STUD; return ph < STUD / 2 ? -ph : STUD - ph; };   // smallest move onto a boundary
  return { s: best.s, s0, shift: [shiftOf(best.rx), shiftOf(best.rz)], score: best.score, score0: base.score, aligned: { x: best.rx.r, y: best.ry.r, z: best.rz.r }, faces: faces.map((f) => f.length) };
}

/** ray cast ONCE on a padded grid; grid phases are windows of it. sym = { ax: 0|2, plane, parity } aligns the mirror plane. */
export function prepare(model, n, o, sym = null) {
  const shift = [0, 0]; let mirror = null, align = null;
  const { lo, hi: hi0 } = bounds(model.tris);
  const ext = [hi0[0] - lo[0], hi0[1] - lo[1], hi0[2] - lo[2]];
  const s0 = n * STUD / (o.ref === 'min3' ? Math.min(...ext) : Math.max(ext[0], ext[2]));
  let scale = null;
  if (o.gridAlign && typeof o.gridAlign === 'object' && !Array.isArray(o.gridAlign)) { scale = o.gridAlign.s; shift[0] = o.gridAlign.shift[0]; shift[1] = o.gridAlign.shift[1]; align = { ...o.gridAlign, given: true }; }   // a frame decided elsewhere (tests: the same frame for two meshes)
  else if (o.gridAlign) {
    // snap the model to the LEGO lattice: a scale within +-alignTol of "longest side = N studs" and the smallest x / z shifts that
    // put the dominant planar faces on stud boundaries (and the dominant horizontal faces on plate heights). The whole-sample phase
    // search in pipeline.setup is then a refinement for models whose faces disagree; the mirror plane, when there is one, owns its axis
    align = latticeFit(model.tris, s0, lo, o.alignTol ?? 0.05, 100, o.alignMinGain ?? 0.15);
    scale = align.s;
    if (!sym || sym.ax !== 0) shift[0] = align.shift[0];
    if (!sym || sym.ax !== 2) shift[1] = align.shift[1];
  }
  if (sym) {
    const pn = (sym.plane - lo[sym.ax]) * (scale ?? s0) + PAD;
    const target = sym.parity === 'even' ? 0 : STUD / 2;
    const sh = (((target - pn) % STUD) + STUD) % STUD;
    shift[sym.ax === 0 ? 0 : 1] = sh;
    mirror = { ax: sym.ax, planePadded: pn + sh, parity: sym.parity };
  }
  const nm = normalize(model.tris, model.pts, n, PAD + shift[0], PAD + shift[1], o.ref, scale);
  const { hi } = bounds(nm.tris);
  const nxc = Math.ceil((hi[0] + PAD + STUD) / STUD), nzc = Math.ceil((hi[2] + PAD + STUD) / STUD);
  const nl = Math.ceil(hi[1] / PLATE) + 1;
  let { M, bad } = spansVolume(nm.tris, nxc, nzc, nl, o);
  const NX = nxc * G, NZ = nzc * G;
  let sdf = null, Mcoarse = null;
  if (o.field === 'sdf') {
    // the shape as a signed distance field (sdf.js): occupancy follows from distance, continuously, and can be low-pass filtered
    // without eroding thin features the way filtering occupancy does. `sdfSigma` LDU is the filter for the field the solver sees;
    // `cascadeSigma` LDU a stronger one for the coarse field the broad phases see (run.js `fieldCascade`).
    sdf = buildSDF(nm.tris, nxc, nzc, nl, o, { s: nm.s, lo: nm.lo, ox: PAD + shift[0], oz: PAD + shift[1] });
    M = occupancyFromSDF(sdf.d, sdf.NX, sdf.NY, sdf.NZ, nl, o, o.sdfRamp ?? 0);
    if (o.fieldCascade && o.cascadeSigma > 0) {
      const dc = blur3(sdf.d.slice(), sdf.NX, sdf.NY, sdf.NZ, o.cascadeSigma / SAMP);
      Mcoarse = occupancyFromSDF(dc, sdf.NX, sdf.NY, sdf.NZ, nl, o, o.sdfRamp ?? 0);
    }
  }
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
  return { M, Mfull, Mcoarse, sdf, P, T, islands, crust, nl, NX, NZ, ext0: [hi[0] - PAD, hi[1], hi[2] - PAD], s: nm.s, lo: nm.lo, bad, shift, mirror, align };
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
