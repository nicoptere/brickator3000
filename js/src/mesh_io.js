// Unified 3D Mesh Adapter (OBJ, GLB, PLY, LDraw .dat) & BrickPack GLB / LDR Exporters.
// Zero external dependencies; runs identically in Node.js (v20+) and modern Browsers.
import { STUD, PLATE } from './units.js';
import { linToSrgb, srgbToLin } from './colors.js';

// ------------------------------------------------------------------ Minimal Sync PNG Decoder (for Node.js GLB baseColorTexture)
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function inflateRawOrZlib(u8) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    w.write(u8); w.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  }
  const { inflateSync } = await import('node:zlib');
  return new Uint8Array(inflateSync(u8));
}

async function decodeImage(bytes, mime) {
  // Browser fast path (supports PNG, JPEG, WebP)
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return { w: img.width, h: img.height, rgba: img.data };
  }
  // Zero-dep PNG fallback (Node.js / worker)
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8, w = 0, h = 0, depth = 8, ctype = 6, plte = null;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off), type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const p = off + 8;
    if (type === 'IHDR') { w = dv.getUint32(p); h = dv.getUint32(p + 4); depth = bytes[p + 8]; ctype = bytes[p + 9]; }
    else if (type === 'PLTE') plte = bytes.subarray(p, p + len);
    else if (type === 'IDAT') idat.push(bytes.subarray(p, p + len));
    else if (type === 'IEND') break;
    off = p + len + 4;
  }
  if (!w || !h || depth !== 8) return null;
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!bpp || (ctype === 3 && !plte)) return null;
  let tot = 0; for (const c of idat) tot += c.length;
  const comp = new Uint8Array(tot);
  let k = 0; for (const c of idat) { comp.set(c, k); k += c.length; }
  const raw = await inflateRawOrZlib(comp);
  const stride = w * bpp, rgba = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const rowOff = y * (stride + 1), ft = raw[rowOff];
    for (let i = 0; i < stride; i++) {
      const x = raw[rowOff + 1 + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      cur[i] = (ft === 0 ? x : ft === 1 ? x + a : ft === 2 ? x + b : ft === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    prev.set(cur);
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4, s = x * bpp;
      if (ctype === 6) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = cur[s + 3]; }
      else if (ctype === 2) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = 255; }
      else if (ctype === 3) { const pi = cur[s] * 3; rgba[d] = plte[pi]; rgba[d + 1] = plte[pi + 1]; rgba[d + 2] = plte[pi + 2]; rgba[d + 3] = 255; }
      else if (ctype === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = cur[s]; rgba[d + 3] = cur[s + 1]; }
      else { rgba[d] = rgba[d + 1] = rgba[d + 2] = cur[s]; rgba[d + 3] = 255; }
    }
  }
  return { w, h, rgba };
}

function sampleTex(tex, u, v) {
  const fu = ((u % 1) + 1) % 1, fv = ((v % 1) + 1) % 1;
  const x = Math.min(tex.w - 1, Math.floor(fu * tex.w)), y = Math.min(tex.h - 1, Math.floor(fv * tex.h));
  const o = (y * tex.w + x) * 4;
  return [srgbToLin(tex.rgba[o] / 255), srgbToLin(tex.rgba[o + 1] / 255), srgbToLin(tex.rgba[o + 2] / 255)];
}

