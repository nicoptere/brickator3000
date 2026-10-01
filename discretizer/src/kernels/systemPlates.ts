import type { BaseKernelDefinition } from './types';
import { createSolidMask, createRoundMask, createStandardConnectors } from './kernelHelpers';

/**
 * LEGO System Standard Plates
 * Height = 1 plate = 8 LDU = 3.2 mm.
 * Both top studs and bottom tubes enabled for mechanical interlocking.
 */
export const SYSTEM_PLATES: BaseKernelDefinition[] = [
  // 1-wide plates
  {
    partId: '3024',
    name: 'Plate 1 x 1',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 1.0,
    connectors: createStandardConnectors(1, 1, 1, true, true),
    occupancyMask: createSolidMask(1, 1, 1)
  },
  {
    partId: '3023',
    name: 'Plate 1 x 2',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 2.0,
    connectors: createStandardConnectors(1, 2, 1, true, true),
    occupancyMask: createSolidMask(1, 2, 1)
  },
  {
    partId: '3623',
    name: 'Plate 1 x 3',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 3, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 2.5,
    connectors: createStandardConnectors(1, 3, 1, true, true),
    occupancyMask: createSolidMask(1, 3, 1)
  },
  {
    partId: '3710',
    name: 'Plate 1 x 4',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 3.0,
    connectors: createStandardConnectors(1, 4, 1, true, true),
    occupancyMask: createSolidMask(1, 4, 1)
  },
  {
    partId: '3666',
    name: 'Plate 1 x 6',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 6, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 6, 1, true, true),
    occupancyMask: createSolidMask(1, 6, 1)
  },
  {
    partId: '3460',
    name: 'Plate 1 x 8',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 8, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 5.0,
    connectors: createStandardConnectors(1, 8, 1, true, true),
    occupancyMask: createSolidMask(1, 8, 1)
  },

  // 2-wide plates
  {
    partId: '3022',
    name: 'Plate 2 x 2',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 3.0,
    connectors: createStandardConnectors(2, 2, 1, true, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },
  {
    partId: '3021',
    name: 'Plate 2 x 3',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 3, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 3.8,
    connectors: createStandardConnectors(2, 3, 1, true, true),
    occupancyMask: createSolidMask(2, 3, 1)
  },
  {
    partId: '3020',
    name: 'Plate 2 x 4',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 4.5,
    connectors: createStandardConnectors(2, 4, 1, true, true),
    occupancyMask: createSolidMask(2, 4, 1)
  },
  {
    partId: '3795',
    name: 'Plate 2 x 6',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 6, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 5.5,
    connectors: createStandardConnectors(2, 6, 1, true, true),
    occupancyMask: createSolidMask(2, 6, 1)
  },
  {
    partId: '3034',
    name: 'Plate 2 x 8',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 8, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 6.5,
    connectors: createStandardConnectors(2, 8, 3, true, true),
    occupancyMask: createSolidMask(2, 8, 1)
  },
  {
    partId: '2420',
    name: 'Plate 2 x 2 Corner',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 3.2,
    connectors: createStandardConnectors(2, 2, 1, true, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },

  // Large base & structural plates
  {
    partId: '3031',
    name: 'Plate 4 x 4',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [4, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 7.0,
    connectors: createStandardConnectors(4, 4, 1, true, true),
    occupancyMask: createSolidMask(4, 4, 1)
  },
  {
    partId: '3032',
    name: 'Plate 4 x 6',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [4, 6, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 8.0,
    connectors: createStandardConnectors(4, 6, 1, true, true),
    occupancyMask: createSolidMask(4, 6, 1)
  },
  {
    partId: '3035',
    name: 'Plate 4 x 8',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [4, 8, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 9.0,
    connectors: createStandardConnectors(4, 8, 1, true, true),
    occupancyMask: createSolidMask(4, 8, 1)
  },
  {
    partId: '3030',
    name: 'Plate 4 x 10',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [4, 10, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 10.0,
    connectors: createStandardConnectors(4, 10, 1, true, true),
    occupancyMask: createSolidMask(4, 10, 1)
  },
  {
    partId: '3036',
    name: 'Plate 6 x 8',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [6, 8, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 11.0,
    connectors: createStandardConnectors(6, 8, 1, true, true),
    occupancyMask: createSolidMask(6, 8, 1)
  },

  // Round Plates
  {
    partId: '6141',
    name: 'Plate 1 x 1 Round',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 1.5,
    connectors: createStandardConnectors(1, 1, 1, true, true),
    occupancyMask: createRoundMask(1, 1, 1)
  },
  {
    partId: '4032',
    name: 'Plate 2 x 2 Round with Axle Hole',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 3.5,
    connectors: createStandardConnectors(2, 2, 1, true, true),
    occupancyMask: createRoundMask(2, 2, 1)
  }
];
