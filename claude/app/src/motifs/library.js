// Motif library -> compound solver variants. A compound variant looks exactly like a part variant (c, rot, V, studs, w, d, h, vtot,
// vsum, full, lev) so Solver.candidates / evaluate / attachMirrors score it unchanged, plus `parts`: the real pieces it expands into
// when placed (solver._place). Motifs come from motifs.js (mined by tools/mine_motifs.mjs); only motifs whose parts all exist in the
// catalogue in use are kept, and solid boxes (pure brick / plate stacks) are dropped by default: a single part already does that job.
import { G } from '../brickgen/constants.js';
import { rotate, baseVolume } from '../brickgen/variants.js';
import { orientPart, ORI_YAW } from './orient.js';
import MOTIF_TEXT from './motifs.js';
import { stretch } from './periodic.js';

/**
 * The built-in library ships as TEXT, one motif per line: `<canonical key>\t<n>\t<models>`, the key being what mine.js wrote
 * (`w,d,h|id:rot:i,j,b id:o<ori>:i,j,b ...`, offsets in tenths of a stud and half plates). The key already holds every part, so
 * the JSON's `parts` array was pure duplication: the same library is 0.9 MB of text against 8.1 MB of JSON, it parses as one
 * string literal instead of 20k object literals (45 MB of heap on load, in every worker, whether or not motifs were on), and
 * nothing is turned into objects until a run asks for the library.
 */
export function parseLibrary(text, { minCount = 1, minModels = 1, maxParts = 64 } = {}) {
  if (typeof text !== 'string') return text || [];                          // already a list (a custom library, or the old format)
  const out = [];
  for (const line of text.split('\n')) {
    if (line.length < 3) continue;
    const t1 = line.lastIndexOf('\t'), t0 = line.lastIndexOf('\t', t1 - 1);
    const n = +line.slice(t0 + 1, t1), models = +line.slice(t1 + 1);
    if (n < minCount || models < minModels) continue;
    const key = line.slice(0, t0), bar = key.indexOf('|');
    const toks = key.slice(bar + 1).split(' ');
    if (toks.length > maxParts) continue;
    const dims = key.slice(0, bar).split(',');
    out.push({ key, w: +dims[0], d: +dims[1], h: +dims[2], n, models, parts: toks.map(parsePart) });
  }
  return out;
}
function parsePart(t) {
  const a = t.indexOf(':'), b = t.indexOf(':', a + 1), xs = t.slice(b + 1).split(','), o = t.slice(a + 1, b);
  const p = { id: t.slice(0, a), i: +xs[0] / 10, j: +xs[1] / 10, b: +xs[2] / 2 };
  if (o.charCodeAt(0) === 111) p.ori = +o.slice(1); else p.rot = +o;         // `o11` = orientation index (sideways), else a yaw
  return p;
}
let BUILTIN = null;
/** the built-in motif list, parsed on first use (and kept) */
export function builtinMotifs() { return BUILTIN || (BUILTIN = parseLibrary(MOTIF_TEXT)); }

const partCache = new Map();
/** variant of one catalogue part at one yaw (no dedup: the motif stores canonical rots already) */
function partVariant(c, rot) {
  const k = `${c.id}|${rot}`; if (partCache.has(k)) return partCache.get(k);
  const { vol, h } = baseVolume(c), r = rotate(vol, h, c, rot);
  let sum = 0; for (const x of r.V) sum += x;
  const v = { c, rot, V: r.V, studs: r.studs, w: r.w, d: r.d, h, vtot: sum / (G * G), vsum: sum };
  partCache.set(k, v); return v;
}