// ------------------------------------------------------------------ OBJ Adapter
export function parseOBJ(text) {
  const V = [], VC = [], VT = [], T = [], C = [], UV = [];
  let hasVC = false, hasUV = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s[0] === '#') continue;
    if (s.startsWith('v ')) {
      const p = s.split(/\s+/);
      V.push([+p[1], +p[2], +p[3]]);
      if (p.length >= 7) { hasVC = true; VC.push([srgbToLin(+p[4]), srgbToLin(+p[5]), srgbToLin(+p[6])]); }
      else VC.push([0.45, 0.45, 0.45]);
    } else if (s.startsWith('vt ')) {
      const p = s.split(/\s+/);
      hasUV = true; VT.push([+p[1], 1 - +p[2]]);
    } else if (s.startsWith('f ')) {
      const parts = s.slice(2).trim().split(/\s+/).map((tok) => {
        const sp = tok.split('/');
        const vi = parseInt(sp[0], 10);
        const ti = sp[1] ? parseInt(sp[1], 10) : 0;
        return [vi < 0 ? V.length + vi : vi - 1, ti < 0 ? VT.length + ti : ti - 1];
      });
      for (let k = 1; k + 1 < parts.length; k++) {
        for (const [v, vt] of [parts[0], parts[k], parts[k + 1]]) {
          T.push(...V[v]);
          C.push(...VC[v]);
          if (hasUV && vt >= 0 && vt < VT.length) UV.push(...VT[vt]);
          else UV.push(0, 0);
        }
      }
    }
  }
  return {
    tris: Float32Array.from(T),
    vcols: Float32Array.from(C),
    uvs: hasUV ? Float32Array.from(UV) : null,
    textures: [],
    hasColor: hasVC,
  };
}

// ------------------------------------------------------------------ PLY Adapter (ASCII + Binary LE/BE)
const PLY_SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
function readPlyVal(dv, off, type, le) {
  switch (type) {
    case 'char': case 'int8': return dv.getInt8(off);
    case 'uchar': case 'uint8': return dv.getUint8(off);
    case 'short': case 'int16': return dv.getInt16(off, le);
    case 'ushort': case 'uint16': return dv.getUint16(off, le);
    case 'int': case 'int32': return dv.getInt32(off, le);
    case 'uint': case 'uint32': return dv.getUint32(off, le);
    case 'float': case 'float32': return dv.getFloat32(off, le);
    case 'double': case 'float64': return dv.getFloat64(off, le);
    default: throw new Error(`Unsupported PLY scalar type: ${type}`);
  }
}

