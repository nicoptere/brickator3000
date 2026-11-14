// Small field utilities: exact Euclidean distance transform (Felzenszwalb & Huttenlocher 2012), signed distance of a voxel mask,
// separable Gaussian blur, trilinear sampling, and naive surface nets (Gibson 1998) to draw an isosurface.

const INF = 1e20;
/** 1-D squared distance transform of f (length n) into d, with scratch v (Int32) / z (Float64) */
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** squared Euclidean distance (in voxels) from every voxel to the nearest voxel with seed[i] = 1; index (y * nz + z) * nx + x */
export function edt2(seed, nx, ny, nz) {
  const N = nx * ny * nz, D = new Float64Array(N);
  for (let i = 0; i < N; i++) D[i] = seed[i] ? 0 : INF;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (n, count, at) => {
    for (let c = 0; c < count; c++) {
      for (let q = 0; q < n; q++) f[q] = D[at(c, q)];
      dt1(f, n, d, v, z);
      for (let q = 0; q < n; q++) D[at(c, q)] = d[q];
    }
  };
  pass(nx, ny * nz, (c, q) => c * nx + q);                                          // rows along x
  pass(nz, nx * ny, (c, q) => { const y = (c / nx) | 0, x = c % nx; return (y * nz + q) * nx + x; });   // along z
  pass(ny, nx * nz, (c, q) => { const zz = (c / nx) | 0, x = c % nx; return (q * nz + zz) * nx + x; }); // along y
  return D;
}

/** signed distance (voxels; < 0 inside) of a binary mask: distance between voxel centres and the other set, minus half a voxel */
export function signedDistance(inside, nx, ny, nz) {
  const N = nx * ny * nz, out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = inside[i] ? 0 : 1;
  const din = edt2(out, nx, ny, nz), dout = edt2(inside, nx, ny, nz), s = new Float32Array(N);
  for (let i = 0; i < N; i++) s[i] = inside[i] ? -(Math.sqrt(din[i]) - 0.5) : Math.sqrt(dout[i]) - 0.5;
  return s;
}

/** separable Gaussian blur (sigma in voxels), clamp-to-edge; returns a new Float32Array */
export function blur3(a, nx, ny, nz, sigma) {
  if (!(sigma > 0)) return Float32Array.from(a);
  const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1); let ks = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); ks += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  let src = Float32Array.from(a), dst = new Float32Array(a.length);
  const axis = (n, stride, outer) => {
    for (const base of outer) for (let q = 0; q < n; q++) {
      let s = 0; for (let t = -r; t <= r; t++) { const p = Math.min(n - 1, Math.max(0, q + t)); s += k[t + r] * src[base + p * stride]; }
      dst[base + q * stride] = s;
    }
    [src, dst] = [dst, src];
  };
  const bases = (fixA, nA, sA, fixB, nB, sB) => { const out = []; for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) out.push(i * sA + j * sB); return out; };
  axis(nx, 1, bases(0, ny, nz * nx, 0, nz, nx));
  axis(nz, nx, bases(0, ny, nz * nx, 0, nx, 1));
  axis(ny, nz * nx, bases(0, nz, nx, 0, nx, 1));
  return src;
}

/** trilinear sample of a grid { data, nx, ny, nz } at continuous voxel coordinates (voxel centres at integer + 0.5 NOT assumed: integer = sample) */
export function trilinear(g, x, y, z) {
  const { data, nx, ny, nz } = g;
  x = Math.min(nx - 1.0001, Math.max(0, x)); y = Math.min(ny - 1.0001, Math.max(0, y)); z = Math.min(nz - 1.0001, Math.max(0, z));
  const i = x | 0, j = y | 0, k = z | 0, fx = x - i, fy = y - j, fz = z - k;
  const at = (a, b, c) => data[(b * nz + c) * nx + a];
  const c00 = at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx, c10 = at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx;
  const c01 = at(i, j, k + 1) * (1 - fx) + at(i + 1, j, k + 1) * fx, c11 = at(i, j + 1, k + 1) * (1 - fx) + at(i + 1, j + 1, k + 1) * fx;
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}

/** naive surface nets: isosurface f = iso of a grid sampled at points origin + step * (x, y, z); returns { pos: Float32Array, idx: Uint32Array } */
export function surfaceNets(f, nx, ny, nz, iso = 0, origin = [0, 0, 0], step = 1) {
  const at = (x, y, z) => f[(y * nz + z) * nx + x] - iso;
  const vid = new Int32Array(nx * ny * nz).fill(-1), pos = [], idx = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const v = C.map(([a, b, c]) => at(x + a, y + b, z + c));
    let neg = 0; for (const q of v) if (q < 0) neg++;
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += C[a][0] + t * (C[b][0] - C[a][0]); sy += C[a][1] + t * (C[b][1] - C[a][1]); sz += C[a][2] + t * (C[b][2] - C[a][2]); n++;
    }
    vid[(y * nz + z) * nx + x] = pos.length / 3;
    pos.push(origin[0] + (x + sx / n) * step, origin[1] + (y + sy / n) * step, origin[2] + (z + sz / n) * step);
  }
  // one quad per sign-changing edge, between the 4 cells sharing it; winding from the sign (outward = towards f > iso)
  const cell = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx - 1 || y >= ny - 1 || z >= nz - 1 ? -1 : vid[(y * nz + z) * nx + x]);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = at(x, y, z) < 0;
    for (const [dx, dy, dz, q] of [[1, 0, 0, [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]]], [0, 1, 0, [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]]], [0, 0, 1, [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]]]]) {
      if (x + dx >= nx || y + dy >= ny || z + dz >= nz) continue;
      if (a === (at(x + dx, y + dy, z + dz) < 0)) continue;
      const ids = q.map(([u, w2, s]) => cell(x + u, y + w2, z + s));
      if (ids.some((i) => i < 0)) continue;
      if (a) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
    }
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}
