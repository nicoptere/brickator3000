/**
 * Core types and mathematical abstractions for the Plate-Level LEGO Discretization Engine.
 */

export interface GridCoord3D {
  x: number; // Stud coordinate along X [0 .. numStudsX - 1]
  z: number; // Stud coordinate along Z [0 .. numStudsZ - 1]
  y: number; // Plate coordinate along Y [0 .. numPlatesY - 1]
}

export interface BoundingBox3D {
  minX: number;
  minZ: number;
  minY: number;
  maxX: number;
  maxZ: number;
  maxY: number;
}

export type ConnectorPolarity = 'MALE' | 'FEMALE';
export type ConnectorJointType = 'STUD_TUBE' | 'PIN_HOLE' | 'CLIP_BAR' | 'AXLE_SOCKET';

export interface ConnectorSite {
  /** Relative offset within part in integer grid units [x_studs, z_studs, y_plates] */
  localPos: [number, number, number];
  /** Direction normal vector of connector face [dx, dz, dy] */
  direction: [number, number, number];
  /** MALE (stud/pin/bar) or FEMALE (tube/hole/clip) */
  polarity: ConnectorPolarity;
  /** Joint category */
  jointType: ConnectorJointType;
}

export interface VoxelCellData {
  occupied: boolean;
  colorHex: string;
  colorPacked: number; // 0x00RRGGBB
  normal: [number, number, number];
  islandId: number;
  depth: number; // 0 = boundary surface hull, >= 1 = interior core
}

export interface PlacedBrick {
  instanceId: string;
  partId: string;
  name: string;
  gridPos: [number, number, number]; // [x, z, y] anchor (minimum corner)
  baseSize: [number, number, number]; // Unrotated [widthStuds, depthStuds, heightPlates]
  size: [number, number, number]; // Rotated bounding box in grid units
  rotation: number; // 0, 90, 180, 270 degrees
  colorHex: string;
  colorPacked: number;
  ldrawPos: [number, number, number]; // LDraw world coordinates (LDU)
  ldrawMatrix: number[]; // 3x3 rotation matrix
  category: 'SLOPE_CURVED' | 'SLOPE_INVERTED' | 'MACARONI_WEDGE' | 'ROUND_CANISTER' | 'CORE_INFILL' | 'TILE_FLAT';
  connectors: ConnectorSite[];
  islandId?: number;
}

export interface BuildabilityStats {
  totalBricks: number;
  groundedBricks: number;
  floatingBricks: number;
  is100PercentGrounded: boolean;
  totalConnections: number;
  seamInterlockScore: number;
}