/** one part under one of the 24 orientations, in the shape the solver's variants have (orientations 0..3 are the plain yaws) */
const oriCache = new Map();
function oriented(c, ori) {
  const k = `${c.id}|${ori}`; if (oriCache.has(k)) return oriCache.get(k);
  const ob = orientPart(c, ori);
  let sum = 0; for (const x of ob.V) sum += x;
  const v = { c, ori, rot: ori < 4 ? ori * 90 : 0, ob, studs: ori < 4 ? partVariant(c, ori * 90).studs : [],   // a sideways part's studs face sideways: it carries nothing
    w: ob.w, d: ob.d, h: ori < 4 ? ob.nl : ob.h, vtot: sum / (G * G), vsum: sum };
  oriCache.set(k, v); return v;
}

/**
 * rasterise a part list into one volume of w x d x h cells. The sum is taken in 4-LDU slices along y and only collapsed to plate
 * levels at the end: a sideways part may start half a level up, and 44% of the sideways parts in the OMR do.
 * For upright parts this is identical to adding their per-level volumes (orient.js collapses the same slices).
 */
function rasterise(parts, w, d, h) {
  const nz = d * G, nx = w * G, ny = 2 * h, F = new Float32Array(ny * nz * nx);
  for (const p of parts) {
    const ob = p.v.ob, oy = Math.round(p.db * 2), oz = Math.round(p.dj * G), ox = Math.round(p.di * G);
    for (let y = 0; y < ob.ny; y++) { const Y = oy + y; if (Y < 0 || Y >= ny) continue;
      for (let z = 0; z < ob.nz; z++) { const Z = oz + z; if (Z < 0 || Z >= nz) continue;
        for (let x = 0; x < ob.nx; x++) { const X = ox + x; if (X < 0 || X >= nx) continue;
          const q = (Y * nz + Z) * nx + X; F[q] = Math.min(1, F[q] + ob.FW[(y * ob.nz + z) * ob.nx + x]);
        } } }
  }
  const V = new Float32Array(h * nz * nx);
  for (let y = 0; y < ny; y++) for (let q = 0; q < nz * nx; q++) V[(y >> 1) * nz * nx + q] += F[y * nz * nx + q] / 2;
  return V;
}

/**
 * identity of a rasterised volume, as a short string. Two 32-bit FNV-1a walks (different seeds and strides) over the cells
 * quantised to 1/4096 - the volumes are sums of exact fractions, so quantising is safe. The first version joined
 * `x.toFixed(4)` over every cell, which built a ~16 KB string per variant and was most of the library build time.
 */
function volSig(V, w, d) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let q = 0; q < V.length; q++) {
    const x = (V[q] * 4096) | 0;
    h1 = Math.imul(h1 ^ x, 0x01000193);
    h2 = Math.imul(h2 ^ (x + q), 0x85ebca6b);
  }
  return `${w},${d},${V.length},${h1 >>> 0},${h2 >>> 0}`;
}

const oriOf = (p) => (p.ori !== undefined ? p.ori : Math.round((p.rot || 0) / 90) % 4);   // a sideways part carries `ori` (0..23) and no `rot`
/** +90 yaw of a motif's part list inside its w x d window (same convention as mine.js canonicalKey / variants.rotate) */
function turn(parts, w, by) {
  return parts.map((p) => { const o = oriOf(p); return { id: p.id, ori: ORI_YAW[o], i: p.j, j: w - p.i - oriented(by.get(p.id), o).w, b: p.b }; });
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
    if (p.ori !== undefined && p.ori >= 4) return null;                 // a mirrored sideways part is not generally the same part turned
    const v = partVariant(by.get(p.id), p.rot ?? oriOf(p) * 90), u = mirrorVariant(by.get(p.id), v); if (!u) return null;
    out.push({ id: p.id, ori: Math.round(u.rot / 90), i: w - p.i - v.w, j: p.j, b: p.b });
  }
  return out;
}

const libCache = new Map();
// parts that offer studs on a vertical face, by their LDraw description (headlight bricks, side-stud bricks, brackets)
const HOST_RE = /stud(s)? on .{0,20}side|headlight|^bracket/i;
/**
 * compound variants for a catalogue: { variants, kept, dropped }. Options: minModels (motif seen in at least this many source models),
 * minCount, maxParts, solid (keep solid-box motifs), bonusLog (per-variant score bonus = base + bonusLog * log2(models))
 */
