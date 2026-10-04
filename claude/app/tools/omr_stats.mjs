// Coverage of the OMR models by the engine's catalogue: how many placements become grid pieces, what is lost and why.
// usage: node tools/omr_stats.mjs [omrDir] [ldrawDir] [limit]
import fs from 'node:fs';
import path from 'node:path';
import CATALOG from '../src/brickgen/catalog.js';
import EXT from '../src/brickgen/catalog_ext.js';
import { Library, flattenModel } from '../src/motifs/ldraw.js';
import { toGrid, partFrames } from '../src/motifs/placements.js';

const omr = process.argv[2] || path.resolve('../../docs/omr_gallery'), ldr = process.argv[3] || process.env.LDRAW || path.resolve('../generator/ldraw');
const limit = +(process.argv[4] || 1e9);
const cat = [...CATALOG, ...EXT], lib = new Library(ldr), frames = partFrames(cat, lib);
const tot = { files: 0, placed: 0, aliased: 0, half: 0, tilted: 0, offgrid: 0, uncovered: 0, dropped: 0, nobbox: 0, unresolved: 0 }, parts = new Map(), perModel = [];
const t0 = Date.now();
for (const f of fs.readdirSync(omr).filter((x) => /\.(mpd|ldr)$/i.test(x)).sort().slice(0, limit)) {
  const { placements, unresolved } = flattenModel(fs.readFileSync(path.join(omr, f), 'latin1'), lib);
  const g = toGrid(placements, cat, lib, frames);
  for (const k of ['placed', 'aliased', 'half', 'tilted', 'offgrid', 'uncovered', 'dropped', 'nobbox']) tot[k] += g.stats[k];
  for (const n of unresolved.values()) tot.unresolved += n;
  for (const [k, v] of g.stats.parts) parts.set(k, (parts.get(k) || 0) + v);
  tot.files++;
  perModel.push({ f, n: placements.length, placed: g.stats.placed, dims: g.dims });
}
const all = tot.placed + tot.tilted + tot.offgrid + tot.uncovered;
console.log(`${tot.files} models, ${(Date.now() - t0) / 1000 | 0} s`);
console.log(`placements (excl. figures ${tot.dropped}, unresolved ${tot.unresolved}): ${all}`);
for (const k of ['placed', 'aliased', 'half', 'tilted', 'offgrid', 'uncovered', 'nobbox']) console.log(`  ${k.padEnd(10)} ${tot[k]} (${(100 * tot[k] / all).toFixed(1)}%)`);
const top = [...parts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
console.log('most frequent parts outside the catalogue:');
for (const [id, n] of top) { const f = lib.file(id + '.dat'); console.log(`  ${id.padEnd(10)} ${String(n).padStart(6)}  ${f && f.desc ? f.desc : '?'}`); }
if (process.env.PER_MODEL) for (const m of perModel.sort((a, b) => b.placed - a.placed).slice(0, 15)) console.log(m);
