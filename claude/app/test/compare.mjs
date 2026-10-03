// compare option sets across models: node test/compare.mjs "<optsA>" "<optsB>" model:studs ...
import fs from 'fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
const parse = (s) => { const o = { offsets: [0] }; for (const kv of s.split(' ').filter(Boolean)) { const [k, v] = kv.split('='); o[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; } return o; };
const [A, B, ...models] = process.argv.slice(2);
for (const ms of models) {
  const [m, n] = ms.split(':'); const buf = fs.readFileSync(`models/${m}.glb`); const model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const row = [];
  for (const o of [A, B]) { const r = generate(model, { studs: +n, ...parse(o) }); const k = r.metrics.kinds; const shaped = (k.slope || 0) + (k.curved || 0) + (k.cheese || 0) + (k.inverted || 0) + (k.round || 0) + (k.shaped || 0);
    row.push(`${String(r.metrics.pieces).padStart(5)}p ${String(r.metrics.components).padStart(4)}c g${r.metrics.grounded.toFixed(2)} iou${r.metrics.iou.toFixed(3)} ${String(Object.keys(r.metrics.ids).length).padStart(2)}ids shaped${String(shaped).padStart(4)} ${String(r.timing.total | 0).padStart(5)}ms`); }
  console.log(`${m}:${n}`.padEnd(13), row.join('   →   '));
}
