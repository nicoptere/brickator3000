// SNOT synthesis - "anything on walls" (docs/CURVES.md round 7).
//
// The mined assemblies show HOW a part hangs on a side stud: which host (a headlight brick, a brick with studs on its side, a
// bracket), at which yaw, the sideways part at which of the 24 orientations, and where exactly the stud is - but only for the
// parts some official set happened to put there (tiles, 1x2 plates, cheese slopes, 1x1 round plates). The underside of every
// plate, tile, slope or round plate takes a stud in each cell of its footprint, so the SAME stud holds any part by any of its
// cells. The catalogue says what could hang there instead: a sideways curved slope rounds a vertical edge, a sideways 2x2 round
// plate is a disc on a wall, a sideways slope is a chamfered corner.
//
// 1. From every mined sideways part next to a host, the world position of the host's side stud is recovered: the point under
//    the part's underside cell that sits on the host (the mode over the observations - a 1x2 plate can hang by either cell).
//    One stud point per (host, host yaw, part orientation), for the orientations that face that stud.
// 2. Every catalogue part of an allowed kind, in that orientation, by each of its underside cells, is hung on that stud, and the
//    host + part pair becomes a compound solver variant like a mined motif (library.assemblyVariants): placed as one rigid
//    assembly, scored by the field, exported with its real orientation. Legal by construction: the stud is where a set put it.
import { G, STUD, PLATE } from '../brickgen/constants.js';
import { ORIENTATIONS } from './orient.js';
import { oriented, assemblyVariants, HOST, builtinMotifs } from './library.js';

const SAMP = STUD / G;
const UNIT = [STUD, PLATE, STUD];                                          // LDU per grid unit along world x, y, z
/** world axis (0 x, 1 y, 2 z) and sign that a part's local +y (its studs) maps to under orientation `ori` */
function topAxis(ori) { const R = ORIENTATIONS[ori]; for (let r = 0; r < 3; r++) if (R[r * 3 + 1]) return [r, R[r * 3 + 1]]; return [1, 1]; }
/** world offset (LDU) from the oriented part's box min corner to the centre of underside cell (cx, cz) of its local footprint */
function cellUnder(v, ori, cx, cz) {
  const R = ORIENTATIONS[ori], c = v.c, nL = [c.w * G, v.ob.ny, c.d * G];                     // local fine extents (x, thickness, z) in 4-LDU cells
  const L = [(cx + 0.5) * STUD, 0, (cz + 0.5) * STUD], out = [0, 0, 0];                       // local point: cell centre on the underside (y = 0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (R[r * 3 + c]) out[r] = R[r * 3 + c] < 0 ? nL[c] * SAMP - L[c] : L[c];
  return out;
}
const boxMinLDU = (p) => [p.i * STUD, p.b * PLATE, p.j * STUD];

/**
 * the side-stud points observed in the mined SNOT motifs: Map `host|hostYaw|ori` -> { host, hostOri, ori, axis, sign, P: [x, y, z]
 * LDU from the host's box min corner, n, models }. A part under `ori` has its underside facing the host along `axis` (sign is
 * the direction its studs point).
 */
export function studPoints(cat, { minCount = 5 } = {}) {
  const by = new Map(cat.map((c) => [c.id, c])), votes = new Map();
  for (const m of builtinMotifs()) {
    if (!m.parts.some((p) => (p.ori ?? 0) >= 4)) continue;
    const hosts = m.parts.filter((p) => (p.ori ?? 0) < 4 && by.has(p.id) && HOST.test(by.get(p.id).name));
    if (!hosts.length) continue;
    for (const p of m.parts) {
      if ((p.ori ?? 0) < 4 || !by.has(p.id)) continue;
      const c = by.get(p.id), ob = oriented(c, p.ori), [axis, sign] = topAxis(p.ori);
      const box = [p.i, p.b, p.j], ext = [ob.w, ob.h, ob.d];
      const under = sign > 0 ? box[axis] : box[axis] + ext[axis];                      // the underside face along the facing axis
      for (const h of hosts) {
        const hOri = h.ori ?? Math.round((h.rot || 0) / 90), hv = oriented(by.get(h.id), hOri), hb = [h.i, h.b, h.j], he = [hv.w, hv.h, hv.d];
        const face = sign > 0 ? hb[axis] + he[axis] : hb[axis], tol = axis === 1 ? 1.0 : 0.45;     // headlight studs are recessed
        if (Math.abs(under - face) > tol) continue;
        let overlap = true; for (let a = 0; a < 3; a++) { if (a === axis) continue; if (box[a] + ext[a] <= hb[a] + 1e-6 || hb[a] + he[a] <= box[a] + 1e-6) overlap = false; }
        if (!overlap) continue;
        // every underside cell of the part is a possible stud position; the one over the host's box wins the vote
        const bmin = boxMinLDU({ i: p.i, b: p.b, j: p.j }), hmin = boxMinLDU({ i: h.i, b: h.b, j: h.j });
        for (let cx = 0; cx < c.w; cx++) for (let cz = 0; cz < c.d; cz++) {
          const u = cellUnder(ob, p.ori, cx, cz), P = [bmin[0] + u[0] - hmin[0], bmin[1] + u[1] - hmin[1], bmin[2] + u[2] - hmin[2]];
          let inside = true; for (let a = 0; a < 3; a++) { if (a === axis) continue; if (P[a] < -1 || P[a] > he[a] * UNIT[a] + 1) inside = false; }
          if (!inside) continue;
          const key = `${h.id}|${hOri}|${p.ori}`, pk = P.map((v) => Math.round(v / 2) * 2).join(',');
          let e = votes.get(key); if (!e) { e = { host: h.id, hostOri: hOri, ori: p.ori, axis, sign, pts: new Map(), n: 0, models: 0 }; votes.set(key, e); }
          const q = e.pts.get(pk) || { P: P.map((v) => Math.round(v / 2) * 2), n: 0, models: 0 }; q.n += m.n; q.models += m.models; e.pts.set(pk, q);
          e.n += m.n; e.models += m.models;
        }
      }
    }
  }
  const out = new Map();
  for (const [key, e] of votes) {
    const best = [...e.pts.values()].sort((a, b) => b.n - a.n)[0];
    if (best.n >= minCount) out.set(key, { host: e.host, hostOri: e.hostOri, ori: e.ori, axis: e.axis, sign: e.sign, P: best.P, n: best.n, models: best.models });
  }
  return out;
}

