// Full method: mesh -> LEGO piece list. Pure JS, no DOM; runs in a Web Worker or in Node.
import { DEFAULTS, STUD, PLATE } from './constants.js';
import { surfaceSamples } from './mesh.js';
import { prepare, normalize } from './grid.js';
import { smoothModel } from './smooth.js';
import { solve, solverFor, runPhases, metrics, surface } from './run.js';
import { mergePairs, vertical, horizontal, pillars, bracing, splice, bridge, weld, supports, finish, untile, connectivity, retile, roundCorners, widen, dropLoose, audit, tallBricks } from './post.js';
import { detectSymmetry } from './symmetry.js';
import { PointGrid } from './nn.js';
import { visibleSamples } from './visibility.js';
import { snapToPalette } from './colors.js';
import { featureStuds, referenceField, fieldFidelity } from './resolution.js';
import { boxOf, inBox, regionScore, regionVariants } from './region.js';
import { partVariants } from './variants.js';
import CATALOG from './catalog.js';
import EXT from './catalog_ext.js';
import SHAPES from './catalog_shapes.js';

/** limited = the hand-picked core set; extended = core + every extra solid shape measured from LDraw.
 * `shapeParts` adds the frequent shapes both lists skip because of their names (arches, panels, dishes, corner tiles,
 * curved-top bricks): they are measured as a per-level occupancy, see claude/generator/lego_catalog_shapes.py. */
export const FULL_CATALOG = [...CATALOG, ...EXT, ...SHAPES];
// the shape parts are always in the catalogue (motifs place them, and every downstream pass looks parts up by id), but they are
// poor SOLO candidates: a shell with a finely varying profile beats a plain plate on error while costing a piece (duck +6%,
// chair +16% pieces for the same IoU). `noSolo` keeps them out of the single-part phases; `shapeParts: true` lets them compete.
// The exception is the round family (discs, quarter discs, cones: kind 'round'): a cylinder's cross-section or a round table top
// is exactly what the A0-round phase looks for, and a 4x4 or 6x6 round plate explains it in one piece where the fill phase would
// lay a staircase of fragments. `shapeSolo` lists the kinds of measured shapes allowed as solo candidates (default ['round']).
const shapeCache = new Map();
const shapesFor = (o) => {
  const solo = o && o.shapeParts ? null : new Set((o && o.shapeSolo) || ['round']);
  const ids = new Set((o && o.shapeSoloIds) || []);                     // single parts allowed solo whatever their kind (4287a: the 1-wide inverted 33)
  const key = solo ? [...solo].sort().join(',') + '|' + [...ids].sort().join(',') : '*';
  if (!shapeCache.has(key)) shapeCache.set(key, SHAPES.map((c) => (solo && !solo.has(c.kind) && !ids.has(c.id) ? { ...c, noSolo: true } : c)));
  return shapeCache.get(key);
};
export const catalogFor = (o) => {
  const base = o && o.partSet === 'extended' ? [...CATALOG, ...EXT] : CATALOG;
  return [...base, ...shapesFor(o)];
};
export { DEFAULTS, CATALOG, SHAPES };
export { boxOf, inBox } from './region.js';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Which resolution? (resolution.js, docs/CURVES.md round 8.) Three numbers, combined:
 *  - a piece budget: two quick pilot solves at `autoPilot` studs give the piece counts there and the growth exponent (pieces grow
 *    as N^2..3: the skin dominates, thin models grow fastest while their struts appear), so the budget `autoPieces` gives N_budget;
 *  - the detail ceiling: the median radius of curvature of the curved surface must span `autoCurv` studs (a round shape reads as
 *    round; past that a sphere gains .1 of shell fidelity for 4x the pieces and falls apart into components) - a round shape
 *    needs no more than that, however large the budget. Creases do not count: a box edge is sharp at any resolution;
 *  - the lattice: among the stud counts within `autoSpan` of the choice, the one whose FIELD (the voxelisation the solver sees,
 *    lattice fit included) is most faithful to a fine reference voxelisation of the mesh, detrended by the smooth gain of
 *    resolution (`autoTrend` of shell IoU per doubling). This is why, for a given mesh, some resolutions come out cleaner than
 *    others: a plate-thick table top or a stud-wide leg either lands on the lattice or is smeared over two cells, and the
 *    difference (table: shell IoU .54 at 24 studs, .80 at 28) dwarfs what one more stud of resolution buys.
 * Returns { studs, chosen, budget, feature, detail, candidates, ms }.
 */
