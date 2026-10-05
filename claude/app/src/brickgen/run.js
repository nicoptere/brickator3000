// One solve of the prepared field at one grid phase: skin -> fill -> relaxed -> fallback -> thin features.
import { G, PAD, STUD } from './constants.js';
import { window, symmetrize } from './grid.js';
import { placeDiscs } from './discs.js';
import { placeProfiles } from './skin.js';
import { mirrorMask } from './islands.js';
import { partVariants, pieceVariant } from './variants.js';
import { Solver } from './solver.js';
import { motifVariants } from '../motifs/library.js';
import { snotVariants } from '../motifs/snot.js';
import { wallSkin } from '../motifs/wall.js';

export function solve(pre, cat, ox, oz, o, log = () => {}, onPhase = null) {
  const S = solverFor(pre, cat, ox, oz, o, log, onPhase);
  return o.noPhases ? S : runPhases(S, pre, cat, ox, oz, o, log, onPhase);
}

/** the solver over this field, with no piece placed yet (the setup half of `solve`) */
export function solverFor(pre, cat, ox, oz, o, log = () => {}, onPhase = null) {
  const win = window(pre, ox, oz); let M = win.arr; const nxc = win.nxc, nzc = win.nzc, nl = pre.nl;
  const NZ = nzc * G, NX = nxc * G;
  // fieldCascade: the broad phases (motifs, rounds, skin, fill) see the coarse field - the SDF filtered harder - and the detail
  // phases (relaxed, fallback, thin, tube) the sharp one; the solver swaps targets in between and keeps what it placed
  const Msharp = o.fieldCascade && pre.Mcoarse ? M : null;
  if (Msharp) M = window(pre, ox, oz, 'Mcoarse').arr;
  let mirror = null, plane = 0;
  if (pre.mirror) {
    const off = pre.mirror.ax === 0 ? ox : oz;
    plane = Math.round(2 * (pre.mirror.planePadded - (PAD - off)) / STUD);
    // symField: average the volume field with its mirror (halves the sampling noise on thin features)
    // symTwins: every placed piece also places its mirror twin. Both default on; they are separable for analysis (docs/MOTIFS.md).
    if (o.symField !== false) M = symmetrize(M, nl, NZ, NX, pre.mirror.ax, plane);
    if (o.symTwins !== false) mirror = [pre.mirror.ax === 0 ? 'x' : 'z', plane];
  }
  const S = new Solver(M, nl, NZ, NX, o, mirror); S.log = log; S.onPhase = onPhase; S.Msharp = Msharp;
  if (pre.Mfull) { let F = window(pre, ox, oz, 'Mfull').arr; if (pre.mirror && o.symField !== false) F = symmetrize(F, nl, NZ, NX, pre.mirror.ax, plane); S.Mfull = F; }   // hollow core: the full solid, so filling the core is not counted as overfill
  S.nxc = nxc; S.nzc = nzc; S.win = { nxc, nzc, nl, NZ, NX, plane: pre.mirror ? plane : 0 };
  S.dims = [nxc, nzc, nl];      // geometry, not a result: a region rebuild builds the solver without running the phases
  return S;
}

