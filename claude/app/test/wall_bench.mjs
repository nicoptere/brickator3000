// The sideways skin (motifs/wall.js, docs/CURVES.md round 10) on | off: pieces, IoU, recall, components, the surface metric,
// how many sideways pieces and hosts were placed, and the time. Real models and the synthetic curved shapes (sphere, egg,
// lying cylinder, rounded-edge box: all have near-vertical curved surfaces the upright skin cannot do).
// usage: node test/wall_bench.mjs [studs] [model.glb | synth:sphere | synth:egg | synth:cylinderX | synth:boxRoundEdge24 ...]
//   VARIANTS=off,on,on2 (on2 = every lattice offset); OPTS="wallHostFill=0.2 ..." adds options to every variant; OUT=dir writes LDRs
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { generate, catalogFor } from '../src/brickgen/pipeline.js';
import { toLDR, KIND_COL } from '../src/brickgen/export.js';
import { CURVED } from './synthetic.mjs';
const [n, ...files] = process.argv.slice(2);
const list = files.length ? files.map((f) => [f, +n || 24]) : [['synth:sphere', 16], ['synth:egg', 16], ['synth:cylinderX', 16], ['synth:boxRoundEdge24', 24], ['models/hen.glb', 16], ['models/delfin.glb', 32], ['models/pony.glb', 24], ['models/teapot.glb', 24]];
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = v.startsWith('{') || v.startsWith('[') ? JSON.parse(v) : isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const ALL = { off: { wall: false }, on: { wall: true }, on2: { wall: true, wallOffsets: [4, 3, 2, 1, 0] }, tiles: { wall: true, wallKinds: ['slope', 'curved', 'cheese', 'tile'] } };
const pick = process.env.VARIANTS ? process.env.VARIANTS.split(',') : ['off', 'on'];
const load = (f) => (f.startsWith('synth:') ? CURVED[f.slice(6)]() : (() => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })());
const colour = (p) => (p.snot ? [20, 240, 190] : p.host ? [240, 40, 200] : (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255)));
if (process.env.OUT) fs.mkdirSync(process.env.OUT, { recursive: true });
for (const [f, studs] of list) {
  const model = load(f), name = f.replace(/^synth:|^models\/|\.glb$/g, '');
  for (const k of pick) {
    const t0 = Date.now(), r = generate(model, { ...FULL, studs, ...extra, ...ALL[k] }), m = r.metrics;
    const side = r.pieces.filter((p) => p.snot).length, hosts = r.pieces.filter((p) => p.host).length, one = r.pieces.filter((p) => p.w === 1 && p.d === 1 && !p.snot).length;
    const w = r.post && r.post.wall ? ` (${r.post.wall.tried} tried, ${r.post.wall.unhosted} unhosted)` : '';
    console.log(`${name.padEnd(15)} @${String(studs).padEnd(3)} ${k.padEnd(5)} ${String(m.pieces).padStart(5)}p IoU ${m.iou.toFixed(3)} recall ${m.recall.toFixed(3)} comps ${String(m.components).padStart(2)} stairs ${(100 * m.stairs).toFixed(0).padStart(3)}% 1x1 ${String(one).padStart(4)} sideways ${String(side).padStart(4)} hosts ${String(hosts).padStart(4)}${w} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/${name}_${k}.ldr`, toLDR(r.pieces.map((p) => ({ ...p, rgb: colour(p), code: undefined })), catalogFor(r.options), name));
  }
}