export function autoStuds(model, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, t0 = now();
  const lo = o.autoMin ?? 8, hi = o.autoMax ?? 64, budget = o.autoPieces ?? 1200, [eLo, eHi] = o.autoExpRange ?? [1.5, 3.5];
  const pilots = Array.isArray(o.autoPilot) ? o.autoPilot : [o.autoPilot ?? 12];
  const feat = featureStuds(model, o);
  // the piece budget: quick pilot solves (no motifs, no post passes) at one or two coarse stud counts. One pilot extrapolates with
  // the measured exponent autoExp; two fit it per model (a thin model - a table, an aircraft - vanishes at 12 studs and its
  // pieces grow much faster than N^2.25 while its struts appear, so the single pilot overestimates how far the budget reaches)
  const quick = { ...o, studs: 16, studsAuto: false, motifs: false, motifVerify: false, bracing: false, splice: false, bridge: false, supports: false, finish: false, snot: false };
  const counts = pilots.map((n) => Math.max(1, generate(model, { ...quick, studs: n }).metrics.pieces));
  let exp = o.autoExp ?? 2.25;
  if (pilots.length > 1 && counts[1] > counts[0]) exp = Math.min(eHi, Math.max(eLo, Math.log(counts[1] / counts[0]) / Math.log(pilots[1] / pilots[0])));
  const n0 = pilots[pilots.length - 1], p0 = counts[counts.length - 1], nBudget = n0 * Math.pow(budget / p0, 1 / exp), tPilot = now();
  // the detail ceiling: only when a real share of the surface is curved (a chair's fillets are not what the resolution is for)
  const detail = feat.curv.share >= (o.autoCurvShare ?? 0.1) && feat.curv.studs > 0 ? Math.max(lo, feat.curv.studs) : Infinity;
  const n = Math.round(Math.min(hi, Math.max(lo, Math.min(nBudget, detail))));
  // the lattice tie-break by field fidelity: the candidates within +-autoSpan, each prepared as the engine will (lattice fit on)
  // the trend: the IoU of a smooth shape's field grows ~.014 per doubling of N (sphere .928 -> .946 -> .956 -> .961 from 8 to 48),
  // ~.005 per doubling of the pieces; `autoTrend` (.02) is set above that so that, lattice luck being equal, fewer pieces win
  const span = o.autoSpan ?? 0.15, steps = o.autoSteps ?? 3, trend = o.autoTrend ?? 0.02, cands = new Set();
  for (let k = -steps; k <= steps; k++) cands.add(Math.min(hi, Math.max(lo, Math.round(n * (1 + span * k / steps)))));
  const ref = referenceField(model, Math.min(o.autoRefMax ?? 112, Math.max(o.autoRef ?? 80, 2 * Math.max(...cands))), o), rows = [];   // at least twice the finest candidate, within memory
  for (const k of [...cands].sort((a, b) => a - b)) {
    const pre = prepare({ tris: model.tris, pts: new Float32Array(0) }, k, { ...o, crust: false, islands: false, decimate: false });
    const fid = fieldFidelity(pre, ref);
    rows.push({ studs: k, iou: +fid.iou.toFixed(4), score: +(fid.iou - trend * exp * Math.log2(k / n)).toFixed(4), lattice: pre.align ? +pre.align.score.toFixed(3) : 0, rescaled: pre.align ? +(pre.align.s / pre.align.s0).toFixed(3) : 1 });
  }
  const best = rows.reduce((a, b) => (b.score > a.score ? b : a), rows[0]);
  return { studs: best.studs, chosen: best.studs === n ? (nBudget < detail ? 'budget' : 'detail') : 'lattice', centre: n,
    budget: { pieces: budget, pilotStuds: pilots, pilotPieces: counts, exp: +exp.toFixed(2), studs: +nBudget.toFixed(1) }, feature: feat, detail: isFinite(detail) ? +detail.toFixed(1) : null,
    candidates: rows, refStuds: ref.studs, ms: Math.round(now() - t0), msPilots: Math.round(tPilot - t0) };
}


