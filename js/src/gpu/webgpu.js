/* global GPUBufferUsage, GPUMapMode */
// The WebGPU backend: compute shaders (WGSL). See index.js for what each kernel computes and its CPU twin.
import { isSoftware } from './index.js';

const WG = 64;                 // workgroup size
const CHUNK = 1 << 16;         // queries per submission: short submissions keep clear of GPU watchdogs on slow devices

// the triangle-tree walk, shared by the winding number and the distance (node layout: index.js packBVH)
const BVH_WGSL = /* wgsl */`
struct Params { n: u32, stride: u32, offset: u32, flags: u32, beta: f32, bound2: f32, p0: f32, p1: f32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> nodes: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> tris: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> pts: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> outv: array<vec2<f32>>;

const PI4: f32 = 12.566370614359172;

// Ericson, Real-Time Collision Detection 5.1.5 (as geom/bvh.js pointTri2)
fn pointTri2(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> f32 {
  let ab = b - a; let ac = c - a; let ap = p - a;
  let d1 = dot(ab, ap); let d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { let e = p - a; return dot(e, e); }
  let bp = p - b; let d3 = dot(ab, bp); let d4 = dot(ac, bp);
  let cp = p - c; let d5 = dot(ab, cp); let d6 = dot(ac, cp);
  let vc = d1 * d4 - d3 * d2; let vb = d5 * d2 - d1 * d6; let va = d3 * d6 - d5 * d4;
  var q: vec3<f32>;
  if (d3 >= 0.0 && d4 <= d3) { q = b; }
  else if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) { q = a + (d1 / (d1 - d3)) * ab; }
  else if (d6 >= 0.0 && d5 <= d6) { q = c; }
  else if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) { q = a + (d2 / (d2 - d6)) * ac; }
  else if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) { q = b + ((d4 - d3) / ((d4 - d3) + (d5 - d6))) * (c - b); }
  else { let den = 1.0 / (va + vb + vc); q = a + ab * (vb * den) + ac * (vc * den); }
  let e = p - q; return dot(e, e);
}

fn winding(q: vec3<f32>, beta: f32) -> f32 {
  var stack: array<u32, 64>;
  var sp: i32 = 1; stack[0] = 0u;
  var w: f32 = 0.0;
  loop {
    if (sp == 0) { break; }
    sp -= 1; let o = 8u * stack[sp];
    let c = nodes[o]; let d = c.xyz - q; let d2 = dot(d, d); let r = beta * c.w;
    if (d2 > r * r) {
      // far: dipole + first-order moment (Barill et al. 2018), as geom/bvh.js winding
      let dn = sqrt(d2); let i3 = 1.0 / (d2 * dn); let i5 = i3 / d2;
      let N = nodes[o + 1u]; let m0 = nodes[o + 2u]; let m1 = nodes[o + 3u]; let m2 = nodes[o + 4u];
      let xMx = d.x * dot(m0.xyz, d) + d.y * dot(vec3<f32>(m0.w, m1.x, m1.y), d) + d.z * dot(vec3<f32>(m1.z, m1.w, m2.x), d);
      w += dot(d, N.xyz) * i3 + N.w * i3 - 3.0 * xMx * i5;
      continue;
    }
    let info = nodes[o + 4u];
    if (info.y < 0.0) {
      let s = u32(info.w); let e = s + u32(nodes[o + 5u].x);
      for (var k = s; k < e; k++) {
        let a = tris[3u * k].xyz - q; let b = tris[3u * k + 1u].xyz - q; let cc = tris[3u * k + 2u].xyz - q;
        let la = length(a); let lb = length(b); let lc = length(cc);
        let num = dot(a, cross(b, cc));
        let den = la * lb * lc + dot(a, b) * lc + dot(b, cc) * la + dot(cc, a) * lb;
        w += 2.0 * atan2(num, den);
      }
    } else if (sp < 63) {
      stack[sp] = u32(info.z); stack[sp + 1] = u32(info.y); sp += 2;
    }
  }
  return w / PI4;
}

fn boxD2(o: u32, q: vec3<f32>) -> f32 {
  let dd = max(max(nodes[o + 6u].xyz - q, vec3<f32>(0.0)), q - nodes[o + 7u].xyz); return dot(dd, dd);
}

fn nearest(q: vec3<f32>, bound2: f32) -> f32 {
  var stack: array<u32, 64>;
  var sp: i32 = 1; stack[0] = 0u;
  var best = bound2;
  loop {
    if (sp == 0) { break; }
    sp -= 1; let n = stack[sp]; let o = 8u * n;
    if (boxD2(o, q) >= best) { continue; }
    let info = nodes[o + 4u];
    if (info.y < 0.0) {
      let s = u32(info.w); let e = s + u32(nodes[o + 5u].x);
      for (var k = s; k < e; k++) { best = min(best, pointTri2(q, tris[3u * k].xyz, tris[3u * k + 1u].xyz, tris[3u * k + 2u].xyz)); }
    } else if (sp < 63) {
      let l = u32(info.y); let r = u32(info.z);
      // the nearer child is popped first
      if (boxD2(8u * l, q) < boxD2(8u * r, q)) { stack[sp] = r; stack[sp + 1] = l; } else { stack[sp] = l; stack[sp + 1] = r; }
      sp += 2;
    }
  }
  return best;
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * P.stride + P.offset;
  if (i >= P.n) { return; }
  let q = pts[i].xyz;
  var w = 0.0; var d2 = 0.0;
  if ((P.flags & 1u) != 0u) { w = winding(q, P.beta); }
  if ((P.flags & 2u) != 0u) { d2 = nearest(q, P.bound2); }
  outv[i] = vec2<f32>(w, d2);
}`;