export function parsePLY(bufferOrBytes) {
  const bytes = bufferOrBytes instanceof Uint8Array ? bufferOrBytes : new Uint8Array(bufferOrBytes);
  // Find end_header in bytes
  let hdrEnd = -1;
  const txt = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const m = /\bend_header\r?\n/.exec(txt);
  if (!m) throw new Error('Invalid PLY: missing end_header');
  const hdrText = txt.slice(0, m.index + m[0].length);
  hdrEnd = new TextEncoder().encode(hdrText).length;

  let format = 'ascii';
  const elements = [];
  for (const raw of hdrText.split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (!t[0] || t[0] === 'ply' || t[0] === 'comment' || t[0] === 'obj_info') continue;
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: +t[2], props: [] });
    else if (t[0] === 'property' && elements.length) {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ isList: true, lenType: t[2], valType: t[3], name: t[4] });
      else el.props.push({ isList: false, type: t[1], name: t[2] });
    }
  }

  const vEl = elements.find((e) => e.name === 'vertex');
  const fEl = elements.find((e) => e.name === 'face');
  if (!vEl || !fEl) throw new Error('PLY must define vertex and face elements');

  const pIdx = (nm) => vEl.props.findIndex((p) => p.name === nm);
  const ix = pIdx('x'), iy = pIdx('y'), iz = pIdx('z');
  const ir = pIdx('red') >= 0 ? pIdx('red') : pIdx('r');
  const ig = pIdx('green') >= 0 ? pIdx('green') : pIdx('g');
  const ib = pIdx('blue') >= 0 ? pIdx('blue') : pIdx('b');
  const hasColor = ir >= 0 && ig >= 0 && ib >= 0;
  const colFloat = hasColor && (vEl.props[ir].type === 'float' || vEl.props[ir].type === 'float32' || vEl.props[ir].type === 'double');

  const V = new Float32Array(vEl.count * 3);
  const VC = new Float32Array(vEl.count * 3).fill(0.45);
  const T = [], C = [];

  if (format === 'ascii') {
    const body = new TextDecoder().decode(bytes.subarray(hdrEnd));
    const lines = body.split(/\r?\n/);
    let li = 0;
    const nextLine = () => { while (li < lines.length && !lines[li].trim()) li++; return (lines[li++] || '').trim().split(/\s+/); };
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const tok = nextLine();
        if (el.name === 'vertex') {
          V[3 * i] = +tok[ix]; V[3 * i + 1] = +tok[iy]; V[3 * i + 2] = +tok[iz];
          if (hasColor) {
            const d = colFloat ? 1 : 255;
            VC[3 * i] = srgbToLin(+tok[ir] / d); VC[3 * i + 1] = srgbToLin(+tok[ig] / d); VC[3 * i + 2] = srgbToLin(+tok[ib] / d);
          }
        } else if (el.name === 'face') {
          const n = parseInt(tok[0], 10);
          for (let k = 1; k + 1 < n; k++) {
            for (const v of [parseInt(tok[1], 10), parseInt(tok[1 + k], 10), parseInt(tok[2 + k], 10)]) {
              T.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]);
              C.push(VC[3 * v], VC[3 * v + 1], VC[3 * v + 2]);
            }
          }
        }
      }
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = hdrEnd;
    for (const el of elements) {
      const allScalar = el.props.every((p) => !p.isList);
      if (el.name === 'vertex' && allScalar) {
        const offs = []; let stride = 0;
        for (const p of el.props) { offs.push(stride); stride += PLY_SZ[p.type]; }
        for (let i = 0; i < el.count; i++) {
          const row = off + i * stride;
          V[3 * i] = readPlyVal(dv, row + offs[ix], el.props[ix].type, le);
          V[3 * i + 1] = readPlyVal(dv, row + offs[iy], el.props[iy].type, le);
          V[3 * i + 2] = readPlyVal(dv, row + offs[iz], el.props[iz].type, le);
          if (hasColor) {
            const d = colFloat ? 1 : 255;
            VC[3 * i] = srgbToLin(readPlyVal(dv, row + offs[ir], el.props[ir].type, le) / d);
            VC[3 * i + 1] = srgbToLin(readPlyVal(dv, row + offs[ig], el.props[ig].type, le) / d);
            VC[3 * i + 2] = srgbToLin(readPlyVal(dv, row + offs[ib], el.props[ib].type, le) / d);
          }
        }
        off += el.count * stride;
      } else if (el.name === 'face') {
        for (let i = 0; i < el.count; i++) {
          for (const p of el.props) {
            if (p.isList) {
              const n = readPlyVal(dv, off, p.lenType, le); off += PLY_SZ[p.lenType];
              const vs = new Int32Array(n), vsz = PLY_SZ[p.valType];
              for (let q = 0; q < n; q++) { vs[q] = readPlyVal(dv, off, p.valType, le); off += vsz; }
              if (p.name === 'vertex_indices' || p.name === 'vertex_index') {
                for (let k = 1; k + 1 < n; k++) {
                  for (const v of [vs[0], vs[k], vs[k + 1]]) {
                    T.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]);
                    C.push(VC[3 * v], VC[3 * v + 1], VC[3 * v + 2]);
                  }
                }
              }
            } else { off += PLY_SZ[p.type]; }
          }
        }
      } else {
        for (let i = 0; i < el.count; i++) {
          for (const p of el.props) {
            if (p.isList) { const n = readPlyVal(dv, off, p.lenType, le); off += PLY_SZ[p.lenType] + n * PLY_SZ[p.valType]; }
            else off += PLY_SZ[p.type];
          }
        }
      }
    }
  }
  return { tris: Float32Array.from(T), vcols: Float32Array.from(C), hasColor };
}

// ------------------------------------------------------------------ GLB Adapter (with COLOR_0 + baseColorTexture)
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NMAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function accessor(gl, bin, i) {
  const a = gl.accessors[i], bv = gl.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[a.componentType];
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
const mul4 = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[r * 4 + c] += A[r * 4 + k] * B[k * 4 + c]; return C; };