/** every variant of every part, the motif-only ones too: what Solver.adopt needs to rebuild coverage from a piece list */
const varCache = new WeakMap();
const allVariants = (cat) => {
  let v = varCache.get(cat);
  if (!v) varCache.set(cat, v = partVariants(cat.map((c) => ({ ...c, noSolo: false })), new Set(cat.map((c) => c.kind))));
  return v;
};

/**
 * Re-solve one box of an existing solution and keep the best attempt (brickgen/region.js).
 *
 * The field is the model's own - the same preparation, the same grid phase - masked to the box, so the pieces that come out
 * land on the same lattice as the rest and no seam appears. Everything that touches the box is dropped and re-solved; the
 * pieces outside are kept untouched. Each variant of `regionVariants` is scored by the IoU of the BOX alone, the winner is
 * spliced back, and the whole post-process (merges, connectivity, weld) runs over the combined model, which is what repairs
 * the join. Returns the finished result with `region` describing what was tried.
 */
/**
 * Rebuild one box of an existing solution several ways, and hand all of them back to be chosen from (brickgen/region.js).
 *
 * The field is the model's own - same preparation, same grid phase - and the pieces outside the box are adopted as already
 * placed, so the only thing left to cover is the hole the selection left. A part may cross the box faces, as the global solve
 * could; nothing outside can be overwritten, because the kept pieces are in the coverage and the collision test refuses
 * anything that touches them. Every attempt is then finished the same way as the original (merges, connectivity, weld), so the
 * numbers compare like with like.
 *
 * It does NOT pick for you, and the measurement is why: on the duck, every attempt - including one with the model's own
 * settings - came out at or below the IoU the global solve reached there (.8502 against .8520). A local rebuild is simply not
 * a better optimiser than the global one; what it is good for is giving the same area a different CHARACTER - more shaped
 * parts, no learned assemblies, a looser skin - which is a judgement, not a number. The IoU of each is reported so the cost of
 * a choice is visible.
 */
export function regionAttempts(ctx, job, box, prev, cat = catalogFor(ctx.o), { log = () => {}, progress = () => {}, level = 1 } = {}) {
  const { o } = ctx, [par, ox, oz] = job, pre = ctx.pres[par];
  const B = { ...box }, vars = allVariants(cat), pieces = prev.pieces;
  const keep = pieces.filter((p) => !inBox(p, B)), inside = pieces.length - keep.length;
  // what the model actually used: the motif verification may have dropped the assemblies for the whole model, and turning them
  // back on inside the box would be offering a different method rather than a different setting
  const motifsKept = prev.post && prev.post.motifCheck ? prev.post.motifCheck.kept : true;
  const o0 = { ...o, motifs: !!o.motifs && motifsKept };
  const attempts = [{ name: 'as it is now', iou: +prev.metrics.iou.toFixed(4), pieces: prev.metrics.pieces, current: true }];
  const variants = regionVariants(o0, level);
  variants.forEach((v, k) => {
    progress(`building: ${v.name}`, 0.03 + 0.94 * k / variants.length);
    const ro = { ...o0, ...v.opts, regionBox: B, discs: false, motifVerify: false };
    const R = runPhases(solverFor(pre, cat, ox, oz, ro, log).adopt(keep, vars), pre, cat, ox, oz, ro, log);
    const made = R.pieces.slice(keep.length);
    const merged = keep.concat(made.map((p) => ({ ...p, phase: 'R-' + (p.phase || 'region'), region: true })));
    const fin = finishJob(ctx, job, cat, log, () => {}, merged);
    attempts.push({ name: v.name, iou: +fin.metrics.iou.toFixed(4), pieces: fin.metrics.pieces, made: made.length,
      components: fin.metrics.components, result: fin });
  });
  progress('done', 1);
  return { box: B, kept: keep.length, replaced: inside, attempts };
}

