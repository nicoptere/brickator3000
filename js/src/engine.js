// BrickPack End-to-End Engine (Browser WebGPU/WebGL2 + Node.js CPU):
//   - Accepts mesh `{ tris, vcols, hasColor }` OR pre-encoded continuous SDF `{ header, data }`
//   - Encodes/samples 4-LDU sub-voxel coverage field + thin opening + Gaussian octaves
//   - Runs Dinkelbach Soft-IoU + SAT + sparse deficit + LNS + stud bridging
//   - Maps per-brick colors onto official LDraw opaque colors via CIEDE2000 perceptual distance

import { frameFor, targetField, targetFieldAsync, octaves, encodeSdfVolume, targetFromSdfVolume } from './target.js';
import { buildVariants, PACK_KINDS, serializeCatalog, deserializeCatalog, trainPartFromLDrawGeom, trainPartFromMesh, parseLDrawDat } from './dictionary.js';
import { packIoU, packIoUAsync } from './pack.js';
import { fidelity } from './metrics.js';
import { POLICY } from './policy.js';
import { thickenThin } from './thin.js';
import { createPalette, FALLBACK_COLORS } from './colors.js';
import { nearestTriangleColor } from './mesh_io.js';
import { STUD, PLATE, H } from './units.js';

export const EFFORT = {
  quick: { lnsPasses: 2, lnsIters: 800, thetaIters: 3, thetaLns: 150 },
  normal: { lnsPasses: 6, lnsIters: 3000, thetaIters: 4, thetaLns: 300 },
  thorough: { lnsPasses: 16, lnsIters: 6000, thetaIters: 5, thetaLns: 500 },
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function colorizePieces(pieces, byKey, model, frame, phase, palette, defaultRgb = [160, 165, 169]) {
  const ox = phase ? phase[0] * H : 0, oz = phase ? phase[1] * H : 0;
  const fallback = palette.snap(defaultRgb);
  if (!model || !model.hasColor || !model.tris?.length) {
    return pieces.map((p) => {
      const v = byKey.get(`${p.id}|${p.rot || 0}`);
      return {
        ...p,
        code: fallback.code,
        colorName: fallback.name,
        hex: fallback.hex,
        rgb: fallback.rgb,
        studs: p.studs || v?.studs || [],
      };
    });
  }
  const { k, t } = frame;
  return pieces.map((p) => {
    const v = byKey.get(`${p.id}|${p.rot || 0}`);
    const bx = (p.i + p.w * 0.5) * STUD + ox;
    const by = (p.b + p.h * 0.5) * PLATE;
    const bz = (p.j + p.d * 0.5) * STUD + oz;
    const mx = (bx - t[0]) / k, my = (by - t[1]) / k, mz = (bz - t[2]) / k;
    const srgb = nearestTriangleColor(mx, my, mz, model.tris, model.vcols, model);
    const col = palette.snap(srgb);
    return {
      ...p,
      code: col.code,
      colorName: col.name,
      hex: col.hex,
      rgb: col.rgb,
      studs: p.studs || v?.studs || [],
    };
  });
}

/**
 * Pack either a mesh `{ tris, vcols, hasColor }` or an encoded SDF `{ header, data }` into LEGO bricks.
 */
export async function packModelAsync(input, opts = {}) {
  const t0 = now();
  const studs = opts.studs || 16;
  const catalog = opts.catalog || [];
  if (!catalog.length) throw new Error('packModelAsync requires a non-empty `catalog`');
  const eff = EFFORT[opts.effort] || EFFORT.normal;
  const policy = { ...POLICY, lnsIters: eff.lnsIters, lnsPasses: opts.passes > 0 ? opts.passes : eff.lnsPasses, ...(opts.policy || {}) };
  const log = opts.log || (() => {});
  const progress = opts.progress || (() => {});
  const gpu = opts.gpu || null;

  progress('target field', 0.05);
  let T, model = null;
  if (input && input.header && input.data) {
    T = targetFromSdfVolume(input.header, input.data, studs, { ref: opts.ref || 'min3' });
  } else {
    model = input;
    const frame = frameFor(model, studs, { ref: opts.ref || 'min3' });
    T = gpu ? await targetFieldAsync(model, frame, { gpu, log }) : targetField(model, frame, { log });
  }

  const thin = opts.keepThin !== false ? thickenThin(T) : null;
  const TP = thin && thin.added ? { ...T, t: thin.t } : T;
  const SIG = [0, 1.5, 3, 6], coreIdx = Math.min(SIG.length - 1, Math.max(0, policy.coreOctave | 0));
  const F = SIG.map((s, i) => (i === 0 ? TP.t : i === coreIdx ? octaves(TP, [s])[0] : null));
  const t1 = now();

  const { byKey, list } = buildVariants(catalog, { kinds: opts.kinds || PACK_KINDS });
  const packOpts = {
    policy,
    objective: opts.objective || 'iou',
    thetaIters: eff.thetaIters,
    thetaLns: eff.thetaLns,
    phase: TP === T ? null : thin.phase,
    measure: (pieces, phase) => fidelity(pieces, byKey, TP, phase).softIoU,
    log,
    progress: (st, f) => progress(st, 0.1 + 0.8 * f),
  };

  const best = gpu
    ? await packIoUAsync(TP, F, list, { ...packOpts, gpu })
    : packIoU(TP, F, list, packOpts);

  const { r: lay } = best;
  const metrics = fidelity(lay.pieces, byKey, T, lay.phase);
  const t2 = now();

  const palette = createPalette(opts.colors || FALLBACK_COLORS);
  const coloredPieces = colorizePieces(lay.pieces, byKey, model, T.frame, lay.phase, palette, opts.defaultRgb || [160, 165, 169]);
  const t3 = now();

  progress('done', 1);
  return {
    pieces: coloredPieces,
    frame: T.frame,
    phase: lay.phase,
    target: T,
    pack: {
      theta: +best.theta.toFixed(4),
      trace: best.trace,
      compute: gpu ? gpu.label : 'CPU',
      pieces: metrics.pieces,
      softIoU: +metrics.softIoU.toFixed(4),
      l1: +metrics.l1.toFixed(4),
      components: metrics.components,
      bridges: lay.stats.bridges,
      pruned: lay.stats.pruned,
      rounds: lay.stats.lnsIters,
      surfaceCells: lay.stats.surfaceCells,
      phase: lay.phase,
      thin: thin ? { features: thin.features, thin: thin.thin, added: thin.added } : null,
      ms: { target: Math.round(t1 - t0), search: Math.round(t2 - t1), finish: Math.round(t3 - t2), total: Math.round(t3 - t0) },
    },
  };
}

export {
  frameFor,
  targetField,
  targetFieldAsync,
  encodeSdfVolume,
  targetFromSdfVolume,
  buildVariants,
  PACK_KINDS,
  serializeCatalog,
  deserializeCatalog,
  trainPartFromLDrawGeom,
  trainPartFromMesh,
  parseLDrawDat,
  createPalette,
  FALLBACK_COLORS,
  STUD,
  PLATE,
};
