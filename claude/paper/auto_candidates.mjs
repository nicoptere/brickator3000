// pipeline.autoStuds on the test models -> JSON (the candidate tables of the paper's resolution section and docs/CURVES.md §13)
//   cd claude/app && node ../paper/auto_candidates.mjs <work>/data/auto_candidates.json
import fs from 'node:fs';
import { parseGLB } from '../app/src/brickgen/mesh.js';
import { autoStuds } from '../app/src/brickgen/pipeline.js';
import { CURVED } from '../app/test/synthetic.mjs';
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const load = (f) => (f.startsWith('synth:') ? CURVED[f.slice(6)]() : (() => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })());
const files = ['synth:sphere', 'synth:dome', 'synth:cylinderX', 'synth:boxRoundEdge', 'synth:boxRoundEdge24', 'synth:boxBoss', 'models/duck.glb', 'models/dolphin.glb', 'models/table_baked.glb', 'models/bieder_chair.glb', 'models/rafs5.glb', 'models/be2.glb'];
const out = {};
for (const f of files) {
  const name = f.replace(/^synth:|^models\/|\.glb/g, ''), a = autoStuds(load(f), FULL);
  out[name] = a;
  console.log(name.padEnd(16), `-> ${a.studs} [${a.chosen}]  budget ${a.budget.studs} (exp ${a.budget.exp})  ceiling ${a.detail ?? '-'}  curved share ${a.feature.curv.share}  ${a.ms} ms   ` + a.candidates.map((c) => `${c.studs}:${c.iou.toFixed(3)}`).join(' '));
}
fs.writeFileSync(process.argv[2] || 'auto_candidates.json', JSON.stringify(out, null, 1));