/** shared preparation (samples, symmetry, padded ray-cast volumes per parity) and the list of grid-phase jobs */
export function setup(model, opts) {
  const o = { ...DEFAULTS, ...opts }, T = {};
  if (o.studs === 'auto' || o.studsAuto) { const a = autoStuds(model, { ...opts, studsAuto: false }); o.studs = a.studs; o.studsAuto = false; o.autoChoice = a; }
  let t = now();
  if (o.meshSmooth > 0) { model = smoothModel(model, o.meshSmooth, o.meshLambda, o.meshMu); T.smooth = now() - t; t = now(); }   // mesh pre-pass (smooth.js), before sampling and casting
  const smp = model.pts ? { pts: model.pts, cols: model.cols } : surfaceSamples(model.tris, model.vcols, o.surfaceSamples, o.seed);
  const m = { tris: model.tris, vcols: model.vcols, pts: smp.pts, cols: smp.cols };
  T.samples = now() - t; t = now();
  const sym = o.symmetry === 'off' ? null : detectSymmetry(m.pts)[0];
  const symOk = !!sym && sym.err < o.symThreshold;
  T.symmetry = now() - t; t = now();
  const pres = {};
  if (symOk) for (const par of o.parity === 'auto' ? ['even', 'odd'] : [o.parity]) pres[par] = prepare(m, o.studs, o, { ax: sym.ax, plane: sym.plane, parity: par });
  else pres.none = prepare(m, o.studs, o);
  T.raycast = now() - t;
  const offs = o.offsets.length ? o.offsets : [0];
  const jobs = [];
  for (const par of Object.keys(pres)) {
    if (symOk) for (const v of offs) jobs.push(sym.ax === 0 ? [par, 0, v] : [par, v, 0]);
    else for (const a of offs) for (const b of offs) jobs.push([par, a, b]);
  }
  return { o, m, sym, symOk, pres, jobs, T };
}

/** score of one grid phase (used to pick the best phase; cheap enough to run in several workers) */
export function scoreJob(ctx, job, cat = catalogFor(ctx.o)) {
  const [par, ox, oz] = job;
  // the grid phase is chosen without the motifs (unless motifScoring) and without the sideways skin: both are expensive, and
  // the wall pass on top of the scoring solves picked a worse phase for the rounded box (1184 pieces against 954 on the phase
  // the plain solve picks) - the phase is a property of the field's lattice, not of the skin that goes on it
  const so = { ...ctx.o, wall: false }; if (ctx.o.motifs && !ctx.o.motifScoring) so.motifs = false;
  const S = solve(ctx.pres[par], cat, ox, oz, so);
  const mt = metrics(S);
  return mt.iou - 0.002 * mt.pieces;
}


// What the long stage is actually doing, in words a person can read. The solver names its phases by code (`A-skin-narrow`,
// `B2-fill`); `log` already carried them, but only after each one finished and only into the console. These are announced
// before the work, so the progress bar names what is RUNNING. The fractions are nominal - the number of phases is known from
// the options, their cost is not - and only ever move forward.
const PHASE_LABEL = {
  'A1-disc': 'laying disc layers', 'M-lib': 'building the assembly library', 'M-motif': 'placing learned assemblies', 'A0-round': 'placing round parts',
  'A-skin-narrow': 'skinning the slopes (1-wide)', 'A-skin': 'skinning the slopes', 'A2-skin-ext': 'skinning with the extended parts',
  'W-wall': 'skinning the walls sideways', 'S-snot': 'hanging sideways parts', 'B-fill': 'filling the body', 'B2-fill': 'filling the body (second pass)',
  'C-relaxed': 'mopping up the surface', 'D-fallback': 'filling the gaps with 1x1', 'E-thin': 'catching the thin features',
  'F-tube': 'joining the islands',
};
/** how many solver phases this option set will run (for the fraction; a miscount only skews the bar, never the result) */
const phaseCount = (o) => 1 + (o.discs ? 1 : 0) + (o.motifs ? 2 : 0) + (o.rounds ? 1 : 0)
  + (o.skin ? 1 + (o.skinNarrow ? 1 : 0) + (o.partSet === 'extended' ? 1 : 0) : 0) + (o.snot ? 1 : 0) + (o.wall ? 1 : 0)
  + 1 + (o.fill2 ? 1 : 0) + (o.relaxed ? 1 : 0) + (o.fallback ? 1 : 0) + (o.thin ? 1 : 0) + (o.islands ? 1 : 0);

