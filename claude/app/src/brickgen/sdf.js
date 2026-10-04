// A signed distance field as the shape representation behind the volume field M (option `field: 'sdf'`), instead of one vertical
// ray per 4-LDU cell.
//
// Why: the ray field point-samples the surface in x / z, so a surface detail (or grain) smaller than a cell lands in whichever cell
// the ray happens to catch, and a 2 LDU translation of the mesh "changes" half of the cells (test/noise_bench.mjs). A distance
// field knows, in every cell, how far the surface is and on which side; the occupancy of a cell follows from that continuously
// (a linear ramp over the cell width, the usual anti-aliased box), and - the point of the exercise - a distance field can be
// low-pass filtered: a Gaussian of a few LDU on an SDF moves its zero set onto the *mean* surface and stays a near-SDF, where the
// same filter on an occupancy field only erodes thin things. The same grid, filtered harder, is the coarse field of the cascade
// (run.js `fieldCascade`), and the same consumer accepts a grid fitted elsewhere (claude/siren/fit_siren.py: a SIREN whose omega_0
// is the bandwidth). docs/IMPLICIT.md has the design and the measurements, docs/papers/IMPLICIT_FIELDS_AND_MESH_DENOISING.md the sources.
//
// Layout: the SDF grid is isotropic at SAMP (4 LDU) in x, y, z: `d[(y * NZ + z) * NX + x]`, NY = 2 * nl slices (two per plate),
// in the same padded frame as grid.prepare. Values are in LDU, negative inside, clamped to +-(band + 1) * SAMP away from the surface.
import { SAMP, PLATE, G } from './constants.js';
import { columnHits, spansToLevels } from './grid.js';

/** split every triangle whose longest edge exceeds `maxEdge` (midpoint of the longest edge, recursively) so that bucketing by cell is tight */
export function subdivide(tris, maxEdge) {
  const out = [], m2 = maxEdge * maxEdge, stack = [];
  const push = (a, b, c) => stack.push([a, b, c]);
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  for (let t = 0; t < tris.length; t += 9) {
    push([tris[t], tris[t + 1], tris[t + 2]], [tris[t + 3], tris[t + 4], tris[t + 5]], [tris[t + 6], tris[t + 7], tris[t + 8]]);
    while (stack.length) {
      const [a, b, c] = stack.pop(), ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), mx = Math.max(ab, bc, ca);
      if (mx <= m2) { out.push(...a, ...b, ...c); continue; }
      if (mx === ab) { const m = mid(a, b); push(a, m, c); push(m, b, c); }
      else if (mx === bc) { const m = mid(b, c); push(a, b, m); push(a, m, c); }
      else { const m = mid(c, a); push(a, b, m); push(m, b, c); }
    }
  }
  return new Float32Array(out);
}

/** squared distance from point p to triangle (a, b, c) - Ericson, Real-Time Collision Detection 5.1.5 */
function pointTriangleD2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const qx = apx - v * abx, qy = apy - v * aby, qz = apz - v * abz; return qx * qx + qy * qy + qz * qz; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz; return qx * qx + qy * qy + qz * qz; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const qx = bpx - w * (cx - bx), qy = bpy - w * (cy - by), qz = bpz - w * (cz - bz); return qx * qx + qy * qy + qz * qz; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  const qx = apx - v * abx - w * acx, qy = apy - v * aby - w * acy, qz = apz - v * abz - w * acz;
  return qx * qx + qy * qy + qz * qz;
}

/** unsigned distance (LDU) from every cell centre of the NX x NY x NZ grid (step SAMP) to the mesh, exact within `band` cells of the
 *  surface, (band + 1) * SAMP beyond. Triangles are bucketed by the cells their bounding box covers after subdivision to one cell. */
