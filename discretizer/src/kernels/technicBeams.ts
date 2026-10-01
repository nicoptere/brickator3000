import type { BaseKernelDefinition } from './types';
import { createSolidMask, createTechnicBeamConnectors } from './kernelHelpers';

/**
 * LEGO Technic Studless Beams (Liftarms)
 * Modern structural framework elements without top studs, connected exclusively via pin holes.
 */
export const TECHNIC_BEAMS: BaseKernelDefinition[] = [
  {
    partId: '43857',
    name: 'Technic Beam 1 x 2 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 3.0,
    connectors: createTechnicBeamConnectors(2, 3),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32523',
    name: 'Technic Beam 1 x 3 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.5,
    connectors: createTechnicBeamConnectors(3, 3),
    occupancyMask: createSolidMask(1, 3, 3)
  },
  {
    partId: '32449',
    name: 'Technic Beam 1 x 4 Thin',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 4, 1], // 1 plate thin
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.0,
    connectors: createTechnicBeamConnectors(4, 1),
    occupancyMask: createSolidMask(1, 4, 1)
  },
  {
    partId: '32316',
    name: 'Technic Beam 1 x 5 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 5, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.5,
    connectors: createTechnicBeamConnectors(5, 3),
    occupancyMask: createSolidMask(1, 5, 3)
  },
  {
    partId: '32524',
    name: 'Technic Beam 1 x 7 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 7, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.0,
    connectors: createTechnicBeamConnectors(7, 3),
    occupancyMask: createSolidMask(1, 7, 3)
  },
  {
    partId: '40490',
    name: 'Technic Beam 1 x 9 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 9, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 9.5,
    connectors: createTechnicBeamConnectors(9, 3),
    occupancyMask: createSolidMask(1, 9, 3)
  },
  {
    partId: '32525',
    name: 'Technic Beam 1 x 11 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 11, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 10.5,
    connectors: createTechnicBeamConnectors(11, 3),
    occupancyMask: createSolidMask(1, 11, 3)
  },
  {
    partId: '41239',
    name: 'Technic Beam 1 x 13 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 13, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 11.5,
    connectors: createTechnicBeamConnectors(13, 3),
    occupancyMask: createSolidMask(1, 13, 3)
  },
  {
    partId: '32278',
    name: 'Technic Beam 1 x 15 Thick',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [1, 15, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 12.5,
    connectors: createTechnicBeamConnectors(15, 3),
    occupancyMask: createSolidMask(1, 15, 3)
  },

  // Shaped Beams (L & T configurations)
  {
    partId: '32140',
    name: 'Technic Beam 2 x 4 L-Shape',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.0,
    connectors: createTechnicBeamConnectors(4, 3),
    occupancyMask: createSolidMask(2, 4, 3)
  },
  {
    partId: '32526',
    name: 'Technic Beam 3 x 5 L-Shape',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [3, 5, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.5,
    connectors: createTechnicBeamConnectors(5, 3),
    occupancyMask: createSolidMask(3, 5, 3)
  },
  {
    partId: '39793',
    name: 'Technic Beam 3 x 3 T-Shape',
    system: 'TECHNIC',
    category: 'TECHNIC_BEAM',
    baseSize: [3, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.5,
    connectors: createTechnicBeamConnectors(3, 3),
    occupancyMask: createSolidMask(3, 3, 3)
  }
];
