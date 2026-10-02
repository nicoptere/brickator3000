import fs from 'fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
const [file, n = '16', ...rest] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const opts = { studs: +n }; for (const kv of rest) { const [k, v] = kv.split('='); opts[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const t = Date.now();
const r = generate(model, opts, { log: (s) => console.log('  ' + s) });
console.log(JSON.stringify({ file: file.split('/').pop(), n, ms: Date.now() - t, tris: model.tris.length / 9, dims: r.dims, job: r.job,
  pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), recall: +r.metrics.recall.toFixed(3), overfill: +r.metrics.overfill.toFixed(3),
  grounded: +r.metrics.grounded.toFixed(3), largest: +r.metrics.largest.toFixed(3), comps: r.metrics.components, kinds: r.metrics.kinds, sym: r.symmetry, post: r.post, islands: r.islands,
  timing: Object.fromEntries(Object.entries(r.timing).map(([k, v]) => [k, Math.round(v)])) }));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(r.pieces));