// the shaped parts' deficit sums: per (variant, anchor base), sum_k val[k] w[base + rel[k]] (compensated)
const DEF_WGSL = /* wgsl */`
struct Params { n: u32, stride: u32, offset: u32, p0: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> rel: array<i32>;
@group(0) @binding(3) var<storage, read> val: array<f32>;
@group(0) @binding(4) var<storage, read> info: array<vec2<i32>>;
@group(0) @binding(5) var<storage, read> pairs: array<vec2<i32>>;
@group(0) @binding(6) var<storage, read_write> outs: array<f32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * P.stride + P.offset;
  if (i >= P.n) { return; }
  let p = pairs[i]; let inf = info[p.x];
  var s: f32 = 0.0; var c: f32 = 0.0;
  for (var k = inf.x; k < inf.x + inf.y; k++) {
    let y = val[k] * w[p.y + rel[k]] - c; let t = s + y; c = (t - s) - y; s = t;
  }
  outs[i] = s;
}`;

export async function create({ log = () => {} } = {}) {
  const gpu = typeof navigator !== 'undefined' && navigator.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const want = (k) => adapter.limits[k];
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: want('maxStorageBufferBindingSize'), maxBufferSize: want('maxBufferSize'), maxComputeWorkgroupsPerDimension: want('maxComputeWorkgroupsPerDimension') } });
  let lost = false, disposed = false; device.lost.then((i) => { lost = true; if (!disposed) log(`gpu: WebGPU device lost (${i.message || i.reason})`); });
  const info = adapter.info || {};
  const label = `WebGPU${info.vendor || info.description ? ` (${[info.vendor, info.architecture || info.description].filter(Boolean).join(' ')})` : ''}`;
  const software = !!(info.isFallbackAdapter || adapter.isFallbackAdapter) || isSoftware([info.vendor, info.architecture, info.device, info.description].join(' '));
  const maxBind = device.limits.maxStorageBufferBindingSize, maxGroups = device.limits.maxComputeWorkgroupsPerDimension;

  const pipe = (code) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const bvhPipe = pipe(BVH_WGSL), defPipe = pipe(DEF_WGSL);
  const S = GPUBufferUsage;
  const buf = (data, usage = S.STORAGE | S.COPY_DST) => {
    if (data.byteLength > maxBind) throw new Error(`buffer of ${(data.byteLength / 1e6).toFixed(0)} MB over the device's ${(maxBind / 1e6).toFixed(0)} MB`);
    const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage }); device.queue.writeBuffer(b, 0, data); return b;
  };
  const outBuf = (bytes) => device.createBuffer({ size: Math.max(16, bytes), usage: S.STORAGE | S.COPY_SRC });

  // dispatch `n` invocations in chunks; `uniforms(offset)` -> the chunk's uniform words
  const run = async (pipeline, entries, n, uniforms, out, outBytes) => {
    if (lost) throw new Error('WebGPU device lost');
    const groupsPer = Math.ceil(Math.min(n, CHUNK) / WG), gx = Math.min(groupsPer, maxGroups), gy = Math.ceil(groupsPer / gx), stride = gx * WG;
    const ubufs = [];
    for (let off = 0; off < n; off += CHUNK) {
      const u = device.createBuffer({ size: 32, usage: S.UNIFORM | S.COPY_DST }); device.queue.writeBuffer(u, 0, uniforms(off, stride)); ubufs.push(u);
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: u } }, ...entries] });
      const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(gx, gy); pass.end();
      device.queue.submit([enc.finish()]);
    }
    const rb = device.createBuffer({ size: Math.max(16, outBytes), usage: S.MAP_READ | S.COPY_DST });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(out, 0, rb, 0, Math.max(16, outBytes)); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const res = new Float32Array(rb.getMappedRange().slice(0, outBytes));
    rb.unmap(); rb.destroy(); ubufs.forEach((u) => u.destroy());
    return res;
  };

  // the BVH buffers stay on the device while the same packed tree is queried again
  let bvhKey = null, bvhBufs = null;
  const defCache = new Map();
  return {
    kind: 'webgpu', label, software,
    /** packed: index.js packBVH; pts: vec4 rows; beta > 0: winding numbers; bound2 > 0: squared distances (capped at bound2) */
    async bvhQuery(packed, pts, { beta = 0, bound2 = 0 } = {}) {
      const n = pts.length / 4;
      if (bvhKey !== packed) { if (bvhBufs) bvhBufs.forEach((b) => b.destroy()); bvhBufs = [buf(packed.nodes), buf(packed.tris)]; bvhKey = packed; }
      const pb = buf(pts), ob = outBuf(8 * n), flags = (beta > 0 ? 1 : 0) | (bound2 > 0 ? 2 : 0);
      const r = await run(bvhPipe, [{ binding: 1, resource: { buffer: bvhBufs[0] } }, { binding: 2, resource: { buffer: bvhBufs[1] } }, { binding: 3, resource: { buffer: pb } }, { binding: 4, resource: { buffer: ob } }], n,
        (off, stride) => { const a = new ArrayBuffer(32), u = new Uint32Array(a), f = new Float32Array(a); u[0] = n; u[1] = stride; u[2] = off; u[3] = flags; f[4] = beta; f[5] = bound2; return a; }, ob, 8 * n);
      pb.destroy(); ob.destroy();
      const w = new Float32Array(n), d2 = new Float32Array(n);
      for (let i = 0; i < n; i++) { w[i] = r[2 * i]; d2[i] = r[2 * i + 1]; }
      return { w, d2 };
    },
    /** w: the field; table: index.js packDeficits; pairs: pack.js shapedPairs -> Float32Array of sums */
    async deficitSums(w, table, pairs) {
      const n = pairs.n; if (!n) return new Float32Array(0);
      let t = defCache.get(table.key);
      if (!t || t.table !== table) { if (t) t.bufs.forEach((b) => b.destroy()); t = { table, bufs: [buf(table.rel), buf(table.val), buf(table.info)] }; defCache.set(table.key, t); }
      const pv = new Int32Array(2 * n); for (let i = 0; i < n; i++) { pv[2 * i] = pairs.vi[i]; pv[2 * i + 1] = pairs.base[i]; }
      const wb = buf(w), pb = buf(pv), ob = outBuf(4 * n);
      const r = await run(defPipe, [{ binding: 1, resource: { buffer: wb } }, { binding: 2, resource: { buffer: t.bufs[0] } }, { binding: 3, resource: { buffer: t.bufs[1] } }, { binding: 4, resource: { buffer: t.bufs[2] } }, { binding: 5, resource: { buffer: pb } }, { binding: 6, resource: { buffer: ob } }], n,
        (off, stride) => new Uint32Array([n, stride, off, 0]).buffer, ob, 4 * n);
      wb.destroy(); pb.destroy(); ob.destroy();
      return r;
    },
    dispose() { disposed = true; if (bvhBufs) bvhBufs.forEach((b) => b.destroy()); defCache.forEach((t) => t.bufs.forEach((b) => b.destroy())); device.destroy(); },
  };
}
