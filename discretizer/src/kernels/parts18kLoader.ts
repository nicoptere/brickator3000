import rawParts from './parts18kData.json';
import type { BaseKernelDefinition } from './types';
import {
  createSolidMask,
  createSlopeMask,
  createInvertedSlopeMask,
  createRoundMask,
  createStandardConnectors,
  createSlopeConnectors,
  createInvertedSlopeConnectors
} from './kernelHelpers';

let cachedCatalog: BaseKernelDefinition[] | null = null;

/**
 * Loads and materializes the 18K LDraw parts catalog into active BaseKernelDefinitions.
 * Computes connectors and 3D occupancy masks on-the-fly.
 */
export function get18kKernelCatalog(): BaseKernelDefinition[] {
  if (cachedCatalog) return cachedCatalog;

  cachedCatalog = (rawParts as any[]).map(p => {
    const [w, d, h] = p.baseSize;
    let occupancyMask: boolean[][][];
    let connectors: any[];

    if (p.category === 'SLOPE_CURVED' || p.category === 'SLOPE_45' || p.category === 'CHEESE_SLOPE') {
      occupancyMask = createSlopeMask(w, d, h, '+z');
      connectors = createSlopeConnectors(w, d, h, true, '+z');
    } else if (p.category === 'SLOPE_INVERTED') {
      occupancyMask = createInvertedSlopeMask(w, d, h, '+z');
      connectors = createInvertedSlopeConnectors(w, d, h);
    } else if (p.category === 'ROUND_CANISTER' || p.category === 'ORGANIC_DOME') {
      occupancyMask = createRoundMask(w, d, h);
      connectors = createStandardConnectors(w, d, h, true, true);
    } else if (p.category === 'TILE_FLAT') {
      occupancyMask = createSolidMask(w, d, h);
      connectors = createStandardConnectors(w, d, h, false, true); // No top studs
    } else {
      occupancyMask = createSolidMask(w, d, h);
      connectors = createStandardConnectors(w, d, h, true, true);
    }

    return {
      partId: p.partId,
      name: p.name,
      system: p.system,
      category: p.category,
      baseSize: [w, d, h] as [number, number, number],
      targetNormal: p.targetNormal as [number, number, number],
      minNormalDot: p.minNormalDot,
      tier: p.tier,
      weightBonus: p.weightBonus,
      omrFrequency: p.omrFrequency,
      connectors,
      occupancyMask
    };
  });

  return cachedCatalog;
}
