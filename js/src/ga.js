// A genetic algorithm over the packer's policy (pack.js DEFAULT_POLICY), trained on a batch of (model, scale) pairs. The whole
// state - generation, population with fitness and per-run scores, history, best - lives in one JSON file, rewritten after every
// evaluation, so a run can be stopped and resumed, and the best policy is the file the packer reads (out/ga/best.json).
// fitness(policy) = mean over the batch of  soft IoU - wComp x (components - 1) - wPieces x pieces
// Operators: tournament selection (k = 3), uniform crossover, Gaussian mutation in normalised gene space, one elite.

export const GENES = {
  lambda: [0.5, 12], core: [0.8, 1.0], coreCells: [6, 24, 'int'], coreOctave: [0, 3, 'int'],
  lnsRadius: [1, 2, 'int'], noise: [0, 0.6], connect: [0, 600],
};
const clamp = (g, x) => { const [a, b, t] = GENES[g]; x = Math.min(b, Math.max(a, x)); return t === 'int' ? Math.round(x) : +x.toFixed(4); };
const mul = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function randomGenome(rnd) { const g = {}; for (const [k, [a, b]] of Object.entries(GENES)) g[k] = clamp(k, a + rnd() * (b - a)); return g; }
export function crossover(a, b, rnd) { const g = {}; for (const k of Object.keys(GENES)) g[k] = rnd() < 0.5 ? a[k] : b[k]; return g; }
export function mutate(g, rnd, rate = 0.3, sigma = 0.15) {
  const o = { ...g };
  for (const [k, [a, b]] of Object.entries(GENES)) if (rnd() < rate) { const n = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); o[k] = clamp(k, o[k] + n * sigma * (b - a)); }
  return o;
}

/**
 * train({ file, batch: [{ name, studs }], evaluate: (genome, item) => ({ softIoU, components, pieces }), pop, gens, seed, seedGenomes, weights, log })
 * resumes from `file` when it exists (same batch)
 */
export async function train({ file = null, batch, evaluate, pop = 8, gens = 4, seed = 7, seedGenomes = [], weights = { comp: 0.004, pieces: 0.00002 }, log = console.log, onStep = null }) {
  const rnd = mul(seed);
  const fsMod = file && typeof process !== 'undefined' && process.versions?.node ? await import('node:fs') : null;
  let S = fsMod && fsMod.existsSync(file) ? JSON.parse(fsMod.readFileSync(file, 'utf8')) : null;
  if (!S || JSON.stringify(S.batch) !== JSON.stringify(batch)) {
    const genomes = [...seedGenomes.map((g) => { const o = {}; for (const k of Object.keys(GENES)) o[k] = clamp(k, g[k] ?? (GENES[k][0] + GENES[k][1]) / 2); return o; })];
    while (genomes.length < pop) genomes.push(randomGenome(rnd));
    S = { batch, weights, gen: 0, pop: genomes.map((g) => ({ genes: g, fitness: null, runs: [] })), history: [], best: null };
  }
  const save = () => { if (fsMod && file) fsMod.writeFileSync(file, JSON.stringify(S, null, 1)); };
  const fit = (runs) => runs.reduce((s, r) => s + r.softIoU - S.weights.comp * (r.components - 1) - S.weights.pieces * r.pieces, 0) / runs.length;
  for (; S.gen < gens; ) {
    for (const ind of S.pop) {
      if (ind.fitness !== null) continue;
      ind.runs = [];
      for (const item of batch) { const r = await evaluate(ind.genes, item); ind.runs.push({ ...item, softIoU: +r.softIoU.toFixed(4), components: r.components, pieces: r.pieces }); }
      ind.fitness = +fit(ind.runs).toFixed(5);
      if (!S.best || ind.fitness > S.best.fitness) S.best = { genes: ind.genes, fitness: ind.fitness, gen: S.gen, runs: ind.runs };
      log(`gen ${S.gen} · fitness ${ind.fitness.toFixed(4)} · ${JSON.stringify(ind.genes)}`);
      if (onStep) onStep(S);
      save();
    }
    const sorted = S.pop.slice().sort((a, b) => b.fitness - a.fitness), mean = sorted.reduce((s, x) => s + x.fitness, 0) / sorted.length;
    S.history.push({ gen: S.gen, best: sorted[0].fitness, mean: +mean.toFixed(5) });
    log(`== generation ${S.gen}: best ${sorted[0].fitness.toFixed(4)}, mean ${mean.toFixed(4)}`);
    const pick = () => { let b = null; for (let k = 0; k < 3; k++) { const c = S.pop[(rnd() * S.pop.length) | 0]; if (!b || c.fitness > b.fitness) b = c; } return b; };
    const next = [{ genes: sorted[0].genes, fitness: sorted[0].fitness, runs: sorted[0].runs }];
    while (next.length < pop) next.push({ genes: mutate(crossover(pick().genes, pick().genes, rnd), rnd), fitness: null, runs: [] });
    S.pop = next; S.gen++; save();
  }
  return S;
}
