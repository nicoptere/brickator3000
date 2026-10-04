// The field options against each other on real models: rays | rays + lattice alignment | mesh smoothing | SDF (+ median) | external grid.
// IoU here is each run's own metric (against the field it solved), so compare piece counts and IoU together; for a measurement
// against a CLEAN reference under controlled grain see test/noise_bench.mjs.
//
// usage: node test/field_bench.mjs [studs] [model.glb ...]     (default: models/*.glb at 24 studs)
//   OPTS="precision=4 crust=true ..." adds engine options to every variant; VARIANTS=rays,align,smooth10 picks a subset;
//   GRID=path/to/model.sdf.json adds an 'external' variant that loads a grid written by claude/siren/fit_siren.py
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate } from '../src/brickgen/pipeline.js';
import { loadSdfGrid } from '../tools/sdf_grid.mjs';
const [n = '24', ...files] = process.argv.slice(2);
const list = files.length ? files : fs.readdirSync('models').filter((f) => f.endsWith('.glb')).map((f) => 'models/' + f);
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const ALL = {
  rays: { gridAlign: false },
  align: { gridAlign: true },
  smooth10: { gridAlign: false, meshSmooth: 10 },
  sdf: { gridAlign: false, field: 'sdf' },
  'sdf+med1': { gridAlign: false, field: 'sdf', sdfMedian: 1 },
  'align+sdf+med1': { gridAlign: true, field: 'sdf', sdfMedian: 1 },
};
if (process.env.GRID) ALL.external = { gridAlign: true, field: 'sdf', sdfGrid: loadSdfGrid(process.env.GRID) };
const pick = process.env.VARIANTS ? process.env.VARIANTS.split(',') : ['rays', 'align', 'smooth10', 'sdf+med1', ...(process.env.GRID ? ['external'] : [])];
const rows = [];
for (const f of list) {
  const buf = fs.readFileSync(f), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const k of pick) {
    const t = Date.now(), r = generate(model, { studs: +n, ref: 'maxh', partSet: 'extended', symmetry: 'off', ...extra, ...ALL[k] });
    const al = r.align;
    rows.push({ model: f.split('/').pop().replace('.glb', ''), variant: k, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), recall: +r.metrics.recall.toFixed(3), comps: r.metrics.components,
      '1x1': r.pieces.filter((p) => p.w === 1 && p.d === 1 && !p.snot).length, 'scale': al ? +(al.s / al.s0).toFixed(3) : 1, 'shift x,z': al ? al.shift.map((x) => x.toFixed(1)).join(',') : '-', 'field ms': Math.round(r.timing.raycast), s: +((Date.now() - t) / 1000).toFixed(1) });
  }
}
console.table(rows);
