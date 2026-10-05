// Re-solving one part of a model (the marquee selection in the viewport).
//
// The solve is deterministic, so running it again on the same field gives the same answer. What makes a second attempt
// different is the SETTINGS, and only a few of them change the character of a small region rather than just making it worse:
//  - `beatFlat` 1 lets a shaped part win wherever it is better at all, instead of only when it beats a flat stack by 10 %;
//  - a looser `skinTol.max_err` lets a slope cover a surface it does not match exactly;
//  - the motifs are worth trying both ways locally: they build frames and ruin smooth skin, and one region is one or the other;
//  - letting the measured shapes compete as single parts (`shapeParts`) opens the arches, dishes and corner tiles;
//  - `wErr` lower tolerates a little overfill, which is what lets a bigger part cover a ragged cell.
// Each variant is solved on the masked field and scored on the REGION ALONE, so the comparison is about the part of the model
// the user pointed at, not the whole thing.
import { G, SAMP, PAD, DEFAULTS } from './constants.js';

/** the stud / level box a set of pieces spans, grown by `pad` studs and clamped to the model */
export function boxOf(pieces, { pad = 0, NL = 1e9, nxc = 1e9, nzc = 1e9 } = {}) {
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of pieces) {
    i0 = Math.min(i0, Math.floor(p.i)); i1 = Math.max(i1, Math.ceil(p.i + p.w));
    j0 = Math.min(j0, Math.floor(p.j)); j1 = Math.max(j1, Math.ceil(p.j + p.d));
    b0 = Math.min(b0, Math.floor(p.b)); b1 = Math.max(b1, Math.ceil(p.b + p.h));
  }
  if (!isFinite(i0)) return null;
  return { i0: Math.max(0, i0 - pad), i1: Math.min(nxc, i1 + pad), j0: Math.max(0, j0 - pad), j1: Math.min(nzc, j1 + pad),
    b0: Math.max(0, b0 - pad), b1: Math.min(NL, b1 + pad) };
}
/** does this piece touch the box at all? (pieces that straddle the edge are re-solved with it) */
export const inBox = (p, B) => p.i < B.i1 && p.i + p.w > B.i0 && p.j < B.j1 && p.j + p.d > B.j0 && p.b < B.b1 && p.b + p.h > B.b0;

/**
 * A copy of a prepared volume (grid.prepare) with everything outside the box erased, so `solve` produces pieces only there.
 * The box is in the solution's stud / level coordinates; the prepared field is padded, and `window()` crops it at
 * (PAD - ox) / SAMP, so that offset is what maps one to the other.
 */
export function maskRegion(pre, B, ox, oz) {
  const a = Math.round((PAD - ox) / SAMP), b = Math.round((PAD - oz) / SAMP);
  const x0 = B.i0 * G + a, x1 = B.i1 * G + a, z0 = B.j0 * G + b, z1 = B.j1 * G + b;
  const plane = pre.NX * pre.NZ;
  const cut = (src) => {
    if (!src) return src;
    const out = new src.constructor(src.length);
    for (let l = Math.max(0, B.b0); l < Math.min(pre.nl, B.b1); l++)
      for (let z = Math.max(0, z0); z < Math.min(pre.NZ, z1); z++) {
        const row = l * plane + z * pre.NX, lo = Math.max(0, x0), hi = Math.min(pre.NX, x1);
        if (hi > lo) out.set(src.subarray(row + lo, row + hi), row + lo);
      }
    return out;
  };
  return { ...pre, M: cut(pre.M), Mfull: cut(pre.Mfull), Mcoarse: cut(pre.Mcoarse), P: cut(pre.P), T: cut(pre.T), mirror: null };
}

/**
 * The engine's own score (run.metrics) restricted to the box: matched / (target + overfill), where overfill is measured
 * against the FULL solid, not the carved field. Getting this wrong is what made the first version replace good work with bad:
 * scoring only `min(M0, C) / max(M0, C)` ignores that a part may bulge outside the model, so an attempt could win the box and
 * cost the model (duck: box .762 -> .799 while the whole model went .852 -> .849). A local score has to be a restriction of
 * the global one, or improving it means nothing.
 */
export function regionScore(S, B) {
  const F = S.Mfull || S.M0;
  let matched = 0, total = 0, over = 0;
  for (let l = Math.max(0, B.b0); l < Math.min(S.NL, B.b1); l++)
    for (let z = Math.max(0, B.j0 * G); z < Math.min(S.NZs, B.j1 * G); z++) {
      const row = (l * S.NZs + z) * S.NXs;
      for (let x = Math.max(0, B.i0 * G); x < Math.min(S.NXs, B.i1 * G); x++) {
        const m = S.M0[row + x], c = S.C[row + x], f = F[row + x];
        matched += m < c ? m : c; total += m; if (c > f) over += c - f;
      }
    }
  return total + over > 0 ? matched / (total + over) : 1;
}

/**
 * The ladder of attempts for a region, cheapest and most conservative first. `o` is the model's own option set, so a variant
 * only ever changes the handful of settings named above; everything else stays as the user has it.
 */
export function regionVariants(o, level = 2) {
  const skin = o.skinTol || DEFAULTS.skinTol;
  const V = [
    ['as it is', {}],
    ['shaped parts favoured', { beatFlat: 1 }],
    ['looser skin', { skinTol: { ...skin, max_err: Math.min(0.26, (skin.max_err ?? 0.14) + 0.06) }, beatFlat: 1 }],
    [o.motifs ? 'without the assemblies' : 'with the assemblies', { motifs: !o.motifs, motifVerify: false }],
  ];
  if (level > 1) V.push(
    ['every measured shape', { shapeParts: true, beatFlat: 1 }],
    ['overfill tolerated', { wErr: Math.max(1.2, (o.wErr ?? 3) * 0.6), beatFlat: 1 }],
    ['looser skin, no assemblies', { skinTol: { ...skin, max_err: Math.min(0.26, (skin.max_err ?? 0.14) + 0.06) }, beatFlat: 1, motifs: false, motifVerify: false }],
  );
  return V.map(([name, opts]) => ({ name, opts }));
}