export async function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a binary GLB file');
  let off = 12, json = null, bin = null;
  while (off < buffer.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = new Uint8Array(buffer, off + 8, len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len;
  }
  const decodedTex = [];
  if (json.textures && json.images && bin) {
    for (const img of json.images) {
      if (img.bufferView !== undefined) {
        const bv = json.bufferViews[img.bufferView];
        const slice = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        decodedTex.push(await decodeImage(slice, img.mimeType));
      } else decodedTex.push(null);
    }
  }
  const T = [], C = [], UV = [], TEX_ID = [];
  let hasColor = false;
  const visit = (ni, P) => {
    const nd = json.nodes[ni], M = mul4(P, nodeMatrix(nd));
    if (nd.mesh !== undefined) for (const pr of json.meshes[nd.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const pos = accessor(json, bin, pr.attributes.POSITION).data, nv = pos.length / 3;
      const idx = pr.indices !== undefined ? accessor(json, bin, pr.indices).data : Float64Array.from({ length: nv }, (_, k) => k);
      let col = null, cn = 3;
      if (pr.attributes.COLOR_0 !== undefined) { const a = accessor(json, bin, pr.attributes.COLOR_0); col = a.data; cn = a.n; hasColor = true; }
      const uv = pr.attributes.TEXCOORD_0 !== undefined ? accessor(json, bin, pr.attributes.TEXCOORD_0).data : null;
      const mat = pr.material !== undefined && json.materials ? json.materials[pr.material] : null;
      const pbr = mat && mat.pbrMetallicRoughness;
      const bcf = pbr && pbr.baseColorFactor;
      const texInfo = pbr && pbr.baseColorTexture;
      const imgIdx = texInfo && json.textures[texInfo.index] ? json.textures[texInfo.index].source : -1;
      const tex = imgIdx >= 0 ? decodedTex[imgIdx] : null;
      if (tex || (bcf && bcf.slice(0, 3).some((c) => Math.abs(c - 1) > 1e-3))) hasColor = true;

      const wp = new Float64Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        wp[v * 3] = M[0] * x + M[1] * y + M[2] * z + M[3];
        wp[v * 3 + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
        wp[v * 3 + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
      }
      for (let k = 0; k < idx.length; k += 3) {
        const f = bcf || [1, 1, 1];
        for (let q = 0; q < 3; q++) {
          const v = idx[k + q];
          T.push(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]);
          const u = uv ? uv[v * 2] : 0, vv = uv ? uv[v * 2 + 1] : 0;
          UV.push(u, vv);
          if (tex && uv) {
            const tc = sampleTex(tex, u, vv);
            C.push(tc[0] * f[0], tc[1] * f[1], tc[2] * f[2]);
          } else if (col) {
            C.push(col[v * cn] * f[0], col[v * cn + 1] * f[1], col[v * cn + 2] * f[2]);
          } else if (bcf) {
            C.push(f[0], f[1], f[2]);
          } else {
            C.push(0.55, 0.55, 0.55);
          }
        }
        TEX_ID.push(tex ? imgIdx : -1);
      }
    }
    for (const ch of nd.children || []) visit(ch, M);
  };
  const sc = json.scenes[json.scene || 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of sc.nodes) visit(r, I);
  return {
    tris: Float32Array.from(T),
    vcols: Float32Array.from(C),
    uvs: Float32Array.from(UV),
    triTexIdx: Int32Array.from(TEX_ID),
    textures: decodedTex,
    hasColor,
  };
}

// ------------------------------------------------------------------ Unified File Adapter (Node.js & Browser ArrayBuffer)
export async function loadModelBuffer(name, arrayBuffer) {
  const lower = name.toLowerCase();
  const baseName = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  if (lower.endsWith('.obj')) return { ...parseOBJ(new TextDecoder().decode(arrayBuffer)), name: baseName };
  if (lower.endsWith('.ply')) return { ...parsePLY(new Uint8Array(arrayBuffer)), name: baseName };
  if (lower.endsWith('.glb')) return { ...(await parseGLB(arrayBuffer)), name: baseName };
  throw new Error(`Unsupported model format: ${name} (expected .obj, .glb, or .ply)`);
}

export async function loadModelFile(filePath) {
  const fs = await import('node:fs');
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return loadModelBuffer(filePath, ab);
}

// ------------------------------------------------------------------ Piece Mesh Synthesis, Official Color Assignment & GLB / LDR Exporters
const rotY = (deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
function pushBox(x0, x1, y0, y1, z0, z1, out) {
  const v = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) v.push([x, y, z]);
  for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
}
function pushCyl(cx, cz, r, y0, y1, seg, out, r2 = r) {
  for (let i = 0; i < seg; i++) {
    const a0 = 2 * Math.PI * i / seg, a1 = 2 * Math.PI * (i + 1) / seg;
    const p0 = [cx + r * Math.cos(a0), cz + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cz + r * Math.sin(a1)];
    const q0 = [cx + r2 * Math.cos(a0), cz + r2 * Math.sin(a0)], q1 = [cx + r2 * Math.cos(a1), cz + r2 * Math.sin(a1)];
    out.push(p0[0], y0, p0[1], p1[0], y0, p1[1], q1[0], y1, q1[1], p0[0], y0, p0[1], q1[0], y1, q1[1], q0[0], y1, q0[1],
      cx, y1, cz, q0[0], y1, q0[1], q1[0], y1, q1[1]);
  }
}

function heightFieldMesh(c, out) {
  const nx = c.w * 5, nz = c.d * 5, x0 = -c.w * 10, z0 = -c.d * 10;
  const X = (i) => x0 + 4 * i, Z = (j) => z0 + 4 * j;
  const hc = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    let s = 0, n = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (a >= 0 && b >= 0 && a < nx && b < nz) { s += c.top[b * nx + a]; n++; }
    hc[j * (nx + 1) + i] = n ? s / n : 0;
  }
  const h = (i, j) => hc[j * (nx + 1) + i], quad = (a, b, cc, d) => out.push(...a, ...b, ...cc, ...a, ...cc, ...d);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
    quad([X(i), h(i, j), Z(j)], [X(i), h(i, j + 1), Z(j + 1)], [X(i + 1), h(i + 1, j + 1), Z(j + 1)], [X(i + 1), h(i + 1, j), Z(j)]);
  for (let j = 0; j < nz; j++) {
    quad([X(0), 0, Z(j)], [X(0), 0, Z(j + 1)], [X(0), h(0, j + 1), Z(j + 1)], [X(0), h(0, j), Z(j)]);
    quad([X(nx), 0, Z(j)], [X(nx), h(nx, j), Z(j)], [X(nx), h(nx, j + 1), Z(j + 1)], [X(nx), 0, Z(j + 1)]);
  }
  for (let i = 0; i < nx; i++) {
    quad([X(i), 0, Z(0)], [X(i), h(i, 0), Z(0)], [X(i + 1), h(i + 1, 0), Z(0)], [X(i + 1), 0, Z(0)]);
    quad([X(i), 0, Z(nz)], [X(i + 1), 0, Z(nz)], [X(i + 1), h(i + 1, nz), Z(nz)], [X(i), h(i, nz), Z(nz)]);
  }
  quad([X(0), 0, Z(0)], [X(nx), 0, Z(0)], [X(nx), 0, Z(nz)], [X(0), 0, Z(nz)]);
}

