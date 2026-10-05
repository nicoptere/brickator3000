// Motif libraries side by side: the built-in one (src/motifs/motifs.js) against mined / merged .json files, on the models.
// usage: node test/library_bench.mjs [studs=16] [--lib out/mocs_full/motifs.json ...] [--models a.glb,b.glb] [--opts "wall=true ..."]
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
const argv = process.argv.slice(2);
const n = +(argv.find((a) => /^\d+$/.test(a)) || 16);
const libs = argv.flatMap((a, i) => (a === '--lib' ? [argv[i + 1]] : []));
const modelsArg = argv[argv.indexOf('--models') + 1];
const list = argv.includes('--models') ? modelsArg.split(',') : fs.readdirSync('models').filter((f) => f.endsWith('.glb')).map((f) => 'models/' + f);
const extra = {}; for (const kv of ((argv.includes('--opts') && argv[argv.indexOf('--opts') + 1]) || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const variants = [['off', { motifs: false }], ['built-in', { motifs: true }], ...libs.map((f) => [f.split('/').slice(-2).join('/'), { motifs: true, motifLibrary: JSON.parse(fs.readFileSync(f, 'utf8')).motifs }])];
const rows = [], tot = {};
for (const f of list) {
  const buf = fs.readFileSync(f), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const [name, o] of variants) {
    const t = Date.now(), r = generate(model, { studs: n, ...o, ...extra });
    const fromMotif = r.pieces.filter((p) => p.motif).length, motifIds = new Set(r.pieces.filter((p) => p.motif).map((p) => p.motif)).size;
    const row = { model: f.split('/').pop().replace('.glb', ''), lib: name, ms: Date.now() - t, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), comps: r.metrics.components, fromMotif, motifIds, score: +(r.metrics.iou - 0.002 * r.metrics.pieces).toFixed(3) };
    rows.push(row);
    const T = tot[name] || (tot[name] = { lib: name, pieces: 0, iou: 0, score: 0, fromMotif: 0, ms: 0, n: 0 });
    T.pieces += row.pieces; T.iou += row.iou; T.score += row.score; T.fromMotif += row.fromMotif; T.ms += row.ms; T.n++;
  }
}
console.table(rows);
console.table(Object.values(tot).map((T) => ({ lib: T.lib, models: T.n, pieces: T.pieces, 'mean iou': +(T.iou / T.n).toFixed(4), 'mean score': +(T.score / T.n).toFixed(4), fromMotif: T.fromMotif, s: +(T.ms / 1000).toFixed(0) })));
