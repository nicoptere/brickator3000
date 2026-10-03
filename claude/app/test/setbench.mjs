// limited vs extended part set: time, piece count, quality and connectivity on a few models
import fs from 'fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate, FULL_CATALOG } from '../src/brickgen/pipeline.js';
const ROOT = '/mnt/user-data/uploads/brickator3000/discretizer/public/models/';
const MODELS = (process.env.MODELS || 'clean/electronics/tlamp1 clean/furniture/rosewood clean/motorcycles/jawa').split(' ');
const N = +(process.env.N || 16);
for (const m of MODELS) {
  const f = ROOT + m + '.glb'; if (!fs.existsSync(f)) { console.log('missing', f); continue; }
  const buf = fs.readFileSync(f), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const partSet of ['limited', 'extended']) {
    const t = Date.now(); const r = generate(model, { studs: N, partSet, offsets: [0, 4, 8] }); const ms = Date.now() - t;
    const k = r.metrics.kinds;
    console.log(JSON.stringify({ m: m.split('/').pop(), partSet, ms, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), over: +r.metrics.overfill.toFixed(3), grounded: +r.metrics.grounded.toFixed(3), comps: r.metrics.components, kinds: k, ids: new Set(r.pieces.map((p) => p.id)).size }));
  }
}
