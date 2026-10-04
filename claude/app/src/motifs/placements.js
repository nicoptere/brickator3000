// LDraw placements (from ldraw.js) -> engine grid pieces { id, rot, b, i, j, w, d, h } on the stud / plate lattice.
// Exact inverse of export.js toLDR: engine frame = D * LDraw frame with D = diag(1,-1,-1); a catalogue part's own frame is
// x_cat = x_ld, z_cat = -z_ld, y_cat = maxy - y_ld (height above its bottom face); the engine places rotY(rot) * (p_cat - footprint centre)
// at ((i + w/2) * STUD, b * PLATE, (j + d/2) * STUD).
// Anything the engine cannot express (part not in the catalogue, tilted / sideways / mirrored, off-grid) becomes an "unknown" cell box,
// so that motif mining can refuse windows that touch it. Minifigs, figures and stickers are dropped altogether (they are not shape).
import { STUD, PLATE, G } from '../brickgen/constants.js';
import { rotate, baseVolume } from '../brickgen/variants.js';
import { apply } from './ldraw.js';

const ROTS = [0, 90, 180, 270];
const rotY = (deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const DMD = (M) => { const D = [1, -1, -1], o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = D[r] * M[r * 3 + c] * D[c]; return o; };
const Dv = (v) => [v[0], -v[1], -v[2]];
const near = (x, tol = 0.02) => Math.abs(x - Math.round(x)) < tol;

export const DROP = /^(Minifig|Figure|Friends Figure|Duplo Figure|Belville|Fabuland Figure|Technic Figure|Sticker|~Minifig)/i;

/** rounded stud / plate extents of a library part: [x studs, z studs, plates] (side studs and top studs do not count) */
function extents(lib, name) {
  const b = lib && lib.bbox(name); if (!b) return null;
  return [Math.floor((b[1][0] - b[0][0]) / STUD + 0.3), Math.floor((b[1][2] - b[0][2]) / STUD + 0.3), Math.round((b[1][1] - b[0][1] - 4) / PLATE)];
}

/**
 * catalogue id for an LDraw part name, and whether its real footprint is a quarter turn from the catalogue's (w, d):
 * exact id, else its mould-variant family (3023b -> 3023), else a "bulk equivalent" read from the part description: a brick / plate / tile
 * / round of the same size whose extras (clips, grille, side studs, handles, grooves) do not change the body. Verified against the
 * part's own bounding box, so a part that is taller or wider than its name says is refused.
 */
const BULK = /^(Technic Brick|Brick|Plate|Tile) (\d+) x (\d+)(?: x 1)?(?= with | without | Log| Grille|$)(?!.*(Corner|Wedge|Slope|Curved|Inverted|Arch|Angle|Rounded|Hinge|Turntable|Half|Cutout|Clip$))/;
const ROUND = /^(Brick|Plate|Tile) (\d+) x (\d+) Round(?= with | Reinforced|$)(?!.*(Corner|Half|Quarter))/;
export function resolveId(id, frames, lib) {
  const r = frames.resolved; if (r && r.has(id)) return r.get(id);
  let out = null;
  if (frames.has(id)) out = { id, turn: frames.get(id).turn };
  else {
    const base = id.replace(/[a-z]+$/, ''), fam = [base, base + 'a', base + 'b', base + 'c'].find((k) => frames.has(k));
    if (fam) out = { id: fam, turn: frames.get(fam).turn };
    else if (lib) {
      const f = lib.file(id + '.dat'), desc = f && f.desc || '', ex = extents(lib, id + '.dat');
      let m, kind, a, b;
      if ((m = ROUND.exec(desc))) { kind = 'round'; a = +m[2]; b = +m[3]; }
      else if ((m = BULK.exec(desc))) { kind = { 'Technic Brick': 'technic', Brick: 'brick', Plate: 'plate', Tile: 'tile' }[m[1]]; a = +m[2]; b = +m[3]; }
      else if ((m = /^Cone (\d+) x (\d+)(?= with |$)/.exec(desc))) { kind = 'round'; a = +m[1]; b = +m[2]; m = ['', 'Cone']; }
      if (kind && ex) {
        const h = m[1] === 'Plate' || m[1] === 'Tile' ? 1 : 3;                      // round plates / tiles are one plate tall
        const cands = [...frames.values()].filter((fr) => (fr.c.kind === kind || (kind === 'technic' && fr.c.kind === 'brick')) && ((fr.c.w === a && fr.c.d === b) || (fr.c.w === b && fr.c.d === a)) && Math.round(fr.h) === h && /Cone/.test(fr.c.name) === (m[1] === 'Cone'));
        const fr = cands[0];
        if (fr && ex[2] === h && ((ex[0] === fr.c.w && ex[1] === fr.c.d) || (ex[0] === fr.c.d && ex[1] === fr.c.w)))
          out = { id: fr.c.id, turn: fr.c.w !== fr.c.d && ex[0] === fr.c.d, alias: true };
      }
    }
  }
  if (r) r.set(id, out);
  return out;
}

/** per-part rotation table: canonical rot per yaw (variants that are identical after rotation share the smallest rot), rotated footprints,
 * and `turn`: true when the real LDraw part is a quarter turn from the catalogue's (w, d) (the analytic bricks / plates / tiles are) */
export function partFrames(cat, lib = null) {
  const out = new Map(); out.resolved = new Map();
  for (const c of cat) {
    const { vol, h } = baseVolume(c);
    const sigs = new Map(), canon = {}, foot = {};
    for (const r of ROTS) {
      const v = rotate(vol, h, c, r);
      const sig = `${v.w},${v.d},${Array.from(v.V).map((x) => x.toFixed(4)).join(',')}|${v.studs.map((s) => s.join(':')).sort().join(';')}`;
      if (!sigs.has(sig)) sigs.set(sig, r);
      canon[r] = sigs.get(sig); foot[r] = [v.w, v.d];
    }
    let turn = c.source === 'analytic' && c.w !== c.d;                            // the only rule the export needs; checked below when a library is at hand
    const ex = c.w !== c.d ? extents(lib, c.id + '.dat') : null;
    if (ex) turn = ex[0] === c.d && ex[1] === c.w;
    out.set(c.id, { c, h, canon, foot, turn, maxy: c.maxy ?? c.h * PLATE, cx: c.minx + c.w * 10, cz: c.minz + c.d * 10 });
  }
  return out;
}

/**
 * placements -> { pieces, unknown, dims, stats }. pieces: engine records (rot canonicalised); unknown: cell boxes [i0,i1,j0,j1,b0,b1]
 * (half-open) of everything else. Coordinates are shifted so the model starts at 0 on every axis.
 */
export function toGrid(placements, cat, lib, frames = partFrames(cat, lib)) {
  const pieces = [], unknown = [], stats = { placed: 0, aliased: 0, half: 0, tilted: 0, offgrid: 0, uncovered: 0, dropped: 0, nobbox: 0, parts: new Map() };
  const count = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const unknownBox = (p) => {
    const b = lib && lib.bbox(p.part + '.dat'); if (!b) { stats.nobbox++; return; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) {
      const q = Dv(apply(p.M, p.t, [x, y, z]));
      for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; }
    }
    // float cell extents [i0, i1, j0, j1, b0, b1]; studs poke 4 LDU above the top and are not shape
    unknown.push([lo[0] / STUD, hi[0] / STUD, lo[2] / STUD, hi[2] / STUD, lo[1] / PLATE, Math.max(lo[1] + 1, hi[1] - 4) / PLATE]);
  };
  for (const p of placements) {
    const f = lib && lib.file(p.part + '.dat');
    if (f && f.desc && DROP.test(f.desc)) { stats.dropped++; continue; }
    const res = resolveId(p.part, frames, lib), fr = res && frames.get(res.id);
    if (!fr) { stats.uncovered++; count(stats.parts, p.part); unknownBox(p); continue; }
    if (res.alias) stats.aliased++;
    const Re = DMD(p.M);
    let rot = -1;
    for (const r of ROTS) { const R = rotY(r); let ok = true; for (let k = 0; k < 9; k++) if (Math.abs(Re[k] - R[k]) > 1e-3) { ok = false; break; } if (ok) { rot = r; break; } }
    if (rot < 0) { stats.tilted++; unknownBox(p); continue; }
    // analytic catalogue entries (bricks / plates / tiles) list their footprint as (z, x) of the real LDraw part: a quarter turn apart
    if (res.turn) rot = (rot + 90) % 360;
    const v = [fr.cx, -fr.maxy, fr.cz], R = rotY(rot), tt = Dv(p.t);
    const o = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + tt[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + tt[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + tt[2]];
    const [w, d] = fr.foot[rot];
    const i = o[0] / STUD - w / 2, j = o[2] / STUD - d / 2, b = o[1] / PLATE;
    // half-stud offsets (jumper plates, offset sub-assemblies) are kept as .5 coordinates: the miner splits the model by parity
    if (!near(2 * i) || !near(2 * j) || !near(b)) { stats.offgrid++; unknownBox(p); continue; }
    if (!near(i) || !near(j)) stats.half++;
    pieces.push({ id: fr.c.id, rot: fr.canon[rot], i: Math.round(2 * i) / 2, j: Math.round(2 * j) / 2, b: Math.round(b), w, d, h: fr.h, color: p.color });
    stats.placed++;
  }
  // shift to the origin (whole studs / plates, so parities are preserved)
  let i0 = Infinity, j0 = Infinity, b0 = Infinity, i1 = -Infinity, j1 = -Infinity, b1 = -Infinity;
  for (const p of pieces) { i0 = Math.min(i0, p.i); j0 = Math.min(j0, p.j); b0 = Math.min(b0, p.b); i1 = Math.max(i1, p.i + p.w); j1 = Math.max(j1, p.j + p.d); b1 = Math.max(b1, p.b + p.h); }
  for (const u of unknown) { i0 = Math.min(i0, u[0]); j0 = Math.min(j0, u[2]); b0 = Math.min(b0, u[4]); i1 = Math.max(i1, u[1]); j1 = Math.max(j1, u[3]); b1 = Math.max(b1, u[5]); }
  if (!pieces.length && !unknown.length) return { pieces, unknown, dims: [0, 0, 0], stats };
  i0 = Math.floor(i0); j0 = Math.floor(j0); b0 = Math.floor(b0);
  for (const p of pieces) { p.i -= i0; p.j -= j0; p.b -= b0; }
  for (const u of unknown) { u[0] -= i0; u[1] -= i0; u[2] -= j0; u[3] -= j0; u[4] -= b0; u[5] -= b0; }
  return { pieces, unknown, dims: [Math.ceil(i1) - i0, Math.ceil(j1) - j0, Math.ceil(b1) - b0], stats };
}

/** sampled volume (G x G per stud) of an engine piece record, from the catalogue: reused by the miner to rasterise motifs */
const volCache = new Map();
export function pieceVolume(p, cat) {
  const k = `${p.id}|${p.rot}`;
  if (!volCache.has(k)) { const c = cat.find((x) => x.id === p.id); const { vol, h } = baseVolume(c); volCache.set(k, rotate(vol, h, c, p.rot)); }
  return volCache.get(k);
}
export { G };
