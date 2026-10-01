import type { BaseKernelDefinition } from './types';
import { createRoundMask, createStandardConnectors } from './kernelHelpers';

/**
 * LEGO System Cylindrical Canisters, Cones, and Hemispherical Radar Dishes
 */
export const SYSTEM_ROUND: BaseKernelDefinition[] = [
  // Cylindrical Canisters & Round Uprights
  {
    partId: '3062b',
    name: 'Brick 1 x 1 Round with Open Stud',
    system: 'SYSTEM',
    category: 'ROUND_CANISTER',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 4,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 1, 3, true, true),
    occupancyMask: createRoundMask(1, 1, 3)
  },
  {
    partId: '3941',
    name: 'Brick 2 x 2 Round',
    system: 'SYSTEM',
    category: 'ROUND_CANISTER',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 4,
    weightBonus: 6.5,
    connectors: createStandardConnectors(2, 2, 3, true, true),
    occupancyMask: createRoundMask(2, 2, 3)
  },
  {
    partId: '6222',
    name: 'Brick 4 x 4 Round with Pin Holes',
    system: 'SYSTEM',
    category: 'ROUND_CANISTER',
    baseSize: [4, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 4,
    weightBonus: 9.0,
    connectors: createStandardConnectors(4, 4, 3, true, true),
    occupancyMask: createRoundMask(4, 4, 3)
  },

  // Cones
  {
    partId: '4589',
    name: 'Cone 1 x 1',
    system: 'SYSTEM',
    category: 'ROUND_CANISTER',
    baseSize: [1, 1, 3],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 4,
    weightBonus: 3.0,
    connectors: createStandardConnectors(1, 1, 3, true, true),
    occupancyMask: createRoundMask(1, 1, 3)
  },
  {
    partId: '3942c',
    name: 'Cone 2 x 2',
    system: 'SYSTEM',
    category: 'ROUND_CANISTER',
    baseSize: [2, 2, 3],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 4,
    weightBonus: 4.5,
    connectors: createStandardConnectors(2, 2, 3, true, true),
    occupancyMask: createRoundMask(2, 2, 3)
  },

  // Hemispherical Apex Domes & Inverted Radar Dishes (Tier 1)
  {
    partId: '4740',
    name: 'Radar Dish 2 x 2 Inverted',
    system: 'SYSTEM',
    category: 'ORGANIC_DOME',
    baseSize: [2, 2, 2], // 2x2 studs, 2 plates high
    targetNormal: [0, 1, 0], // Skyward dome apex
    minNormalDot: 0.85,
    tier: 1,
    weightBonus: 10.0,
    connectors: createStandardConnectors(2, 2, 2, false, true),
    occupancyMask: createRoundMask(2, 2, 2)
  },
  {
    partId: '43898',
    name: 'Radar Dish 3 x 3 Inverted',
    system: 'SYSTEM',
    category: 'ORGANIC_DOME',
    baseSize: [3, 3, 2],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 1,
    weightBonus: 11.0,
    connectors: createStandardConnectors(3, 3, 2, false, true),
    occupancyMask: createRoundMask(3, 3, 2)
  },
  {
    partId: '3960',
    name: 'Radar Dish 4 x 4 Inverted',
    system: 'SYSTEM',
    category: 'ORGANIC_DOME',
    baseSize: [4, 4, 3],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 1,
    weightBonus: 12.0,
    connectors: createStandardConnectors(4, 4, 3, false, true),
    occupancyMask: createRoundMask(4, 4, 3)
  }
];
