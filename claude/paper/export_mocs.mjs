// Scenes and numbers for the paper's sections on the sideways skin, the MOC corpus and the browser-engineering round
// (rounds 10-13: docs/CURVES.md §14, docs/MOCS.md §6-7, NEXT.md §21-24).
//   cd claude/app && node ../paper/export_mocs.mjs <work>/data          (~2 min: two full solves of the teapot + the library stats)
// Writes: wall_<model>_{on,off}.ldr  - the same model with and without the sideways skin, sideways pieces aqua, their side-stud
// hosts magenta, everything else grey; mocs.json - the piece / IoU pairs, the composition of the shipped motif library under the
// default settings, and the byte size of every data module the engine imports.
import fs from 'node:fs';
import path from 'node:path';
import { parseGLB } from '../app/src/brickgen/mesh.js';
import { generate, catalogFor } from '../app/src/brickgen/pipeline.js';
import { toLDR } from '../app/src/brickgen/export.js';
import { builtinMotifs } from '../app/src/motifs/library.js';
import MOTIF_TEXT from '../app/src/motifs/motifs.js';
import CATALOG from '../app/src/brickgen/catalog.js';
import EXT from '../app/src/brickgen/catalog_ext.js';
import SHAPES from '../app/src/brickgen/catalog_shapes.js';

const out = process.argv[2] || 'paper_data'; fs.mkdirSync(out, { recursive: true });
// the same option set as export_rounds.mjs, so every render in the paper is of the same engine configuration
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const stats = {};
const load = (f) => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
// aqua = a sideways (SNOT) piece, magenta = a side-stud host brick the wall phase placed for it, grey = everything else
const tint = (p) => (p.snot ? [27, 175, 122] : p.host ? [232, 123, 164] : [196, 194, 188]);

for (const [name, file, studs] of [['teapot', 'models/teapot.glb', 24]]) {
  for (const [tag, o] of [['off', { wall: false }], ['on', { wall: true }]]) {
    const t0 = Date.now(), r = generate(load(file), { ...FULL, studs, ...o }), cat = catalogFor(r.options);
    fs.writeFileSync(path.join(out, `wall_${name}_${tag}.ldr`),
      toLDR(r.pieces.map((p) => ({ ...p, rgb: tint(p), code: undefined })), cat, `${name}_${tag}`));
    stats[`wall_${name}_${tag}`] = { studs, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(4), comps: r.metrics.components,
      sideways: r.pieces.filter((p) => p.snot).length, hosts: r.pieces.filter((p) => p.host).length,
      wall: r.post && r.post.wall, check: r.post && r.post.wallCheck, ms: Date.now() - t0 };
    console.log(`wall_${name}_${tag}`.padEnd(18), `${stats[`wall_${name}_${tag}`].pieces}p  IoU ${stats[`wall_${name}_${tag}`].iou}  ` +
      `${stats[`wall_${name}_${tag}`].sideways} sideways / ${stats[`wall_${name}_${tag}`].hosts} hosts  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

// What the shipped library is made of, and what the DEFAULT settings of motifs/library.js do with it. The classes are that
// function's own tests, in its order, so the four add up to the whole file: a part the catalogue does not have, a sideways
// motif whose window clipped its host out, more parts than motifMaxParts, no shaped part in an upright motif (motifShapedOnly).
const by = new Map(); for (const L of [CATALOG, EXT, SHAPES]) for (const c of L) if (!by.has(c.id)) by.set(c.id, c);
for (const [a, b] of Object.entries({ '4287a': '4287', '3747a': '3747' })) if (!by.has(a) && by.has(b)) by.set(a, by.get(b));
const FLAT = new Set(['brick', 'plate', 'tile', 'technic']), HOST = /stud(s)? on .{0,20}side|headlight|^bracket/i;
const bytes = new Map();                                                  // key -> the bytes of its line in the module
for (const line of MOTIF_TEXT.split('\n')) { if (line.length < 3) continue;
  const t1 = line.lastIndexOf('\t'); bytes.set(line.slice(0, line.lastIndexOf('\t', t1 - 1)), line.length + 1); }
const cls = { unknownPart: [0, 0], snotNoHost: [0, 0], tooManyParts: [0, 0], flatOnly: [0, 0], kept: [0, 0] };
for (const m of builtinMotifs()) {
  const snot = m.parts.some((p) => (p.ori ?? 0) >= 4);
  const k = !m.parts.every((p) => by.has(p.id)) ? 'unknownPart'
    : snot && !m.parts.some((p) => (p.ori ?? 0) < 4 && HOST.test(by.get(p.id).name)) ? 'snotNoHost'
    : m.parts.length > 12 ? 'tooManyParts'
    : !snot && !m.parts.some((p) => !FLAT.has(by.get(p.id).kind)) ? 'flatOnly' : 'kept';
  cls[k][0]++; cls[k][1] += bytes.get(m.key) || 0;
}
stats.library = { motifs: builtinMotifs().length, bytes: MOTIF_TEXT.length,
  classes: Object.fromEntries(Object.entries(cls).map(([k, [n, b]]) => [k, { motifs: n, bytes: b }])) };
console.log('library', stats.library.motifs, 'motifs,', (stats.library.bytes / 1e6).toFixed(2), 'MB:',
  Object.entries(cls).map(([k, [n, b]]) => `${k} ${n} (${(100 * b / MOTIF_TEXT.length).toFixed(0)}%)`).join(', '));

// every data module a solver worker imports, as shipped
stats.modules = {};
for (const f of ['motifs/motifs.js', 'brickgen/catalog.js', 'brickgen/catalog_ext.js', 'brickgen/catalog_shapes.js', 'brickgen/catalog_tris.js']) {
  const p = path.join('src', f); if (fs.existsSync(p)) stats.modules[f] = fs.statSync(p).size;
}
fs.writeFileSync(path.join(out, 'mocs.json'), JSON.stringify(stats, null, 1));
console.log('->', path.join(out, 'mocs.json'));
