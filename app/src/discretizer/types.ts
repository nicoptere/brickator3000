/**
 * Types and interfaces for the LEGO 3D Discretizer engine.
 */

export type ResolutionPreset = 'minimal' | 'medium' | 'large' | 'full';

export interface DiscretizerOptions {
  /** Target resolution tier or explicit maximum stud dimension */
  resolution: ResolutionPreset | number;
  /** Whether to snap boundary cells to slope & wedge bricks */
  enableSlopes?: boolean;
  /** Whether to enforce running bond (staggered interlocking seams) */
  enableInterlocking?: boolean;
  /** Whether to eliminate floating disconnected pieces */
  removeFloating?: boolean;
  /** Color quantization tolerance */
  colorMatching?: 'perceptual' | 'exact';
}

export interface DiscretizedBrick {
  id: string;
  partId: string;
  name: string;
  colorCode: number;
  colorHex: string;
  colorName: string;
  gridPos: [number, number, number]; // [x, y, z] in stud/plate units
  ldrawPos: [number, number, number]; // [x, y, z] in LDU
  rotation: number; // 0, 90, 180, 270 degrees
  matrix: number[]; // 3x3 LDraw transform matrix [a,b,c, d,e,f, g,h,i]
  size: [number, number, number]; // [studsX, studsZ, platesY]
  isSlope: boolean;
}

export interface DiscretizationStats {
  totalPieces: number;
  brickCount: number;
  plateCount: number;
  slopeCount: number;
  distinctParts: number;
  colorBreakdown: { code: number; name: string; hex: string; count: number }[];
  partBreakdown: { partId: string; name: string; count: number }[];
  centerOfMass: [number, number, number]; // [x, y, z] in studs
  isStable: boolean;
  floatingPiecesRemoved: number;
  gridSize: [number, number, number]; // [studsX, studsZ, platesY]
  processingTimeMs: number;
}

export interface DiscretizerResult {
  ldrContent: string;
  bricks: DiscretizedBrick[];
  stats: DiscretizationStats;
}