export function motifVariants(cat, { motifMinModels = 2, motifMinCount = 3, motifMaxParts = 12, motifSolid = false, motifBonus = 0.2, motifBonusLog = 0.1, motifMinPartH = 2, motifShapedOnly = true, motifShapedMin = 0, motifMirror = true, motifStretch = true, motifStretchMax = 8, motifStretchCells = 512, motifSnot = true, motifMaxKeep = 0, motifLibrary = null } = {}) {
  // motifLibrary: another mined list (tools/mine_motifs.mjs output, a list or the packed text) in place of the built-in one
  const LIB = motifLibrary ? parseLibrary(motifLibrary) : builtinMotifs();
  const key = `${motifLibrary ? 'custom' + LIB.length : 'builtin'}|${cat.length}|${motifMinModels}|${motifMinCount}|${motifMaxParts}|${motifSolid}|${motifBonus}|${motifBonusLog}|${motifMinPartH}|${motifShapedOnly}|${motifShapedMin}|${motifMirror}|${motifStretch}|${motifStretchMax}|${motifStretchCells}|${motifSnot}|${motifMaxKeep}`;
  const FLAT = new Set(['brick', 'plate', 'tile', 'technic']), HOST = HOST_RE;
  if (libCache.has(key)) return libCache.get(key);
  const by = new Map(cat.map((c) => [c.id, c]));
  // ids the library was mined with that the catalogue has since replaced by the same part under its other LDraw name
  const ALIAS = { '4287a': '4287', '3747a': '3747' };
  for (const [a, b] of Object.entries(ALIAS)) if (!by.has(a) && by.has(b)) by.set(a, by.get(b));
  // a motif is "sideways" (SNOT) as soon as one of its parts sits in a non-upright orientation; the mine stores the
  // orientation index per part (orient.js: 0..3 are the yaws), so the flag is derived here rather than duplicated in the data
  const snotOf = (m) => { if (m.snot === undefined) m.snot = m.parts.some((p) => (p.ori ?? 0) >= 4); return m.snot; };
  const keep = (m) => {
    if (m.models < motifMinModels || m.n < motifMinCount || m.parts.length > motifMaxParts || !m.parts.every((p) => by.has(p.id))) return false;
    if (snotOf(m) && !motifSnot) return false;
    // A sideways part is held by the side studs of a brick / bracket beside it. A mining window can clip that host out, and
    // what is left cannot be built: the stud-contact test then reports the sideways pieces as a floating component (35 of the
    // 38 extra components on duck @24 were exactly that). So a sideways motif is kept only if it carries its own host.
    if (snotOf(m) && !m.parts.some((p) => (p.ori ?? 0) < 4 && HOST.test(by.get(p.id).name))) return false;
    // greebles (1x1 round plates in rows, plate-only arrangements) are surface decoration, not shape: ask for one part at least motifMinPartH plates tall
    if (!m.parts.some((p) => partVariant(by.get(p.id), p.rot).h >= motifMinPartH)) return false;
    // brick / plate-only arrangements (L-shapes, steps) would take the skin before the slope phase runs and the single-part phases
    // pack flat regions with fewer pieces anyway: keep motifs that bring a shaped part (slope, curved, cheese, inverted, round, wedge)
    if (motifShapedOnly && !snotOf(m) && !m.parts.some((p) => !FLAT.has(by.get(p.id).kind))) return false;
    // a slope riding on a long brick is a wall with a slope on top (docs/CURVES.md): on a curved surface the brick fits by volume
    // and leaves a straight ridge. motifShapedMin asks for the shaped parts to be at least this share of the assembly's volume
    if (motifShapedMin > 0 && !snotOf(m)) { let sh = 0, all = 0; for (const p of m.parts) { const v = partVariant(by.get(p.id), p.rot ?? 0).vtot; all += v; if (!FLAT.has(by.get(p.id).kind)) sh += v; } if (sh < motifShapedMin * all) return false; }
    return true;
  };
  const variants = []; let kept = 0, dropped = 0;
  let mined = LIB.filter((m) => { const k = keep(m); if (!k) dropped++; return k; });
  // motifMaxKeep: only the K most frequent assemblies. The phase's cost is linear in the number of variants it scans, and the
  // tail of the library is motifs seen three times in two models - measured in docs/MOCS.md §7.
  if (motifMaxKeep > 0 && mined.length > motifMaxKeep) { mined = mined.slice().sort((a, b) => b.n - a.n).slice(0, motifMaxKeep); dropped += LIB.length - dropped - mined.length; }
  // a motif that repeats along one axis is a unit x n, so the lengths no set happened to contain are valid assemblies too
  const dims = (p) => { const v = oriented(by.get(p.id), oriOf(p)); return [v.w, v.d, Math.ceil(v.h)]; };   // takes the part: `rot` alone is undefined on a sideways one (NaN orientation -> crash in orientPart)
  const studded = (id) => (by.get(id).stud_cells || []).length > 0;
  const synth = motifStretch ? stretch(mined, dims, { max: motifStretchMax, maxParts: motifMaxParts, maxCells: motifStretchCells, studded }) : [];
  for (const m of [...mined, ...synth]) {
    const bonus = (motifBonus + motifBonusLog * Math.log2(m.models)) * (m.synth ? 0.8 : 1);   // synthesised lengths were not observed as such
    if (assemblyVariants(by, m, bonus, variants, { mirror: motifMirror, solid: motifSolid })) kept++; else dropped++;
  }
  const out = { variants, kept, dropped };
  libCache.set(key, out); return out;
}