/** finish the best job: colours, merges, pillars, connectivity post-process, studs finish, palette, stats */
export function finishJob(ctx, job, cat = catalogFor(ctx.o), log = () => {}, progress = () => {}, adopt = null) {
  // The sideways skin (motifs/wall.js) pays on some models and costs on others (a rounded box: +36 % pieces for nothing), and
  // only the FINISHED models can be compared - the merge passes compress an upright solution far more than one with rigid
  // sideways assemblies (rounded box: 1392 vs 1425 pieces raw, 1184 vs 890 finished). So with `wallVerify` the whole finish
  // runs twice, with and without, and the one that wins on the job score (IoU - 0.002 x pieces) is returned.
  if (ctx.o.wall && (ctx.o.wallVerify ?? true) && !adopt && !ctx.o._wallInner) {
    const a = finishJob({ ...ctx, o: { ...ctx.o, _wallInner: true } }, job, cat, log, (l, f) => progress(l, f * 0.5), adopt);
    if (!a.post.wall || !a.post.wall.pieces) return a;
    const b = finishJob({ ...ctx, o: { ...ctx.o, wall: false, _wallInner: true } }, job, cat, log, (l, f) => progress('without the sideways skin: ' + l, 0.5 + f * 0.5), adopt);
    const sa = a.metrics.iou - 0.002 * a.metrics.pieces, sb = b.metrics.iou - 0.002 * b.metrics.pieces, kept = sa >= sb + (ctx.o.wallGain ?? 0);
    const r = kept ? a : b;
    r.post.wallCheck = { with: +a.metrics.iou.toFixed(4), without: +b.metrics.iou.toFixed(4), pieces: [a.metrics.pieces, b.metrics.pieces], kept };
    if (!kept) r.post.wall = { ...a.post.wall, dropped: true };
    log(`wall check: IoU ${a.metrics.iou.toFixed(3)} / ${a.metrics.pieces} p with, ${b.metrics.iou.toFixed(3)} / ${b.metrics.pieces} p without -> ${kept ? 'kept' : 'dropped'}`);
    r.timing.wallCheck = (a.timing.solve || 0) + (a.timing.post || 0) + (b.timing.solve || 0) + (b.timing.post || 0);
    return r;
  }
  // The mined assemblies, the same way (motifScore, docs/MOCS.md §6.6): the solver-level check below compared raw solves on
  // IoU alone, and the raw solve with motifs has MORE pieces (rigid assemblies) than the one without, while the finished one
  // has fewer (ice cream, 16 studs: 1751 vs 1742 raw, 1131 vs 1157 finished). Only finished models compare, on the job score.
  if (ctx.o.motifs && (ctx.o.motifVerify ?? true) && (ctx.o.motifScore ?? true) && !adopt && !ctx.o._motifInner) {
    const a = finishJob({ ...ctx, o: { ...ctx.o, _motifInner: true } }, job, cat, log, (l, f) => progress(l, f * 0.5), adopt);
    if (!a.pieces.some((p) => p.motif)) return a;
    const b = finishJob({ ...ctx, o: { ...ctx.o, motifs: false, _motifInner: true } }, job, cat, log, (l, f) => progress('checking the assemblies pay: ' + l, 0.5 + f * 0.5), adopt);
    const sa = a.metrics.iou - 0.002 * a.metrics.pieces, sb = b.metrics.iou - 0.002 * b.metrics.pieces, kept = sa >= sb + (ctx.o.motifGain ?? 0);
    const r = kept ? a : b;
    r.post.motifCheck = { with: +a.metrics.iou.toFixed(4), without: +b.metrics.iou.toFixed(4), pieces: [a.metrics.pieces, b.metrics.pieces], kept, finished: true };
    log(`motif check: IoU ${a.metrics.iou.toFixed(3)} / ${a.metrics.pieces} p with, ${b.metrics.iou.toFixed(3)} / ${b.metrics.pieces} p without -> ${kept ? 'kept' : 'dropped'}`);
    r.timing.motifCheck = (a.timing.solve || 0) + (a.timing.post || 0) + (b.timing.solve || 0) + (b.timing.post || 0);
    return r;
  }
  const { o, m, sym, symOk } = ctx, T = { ...ctx.T };
  let t = now();
  const [par, ox, oz] = job, pre = ctx.pres[par];
  // the stage is in three parts: the solve, the motif verification (a second solve, so it costs as much), and the post-process
  const verify = !!(o.motifs && (o.motifVerify ?? true) && !(o.motifScore ?? true));   // the motifScore check wraps the whole finish (above)
  const SOLVE = verify ? 0.42 : 0.62, VERIFY = verify ? 0.72 : SOLVE;
  const nPhase = phaseCount(o); let seen = 0, lo = 0, hi = SOLVE;
  let tag = '', last = -1;
  // `sub` is how far through the phase itself we are; a phase starts at 0, so that is where the counter advances
  const onPhase = (name, sub = 0) => {
    if (sub === 0) seen++;
    const f = lo + Math.min(0.99, (seen - 1 + Math.min(1, sub)) / nPhase) * (hi - lo);
    if (f < last) return; last = f;
    progress(tag + (PHASE_LABEL[name] || name), f);
  };
  // `adopt`: a piece list solved elsewhere (a region edit) takes the place of the solve, on a bare solver over the full field
  let S = adopt ? solve(pre, cat, ox, oz, { ...o, noPhases: true }).adopt(adopt, allVariants(cat)) : solve(pre, cat, ox, oz, o, log, onPhase);
  const post = {};
  if (S.wall) post.wall = S.wall;
  // motif verification, the older rule (motifScore off; docs/CURVES.md): the mined assemblies are a broad-phase heuristic that pays on blocky and roof-like
  // models and leaves a chaotic skin on organic ones; the same field is solved once more without them (fast: the motif phase is
  // what costs) and the assemblies are kept only when they gain at least `motifGain` of IoU
  if (verify && !adopt) {
    seen = 0; lo = SOLVE; hi = VERIFY; last = -1; tag = 'checking the assemblies pay: ';
    const S2 = solve(pre, cat, ox, oz, { ...o, motifs: false }, log, (n, f) => onPhase(n, f)), ma = metrics(S), mb = metrics(S2);
    post.motifCheck = { with: +ma.iou.toFixed(4), without: +mb.iou.toFixed(4), pieces: [ma.pieces, mb.pieces], kept: ma.iou >= mb.iou + (o.motifGain ?? 0.01), finished: false };
    if (!post.motifCheck.kept) S = S2;
    log(`motif check: IoU ${ma.iou.toFixed(3)} / ${ma.pieces} p with, ${mb.iou.toFixed(3)} / ${mb.pieces} p without -> ${post.motifCheck.kept ? 'kept' : 'dropped'}`);
  }
  const off = [ox + pre.shift[0], oz + pre.shift[1]];
  T.solve = now() - t; t = now();
  // cheat colour: mean colour of the nearest surface samples, in the same normalised frame
  // only surfaces visible from outside colour the skin (interior ice cream under a glass wall must not bleed through)
  let cpts = m.pts, ccols = m.cols;
  if (o.colorVisible ?? true) {
    const vis = visibleSamples(m.tris, m.pts), keep = []; for (let i = 0; i < vis.length; i++) if (vis[i]) keep.push(i);
    if (keep.length > 50) { cpts = new Float32Array(keep.length * 3); ccols = new Float32Array(keep.length * 3); keep.forEach((i, j) => { for (let c = 0; c < 3; c++) { cpts[j * 3 + c] = m.pts[i * 3 + c]; ccols[j * 3 + c] = m.cols[i * 3 + c]; } }); }
  }
  tag = '';
  progress('matching the colours', VERIFY);
  const nm = normalize(m.tris, cpts, o.studs, off[0], off[1], o.ref);
  const grid = new PointGrid(nm.pts, 64);
  const cols = ccols;
  for (const p of S.pieces) p.rgb = colourAt(grid, cols, p, o.colorK);
  T.colour = now() - t; t = now();
  const before = S.pieces.length;
  progress('merging slopes', 0.72);
  if (o.widen) post.widen = widen(S, cat, o.colorTol);                                   // two identical 1-wide slopes side by side -> the 2-wide part
  progress('merging stacks', 0.742);
  if (o.mergeVertical) post.vertical = vertical(S, cat, o.colorTol);
  if (o.mergeHorizontal) post.horizontal = horizontal(S, cat, 'plate', o.colorTol) + horizontal(S, cat, 'tile', o.colorTol);
  progress('plates into bricks', 0.765);
  if (o.retile) post.retile = retile(S, cat, o.colorTol);                              // stacked plates of any footprint -> bricks
  post.merged = before - S.pieces.length;
  progress('turning columns into poles', 0.787);
  if (o.pillars) post.pillars = pillars(S, cat, o.pillarMinLevels, o.pillarCluster ?? 0);
  post.connectedBefore = connectivity(S);
  progress('bracing', 0.81);
  if (o.bracing) post.brace = bracing(S, cat, o);
  progress('splicing the seams', 0.833);
  if (o.splice) post.splice = splice(S, cat, o);
  progress('bridging the gaps', 0.855);
  if (o.bridge) post.bridge = bridge(S, cat, o);
  progress('building the supports', 0.877);
  if (o.supports) post.supports = supports(S, cat, o).columns;
  if (o.bracing && o.supports) post.brace += bracing(S, cat, o);
  if (o.mergeVertical) post.vertical2 = vertical(S, cat, o.colorTol);                  // final re-pack: bracing / splice / bridge pieces can merge too
  if (o.retile) post.retile2 = retile(S, cat, o.colorTol);
  if (o.tallBricks) post.tall = tallBricks(S, cat, o.colorTol);                           // stacks of plain bricks -> one tall part (1x1x3, 1x1x5, 2x2x3 ...)
  progress('tidying the tiles', 0.9);
  post.untiled = untile(S, cat);                                                        // smooth tiles only on the outside skin
  if (o.mergeHorizontal) post.pairs = mergePairs(S, cat, 'plate', o.colorTol) + mergePairs(S, cat, 'brick', o.colorTol);          // union-only merges: connectivity cannot get worse
  progress('finishing with tiles', 0.922);
  if (o.finish) { post.finish = finish(S, cat, o.finishBricks); if (o.mergeHorizontal) mergePairs(S, cat, 'tile', o.colorTol); }
  if (o.finish && o.roundCorners) post.corners = roundCorners(S, cat);                   // quarter-round tiles on the convex corners of the top layer
  progress('dropping the loose pieces', 0.945);
  if (o.dropLoose) post.loose = dropLoose(S, o.wall ? Math.max(2, o.dropLoose) : o.dropLoose);   // single pieces touching nothing are not part of the build (with the sideways skin: a plate + tile left standing on a sideways part are two)
  // last: what is still in several pieces gets welded, through air if there is no way through the solid (docs/CURVES.md round 9)
  progress('welding it into one piece', 0.968);
  if (o.weld) { post.weld = weld(S, cat, o); if (post.weld.added && o.mergeHorizontal) mergePairs(S, cat, 'plate', o.colorTol); }
  for (const p of S.pieces) if (!p.rgb) p.rgb = colourAt(grid, cols, p, o.colorK);
  if (o.palette === 'lego') for (const p of S.pieces) { if (p.kind === 'support') continue; const c = snapToPalette(p.rgb); p.rgb = c.rgb; p.code = c.code; p.colorName = c.name; }
  T.post = now() - t;
  progress('measuring the result', 0.99);
  const mt = metrics(S), con = connectivity(S), sf = surface(S, cat);
  // buildability: no two pieces may claim the same volume (post.audit rasterises every piece afresh). Zero on every bench
  // model since the flatten fallback was fixed (it used to transpose its footprint and ignore the levels above); reported so
  // a regression shows up as a number, not as a brick through a slope in the booklet
  const ov = audit(S, cat, allVariants(cat)); post.overlap = { samples: ov.samples, cells: ov.cells }; if (ov.samples) log(`buildability: ${ov.samples} overlapping samples in ${ov.cells} cells`);
  let mirrored = null;
  if (S.mirror) {
    const [ax, c2] = S.mirror, keys = new Set(S.pieces.map((q) => `${q.id},${q.b},${q.j},${q.i},${q.w},${q.d}`));
    mirrored = S.pieces.filter((q) => keys.has(`${q.id},${q.b},${ax === 'z' ? c2 - q.j - q.d : q.j},${ax === 'x' ? c2 - q.i - q.w : q.i},${q.w},${q.d}`)).length / Math.max(1, S.pieces.length);
  }
  const srcTris = normalize(m.tris, null, o.studs, off[0], off[1], o.ref).tris;
  return {
    pieces: S.pieces, dims: S.dims, offset: off, scale: nm.s, srcTris, srcCols: m.vcols,
    metrics: { ...mt, ...con, ...sf }, post, timing: T, islands: pre.islands, crust: pre.crust, align: pre.align,
    symmetry: sym ? { axis: sym.axis, err: sym.err, used: symOk, parity: symOk ? par : null, plane: S.mirror ? S.mirror[1] : null, mirrored } : null,
  };
}

