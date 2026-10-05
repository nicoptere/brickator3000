// LDraw placements (from ldraw.js) -> engine grid pieces { id, rot, b, i, j, w, d, h } on the stud / plate lattice.
// Exact inverse of export.js toLDR: engine frame = D * LDraw frame with D = diag(1,-1,-1); a catalogue part's own frame is
// x_cat = x_ld, z_cat = -z_ld, y_cat = maxy - y_ld (height above its bottom face); the engine places rotY(rot) * (p_cat - footprint centre)
// at ((i + w/2) * STUD, b * PLATE, (j + d/2) * STUD).
// Anything the engine cannot express (part not in the catalogue, tilted / sideways / mirrored, off-grid) becomes an "unknown" cell box,
// so that motif mining can refuse windows that touch it. Minifigs, figures and stickers are dropped altogether (they are not shape).
import { STUD, PLATE, G } from '../brickgen/constants.js';
import { rotate, baseVolume } from '../brickgen/variants.js';
import { apply } from './ldraw.js';
import { ORIENTATIONS, orientPart } from './orient.js';

const ROTS = [0, 90, 180, 270];
const rotY = (deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const mm = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const TURN = rotY(90);
const oriKey = (M) => M.map((x) => Math.round(x)).join(',');
const ORI_INDEX = new Map(ORIENTATIONS.map((M, k) => [oriKey(M), k]));
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
const BULK = /^~?(Technic Brick|Brick|Plate|Tile) (\d+) x (\d+)(?: x (\d+))?(?= with | without | Log| Grille| \(Obsolete|$)(?!.*(Corner|Wedge|Slope|Curved|Inverted|Arch|Angle|Rounded|Hinge|Turntable|Half|Cutout|Clip$))/;
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
        // round plates / tiles are one plate tall; a "Brick 1 x 2 x 5" is 5 bricks tall (46212 -> 2454, 22886 ...)
        const h = m[1] === 'Plate' || m[1] === 'Tile' ? 1 : 3 * (m[1] === 'Cone' || !m[4] ? 1 : +m[4]);
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
export function toGrid(placements, cat, lib, frames = partFrames(cat, lib), { snot = false, register = true } = {}) {
  // Studio exports often carry a global offset (the model was built off the origin, or on a baseplate 4 LDU up): every part is
  // then "off grid" by the same residue. Register first: the modal residue of the upright parts, per axis, is subtracted.
  if (register) {
    // a model built on its side (a standing mosaic, a Studio file whose camera "up" became the model's up) is turned whole so that
    // the parts' modal up-vector is LDraw's -y: otherwise every part reads as sideways
    const Rg = modelUpright(placements, frames, lib);
    if (Rg) {
      const t = placements.map((p) => ({ ...p, M: mm(Rg, p.M), t: [Rg[0] * p.t[0] + Rg[1] * p.t[1] + Rg[2] * p.t[2], Rg[3] * p.t[0] + Rg[4] * p.t[1] + Rg[5] * p.t[2], Rg[6] * p.t[0] + Rg[7] * p.t[1] + Rg[8] * p.t[2]] }));
      const g = toGrid(t, cat, lib, frames, { snot, register: true }); g.stats.turned = Rg; return g;
    }
    const off = gridOffset(placements, frames, lib);
    if (off) { const t = placements.map((p) => ({ ...p, t: [p.t[0] - off[0], p.t[1] - off[1], p.t[2] - off[2]] })); const g = toGrid(t, cat, lib, frames, { snot, register: false }); g.stats.offset = off; return g; }
  }
  const pieces = [], unknown = [], stats = { placed: 0, aliased: 0, half: 0, sideways: 0, sidewaysOff: 0, snot: 0, tilted: 0, offgrid: 0, uncovered: 0, dropped: 0, nobbox: 0, parts: new Map() };
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
    // the part's own frame is a quarter turn from LDraw's for the analytic entries (their footprint is listed as (z, x))
    const Re = res.turn ? mm(DMD(p.M), TURN) : DMD(p.M);
    const ori = ORI_INDEX.get(oriKey(Re));
    if (ori === undefined || !ORIENTATIONS[ori].every((x, k) => Math.abs(Re[k] - x) < 1e-3)) { stats.tilted++; unknownBox(p); continue; }
    const tt = Dv(p.t);
    if (ori < 4) {                                            // upright: the footprint is whole studs, the level a whole plate
      const rot = ori * 90, v = [fr.cx, -fr.maxy, fr.cz], R = ORIENTATIONS[ori];
      const o = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + tt[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + tt[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + tt[2]];
      const [w, d] = fr.foot[rot];
      const i = o[0] / STUD - w / 2, j = o[2] / STUD - d / 2, b = o[1] / PLATE;
      // half-stud offsets (jumper plates, offset sub-assemblies) are kept as .5 coordinates: the miner splits the model by parity
      if (!near(2 * i) || !near(2 * j) || !near(b)) { stats.offgrid++; unknownBox(p); continue; }
      if (!near(i) || !near(j)) stats.half++;
      pieces.push({ id: fr.c.id, ori: fr.canon[rot] / 90, rot: fr.canon[rot], i: Math.round(2 * i) / 2, j: Math.round(2 * j) / 2, b: Math.round(b), w, d, h: fr.h, color: p.color });
      stats.placed++;
    } else {                                                  // SNOT: the box corner must sit on the 4-LDU sample grid and on a plate
      if (!snot) { stats.sideways++; unknownBox(p); continue; }
      const ob = orientPart(fr.c, ori);
      const lo = [tt[0] - ob.w * STUD / 2 - ob.origin[0], tt[1] - ob.h * PLATE / 2 - ob.origin[1], tt[2] - ob.d * STUD / 2 - ob.origin[2]];
      const i = lo[0] / STUD, j = lo[2] / STUD, b = lo[1] / PLATE;
      // x / z on the 4 LDU sample grid, y on a half plate (the volume field is per plate, but a motif is rasterised in 4 LDU
      // slices before it is collapsed, so a sideways part may start half a level up - 44% of the sideways parts in the OMR do)
      if (!near(i * G) || !near(j * G) || !near(2 * b)) { stats.sidewaysOff++; unknownBox(p); continue; }
      pieces.push({ id: fr.c.id, ori, rot: 0, i: Math.round(i * G) / G, j: Math.round(j * G) / G, b: Math.round(2 * b) / 2, w: ob.w, d: ob.d, h: ob.h, color: p.color, snot: true });
      stats.sideways++; stats.snot++;
    }
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

/** 90-degree rotations (LDraw frame, row-major) taking each axis direction to -y, LDraw's up */
const TO_UP = {
  '0,1,0': [1, 0, 0, 0, -1, 0, 0, 0, -1],       // upside down: half turn about x
  '1,0,0': [0, 1, 0, -1, 0, 0, 0, 0, 1],        // Rz(-90)
  '-1,0,0': [0, -1, 0, 1, 0, 0, 0, 0, 1],       // Rz(90)
  '0,0,1': [1, 0, 0, 0, 0, -1, 0, 1, 0],        // Rx(90)
  '0,0,-1': [1, 0, 0, 0, 0, 1, 0, -1, 0],       // Rx(-90)
};
/**
 * the whole-model rotation that makes the parts' modal up-vector LDraw's up (-y), or null when it already is. Only catalogue parts
 * with an axis-aligned frame vote; a model needs a clear majority (> 50 % of the votes) on another axis to be turned.
 */
export function modelUpright(placements, frames, lib) {
  const votes = new Map(); let n = 0;
  for (const p of placements) {
    const res = resolveId(p.part, frames, lib); if (!res || !frames.get(res.id)) continue;
    const M = p.M; if (!M.every((x) => Math.abs(x - Math.round(x)) < 1e-3)) continue;
    const up = [-Math.round(M[1]), -Math.round(M[4]), -Math.round(M[7])].join(',');
    votes.set(up, (votes.get(up) || 0) + 1); n++;
  }
  if (n < 8) return null;
  const [best, cnt] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === '0,-1,0' || cnt <= n / 2) return null;
  return TO_UP[best] || null;
}

/**
 * global translation (LDraw LDU) that puts the most upright catalogue parts on the half-stud / plate grid, or null when the model
 * already sits on it. Per axis: the modal 1-LDU residue of the part origins modulo a stud (x, z) / a plate (y).
 */
export function gridOffset(placements, frames, lib) {
  // 1-LDU bins over a stud / a plate, each with the sum of its residues so the offset is the bin's mean (Studio writes fractional LDU)
  const bins = (n) => ({ n: new Array(n).fill(0), s: new Array(n).fill(0), p: n });
  const hx = bins(20), hz = bins(20), hy = bins(8);
  const mod = (a, n) => ((a % n) + n) % n;
  const add = (h, r) => { const k = Math.round(r) % h.p; h.n[k]++; h.s[k] += (k === 0 && r > h.p / 2) ? r - h.p : r; };
  for (const p of placements) {
    const f = lib && lib.file(p.part + '.dat');
    if (f && f.desc && DROP.test(f.desc)) continue;
    const res = resolveId(p.part, frames, lib), fr = res && frames.get(res.id);
    if (!fr) continue;
    const Re = res.turn ? mm(DMD(p.M), TURN) : DMD(p.M);
    const ori = ORI_INDEX.get(oriKey(Re));
    if (ori === undefined || ori >= 4 || !ORIENTATIONS[ori].every((x, k) => Math.abs(Re[k] - x) < 1e-3)) continue;
    const tt = Dv(p.t), v = [fr.cx, -fr.maxy, fr.cz], R = ORIENTATIONS[ori];
    const o = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + tt[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + tt[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + tt[2]];
    const [w, d] = fr.foot[ori * 90];
    // residues in the engine frame (o is already Dv'd): i = o[0]/STUD - w/2 must be a whole stud (jumpers are the minority), b = o[1]/PLATE a whole plate
    add(hx, mod(o[0] - w * STUD / 2, STUD));
    add(hz, mod(o[2] - d * STUD / 2, STUD));
    add(hy, mod(o[1], PLATE));
  }
  const mode = (h) => { const k = h.n.indexOf(Math.max(...h.n)); return h.n[k] ? h.s[k] / h.n[k] : 0; };
  const n = hx.n.reduce((a, b) => a + b, 0); if (n < 4) return null;
  const rx = mode(hx), rz = mode(hz), ry = mode(hy);
  if (Math.abs(rx) < 0.05 && Math.abs(rz) < 0.05 && Math.abs(ry) < 0.05) return null;
  // back to LDraw's frame: Dv flips y and z, so an engine residue r on y / z is -r in the file
  return [rx, -ry, -rz];
}

/** sampled volume (G x G per stud) of an engine piece record, from the catalogue: reused by the miner to rasterise motifs */
const volCache = new Map();
export function pieceVolume(p, cat) {
  const k = `${p.id}|${p.rot}`;
  if (!volCache.has(k)) { const c = cat.find((x) => x.id === p.id); const { vol, h } = baseVolume(c); volCache.set(k, rotate(vol, h, c, p.rot)); }
  return volCache.get(k);
}
export { G };