export function unsignedDistance(tris, NX, NY, NZ, band = 2) {
  const T = subdivide(tris, SAMP), nt = T.length / 9, N = NX * NY * NZ;
  const idx = (x, y, z) => (y * NZ + z) * NX + x;
  // bucket: cell -> list of triangles whose bbox touches it (CSR)
  const count = new Int32Array(N + 1), cellOf = [];
  const cellRange = (t) => {
    const o = t * 9;
    const x0 = Math.max(0, Math.floor(Math.min(T[o], T[o + 3], T[o + 6]) / SAMP)), x1 = Math.min(NX - 1, Math.floor(Math.max(T[o], T[o + 3], T[o + 6]) / SAMP));
    const y0 = Math.max(0, Math.floor(Math.min(T[o + 1], T[o + 4], T[o + 7]) / SAMP)), y1 = Math.min(NY - 1, Math.floor(Math.max(T[o + 1], T[o + 4], T[o + 7]) / SAMP));
    const z0 = Math.max(0, Math.floor(Math.min(T[o + 2], T[o + 5], T[o + 8]) / SAMP)), z1 = Math.min(NZ - 1, Math.floor(Math.max(T[o + 2], T[o + 5], T[o + 8]) / SAMP));
    return [x0, x1, y0, y1, z0, z1];
  };
  for (let t = 0; t < nt; t++) { const [x0, x1, y0, y1, z0, z1] = cellRange(t); for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) count[idx(x, y, z) + 1]++; }
  for (let c = 0; c < N; c++) count[c + 1] += count[c];
  const list = new Int32Array(count[N]), fill = count.slice(0, N);
  for (let t = 0; t < nt; t++) { const [x0, x1, y0, y1, z0, z1] = cellRange(t); for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) list[fill[idx(x, y, z)]++] = t; }
  // the band: cells within `band` of a bucketed cell (Chebyshev), by dilation
  const far = (band + 1) * SAMP, d = new Float32Array(N).fill(far), near = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (count[c + 1] > count[c]) near[c] = 1;
  let ring = near.slice();
  for (let r = 0; r < band; r++) {
    const next = ring.slice();
    for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      if (!ring[idx(x, y, z)]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X >= 0 && X < NX && Y >= 0 && Y < NY && Z >= 0 && Z < NZ) next[idx(X, Y, Z)] = 1;
      }
    }
    ring = next;
  }
  // exact distance for band cells: search buckets in growing Chebyshev rings until one is found, then one ring more (a nearer
  // triangle can sit in the next ring at a corner), and take the minimum
  const R = band + 1;
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const c = idx(x, y, z); if (!ring[c]) continue;
    const px = (x + 0.5) * SAMP, py = (y + 0.5) * SAMP, pz = (z + 0.5) * SAMP;
    let best = far * far, found = -1;
    for (let r = 0; r <= R; r++) {
      if (found >= 0 && r > found + 1) break;
      for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;              // the shell of the ring only
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || X >= NX || Y < 0 || Y >= NY || Z < 0 || Z >= NZ) continue;
        const b = idx(X, Y, Z);
        for (let p = count[b]; p < count[b + 1]; p++) {
          const o = list[p] * 9;
          const q = pointTriangleD2(px, py, pz, T[o], T[o + 1], T[o + 2], T[o + 3], T[o + 4], T[o + 5], T[o + 6], T[o + 7], T[o + 8]);
          if (q < best) { best = q; if (found < 0) found = r; }
        }
      }
    }
    d[c] = Math.min(far, Math.sqrt(best));
  }
  return d;
}

/** inside / outside per 4-LDU slice from the same vertical ray pairing the ray field uses (even-odd), so both fields agree on what
 *  is solid; returns Uint8Array(NX*NY*NZ), 1 = inside */
export function insideMask(tris, NX, NY, NZ, o) {
  const { start, Y, F } = columnHits(tris, NX, NZ, SAMP), inside = new Uint8Array(NX * NY * NZ);
  for (let c = 0; c < NX * NZ; c++) {
    const a = start[c], b = start[c + 1]; if (a === b) continue;
    const iz = Math.floor(c / NX), ix = c % NX, pairs = [];
    if (o.mode === 'hollow') { const m = b - a - ((b - a) % 2); for (let p = a; p < a + m; p += 2) pairs.push([Y[p], Y[p + 1]]); }
    else pairs.push([Y[a], Y[b - 1]]);
    for (let k = 0; k < pairs.length; k++) {
      let [lo, hi] = pairs[k];
      if (k === 0 && (lo <= o.snap || b - a === 1)) lo = 0;                                   // ground snap, as grid.spansVolume
      const y0 = Math.max(0, Math.round(lo / SAMP)), y1 = Math.min(NY, Math.round(hi / SAMP));
      for (let y = y0; y < y1; y++) inside[(y * NZ + iz) * NX + ix] = 1;
    }
  }
  return inside;
}

