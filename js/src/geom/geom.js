// Mesh utilities on flat typed arrays.
// A mesh is { V: Float64Array(3*nv), F: Int32Array(3*nf) }, LDU, Y up.

const hyp = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);

export function parseOBJ(text) {
  const V = [], F = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = n;
    const c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1);
    if (c0 === 118 && c1 === 32) { // 'v '
      const p = text.slice(i + 2, j).trim().split(/\s+/);
      V.push(+p[0], +p[1], +p[2]);
    } else if (c0 === 102 && c1 === 32) { // 'f '
      const p = text.slice(i + 2, j).trim().split(/\s+/);
      const idx = p.map(s => { const k = parseInt(s, 10); return k < 0 ? V.length / 3 + k : k - 1; });
      for (let t = 1; t + 1 < idx.length; t++) F.push(idx[0], idx[t], idx[t + 1]);
    }
    i = j + 1;
  }
  return { V: Float64Array.from(V), F: Int32Array.from(F) };
}

export function bbox(V) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const x = V[i + k];
      if (x < lo[k]) lo[k] = x;
      if (x > hi[k]) hi[k] = x;
    }
  return { lo, hi };
}

/** Face normals (unit) and areas. */
export function faceNormals(V, F) {
  const m = F.length / 3;
  const N = new Float64Array(3 * m), A = new Float64Array(m);
  for (let f = 0; f < m; f++) {
    const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = hyp(nx, ny, nz);
    A[f] = 0.5 * l;
    const s = l > 1e-12 ? 1 / l : 0;
    N[3 * f] = nx * s; N[3 * f + 1] = ny * s; N[3 * f + 2] = nz * s;
  }
  return { N, A };
}

export function vertexAreas(V, F, FA) {
  const va = new Float64Array(V.length / 3);
  for (let f = 0; f < F.length / 3; f++) {
    const a = FA[f] / 3;
    va[F[3 * f]] += a; va[F[3 * f + 1]] += a; va[F[3 * f + 2]] += a;
  }
  return va;
}