/**
 * the solver variants of one assembly { key, parts: [{ id, ori | rot, i, j, b }], w, d, h } - its 4 yaws and, with `mirror`, those
 * of its x-mirror image, identical volumes merged - appended to `out`. Returns false when the assembly is a solid box and `solid`
 * is off (a single part already does that job). Shared by the mined motifs and the synthesised SNOT assemblies (snot.js).
 */
export function assemblyVariants(by, m, bonus, out, { mirror: doMirror = true, solid = false, kind = 'motif', seen = new Set() } = {}) {
  let isSolid = false; const n0 = out.length;
  const mirrored = doMirror ? mirror(m.parts, m.w, by) : null;
  for (const start of mirrored ? [m.parts, mirrored] : [m.parts]) {
    let parts = start, w = m.w, d = m.d;
    for (let r = 0; r < 4 && !isSolid; r++) {
      const resolved = parts.map((p) => { const v = oriented(by.get(p.id), oriOf(p)); return { v, studs: v.studs, di: p.i, dj: p.j, db: p.b }; });
      const V = rasterise(resolved, w, d, m.h);
      const sig = volSig(V, w, d);
      if (!seen.has(sig)) {
        seen.add(sig);
        let sum = 0, full = true; const lev = new Float64Array(m.h), per = V.length / m.h;
        for (let q = 0; q < V.length; q++) { const x = V[q]; sum += x; lev[(q / per) | 0] += x; if (x !== 1) full = false; }
        if (full && !solid) { isSolid = true; break; }
        out.push({ c: { id: `${kind}:${m.key}`, name: `${kind} ${m.parts.length} parts ${w}x${d}x${m.h}`, kind, motif: m }, rot: r * 90, V, studs: [], w, d, h: m.h, vtot: sum / (G * G), vsum: sum, full: false, lev, parts: resolved, bonus, npieces: m.parts.length });
      }
      parts = turn(parts, w, by); [w, d] = [d, w];
    }
  }
  if (isSolid) { out.length = n0; return false; }
  return out.length > n0;
}
export { oriented, HOST_RE as HOST };