/** median over the (2r+1)^3 neighbourhood, clamp-to-edge; in place. Edge-preserving: grain and isolated flips go, a ridge or an
 *  eave keeps its position, where a Gaussian of the same support rounds it off by about its sigma (noise_bench: the Gaussian's
 *  remaining error against the clean house sat entirely on the ridge, the eaves and the floor edge). */
export function median3(a, NX, NY, NZ, r = 1) {
  if (!(r > 0)) return a;
  const out = new Float32Array(a.length), n = (2 * r + 1) ** 3, buf = new Float32Array(n), mid = n >> 1;
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    let q = 0;
    for (let dy = -r; dy <= r; dy++) { const Y = Math.min(NY - 1, Math.max(0, y + dy)); for (let dz = -r; dz <= r; dz++) { const Z = Math.min(NZ - 1, Math.max(0, z + dz)); for (let dx = -r; dx <= r; dx++) { const X = Math.min(NX - 1, Math.max(0, x + dx)); buf[q++] = a[(Y * NZ + Z) * NX + X]; } } }
    // quickselect for the median
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const pivot = buf[(lo + hi) >> 1]; let i = lo, j = hi;
      while (i <= j) { while (buf[i] < pivot) i++; while (buf[j] > pivot) j--; if (i <= j) { const t = buf[i]; buf[i] = buf[j]; buf[j] = t; i++; j--; } }
      if (mid <= j) hi = j; else if (mid >= i) lo = i; else break;
    }
    out[(y * NZ + z) * NX + x] = buf[mid];
  }
  a.set(out);
  return a;
}

/** separable Gaussian, sigma in cells, clamp-to-edge; in place */
export function blur3(a, NX, NY, NZ, sigma) {
  if (!(sigma > 0)) return a;
  const r = Math.max(1, Math.ceil(3 * sigma)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(a.length), idx = (x, y, z) => (y * NZ + z) * NX + x;
  const pass = (src, dst, nx, ny, nz, ax) => {
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) {
        const X = ax === 0 ? Math.min(nx - 1, Math.max(0, x + i)) : x, Y = ax === 1 ? Math.min(ny - 1, Math.max(0, y + i)) : y, Z = ax === 2 ? Math.min(nz - 1, Math.max(0, z + i)) : z;
        v += k[i + r] * src[idx(X, Y, Z)];
      }
      dst[idx(x, y, z)] = v;
    }
  };
  pass(a, tmp, NX, NY, NZ, 0); pass(tmp, a, NX, NY, NZ, 1); pass(a, tmp, NX, NY, NZ, 2); a.set(tmp);
  return a;
}

/** occupancy per plate level from the SDF, quantised EXACTLY like the ray field: per sample column the solid intervals are the
 *  stretches where d < 0, their ends interpolated between slices (d is a distance, so linear interpolation of its zero crossing is
 *  accurate to a fraction of a slice), and the same span -> level rule as grid.spansVolume turns them into fractional fills. The
 *  part templates (variants.baseVolume) are voxelised by that same scheme - exact in y, point-sampled in x / z - so this is the only
 *  quantisation under which a residual against them means anything. (`ramp` > 0 instead gives the anti-aliased cube fill
 *  clamp(1/2 - d / ramp), two slices averaged per plate: smoother, but it systematically mismatches the templates on slopes.)
 *  Returns M[level][z][x] in the layout grid.prepare / the solver expect. */