export function vertexNormals(V, F, FN, FA) {
  const n = V.length / 3, vn = new Float64Array(3 * n);
  for (let f = 0; f < F.length / 3; f++) {
    const w = FA[f];
    for (let j = 0; j < 3; j++) {
      const v = 3 * F[3 * f + j];
      vn[v] += FN[3 * f] * w; vn[v + 1] += FN[3 * f + 1] * w; vn[v + 2] += FN[3 * f + 2] * w;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = hyp(vn[3 * i], vn[3 * i + 1], vn[3 * i + 2]) || 1;
    vn[3 * i] /= l; vn[3 * i + 1] /= l; vn[3 * i + 2] /= l;
  }
  return vn;
}

export function centroids(V, F) {
  const m = F.length / 3, C = new Float64Array(3 * m);
  for (let f = 0; f < m; f++)
    for (let k = 0; k < 3; k++)
      C[3 * f + k] = (V[3 * F[3 * f] + k] + V[3 * F[3 * f + 1] + k] + V[3 * F[3 * f + 2] + k]) / 3;
  return C;
}

/**
 * Edge topology by counting sort on the smaller vertex.
 * Returns unique edges (e0, e1), per-face edge ids fe[3m] (edge j = (v[j], v[j+1])),
 * per-edge face count, and the face-adjacency pairs over edges with exactly 2 faces
 * (adjA, adjB, adjE = edge id).
 */
export function edgeTopology(F, nv) {
  const m = F.length / 3, h = 3 * m;
  const cnt = new Int32Array(nv + 1);
  for (let i = 0; i < h; i++) {
    const f = (i / 3) | 0, j = i - 3 * f;
    const a = F[i], b = F[3 * f + ((j + 1) % 3)];
    cnt[(a < b ? a : b) + 1]++;
  }
  for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
  const pos = cnt.slice(0, nv);
  const hiB = new Int32Array(h), heB = new Int32Array(h);
  for (let i = 0; i < h; i++) {
    const f = (i / 3) | 0, j = i - 3 * f;
    const a = F[i], b = F[3 * f + ((j + 1) % 3)];
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const p = pos[lo]++;
    hiB[p] = hi; heB[p] = i;
  }
  const fe = new Int32Array(h);
  const e0 = [], e1 = [], efc = [];
  for (let v = 0; v < nv; v++) {
    const s = cnt[v], t = cnt[v + 1];
    for (let p = s; p < t; p++) {
      if (hiB[p] < 0) continue;
      const hv = hiB[p], id = e0.length;
      e0.push(v); e1.push(hv);
      let c = 0;
      for (let q = p; q < t; q++) if (hiB[q] === hv) { fe[heB[q]] = id; hiB[q] = -1; c++; }
      efc.push(c);
    }
  }
  const ne = e0.length;
  const E0 = Int32Array.from(e0), E1 = Int32Array.from(e1), EC = Int32Array.from(efc);
  // first/second face per edge
  const ef = new Int32Array(2 * ne).fill(-1);
  for (let i = 0; i < h; i++) {
    const e = fe[i], f = (i / 3) | 0;
    if (ef[2 * e] < 0) ef[2 * e] = f; else if (ef[2 * e + 1] < 0) ef[2 * e + 1] = f;
  }
  let na = 0;
  for (let e = 0; e < ne; e++) if (EC[e] === 2) na++;
  const adjA = new Int32Array(na), adjB = new Int32Array(na), adjE = new Int32Array(na);
  for (let e = 0, k = 0; e < ne; e++) if (EC[e] === 2) { adjA[k] = ef[2 * e]; adjB[k] = ef[2 * e + 1]; adjE[k] = e; k++; }
  return { E0, E1, EC, fe, adjA, adjB, adjE, ne };
}

export function edgeLengths(V, E0, E1) {
  const L = new Float64Array(E0.length);
  for (let e = 0; e < E0.length; e++) {
    const a = 3 * E0[e], b = 3 * E1[e];
    L[e] = hyp(V[a] - V[b], V[a + 1] - V[b + 1], V[a + 2] - V[b + 2]);
  }
  return L;
}

/** Vertex adjacency (CSR) from unique edges. */
export function vertexAdjacency(nv, E0, E1) {
  const off = new Int32Array(nv + 1);
  for (let e = 0; e < E0.length; e++) { off[E0[e] + 1]++; off[E1[e] + 1]++; }
  for (let i = 0; i < nv; i++) off[i + 1] += off[i];
  const nb = new Int32Array(off[nv]), p = off.slice(0, nv);
  for (let e = 0; e < E0.length; e++) { nb[p[E0[e]]++] = E1[e]; nb[p[E1[e]]++] = E0[e]; }
  return { off, nb };
}

export function isWatertight(topo) {
  for (let e = 0; e < topo.EC.length; e++) if (topo.EC[e] !== 2) return false;
  return true;
}

export function volume(V, F) {
  let s = 0;
  for (let f = 0; f < F.length / 3; f++) {
    const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2];
    s += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1])
       - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c])
       + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return s / 6;
}

class UF {
  constructor(n) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(x) { const p = this.p; while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[a < b ? b : a] = a < b ? a : b; }
}
export { UF };

/** Weld identical positions (to ~1e-9 of the bbox), drop degenerate faces,
 *  unreferenced vertices and components below minFrac of the total area. */