function indexed(tris) {
  const map = new Map(), pos = [], idx = new Uint32Array(tris.length / 3);
  for (let k = 0; k < tris.length; k += 3) {
    const key = `${tris[k].toFixed(3)},${tris[k + 1].toFixed(3)},${tris[k + 2].toFixed(3)}`;
    let v = map.get(key); if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(tris[k], tris[k + 1], tris[k + 2]); }
    idx[k / 3] = v;
  }
  return { pos: new Float32Array(pos), idx };
}
const STUD_GEO = (() => { const t = []; pushCyl(0, 0, 6, 0, 4, 10, t); return indexed(new Float32Array(t)); })();

function featureEdges(tris, thr = 28) {
  const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
  const ed = new Map(), ct = Math.cos(thr * Math.PI / 180);
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const ln = Math.hypot(nx, ny, nz);
    if (ln < 1e-9) continue; nx /= ln; ny /= ln; nz /= ln;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const A = [tris[t + a * 3], tris[t + a * 3 + 1], tris[t + a * 3 + 2]], B = [tris[t + b * 3], tris[t + b * 3 + 1], tris[t + b * 3 + 2]];
      const ka = key(...A), kb = key(...B), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!ed.has(k)) ed.set(k, { A, B, n: [] }); ed.get(k).n.push([nx, ny, nz]);
    }
  }
  const out = [];
  for (const { A, B, n } of ed.values()) {
    let sharp = n.length === 1;
    for (let k = 1; k < n.length && !sharp; k++) if (n[0][0] * n[k][0] + n[0][1] * n[k][1] + n[0][2] * n[k][2] < ct) sharp = true;
    if (sharp) out.push(...A, ...B);
  }
  return new Float32Array(out);
}

