import type { BaseKernelDefinition, KernelCategory, LegoSystem } from './types';
import { SYSTEM_BRICKS } from './systemBricks';
import { SYSTEM_PLATES } from './systemPlates';
import { SYSTEM_TILES } from './systemTiles';
import { SYSTEM_SLOPES } from './systemSlopes';
import { SYSTEM_ROUND } from './systemRound';
import { TECHNIC_BRICKS } from './technicBricks';
import { TECHNIC_BEAMS } from './technicBeams';
import { TECHNIC_AXLES_PINS } from './technicAxlesPins';
import { TECHNIC_GEARS } from './technicGears';

/**
 * LEGO System Part Catalog (Bricks, Plates, Tiles, Slopes, Cylinders, Radar Dishes)
 */
export const SYSTEM_CATALOG: BaseKernelDefinition[] = [
  ...SYSTEM_BRICKS,
  ...SYSTEM_PLATES,
  ...SYSTEM_TILES,
  ...SYSTEM_SLOPES,
  ...SYSTEM_ROUND
];

/**
 * LEGO Technic Part Catalog (Bricks with Holes, Studless Beams, Axles, Pins, Connectors, Gears)
 */
export const TECHNIC_CATALOG: BaseKernelDefinition[] = [
  ...TECHNIC_BRICKS,
  ...TECHNIC_BEAMS,
  ...TECHNIC_AXLES_PINS,
  ...TECHNIC_GEARS
];

/**
 * Master Unified Kernel Database for Plate-Level LEGO Discretization.
 * Combines all authentic LEGO System and LEGO Technic base definitions.
 */
export const KERNEL_CATALOG: BaseKernelDefinition[] = [
  ...SYSTEM_CATALOG,
  ...TECHNIC_CATALOG
];

// Indexed lookup dictionaries for O(1) retrieval
export const KERNEL_MAP_BY_ID = new Map<string, BaseKernelDefinition>(
  KERNEL_CATALOG.map((def) => [def.partId, def])
);

export const KERNELS_BY_SYSTEM = new Map<LegoSystem, BaseKernelDefinition[]>([
  ['SYSTEM', SYSTEM_CATALOG],
  ['TECHNIC', TECHNIC_CATALOG]
]);

/**
 * Retrieves a kernel definition by its official LDraw part ID.
 */
export function getKernel(partId: string): BaseKernelDefinition | undefined {
  return KERNEL_MAP_BY_ID.get(partId);
}

/**
 * Filters kernels by LEGO system ('SYSTEM' or 'TECHNIC').
 */
export function getKernelsBySystem(system: LegoSystem): BaseKernelDefinition[] {
  return KERNELS_BY_SYSTEM.get(system) ?? [];
}

/**
 * Filters kernels by functional category.
 */
export function getKernelsByCategory(category: KernelCategory): BaseKernelDefinition[] {
  return KERNEL_CATALOG.filter((k) => k.category === category);
}

/**
 * Filters kernels by priority tier (1 to 7).
 */
export function getKernelsByTier(tier: number): BaseKernelDefinition[] {
  return KERNEL_CATALOG.filter((k) => k.tier === tier);
}

/**
 * Returns structural statistics and summary of the Kernel Database.
 */
export function getKernelDatabaseSummary() {
  const categoryCounts: Record<string, number> = {};
  for (const k of KERNEL_CATALOG) {
    categoryCounts[k.category] = (categoryCounts[k.category] || 0) + 1;
  }

  return {
    totalBaseParts: KERNEL_CATALOG.length,
    systemPartsCount: SYSTEM_CATALOG.length,
    technicPartsCount: TECHNIC_CATALOG.length,
    categoryCounts
  };
}
