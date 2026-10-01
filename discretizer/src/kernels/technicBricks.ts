import type { BaseKernelDefinition } from './types';
import { createSolidMask, createTechnicBrickConnectors } from './kernelHelpers';

/**
 * LEGO Technic Bricks with Pin Holes
 * Hybrid System/Technic structural elements with top studs, bottom tubes, and horizontal pin holes.
 */
export const TECHNIC_BRICKS: BaseKernelDefinition[] = [
  {
    partId: '6541',
    name: 'Technic Brick 1 x 1 with Hole',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 2.0,
    connectors: createTechnicBrickConnectors(1, 1, 3, 1),
    occupancyMask: createSolidMask(1, 1, 3)
  },
  {
    partId: '3700',
    name: 'Technic Brick 1 x 2 with Hole',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.0,
    connectors: createTechnicBrickConnectors(1, 2, 3, 1),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32000',
    name: 'Technic Brick 1 x 2 with 2 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createTechnicBrickConnectors(1, 2, 3, 2),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '3701',
    name: 'Technic Brick 1 x 4 with 3 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.5,
    connectors: createTechnicBrickConnectors(1, 4, 3, 3),
    occupancyMask: createSolidMask(1, 4, 3)
  },
  {
    partId: '3894',
    name: 'Technic Brick 1 x 6 with 5 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 6, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.0,
    connectors: createTechnicBrickConnectors(1, 6, 3, 5),
    occupancyMask: createSolidMask(1, 6, 3)
  },
  {
    partId: '3702',
    name: 'Technic Brick 1 x 8 with 7 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 8, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 9.0,
    connectors: createTechnicBrickConnectors(1, 8, 3, 7),
    occupancyMask: createSolidMask(1, 8, 3)
  },
  {
    partId: '2730',
    name: 'Technic Brick 1 x 10 with 9 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 10, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 10.0,
    connectors: createTechnicBrickConnectors(1, 10, 3, 9),
    occupancyMask: createSolidMask(1, 10, 3)
  },
  {
    partId: '3895',
    name: 'Technic Brick 1 x 12 with 11 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 12, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 11.0,
    connectors: createTechnicBrickConnectors(1, 12, 3, 11),
    occupancyMask: createSolidMask(1, 12, 3)
  },
  {
    partId: '32018',
    name: 'Technic Brick 1 x 14 with 13 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 14, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 11.5,
    connectors: createTechnicBrickConnectors(1, 14, 3, 13),
    occupancyMask: createSolidMask(1, 14, 3)
  },
  {
    partId: '3703',
    name: 'Technic Brick 1 x 16 with 15 Holes',
    system: 'TECHNIC',
    category: 'TECHNIC_BRICK',
    baseSize: [1, 16, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 12.0,
    connectors: createTechnicBrickConnectors(1, 16, 3, 15),
    occupancyMask: createSolidMask(1, 16, 3)
  }
];
