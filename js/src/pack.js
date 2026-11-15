// Packing rigid parts into the target coverage.
//
// Objective. A placement P (part, yaw, cell anchor) has stencil o_P (fractional coverage of 4 LDU sub-voxels). With w = 2 t - 1,
//   gain(P) = sum_v o_P(v) w(v)  =  (volume of P inside the mesh) - (volume of P outside),  in sub-voxels.
// For binary o, sum_v |t - o| = sum t - sum_P gain(P): maximising the total gain of non-overlapping placements IS minimising the
// L1 volume error to the mesh. Gains are additive and independent of each other, so the problem is a maximum-weight set packing
// on the stud / plate cells (a part claims the cells of its box, as in a real build: nothing goes inside another part's box).
// Every placement also pays `lambda` (fewer, larger parts at equal fidelity).
//
// Search. 1) candidates: every placement with a positive net gain - box parts at every anchor (O(1) each from a summed-area
// table of per-cell gains), shaped parts only where their box meets the surface (their gain = box gain - the missing volume);
// 2) "core": the large parts first, ranked on a low-passed octave of the target and kept only where the fine target is solid;
// 3) greedy on the fine gain; 4) large-neighbourhood search ("ruin and recreate", Shaw 1998; Schrimpf et al. 2000): clear a
// random region near the surface, re-pack it with a randomised greedy, keep the result unless it lowers the objective - the
// soft-to-rigid part of the search: early iterations are allowed noisier choices, the noise cools to zero.
import { SX, SY } from './units.js';
import { packDeficits } from './gpu/index.js';

