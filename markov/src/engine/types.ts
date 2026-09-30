/**
 * Brickator3000 // Markov Growing Core Architecture Types
 *
 * Models LEGO voxel discretization as a constructive Markov rewrite process:
 * - Starting from the topological CORE of a watertight 3D voxel volume
 * - GROWING outward through structural FILL (with interlocking running bond)
 * - Matching surface EDGE & LEAF connectors (slopes, curves, macaroni, crests)
 * - Capping horizontal surfaces with studless flat tiles
 */

export type VoxelCoord = [number, number, number]; // [x, z, y]

export type PieceCategory = 'LEAF' | 'EDGE' | 'FILL' | 'EMPTY';

export type PieceProfile =
  | 'brick'
  | 'plate'
  | 'slope_45'
  | 'slope_33'
  | 'slope_curved'
  | 'slope_inverted'
  | 'cheese'
  | 'macaroni'
  | 'dish'
  | 'tooth_creature'
  | 'cone'
  | 'tile_flat'
  | 'wedge'
  | 'technic'
  | 'empty_void';

export type CurvatureClass =
  | 'flat'
  | 'cylindrical_convex'
  | 'cylindrical_concave'
  | 'spherical_dome'
  | 'corner_macaroni'
  | 'sharp_cusp';

export type SlopeClass = 'flat' | 'slope_45' | 'slope_33' | 'slope_75' | 'slope_curved' | 'slope_inverted';

export interface VoxelCell {
  x: number;
  z: number;
  y: number;
  occupied: boolean;
  colorCode: number;
  colorHex: string;
  colorName: string;
  normal: [number, number, number];
  depth: number; // Topological distance to boundary/air (0 = empty, 1 = surface, >=2 = core)
  isBoundary: boolean;
  isCore: boolean;
  slopeClass: SlopeClass;
  slopeHeading: number; // 0, 90, 180, 270 degrees
  curvatureClass: CurvatureClass;
  assignedBrickId?: string;
  assignedCategory?: PieceCategory;
  islandId?: number; // Prepass topological half-edge island component ID
  islandColorHex?: string; // Assigned distinct random color for this component
}

export interface VoxelGrid {
  numStudsX: number;
  numStudsZ: number;
  numPlatesY: number;
  grid: VoxelCell[][][]; // [x][z][y]
  totalOccupied: number;
  maxCoreDepth: number;
  coreCentroid: VoxelCoord;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  unitScale: number; // LDU units per plate/stud
  islands?: any[]; // Prepass topological half-edge islands
}

export interface StudConnection {
  dx: number;
  dz: number;
  dy: number;
  face: 'TOP' | 'BOTTOM' | 'SIDE_X_POS' | 'SIDE_X_NEG' | 'SIDE_Z_POS' | 'SIDE_Z_NEG';
  type: 'STUD_MALE' | 'TUBE_FEMALE' | 'SMOOTH' | 'AXLE_HOLE';
}

export interface PieceFingerprint {
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  footprint: [number, number, number]; // [widthX in studs, depthZ in studs, heightY in plates]
  rotation: 0 | 90 | 180 | 270;
  
  // Relative cell offsets occupied by this piece
  occupiedCells: Array<{ dx: number; dz: number; dy: number }>;
  
  // Connectivity interface
  topStuds: Array<{ dx: number; dz: number }>; // Top male studs
  bottomTubes: Array<{ dx: number; dz: number }>; // Bottom female tubes
  connections: StudConnection[];
  
  // Geometric & aesthetic classification
  slopeClass: SlopeClass;
  slopeAngle: number; // e.g. 0, 33, 45, 75, -45
  curvatureClass: CurvatureClass;
  isModern: boolean;
  bondingCapacity: number; // Rating of clutch strength (1 to 10)
  preferredDepth: [number, number]; // [minDepth, maxDepth] for optimal placement
  
  // 64-bit BigInt spatial bitmask for local 4x4x3 bounding box (O(1) collision & fit checks)
  spatialBitmask: bigint;
  topStudsBitmask: bigint;
  bottomTubesBitmask: bigint;
}

