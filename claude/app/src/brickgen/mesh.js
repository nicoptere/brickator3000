// Mesh input: flat triangle soup (Float32Array, 9 floats per triangle) + per-corner LINEAR colours (9 floats per triangle).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lin2srgb = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const srgb2lin = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/** area-weighted random points on the surface; returns positions and sRGB colours (0..1) */
export function surfaceSamples(tris, vcols, n, seed = 1) {
  const nt = tris.length / 9, rng = mulberry32(seed);
  const cum = new Float64Array(nt); let acc = 0;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    acc += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz); cum[t] = acc;
  }
  const pts = new Float32Array(n * 3), cols = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = rng() * acc; let lo = 0, hi = nt - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const r1 = Math.sqrt(rng()), r2 = rng();
    const w0 = 1 - r1, w1 = r1 * (1 - r2), w2 = r1 * r2, o = lo * 9;
    for (let c = 0; c < 3; c++) {
      pts[k * 3 + c] = w0 * tris[o + c] + w1 * tris[o + 3 + c] + w2 * tris[o + 6 + c];
      cols[k * 3 + c] = lin2srgb(w0 * vcols[o + c] + w1 * vcols[o + 3 + c] + w2 * vcols[o + 6 + c]);
    }
  }
  return { pts, cols };
}

export function bounds(arr) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) for (let c = 0; c < 3; c++) { const v = arr[i + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  return { lo, hi };
}

// ------------------------------------------------------------------ minimal GLB reader (keeps COLOR_0), no dependencies
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NMAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function accessor(gl, bin, i) {
  const a = gl.accessors[i], bv = gl.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true) }[a.componentType];
  const sz = T.BYTES_PER_ELEMENT, norm = a.normalized && NMAX[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    let v = get(off + k * stride + c * sz); if (norm) v /= norm; out[k * n + c] = v;
  }
  return { data: out, n };
}

function nodeMatrix(nd) {
  if (nd.matrix) { const m = nd.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], 0, 0, 0, 1]; }
  const t = nd.translation || [0, 0, 0], q = nd.rotation || [0, 0, 0, 1], s = nd.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [R[0] * s[0], R[1] * s[1], R[2] * s[2], t[0], R[3] * s[0], R[4] * s[1], R[5] * s[2], t[1], R[6] * s[0], R[7] * s[1], R[8] * s[2], t[2], 0, 0, 0, 1];
}
const mul = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[r * 4 + c] += A[r * 4 + k] * B[k * 4 + c]; return C; };

/** GLB ArrayBuffer -> { tris: Float32Array, vcols: Float32Array (linear), hasColor } in world space */
export function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB file');
  let off = 12, json = null, bin = null;
  while (off < buffer.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = new Uint8Array(buffer, off + 8, len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len;
  }
  const T = [], C = []; let hasColor = false;
  const visit = (ni, P) => {
    const nd = json.nodes[ni], M = mul(P, nodeMatrix(nd));
    if (nd.mesh !== undefined) for (const pr of json.meshes[nd.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const pos = accessor(json, bin, pr.attributes.POSITION).data;
      const nv = pos.length / 3;
      const idx = pr.indices !== undefined ? accessor(json, bin, pr.indices).data : Float64Array.from({ length: nv }, (_, k) => k);
      let col = null, cn = 3;
      if (pr.attributes.COLOR_0 !== undefined) { const a = accessor(json, bin, pr.attributes.COLOR_0); col = a.data; cn = a.n; hasColor = true; }
      const mat = pr.material !== undefined && json.materials ? json.materials[pr.material] : null;
      const bcf = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor;   // linear, multiplies COLOR_0 per the glTF spec
      if (bcf && !col) hasColor = hasColor || bcf.slice(0, 3).some((c) => Math.abs(c - 1) > 1e-3);
      const wp = new Float64Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        wp[v * 3] = M[0] * x + M[1] * y + M[2] * z + M[3];
        wp[v * 3 + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
        wp[v * 3 + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
      }
      for (let k = 0; k < idx.length; k++) {
        const v = idx[k];
        T.push(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]);
        const f = bcf || [1, 1, 1];
        if (col) C.push(col[v * cn] * f[0], col[v * cn + 1] * f[1], col[v * cn + 2] * f[2]); else if (bcf) C.push(f[0], f[1], f[2]); else C.push(0.7, 0.7, 0.7);
      }
    }
    for (const ch of nd.children || []) visit(ch, M);
  };
  const sc = json.scenes[json.scene || 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of sc.nodes) visit(r, I);
  return { tris: Float32Array.from(T), vcols: Float32Array.from(C), hasColor };
}
