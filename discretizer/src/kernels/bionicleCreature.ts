import type { BaseKernelDefinition } from './types';
import {
  createSolidMask,
  createStandardConnectors,
  createWedgeMask,
  createWedgeConnectors
} from './kernelHelpers';

/**
 * LEGO Modern, Weird, Bionicle / Constraction & Wedge Elements
 * Lift Pre-Bionicle constraints per Rule 1 and User Directive.
 */
export const BIONICLE_AND_WEIRD_PARTS: BaseKernelDefinition[] = [
  // ==========================================
  // Bionicle / Constraction / Creature (Barbs, Claws, Spines, Blades)
  // ==========================================
  {
    partId: '41669',
    name: 'Technic Tooth 1 x 3 with Axlehole',
    system: 'SYSTEM',
    category: 'BIONICLE_CREATURE',
    baseSize: [1, 3, 3], // 1x3 studs, 3 plates (1 brick) high
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 7.0,
    omrFrequency: 14.5,
    connectors: createStandardConnectors(1, 3, 3, false, true),
    occupancyMask: createSolidMask(1, 3, 3)
  },
  {
    partId: '53451',
    name: 'Barb / Small Tooth Viking Horn',
    system: 'SYSTEM',
    category: 'BIONICLE_CREATURE',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0.85, 0.52],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 6.0,
    omrFrequency: 18.2,
    connectors: createStandardConnectors(1, 1, 3, false, true),
    occupancyMask: createSolidMask(1, 1, 3)
  },
  {
    partId: '87747',
    name: 'Bar 0.5L with Curved Blade 2L',
    system: 'SYSTEM',
    category: 'BIONICLE_CREATURE',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 6.5,
    omrFrequency: 12.0,
    connectors: createStandardConnectors(1, 2, 3, false, true),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '32578',
    name: 'Creature Claw / Barb 3M',
    system: 'SYSTEM',
    category: 'BIONICLE_CREATURE',
    baseSize: [1, 3, 3],
    targetNormal: [0, 0.60, 0.80],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 7.0,
    omrFrequency: 9.5,
    connectors: createStandardConnectors(1, 3, 3, false, true),
    occupancyMask: createSolidMask(1, 3, 3)
  },

  // ==========================================
  // Corner Plates & Jumper Plates (OMR High-Frequency Staples)
  // ==========================================
  {
    partId: '2420',
    name: 'Plate 2 x 2 Corner',
    system: 'SYSTEM',
    category: 'CORNER_PLATE',
    baseSize: [2, 2, 1], // 2x2 studs, 1 plate high
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 5.5,
    omrFrequency: 32.3, // Used in 32.3% of all OMR sets!
    connectors: [
      { localPos: [0, 0, 0], direction: [0, 0, -1], polarity: 'FEMALE', jointType: 'STUD_TUBE' },
      { localPos: [0, 1, 0], direction: [0, 0, -1], polarity: 'FEMALE', jointType: 'STUD_TUBE' },
      { localPos: [1, 0, 0], direction: [0, 0, -1], polarity: 'FEMALE', jointType: 'STUD_TUBE' },
      { localPos: [0, 0, 0], direction: [0, 0, 1], polarity: 'MALE', jointType: 'STUD_TUBE' },
      { localPos: [0, 1, 0], direction: [0, 0, 1], polarity: 'MALE', jointType: 'STUD_TUBE' },
      { localPos: [1, 0, 0], direction: [0, 0, 1], polarity: 'MALE', jointType: 'STUD_TUBE' }
    ],
    occupancyMask: [
      [
        [true, true],
        [true, false]
      ]
    ]
  },
  {
    partId: '3794b',
    name: 'Plate 1 x 2 with 1 Stud (Jumper)',
    system: 'SYSTEM',
    category: 'JUMPER_PLATE',
    baseSize: [1, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 4.5,
    omrFrequency: 21.4, // Used in 21.4% of all OMR sets!
    connectors: createStandardConnectors(1, 2, 1, true, true),
    occupancyMask: createSolidMask(1, 2, 1)
  },
  {
    partId: '4032',
    name: 'Plate 2 x 2 Round with Axlehole',
    system: 'SYSTEM',
    category: 'PLATE_STANDARD',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.0,
    tier: 6,
    weightBonus: 5.0,
    omrFrequency: 28.2, // Used in 28.2% of all OMR sets!
    connectors: createStandardConnectors(2, 2, 1, true, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },

  // ==========================================
  // Authentic Aerodynamic Wedge Plates (Wings & Fins)
  // ==========================================
  {
    partId: '43722',
    name: 'Wedge Plate 3 x 2 Left',
    system: 'SYSTEM',
    category: 'WEDGE_PLATE',
    baseSize: [2, 3, 1],
    targetNormal: [0.707, 0, 0.707],
    minNormalDot: 0.35,
    tier: 3,
    weightBonus: 6.5,
    omrFrequency: 16.5,
    connectors: createWedgeConnectors(2, 3, 1, createWedgeMask(2, 3, 1, 'left_3x2')),
    occupancyMask: createWedgeMask(2, 3, 1, 'left_3x2')
  },
  {
    partId: '43723',
    name: 'Wedge Plate 3 x 2 Right',
    system: 'SYSTEM',
    category: 'WEDGE_PLATE',
    baseSize: [2, 3, 1],
    targetNormal: [-0.707, 0, 0.707],
    minNormalDot: 0.35,
    tier: 3,
    weightBonus: 6.5,
    omrFrequency: 16.5,
    connectors: createWedgeConnectors(2, 3, 1, createWedgeMask(2, 3, 1, 'right_3x2')),
    occupancyMask: createWedgeMask(2, 3, 1, 'right_3x2')
  },
  {
    partId: '2419',
    name: 'Wedge Plate 3 x 6 without Corners',
    system: 'SYSTEM',
    category: 'WEDGE_PLATE',
    baseSize: [3, 6, 1],
    targetNormal: [0.707, 0, 0.707],
    minNormalDot: 0.35,
    tier: 3,
    weightBonus: 8.5,
    omrFrequency: 18.0,
    connectors: createWedgeConnectors(3, 6, 1, createWedgeMask(3, 6, 1, 'wedge_3x6')),
    occupancyMask: createWedgeMask(3, 6, 1, 'wedge_3x6')
  },

  // ==========================================
  // Automotive & NPU Elements
  // ==========================================
  {
    partId: '18974',
    name: 'Mudguard 2 x 4 with Arch Curved',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.40,
    tier: 2,
    weightBonus: 8.5,
    omrFrequency: 15.0,
    connectors: createStandardConnectors(2, 4, 3, false, true),
    occupancyMask: createSolidMask(2, 4, 3)
  },
  {
    partId: '30626',
    name: 'Vehicle Spoiler 2 x 4 with Bar Handle',
    system: 'SYSTEM',
    category: 'SLOPE_CURVED',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0.60, 0.80],
    minNormalDot: 0.40,
    tier: 2,
    weightBonus: 8.0,
    omrFrequency: 11.0,
    connectors: createStandardConnectors(2, 4, 3, false, true),
    occupancyMask: createSolidMask(2, 4, 3)
  }
];
