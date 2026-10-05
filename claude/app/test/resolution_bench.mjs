// Which resolution? The rate-distortion curve of the engine itself (docs/CURVES.md round 8): the model is solved at several stud
// counts, every solution is rasterised back into ONE fine reference voxelisation of the mesh (the field at `REF` studs, no lattice
// fit), and its fidelity there - IoU against the reference solid, the carved hollow counted as solid, so comparable across
// resolutions - is plotted against the piece count. `band` is the same IoU within half a stud (at BAND studs) of the reference
// surface: where the detail lives. Next to it the fidelity of the FIELD alone at that stud count (what the voxel grid can
// represent before any part is chosen; the solver's own loss is the gap between the two). The knee of fidelity vs log(pieces)
// (Kneedle: the point farthest from the chord between the ends of the normalised curve, Satopaa et al. 2011) is the resolution
// past which the model gains little per piece.
// Printed first: the a-priori choice of pipeline.autoStuds (piece budget from two pilot solves, curvature ceiling, field-fidelity
// tie-break), which is what `studs: 'auto'` resolves to before the full solve.
//
// usage: node test/resolution_bench.mjs [model.glb | synth:name ...]      STUDS=8,12,16,20,24,32,40,48  REF=96  BAND=24  OPTS="motifs=false ..."  OUT=rd.json
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate, catalogFor, autoStuds, DEFAULTS } from '../src/brickgen/pipeline.js';
import { prepare } from '../src/brickgen/grid.js';
import { referenceField, fieldFidelity, solutionFidelity, bandFor, knee } from '../src/brickgen/resolution.js';
import { G } from '../src/brickgen/constants.js';
import { CURVED } from './synthetic.mjs';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['synth:sphere', 'synth:boxRoundEdge', 'models/duck.glb', 'models/dolphin.glb', 'models/table_baked.glb', 'models/bieder_chair.glb', 'models/rafs5.glb'];
const STUDS = (process.env.STUDS || '8,12,16,20,24,32,40,48').split(',').map(Number), REF = +(process.env.REF || 96), BAND = +(process.env.BAND || 24);
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off', ...extra };
const load = (f) => (f.startsWith('synth:') ? CURVED[f.slice(6)]() : (() => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })());
const all = {};
for (const f of files) {
  const model = load(f), name = f.replace(/^synth:|^models\/|\.glb/g, '');
  const ref = referenceField(model, REF, { ...DEFAULTS, ...FULL }), band = bandFor(ref, BAND), sug = autoStuds(model, FULL), rows = [];
  for (const n of STUDS) {
    const t0 = Date.now(), r = generate(model, { ...FULL, studs: n }), cat = catalogFor(r.options), fid = solutionFidelity(r, ref, cat, r.options, band);
    const pre = prepare({ tris: model.tris, pts: new Float32Array(0) }, n, { ...DEFAULTS, ...FULL, crust: false, islands: false, decimate: false }), ff = fieldFidelity(pre, ref, band);   // the field as the engine sees it (lattice fit on), uncarved
    rows.push({ n, pieces: r.metrics.pieces, own: r.metrics.iou, iou: fid.iou, band: fid.band, fieldIou: ff.iou, fieldBand: ff.band, comps: r.metrics.components, align: r.align ? r.align.score : 0, ms: Date.now() - t0 });
  }
  const k = knee(rows.map((q) => Math.log(q.pieces)), rows.map((q) => q.iou));
  all[name] = { auto: sug, rows, knee: rows[k].n, band };
  console.log(`== ${name}: reference ${REF} studs (${ref.NX / G}x${ref.NZ / G}x${ref.nl}), band ${band} cells; autoStuds -> ${sug.studs} [${sug.chosen}] (budget ${sug.budget.studs} at exponent ${sug.budget.exp}; curvature ceiling ${sug.detail ?? '-'}, R ${sug.feature.curv.radius} share ${sug.feature.curv.share}; ${sug.ms} ms); knee of the IoU curve -> ${rows[k].n} studs`);
  console.log(`   studs  pieces   solution: IoU / band IoU   field: IoU / band   (own IoU)  lattice  comps   time`);
  for (const q of rows) console.log(`   ${String(q.n).padStart(3)}   ${String(q.pieces).padStart(6)}        ${q.iou.toFixed(3)} / ${q.band.toFixed(3)}          ${q.fieldIou.toFixed(3)} / ${q.fieldBand.toFixed(3)}        (${q.own.toFixed(3)})   ${q.align.toFixed(2)}    ${String(q.comps).padStart(3)}   ${(q.ms / 1000).toFixed(1)}s${rows[k] === q ? '   <- knee' : ''}`);
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(all, null, 1));
