// The WebGL2 backend (where WebGPU is missing): the same kernels as webgpu.js, as fragment shaders. Inputs are float / integer
// textures read with texelFetch, each output is one fragment of a float render target (EXT_color_buffer_float), read back with
// readPixels. Works in a worker (OffscreenCanvas) and on a page.
import { isSoftware } from './index.js';

const CHUNK_ROWS = 64;         // output rows per draw: short draws keep clear of GPU watchdogs

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp isampler2D;
uniform int uTW;          // data texture width (texels)
uniform int uOW;          // output width
uniform int uOffset;      // first output index of this draw
uniform int uN;           // outputs in all
out vec4 outColor;
vec4 F(sampler2D t, int i) { return texelFetch(t, ivec2(i % uTW, i / uTW), 0); }
ivec4 I(isampler2D t, int i) { return texelFetch(t, ivec2(i % uTW, i / uTW), 0); }
int outIndex() { return int(gl_FragCoord.y) * uOW + int(gl_FragCoord.x) + uOffset; }
`;

const BVH_FS = HEAD + `
uniform sampler2D uNodes, uTris, uPts;
uniform int uFlags; uniform float uBeta, uBound2;
const float PI4 = 12.566370614359172;
float pointTri2(vec3 p, vec3 a, vec3 b, vec3 c) {
  vec3 ab = b - a, ac = c - a, ap = p - a;
  float d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { vec3 e = p - a; return dot(e, e); }
  vec3 bp = p - b; float d3 = dot(ab, bp), d4 = dot(ac, bp);
  vec3 cp = p - c; float d5 = dot(ab, cp), d6 = dot(ac, cp);
  float vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  vec3 q;
  if (d3 >= 0.0 && d4 <= d3) q = b;
  else if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) q = a + (d1 / (d1 - d3)) * ab;
  else if (d6 >= 0.0 && d5 <= d6) q = c;
  else if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) q = a + (d2 / (d2 - d6)) * ac;
  else if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) q = b + ((d4 - d3) / ((d4 - d3) + (d5 - d6))) * (c - b);
  else { float den = 1.0 / (va + vb + vc); q = a + ab * (vb * den) + ac * (vc * den); }
  vec3 e = p - q; return dot(e, e);
}
float winding(vec3 q, float beta) {
  int stk[64]; int sp = 1; stk[0] = 0; float w = 0.0;
  for (int it = 0; it < 4000000; ++it) {
    if (sp == 0) break;
    sp--; int o = 8 * stk[sp];
    vec4 c = F(uNodes, o); vec3 d = c.xyz - q; float d2 = dot(d, d), r = beta * c.w;
    if (d2 > r * r) {
      float dn = sqrt(d2), i3 = 1.0 / (d2 * dn), i5 = i3 / d2;
      vec4 N = F(uNodes, o + 1), m0 = F(uNodes, o + 2), m1 = F(uNodes, o + 3), m2 = F(uNodes, o + 4);
      float xMx = d.x * dot(m0.xyz, d) + d.y * dot(vec3(m0.w, m1.x, m1.y), d) + d.z * dot(vec3(m1.z, m1.w, m2.x), d);
      w += dot(d, N.xyz) * i3 + N.w * i3 - 3.0 * xMx * i5;
      continue;
    }
    vec4 info = F(uNodes, o + 4);
    if (info.y < 0.0) {
      int s = int(info.w), e = s + int(F(uNodes, o + 5).x);
      for (int k = s; k < e; ++k) {
        vec3 a = F(uTris, 3 * k).xyz - q, b = F(uTris, 3 * k + 1).xyz - q, cc = F(uTris, 3 * k + 2).xyz - q;
        float la = length(a), lb = length(b), lc = length(cc);
        float num = dot(a, cross(b, cc));
        float den = la * lb * lc + dot(a, b) * lc + dot(b, cc) * la + dot(cc, a) * lb;
        w += 2.0 * atan(num, den);
      }
    } else if (sp < 63) { stk[sp] = int(info.z); stk[sp + 1] = int(info.y); sp += 2; }
  }
  return w / PI4;
}
float boxD2(int o, vec3 q) { vec3 dd = max(max(F(uNodes, o + 6).xyz - q, vec3(0.0)), q - F(uNodes, o + 7).xyz); return dot(dd, dd); }
float nearest(vec3 q, float bound2) {
  int stk[64]; int sp = 1; stk[0] = 0; float best = bound2;
  for (int it = 0; it < 4000000; ++it) {
    if (sp == 0) break;
    sp--; int n = stk[sp], o = 8 * n;
    if (boxD2(o, q) >= best) continue;
    vec4 info = F(uNodes, o + 4);
    if (info.y < 0.0) {
      int s = int(info.w), e = s + int(F(uNodes, o + 5).x);
      for (int k = s; k < e; ++k) best = min(best, pointTri2(q, F(uTris, 3 * k).xyz, F(uTris, 3 * k + 1).xyz, F(uTris, 3 * k + 2).xyz));
    } else if (sp < 63) {
      int l = int(info.y), r = int(info.z);
      if (boxD2(8 * l, q) < boxD2(8 * r, q)) { stk[sp] = r; stk[sp + 1] = l; } else { stk[sp] = l; stk[sp + 1] = r; }
      sp += 2;
    }
  }
  return best;
}
void main() {
  int i = outIndex(); if (i >= uN) { outColor = vec4(0.0); return; }
  vec3 q = F(uPts, i).xyz; float w = 0.0, d2 = 0.0;
  if ((uFlags & 1) != 0) w = winding(q, uBeta);
  if ((uFlags & 2) != 0) d2 = nearest(q, uBound2);
  outColor = vec4(w, d2, 0.0, 0.0);
}`;

const DEF_FS = HEAD + `
uniform sampler2D uW;          // the field, 4 floats per texel
uniform isampler2D uDef;       // (rel, bits of the weight, -, -) per deficit entry
uniform isampler2D uInfo;      // (start, count, -, -) per variant
uniform isampler2D uPairs;     // (variant, base, -, -) per output
float wAt(int i) { vec4 t = F(uW, i >> 2); int c = i & 3; return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w; }
void main() {
  int i = outIndex(); if (i >= uN) { outColor = vec4(0.0); return; }
  ivec4 p = I(uPairs, i), inf = I(uInfo, p.x);
  float s = 0.0, c = 0.0;
  for (int k = 0; k < 1000000; ++k) {
    if (k >= inf.y) break;
    ivec4 d = I(uDef, inf.x + k);
    float y = intBitsToFloat(d.y) * wAt(p.y + d.x) - c, t = s + y; c = (t - s) - y; s = t;
  }
  outColor = vec4(s, 0.0, 0.0, 0.0);
}`;

export async function create({ log = () => {} } = {}) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) return null;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no EXT_color_buffer_float');
  let lost = false, disposed = false; canvas.addEventListener && canvas.addEventListener('webglcontextlost', () => { lost = true; if (!disposed) log('gpu: WebGL2 context lost'); });
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE), TW = Math.min(4096, maxTex), OW = 1024;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  const label = `WebGL2${renderer ? ` (${renderer})` : ''}`;

  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const program = (fs) => {
    const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); U[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, U };
  };
  const bvhProg = program(BVH_FS), defProg = program(DEF_FS);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // rows of 4 components -> a TW-wide texture (float or int)
  const texture = (data, int = false) => {
    const rows = Math.ceil(data.length / 4), h = Math.max(1, Math.ceil(rows / TW));
    if (h > maxTex) throw new Error(`data of ${rows} texels over the ${maxTex}^2 texture limit`);
    const pad = new data.constructor(TW * h * 4); pad.set(data);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (int) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, TW, h, 0, gl.RGBA_INTEGER, gl.INT, pad);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TW, h, 0, gl.RGBA, gl.FLOAT, pad);
    return t;
  };
  // render n outputs (vec4 each) in draws of OW x CHUNK_ROWS fragments; returns n x 4 floats
  const target = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, OW, CHUNK_ROWS, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float render target not supported');
  const draw = async (prog, n, textures, setUniforms) => {
    if (lost || gl.isContextLost()) throw new Error('WebGL2 context lost');
    const out = new Float32Array(4 * n), per = OW * CHUNK_ROWS, chunk = new Float32Array(4 * per);
    gl.useProgram(prog.p); gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    textures.forEach(([name, t], k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.U[name], k); });
    gl.uniform1i(prog.U.uTW, TW); gl.uniform1i(prog.U.uOW, OW); gl.uniform1i(prog.U.uN, n); setUniforms(prog.U);
    for (let off = 0; off < n; off += per) {
      const m = Math.min(per, n - off), rows = Math.ceil(m / OW);
      gl.viewport(0, 0, OW, rows); gl.uniform1i(prog.U.uOffset, off);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, OW, rows, gl.RGBA, gl.FLOAT, chunk, 0);
      out.set(chunk.subarray(0, 4 * m), 4 * off);
      if (off + per < n) await new Promise((r) => setTimeout(r, 0));     // let the worker breathe between draws
    }
    const err = gl.getError(); if (err) throw new Error(`WebGL error ${err}`);
    return out;
  };

  let bvhKey = null, bvhTex = null;
  const defCache = new Map();
  return {
    kind: 'webgl2', label, software: isSoftware(renderer),
    async bvhQuery(packed, pts, { beta = 0, bound2 = 0 } = {}) {
      const n = pts.length / 4;
      if (bvhKey !== packed) { if (bvhTex) bvhTex.forEach((t) => gl.deleteTexture(t)); bvhTex = [texture(packed.nodes), texture(packed.tris)]; bvhKey = packed; }
      const pt = texture(pts);
      const r = await draw(bvhProg, n, [['uNodes', bvhTex[0]], ['uTris', bvhTex[1]], ['uPts', pt]], (U) => {
        gl.uniform1i(U.uFlags, (beta > 0 ? 1 : 0) | (bound2 > 0 ? 2 : 0)); gl.uniform1f(U.uBeta, beta); gl.uniform1f(U.uBound2, bound2);
      });
      gl.deleteTexture(pt);
      const w = new Float32Array(n), d2 = new Float32Array(n);
      for (let i = 0; i < n; i++) { w[i] = r[4 * i]; d2[i] = r[4 * i + 1]; }
      return { w, d2 };
    },
    async deficitSums(w, table, pairs) {
      const n = pairs.n; if (!n) return new Float32Array(0);
      let t = defCache.get(table.key);
      if (!t || t.table !== table) {
        if (t) t.tex.forEach((x) => gl.deleteTexture(x));
        const def = new Int32Array(4 * table.rel.length), bits = new Int32Array(table.val.buffer, table.val.byteOffset, table.val.length);
        for (let k = 0; k < table.rel.length; k++) { def[4 * k] = table.rel[k]; def[4 * k + 1] = bits[k]; }
        const info = new Int32Array(4 * (table.info.length / 2)); for (let v = 0; v < table.info.length / 2; v++) { info[4 * v] = table.info[2 * v]; info[4 * v + 1] = table.info[2 * v + 1]; }
        t = { table, tex: [texture(def, true), texture(info, true)] }; defCache.set(table.key, t);
      }
      const pv = new Int32Array(4 * n); for (let i = 0; i < n; i++) { pv[4 * i] = pairs.vi[i]; pv[4 * i + 1] = pairs.base[i]; }
      const wt = texture(w), pt = texture(pv, true);
      const r = await draw(defProg, n, [['uW', wt], ['uDef', t.tex[0]], ['uInfo', t.tex[1]], ['uPairs', pt]], () => {});
      gl.deleteTexture(wt); gl.deleteTexture(pt);
      const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = r[4 * i];
      return s;
    },
    dispose() { disposed = true; const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); },
  };
}
