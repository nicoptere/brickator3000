// pieces -> toLDR -> motifs/ldraw.js + placements.js -> pieces: must come back identical (checks the export frame and the loader frame)
// usage: LDRAW=<ldraw dir or complete.zip> node test/roundtrip.mjs pieces.json
import fs from 'node:fs';
import { FULL_CATALOG } from '../src/brickgen/pipeline.js';
import { toLDR } from '../src/brickgen/export.js';
import { Library, flattenModel } from '../src/motifs/ldraw.js';
import { toGrid, partFrames } from '../src/motifs/placements.js';
const pieces = JSON.parse(fs.readFileSync(process.argv[2]));
const lib = new Library(process.env.LDRAW), frames = partFrames(FULL_CATALOG, lib);
const text = toLDR(pieces, FULL_CATALOG, 'roundtrip');
const g = toGrid(flattenModel(text, lib).placements, FULL_CATALOG, lib, frames);
const key = (p) => `${p.id}@${frames.get(p.id).canon[p.rot]} ${p.i},${p.j},${p.b} ${p.w}x${p.d}`;
const a = new Set(pieces.map(key)), b = new Set(g.pieces.map(key));
let miss = 0; for (const k of a) if (!b.has(k)) miss++;
console.log(`${pieces.length} pieces -> ${g.pieces.length} back, ${miss} differ, stats`, { ...g.stats, parts: undefined });
if (miss) { const ex = pieces.filter((p) => !b.has(key(p))).slice(0, 5); console.log('e.g.', ex.map(key)); console.log('got', g.pieces.filter((p) => !a.has(key(p))).slice(0, 5).map(key)); }
