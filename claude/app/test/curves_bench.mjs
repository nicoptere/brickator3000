// Curved surfaces (docs/CURVES.md): the round-4 recipes (disc layers, corner rounding) and the round-5 skin (1-wide skin parts
// first, slope alignment, widening, motif verification) against the earlier defaults, on real models and on the synthetic
// curved shapes of test/synthetic.mjs (dome, sphere, lying cylinder, egg, cone). Prints pieces / IoU / recall / components, the
// surface metric (`stairs`: share of the sloped top-surface columns covered by a flat part instead of a slope; `under`: the same
// for the undersides), the 1x1 count and the number of skin parts. With OUT=dir, one LDR per run coloured by part kind.
//
// usage: node test/curves_bench.mjs [studs] [model.glb | synth:dome | synth:sphere | synth:cylinderX | synth:egg | synth:cone ...]
//   default: dome, sphere, cylinderX @16, duck @24, bieder_chair / dolphin / table_baked @32
//   VARIANTS=round3,round4,round5,nomotif  picks variants (default round4,round5); OPTS="skinAlign=0 ..." adds options to every variant
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate, catalogFor } from '../src/brickgen/pipeline.js';
import { toLDR, KIND_COL } from '../src/brickgen/export.js';
import { CURVED } from './synthetic.mjs';
const [n, ...files] = process.argv.slice(2);
const list = files.length ? files.map((f) => [f, +n || 24]) : [['synth:dome', 16], ['synth:sphere', 16], ['synth:cylinderX', 16], ['models/duck.glb', 24], ['models/bieder_chair.glb', 32], ['models/dolphin.glb', 32], ['models/table_baked.glb', 32]];
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = v.startsWith('{') ? JSON.parse(v) : isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const ALL = {
  round3: { discs: false, roundCorners: false, skinNarrow: false, skinAlign: 0, widen: false, motifVerify: false },      // before the curved-surface work
  round4: { skinNarrow: false, skinAlign: 0, widen: false, motifVerify: false, discRing: 0 },                           // disc layers + corner rounding, the old exposure rule
  round5: {},                                                                                                           // the defaults
  nomotif: { motifs: false },
};
const pick = process.env.VARIANTS ? process.env.VARIANTS.split(',') : ['round4', 'round5'];
const load = (f) => (f.startsWith('synth:') ? CURVED[f.slice(6)]() : (() => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })());
const colour = (p) => (p.snot ? [20, 240, 190] : (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255)));
if (process.env.OUT) fs.mkdirSync(process.env.OUT, { recursive: true });
for (const [f, studs] of list) {
  const model = load(f), name = f.replace(/^synth:|^models\/|\.glb$/g, '');
  for (const k of pick) {
    const t0 = Date.now(), r = generate(model, { ...FULL, studs, ...extra, ...ALL[k] }), m = r.metrics;
    const one = r.pieces.filter((p) => p.w === 1 && p.d === 1 && !p.snot).length, skin = r.pieces.filter((p) => ['slope', 'curved', 'cheese', 'inverted'].includes(p.kind)).length;
    const mc = r.post.motifCheck ? (r.post.motifCheck.kept ? ' motifs kept' : ' motifs dropped') : '';
    console.log(`${name.padEnd(13)} @${String(studs).padEnd(3)} ${k.padEnd(8)} ${String(m.pieces).padStart(5)}p IoU ${m.iou.toFixed(3)} recall ${m.recall.toFixed(3)} comps ${String(m.components).padStart(2)} stairs ${(100 * m.stairs).toFixed(0).padStart(3)}% under ${(100 * m.under).toFixed(0).padStart(3)}% 1x1 ${String(one).padStart(4)} skin ${String(skin).padStart(4)} ${((Date.now() - t0) / 1000).toFixed(1)}s${mc}`);
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/${name}_${k}.ldr`, toLDR(r.pieces.map((p) => ({ ...p, rgb: colour(p), code: undefined })), catalogFor(r.options), name));
  }
}
