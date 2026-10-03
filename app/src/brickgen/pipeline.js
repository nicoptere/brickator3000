// Full method: mesh -> LEGO piece list. Pure JS, no DOM; runs in a Web Worker or in Node.
import { DEFAULTS, STUD, PLATE } from './constants.js';
import { surfaceSamples } from './mesh.js';
import { prepare, normalize } from './grid.js';
import { solve, metrics } from './run.js';
import { mergePairs, vertical, horizontal, pillars, bracing, splice, bridge, supports, finish, untile, connectivity, retile } from './post.js';
import { detectSymmetry } from './symmetry.js';
import { PointGrid } from './nn.js';
import { visibleSamples } from './visibility.js';
import { snapToPalette } from './colors.js';
import CATALOG from './catalog.js';
import EXT from './catalog_ext.js';

/** limited = the hand-picked core set; extended = core + every extra solid shape measured from LDraw */
export const FULL_CATALOG = [...CATALOG, ...EXT];
export const catalogFor = (o) => (o && o.partSet === 'extended' ? FULL_CATALOG : CATALOG);
export { DEFAULTS, CATALOG };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** shared preparation (samples, symmetry, padded ray-cast volumes per parity) and the list of grid-phase jobs */
export function setup(model, opts) {
  const o = { ...DEFAULTS, ...opts }, T = {};
  let t = now();
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
  const S = solve(ctx.pres[par], cat, ox, oz, ctx.o);
  const mt = metrics(S);
  return mt.iou - 0.002 * mt.pieces;
}

/** finish the best job: colours, merges, pillars, connectivity post-process, studs finish, palette, stats */
export function finishJob(ctx, job, cat = catalogFor(ctx.o), log = () => {}) {
  const { o, m, sym, symOk } = ctx, T = { ...ctx.T };
  let t = now();
  const [par, ox, oz] = job, pre = ctx.pres[par];
  const S = solve(pre, cat, ox, oz, o, log);
  const off = [ox + pre.shift[0], oz + pre.shift[1]];
  T.solve = now() - t; t = now();
  // cheat colour: mean colour of the nearest surface samples, in the same normalised frame
  // only surfaces visible from outside colour the skin (interior ice cream under a glass wall must not bleed through)
  let cpts = m.pts, ccols = m.cols;
  if (o.colorVisible ?? true) {
    const vis = visibleSamples(m.tris, m.pts), keep = []; for (let i = 0; i < vis.length; i++) if (vis[i]) keep.push(i);
    if (keep.length > 50) { cpts = new Float32Array(keep.length * 3); ccols = new Float32Array(keep.length * 3); keep.forEach((i, j) => { for (let c = 0; c < 3; c++) { cpts[j * 3 + c] = m.pts[i * 3 + c]; ccols[j * 3 + c] = m.cols[i * 3 + c]; } }); }
  }
  const nm = normalize(m.tris, cpts, o.studs, off[0], off[1], o.ref);
  const grid = new PointGrid(nm.pts, 64);
  const cols = ccols;
  for (const p of S.pieces) p.rgb = colourAt(grid, cols, p, o.colorK);
  T.colour = now() - t; t = now();
  const post = {};
  const before = S.pieces.length;
  if (o.mergeVertical) post.vertical = vertical(S, cat, o.colorTol);
  if (o.mergeHorizontal) post.horizontal = horizontal(S, cat, 'plate', o.colorTol) + horizontal(S, cat, 'tile', o.colorTol);
  if (o.retile) post.retile = retile(S, cat, o.colorTol);                              // stacked plates of any footprint -> bricks
  post.merged = before - S.pieces.length;
  if (o.pillars) post.pillars = pillars(S, cat, o.pillarMinLevels);
  post.connectedBefore = connectivity(S);
  if (o.bracing) post.brace = bracing(S, cat, o);
  if (o.splice) post.splice = splice(S, cat, o);
  if (o.bridge) post.bridge = bridge(S, cat, o);
  if (o.supports) post.supports = supports(S, cat, o).columns;
  if (o.bracing && o.supports) post.brace += bracing(S, cat, o);
  if (o.mergeVertical) post.vertical2 = vertical(S, cat, o.colorTol);                  // final re-pack: bracing / splice / bridge pieces can merge too
  if (o.retile) post.retile2 = retile(S, cat, o.colorTol);
  post.untiled = untile(S, cat);                                                        // smooth tiles only on the outside skin
  if (o.mergeHorizontal) post.pairs = mergePairs(S, cat, 'plate', o.colorTol) + mergePairs(S, cat, 'brick', o.colorTol);          // union-only merges: connectivity cannot get worse
  if (o.finish) { post.finish = finish(S, cat, o.finishBricks); if (o.mergeHorizontal) mergePairs(S, cat, 'tile', o.colorTol); }
  for (const p of S.pieces) if (!p.rgb) p.rgb = colourAt(grid, cols, p, o.colorK);
  if (o.palette === 'lego') for (const p of S.pieces) { if (p.kind === 'support') continue; const c = snapToPalette(p.rgb); p.rgb = c.rgb; p.code = c.code; p.colorName = c.name; }
  T.post = now() - t;
  const mt = metrics(S), con = connectivity(S);
  let mirrored = null;
  if (S.mirror) {
    const [ax, c2] = S.mirror, keys = new Set(S.pieces.map((q) => `${q.id},${q.b},${q.j},${q.i},${q.w},${q.d}`));
    mirrored = S.pieces.filter((q) => keys.has(`${q.id},${q.b},${ax === 'z' ? c2 - q.j - q.d : q.j},${ax === 'x' ? c2 - q.i - q.w : q.i},${q.w},${q.d}`)).length / Math.max(1, S.pieces.length);
  }
  const srcTris = normalize(m.tris, null, o.studs, off[0], off[1], o.ref).tris;
  return {
    pieces: S.pieces, dims: S.dims, offset: off, scale: nm.s, srcTris, srcCols: m.vcols,
    metrics: { ...mt, ...con }, post, timing: T, islands: pre.islands, crust: pre.crust,
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
  progress('finishing', 1);
  const r = finishJob(ctx, best, cat, log);
  r.timing.total = now() - t0; r.job = best; r.options = ctx.o;
  return r;
}
