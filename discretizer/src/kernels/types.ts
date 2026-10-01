import type { ConnectorSite } from '../core/types';

export type KernelCategory =
  | 'ORGANIC_DOME'
  | 'SLOPE_CURVED'
  | 'SLOPE_INVERTED'
  | 'MACARONI_WEDGE'
  | 'ROUND_CANISTER'
  | 'CORE_INFILL'
  | 'TILE_FLAT'
  | 'CHEESE_SLOPE';

export interface BaseKernelDefinition {
  partId: string;
  name: string;
  category: KernelCategory;
  /** Unrotated dimensions in grid units: [widthStuds, depthStuds, heightPlates] */
  baseSize: [number, number, number];
  /** Preferred continuous surface normal (unrotated) that this part represents best */
  targetNormal: [number, number, number];
  /** Minimum normal dot product threshold to accept this part [0.0 .. 1.0] */
  minNormalDot: number;
  /** Priority tier (1: Organic/Apex, 2: Slopes, 3: Macaroni, 4: Canister, 5: Core, 6: Tiles) */
  tier: number;
  /** Relative weight bonus for scoring */
  weightBonus: number;
  /** Connectors in unrotated part space */
  connectors: ConnectorSite[];
  /** 3D local occupancy mask [heightPlates][depthStuds][widthStuds] (true = solid) */
  occupancyMask: boolean[][][];
}

export interface RotatedKernelVariant {
  def: BaseKernelDefinition;
  partId: string;
  name: string;
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
