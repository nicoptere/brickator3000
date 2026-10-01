import type { ConnectorSite } from '../core/types';

export type LegoSystem = 'SYSTEM' | 'TECHNIC';

export type KernelCategory =
  // LEGO System Categories
  | 'BRICK_STANDARD'
  | 'PLATE_STANDARD'
  | 'TILE_FLAT'
  | 'SLOPE_CURVED'
  | 'SLOPE_INVERTED'
  | 'SLOPE_45'
  | 'CHEESE_SLOPE'
  | 'ROUND_CANISTER'
  | 'ORGANIC_DOME'
  | 'MACARONI_WEDGE'
  | 'WEDGE_PLATE'
  | 'JUMPER_PLATE'
  | 'CORNER_PLATE'
  | 'BIONICLE_CREATURE'
  | 'CORE_INFILL'
  // LEGO Technic Categories
  | 'TECHNIC_BRICK'
  | 'TECHNIC_BEAM'
  | 'TECHNIC_AXLE'
  | 'TECHNIC_PIN'
  | 'TECHNIC_CONNECTOR'
  | 'TECHNIC_GEAR';

export interface BaseKernelDefinition {
  partId: string;
  name: string;
  system: LegoSystem;
  category: KernelCategory;
  /** Unrotated dimensions in grid units: [widthStuds, depthStuds, heightPlates] */
  baseSize: [number, number, number];
  /** Preferred continuous surface normal (unrotated) that this part represents best */
  targetNormal: [number, number, number];
  /** Minimum normal dot product threshold to accept this part [0.0 .. 1.0] */
  minNormalDot: number;
  /** Priority tier (1: Organic/Apex, 2: Slopes, 3: Macaroni, 4: Canister, 5: Core Infill, 6: Detail Plates, 7: Studless Tiles) */
  tier: number;
  /** Relative weight bonus for scoring */
  weightBonus: number;
  /** OMR official model frequency percentage (0-100) */
  omrFrequency?: number;
  /** Connectors in unrotated part space */
  connectors: ConnectorSite[];
  /** 3D local occupancy mask [heightPlates][depthStuds][widthStuds] (true = solid) */
  occupancyMask: boolean[][][];
}

export interface RotatedKernelVariant {
  def: BaseKernelDefinition;
  partId: string;
  name: string;
  system: LegoSystem;
  category: KernelCategory;
  rotation: number; // 0, 90, 180, 270
  /** Bounding box in grid units after yaw rotation: [widthStuds, depthStuds, heightPlates] */
  size: [number, number, number];
  targetNormal: [number, number, number];
  connectors: ConnectorSite[];
  /** Rotated 3D local occupancy mask [heightPlates][depthStuds][widthStuds] */
  occupancyMask: boolean[][][];
  /** 3x3 LDraw rotation matrix: [a, b, c, d, e, f, g, h, i] */
  ldrawMatrix: number[];
}
