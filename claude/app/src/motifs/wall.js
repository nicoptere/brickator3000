// SNOT as a feature: "a wall is a floor turned on its side" (docs/CURVES.md round 7, the design; built in round 10).
//
// The upright skin lays slopes along the top-surface gradient; a near-vertical surface has no top-surface gradient and comes out
// as stairs of plates. Seen from the side it is just another sloped surface - so for each of the four horizontal facings the
// remaining field is resampled with that facing as "up" (the 4-LDU samples along it pair up into 8-LDU "plates", the plates
// along y split into two 4-LDU samples), the ordinary narrow aligned skin runs there with the upright catalogue, and each piece
// it places is turned back: it becomes a sideways piece (its yaw composed with the frame rotation is one of the 24 orientations
// of motifs/orient.js) and the cell behind its underside gets a side-stud host - a 1x1 brick with a stud on the side (87087),
// yawed so the stud faces the piece - the way a real SNOT hull is built: a core of side-stud bricks and sideways plating.
//
// Two lattices decide where a sideways piece CAN sit, and the local solver is restricted to them (Solver.allow):
//  - along the facing: its underside must meet a brick face, i.e. a stud-cell boundary (multiples of 20 LDU). The local
//    "plate" lattice is 8 LDU, so the pass runs twice, with the local levels offset by 0 and 4 LDU (`foff`), which between them
//    reach every face (x = 40k and x = 40k + 20);
//  - along y: every side stud of every LEGO part sits 6 LDU above a plate boundary (14 LDU up a brick, 30 up a bracket - the
//    mined stud points all agree), and a sideways part's stud rows are 20 LDU apart, so only every OTHER row of a sideways
//    part can meet a host. The local stud lattice along y is therefore tried at several offsets (`oy`, in 4-LDU samples),
//    each of which makes a different set of rows hostable; a piece needs one hostable row under it.
// The pieces are rigid (post.free) and carry the host's assembly id (post.components), so nothing re-cuts them and the
// stud-contact connectivity knows what holds them.
import { G, STUD, PLATE } from '../brickgen/constants.js';
import { Solver } from '../brickgen/solver.js';
import { partVariants, baseVolume, rotate } from '../brickgen/variants.js';
import { ORIENTATIONS, orientPart } from './orient.js';
import SHAPES from '../brickgen/catalog_shapes.js';

const SAMP = STUD / G;                                                     // 4 LDU
const key9 = (M) => M.join(',');
const ORI_KEY = new Map(ORIENTATIONS.map((M, k) => [key9(M), k]));
const mul = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };

