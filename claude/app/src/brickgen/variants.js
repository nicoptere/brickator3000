// Part volumes (levels x nz x nx samples) for the 4 yaw rotations, from the catalog's measured height profiles.
import { STUD, PLATE, G, SAMP } from './constants.js';

/** yaw a part volume (levels x nz x nx) by rot degrees; also exported for the motif tools (motifs/placements.js) */
export function rotate(vol, h, c, rot) {
  const w = c.w, d = c.d, nz = d * G, nx = w * G;
  const th = rot * Math.PI / 180, co = Math.round(Math.cos(th)), si = Math.round(Math.sin(th));
  const [w2, d2] = rot === 90 || rot === 270 ? [d, w] : [w, d];
  const nx2 = w2 * G, nz2 = d2 * G, out = new Float32Array(h * nz2 * nx2);
  const mp = (u, v) => [co * u + si * v, -si * u + co * v];
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const u = (x + 0.5) * SAMP - w * STUD / 2, v = (z + 0.5) * SAMP - d * STUD / 2;
    const [u2, v2] = mp(u, v);
    const ix = Math.floor((u2 + w2 * STUD / 2) / SAMP), iz = Math.floor((v2 + d2 * STUD / 2) / SAMP);
    for (let l = 0; l < h; l++) out[(l * nz2 + iz) * nx2 + ix] = vol[(l * nz + z) * nx + x];
  }
  const studs = c.stud_cells.map(([i, j]) => {
    const [u2, v2] = mp((i + 0.5) * STUD - w * STUD / 2, (j + 0.5) * STUD - d * STUD / 2);
    return [Math.floor((u2 + w2 * STUD / 2) / STUD), Math.floor((v2 + d2 * STUD / 2) / STUD)];
  });
  return { V: out, studs, w: w2, d: d2 };
}

/** unrotated volume of a catalogue part: { vol (h x nz x nx samples), h (plates) } */
export function baseVolume(c) {
  const nz = c.d * G, nx = c.w * G;
  let h, vol;
  if (c.cover) {
    h = c.cover.length; vol = new Float32Array(h * nz * nx);
    for (let l = 0; l < h; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) vol[(l * nz + z) * nx + x] = c.cover[l][z][x];
  } else {
    let tmax = 1e-3; for (const row of c.top) for (const t of row) tmax = Math.max(tmax, t);
    h = Math.ceil(tmax / PLATE - 1e-6); vol = new Float32Array(h * nz * nx);
    for (let l = 0; l < h; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const top = c.top[z][x], bot = c.kind === 'inverted' ? c.bot[z][x] : 0;
      vol[(l * nz + z) * nx + x] = Math.min(1, Math.max(0, (Math.min(top, (l + 1) * PLATE) - Math.max(bot, l * PLATE)) / PLATE));
    }
  }
  return { vol, h };
}

const cache = new Map();
/** all distinct rotated variants of the parts whose kind is in `kinds` */
export function partVariants(cat, kinds) {
  const key = [...kinds].sort().join(',') + '|' + cat.length;
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (const c of cat) {
    if (!kinds.has(c.kind)) continue;
    const { vol, h } = baseVolume(c);
    const seen = new Set();
    for (const rot of [0, 90, 180, 270]) {
      const r = rotate(vol, h, c, rot);
      const sig = `${r.w},${r.d},${Array.from(r.V).map((v) => v.toFixed(4)).join(',')}|${r.studs.map((s) => s.join(':')).sort().join(';')}`;
      if (seen.has(sig)) continue; seen.add(sig);
      let sum = 0, full = true; const lev = new Float64Array(h), per = r.V.length / h;
      for (let q = 0; q < r.V.length; q++) { const x = r.V[q]; sum += x; lev[(q / per) | 0] += x; if (x !== 1) full = false; }
      if (sum / (G * G) < 0.3) continue;
      out.push({ c, rot, V: r.V, studs: r.studs, w: r.w, d: r.d, h, vtot: sum / (G * G), vsum: sum, full, lev });   // lev: per-level sums; full: the volume is a solid box of ones (brick / plate / tile)
    }
  }
  cache.set(key, out);
  return out;
}
