import type { BaseKernelDefinition } from './types';
import { createRoundMask, createSolidMask, createAxleConnectors } from './kernelHelpers';

/**
 * LEGO Technic Gears & Mechanical Drive Components
 */
export const TECHNIC_GEARS: BaseKernelDefinition[] = [
  {
    partId: '10928',
    name: 'Technic Gear 8 Tooth',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.0,
    connectors: createAxleConnectors(1),
    occupancyMask: createRoundMask(1, 1, 3)
  },
  {
    partId: '32270',
    name: 'Technic Gear 12 Tooth Double Bevel',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 5.5,
    connectors: createAxleConnectors(2),
    occupancyMask: createRoundMask(2, 2, 3)
  },
  {
    partId: '94925',
    name: 'Technic Gear 16 Tooth',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.0,
    connectors: createAxleConnectors(2),
    occupancyMask: createRoundMask(2, 2, 3)
  },
  {
    partId: '32269',
    name: 'Technic Gear 20 Tooth Double Bevel',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [3, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.0,
    connectors: createAxleConnectors(3),
    occupancyMask: createRoundMask(3, 3, 3)
  },
  {
    partId: '3648b',
    name: 'Technic Gear 24 Tooth',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [3, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 7.5,
    connectors: createAxleConnectors(3),
    occupancyMask: createRoundMask(3, 3, 3)
  },
  {
    partId: '32498',
    name: 'Technic Gear 36 Tooth Double Bevel',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [5, 5, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.5,
    connectors: createAxleConnectors(5),
    occupancyMask: createRoundMask(5, 5, 3)
  },
  {
    partId: '3649',
    name: 'Technic Gear 40 Tooth',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [5, 5, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 9.0,
    connectors: createAxleConnectors(5),
    occupancyMask: createRoundMask(5, 5, 3)
  },
  {
    partId: '6573',
    name: 'Technic Differential Gear Case',
    system: 'TECHNIC',
    category: 'TECHNIC_GEAR',
    baseSize: [3, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.0,
    connectors: createAxleConnectors(3),
    occupancyMask: createSolidMask(3, 3, 3)
  }
];
