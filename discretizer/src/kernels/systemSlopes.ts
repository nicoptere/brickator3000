import type { BaseKernelDefinition } from './types';
import { createSolidMask, createSlopeMask, createStandardConnectors } from './kernelHelpers';

/**
 * LEGO System Slopes & Curved Aerodynamic Elements
 */
export const SYSTEM_SLOPES: BaseKernelDefinition[] = [
  // ==========================================
  // Modern Curved Slopes (Tier 2)
  // ==========================================
  {
    partId: '11477',
    name: 'Slope Curved 2 x 1',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [1, 2, 3], // 1x2 studs, 3 plates (1 brick) high
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 6.0,
    connectors: createStandardConnectors(1, 2, 3, false, true),
    occupancyMask: createSlopeMask(1, 2, 3, '+z')
  },
  {
    partId: '15068',
    name: 'Slope Curved 2 x 2',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 7.5,
    connectors: createStandardConnectors(2, 2, 3, false, true),
    occupancyMask: createSlopeMask(2, 2, 3, '+z')
  },
  {
    partId: '61678',
    name: 'Slope Curved 4 x 1',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [1, 4, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 8.0,
    connectors: createStandardConnectors(1, 4, 3, false, true),
    occupancyMask: createSlopeMask(1, 4, 3, '+z')
  },
  {
    partId: '88930',
    name: 'Slope Curved 4 x 2 Double',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 9.0,
    connectors: createStandardConnectors(2, 4, 3, false, true),
    occupancyMask: createSlopeMask(2, 4, 3, '+z')
  },
  {
    partId: '24309',
    name: 'Slope Curved 3 x 2',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [2, 3, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 8.2,
    connectors: createStandardConnectors(2, 3, 3, false, true),
    occupancyMask: createSlopeMask(2, 3, 3, '+z')
  },

  // ==========================================
  // Inverted Curved Slopes (Overhangs)
  // ==========================================
  {
    partId: '24201',
    name: 'Slope Curved 2 x 1 Inverted',
    system: 'SYSTEM',
    category: 'SLOPE_INVERTED',
    baseSize: [1, 2, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 6.5,
    connectors: createStandardConnectors(1, 2, 3, true, false),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '93273',
    name: 'Slope Curved 4 x 1 Inverted',
    system: 'SYSTEM',
    category: 'SLOPE_INVERTED',
    baseSize: [1, 4, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 8.0,
    connectors: createStandardConnectors(1, 4, 3, true, false),
    occupancyMask: createSolidMask(1, 4, 3)
  },
  {
    partId: '32803',
    name: 'Slope Curved 2 x 2 Inverted',
    system: 'SYSTEM',
    category: 'SLOPE_INVERTED',
    baseSize: [2, 2, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 7.8,
    connectors: createStandardConnectors(2, 2, 3, true, false),
    occupancyMask: createSolidMask(2, 2, 3)
  },

  // ==========================================
  // Cheese Slopes (Height = 2 plates = 16 LDU)
  // ==========================================
  {
    partId: '54200',
    name: 'Cheese Slope 31° 1 x 1',
    system: 'SYSTEM',
    category: 'CHEESE_SLOPE',
    baseSize: [1, 1, 2],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.35,
    tier: 2,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 1, 2, false, true),
    occupancyMask: createSlopeMask(1, 1, 2, '+z')
  },
  {
    partId: '85984',
    name: 'Double Cheese Slope 2 x 1',
    system: 'SYSTEM',
    category: 'CHEESE_SLOPE',
    baseSize: [1, 2, 2],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.35,
    tier: 2,
    weightBonus: 5.5,
    connectors: createStandardConnectors(1, 2, 2, false, true),
    occupancyMask: createSlopeMask(1, 2, 2, '+z')
  },

  // ==========================================
  // Traditional 45° Slopes
  // ==========================================
  {
    partId: '3040',
    name: 'Slope 45° 2 x 1',
    system: 'SYSTEM',
    category: 'SLOPE_45',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 5.0,
    connectors: createStandardConnectors(1, 2, 3, false, true),
    occupancyMask: createSlopeMask(1, 2, 3, '+z')
  },
  {
    partId: '3039',
    name: 'Slope 45° 2 x 2',
    system: 'SYSTEM',
    category: 'SLOPE_45',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 6.5,
    connectors: createStandardConnectors(2, 2, 3, false, true),
    occupancyMask: createSlopeMask(2, 2, 3, '+z')
  },
  {
    partId: '3037',
    name: 'Slope 45° 2 x 4',
    system: 'SYSTEM',
    category: 'SLOPE_45',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 8.0,
    connectors: createStandardConnectors(2, 4, 3, false, true),
    occupancyMask: createSlopeMask(2, 4, 3, '+z')
  },
  {
    partId: '3665',
    name: 'Slope 45° 2 x 1 Inverted',
    system: 'SYSTEM',
    category: 'SLOPE_INVERTED',
    baseSize: [1, 2, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 5.5,
    connectors: createStandardConnectors(1, 2, 3, true, false),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '3660',
    name: 'Slope 45° 2 x 2 Inverted',
    system: 'SYSTEM',
    category: 'SLOPE_INVERTED',
    baseSize: [2, 2, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 7.0,
    connectors: createStandardConnectors(2, 2, 3, true, false),
    occupancyMask: createSolidMask(2, 2, 3)
  },
  {
    partId: '4286',
    name: 'Slope 33° 3 x 1',
    system: 'SYSTEM',
    category: 'SLOPE_45',
    baseSize: [1, 3, 3],
    targetNormal: [0, 0.832, 0.555],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 6.0,
    connectors: createStandardConnectors(1, 3, 3, false, true),
    occupancyMask: createSlopeMask(1, 3, 3, '+z')
  },
  {
    partId: '3298',
    name: 'Slope 33° 3 x 2',
    system: 'SYSTEM',
    category: 'SLOPE_45',
    baseSize: [2, 3, 3],
    targetNormal: [0, 0.832, 0.555],
    minNormalDot: 0.45,
    tier: 2,
    weightBonus: 7.5,
    connectors: createStandardConnectors(2, 3, 3, false, true),
    occupancyMask: createSlopeMask(2, 3, 3, '+z')
  }
];
