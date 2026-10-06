// The part catalogues ship as TEXT, not as object literals.
//
// `catalog_ext.js` was 2.8 MB of nested arrays: 129 ms to parse and **28 MB of heap in every worker**, for 1 MB of actual
// numbers. The height fields are mostly constant (a plain brick is 24 LDU everywhere, 0 underneath), so each part is one line:
//
//   <small fields as JSON>\t<top RLE>\t<bot RLE>\t<cover levels>\t<cover RLE>
//
// where an RLE is `v` or `v*n` of the value in hundredths of an LDU (cover: thousandths of a unit), read row by row (z-major).
// The three catalogues together go from 3.9 MB / 190 ms / ~40 MB to 0.2 MB / 8 ms / 0.3 MB, and `top` / `bot` / `cover` come
// back as FLAT Float32Arrays - `c.top[z * c.w * G + x]`, `c.cover[(l * nz + z) * nx + x]` - which is also how every consumer
// wants them (variants.baseVolume, orient.fineVolume, export.studLocal, post.tallBricks).
// The triangle geometry (`tris`, 0.7 MB, drawing only) lives in `catalog_tris.js`, which only `export.js` imports, so a worker
// never loads it at all. Regenerate with `node tools/pack_catalog.mjs`.
import { G } from './constants.js';

/** run-length text -> flat Float32Array of `n` values, scaled back by `div` */
export function rleDecode(s, n, div = 100) {
  const out = new Float32Array(n);
  if (!s) return out;
  let k = 0;
  for (let i = 0, j = 0; i <= s.length; i++) {
    if (i < s.length && s.charCodeAt(i) !== 44) continue;          // ','
    const tok = s.slice(j, i); j = i + 1;
    const st = tok.indexOf('*');
    if (st < 0) out[k++] = +tok / div;
    else { const v = +tok.slice(0, st) / div, r = +tok.slice(st + 1); for (let q = 0; q < r; q++) out[k++] = v; }
  }
  return out;
}

/** packed catalogue text -> the part records the engine uses */
export function unpackCatalog(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (line.length < 3) continue;
    const t = line.split('\t'), c = JSON.parse(t[0]);
    const nx = c.w * G, nz = c.d * G;
    if (t[1]) c.top = rleDecode(t[1], nz * nx);
    if (t[2]) c.bot = rleDecode(t[2], nz * nx);
    if (t[3]) { c.coverH = +t[3]; c.cover = rleDecode(t[4], c.coverH * nz * nx, 1000); }
    out.push(c);
  }
  return out;
}
