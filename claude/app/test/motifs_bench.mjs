// motifs off vs on, on a few models: pieces, IoU, components, time, share of pieces that came from a motif.
// usage: node test/motifs_bench.mjs [studs] [model.glb ...]   (default: models/*.glb at 16 studs)
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
const [n = '16', ...files] = process.argv.slice(2);
const list = files.length ? files : fs.readdirSync('models').filter((f) => f.endsWith('.glb')).map((f) => 'models/' + f);
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const rows = [];
for (const f of list) {
  const buf = fs.readFileSync(f), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const motifs of [false, true]) {
    const t = Date.now(), r = generate(model, { studs: +n, motifs, ...extra });
    const fromMotif = r.pieces.filter((p) => p.motif).length, motifIds = new Set(r.pieces.filter((p) => p.motif).map((p) => p.motif)).size;
    rows.push({ model: f.split('/').pop().replace('.glb', ''), motifs, ms: Date.now() - t, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), recall: +r.metrics.recall.toFixed(3), comps: r.metrics.components, grounded: +r.metrics.grounded.toFixed(2), fromMotif, motifIds, kinds: r.metrics.kinds });
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/${rows[rows.length - 1].model}_${n}_${motifs ? 'on' : 'off'}.json`, JSON.stringify(r.pieces));
  }
}
console.table(rows.map(({ kinds, ...r }) => r));
for (const r of rows) console.log(r.model, r.motifs ? 'on ' : 'off', JSON.stringify(r.kinds));
