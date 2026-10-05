// Scenes for the paper's curved-surface and resolution sections (rounds 4-8, docs/CURVES.md) -> <out>/data/*.ldr + rounds.json
//   cd claude/app && node ../paper/export_rounds.mjs <work>/data          (~10 min: full-pipeline solves at several stud counts)
// Colouring: `kd_` files colour each piece by its kind (export.KIND_COL: plates / bricks grey, slopes, curved, round, inverted...),
// `res_` files keep the model's colours, `br_` files colour the bridge chains.
import fs from 'node:fs';
import path from 'node:path';
import { parseGLB } from '../app/src/brickgen/mesh.js';
import { generate, catalogFor } from '../app/src/brickgen/pipeline.js';
import { toLDR, KIND_COL } from '../app/src/brickgen/export.js';
import { CURVED } from '../app/test/synthetic.mjs';
const out = process.argv[2] || 'paper_data'; fs.mkdirSync(out, { recursive: true });
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const ROUND4 = { skinNarrow: false, skinAlign: 0, widen: false, motifVerify: false, discRing: 0, roundsAfterSkin: false, bridgeOutside: true };   // what was committed before round 5
const load = (f) => (f.startsWith('synth:') ? CURVED[f.slice(6)]() : (() => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })());
const stats = {};
const kindCol = (p) => (p.snot ? [20, 240, 190] : (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255)));
function solve(name, file, studs, opts, colour) {
  const t0 = Date.now(), r = generate(load(file), { ...FULL, studs, ...opts }), cat = catalogFor(r.options);
  const pieces = colour ? r.pieces.map((p) => ({ ...p, rgb: colour(p), code: undefined })) : r.pieces;
  fs.writeFileSync(path.join(out, `${name}.ldr`), toLDR(pieces, cat, name));
  stats[name] = { studs: r.options.studs, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), comps: r.metrics.components, stairs: r.metrics.stairs, under: r.metrics.under, motifCheck: r.post && r.post.motifCheck, auto: r.options.autoChoice ? { studs: r.options.autoChoice.studs, by: r.options.autoChoice.chosen, budget: r.options.autoChoice.budget.studs, ceiling: r.options.autoChoice.detail } : undefined, ms: Date.now() - t0 };
  console.log(name.padEnd(28), `${r.options.studs} studs  ${r.metrics.pieces}p  IoU ${r.metrics.iou.toFixed(3)}  comps ${r.metrics.components}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// rounds 4 -> 5: the sloped skin, by kind
for (const [m, f, n] of [['duck', 'models/duck.glb', 24], ['dome', 'synth:dome', 16], ['sphere', 'synth:sphere', 16], ['dolphin', 'models/dolphin.glb', 32]]) {
  solve(`kd_${m}_round4`, f, n, ROUND4, kindCol); solve(`kd_${m}_round5`, f, n, {}, kindCol);
}
// round 7: the bridge in the air (dome skirt) and the SNOT synthesis on the boss box
solve('br_dome_outside', 'synth:dome', 16, { bridgeOutside: true }, (p) => (p.phase === 'T-bridge' ? [235, 104, 52] : [200, 200, 200]));
solve('br_dome_inside', 'synth:dome', 16, {}, (p) => (p.phase === 'T-bridge' ? [235, 104, 52] : [200, 200, 200]));
solve('br_duck_outside', 'models/duck.glb', 24, { bridgeOutside: true }, (p) => (p.phase === 'T-bridge' ? [235, 104, 52] : [200, 200, 200]));
solve('br_duck_inside', 'models/duck.glb', 24, {}, (p) => (p.phase === 'T-bridge' ? [235, 104, 52] : [200, 200, 200]));
solve('sn_boxBoss_off', 'synth:boxBoss', 24, { snot: false }, kindCol); solve('sn_boxBoss_snot', 'synth:boxBoss', 24, { snot: true }, kindCol);
// round 8: the lattice effect (the same table / chair at a lucky and an unlucky stud count), the sphere past its ceiling, and the automatic choice
solve('res_table_35', 'models/table_baked.glb', 35, {}); solve('res_table_43', 'models/table_baked.glb', 43, {});
solve('res_chair_32', 'models/bieder_chair.glb', 32, {}); solve('res_chair_37', 'models/bieder_chair.glb', 37, {});
solve('res_sphere_14', 'synth:sphere', 14, {}, kindCol); solve('res_sphere_32', 'synth:sphere', 32, {}, kindCol);
for (const [m, f] of [['duck', 'models/duck.glb'], ['table_baked', 'models/table_baked.glb'], ['bieder_chair', 'models/bieder_chair.glb'], ['dolphin', 'models/dolphin.glb'], ['boxRoundEdge', 'synth:boxRoundEdge']]) solve(`auto_${m}`, f, 'auto', {});
fs.writeFileSync(path.join(out, 'rounds.json'), JSON.stringify(stats, null, 1));
