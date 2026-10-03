import fs from 'fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
const [file, n = '16', ...rest] = process.argv.slice(2);
const buf = fs.readFileSync(file); const model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const opts = { studs: +n, offsets: [0] }; for (const kv of rest) { const [k, v] = kv.split('='); opts[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const r = generate(model, opts);
const ids = {}; for (const p of r.pieces) { const k = `${p.name} (${p.id})`; ids[k] = (ids[k] || 0) + 1; }
const rows = Object.entries(ids).sort((a, b) => b[1] - a[1]);
console.log('pieces', r.pieces.length, 'distinct parts', rows.length, 'comps', r.metrics.components, 'iou', r.metrics.iou.toFixed(3), 'ms', r.timing.total | 0);
console.log(rows.slice(0, 25).map(([k, v]) => `${v}\t${k}`).join('\n'));
const ph = {}; for (const p of r.pieces) ph[p.phase] = (ph[p.phase] || 0) + 1; console.log(JSON.stringify(ph));