export function occupancyFromSDF(d, NX, NY, NZ, nl, o = {}, ramp = 0) {
  const M = new Float32Array(nl * NZ * NX);
  if (ramp > 0) {
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      let f = 0;
      for (let s = 0; s < 2; s++) { const y = 2 * l + s; if (y < NY) f += Math.min(1, Math.max(0, 0.5 - d[(y * NZ + z) * NX + x] / ramp)); }
      M[(l * NZ + z) * NX + x] = f / 2;
    }
    return M;
  }
  const col = new Float32Array(nl), opt = { minGap: o.minGap ?? 0, snap: o.snap ?? 0, minThick: o.minThick ?? false };
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    // zero crossings of d along the column; a slice centre sits at (y + 0.5) * SAMP
    const pairs = []; let lo = null, prev = d[(0 * NZ + z) * NX + x];
    if (prev < 0) lo = 0;                                                       // solid from the ground
    for (let y = 1; y < NY; y++) {
      const cur = d[(y * NZ + z) * NX + x];
      if (prev >= 0 && cur < 0) lo = ((y - 0.5) + prev / (prev - cur)) * SAMP;      // entering the solid
      else if (prev < 0 && cur >= 0 && lo !== null) { pairs.push([lo, ((y - 0.5) + prev / (prev - cur)) * SAMP]); lo = null; }
      prev = cur;
    }
    if (lo !== null) pairs.push([lo, NY * SAMP]);
    if (!pairs.length) continue;
    const [lmin, lmax] = spansToLevels(pairs, false, nl, opt, col);
    for (let l = lmin; l <= lmax; l++) { M[(l * NZ + z) * NX + x] = col[l]; col[l] = 0; }
  }
  return M;
}

/** trilinear sample of an external SDF grid { nx, ny, nz, origin: [x,y,z], step, data } at a point in ITS frame */
export function sampleGrid(g, x, y, z) {
  const fx = (x - g.origin[0]) / g.step, fy = (y - g.origin[1]) / g.step, fz = (z - g.origin[2]) / g.step;
  const x0 = Math.min(g.nx - 1, Math.max(0, Math.floor(fx))), y0 = Math.min(g.ny - 1, Math.max(0, Math.floor(fy))), z0 = Math.min(g.nz - 1, Math.max(0, Math.floor(fz)));
  const x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1), z1 = Math.min(g.nz - 1, z0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)), tz = Math.min(1, Math.max(0, fz - z0));
  const at = (i, j, k) => g.data[(k * g.ny + j) * g.nx + i];
  const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx, c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
  const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx, c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
  return ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz);
}

/**
 * The SDF on the engine's padded grid, from either the normalised mesh (exact distances + ray parity sign) or an external grid
 * given in the ORIGINAL model frame (`o.sdfGrid`, resampled through the normalisation `nm` = { s, lo } and the frame offset).
 * Returns { d, NX, NY, NZ }; `o.sdfSigma` (LDU) is applied here when > 0.
 */
export function buildSDF(nmTris, nxc, nzc, nl, o, frame = null) {
  const NX = nxc * G, NZ = nzc * G, NY = 2 * nl;
  let d;
  if (o.sdfGrid && frame) {
    const g = o.sdfGrid, { s, lo, ox, oz } = frame; d = new Float32Array(NX * NY * NZ);
    for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      // engine (padded, normalised) -> model frame: p_model = (p_engine - offset) / s + lo
      const X = ((x + 0.5) * SAMP - ox) / s + lo[0], Yv = ((y + 0.5) * SAMP) / s + lo[1], Z = ((z + 0.5) * SAMP - oz) / s + lo[2];
      d[(y * NZ + z) * NX + x] = sampleGrid(g, X, Yv, Z) * s;                               // distances scale with the model
    }
  } else {
    d = unsignedDistance(nmTris, NX, NY, NZ, o.sdfBand ?? 2);
    const inside = insideMask(nmTris, NX, NY, NZ, o);
    for (let k = 0; k < d.length; k++) if (inside[k]) d[k] = -d[k];
  }
  if (o.sdfMedian > 0) median3(d, NX, NY, NZ, Math.round(o.sdfMedian));            // edge-preserving first ...
  if (o.sdfSigma > 0) blur3(d, NX, NY, NZ, o.sdfSigma / SAMP);                       // ... then whatever Gaussian is asked for
  return { d, NX, NY, NZ };
}
