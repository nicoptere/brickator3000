// Motif library -> compound solver variants. A compound variant looks exactly like a part variant (c, rot, V, studs, w, d, h, vtot,
// vsum, full, lev) so Solver.candidates / evaluate / attachMirrors score it unchanged, plus `parts`: the real pieces it expands into
// when placed (solver._place). Motifs come from motifs.js (mined by tools/mine_motifs.mjs); only motifs whose parts all exist in the
// catalogue in use are kept, and solid boxes (pure brick / plate stacks) are dropped by default: a single part already does that job.
import { G } from '../brickgen/constants.js';
import { rotate, baseVolume } from '../brickgen/variants.js';
import MOTIFS from './motifs.js';

const partCache = new Map();
/** variant of one catalogue part at one yaw (no dedup: the motif stores canonical rots already) */
function partVariant(c, rot) {
  const k = `${c.id}|${rot}`; if (partCache.has(k)) return partCache.get(k);
  const { vol, h } = baseVolume(c), r = rotate(vol, h, c, rot);
  let sum = 0; for (const x of r.V) sum += x;
  const v = { c, rot, V: r.V, studs: r.studs, w: r.w, d: r.d, h, vtot: sum / (G * G), vsum: sum };
  partCache.set(k, v); return v;
}

/** rasterise a part list (offsets in cells / plates) into one volume of w x d x h cells */
function rasterise(parts, w, d, h) {
  const nz = d * G, nx = w * G, V = new Float32Array(h * nz * nx);
  for (const p of parts) {
    const pv = p.v, pz = pv.d * G, px = pv.w * G;
    for (let l = 0; l < pv.h; l++) for (let z = 0; z < pz; z++) for (let x = 0; x < px; x++) {
      const L = p.db + l, Z = p.dj * G + z, X = p.di * G + x;
      if (L < h && Z < nz && X < nx) V[(L * nz + Z) * nx + X] = Math.min(1, V[(L * nz + Z) * nx + X] + pv.V[(l * pz + z) * px + x]);
    }
  }
  return V;
}

/** +90 yaw of a motif's part list inside its w x d window (same convention as mine.js canonicalKey / variants.rotate) */
function turn(parts, w, by) {
  return parts.map((p) => ({ id: p.id, rot: (p.rot + 90) % 360, i: p.j, j: w - p.i - by.get(p.id + '|' + p.rot).w, b: p.b }));
}

/** x-mirror of a part variant: the same part at the yaw whose volume is the mirror image, or null (wedge left / right have no twin here) */
const mirrorCache = new Map();
function mirrorVariant(c, v) {
  const k = `${c.id}|${v.rot}`; if (mirrorCache.has(k)) return mirrorCache.get(k);
  const nz = v.d * G, nx = v.w * G, M = new Float32Array(v.V.length);
  for (let l = 0; l < v.h; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) M[(l * nz + z) * nx + x] = v.V[(l * nz + z) * nx + (nx - 1 - x)];
  let out = null;
  for (const rot of [0, 90, 180, 270]) {
    const u = partVariant(c, rot); if (u.w !== v.w || u.d !== v.d) continue;
    let same = true; for (let q = 0; q < M.length && same; q++) if (Math.abs(u.V[q] - M[q]) > 1e-3) same = false;
    if (same) { out = u; break; }
  }
  mirrorCache.set(k, out); return out;
}
/** mirror a motif's part list in x inside its w-wide window; null when a part has no mirror twin */
function mirror(parts, w, by) {
  const out = [];
  for (const p of parts) {
    const v = partVariant(by.get(p.id), p.rot), u = mirrorVariant(by.get(p.id), v); if (!u) return null;
    out.push({ id: p.id, rot: u.rot, i: w - p.i - v.w, j: p.j, b: p.b });
  }
  return out;
}

const libCache = new Map();
/**
 * compound variants for a catalogue: { variants, kept, dropped }. Options: minModels (motif seen in at least this many source models),
 * minCount, maxParts, solid (keep solid-box motifs), bonusLog (per-variant score bonus = base + bonusLog * log2(models))
 */
export function motifVariants(cat, { motifMinModels = 2, motifMinCount = 3, motifMaxParts = 12, motifSolid = false, motifBonus = 0.2, motifBonusLog = 0.1, motifMinPartH = 2, motifShapedOnly = true, motifMirror = true } = {}) {
  const key = `${cat.length}|${motifMinModels}|${motifMinCount}|${motifMaxParts}|${motifSolid}|${motifBonus}|${motifBonusLog}|${motifMinPartH}|${motifShapedOnly}|${motifMirror}`;
  const FLAT = new Set(['brick', 'plate', 'tile', 'technic']);
  if (libCache.has(key)) return libCache.get(key);
  const by = new Map(cat.map((c) => [c.id, c]));
  const variants = []; let kept = 0, dropped = 0;
  for (const m of MOTIFS) {
    if (m.models < motifMinModels || m.n < motifMinCount || m.parts.length > motifMaxParts || !m.parts.every((p) => by.has(p.id))) { dropped++; continue; }
    // greebles (1x1 round plates in rows, plate-only arrangements) are surface decoration, not shape: ask for one part at least motifMinPartH plates tall
    if (!m.parts.some((p) => partVariant(by.get(p.id), p.rot).h >= motifMinPartH)) { dropped++; continue; }
    // brick / plate-only arrangements (L-shapes, steps) would take the skin before the slope phase runs and the single-part phases
    // pack flat regions with fewer pieces anyway: keep motifs that bring a shaped part (slope, curved, cheese, inverted, round, wedge)
    if (motifShapedOnly && !m.parts.some((p) => !FLAT.has(by.get(p.id).kind))) { dropped++; continue; }
    const bonus = motifBonus + motifBonusLog * Math.log2(m.models);
    const seen = new Set(); let solid = false, n0 = variants.length;
    // the 4 yaws of the motif and of its x-mirror image (a roof edge sloping left is also one sloping right); identical volumes are merged
    const mirrored = motifMirror ? mirror(m.parts, m.w, by) : null;
    for (const start of mirrored ? [m.parts, mirrored] : [m.parts]) {
      let parts = start, w = m.w, d = m.d; const dims = new Map();
      for (let r = 0; r < 4 && !solid; r++) {
        const resolved = parts.map((p) => { const v = partVariant(by.get(p.id), p.rot); dims.set(p.id + '|' + p.rot, v); return { v, di: p.i, dj: p.j, db: p.b }; });
        const V = rasterise(resolved, w, d, m.h);
        const sig = `${w},${d},${Array.from(V).map((x) => x.toFixed(4)).join(',')}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          let sum = 0, full = true; const lev = new Float64Array(m.h), per = V.length / m.h;
          for (let q = 0; q < V.length; q++) { const x = V[q]; sum += x; lev[(q / per) | 0] += x; if (x !== 1) full = false; }
          if (full && !motifSolid) { solid = true; break; }
          variants.push({ c: { id: `motif:${m.key}`, name: `motif ${m.parts.length} parts ${w}x${d}x${m.h}`, kind: 'motif', motif: m }, rot: r * 90, V, studs: [], w, d, h: m.h, vtot: sum / (G * G), vsum: sum, full: false, lev, parts: resolved, bonus, npieces: m.parts.length });
        }
        parts = turn(parts, w, dims); [w, d] = [d, w];
      }
    }
    if (solid) { variants.length = n0; dropped++; } else kept++;
  }
  const out = { variants, kept, dropped };
  libCache.set(key, out); return out;
}
