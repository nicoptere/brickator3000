// Every one of the 24 axis-aligned orientations, for a sample of parts: place it on the grid, write LDraw, read it back with the
// loader and check the part, its orientation and its position come back unchanged. This is what ties motifs/orient.js (rasteriser),
// placements.js (loader) and export.js (writer) together; a 180 deg error is invisible on a rectangular brick but not here.
// usage: LDRAW=<ldraw dir or complete.zip> node test/roundtrip_snot.mjs [ids...]
import { FULL_CATALOG } from '../src/brickgen/pipeline.js';
import { toLDR } from '../src/brickgen/export.js';
import { Library, flattenModel } from '../src/motifs/ldraw.js';
import { toGrid, partFrames } from '../src/motifs/placements.js';
import { ORIENTATIONS, orientPart } from '../src/motifs/orient.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['3005', '3004', '3023', '3069b', '54200', '3040', '4070', '6141', '3062b', '87087', '3010', '3070b'];
const lib = new Library(process.env.LDRAW), frames = partFrames(FULL_CATALOG, lib);
const by = new Map(FULL_CATALOG.map((c) => [c.id, c]));
let ok = 0, bad = 0, skipped = 0;
for (const id of ids) {
  const c = by.get(id); if (!c) { console.log('no such part', id); continue; }
  for (let ori = 0; ori < ORIENTATIONS.length; ori++) {
    const ob = orientPart(c, ori);
    // put it somewhere unsymmetric so a sign error shows, on the 4 LDU / half plate grid a sideways part may use
    const p = { id, ori, rot: ori < 4 ? ori * 90 : 0, i: 3, j: 5, b: 2, w: ob.w, d: ob.d, h: ori < 4 ? ob.nl : ob.h, snot: ori >= 4, studs: [], rgb: [128, 128, 128] };
    const g = toGrid(flattenModel(toLDR([p], FULL_CATALOG, 'snot'), lib).placements, FULL_CATALOG, lib, frames, { snot: true });
    const q = g.pieces[0];
    if (!q) { console.log(`${id} ori ${ori}: lost (${JSON.stringify({ ...g.stats, parts: undefined })})`); bad++; continue; }
    // toGrid shifts the model to the origin, so only the orientation and the shape are checked here
    const qori = q.ori !== undefined ? q.ori : Math.round(q.rot / 90);
    const same = q.id === id && Math.abs(q.w - p.w) < 1e-6 && Math.abs(q.d - p.d) < 1e-6;
    const sameOri = qori === ori || ORIENTATIONS[qori].every((x, k) => Math.abs(x - ORIENTATIONS[ori][k]) < 1e-9);
    // a part can be symmetric under the difference of the two orientations: accept when the oriented volumes are identical
    let sameVol = true; const a = orientPart(c, qori);
    if (a.V.length !== ob.V.length) sameVol = false; else for (let k = 0; k < a.V.length; k++) if (Math.abs(a.V[k] - ob.V[k]) > 1e-3) { sameVol = false; break; }
    if (same && (sameOri || sameVol)) ok++;
    else { bad++; if (bad <= 10) console.log(`${id} ori ${ori} -> ${qori}  ${p.w}x${p.d}x${p.h} -> ${q.w}x${q.d}x${q.h}${sameVol ? '' : '  (different shape)'}`); }
  }
}
console.log(`${ok} orientations round-tripped, ${bad} wrong${skipped ? `, ${skipped} skipped` : ''}`);
