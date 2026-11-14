#!/usr/bin/env node
// Genetic Algorithm hyperparameter trainer for BrickPack over a batch of 3D models.
//
// Usage:
//   node cli/train_policy.mjs --models ../dataset/models --studs 10 --pop 6 --gens 3 --out ./out/policy.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelFile } from '../src/mesh_io.js';
import { deserializeCatalog, buildVariants, PACK_KINDS } from '../src/dictionary.js';
import { frameFor, targetField, octaves } from '../src/target.js';
import { thickenThin } from '../src/thin.js';
import { packIoU } from '../src/pack.js';
import { fidelity } from '../src/metrics.js';
import { POLICY } from '../src/policy.js';
import { train } from '../src/ga.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = path.resolve(__dirname, '../../dataset');

function parseArgs(argv) {
  const args = {
    models: path.join(DATASET_DIR, 'models'),
    catalog: path.join(DATASET_DIR, 'catalog_99.json'),
    studs: 10,
    pop: 6,
    gens: 3,
    out: './out/policy.json',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--models') args.models = argv[++i];
    else if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '--studs') args.studs = Number(argv[++i]);
    else if (a === '--pop') args.pop = Number(argv[++i]);
    else if (a === '--gens') args.gens = Number(argv[++i]);
    else if (a === '--out' || a === '-o') args.out = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const modelDir = path.resolve(args.models);
  const catalog = deserializeCatalog(fs.readFileSync(path.resolve(args.catalog), 'utf8'));
  const { byKey, list } = buildVariants(catalog, { kinds: PACK_KINDS });

  const files = fs.readdirSync(modelDir)
    .filter((f) => /\.(obj|glb|ply)$/i.test(f))
    .sort()
    .slice(0, 4);

  const cache = new Map();
  const batch = [];
  for (const f of files) {
    const model = await loadModelFile(path.join(modelDir, f));
    const frame = frameFor(model, args.studs);
    const T = targetField(model, frame);
    const thin = thickenThin(T);
    const TP = thin.added ? { ...T, t: thin.t } : T;
    const F = octaves(TP, [0, 1.5, 3, 6]);
    cache.set(f, { T, TP, F, phase: thin.added ? thin.phase : null });
    batch.push({ name: f, studs: args.studs });
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const state = await train({
    file: outPath,
    batch,
    pop: args.pop,
    gens: args.gens,
    seedGenomes: [POLICY],
    evaluate: async (genes, item) => {
      const c = cache.get(item.name);
      const policy = { ...POLICY, ...genes, lnsIters: 600, lnsPasses: 2 };
      const best = packIoU(c.TP, c.F, list, { policy, objective: 'iou', thetaIters: 3, thetaLns: 120, phase: c.phase, measure: (pcs, ph) => fidelity(pcs, byKey, c.TP, ph).softIoU });
      const m = fidelity(best.r.pieces, byKey, c.T, best.r.phase);
      return { softIoU: m.softIoU, components: m.components, pieces: m.pieces };
    },
    log: (m) => console.log(m),
  });

  console.log(`Best policy (fitness ${state.best.fitness}) -> ${outPath}`);
  console.log(JSON.stringify(state.best.genes, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
