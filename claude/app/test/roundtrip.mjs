// pieces -> toLDR -> motifs/ldraw.js + placements.js -> pieces: must come back identical (checks the export frame and the loader frame)
// usage: LDRAW=<ldraw dir or complete.zip> node test/roundtrip.mjs pieces.json
import fs from 'node:fs';
import { FULL_CATALOG } from '../src/brickgen/pipeline.js';
import { toLDR } from '../src/brickgen/export.js';
import { Library, flattenModel } from '../src/motifs/ldraw.js';
import { toGrid, partFrames } from '../src/motifs/placements.js';
const raw = JSON.parse(fs.readFileSync(process.argv[2]));
// toGrid shifts the model to the origin; a solved model may start at i = 1 (the field's margin), so shift the input the same way
const m0 = [Math.floor(Math.min(...raw.map((p) => p.i))), Math.floor(Math.min(...raw.map((p) => p.j))), Math.floor(Math.min(...raw.map((p) => p.b)))];
const pieces = raw.map((p) => ({ ...p, i: p.i - m0[0], j: p.j - m0[1], b: p.b - m0[2] }));
const lib = new Library(process.env.LDRAW), frames = partFrames(FULL_CATALOG, lib);
const text = toLDR(pieces, FULL_CATALOG, 'roundtrip');
const g = toGrid(flattenModel(text, lib).placements, FULL_CATALOG, lib, frames, { snot: true });
// An upright part is identified by its canonical yaw; a sideways one by its orientation index, and its offsets are written as
// integers of a tenth of a stud / half a plate so the comparison does not trip on float noise (orient.js grid units).
const q = (v, u) => Math.round(v * u);
const key = (p) => (p.ori >= 4
  ? `${p.id}@o${p.ori} ${q(p.i, 10)},${q(p.j, 10)},${q(p.b, 2)} ${q(p.w, 10)}x${q(p.d, 10)}`
  : `${p.id}@${frames.get(p.id).canon[p.rot]} ${p.i},${p.j},${p.b} ${p.w}x${p.d}`);
const a = new Set(pieces.map(key)), b = new Set(g.pieces.map(key));
let miss = 0; for (const k of a) if (!b.has(k)) miss++;
console.log(`${pieces.length} pieces (${pieces.filter((p) => p.ori >= 4).length} sideways) -> ${g.pieces.length} back, ${miss} differ, stats`, { ...g.stats, parts: undefined });
if (miss) { const ex = pieces.filter((p) => !b.has(key(p))).slice(0, 5); console.log('e.g.', ex.map(key)); console.log('got', g.pieces.filter((p) => !a.has(key(p))).slice(0, 5).map(key)); }