const tmplCache = new Map();
function partTemplate(c, rot) {
  const key = `${c.id}|${rot}`;
  if (tmplCache.has(key)) return tmplCache.get(key);
  let loc;
  if (c.tris && c.tris.length) {
    const cx = c.minx + c.w * 10, cz = c.minz + c.d * 10;
    loc = new Float32Array(c.tris.length);
    for (let k = 0; k + 2 < c.tris.length; k += 3) { loc[k] = c.tris[k] - cx; loc[k + 1] = c.tris[k + 1]; loc[k + 2] = c.tris[k + 2] - cz; }
  } else {
    const out = [], w = c.w, d = c.d;
    const ch = c.h ?? (c.coverH ?? (c.top && c.top.length ? Math.max(1, Math.round(Math.max(...c.top) / PLATE)) : 1));
    const H = ch * PLATE;
    if (c.kind === 'round') {
      const rads = c.rad || Array(Math.round(ch)).fill(w * STUD / 2);
      rads.forEach((r, l) => pushCyl(0, 0, r, l * PLATE, (l + 1) * PLATE, 20, out, l + 1 < rads.length ? rads[l + 1] : r));
    } else if (c.top && c.top.some((v) => Math.abs(v - c.top[0]) > 1e-3)) heightFieldMesh(c, out);
    else pushBox(-w * 10, w * 10, 0, H, -d * 10, d * 10, out);
    loc = Float32Array.from(out);
  }
  const R = rotY(rot), rx = (x, z) => R[0] * x + R[2] * z, rz = (x, z) => R[6] * x + R[8] * z;
  const tris = new Float32Array(loc.length);
  for (let i = 0; i < loc.length; i += 3) { tris[i] = rx(loc[i], loc[i + 2]); tris[i + 1] = loc[i + 1]; tris[i + 2] = rz(loc[i], loc[i + 2]); }
  const ch2 = c.h ?? (c.coverH ?? (c.top && c.top.length ? Math.max(1, Math.round(Math.max(...c.top) / PLATE)) : 1));
  let studY = ch2 * PLATE;
  if (c.top && c.top.length) studY = Math.max(studY, ...c.top);
  const cx = (c.minx ?? -c.w * 10) + c.w * 10, cz = (c.minz ?? -c.d * 10) + c.d * 10;
  const rawStuds = (c.kind === 'tile' ? [] : c.stud_cells || []).map(([si, sj]) => [(c.minx ?? -c.w * 10) + (si + 0.5) * STUD - cx, studY, (c.minz ?? -c.d * 10) + (sj + 0.5) * STUD - cz]);
  const studs = rawStuds.map(([x, y, z]) => [rx(x, z), y, rz(x, z)]);
  const body = indexed(tris);
  const res = { pos: body.pos, idx: body.idx, edges: featureEdges(tris), studs };
  tmplCache.set(key, res);
  return res;
}

export const KIND_COL = {
  slope: [37, 99, 235], curved: [8, 145, 178], cheese: [147, 51, 234], inverted: [230, 77, 77],
  tile: [204, 214, 224], plate: [140, 153, 171], brick: [89, 102, 122], round: [242, 153, 25],
  technic: [51, 178, 89], shaped: [230, 199, 38], snot: [191, 51, 191], solid: [89, 102, 122], shape: [153, 115, 77],
};

