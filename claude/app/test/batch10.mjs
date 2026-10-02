// 10 random models x sizes; writes GLB (piece colours + kinds), LDR, report and a scene file for the still renderer.
import fs from 'fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate, CATALOG } from '../src/brickgen/pipeline.js';
import { buildMesh, toGLB, toLDR, KIND_COL } from '../src/brickgen/export.js';
import { srgb2lin } from '../src/brickgen/mesh.js';
const ROOT = '/mnt/user-data/uploads/brickator3000/discretizer/public/models/clean/';
const MODELS = 'animals/lebis animals/deinonic plants/hedera electronics/tlamp1 furniture/rosewood electronics/hair_f airplanes/thunder1 trains/ave_vagc motorcycles/jawa contemporary_furniture/chiffo'.split(' ');
const SIZES = process.argv.slice(2).map(Number); const OUT = process.env.OUT || 'out/r10js'; fs.mkdirSync(OUT, { recursive: true });
const summ = `${OUT}/summary.json`, rows = fs.existsSync(summ) ? JSON.parse(fs.readFileSync(summ)) : [];
for (const n of SIZES.length ? SIZES : [16, 24, 32]) for (const m of MODELS) {
  const name = m.split('/')[1], tag = `${OUT}/${name}_${n}`;
  if (rows.some((r) => r.tag === tag) || (process.env.SKIP || '').split(',').includes(name + '_' + n)) continue;
  const buf = fs.readFileSync(ROOT + m + '.glb'), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const t = Date.now();
  const r = generate(model, { studs: n, offsets: n <= 16 ? [0, 8, 16] : [0, 8] });
  const ms = Date.now() - t;
  const mesh = buildMesh(r.pieces, CATALOG), kinds = buildMesh(r.pieces, CATALOG, 'kind');
  fs.writeFileSync(`${tag}.glb`, Buffer.from(toGLB(mesh)));
  fs.writeFileSync(`${tag}_kinds.glb`, Buffer.from(toGLB(kinds)));
  fs.writeFileSync(`${tag}.ldr`, toLDR(r.pieces, CATALOG, name));
  const row = { tag, model: m, studs: n, ms, dims: r.dims, pieces: r.metrics.pieces, kinds: r.metrics.kinds, iou: +r.metrics.iou.toFixed(3), recall: +r.metrics.recall.toFixed(3),
    overfill: +r.metrics.overfill.toFixed(3), grounded: +r.metrics.grounded.toFixed(3), largest: +r.metrics.largest.toFixed(3), components: r.metrics.components,
    symmetry: r.symmetry, post: r.post, timing: Object.fromEntries(Object.entries(r.timing).map(([k, v]) => [k, Math.round(v)])) };
  fs.writeFileSync(`${tag}_report.json`, JSON.stringify({ ...row, pieces: r.pieces }, null, 0));
  // scene for render.html (linear colours) -- only for models small enough to serialise
  const lin = (a) => Array.from(a, (v) => +srgb2lin(v).toFixed(3));
  const legend = Object.entries(r.metrics.kinds).map(([k, c]) => `<i style="background:rgb(${KIND_COL[k].map((x) => Math.round(x * 255)).join(',')})"></i>${k} ${c}<br>`).join('');
  const soup = (m, a, s) => { const o = []; for (const i of m.idx) for (let c = 0; c < 3; c++) o.push(s(m[a][i * 3 + c])); return o; };
  const sc = { lego_pos: soup(mesh, 'pos', (v) => +v.toFixed(2)), lego_col: soup(mesh, 'col', (v) => +srgb2lin(v / 255).toFixed(3)), lego_kind: soup(kinds, 'col', (v) => +srgb2lin(v / 255).toFixed(3)), edges: Array.from(mesh.edges, (v) => +v.toFixed(2)),
    src_pos: Array.from(r.srcTris, (v) => +v.toFixed(2)), src_col: Array.from(r.srcCols, (v) => +v.toFixed(3)),
    meta: { src: `${name}.glb - ${r.srcTris.length / 9} triangles`, lego: `${r.metrics.pieces} pieces - grid ${r.dims[0]}x${r.dims[1]} studs x ${r.dims[2]} plates - JS port`, legend } };
  try { if (r.pieces.length <= 6000) fs.writeFileSync(`${tag}.json`, JSON.stringify(sc)); } catch (e) { console.log('scene too large for the still renderer:', tag); }
  rows.push(row); fs.writeFileSync(summ, JSON.stringify(rows, null, 1));
  console.log(JSON.stringify({ tag, ms, dims: r.dims, pieces: row.pieces, iou: row.iou, grounded: row.grounded, largest: row.largest, sym: r.symmetry && r.symmetry.used }));
}
