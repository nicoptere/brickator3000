// Mine building motifs from LDraw models (the OMR gallery) -> data/motifs.json
// usage: node tools/mine_motifs.mjs [--omr dir[,dir2,...]] [--ldraw dir] [--limit n] [--min 3] [--models 1] [--out data/motifs.json] [--fill 0.4]
// reads .mpd / .ldr and BrickLink Studio .io files from every directory given; writes motifs.json and the motifs.js module next to it
import fs from 'node:fs';
import path from 'node:path';
import { FULL_CATALOG } from '../src/brickgen/pipeline.js';
import { Library, flattenModel } from '../src/motifs/ldraw.js';
import { toGrid, partFrames } from '../src/motifs/placements.js';
import { mineModel } from '../src/motifs/mine.js';
import { modelText } from '../src/motifs/zip.js';
import { packMotifs } from './pack_motifs.mjs';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const omr = arg('omr', path.resolve('../../docs/omr_gallery')), ldr = arg('ldraw', process.env.LDRAW || path.resolve('../generator/ldraw'));
const limit = +arg('limit', 1e9), minN = +arg('min', 3), minModels = +arg('models', 1), out = arg('out', 'src/motifs/motifs.json'), minFill = +arg('fill', 0.4);
const cat = FULL_CATALOG, lib = new Library(ldr), frames = partFrames(cat, lib);
const acc = new Map(); let models = 0, pieces = 0, windows = 0; const t0 = Date.now();
const files = omr.split(',').flatMap((dir) => fs.readdirSync(dir).filter((x) => /\.(mpd|ldr|io)$/i.test(x)).sort().map((x) => path.join(dir, x))).slice(0, limit);
for (const fp of files) {
  const f = path.basename(fp), t = Date.now();
  let text; try { text = modelText(f, fs.readFileSync(fp)); } catch (e) { console.warn('skip', f, e.message); continue; }
  const { placements } = flattenModel(text, lib);
  const g = toGrid(placements, cat, lib, frames, { snot: process.argv.includes('--snot') });
  if (g.pieces.length < 2) continue;
  windows += mineModel(g, cat, acc, f, { frames, minFill });
  models++; pieces += g.pieces.length;
  if (process.env.VERBOSE) console.log(f, g.pieces.length, 'pieces', g.dims.join('x'), (Date.now() - t) + ' ms', acc.size, 'keys');
}
const list = [...acc.entries()].filter(([, r]) => r.n >= minN && r.models.size >= minModels)
  .map(([key, r]) => ({ key, w: r.w, d: r.d, h: r.h, n: r.n, models: r.models.size, parts: r.parts, ...(r.snot ? { snot: true } : {}) }))
  .sort((a, b) => b.n - a.n);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: omr, snot: process.argv.includes('--snot'), models, pieces, windows, keys: acc.size, minN, minModels, minFill, motifs: list }));
const packed = packMotifs(list, { note: `${omr} (${models} models)` });      // the engine reads the packed text module, not the JSON
fs.writeFileSync(path.join(path.dirname(out), 'motifs.js'), packed.text);
console.log(`${models} models, ${pieces} pieces, ${windows} windows, ${acc.size} distinct groups, ${list.length} motifs kept (n >= ${minN}, models >= ${minModels}), ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
