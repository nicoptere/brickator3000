import type { ConnectorSite } from '../core/types';
import type { BaseKernelDefinition } from './types';

// Helper to create solid 3D occupancy mask [heightPlates][depthStuds][widthStuds]
function createSolidMask(w: number, d: number, h: number): boolean[][][] {
  const mask: boolean[][][] = [];
  for (let y = 0; y < h; y++) {
    const layer: boolean[][] = [];
    for (let z = 0; z < d; z++) {
      layer.push(new Array(w).fill(true));
    }
    mask.push(layer);
  }
  return mask;
}

// Helper to generate standard stud (top) and tube (bottom) connectors
function createStandardConnectors(
  w: number,
  d: number,
  h: number,
  hasTopStuds: boolean = true,
  hasBottomTubes: boolean = true
): ConnectorSite[] {
  const conns: ConnectorSite[] = [];

  if (hasTopStuds) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        conns.push({
          localPos: [x, z, h],
          direction: [0, 0, 1], // +Y in Three.js grid
          polarity: 'MALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
  }

  if (hasBottomTubes) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        conns.push({
          localPos: [x, z, 0],
          direction: [0, 0, -1], // -Y in Three.js grid
          polarity: 'FEMALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
  }

  return conns;
}

export const KERNEL_CATALOG: BaseKernelDefinition[] = [
  // =========================================================
  // Tier 1: Organic & Extreme Curvatures (Radar Dishes / Apex Domes)
  // =========================================================
  {
    partId: '4740',
    name: 'Radar Dish 2 x 2 Inverted',
    category: 'ORGANIC_DOME',
    baseSize: [2, 2, 2], // 2x2 studs, 2 plates high
    targetNormal: [0, 1, 0], // Extreme upward dome apex
    minNormalDot: 0.85,
    tier: 1,
    weightBonus: 10.0,
    connectors: createStandardConnectors(2, 2, 2, false, true), // Hollow bowl top, center bottom tube
    occupancyMask: createSolidMask(2, 2, 2)
  },

  // =========================================================
  // Tier 2: Modern Curved & Inverted Slopes
  // =========================================================
  {
    partId: '88930',
    name: 'Slope Curved 4 x 2 Double',
    category: 'SLOPE_CURVED',
    baseSize: [2, 4, 3], // 2x4 studs, 1 brick (3 plates) high
    targetNormal: [0, 0.707, 0.707], // Sloping forward +Z and skyward +Y
    minNormalDot: 0.55,
    tier: 2,
    weightBonus: 8.5,
    connectors: createStandardConnectors(2, 4, 3, false, true), // Smooth top curved surface, bottom tubes
    occupancyMask: createSolidMask(2, 4, 3)
  },
  {
    partId: '15068',
    name: 'Slope Curved 2 x 2',
    category: 'SLOPE_CURVED',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.55,
    tier: 2,
    weightBonus: 7.0,
    connectors: createStandardConnectors(2, 2, 3, false, true),
    occupancyMask: createSolidMask(2, 2, 3)
  },
  {
    partId: '11477',
    name: 'Slope Curved 2 x 1',
    category: 'SLOPE_CURVED',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 6.0,
    connectors: createStandardConnectors(1, 2, 3, false, true),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '24201',
    name: 'Slope Curved 2 x 1 Inverted',
    category: 'SLOPE_INVERTED',
    baseSize: [1, 2, 3],
    targetNormal: [0, -0.707, 0.707], // Sloping downward overhang
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 6.5,
    connectors: createStandardConnectors(1, 2, 3, true, true), // Studs on top, inverted slope beneath
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '93273',
    name: 'Slope Curved 4 x 1 Inverted',
    category: 'SLOPE_INVERTED',
    baseSize: [1, 4, 3],
    targetNormal: [0, -0.707, 0.707],
    minNormalDot: 0.50,
    tier: 2,
    weightBonus: 7.5,
    connectors: createStandardConnectors(1, 4, 3, true, true),
    occupancyMask: createSolidMask(1, 4, 3)
  },
  {
    partId: '85984',
    name: 'Double Cheese Slope 2 x 1',
    category: 'CHEESE_SLOPE',
    baseSize: [1, 2, 2], // 2 plates high
    targetNormal: [0, 0.6, 0.8],
    minNormalDot: 0.60,
    tier: 2,
    weightBonus: 5.5,
    connectors: createStandardConnectors(1, 2, 2, false, true),
    occupancyMask: createSolidMask(1, 2, 2)
  },
  {
    partId: '54200',
    name: 'Cheese Slope 31° 1 x 1',
    category: 'CHEESE_SLOPE',
    baseSize: [1, 1, 2],
    targetNormal: [0, 0.5, 0.86],
    minNormalDot: 0.60,
    tier: 2,
    weightBonus: 4.5,
    connectors: createStandardConnectors(1, 1, 2, false, true),
    occupancyMask: createSolidMask(1, 1, 2)
  },

  // =========================================================
  // Tier 3: Macaroni Corners & Round Perimeters
  // =========================================================
  {
    partId: '27925',
    name: 'Tile 2 x 2 Macaroni Curved',
    category: 'MACARONI_WEDGE',
    baseSize: [2, 2, 1], // 1 plate high
    targetNormal: [0.707, 0, 0.707], // Corner diagonal normal
    minNormalDot: 0.40,
    tier: 3,
    weightBonus: 8.0,
    connectors: createStandardConnectors(2, 2, 1, false, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },

  // =========================================================
  // Tier 4: Round Canisters & Structural Columns
  // =========================================================
  {
    partId: '3941',
    name: 'Brick 2 x 2 Round',
    category: 'ROUND_CANISTER',
    baseSize: [2, 2, 3],
    targetNormal: [0, 0, 0], // Omni-directional round upright
    minNormalDot: 0.0,
    tier: 4,
    weightBonus: 6.0,
    connectors: createStandardConnectors(2, 2, 3, true, true),
    occupancyMask: createSolidMask(2, 2, 3)
  },
  {
    partId: '3062b',
    name: 'Brick 1 x 1 Round with Open Stud',
    category: 'ROUND_CANISTER',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 4,
    weightBonus: 5.0,
    connectors: createStandardConnectors(1, 1, 3, true, true),
    occupancyMask: createSolidMask(1, 1, 3)
  },

  // =========================================================
  // Tier 5: Structural Core Infill (Creator Expert Interlocking)
  // =========================================================
  {
    partId: '3001',
    name: 'Brick 2 x 4',
    category: 'CORE_INFILL',
    baseSize: [2, 4, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 8.0,
    connectors: createStandardConnectors(2, 4, 3, true, true),
    occupancyMask: createSolidMask(2, 4, 3)
  },
  {
    partId: '3003',
    name: 'Brick 2 x 3',
    category: 'CORE_INFILL',
    baseSize: [2, 3, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 6.5,
    connectors: createStandardConnectors(2, 3, 3, true, true),
    occupancyMask: createSolidMask(2, 3, 3)
  },
  {
    partId: '3004',
    name: 'Brick 1 x 2',
    category: 'CORE_INFILL',
    baseSize: [1, 2, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 2, 3, true, true),
    occupancyMask: createSolidMask(1, 2, 3)
  },
  {
    partId: '3005',
    name: 'Brick 1 x 1',
    category: 'CORE_INFILL',
    baseSize: [1, 1, 3],
    targetNormal: [0, 0, 0],
    minNormalDot: 0.0,
    tier: 5,
    weightBonus: 1.0,
    connectors: createStandardConnectors(1, 1, 3, true, true),
    occupancyMask: createSolidMask(1, 1, 3)
  },

  // =========================================================
  // Tier 6: Studless Top Tile Finishes
  // =========================================================
  {
    partId: '87079',
    name: 'Tile 2 x 4 Flat',
    category: 'TILE_FLAT',
    baseSize: [2, 4, 1], // 1 plate high
    targetNormal: [0, 1, 0], // Facing skyward +Y
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 8.0,
    connectors: createStandardConnectors(2, 4, 1, false, true),
    occupancyMask: createSolidMask(2, 4, 1)
  },
  {
    partId: '3068b',
    name: 'Tile 2 x 2 Flat',
    category: 'TILE_FLAT',
    baseSize: [2, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 6.0,
    connectors: createStandardConnectors(2, 2, 1, false, true),
    occupancyMask: createSolidMask(2, 2, 1)
  },
  {
    partId: '2431',
    name: 'Tile 1 x 4 Flat',
    category: 'TILE_FLAT',
    baseSize: [1, 4, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 5.5,
    connectors: createStandardConnectors(1, 4, 1, false, true),
    occupancyMask: createSolidMask(1, 4, 1)
  },
  {
    partId: '3069b',
    name: 'Tile 1 x 2 Flat',
    category: 'TILE_FLAT',
    baseSize: [1, 2, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 4.0,
    connectors: createStandardConnectors(1, 2, 1, false, true),
    occupancyMask: createSolidMask(1, 2, 1)
  },
  {
    partId: '3070b',
    name: 'Tile 1 x 1 Flat',
    category: 'TILE_FLAT',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 2.0,
    connectors: createStandardConnectors(1, 1, 1, false, true),
    occupancyMask: createSolidMask(1, 1, 1)
  },
  {
    partId: '98138',
    name: 'Tile 1 x 1 Round Flat',
    category: 'TILE_FLAT',
    baseSize: [1, 1, 1],
    targetNormal: [0, 1, 0],
    minNormalDot: 0.85,
    tier: 6,
    weightBonus: 3.0,
    connectors: createStandardConnectors(1, 1, 1, false, true),
    occupancyMask: createSolidMask(1, 1, 1)
  }
];
