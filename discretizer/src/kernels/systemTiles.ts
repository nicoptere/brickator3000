import type { BaseKernelDefinition } from './types';
import { createSolidMask, createRoundMask, createStandardConnectors } from './kernelHelpers';

/**
 * LEGO System Studless Flat Tiles
 * Height = 1 plate = 8 LDU = 3.2 mm.
 * Smooth top finish (no studs) with female bottom tubes.
 */
export const SYSTEM_TILES: BaseKernelDefinition[] = [
  {
    partId: '3070b',
    name: 'Tile 1 x 1 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 2.0,
    connectors: createStandardConnectors(1, 1, 1, false, true),
    occupancyMask: createSolidMask(1, 1, 1)
  },
  {
    partId: '3069b',
    name: 'Tile 1 x 2 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 2, 1, false, true),
    occupancyMask: createSolidMask(1, 2, 1)
  },
  {
    partId: '63864',
    name: 'Tile 1 x 3 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 3, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 5.0,
    connectors: createStandardConnectors(1, 3, 1, false, true),
    occupancyMask: createSolidMask(1, 3, 1)
  },
  {
    partId: '2431',
    name: 'Tile 1 x 4 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 6.0,
    connectors: createStandardConnectors(1, 4, 1, false, true),
    occupancyMask: createSolidMask(1, 4, 1)
  },
  {
    partId: '6636',
    name: 'Tile 1 x 6 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 6, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 7.5,
    connectors: createStandardConnectors(1, 6, 1, false, true),
    occupancyMask: createSolidMask(1, 6, 1)
  },
  {
    partId: '4162',
    name: 'Tile 1 x 8 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 8, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 8.5,
    connectors: createStandardConnectors(1, 8, 1, false, true),
    occupancyMask: createSolidMask(1, 8, 1)
  },
  {
    partId: '3068b',
    name: 'Tile 2 x 2 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 6.5,
    connectors: createStandardConnectors(2, 2, 1, false, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },
  {
    partId: '87079',
    name: 'Tile 2 x 4 Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [2, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 8.0,
    connectors: createStandardConnectors(2, 4, 1, false, true),
    occupancyMask: createSolidMask(2, 4, 1)
  },
  {
    partId: '98138',
    name: 'Tile 1 x 1 Round Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 3.0,
    connectors: createStandardConnectors(1, 1, 1, false, true),
    occupancyMask: createRoundMask(1, 1, 1)
  },
  {
    partId: '14769',
    name: 'Tile 2 x 2 Round Flat',
    system: 'SYSTEM',
    category: 'TILE_FLAT',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 7,
    weightBonus: 5.5,
    connectors: createStandardConnectors(2, 2, 1, false, true),
    occupancyMask: createRoundMask(2, 2, 1)
  },
  {
    partId: '27925',
    name: 'Tile 2 x 2 Macaroni Curved',
    system: 'SYSTEM',
    category: 'MACARONI_WEDGE',
    baseSize: [2, 2, 1],
    targetNormal: [0.707, 1.0, 0.707],
    minNormalDot: 0.50,
    tier: 3,
    weightBonus: 6.0,
    connectors: createStandardConnectors(2, 2, 1, false, true),
    occupancyMask: createSolidMask(2, 2, 1)
  }
];