/** the phases, over a solver that may already hold pieces (a region edit adopts the ones outside the box first) */
export function runPhases(S, pre, cat, ox, oz, o, log = () => {}, onPhase = null) {
  const { nxc, nzc, nl, NZ, NX } = S.win;
  const mirror = S.mirror, plane = S.win.plane;
  const Msharp = S.Msharp;
  const tb = o.technic ? { technic: 0.02 } : {};
  const withBonus = (t, extra) => ({ ...t, bonus: { ...(t.bonus || {}), ...extra } });
  // the sideways skin first (motifs/wall.js): the remaining field seen from each horizontal facing as if that facing were up,
  // the narrow aligned skin run there, its pieces turned into sideways parts on side-stud host bricks. Only where the surface
  // is steep (the upright skin's slopes stop at ~65 degrees) and the cells are partial (a wall on the stud lattice is a
  // brick's face already); it goes before the disc layers and the upright skin, which would otherwise pave the steep belt
  // with the rim plates the sideways parts are meant to replace
  if (o.wall) { onPhase && onPhase('W-wall', 0); S.wall = wallSkin(S, cat, o, log, onPhase); }
  // disc layers first (discs.js): a level whose cross-section is a rounded blob is laid as rows of plates, alternating direction
  // per level - the sphere / round-top recipe - before the mined assemblies and the single parts get to it
  if (o.discs) { onPhase && onPhase('A1-disc', 0); const d = placeDiscs(S, cat, partVariants(cat, new Set(['plate'])), o, log); log(`phase A1-disc: ${d.layers} disc layers, ${d.pieces} plates`); }   // circular cross-sections as rows of plates (discs.js)
  // profile chains (skin.js): the sloped skin as rows of 1-wide parts chosen per row, before the assemblies and the greedy skin
  if (o.profiles && o.skin) {
    const kinds = new Set(['slope', 'curved', 'cheese']); if (o.inverted) kinds.add('inverted');
    placeProfiles(S, partVariants(cat, kinds), o, log);
  }
  // broad phase: assemblies mined from human-built models (several parts at once), before any single part is considered
  if (o.motifs) { onPhase && onPhase('M-lib', 0); const lib = motifVariants(cat, o); S.runPhase(S.attachMirrors(lib.variants), o.motifTol, 'M-motif'); }   // the library build is the slow half: announce it separately
  // the round family before or after the sloped skin (docs/CURVES.md round 7): on a model whose top surface is mostly sloped
  // (an animal, a dome) the slopes have priority and the quarter-round plates take what they leave; on a model of flat tops and
  // vertical walls (a table, a rounded box) the round family goes first, as before. 'auto' decides by the sloped share of the top
  // surface (`roundsSlopedShare`); true / false force one order.
  const roundPhase = () => { if (o.rounds) S.runPhase(S.attachMirrors(partVariants(cat, new Set(['round']))), o.roundTol, 'A0-round'); };
  let roundsAfter = o.roundsAfterSkin === true;
  if (o.roundsAfterSkin === 'auto' || o.roundsAfterSkin === undefined) {
    const g = S.gradients().top; let sloped = 0, tops = 0;
    for (let cz = 0; cz < nzc; cz++) for (let cx = 0; cx < nxc; cx++) {
      let has = false; for (let l = nl - 1; l >= 0 && !has; l--) for (let dz = 0; dz < G && !has; dz++) for (let dx = 0; dx < G; dx++) if (S.M0[S.idx(l, cz * G + dz, cx * G + dx)] > 0.05) { has = true; break; }
      if (!has) continue; tops++; if (Math.hypot(g.gx[cz * nxc + cx], g.gz[cz * nxc + cx]) >= 0.07) sloped++;
    }
    roundsAfter = tops > 0 && sloped / tops >= (o.roundsSlopedShare ?? 0.5);
    log(`round family ${roundsAfter ? 'after' : 'before'} the skin: ${(100 * sloped / Math.max(1, tops)).toFixed(0)} % of the top surface is sloped`);
  }
  if (!roundsAfter) roundPhase();
  if (o.skin) {
    const kinds = new Set(['slope', 'curved', 'cheese', 'tile']); if (o.inverted) kinds.add('inverted');
    const skinV = partVariants(cat, kinds);
    // the 1-stud-wide skin parts first (docs/CURVES.md): they alone fit a doubly curved surface, where a 2-wide part fails on its
    // cross slope; with the alignment term (solver.align) they come out in rows along the fall line, and post.widen fuses the
    // pairs that sit side by side back into the 2-wide parts
    // (core parts only: letting the extended 1-wide parts in - even only the monotonic ones - halves the skin coverage, duck stairs 19 -> 45 %)
    if (o.skinNarrow) S.runPhase(S.attachMirrors(skinV.filter((v) => (v.w === 1 || v.d === 1) && !v.c.ext)), o.skinTol, 'A-skin-narrow');
    // core slopes / inverted slopes first, so the extended shapes only fill what they leave (never crowd them out)
    S.runPhase(S.attachMirrors(skinV.filter((v) => !v.c.ext)), o.skinTol, 'A-skin');
    if (skinV.some((v) => v.c.ext)) S.runPhase(S.attachMirrors(skinV.filter((v) => v.c.ext)), o.skinTol, 'A2-skin-ext');
  }
  if (roundsAfter) roundPhase();
  // the sideways skin (motifs/wall.js): the remaining field seen from each horizontal facing as if that facing were up, the
  // narrow aligned skin run there, its pieces turned into sideways parts on side-stud host bricks. After the upright skin
  // (it takes only what no upright part explained) and before the fill (which builds around the hosts)
  // sideways parts on side studs (motifs/snot.js): every catalogue part of a footprint that an official set hung on a headlight
  // brick / side-stud brick / bracket, as one rigid assembly with its host - a disc on a wall, a curved slope rounding a
  // vertical edge. After the upright skin, before the fill: they take only what no upright part explained
  if (o.snot) { const sv = snotVariants(cat, o); S.runPhase(S.attachMirrors(sv.variants), o.snotTol, 'S-snot'); }
  const flat = new Set(['brick', 'plate', 'shaped']); if (o.technic) flat.add('technic');
  const solid = S.attachMirrors(partVariants(cat, flat));
  S.runPhase(solid, withBonus(o.fillTol, tb), 'B-fill');
  if (o.fill2) S.runPhase(solid, withBonus(o.fill2Tol, tb), 'B2-fill');
  if (Msharp) { S.setField(pre.mirror && o.symField !== false ? symmetrize(Msharp, nl, NZ, NX, pre.mirror.ax, plane) : Msharp); log('cascade: detail phases on the sharp field'); }
  if (o.relaxed) S.runPhase(S.attachMirrors(partVariants(cat, new Set(['plate', 'tile', 'brick'])).filter((v) => v.h === 1)), o.relaxedTol, 'C-relaxed');
  const one = S.attachMirrors(partVariants(cat, new Set(['plate'])).filter((v) => v.c.id === '3024'))[0];
  const any_ = { min_cov: 0, max_err: 1, piece_pen: 0 }, any = any_;
  const NZc = nzc, NXc = nxc, cell = (l, z, x) => (l * NZc + z) * NXc + x;
  if (o.fallback) {
    onPhase && onPhase('D-fallback', 0);
    const F = S.leftoverCells(); let n1 = 0;
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZc; z++) for (let x = 0; x < NXc; x++) {
      if (F[cell(l, z, x)] < o.fallbackMin || !S.fits(l, z, x, 1, 1, 1)) continue;
      const r = S.evaluate(one, l, z, x, any); if (r) { S.place(one, l, z, x, r[1], r[2], 'D-fallback'); n1++; }
    }
    log(`phase D-fallback 1x1: ${n1}`);
  }
  if (o.thin) {
    onPhase && onPhase('E-thin', 0);
    const F = S.leftoverCells(), F0 = S.leftoverCells(S.M0);
    const P = window(pre, ox, oz, 'P').arr;
    const big = new Uint8Array(F0.length); for (let k = 0; k < F0.length; k++) big[k] = F0[k] >= 0.2 ? 1 : 0;
    const nearBig = (l, z, x) => {
      for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const L = l + a, Z = z + b, X = x + c;
        if (L >= 0 && L < nl && Z >= 0 && Z < NZc && X >= 0 && X < NXc && big[cell(L, Z, X)]) return true;
      }
      return false;
    };
    let n2 = 0;
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZc; z++) for (let x = 0; x < NXc; x++) {
      const f = F[cell(l, z, x)];
      let thin = f >= o.thinBand[0] && f < o.thinBand[1];
      if (!thin && F0[cell(l, z, x)] < 0.1 && o.thinPoints > 0) {
        let pc = 0;
        for (let dz = 0; dz < G; dz++) for (let dx = 0; dx < G; dx++) pc += P[(l * NZ + z * G + dz) * NX + x * G + dx];
        thin = pc >= o.thinPoints && !nearBig(l, z, x);
      }
      if (!thin || !S.fits(l, z, x, 1, 1, 1)) continue;
      const r = S.evaluate(one, l, z, x, any); if (r) { S.place(one, l, z, x, r[1], r[2], 'E-thin'); n2++; }
    }
    log(`phase E-thin 1x1: ${n2}`);
  }
  if (pre.T) {                                   // forced tube cells (MST between the islands of the source volume)
    onPhase && onPhase('F-tube', 0);
    let Tm = window(pre, ox, oz, 'T').arr;
    if (mirror) Tm = mirrorMask(Tm, nl, NZ, NX, mirror[0] === 'x' ? 0 : 2, mirror[1], G);
    let nt = 0;
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZc; z++) for (let x = 0; x < NXc; x++) {
      let any = false;
      for (let dz = 0; dz < G && !any; dz++) { const base = (l * NZ + z * G + dz) * NX + x * G; for (let dx = 0; dx < G; dx++) if (Tm[base + dx]) { any = true; break; } }
      if (!any || !S.fits(l, z, x, 1, 1, 1)) continue;
      const r = S.evaluate(one, l, z, x, any_);
      if (r) { S.place(one, l, z, x, r[1], r[2], 'F-tube'); nt++; }
    }
    log(`phase F-tube 1x1: ${nt}`);
  }
  return S;
}