export function clean(V, F, { minFrac = 0.002, weld = true } = {}) {
  let nv = V.length / 3;
  let remap = new Int32Array(nv);
  if (weld) {
    // hash on quantised positions (open addressing, no string keys)
    const { lo, hi } = bbox(V);
    const sc = 1e9 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-12);
    let cap = 1; while (cap < 2 * nv) cap <<= 1;
    const keys = new Int32Array(3 * cap), slot = new Int32Array(cap).fill(-1);
    for (let i = 0; i < nv; i++) {
      const ix = Math.round((V[3 * i] - lo[0]) * sc), iy = Math.round((V[3 * i + 1] - lo[1]) * sc), iz = Math.round((V[3 * i + 2] - lo[2]) * sc);
      let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
      while (slot[h] >= 0 && !(keys[3 * h] === ix && keys[3 * h + 1] === iy && keys[3 * h + 2] === iz)) h = (h + 1) & (cap - 1);
      if (slot[h] < 0) { slot[h] = i; keys[3 * h] = ix; keys[3 * h + 1] = iy; keys[3 * h + 2] = iz; remap[i] = i; }
      else remap[i] = slot[h];
    }
  } else for (let i = 0; i < nv; i++) remap[i] = i;
  // faces: remap, drop degenerate (repeated index or height < 1e-6)
  const m = F.length / 3;
  const keep = new Uint8Array(m);
  for (let f = 0; f < m; f++) {
    const a = remap[F[3 * f]], b = remap[F[3 * f + 1]], c = remap[F[3 * f + 2]];
    if (a === b || b === c || a === c) continue;
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2];
    const vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    const cr = hyp(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const lmax = Math.max(hyp(ux, uy, uz), hyp(vx, vy, vz),
      hyp(V[3 * c] - V[3 * b], V[3 * c + 1] - V[3 * b + 1], V[3 * c + 2] - V[3 * b + 2]));
    if (cr / lmax < 1e-6) continue;
    keep[f] = 1;
  }
  // components over manifold edges (as trimesh.split: faces joined by an edge
  // with exactly two faces), and their areas
  const kf = [];
  for (let f = 0; f < m; f++) if (keep[f]) kf.push(f);
  const KF = new Int32Array(3 * kf.length);
  for (let q = 0; q < kf.length; q++) for (let j = 0; j < 3; j++) KF[3 * q + j] = remap[F[3 * kf[q] + j]];
  const topo = edgeTopology(KF, nv);
  const uf = new UF(kf.length);
  for (let p = 0; p < topo.adjA.length; p++) uf.union(topo.adjA[p], topo.adjB[p]);
  const carea = new Map();
  let tot = 0;
  for (let q = 0; q < kf.length; q++) {
    const a = KF[3 * q], b = KF[3 * q + 1], c = KF[3 * q + 2];
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2];
    const vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    const ar = 0.5 * hyp(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    tot += ar;
    const r = uf.find(q);
    carea.set(r, (carea.get(r) || 0) + ar);
  }
  if (carea.size > 1)
    for (let q = 0; q < kf.length; q++) if (carea.get(uf.find(q)) <= minFrac * tot) keep[kf[q]] = 0;
  // compact
  const used = new Int32Array(nv).fill(-1);
  let nvo = 0, mo = 0;
  for (let f = 0; f < m; f++) if (keep[f]) {
    mo++;
    for (let j = 0; j < 3; j++) { const v = remap[F[3 * f + j]]; if (used[v] < 0) used[v] = nvo++; }
  }
  const Vo = new Float64Array(3 * nvo), Fo = new Int32Array(3 * mo);
  for (let i = 0; i < nv; i++) if (used[i] >= 0) { Vo[3 * used[i]] = V[3 * i]; Vo[3 * used[i] + 1] = V[3 * i + 1]; Vo[3 * used[i] + 2] = V[3 * i + 2]; }
  for (let f = 0, k = 0; f < m; f++) if (keep[f]) {
    Fo[3 * k] = used[remap[F[3 * f]]]; Fo[3 * k + 1] = used[remap[F[3 * f + 1]]]; Fo[3 * k + 2] = used[remap[F[3 * f + 2]]]; k++;
  }
  return { V: Vo, F: Fo };
}

/** Taubin lambda|mu smoothing with uniform weights (lambda shrinks, mu > 0 dilates). */
export function taubin(V, F, { lambda = 0.5, mu = 0.53, iterations = 10 } = {}) {
  const nv = V.length / 3;
  const topo = edgeTopology(F, nv);
  const { off, nb } = vertexAdjacency(nv, topo.E0, topo.E1);
  let X = V.slice();
  const D = new Float64Array(3 * nv);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < nv; i++) {
      const s = off[i], t = off[i + 1], k = t - s;
      if (!k) { D[3 * i] = D[3 * i + 1] = D[3 * i + 2] = 0; continue; }
      let x = 0, y = 0, z = 0;
      for (let p = s; p < t; p++) { const j = 3 * nb[p]; x += X[j]; y += X[j + 1]; z += X[j + 2]; }
      D[3 * i] = x / k - X[3 * i]; D[3 * i + 1] = y / k - X[3 * i + 1]; D[3 * i + 2] = z / k - X[3 * i + 2];
    }
    const s = it % 2 === 0 ? lambda : -mu;
    for (let i = 0; i < 3 * nv; i++) X[i] += s * D[i];
  }
  return X;
}

export function flipFaces(F) {
  const G = F.slice();
  for (let f = 0; f < G.length; f += 3) { const t = G[f + 1]; G[f + 1] = G[f + 2]; G[f + 2] = t; }
  return G;
}

/** Simple seeded RNG (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