/** the four horizontal facings as frames: world = R . local, local +y = the facing, local +z = world +y (so a local row is a world level) */
export const FACINGS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map((f) => {
  const c1 = f, c2 = [0, 1, 0], c0 = [c1[1] * c2[2] - c1[2] * c2[1], c1[2] * c2[0] - c1[0] * c2[2], c1[0] * c2[1] - c1[1] * c2[0]];   // c0 = c1 x c2: right-handed
  const R = [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
  const ori = ORI_KEY.get(key9(R)); if (ori === undefined) throw new Error('wall: facing frame is not one of the 24 orientations');
  return { f, R, ori, name: (f[0] || f[2]) > 0 ? '+' : '-', axis: f[0] ? 'x' : 'z' };
});

// Side studs of the host bricks in the part's own frame (engine: y up from the bottom face, footprint centred; +z here is
// LDraw's -z), read off the LDraw files: 87087 / 47905 / 4733 carry `stud2a` 10 LDU below the top (y = 14) on the face(s);
// the 1.667 bricks (40 LDU, the MOC builders' SNOT host) carry a `stug2` group at y = 10 AND 30 - two stud rows one stud
// apart, so a stack of them is a continuous side-stud lattice (levels 0, 5, 10 ... reach every sideways row). `levelMod`: a
// host may only sit on levels that are multiples of it (3 = brick layers, 5 = stacks of 1.667 bricks), so the fill around it
// stays in phase. The headlight brick 4070 is left out: its stud face is recessed 4 LDU, so the part it holds overlaps its cell.
export const HOSTS = {
  '22885': { levelMod: 5, studs: [{ p: [-10, 10, 10], dir: [0, 0, 1] }, { p: [10, 10, 10], dir: [0, 0, 1] }, { p: [-10, 30, 10], dir: [0, 0, 1] }, { p: [10, 30, 10], dir: [0, 0, 1] }] },
  '32952': { levelMod: 5, studs: [{ p: [0, 10, 10], dir: [0, 0, 1] }, { p: [0, 30, 10], dir: [0, 0, 1] }] },
  '67329': { levelMod: 5, studs: [{ p: [-10, 10, 10], dir: [0, 0, 1] }, { p: [10, 10, 10], dir: [0, 0, 1] }, { p: [-10, 30, 10], dir: [0, 0, 1] }, { p: [10, 30, 10], dir: [0, 0, 1] },
    { p: [20, 10, 0], dir: [1, 0, 0] }, { p: [20, 30, 0], dir: [1, 0, 0] }, { p: [-20, 10, 0], dir: [-1, 0, 0] }, { p: [-20, 30, 0], dir: [-1, 0, 0] }] },
  '87087': { levelMod: 3, studs: [{ p: [0, 14, 10], dir: [0, 0, 1] }] },
  '47905': { levelMod: 3, studs: [{ p: [0, 14, 10], dir: [0, 0, 1] }, { p: [0, 14, -10], dir: [0, 0, -1] }] },
  '4733': { levelMod: 3, studs: [{ p: [0, 14, 10], dir: [0, 0, 1] }, { p: [0, 14, -10], dir: [0, 0, -1] }, { p: [10, 14, 0], dir: [1, 0, 0] }, { p: [-10, 14, 0], dir: [-1, 0, 0] }] },
};
export const SIDE_STUDS = Object.fromEntries(Object.entries(HOSTS).map(([k, v]) => [k, v.studs]));   // (round-10 name)

/** the world fine (4 LDU) box of a local fine box under frame R, given the world fine extents n (x, y, z) */
function toWorldBox(R, n, lo, hi) {
  const wlo = [0, 0, 0], whi = [0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (!R[r * 3 + c]) continue;
    if (R[r * 3 + c] > 0) { wlo[r] = lo[c]; whi[r] = hi[c]; } else { wlo[r] = n[r] - hi[c]; whi[r] = n[r] - lo[c]; }
  }
  return [wlo, whi];
}

/** add (sign = +1) or remove a world-fine occupancy block FW (ny x nz x nx, 4-LDU slices in y) at world fine min corner `at` */
function addFine(S, at, FW, nx, ny, nz, sign = 1) {
  const NZ = S.NZs, NX = S.NXs;
  for (let y = 0; y < ny; y++) { const wy = at[1] + y, l = wy >> 1; if (wy < 0 || l >= S.NL) continue;
    for (let z = 0; z < nz; z++) { const wz = at[2] + z; if (wz < 0 || wz >= NZ) continue;
      for (let x = 0; x < nx; x++) { const wx = at[0] + x; if (wx < 0 || wx >= NX) continue;
        const v = FW[(y * nz + z) * nx + x] * 0.5 * sign, q = (l * NZ + wz) * NX + wx;
        S.C[q] = Math.min(1, Math.max(0, S.C[q] + v)); S.M[q] = Math.min(1, Math.max(0, S.M0[q] - S.C[q]));
      } } }
  S.ver++;
}

/** mean of a world field over a world fine box */
function boxMean(S, F, lo, hi) {
  let s = 0, n = 0;
  for (let y = lo[1]; y < hi[1]; y++) { const l = y >> 1; if (l < 0 || l >= S.NL) continue;
    for (let z = lo[2]; z < hi[2]; z++) { if (z < 0 || z >= S.NZs) continue;
      for (let x = lo[0]; x < hi[0]; x++) { if (x < 0 || x >= S.NXs) continue; s += F[(l * S.NZs + z) * S.NXs + x]; n++; } } }
  return n ? s / n : 0;
}

const hostVariants = new Map();
/** the solver variant of a host brick at one yaw (1x1 bricks dedupe to one yaw in partVariants, so these are built directly) */
function hostVariant(c, rot) {
  const k = `${c.id}|${rot}`; if (hostVariants.has(k)) return hostVariants.get(k);
  const { vol, h } = baseVolume(c), r = rotate(vol, h, c, rot);
  let sum = 0; for (const x of r.V) sum += x;
  const v = { c, rot, V: r.V, studs: r.studs, w: r.w, d: r.d, h, vtot: sum / (G * G), vsum: sum };
  hostVariants.set(k, v); return v;
}
/** the side studs of host `c` at yaw r (0..3), in world LDU from the host's box min corner: [{ p: [x, y, z], dir }] */
function hostStuds(c, r) {
  const Y = ORIENTATIONS[r], out = [];
  for (const s of HOSTS[c.id].studs) {
    const d = [Y[0] * s.dir[0] + Y[2] * s.dir[2], 0, Y[6] * s.dir[0] + Y[8] * s.dir[2]];
    const yaw = r === 1 || r === 3, cw = (yaw ? c.d : c.w) * STUD / 2, cd = (yaw ? c.w : c.d) * STUD / 2;
    out.push({ p: [Y[0] * s.p[0] + Y[2] * s.p[2] + cw, s.p[1], Y[6] * s.p[0] + Y[8] * s.p[2] + cd], dir: d });
  }
  return out;
}

/**
 * The sideways skin on the four facings. Runs FIRST (before the disc layers and the upright skin, which would otherwise pave
 * the steep belt with the rim plates these parts replace); the upright phases then build around its hosts. Per facing and
 * lattice: resample, a local skin phase (slopes / tiles, 1-wide) and a local fill phase (sideways plates / bricks stacking
 * back onto the host face), then a bottom-up commit where each piece is held by a host brick behind it or by the studs of the
 * sideways piece beneath. Options (constants.js): wallKinds, wallFillKinds, wallTol, wallFillTol, wallOffsets (row lattice
 * offsets, 4-LDU samples), wallFoffs (level lattice offsets along the facing), wallHostLevels (host levels modulo), wallSteep,
 * wallPartial, wallHostFill, wallHost, wallFacings, wallDebug. Returns { pieces, hosts, tried, unhosted, why }.
 */
export function wallSkin(S, cat, o, log = () => {}, onPhase = null) {
  const by = new Map(cat.map((c) => [c.id, c]));
  // the host types in order of preference: the 1.667 bricks first (a continuous lattice, several studs each), the 1x1 brick last
  const hostIds = (o.wallHosts || ['22885', '32952', '87087']).filter((id) => HOSTS[id]);
  const hostParts = hostIds.map((id) => by.get(id) || SHAPES.find((c) => c.id === id)).filter(Boolean);
  if (!hostParts.length) { log('wall: no host part in the catalogue'); return { pieces: 0, hosts: 0, tried: 0, unhosted: 0 }; }
  // per host type and yaw facing f: its studs (world LDU from the box min) - the row heights they offer and the lateral offsets
  const hostPlans = new Map();                                             // facing name -> [{ c, rot, studs, w, d, h, mod }]
  for (const F of FACINGS) {
    const list = [];
    for (const c of hostParts) for (let r = 0; r < 4; r++) {
      const st = hostStuds(c, r).filter((s) => s.dir[0] === F.f[0] && s.dir[2] === F.f[2]); if (!st.length) continue;
      const yaw = r === 1 || r === 3; list.push({ c, rot: r * 90, studs: st, w: yaw ? c.d : c.w, d: yaw ? c.w : c.d, h: Math.round(c.h), mod: o.wallHostLevels ?? HOSTS[c.id].levelMod });
    }
    hostPlans.set(F.name + F.axis, list);
  }
  const kinds = new Set(o.wallKinds || ['slope', 'curved', 'cheese']);
  const vars = partVariants(cat, kinds).filter((v) => !v.c.ext && (o.wallWide || v.w === 1 || v.d === 1));   // core 1-wide parts, as the upright narrow skin
  const tol = o.wallTol || o.skinTol;
  const n = [S.NXs, 2 * S.NL, S.NZs];                                      // world fine extents (x, y, z)
  const facings = FACINGS.filter((F) => !o.wallFacings || o.wallFacings.includes(F.name + F.axis));
  const offsets = o.wallOffsets || [4, 2, 0];                              // local y lattice offsets: hostable rows at 14 / 22 / 30 (+40k) LDU
  const foffs = o.wallFoffs || [0, 1];                                     // local level lattice offset along the facing (samples): faces at 40k / 40k + 20
  let placed = 0, hosts = 0, tried = 0, unhosted = 0, pass = 0; const why = {}; const fail = (k) => { why[k] = (why[k] || 0) + 1; unhosted++; };
  // Where the sideways skin is allowed at all, per facing, world stud cell and level: the cell holds the SILHOUETTE along the
  // facing (the outermost solid sample of its row at that level), is PARTIAL (a vertical wall that sits on the stud lattice
  // is a brick's own face: full or empty cells, nothing to gain), and the silhouette is STEEP there - within `wallSteep`
  // degrees of vertical, read off the silhouette one level up and down (the top-surface gradient is blind at the rim, where
  // its neighbour columns have no surface at all). Gentler surfaces belong to the upright skin.
  const Xc = S.NXc, Zc = S.NZc, NL = S.NL, NZs = S.NZs, NXs = S.NXs, part = o.wallPartial ?? 0.12;
  const maxStep = 2 * PLATE * Math.tan((90 - (o.wallSteep ?? 60)) * Math.PI / 180) / SAMP;   // silhouette move over two levels, in samples
  const cellFill = new Float32Array(NL * Zc * Xc);
  for (let l = 0; l < NL; l++) for (let cz = 0; cz < Zc; cz++) for (let cx = 0; cx < Xc; cx++) {
    let sum = 0; for (let dz = 0; dz < G; dz++) { const base = S.idx(l, cz * G + dz, cx * G); for (let dx = 0; dx < G; dx++) sum += S.M0[base + dx]; }
    cellFill[(l * Zc + cz) * Xc + cx] = sum / (G * G);
  }
  const maskFor = (F) => {
    const ax = F.f[0] ? 0 : 2, sgn = F.f[ax], along = ax === 0 ? NXs : NZs, across = ax === 0 ? NZs : NXs;
    const D = new Float32Array(NL * across).fill(-1);                      // outermost solid sample along the facing, per level and lateral row
    for (let l = 0; l < NL; l++) for (let r = 0; r < across; r++) {
      for (let k = along - 1; k >= 0; k--) { const t = sgn > 0 ? k : along - 1 - k; const v = ax === 0 ? S.M0[S.idx(l, r, t)] : S.M0[S.idx(l, t, r)]; if (v >= 0.5) { D[l * across + r] = t; break; } }
    }
    const mask = new Uint8Array(NL * Zc * Xc);
    for (let l = 0; l < NL; l++) for (let r = 0; r < across; r++) {
      const d0 = D[l * across + r]; if (d0 < 0) continue;
      const d1 = l + 1 < NL ? D[(l + 1) * across + r] : -1, d2 = l > 0 ? D[(l - 1) * across + r] : -1;
      const steep = d1 >= 0 && d2 >= 0 ? Math.abs(d1 - d2) <= maxStep : (d1 >= 0 ? Math.abs(d1 - d0) <= maxStep / 2 : d2 >= 0 ? Math.abs(d2 - d0) <= maxStep / 2 : false);
      if (!steep) continue;
      const ca = Math.floor(d0 / G), cr = Math.floor(r / G), cx = ax === 0 ? ca : cr, cz = ax === 0 ? cr : ca, q = (l * Zc + cz) * Xc + cx;
      const m = cellFill[q]; if (m >= part && m <= 1 - part) mask[q] = 1;
    }
    return mask;
  };
  let mask = null;
  // every world cell a piece touches must be in the mask: a sideways part half in a full cell would leave the other half of
  // that cell to upright parts that cannot fit beside it
  const maskOk = (wlo, whi) => {
    for (let l = wlo[1] >> 1; l < Math.ceil(whi[1] / 2); l++) { if (l < 0 || l >= NL) return false;
      for (let cz = Math.floor(wlo[2] / G); cz < Math.ceil(whi[2] / G); cz++) { if (cz < 0 || cz >= Zc) return false;
        for (let cx = Math.floor(wlo[0] / G); cx < Math.ceil(whi[0] / G); cx++) { if (cx < 0 || cx >= Xc || !mask[(l * Zc + cz) * Xc + cx]) return false; } } }
    return true;
  };
  const fillVars = partVariants(cat, new Set(o.wallFillKinds || ['plate', 'brick'])).filter((v) => !v.c.ext);
  const fillTol = o.wallFillTol || o.fillTol;
  const hostUsed = new Map();                                              // world cell key -> piece index of the host already there
  const total = facings.length * offsets.length * foffs.length;
  for (const F of facings) for (const foff of foffs) {
    const R = F.R; mask = maskFor(F);
    if (o.wallDebug) { let nm = 0; for (const v of mask) nm += v; log(`  wall ${F.name}${F.axis}: mask ${nm} cells`);
      if (o.wallDebug === 'map' && foff === 0) for (let l = 0; l < NL; l++) { let rows = []; for (let cz = 0; cz < Zc; cz++) { let r = ''; for (let cx = 0; cx < Xc; cx++) { const q = (l * Zc + cz) * Xc + cx; r += mask[q] ? '#' : cellFill[q] > 0.88 ? 'o' : cellFill[q] >= 0.12 ? '.' : ' '; } rows.push(r); } log(`  L${l}\n` + rows.join('\n')); } }
    // local fine extents: local axis c takes the extent of the world axis it feeds
    const nl = [0, 0, 0]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (R[r * 3 + c]) nl[c] = n[r];
    const nlx = nl[0], nly = nl[1] + foff, NX2 = Math.ceil(nlx / G) * G, NL2 = Math.ceil(nly / 2), nz0 = nl[2];
    // resample once per facing and level offset: world fine cube (wx, wy, wz) -> local (lx, ly, lz), per local level = the mean
    // of its two slices; the row-lattice offsets below are shifts along local z of these arrays
    const F0 = new Float32Array(NL2 * nz0 * NX2), Fr = new Float32Array(NL2 * nz0 * NX2), Fc = new Float32Array(NL2 * nz0 * NX2), Ff = new Float32Array(NL2 * nz0 * NX2);
    const full = S.Mfull || S.M0;
    const li = [0, 0, 0];
    for (let wy = 0; wy < n[1]; wy++) for (let wz = 0; wz < n[2]; wz++) for (let wx = 0; wx < n[0]; wx++) {
      const w = [wx, wy, wz];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (R[r * 3 + c]) li[c] = R[r * 3 + c] > 0 ? w[r] : n[r] - 1 - w[r];
      const lx = li[0], ly = li[1] + foff, lz = li[2], q = ((ly >> 1) * nz0 + lz) * NX2 + lx, qs = ((wy >> 1) * S.NZs + wz) * S.NXs + wx;
      F0[q] += S.M0[qs] / 2; Fr[q] += S.M[qs] / 2; Fc[q] += S.C[qs] / 2; Ff[q] += full[qs] / 2;
    }
    for (const oy of offsets) {
    onPhase && onPhase('W-wall', Math.max(1e-6, pass++ / total));
    const nlz = nz0 + oy, NZ2 = Math.ceil(nlz / G) * G;
    const M0 = new Float32Array(NL2 * NZ2 * NX2), Mr = new Float32Array(NL2 * NZ2 * NX2), Cr = new Float32Array(NL2 * NZ2 * NX2), Mf = new Float32Array(NL2 * NZ2 * NX2);
    for (let l = 0; l < NL2; l++) for (let z = 0; z < nz0; z++) { const a = (l * nz0 + z) * NX2, b = (l * NZ2 + z + oy) * NX2; M0.set(F0.subarray(a, a + NX2), b); Mr.set(Fr.subarray(a, a + NX2), b); Cr.set(Fc.subarray(a, a + NX2), b); Mf.set(Ff.subarray(a, a + NX2), b); }
    // the committed pieces of the earlier lattices are in S.C / S.M already, but not in this facing's resampled copies: re-read them
    if (oy !== offsets[0]) for (let wy = 0; wy < n[1]; wy++) for (let wz = 0; wz < n[2]; wz++) for (let wx = 0; wx < n[0]; wx++) {
      const w = [wx, wy, wz];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (R[r * 3 + c]) li[c] = R[r * 3 + c] > 0 ? w[r] : n[r] - 1 - w[r];
      const q = (((li[1] + foff) >> 1) * NZ2 + li[2] + oy) * NX2 + li[0], qs = ((wy >> 1) * S.NZs + wz) * S.NXs + wx;
      if (wy % 2 === 0) { Mr[q] = 0; Cr[q] = 0; }
      Mr[q] += S.M[qs] / 2; Cr[q] += S.C[qs] / 2;
    }
    const S2 = new Solver(M0, NL2, NZ2, NX2, o);
    S2.M = Mr; S2.C = Cr; S2.Mfull = Mf; S2.log = () => {};
    const localBox = (b, j, i, h, d, w) => toWorldBox(R, n, [i * G, b * 2 - foff, j * G - oy], [(i + w) * G, (b + h) * 2 - foff, (j + d) * G - oy]);
    // a local level's underside plane is a stud-cell face along the facing (a host's face) when its world coordinate is a multiple of 20 LDU
    const faceOk = (b) => { const [wlo, whi] = localBox(b, 0, 0, 1, 1, 1), ax = F.f[0] ? 0 : 2; const edge = F.f[ax] > 0 ? wlo[ax] : whi[ax]; return edge % G === 0; };
    const rowY = (j) => (j + 0.5) * STUD - oy * SAMP;                      // world y (LDU) of the centre of local row j
    // a row (world y of a stud row centre) is hostable when some host type, on an allowed level, has a stud at that height
    const plans = hostPlans.get(F.name + F.axis);
    const rowOk = (y) => { for (const pl of plans) for (const st of pl.studs) { const hb = (y - st.p[1]) / PLATE; if (hb >= 0 && Number.isInteger(hb) && hb % pl.mod === 0 && hb + pl.h <= NL) return true; } return false; };
    const inside = (b, j, i, h, d, w) => !((i + w) * G > nlx || j * G < oy || (j + d) * G > nlz || b * 2 - foff < 0 || (b + h) * 2 - foff > nl[1]);   // inside the real world box, not the padding
    // the skin: slopes / tiles whose underside is on a face (one hostable row under them) or anywhere in the slab above a face -
    // what holds them is settled at commit time, bottom-up: a host brick behind, or the sideways piece beneath
    const rowHostable = (j, d) => { for (let r = 0; r < d; r++) if (rowOk(rowY(j + r))) return true; return false; };
    const dbg = o.wallDebug ? { calls: 0, inside: 0, face: 0, faceRow: 0, mask: 0 } : null;
    S2.allow = (b, j, i, h, d, w) => {
      if (dbg) dbg.calls++;
      if (!inside(b, j, i, h, d, w)) return false;
      if (dbg) dbg.inside++;
      const onFace = faceOk(b); if (dbg && onFace) dbg.face++;
      if (onFace && !rowHostable(j, d)) return false;                      // on a host face: one of its rows must meet a side stud
      if (dbg && onFace) dbg.faceRow++;
      const [wlo, whi] = localBox(b, j, i, h, d, w); const ok = maskOk(wlo, whi); if (dbg && ok) dbg.mask++;
      return ok;
    };
    if (dbg) S2.log = (m) => log(`  wall ${F.name}${F.axis} foff ${foff} oy ${oy}: ${m} ${JSON.stringify(dbg)}`);
    const before = S2.pieces.length;
    S2.runPhase(vars, tol, 'W-wall');
    // the slab under the skin, in sideways plates and bricks (the plating that stacks back onto the host face)
    if (fillVars.length) S2.runPhase(fillVars, fillTol, 'W-fill');
    // commit bottom-up (local level = distance from the facing's far side): each piece is held by a host brick behind it (its
    // underside on a face, over a hostable row) or by the studs of a committed sideways piece right under it
    const local = S2.pieces.slice(before).sort((a, b) => a.b - b.b);
    const top = new Map();                                                 // local cell "i,j" -> { top level, studs, mi } of the committed piece ending there
    const ax = F.f[0] ? 0 : 2, sgn = F.f[ax];
    for (const q of local) {
      tried++;
      const c = by.get(q.id), Y = ORIENTATIONS[Math.round(q.rot / 90) % 4], ori = ORI_KEY.get(key9(mul(R, Y)));
      const ob = orientPart(c, ori);
      const [wlo, whi] = localBox(q.b, q.j, q.i, q.h, q.d, q.w);
      if (whi[0] - wlo[0] !== ob.nx || whi[1] - wlo[1] !== ob.ny || whi[2] - wlo[2] !== ob.nz) { fail('box'); continue; }   // template / box mismatch: never for the core parts
      if (boxMean(S, S.C, wlo, whi) > 1e-6) { fail('collide'); continue; }   // the local collision test is exact only up to the resampling
      let mi = null;
      // held from below by a committed sideways piece with studs?
      for (let r = 0; r < q.d && mi === null; r++) for (let a = 0; a < q.w; a++) { const t = top.get(`${q.i + a},${q.j + r}`); if (t && t.top === q.b && t.studs) { mi = t.mi; break; } }
      if (mi === null && faceOk(q.b)) {
        // the host: a host type, yawed to face the piece, with one of its studs exactly under one of the piece's hostable
        // underside cells and the cell behind that cell inside its box. Host types in order of preference; a host already
        // placed for an earlier piece is reused when its box matches (that is what a 4-stud host is for)
        let placedHost = null, why = 'norow';
        for (let r = 0; r < q.d && !placedHost; r++) {
          const y = rowY(q.j + r); if (!rowOk(y)) continue;
          for (let a = 0; a < q.w && !placedHost; a++) {
            const [clo, chi] = localBox(q.b, q.j + r, q.i + a, 0.5, 1, 1);   // the underside slab of that cell: along the facing its plane, laterally the cell
            const face = (sgn > 0 ? clo[ax] : chi[ax]) * SAMP;             // LDU of the underside plane along the facing
            const lat = ax === 0 ? 2 : 0, latC = (clo[lat] + chi[lat]) / 2 * SAMP;   // lateral (horizontal) centre, LDU
            for (const pl of plans) {
              for (const st of pl.studs) {
                const hb = (y - st.p[1]) / PLATE; if (!(hb >= 0 && Number.isInteger(hb) && hb % pl.mod === 0 && hb + pl.h <= NL)) continue;
                // the host's box min (world LDU) puts this stud at (face, y, latC): along the facing the stud is on the face (st.p[ax] is 0 or the box extent)
                const minF = face - st.p[ax], minL = latC - st.p[lat];
                if (minF % STUD !== 0 || minL % STUD !== 0) continue;
                const ix = ax === 0 ? minF / STUD : minL / STUD, iz = ax === 0 ? minL / STUD : minF / STUD;
                if (ix < 0 || iz < 0 || ix + pl.w > S.NXc || iz + pl.d > S.NZc) continue;
                const hk = `${pl.c.id}|${ix},${iz},${hb}`;
                let hn = hostUsed.get(hk);
                if (hn === undefined) {
                  const hlo = [ix * G, hb * 2, iz * G], hhi = [(ix + pl.w) * G, (hb + pl.h) * 2, (iz + pl.d) * G];
                  if (boxMean(S, S.C, hlo, hhi) > 1e-6) { why = 'hostBusy'; continue; }
                  if (boxMean(S, S.M0, hlo, hhi) < (o.wallHostFill ?? 0.3)) { why = 'hostAir'; continue; }
                  const hv = hostVariant(pl.c, pl.rot), rr = S.evaluate(hv, hb, iz, ix, { min_cov: 0, max_err: 1, piece_pen: 0 });
                  if (!rr) { why = 'hostBusy'; continue; }
                  S._place(hv, hb, iz, ix, rr[1], rr[2], 'W-host');
                  hn = S.pieces.length - 1; const hp = S.pieces[hn];
                  hp.rigid = true; hp.mi = S.mi = (S.mi || 0) + 1; hp.host = true; hostUsed.set(hk, hn); hosts++;
                }
                placedHost = hn; break;
              }
              if (placedHost !== null) break;
            }
          }
        }
        if (placedHost !== null) mi = S.pieces[placedHost].mi; else fail(why);
      } else if (mi === null) fail('unheld');
      if (mi === null) continue;
      // commit the sideways piece: its world volume into the coverage, the record with its orientation
      addFine(S, wlo, ob.FW, ob.nx, ob.ny, ob.nz, 1);
      S.pieces.push({ id: c.id, name: c.name, kind: c.kind, rot: 0, ori, b: wlo[1] / 2, i: wlo[0] / G, j: wlo[2] / G, w: ob.w, d: ob.d, h: ob.h,
        studs: [], phase: q.phase === 'W-fill' ? 'W-fill' : 'W-wall', matched: q.matched, over: q.over, snot: true, rigid: true, mi, facing: F.name + F.axis });
      placed++;
      // what is left of the field in the cells this piece touches is NOT for the upright mop-up phases: a 1x1 plate dropped
      // beside a sideways part has nothing to stand on (a sideways plate's edge holds nothing) and ends up a loose component
      // the repair passes then weld at a price. The local fill had its chance to plate the slab sideways; the rest is given up.
      // ... and the same for the level right above it: an upright part set down on a sideways one has no stud to hold it
      for (let l = wlo[1] >> 1; l <= Math.ceil(whi[1] / 2); l++) { if (l < 0 || l >= NL) continue;
        for (let cz = Math.floor(wlo[2] / G); cz < Math.ceil(whi[2] / G); cz++) { if (cz < 0 || cz >= Zc) continue;
          for (let cx = Math.floor(wlo[0] / G); cx < Math.ceil(whi[0] / G); cx++) { if (cx < 0 || cx >= Xc) continue;
            for (let dz = 0; dz < G; dz++) { const base = S.idx(l, cz * G + dz, cx * G); for (let dx = 0; dx < G; dx++) S.M[base + dx] = 0; } } } }
      S.ver++;
      const studs = c.kind !== 'tile' && (c.stud_cells || []).length > 0;
      for (let r = 0; r < q.d; r++) for (let a = 0; a < q.w; a++) top.set(`${q.i + a},${q.j + r}`, { top: q.b + q.h, studs, mi });
    }
    }
  }
  log(`phase W-wall: ${placed} sideways pieces on ${hosts} hosts (${tried} tried, ${unhosted} without a host: ${JSON.stringify(why)}) over ${facings.length} facings x ${foffs.length} x ${offsets.length} lattices`);
  return { pieces: placed, hosts, tried, unhosted, why };
}