export interface PlacedBrick {
  id: string;
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  colorCode: number;
  colorHex: string;
  colorName: string;
  gridPos: [number, number, number]; // [x, z, y]
  ldrawPos: [number, number, number]; // [x, y, z] in Three.js / LDraw coordinates
  rotation: number; // 0, 90, 180, 270
  matrix: [number, number, number, number, number, number, number, number, number];
  size: [number, number, number]; // [widthX studs, depthZ studs, heightY plates] (rotated bounding footprint)
  baseSize?: [number, number, number]; // [baseWidthX studs, baseDepthZ studs, baseHeightY plates] (unrotated canonical dimensions)
  stepIndex: number;
  growthPhase: 'SEED' | 'CORE_EXPANSION' | 'MANTLE' | 'SURFACE_EDGE' | 'LEAF_APEX' | 'TILE_FINISH';
  clutchScore: number;
  parentBrickIds: string[];
  headId?: number; // Index of the Growth Head that placed this piece
  scaleN?: 16 | 8 | 4 | 2 | 1; // Hierarchical WFC resolution level
  scaleColorHex?: string; // Distinct debug color for WFC N= hierarchy level
  islandId?: number; // Prepass topological half-edge island component ID
  islandColorHex?: string; // Random distinct color assigned to this island
}

export const WFC_SCALE_COLORS: Record<number, string> = {
  16: '#1e40af', // Deep Blue (N = 16 Macro Base)
  8: '#2563eb',  // Royal Blue (N = 8 Large Core Bricks 2x8, 2x6, 2x4)
  4: '#f59e0b',  // Vibrant Amber (N = 4 Mid Bricks 2x3, 2x2, 1x4, 1x2)
  2: '#ec4899',  // Vibrant Magenta (N = 2 Boundary Slopes, Curves, Macaroni, Dishes)
  1: '#10b981',  // Emerald Green (N = 1 Unit 1x1x1 Bricks 3005)
  0: '#06b6d4',  // Cyan (Top Studless Tiles 3068b, 3069b, 2431)
};

export interface FrontierPoint {
  x: number;
  z: number;
  y: number;
  depth: number;
  priority: number;
  expectedCategory: PieceCategory;
  expectedNormal: [number, number, number];
  supportingStudsCount: number;
  assignedHeadId?: number;
}

export interface GrowthStepResult {
  stepIndex: number;
  phase: string;
  newBrick?: PlacedBrick;
  newBricks: PlacedBrick[];
  activeHeadsCount: number;
  activeFrontierCount: number;
  totalPlacedBricks: number;
  totalPlacedVoxels: number;
  totalTargetVoxels: number;
  coverageRatio: number;
  bomStats: {
    leafCount: number;
    edgeCount: number;
    fillCount: number;
    uniquePartCount: number;
  };
}

export interface MarkovEngineOptions {
  seedMode?: 'DEEPEST_CORE' | 'GROUNDED_BASE' | 'MULTI_SEED';
  staggerRunningBond?: boolean;
  enableModernWeirdParts?: boolean; // Bionicle, curved slopes, macaroni tiles
  enableStudlessTopFinish?: boolean;
  enablePolishPass?: boolean; // Harmonizes adjacent slopes, curves, and OMR transitions
  enableBuildabilityVerify?: boolean; // BFS grounding and interlocking verification
  directRGBSampling?: boolean; // Cheat mode: 24-bit 0x2RRGGBB
  randomSeed?: number;
  maxSteps?: number;
  targetHeightPlates?: number;
  targetHeightBricks?: number;
  colorMode?: 'actual' | 'wfc_hierarchy' | 'island_components';
  voxelizeMode?: 'surface' | 'solid'; // 'surface' = voxels that hit/contain mesh surface (default); 'solid' = volumetric solid filling
  numHeads?: number; // Number of parallel Growth Heads (1 to 16, default: 4)
  batchStepSize?: number; // Number of placements per tick
}