/** per-cell sums of w and the mixed flag, for grid phase (ox, oz) */
export function cellsOf(T, w, ox, oz) {
  const [CX, CY, CZ] = T.cells, { X, Z } = T, C = new Float64Array(CX * CY * CZ), mixed = new Uint8Array(CX * CY * CZ), tt = T.t;
  for (let b = 0; b < CY; b++) for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) {
    let s = 0, lo = 1, hi = 0;
    for (let y = b * SY; y < b * SY + SY; y++) for (let z = oz + j * SX; z < oz + j * SX + SX; z++) {
      const r = (y * Z + z) * X + ox + i * SX;
      for (let x = 0; x < SX; x++) { s += w[r + x]; const v = tt[r + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const c = (b * CZ + j) * CX + i; C[c] = s; mixed[c] = hi > 0.02 && lo < 0.98 ? 1 : 0;
  }
  return { C, mixed, CX, CY, CZ, ox, oz };
}

/** 3-D summed-area table of a cell array: box sum over [i0, i1) x [b0, b1) x [j0, j1) */
export function sat3(A, CX, CY, CZ) {
  const SXp = CX + 1, SZp = CZ + 1, S = new Float64Array(SXp * (CY + 1) * SZp);
  for (let b = 0; b < CY; b++) for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) {
    const at = (bb, jj, ii) => S[(bb * SZp + jj) * SXp + ii];
    S[((b + 1) * SZp + j + 1) * SXp + i + 1] = A[(b * CZ + j) * CX + i] + at(b, j + 1, i + 1) + at(b + 1, j, i + 1) + at(b + 1, j + 1, i)
      - at(b, j, i + 1) - at(b, j + 1, i) - at(b + 1, j, i) + at(b, j, i);
  }
  return (i0, b0, j0, i1, b1, j1) => {
    const at = (bb, jj, ii) => S[(bb * SZp + jj) * SXp + ii];
    return at(b1, j1, i1) - at(b0, j1, i1) - at(b1, j0, i1) - at(b1, j1, i0) + at(b0, j0, i1) + at(b0, j1, i0) + at(b1, j0, i0) - at(b0, j0, i0);
  };
}

/**
 * the deficit's sub-voxels of variant v as linear offsets in a field of row length X and Z rows per level (cached per field
 * shape): index (y * Z + z) * X + x of the anchor's first sub-voxel + rel[k]
 */
export function deficitRel(v, X, Z) {
  const key = X + ',' + Z, cache = v._rel || (v._rel = new Map());
  let rel = cache.get(key);
  if (!rel) {
    const nx = v.w * SX, nz = v.d * SX, per = nx * nz, di = v.deficit.idx; rel = new Int32Array(di.length);
    for (let k = 0; k < di.length; k++) { const q = di[k], l = (q / per) | 0, r = q - l * per, z = (r / nx) | 0, x = r - z * nx; rel[k] = (l * Z + z) * X + x; }
    cache.set(key, rel);
  }
  return rel;
}
/** linear index of the first sub-voxel of cell (i, j, b) at grid phase (ox, oz) */
export const cellBase = (T, i, j, b, ox, oz) => ((b * SY) * T.Z + oz + j * SX) * T.X + ox + i * SX;

/** gain of variant v at cell anchor (i, j, b) on field w (exact: box sum minus the stencil's missing coverage) */
export function gainAt(v, i, j, b, w, T, ox, oz, box) {
  let g = box(i, b, j, i + v.w, b + v.h, j + v.d);
  if (!v.full) {
    const rel = deficitRel(v, T.X, T.Z), dv = v.deficit.val, base = cellBase(T, i, j, b, ox, oz);
    for (let k = 0; k < rel.length; k++) g -= dv[k] * w[base + rel[k]];
  }
  return g;
}

/**
 * The (shaped variant, anchor) pairs whose deficit sums the candidate stage needs, in its own order (variants, then b, j, i), for
 * a GPU to compute: { vi: Int32Array, base: Int32Array (cellBase), n }. Box parts need none (summed-area table).
 */
export function shapedPairs(T, variants, w, ox, oz) {
  const K = cellsOf(T, w, ox, oz), { CX, CY, CZ } = K, mixBox = sat3(K.mixed, CX, CY, CZ);
  let cap = 1 << 16, n = 0, VI = new Int32Array(cap), BA = new Int32Array(cap);
  variants.forEach((v, vi) => {
    if (v.full) return;
    for (let b = 0; b + v.h <= CY; b++) for (let j = 0; j + v.d <= CZ; j++) for (let i = 0; i + v.w <= CX; i++) {
      if (mixBox(i, b, j, i + v.w, b + v.h, j + v.d) < 0.5) continue;
      if (n === cap) { cap *= 2; const a = new Int32Array(cap), c = new Int32Array(cap); a.set(VI); c.set(BA); VI = a; BA = c; }
      VI[n] = vi; BA[n] = cellBase(T, i, j, b, ox, oz); n++;
    }
  });
  return { vi: VI.subarray(0, n), base: BA.subarray(0, n), n };
}

/** grid phase: the (ox, oz) whose best 1 x 1 plate cover gains most (an upper bound of any plate packing at that phase) */
export function choosePhase(T, t, lambda = 3, theta = 0.5) {
  const w = new Float32Array(t.length); for (let i = 0; i < t.length; i++) w[i] = 2 * (t[i] - theta);
  let best = -Infinity, ph = [0, 0];
  for (let a = 0; a < SX; a++) for (let c = 0; c < SX; c++) { const k = cellsOf(T, w, a, c); let ub = 0; for (const s of k.C) if (s > lambda) ub += s - lambda; if (ub > best) { best = ub; ph = [a, c]; } }
  return ph;
}

/**
 * indices 0..n-1 ordered by key descending, ties by index ascending - exactly a stable sort by descending key - for keys >= 0
 * (non-negative doubles order like their bit patterns): LSD radix sort on the 64-bit patterns, 8 bits at a time, constant digits
 * skipped. Writes into `idx`, returns the view.
 */
let RX_TMP = new Int32Array(0), RX_CNT = new Int32Array(256);
function sortByScore(idx, key, n) {
  if (RX_TMP.length < n) RX_TMP = new Int32Array(n * 2);
  const u = new Uint32Array(key.buffer, key.byteOffset, key.length * 2);   // little-endian: u[2k] = low word, u[2k + 1] = high word
  let src = idx, dst = RX_TMP;
  for (let q = 0; q < n; q++) src[q] = q;
  for (let pass = 0; pass < 8; pass++) {
    const word = pass >> 2, sh = (pass & 3) * 8, cnt = RX_CNT; cnt.fill(0);
    for (let q = 0; q < n; q++) cnt[255 - ((u[2 * q + word] >>> sh) & 255)]++;   // 255 - digit: descending
    let nz = 0; for (let d = 0; d < 256; d++) if (cnt[d]) nz++;
    if (nz <= 1) continue;                                                           // every key shares this digit
    for (let d = 0, acc = 0; d < 256; d++) { const c = cnt[d]; cnt[d] = acc; acc += c; }
    for (let q = 0; q < n; q++) { const e = src[q]; dst[cnt[255 - ((u[2 * e + word] >>> sh) & 255)]++] = e; }
    const t = src; src = dst; dst = t;
  }
  if (src !== idx) idx.set(src.subarray(0, n));
  return idx.subarray(0, n);
}

const mulberry = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export const DEFAULT_POLICY = {
  lambda: 3,          // cost of one part, in sub-voxels of net gain (a 1 x 1 plate is 50 sub-voxels)
  core: 0.92,         // core stage: large parts kept only where the fine target fills this fraction of them
  coreCells: 12,      // ... "large" = at least this many cells (2 x 2 brick = 12)
  coreOctave: 2,      // ... ranked on this octave (index into the octaves: 0 = fine)
  lnsIters: 3000,     // ruin-and-recreate iterations (at least: see lnsPasses)
  lnsPasses: 0,       // ... or this many per surface cell when that is more (a round visits one surface cell and its neighbours)
  lnsRadius: 1,       // cleared region: (2 r + 1)^3 cells around a surface cell, plus the parts it touches
  noise: 0.25,        // initial relative noise on the re-pack ranking (cools linearly to 0)
  connect: 150,       // LNS: cost of every extra connected component (parts joined through studs), sub-voxels; 0 = fidelity only
  bridge: 1,          // after the LNS: join the components with single bridging parts, cheapest exact fidelity loss first (0 = off)
  bridgeMax: 4000,    // ... a bridge may cost at most this much net gain (sub-voxels; a 1 x 1 plate is 50)
};

/**
 * Pack. T: target (target.js), fields: coverage octaves [fine, ...], variants: buildVariants(...).list, opts: { phase: [ox, oz] |
 * 'auto', policy, seed, theta, log, progress, snapshot }. Returns { pieces, objective, phase, stats }.
 */
export function pack(T, fields, variants, { phase = 'auto', policy = {}, seed = 1, theta = 0.5, log = () => {}, progress = null, snapshot = null, deficits = null } = {}) {
  const P = { ...DEFAULT_POLICY, ...policy }, rnd = mulberry(seed), t0 = Date.now();
  // per sub-voxel weight 2 (t - theta): theta = 1/2 is the L1 objective; theta = q / (1 + q) is the Dinkelbach step towards the
  // best IoU when the current IoU is q (runBrickpack iterates it)
  const wOf = (t) => { const w = new Float32Array(t.length); for (let i = 0; i < t.length; i++) w[i] = 2 * (t[i] - theta); return w; };
  const w = wOf(fields[0]), wc = fields[Math.min(P.coreOctave, fields.length - 1)] === fields[0] ? w : wOf(fields[Math.min(P.coreOctave, fields.length - 1)]);
  // grid phase: the (ox, oz) whose best 1 x 1 plate cover gains most (an upper bound of what any packing of plates reaches)
  const [ox, oz] = phase === 'auto' ? choosePhase(T, fields[0], P.lambda, theta) : phase;
  const K = cellsOf(T, w, ox, oz), { CX, CY, CZ } = K, box = sat3(K.C, CX, CY, CZ), mixBox = sat3(K.mixed, CX, CY, CZ);
  const boxC = wc === w ? box : sat3(cellsOf(T, wc, ox, oz).C, CX, CY, CZ);
  const NC = CX * CY * CZ, cellIdx = (i, b, j) => (b * CZ + j) * CX + i;
  // ---- 1. candidates (typed arrays): variant, anchor cell, net gain, core score
  let cap = 1 << 20, n = 0, cv = new Int32Array(cap), ca = new Int32Array(cap), cg = new Float32Array(cap), cs = new Float32Array(cap);
  const push = (vi, a, g, s) => { if (n === cap) { cap *= 2; const g2 = (A, B) => { const o = new A.constructor(cap); o.set(A); return o; }; cv = g2(cv); ca = g2(ca); cg = g2(cg); cs = g2(cs); } cv[n] = vi; ca[n] = a; cg[n] = g; cs[n] = s; n++; };
  // deficits: the shaped parts' deficit sums computed elsewhere (a GPU: gpu/*.js), in shapedPairs' order, for this phase and theta
  if (deficits && (deficits.ox !== ox || deficits.oz !== oz || deficits.theta !== theta)) deficits = null;
  let kd = 0;
  variants.forEach((v, vi) => {
    for (let b = 0; b + v.h <= CY; b++) for (let j = 0; j + v.d <= CZ; j++) for (let i = 0; i + v.w <= CX; i++) {
      if (!v.full && mixBox(i, b, j, i + v.w, b + v.h, j + v.d) < 0.5) continue;    // shaped parts only where their box meets the surface
      let g = deficits && !v.full ? box(i, b, j, i + v.w, b + v.h, j + v.d) - deficits.sums[kd++] : gainAt(v, i, j, b, w, T, ox, oz, box);
      const net = g - P.lambda;
      if (net <= 0) continue;
      const cells = v.w * v.d * v.h, core = v.full && cells >= P.coreCells && g >= 2 * (P.core - theta) * v.vol ? boxC(i, b, j, i + v.w, b + v.h, j + v.d) - P.lambda : -Infinity;
      push(vi, cellIdx(i, b, j), net, core);
    }
  });
  if (deficits && kd !== deficits.sums.length) throw new Error(`pack: ${deficits.sums.length} deficit sums for ${kd} shaped placements`);
  const tc = Date.now();
  // ---- placement state
  const occ = new Int32Array(NC).fill(-1), pieces = [];   // pieces[k] = { c (candidate), alive }
  let objective = 0;
  const cellsOfCand = (c, f) => { const v = variants[cv[c]], a = ca[c], i = a % CX, j = ((a / CX) | 0) % CZ, b = (a / (CX * CZ)) | 0; for (let bb = b; bb < b + v.h; bb++) for (let jj = j; jj < j + v.d; jj++) for (let ii = i; ii < i + v.w; ii++) if (f(cellIdx(ii, bb, jj)) === false) return false; return true; };
  const free = (c) => cellsOfCand(c, (q) => occ[q] < 0);
  let aliveN = 0;
  // the alive parts as a dense list (aliveL[0..aliveN), alivePos[k] = slot of part k): connectivity walks these, not every part
  // ever placed (the LNS appends a part per placement, so `pieces` grows to many times the build)
  let aliveL = new Int32Array(1024), alivePos = new Int32Array(1024);
  const aliveAdd = (k) => { if (aliveN === aliveL.length) { const q = new Int32Array(aliveN * 2); q.set(aliveL); aliveL = q; } if (k >= alivePos.length) { const q = new Int32Array(Math.max(k + 1, alivePos.length * 2)); q.set(alivePos); alivePos = q; } alivePos[k] = aliveN; aliveL[aliveN++] = k; };
  const aliveDel = (k) => { const s = alivePos[k], last = aliveL[--aliveN]; aliveL[s] = last; alivePos[last] = s; };
  const place = (c) => { const k = pieces.length; pieces.push({ c, alive: true }); cellsOfCand(c, (q) => { occ[q] = k; }); objective += cg[c]; aliveAdd(k); return k; };
  const remove = (k) => { const p = pieces[k]; p.alive = false; cellsOfCand(p.c, (q) => { occ[q] = -1; }); objective -= cg[p.c]; aliveDel(k); };
  const revive = (k) => { pieces[k].alive = true; cellsOfCand(pieces[k].c, (q) => { occ[q] = k; }); objective += cg[pieces[k].c]; aliveAdd(k); };
  // union-find over part indices with epoch stamps: a reset is O(1) however many parts were ever placed
  let ufPar = new Int32Array(1024), ufStamp = new Int32Array(1024), ufEpoch = 0;
  const ufReset = () => { const m = pieces.length + 1; if (m > ufPar.length) { const n2 = Math.max(m, ufPar.length * 2), a = new Int32Array(n2), b = new Int32Array(n2); a.set(ufPar); b.set(ufStamp); ufPar = a; ufStamp = b; } ufEpoch++; };
  const ufGrow = (m) => { if (m > ufPar.length) { const n2 = Math.max(m, ufPar.length * 2), a = new Int32Array(n2), b = new Int32Array(n2); a.set(ufPar); b.set(ufStamp); ufPar = a; ufStamp = b; } };
  const ufFind = (k) => { if (ufStamp[k] !== ufEpoch) { ufStamp[k] = ufEpoch; ufPar[k] = k; return k; } while (ufPar[k] !== k) { ufPar[k] = ufPar[ufPar[k]]; k = ufPar[k]; } return k; };
  // ---- 2. core (octave-ranked large parts where the fine target is solid), 3. greedy on the fine gain
  const order = (key) => { const o = new Uint32Array(n); for (let k = 0; k < n; k++) o[k] = k; return o.sort((a, b) => key[b] - key[a]); };
  let nCore = 0;
  // the current layout in the app's piece format (i = x cell, j = z cell, b = plate level): the result, and the optional
  // snapshot(stage, pieces) hook that records the search (tools/explain.mjs films it)
  const livePieces = () => {
    const o = [];
    for (const p of pieces) if (p.alive) {
      const v = variants[cv[p.c]], a = ca[p.c];
      o.push({ id: v.id, kind: v.kind, rot: v.rot, w: v.w, d: v.d, h: v.h, i: a % CX, j: ((a / CX) | 0) % CZ, b: (a / (CX * CZ)) | 0, gain: +(cg[p.c] + P.lambda).toFixed(2) });
    }
    return o;
  };
  const snapEvery = snapshot ? Math.max(1, snapshot.every || 1) : 0;
  for (const c of order(cs)) { if (cs[c] === -Infinity) break; if (free(c)) { place(c); nCore++; if (snapshot && nCore % snapEvery === 0) snapshot.fn('core', livePieces()); } }
  if (snapshot) snapshot.fn('core', livePieces());
  const byGain = order(cg);
  { let k = 0; for (const c of byGain) if (free(c)) { place(c); if (snapshot && ++k % snapEvery === 0) snapshot.fn('greedy', livePieces()); } }
  if (snapshot) snapshot.fn('greedy', livePieces());
  const greedyObj = objective, tg = Date.now();
  // connected components of the alive parts (a part is joined to the part sitting on its studs)
  const comps = () => {
    ufReset(); let alive = aliveN;
    for (let s = 0; s < aliveN; s++) {
      const k = aliveL[s], c = pieces[k].c, v = variants[cv[c]], a = ca[c], i = a % CX, j = ((a / CX) | 0) % CZ, top = ((a / (CX * CZ)) | 0) + v.h;
      if (top >= CY) continue;
      // through the part's own studs only (a slope / curve / cheese / tile top holds nothing): the finish's rule (lego/post.js)
      for (const [si, sj] of v.studs) { const u = occ[cellIdx(i + si, top, j + sj)]; if (u >= 0) { const x = ufFind(u), y = ufFind(k); if (x !== y) { ufPar[x] = y; alive--; } } }
    }
    return alive;
  };
  let nComp = P.connect > 0 ? comps() : 0;
  // stud contacts of a placement: the parts under its footprint whose studs it sits on, the parts on its own studs
  const studMask = variants.map((v) => { const m = new Uint8Array(v.w * v.d); for (const [a, c] of v.studs) m[c * v.w + a] = 1; return m; });
  const vOf = (k) => variants[cv[pieces[k].c]], anc = (k) => { const a = ca[pieces[k].c]; return [a % CX, (a / (CX * CZ)) | 0, ((a / CX) | 0) % CZ]; };
  const hasStud = (k, x, z) => { const v = vOf(k), [i, , j] = anc(k); return studMask[cv[pieces[k].c]][(z - j) * v.w + (x - i)] === 1; };
  const touching = (vi, i, j, b, find, out) => {
    const v = variants[vi]; out.clear();
    if (b > 0) for (let jj = j; jj < j + v.d; jj++) for (let ii = i; ii < i + v.w; ii++) { const u = occ[cellIdx(ii, b - 1, jj)]; if (u >= 0 && hasStud(u, ii, jj)) out.add(find(u)); }
    const top = b + v.h; if (top < CY) for (const [si, sj] of v.studs) { const u = occ[cellIdx(i + si, top, j + sj)]; if (u >= 0) out.add(find(u)); }
    return out;
  };
  // union-find over the alive parts through stud contacts (grows as parts are placed)
  const ufUnion = (a, b) => { a = ufFind(a); b = ufFind(b); if (a !== b) ufPar[a] = b; };
  const ufBuild = () => {
    ufReset();
    for (let s = 0; s < aliveN; s++) {
      const k = aliveL[s], v = vOf(k), [i, b, j] = anc(k), top = b + v.h; if (top >= CY) continue;
      for (const [si, sj] of v.studs) { const u = occ[cellIdx(i + si, top, j + sj)]; if (u >= 0) ufUnion(u, k); }
    }
    return { find: ufFind, union: ufUnion, grow: ufGrow };
  };
  const touchSet = new Set();
  // ---- 4. large-neighbourhood search on the surface
  // candidates by anchor (CSR, each list sorted by net gain) for the local re-packs
  const startA = new Int32Array(NC + 1); for (let k = 0; k < n; k++) startA[ca[k] + 1]++; for (let q = 0; q < NC; q++) startA[q + 1] += startA[q];
  const fill = startA.slice(0, NC), byA = new Int32Array(n); for (const c of byGain) byA[fill[ca[c]]++] = c;
  const surf = []; for (let q = 0; q < NC; q++) if (K.mixed[q]) surf.push(q);
  // the anchor lists' variant dims and gains in list order: the gather reads them sequentially
  const byW = new Uint8Array(n), byH = new Uint8Array(n), byD = new Uint8Array(n), byG = new Float64Array(n);
  for (let s = 0; s < n; s++) { const c = byA[s], v = variants[cv[c]]; byW[s] = v.w; byH[s] = v.h; byD[s] = v.d; byG[s] = cg[c]; }
  let accepted = 0, improved = 0; const maxW = Math.max(...variants.map((v) => Math.max(v.w, v.d))), maxH = Math.max(...variants.map((v) => v.h));
  const VW = Int32Array.from(variants, (v) => v.w), VD = Int32Array.from(variants, (v) => v.d), VH = Int32Array.from(variants, (v) => v.h);
  // per round: a summed-area table of the occupied cells around the cleared box (a candidate is free iff its box sums to 0), the
  // options in typed arrays, and the boxes placed by the recreate (checked against the table + these, instead of cell walks)
  let occS = new Int32Array(4096), optC = new Int32Array(4096), optS = new Float64Array(4096), optI = new Int32Array(4096), optBox = new Int16Array(4096 * 6);
  let addI = new Int32Array(256), addB = new Int32Array(256), addJ = new Int32Array(256), addW = new Int32Array(256), addH = new Int32Array(256), addD = new Int32Array(256);
  const iters = P.lnsPasses > 0 ? Math.max(P.lnsIters, Math.round(P.lnsPasses * surf.length)) : P.lnsIters;
  for (let it = 0; it < iters && surf.length; it++) {
    if (progress && it % 100 === 0) progress(it / iters);
    if (snapshot && it % (snapshot.lnsEvery || 200) === 0 && it) snapshot.fn('search', livePieces());
    const temp = P.noise * (1 - it / iters), q0 = surf[(rnd() * surf.length) | 0], r = P.lnsRadius;
    const i0 = q0 % CX, j0 = ((q0 / CX) | 0) % CZ, b0 = (q0 / (CX * CZ)) | 0;
    // ruin: every part with a cell in the region
    const gone = new Set();
    for (let b = Math.max(0, b0 - r); b <= Math.min(CY - 1, b0 + r); b++) for (let j = Math.max(0, j0 - r); j <= Math.min(CZ - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(CX - 1, i0 + r); i++) { const k = occ[cellIdx(i, b, j)]; if (k >= 0) gone.add(k); }
    const before = objective, removed = [...gone];
    let lo = [i0 - r, b0 - r, j0 - r], hi = [i0 + r, b0 + r, j0 + r];
    for (const k of removed) { const c = pieces[k].c, v = variants[cv[c]], a = ca[c], i = a % CX, j = ((a / CX) | 0) % CZ, b = (a / (CX * CZ)) | 0; lo = [Math.min(lo[0], i), Math.min(lo[1], b), Math.min(lo[2], j)]; hi = [Math.max(hi[0], i + v.w - 1), Math.max(hi[1], b + v.h - 1), Math.max(hi[2], j + v.d - 1)]; remove(k); }
    // recreate: candidates anchored in the cleared box (and up to one part size before it), randomised ranking, greedy
    const ia0 = Math.max(0, lo[0] - maxW + 1), ia1 = Math.min(CX - 1, hi[0]), ba0 = Math.max(0, lo[1] - maxH + 1), ba1 = Math.min(CY - 1, hi[1]), ja0 = Math.max(0, lo[2] - maxW + 1), ja1 = Math.min(CZ - 1, hi[2]);
    // occupancy table over every cell a candidate anchored there can reach
    const ox0 = ia0, oy0 = ba0, oz0 = ja0, ox1 = Math.min(CX - 1, ia1 + maxW - 1), oy1 = Math.min(CY - 1, ba1 + maxH - 1), oz1 = Math.min(CZ - 1, ja1 + maxW - 1);
    const sx = ox1 - ox0 + 2, sy = oy1 - oy0 + 2, sz = oz1 - oz0 + 2;
    if (sx * sy * sz > occS.length) occS = new Int32Array(sx * sy * sz * 2);
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const o = (y * sz + z) * sx + x;
      if (x === 0 || y === 0 || z === 0) { occS[o] = 0; continue; }
      occS[o] = (occ[cellIdx(ox0 + x - 1, oy0 + y - 1, oz0 + z - 1)] >= 0 ? 1 : 0) + occS[o - 1] + occS[o - sx] + occS[o - sx * sz] - occS[o - 1 - sx] - occS[o - 1 - sx * sz] - occS[o - sx - sx * sz] + occS[o - 1 - sx - sx * sz];
    }
    let nOpt = 0; const szx = sz * sx;
    for (let b = ba0; b <= ba1; b++) for (let j = ja0; j <= ja1; j++) for (let i = ia0; i <= ia1; i++) {
      const a = cellIdx(i, b, j), s0 = startA[a], s1 = startA[a + 1];
      if (s0 === s1 || occ[a] >= 0) continue;            // an occupied anchor cell: no candidate anchored here is free
      const x0 = i - ox0, y0 = b - oy0, z0 = j - oz0;
      // free runs from the anchor along x, y, z: a longer box hits an occupied cell (cheap reject before the table)
      let rx = 1, ry = 1, rz = 1;
      while (i + rx < CX && rx < maxW && occ[a + rx] < 0) rx++;
      while (j + rz < CZ && rz < maxW && occ[a + rz * CX] < 0) rz++;
      while (b + ry < CY && ry < maxH && occ[a + ry * CX * CZ] < 0) ry++;
      for (let s = s0; s < s1; s++) {
        const w = byW[s], h = byH[s], d = byD[s];
        if (w > rx || h > ry || d > rz) continue;
        const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
        // occupied cells in the candidate's box (summed-area table, inlined)
        const n = occS[y1 * szx + z1 * sx + x1] - occS[y0 * szx + z1 * sx + x1] - occS[y1 * szx + z0 * sx + x1] - occS[y1 * szx + z1 * sx + x0]
          + occS[y0 * szx + z0 * sx + x1] + occS[y0 * szx + z1 * sx + x0] + occS[y1 * szx + z0 * sx + x0] - occS[y0 * szx + z0 * sx + x0];
        if (n !== 0) continue;
        if (nOpt === optC.length) { const g2 = (A, m = 1) => { const o = new A.constructor(nOpt * 2 * m); o.set(A); return o; }; optC = g2(optC); optS = g2(optS); optI = g2(optI); optBox = g2(optBox, 6); }
        const o6 = 6 * nOpt; optBox[o6] = i; optBox[o6 + 1] = b; optBox[o6 + 2] = j; optBox[o6 + 3] = i + w; optBox[o6 + 4] = b + h; optBox[o6 + 5] = j + d;
        optC[nOpt] = byA[s]; optS[nOpt] = byG[s] * (1 + temp * (rnd() * 2 - 1)); nOpt++;
      }
    }
    // by score, best first; ties keep the gathering order (what the stable array sort did)
    if (optI.length < optC.length) optI = new Int32Array(optC.length);
    const ord = sortByScore(optI, optS, nOpt);
    const added = []; let nAdd = 0;
    // every option was free when the round started (the table): it is still free iff it misses what this recreate placed
    const freeNow = (o) => {
      const o6 = 6 * o, i = optBox[o6], b = optBox[o6 + 1], j = optBox[o6 + 2], i1 = optBox[o6 + 3], b1 = optBox[o6 + 4], j1 = optBox[o6 + 5];
      for (let q = 0; q < nAdd; q++) if (i < addI[q] + addW[q] && addI[q] < i1 && b < addB[q] + addH[q] && addB[q] < b1 && j < addJ[q] + addD[q] && addJ[q] < j1) return false;
      return true;
    };
    const note = (c) => {
      if (nAdd === addI.length) { const g2 = (A) => { const o = new Int32Array(nAdd * 2); o.set(A); return o; }; addI = g2(addI); addB = g2(addB); addJ = g2(addJ); addW = g2(addW); addH = g2(addH); addD = g2(addD); }
      const vi = cv[c], a = ca[c]; addI[nAdd] = a % CX; addJ[nAdd] = ((a / CX) | 0) % CZ; addB[nAdd] = (a / (CX * CZ)) | 0; addW[nAdd] = VW[vi]; addH[nAdd] = VH[vi]; addD[nAdd] = VD[vi]; nAdd++;
    };
    if (P.connect > 0) {
      // a part that would stand alone (touching no other part through studs) must pay for the component it adds
      const uf = ufBuild();
      for (let q = 0; q < nOpt; q++) {
        const o = ord[q], c = optC[o];
        if (!freeNow(o)) continue;
        const a = ca[c], i = a % CX, j = ((a / CX) | 0) % CZ, b = (a / (CX * CZ)) | 0, roots = touching(cv[c], i, j, b, uf.find, touchSet);
        if (roots.size === 0 && cg[c] <= P.connect && aliveN > 0) continue;
        const k = place(c); added.push(k); note(c); uf.grow(k + 1); for (const r of roots) uf.union(r, k);
      }
    } else for (let q = 0; q < nOpt; q++) { const o = ord[q], c = optC[o]; if (freeNow(o)) { added.push(place(c)); note(c); } }
    let delta = objective - before, nc = nComp;
    if (P.connect > 0) { nc = comps(); delta -= P.connect * (Math.max(0, nc - 1) - Math.max(0, nComp - 1)); }   // the first piece is free: an empty build earns nothing
    if (delta >= -1e-9) { accepted++; if (delta > 1e-6) improved++; nComp = nc; }
    else { for (const k of added) remove(k); for (const k of removed) revive(k); }
  }
  // ---- 5. bridges. The LNS only ever places parts that pay for themselves, so it cannot join two components across a gap of
  // low coverage. Here any placement may be used: a part whose studs carry a part of one component and that sits on the studs
  // of another (or carries / sits on two) joins them, at the price of its exact net gain (often negative: volume outside the
  // mesh). The cheapest bridge per merged component is placed, repeatedly; what is still apart is left to the weld (lego/post.js).
  let bridges = 0, bridgeCost = 0, pruned = 0, prunedGain = 0;
  if (P.bridge > 0) {
    for (let round = 0; round < 400; round++) {
      const m = pieces.length, uf = ufBuild(), val = new Map(), members = new Map();
      for (let k = 0; k < m; k++) if (pieces[k].alive) { const r = uf.find(k); val.set(r, (val.get(r) || 0) + cg[pieces[k].c]); (members.get(r) || members.set(r, []).get(r)).push(k); }
      if (val.size <= 1) break;
      const main = [...val].sort((x, y) => y[1] - x[1])[0][0], seen = new Set();
      let best = null;
      const tryAt = (vi, i, j, b) => {
        const v = variants[vi];
        if (i < 0 || j < 0 || b < 0 || i + v.w > CX || j + v.d > CZ || b + v.h > CY) return;
        const key = vi * NC + cellIdx(i, b, j); if (seen.has(key)) return; seen.add(key);
        for (let bb = b; bb < b + v.h; bb++) for (let jj = j; jj < j + v.d; jj++) for (let ii = i; ii < i + v.w; ii++) if (occ[cellIdx(ii, bb, jj)] >= 0) return;
        const roots = touching(vi, i, j, b, uf.find, touchSet); if (roots.size < 2) return;
        const g = gainAt(v, i, j, b, w, T, ox, oz, box) - P.lambda, cost = -g / (roots.size - 1);
        if (-g > P.bridgeMax) return;
        if (!best || cost < best.cost) best = { vi, i, j, b, g, cost };
      };
      for (const [r, ks] of members) {
        if (r === main) continue;
        for (const k of ks) {
          const v = vOf(k), [i, b, j] = anc(k), top = b + v.h;
          variants.forEach((u, vi) => {
            for (const [si, sj] of v.studs) for (let dj = 0; dj < u.d; dj++) for (let di = 0; di < u.w; di++) tryAt(vi, i + si - di, j + sj - dj, top);   // on k's studs
            for (const [si, sj] of u.studs) for (let dj = 0; dj < v.d; dj++) for (let di = 0; di < v.w; di++) tryAt(vi, i + di - si, j + dj - sj, b - u.h);   // under k
          });
        }
      }
      // the cheapest component to drop (worth less than a bridge and than welding it: `connect`)
      let drop = null; for (const [r, x] of val) if (r !== main && x < P.connect && (!drop || x < drop[1])) drop = [r, x];
      if (drop && (!best || drop[1] < best.cost)) { for (const k of members.get(drop[0])) remove(k); pruned += members.get(drop[0]).length; prunedGain += drop[1]; continue; }
      if (!best) break;
      push(best.vi, cellIdx(best.i, best.b, best.j), best.g, -Infinity);       // a bridge is outside the candidate list: a slot of its own
      place(n - 1); bridges++; bridgeCost += -best.g;
    }
  }
  // ---- 6. guarantee zero floating pieces / single stud-connected component when connect > 0
  if (P.connect > 0 && P.enforceSingleComponent !== false && aliveN > 0) {
    const uf = ufBuild(), val = new Map(), members = new Map(), minB = new Map();
    for (let s = 0; s < aliveN; s++) {
      const k = aliveL[s], r = uf.find(k), b = anc(k)[1];
      val.set(r, (val.get(r) || 0) + cg[pieces[k].c]);
      minB.set(r, Math.min(minB.get(r) ?? Infinity, b));
      (members.get(r) || members.set(r, []).get(r)).push(k);
    }
    if (val.size > 1) {
      const globalMinB = Math.min(...minB.values());
      const main = [...val].sort((x, y) => {
        const ga = minB.get(x[0]) === globalMinB ? 1 : 0, gb = minB.get(y[0]) === globalMinB ? 1 : 0;
        return gb - ga || y[1] - x[1];
      })[0][0];
      for (const [r, ks] of members) if (r !== main) {
        for (const k of ks) remove(k);
        pruned += ks.length;
        prunedGain += val.get(r);
      }
    }
  }
  // ---- result in the app's piece format (i = x cell, j = z cell, b = plate level)
  const out = livePieces();
  const stats = { candidates: n, surfaceCells: surf.length, lnsIters: iters, core: nCore, greedy: +greedyObj.toFixed(1), objective: +objective.toFixed(1), lnsAccepted: accepted, lnsImproved: improved,
    components: comps(), bridges, bridgeCost: +bridgeCost.toFixed(1), pruned, prunedGain: +prunedGain.toFixed(1), ms: { candidates: tc - t0, greedy: tg - tc, lns: Date.now() - tg } };
  log(`pack: phase ${ox},${oz} · ${n.toLocaleString()} candidates (${tc - t0} ms) · core ${nCore} · greedy ${greedyObj.toFixed(0)} -> LNS ${objective.toFixed(0)} (${improved}/${iters} improving, ${Date.now() - tg} ms) · ${out.length} parts`);
  return { pieces: out, objective, phase: [ox, oz], stats, policy: P, theta };
}

/**
 * The search on the soft IoU (what the metric reports, and what stays meaningful at any scale). Dinkelbach: pack with the
 * per sub-voxel weight 2 (t - theta), measure the IoU q, set theta = q / (1 + q), repeat with short searches until theta
 * settles, then one full search at the best theta. objective 'l1' = theta 1/2 once (the L1 volume error; at a few studs it can
 * leave a thin model empty: no part is more than half inside it). measure(pieces, phase) -> soft IoU. Returns { r (pack's result), iou, theta, trace } for the best pack on the measured IoU.
 */
function* packIoUSteps(T, F, list, { policy = {}, objective = 'iou', thetaIters = 4, thetaLns = 300, seed = 1, phase = null, measure, log = () => {}, progress = () => {} } = {}) {
  const P = { ...DEFAULT_POLICY, ...policy }, steps = objective === 'iou' ? thetaIters : 0;
  // the bar: the IoU-weight steps share the first 30 %, the final search the rest
  function* run(theta, pol, label, f0, f1) {
    const ph = phase || choosePhase(T, F[0], pol.lambda, theta);
    // a GPU may supply the shaped parts' deficit sums for this phase and theta (packIoUAsync); null = the CPU computes them
    const deficits = yield { theta, phase: ph };
    const r = pack(T, F, list, { phase: ph, policy: pol, seed, theta, log, deficits, progress: (f) => progress(label, f0 + f * (f1 - f0)) });
    return { r, iou: measure(r.pieces, r.phase), theta };
  }
  // the short searches: thetaLns rounds, or 1/8 of the final search's rounds per surface cell
  const short = { ...P, lnsIters: Math.min(P.lnsIters, thetaLns), lnsPasses: P.lnsPasses > 0 ? P.lnsPasses / 8 : 0 };
  let theta = 0.5, best = null; const trace = [];
  for (let it = 0; it < steps; it++) {
    const x = yield* run(theta, short, `finding the IoU weight (step ${it + 1})`, (0.3 * it) / steps, (0.3 * (it + 1)) / steps); trace.push([+theta.toFixed(4), +x.iou.toFixed(4)]);
    if (!best || x.iou > best.iou) best = x;
    const next = x.iou / (1 + x.iou);
    if (Math.abs(next - theta) < 0.005) break;
    theta = next;
  }
  if (best) theta = best.theta;
  const fin = yield* run(theta, P, 'packing the parts', steps ? 0.3 : 0, 1); trace.push([+theta.toFixed(4), +fin.iou.toFixed(4)]);
  if (!best || fin.iou >= best.iou) best = fin;
  return { ...best, trace };
}

export function packIoU(T, F, list, opts = {}) {
  const it = packIoUSteps(T, F, list, opts);
  let x = it.next();
  while (!x.done) x = it.next(null);
  return x.value;
}

/**
 * packIoU with the candidates' deficit sums on `gpu` (gpu/index.js; the CPU computes them if it fails). The table of deficit
 * offsets is built once per field shape.
 */
export async function packIoUAsync(T, F, list, opts = {}) {
  const { gpu = null, log = () => {} } = opts, it = packIoUSteps(T, F, list, opts);
  let x = it.next(), table = null, useGpu = !!gpu;
  while (!x.done) {
    let deficits = null;
    if (useGpu) {
      try {
        const { theta, phase: [ox, oz] } = x.value, t = F[0], w = new Float32Array(t.length);
        for (let i = 0; i < t.length; i++) w[i] = 2 * (t[i] - theta);
        table ||= packDeficits(list, T.X, T.Z, deficitRel);
        const pairs = shapedPairs(T, list, w, ox, oz);
        deficits = { ox, oz, theta, sums: await gpu.deficitSums(w, table, pairs) };
      } catch (e) { log(`gpu: deficit sums failed, on the CPU from now on (${(e && e.message) || e})`); useGpu = false; deficits = null; }
    }
    x = it.next(deficits);
  }
  return x.value;
}