const cache = new Map();
/**
 * compound variants: every (stud point x catalogue part x underside cell). Options: snotMinCount (stud seen this many times),
 * snotMaxThick (part thickness, plates), snotMaxCells (part footprint cells), snotKinds (kinds allowed to hang), snotBonus.
 */
export function snotVariants(cat, { snotMinCount = 5, snotMaxThick = 3, snotMaxCells = 4, snotKinds = ['plate', 'tile', 'round', 'curved', 'slope', 'cheese', 'inverted'], snotBonus = 0.2, motifMirror = true } = {}) {
  const key = `${cat.length}|${snotMinCount}|${snotMaxThick}|${snotMaxCells}|${snotKinds ? [...snotKinds].join(',') : '*'}|${snotBonus}|${motifMirror}`;
  if (cache.has(key)) return cache.get(key);
  const by = new Map(cat.map((c) => [c.id, c])), studs = studPoints(cat, { minCount: snotMinCount });
  const kinds = snotKinds ? new Set(snotKinds) : null, variants = [], seen = new Set(), seenV = new Set(); let assemblies = 0;   // seenV: one variant per distinct volume across all stud points (the host's four yaws give the same pairs)
  for (const e of studs.values()) {
    const host = by.get(e.host), hv = oriented(host, e.hostOri);
    for (const c of cat) {
      if (c.w * c.d > snotMaxCells || c.kind === 'technic' || c.noSolo || (kinds && !kinds.has(c.kind)) || HOST.test(c.name)) continue;
      if (c.w * c.d === 1 && Math.round(c.h) > 1) continue;                                  // a 1x1 cone / pyramid / double slope sideways is a greeble, not a surface; 1x1 plates, tiles and round plates stay
      const ob = oriented(c, e.ori); if (ob.ob.ny * SAMP > snotMaxThick * PLATE + 1e-6) continue;
      for (let cx = 0; cx < c.w; cx++) for (let cz = 0; cz < c.d; cz++) {
        const u = cellUnder(ob, e.ori, cx, cz);
        // box min of the part (grid units, from the host's box min) so that this cell's underside centre sits on the stud
        const off = [(e.P[0] - u[0]) / STUD, (e.P[2] - u[2]) / STUD, (e.P[1] - u[1]) / PLATE];   // i, j, b
        const snap = [Math.round(off[0] * 5) / 5, Math.round(off[1] * 5) / 5, Math.round(off[2] * 2) / 2];              // 0.2 stud, 0.5 plate: the engine's resolution
        if (Math.abs(snap[0] - off[0]) > 0.11 || Math.abs(snap[1] - off[1]) > 0.11 || Math.abs(snap[2] - off[2]) > 0.26) continue;
        const mins = [Math.min(0, snap[0]), Math.min(0, snap[1]), Math.min(0, snap[2])], sh = mins.map(Math.floor);
        const hi = [Math.max(hv.w, snap[0] + ob.w), Math.max(hv.d, snap[1] + ob.d), Math.max(hv.h, snap[2] + ob.h)];
        const w = Math.ceil(hi[0] - sh[0] - 1e-6), d = Math.ceil(hi[1] - sh[1] - 1e-6), h = Math.ceil(hi[2] - sh[2] - 1e-6);
        if (w > 6 || d > 6 || h > 9) continue;
        const parts = [{ id: host.id, ori: e.hostOri, i: -sh[0], j: -sh[1], b: -sh[2] }, { id: c.id, ori: e.ori, i: +(snap[0] - sh[0]).toFixed(2), j: +(snap[1] - sh[1]).toFixed(2), b: +(snap[2] - sh[2]).toFixed(2) }];
        const sig = `${host.id}|${e.hostOri}|${c.id}|${e.ori}|${parts[1].i},${parts[1].j},${parts[1].b}`; if (seen.has(sig)) continue; seen.add(sig);
        const m = { key: `snot:${sig}`, parts, w, d, h, n: e.n, models: e.models, snot: true, synth: 'snot' };
        if (assemblyVariants(by, m, snotBonus, variants, { mirror: motifMirror, solid: false, kind: 'snot', seen: seenV })) assemblies++;
      }
    }
  }
  const out = { variants, studs: studs.size, assemblies };
  cache.set(key, out); return out;
}