/**
 * surface regularity (docs/CURVES.md): of the sample columns whose top (or underside) surface slopes between 20 and 75 degrees,
 * the share covered by a flat part - a plate, brick or tile step where a slope / curved part was wanted. 0 = every sloped
 * column is skinned by a shaped part, 1 = all stairs. `stairs` for the top surface, `under` for the undersides.
 */
export function surface(S, cat) {
  const NL = S.NL, NZ = S.NZs, NX = S.NXs, F = S.Mfull || S.M0, g = S.gradients();
  const vars = partVariants(cat.map((c) => ({ ...c, noSolo: false })), new Set(cat.map((c) => c.kind))), byId = new Map(); for (const v of vars) (byId.get(v.c.id) || byId.set(v.c.id, []).get(v.c.id)).push(v);   // every part, the motif-only ones too
  const SHAPED = new Set(['slope', 'curved', 'cheese', 'inverted', 'wedge', 'round', 'shaped']);
  const topK = new Int8Array(NZ * NX).fill(-1), topH = new Float32Array(NZ * NX).fill(-1), botK = new Int8Array(NZ * NX).fill(-1), botH = new Float32Array(NZ * NX).fill(1e9);
  for (const p of S.pieces) {
    if (p.snot) continue; const v = pieceVariant(p, vars, byId); if (!v) continue;
    const pz = v.d * G, px = v.w * G, sh = SHAPED.has(p.kind) ? 1 : 0;
    for (let z = 0; z < pz; z++) for (let x = 0; x < px; x++) {
      const Z = p.j * G + z, X = p.i * G + x; if (Z < 0 || X < 0 || Z >= NZ || X >= NX) continue; const q = Z * NX + X;
      for (let l = v.h - 1; l >= 0; l--) { const vv = v.V[(l * pz + z) * px + x]; if (vv > 0.05) { const t = p.b + l + vv; if (t > topH[q]) { topH[q] = t; topK[q] = sh; } break; } }
      for (let l = 0; l < v.h; l++) { const vv = v.V[(l * pz + z) * px + x]; if (vv > 0.05) { const t = p.b + l + 1 - vv; if (t < botH[q]) { botH[q] = t; botK[q] = sh; } break; } }
    }
  }
  // the field's top / bottom surface slope per sample column, from the solver's stud-cell gradients (plates / sample; tan 20 = .091, tan 75 = .93)
  const Xc = S.NXc;
  let cols = 0, flat = 0, bcols = 0, bflat = 0;
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const q = z * NX + x, c = ((z / G) | 0) * Xc + ((x / G) | 0);
    let top = -1, bot = -1; for (let l = NL - 1; l >= 0; l--) { const m = F[S.idx(l, z, x)]; if (m > 0.05) { top = l + m; break; } } if (top < 0) continue;
    for (let l = 0; l < NL; l++) { const m = F[S.idx(l, z, x)]; if (m > 0.05) { bot = l + 1 - m; break; } }
    const gt = Math.hypot(g.top.gx[c], g.top.gz[c]), gb = Math.hypot(g.bot.gx[c], g.bot.gz[c]);
    if (gt >= 0.091 && gt < 0.93) { cols++; if (topK[q] !== 1) flat++; }
    if (gb >= 0.091 && gb < 0.93 && bot > 0.3) { bcols++; if (botK[q] !== 1) bflat++; }
  }
  return { stairs: cols ? flat / cols : 0, stairsCols: cols, under: bcols ? bflat / bcols : 0, underCols: bcols };
}

export function metrics(S) {
  let matched = 0, total = 0, over = 0;
  const F = S.Mfull || S.M0;
  for (let k = 0; k < S.M0.length; k++) { const m = S.M0[k], c = S.C[k], f = F[k]; matched += Math.min(m, c); total += m; if (c > f) over += c - f; }
  const kinds = {}, ids = {};
  for (const p of S.pieces) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; ids[p.id] = (ids[p.id] || 0) + 1; }
  return { pieces: S.pieces.length, recall: matched / total, overfill: over / total, iou: matched / (total + over), kinds, ids,
    fallback: S.pieces.filter((p) => p.phase === 'D-fallback').length };
}