export function buildBricksMesh(pieces, catalog, { colorMode = 'piece', hideCovered = true } = {}) {
  const by = {}; for (const c of catalog) by[c.id] = c;
  const occ = new Set();
  if (hideCovered) for (const p of pieces) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) occ.add(`${p.i + dx},${p.j + dz},${p.b + l}`);
  const plan = pieces.map((p) => {
    const c = by[p.id];
    const t = partTemplate(c, p.rot || 0);
    const ox = (p.i + p.w / 2) * STUD, oz = (p.j + p.d / 2) * STUD, top = p.b + p.h;
    const studs = t.studs.filter(([x, , z]) => !occ.has(`${Math.floor((x + ox) / STUD)},${Math.floor((z + oz) / STUD)},${top}`));
    return { t, studs, ox, oy: p.b * PLATE, oz };
  });
  let nv = 0, ni = 0, ne = 0;
  for (const { t, studs } of plan) { nv += t.pos.length / 3 + studs.length * STUD_GEO.pos.length / 3; ni += t.idx.length + studs.length * STUD_GEO.idx.length; ne += t.edges.length; }
  const pos = new Float32Array(nv * 3), col = new Uint8Array(nv * 3), idx = new Uint32Array(ni), edges = new Float32Array(ne);
  let v = 0, i = 0, e = 0;
  const put = (P, I, ox, oy, oz, c) => {
    const v0 = v;
    for (let k = 0; k < P.length; k += 3) { pos[v * 3] = P[k] + ox; pos[v * 3 + 1] = P[k + 1] + oy; pos[v * 3 + 2] = P[k + 2] + oz; col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; v++; }
    for (let k = 0; k < I.length; k++) idx[i + k] = I[k] + v0;
    i += I.length;
  };
  pieces.forEach((p, n) => {
    const { t, studs, ox, oy, oz } = plan[n];
    const c = colorMode === 'kind' ? (KIND_COL[p.kind] || [160, 165, 169]) : (p.rgb || [160, 165, 169]);
    put(t.pos, t.idx, ox, oy, oz, c);
    for (const [x, y, z] of studs) put(STUD_GEO.pos, STUD_GEO.idx, ox + x, oy + y, oz + z, c);
    for (let k = 0; k < t.edges.length; k += 3) { edges[e + k] = t.edges[k] + ox; edges[e + k + 1] = t.edges[k + 1] + oy; edges[e + k + 2] = t.edges[k + 2] + oz; }
    e += t.edges.length;
  });
  return { pos, col, idx, edges };
}

/** Export indexed colored triangles as Binary glTF (.glb), 1 unit = 100 LDU */
export function exportGLB(mesh, scale = 0.01) {
  const { pos, col, idx } = mesh, n = pos.length / 3;
  const P = new Float32Array(pos.length), C = new Uint8Array(n * 4);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < pos.length; k++) { P[k] = pos[k] * scale; const a = k % 3; if (P[k] < lo[a]) lo[a] = P[k]; if (P[k] > hi[a]) hi[a] = P[k]; }
  const lut = new Uint8Array(256); for (let x = 0; x < 256; x++) lut[x] = Math.round(srgbToLin(x / 255) * 255);
  for (let v = 0; v < n; v++) { C[v * 4] = lut[col[v * 3]]; C[v * 4 + 1] = lut[col[v * 3 + 1]]; C[v * 4 + 2] = lut[col[v * 3 + 2]]; C[v * 4 + 3] = 255; }
  const parts = [new Uint8Array(P.buffer), new Uint8Array(C.buffer), new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength)];
  const offs = []; let len = 0; for (const p of parts) { offs.push(len); len += Math.ceil(p.byteLength / 4) * 4; }
  const bin = new Uint8Array(len); parts.forEach((p, k) => bin.set(p, offs[k]));
  const json = {
    asset: { version: '2.0', generator: 'brickpack-sdf' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'lego' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.55 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: P.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[1], byteLength: C.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5121, normalized: true, count: n, type: 'VEC4' },
      { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
  };
  const js = new TextEncoder().encode(JSON.stringify(json)), jp = (4 - (js.length % 4)) % 4;
  const jsonChunk = new Uint8Array(js.length + jp); jsonChunk.set(js); jsonChunk.fill(0x20, js.length);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length, out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(jsonChunk, 20);
  const bo = 20 + jsonChunk.length; dv.setUint32(bo, bin.length, true); dv.setUint32(bo + 4, 0x004E4942, true); u8.set(bin, bo + 8);
  return new Uint8Array(out);
}

