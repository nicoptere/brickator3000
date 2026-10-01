import type { BaseKernelDefinition } from './types';
import { createSolidMask, createStandardConnectors } from './kernelHelpers';

/**
 * LEGO System Standard Bricks
 * Standard height = 3 plates = 24 LDU = 9.6 mm.
 */
export const SYSTEM_BRICKS: BaseKernelDefinition[] = [
  {
    partId: '3005',
    name: 'Brick 1 x 1',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 1.0,
    connectors: createStandardConnectors(1, 1, 3, true, true),
    occupancyMask: createSolidMask(1, 1, 3)
  },
  {
    partId: '3004',
    name: 'Brick 1 x 2',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 3.0,
    connectors: createStandardConnectors(1, 2, 3, true, true),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '3622',
    name: 'Brick 1 x 3',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createStandardConnectors(1, 3, 3, true, true),
    occupancyMask: createSolidMask(1, 3, 3)
  },
  {
    partId: '3010',
    name: 'Brick 1 x 4',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.0,
    connectors: createStandardConnectors(1, 4, 3, true, true),
    occupancyMask: createSolidMask(1, 4, 3)
  },
  {
    partId: '3009',
    name: 'Brick 1 x 6',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 6, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.5,
    connectors: createStandardConnectors(1, 6, 3, true, true),
    occupancyMask: createSolidMask(1, 6, 3)
  },
  {
    partId: '3008',
    name: 'Brick 1 x 8',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [1, 8, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.5,
    connectors: createStandardConnectors(1, 8, 3, true, true),
    occupancyMask: createSolidMask(1, 8, 3)
  },
  {
    partId: '3003',
    name: 'Brick 2 x 2',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.0,
    connectors: createStandardConnectors(2, 2, 3, true, true),
    occupancyMask: createSolidMask(2, 2, 3)
  },
  {
    partId: '3002',
    name: 'Brick 2 x 3',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.0,
    connectors: createStandardConnectors(2, 3, 3, true, true),
    occupancyMask: createSolidMask(2, 3, 3)
  },
  {
    partId: '3001',
    name: 'Brick 2 x 4',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 9.0,
    connectors: createStandardConnectors(2, 4, 3, true, true),
    occupancyMask: createSolidMask(2, 4, 3)
  },
  {
    partId: '2456',
    name: 'Brick 2 x 6',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 6, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 10.0,
    connectors: createStandardConnectors(2, 6, 3, true, true),
    occupancyMask: createSolidMask(2, 6, 3)
  },
  {
    partId: '3007',
    name: 'Brick 2 x 8',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 8, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 11.0,
    connectors: createStandardConnectors(2, 8, 3, true, true),
    occupancyMask: createSolidMask(2, 8, 3)
  },
  {
    partId: '2357',
    name: 'Brick 2 x 2 Corner',
    system: 'SYSTEM',
    category: 'BRICK_STANDARD',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.5,
    connectors: createStandardConnectors(2, 2, 3, true, true),
    occupancyMask: createSolidMask(2, 2, 3)
  }
];
