// One solve of the prepared field at one grid phase: skin -> fill -> relaxed -> fallback -> thin features.
import { G, PAD, STUD } from './constants.js';
import { window, symmetrize } from './grid.js';
import { mirrorMask } from './islands.js';
import { partVariants } from './variants.js';
import { Solver } from './solver.js';
import { motifVariants } from '../motifs/library.js';

export function solve(pre, cat, ox, oz, o, log = () => {}) {
  const win = window(pre, ox, oz); let M = win.arr; const nxc = win.nxc, nzc = win.nzc, nl = pre.nl;
  const NZ = nzc * G, NX = nxc * G;
  let mirror = null, plane = 0;
  if (pre.mirror) {
    const off = pre.mirror.ax === 0 ? ox : oz;
    plane = Math.round(2 * (pre.mirror.planePadded - (PAD - off)) / STUD);
    // symField: average the volume field with its mirror (halves the sampling noise on thin features)
    // symTwins: every placed piece also places its mirror twin. Both default on; they are separable for analysis (docs/MOTIFS.md).
    if (o.symField !== false) M = symmetrize(M, nl, NZ, NX, pre.mirror.ax, plane);
    if (o.symTwins !== false) mirror = [pre.mirror.ax === 0 ? 'x' : 'z', plane];
  }
  const S = new Solver(M, nl, NZ, NX, o, mirror); S.log = log;
  if (pre.Mfull) { let F = window(pre, ox, oz, 'Mfull').arr; if (pre.mirror && o.symField !== false) F = symmetrize(F, nl, NZ, NX, pre.mirror.ax, plane); S.Mfull = F; }   // hollow core: the full solid, so filling the core is not counted as overfill
  S.nxc = nxc; S.nzc = nzc;
  const tb = o.technic ? { technic: 0.02 } : {};
  const withBonus = (t, extra) => ({ ...t, bonus: { ...(t.bonus || {}), ...extra } });
  // broad phase: assemblies mined from human-built models (several parts at once), before any single part is considered
  if (o.motifs) { const lib = motifVariants(cat, o); S.runPhase(S.attachMirrors(lib.variants), o.motifTol, 'M-motif'); }
  if (o.rounds) S.runPhase(S.attachMirrors(partVariants(cat, new Set(['round']))), o.roundTol, 'A0-round');
  if (o.skin) {
    const kinds = new Set(['slope', 'curved', 'cheese', 'tile']); if (o.inverted) kinds.add('inverted');
    const skinV = partVariants(cat, kinds);
    // core slopes / inverted slopes first, so the extended shapes only fill what they leave (never crowd them out)
    S.runPhase(S.attachMirrors(skinV.filter((v) => !v.c.ext)), o.skinTol, 'A-skin');
    if (skinV.some((v) => v.c.ext)) S.runPhase(S.attachMirrors(skinV.filter((v) => v.c.ext)), o.skinTol, 'A2-skin-ext');
  }
  const flat = new Set(['brick', 'plate', 'shaped']); if (o.technic) flat.add('technic');
  const solid = S.attachMirrors(partVariants(cat, flat));
  S.runPhase(solid, withBonus(o.fillTol, tb), 'B-fill');
  if (o.fill2) S.runPhase(solid, withBonus(o.fill2Tol, tb), 'B2-fill');
  if (o.relaxed) S.runPhase(S.attachMirrors(partVariants(cat, new Set(['plate', 'tile', 'brick'])).filter((v) => v.h === 1)), o.relaxedTol, 'C-relaxed');
  const one = S.attachMirrors(partVariants(cat, new Set(['plate'])).filter((v) => v.c.id === '3024'))[0];
  const any_ = { min_cov: 0, max_err: 1, piece_pen: 0 }, any = any_;
  const NZc = nzc, NXc = nxc, cell = (l, z, x) => (l * NZc + z) * NXc + x;
  if (o.fallback) {
    const F = S.leftoverCells(); let n1 = 0;
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZc; z++) for (let x = 0; x < NXc; x++) {
      if (F[cell(l, z, x)] < o.fallbackMin) continue;
      const r = S.evaluate(one, l, z, x, any); if (r) { S.place(one, l, z, x, r[1], r[2], 'D-fallback'); n1++; }
    }
    log(`phase D-fallback 1x1: ${n1}`);
  }
  if (o.thin) {
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
      if (!thin) continue;
      const r = S.evaluate(one, l, z, x, any); if (r) { S.place(one, l, z, x, r[1], r[2], 'E-thin'); n2++; }
    }
    log(`phase E-thin 1x1: ${n2}`);
  }
  if (pre.T) {                                   // forced tube cells (MST between the islands of the source volume)
    let Tm = window(pre, ox, oz, 'T').arr;
    if (mirror) Tm = mirrorMask(Tm, nl, NZ, NX, mirror[0] === 'x' ? 0 : 2, mirror[1], G);
    let nt = 0;
    for (let l = 0; l < nl; l++) for (let z = 0; z < NZc; z++) for (let x = 0; x < NXc; x++) {
      let any = false;
      for (let dz = 0; dz < G && !any; dz++) { const base = (l * NZ + z * G + dz) * NX + x * G; for (let dx = 0; dx < G; dx++) if (Tm[base + dx]) { any = true; break; } }
      if (!any) continue;
      const r = S.evaluate(one, l, z, x, any_);
      if (r) { S.place(one, l, z, x, r[1], r[2], 'F-tube'); nt++; }
    }
    log(`phase F-tube 1x1: ${nt}`);
  }
  S.dims = [nxc, nzc, nl];
  return S;
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