/** Export brick list as standard LDraw (.ldr) with official color codes */
export function exportLDR(pieces, catalog, name = 'brickpack_model') {
  const by = {}; for (const c of catalog) by[c.id] = c;
  const lines = [`0 ${name}`, `0 Name: ${name}.ldr`, '0 Author: BrickPack SDF'];
  for (const p of pieces) {
    const c = by[p.id] || {};
    const R = rotY(p.rot || 0);
    const M = [R[0], -R[1], -R[2], -R[3], R[4], R[5], -R[6], R[7], R[8]];
    const cx = (p.i + p.w / 2) * STUD, cy = p.b * PLATE, cz = (p.j + p.d / 2) * STUD;
    const hLdu = (c.maxy ?? c.h * PLATE);
    const ox = c.minx !== undefined ? cx - (c.minx + (c.w ?? p.w) * STUD / 2) * R[0] - (c.minz + (c.d ?? p.d) * STUD / 2) * R[2] : cx;
    const oy = -(cy + hLdu);
    const oz = -cz;
    const code = p.code !== undefined ? p.code : (p.rgb ? 0x2000000 + (p.rgb[0] << 16) + (p.rgb[1] << 8) + p.rgb[2] : 71);
    lines.push(`1 ${code} ${ox.toFixed(1)} ${oy.toFixed(1)} ${oz.toFixed(1)} ${M.map((x) => +x.toFixed(4)).join(' ')} ${p.id}.dat`);
  }
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ Sample closest point on mesh & assign official colors
export function nearestTriangleColor(qx, qy, qz, tris, vcols, { textures = null, uvs = null, triTexIdx = null, sampleCache = null } = {}) {
  let bestD2 = Infinity, bestT = 0, bu = 0, bv = 0, bw = 1;
  const nt = tris.length / 9;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = qx - ax, apy = qy - ay, apz = qz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let u = 0, v = 0, w = 0;
    if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
    else {
      const bpx = qx - bx, bpy = qy - by, bpz = qz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = qx - cx, cpy = qy - cy, cpz = qz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; w = 0; }
      else if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; v = 0; }
      else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - w; }
      else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
    }
    const px = u * ax + v * bx + w * cx - qx, py = u * ay + v * by + w * cy - qy, pz = u * az + v * bz + w * cz - qz;
    const d2_val = px * px + py * py + pz * pz;
    if (d2_val < bestD2) { bestD2 = d2_val; bestT = t; bu = u; bv = v; bw = w; }
  }
  if (textures && uvs && triTexIdx && triTexIdx[bestT] >= 0) {
    const tex = textures[triTexIdx[bestT]];
    if (tex) {
      const k = bestT * 6;
      const tu = bu * uvs[k] + bv * uvs[k + 2] + bw * uvs[k + 4];
      const tv = bu * uvs[k + 1] + bv * uvs[k + 3] + bw * uvs[k + 5];
      const lc = sampleTex(tex, tu, tv);
      return [Math.round(linToSrgb(lc[0]) * 255), Math.round(linToSrgb(lc[1]) * 255), Math.round(linToSrgb(lc[2]) * 255)];
    }
  }
  const o = bestT * 9;
  const r = bu * vcols[o] + bv * vcols[o + 3] + bw * vcols[o + 6];
  const g = bu * vcols[o + 1] + bv * vcols[o + 4] + bw * vcols[o + 7];
  const b = bu * vcols[o + 2] + bv * vcols[o + 5] + bw * vcols[o + 8];
  return [Math.round(linToSrgb(r) * 255), Math.round(linToSrgb(g) * 255), Math.round(linToSrgb(b) * 255)];
}