// colour of a piece: inverse-squared-distance weighted mean of the nearest surface samples, searched only within a
// radius tied to the piece's own size (its bbox half-diagonal + one stud of slack). An unbounded, uniform average lets
// colour bleed in from unrelated nearby mesh features (a different part of the model that just happens to be close in
// 3D once the piece sits flush against the true surface); capping the radius to roughly "as big as this piece is"
// keeps the sample pool local to it, and weighting by distance favours the closest samples over the farthest within
// that pool. Falls back to an unbounded search only if nothing at all is found within the cap (e.g. a piece deep
// inside a hollow crust, far from any surface sample).
function colourAt(grid, cols, p, k) {
  const c = [(p.i + p.w / 2) * STUD, (p.b + p.h / 2) * PLATE, (p.j + p.d / 2) * STUD];
  const dx = p.w * STUD, dy = p.h * PLATE, dz = p.d * STUD;
  const maxDist = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz) + STUD;
  let nb = grid.knn(c[0], c[1], c[2], k, maxDist).filter(([, i]) => i >= 0);
  if (!nb.length) nb = grid.knn(c[0], c[1], c[2], k).filter(([, i]) => i >= 0);
  if (!nb.length) return [178, 178, 178];
  const rgb = [0, 0, 0]; let wsum = 0;
  for (const [d2, i] of nb) { const w = 1 / (d2 + 1); wsum += w; for (let t = 0; t < 3; t++) rgb[t] += w * cols[i * 3 + t]; }
  return rgb.map((v) => Math.round((255 * v) / wsum));
}

/** single-thread convenience: the whole method */
export function generate(model, opts = {}, { cat = catalogFor({ ...DEFAULTS, ...opts }), progress = () => {}, log = () => {} } = {}) {
  const t0 = now();
  progress('setup', 0);
  const ctx = setup(model, opts);
  let best = null, bs = -Infinity, k = 0;
  for (const job of ctx.jobs) {
    const s = scoreJob(ctx, job, cat); if (s > bs) { bs = s; best = job; }
    progress('grid phases', ++k / ctx.jobs.length);
  }
  ctx.T.phases = now() - t0 - ctx.T.samples - ctx.T.symmetry - ctx.T.raycast;
  progress('finishing', 0);
  const r = finishJob(ctx, best, cat, log, (label, f) => progress(label, f));
  r.timing.total = now() - t0; r.job = best; r.options = ctx.o;
  return r;
}
