/**
 * Connectivity Dictionary & Studs Equivalence Table
 *
 * Implements the connectivity dictionary requested by the user:
 * - Maps LDraw piece geometries to precise stud & tube connection points.
 * - Establishes an equivalence table between pieces and connectivity signatures.
 * - Computes clutch affinity, running bond seam overlap, and vertical interlocking.
 */

import { PieceCategory, PieceProfile, StudConnection } from './types';

export const LDU_STUD_PITCH = 20.0; // 1 Stud in X and Z = 20 LDU
export const LDU_PLATE_HEIGHT = 8.0; // 1 Plate in Y = 8 LDU (1 Brick = 3 Plates = 24 LDU)

export interface ConnectivitySignature {
  signatureId: string;
  widthX: number;
  depthZ: number;
  heightY: number; // in plates
  topStudPattern: string; // e.g. 'FULL_GRID', 'SMOOTH_TILE', 'CURVED_SLOPE', 'CHEESE_RAMP', 'HOLLOW_STUD'
  bottomTubePattern: string; // e.g. 'STANDARD_TUBES', 'SINGLE_PIN', 'SOLID_RECESS'
  totalTopStuds: number;
  totalBottomTubes: number;
  clutchEfficiency: number; // Baseline clutch rating
  canStraddleSeam: boolean;
}

/**
 * Registry of known LEGO connectivity signatures.
 */
export const CONNECTIVITY_SIGNATURES: Record<string, ConnectivitySignature> = {
  // --- Solid Standard Bricks ---
  'BRICK_2x8': {
    signatureId: 'BRICK_2x8',
    widthX: 8,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 16,
    totalBottomTubes: 16,
    clutchEfficiency: 1.0,
    canStraddleSeam: true
  },
  'BRICK_2x6': {
    signatureId: 'BRICK_2x6',
    widthX: 6,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 12,
    totalBottomTubes: 12,
    clutchEfficiency: 1.0,
    canStraddleSeam: true
  },
  'BRICK_2x4': {
    signatureId: 'BRICK_2x4',
    widthX: 4,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 8,
    totalBottomTubes: 8,
    clutchEfficiency: 1.0,
    canStraddleSeam: true
  },
  'BRICK_2x3': {
    signatureId: 'BRICK_2x3',
    widthX: 3,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 6,
    totalBottomTubes: 6,
    clutchEfficiency: 0.95,
    canStraddleSeam: true
  },
  'BRICK_2x2': {
    signatureId: 'BRICK_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 4,
    totalBottomTubes: 4,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },
  'BRICK_1x4': {
    signatureId: 'BRICK_1x4',
    widthX: 4,
    depthZ: 1,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 4,
    totalBottomTubes: 4,
    clutchEfficiency: 0.85,
    canStraddleSeam: true
  },
  'BRICK_1x2': {
    signatureId: 'BRICK_1x2',
    widthX: 2,
    depthZ: 1,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 2,
    totalBottomTubes: 2,
    clutchEfficiency: 0.8,
    canStraddleSeam: true
  },
  'BRICK_1x1': {
    signatureId: 'BRICK_1x1',
    widthX: 1,
    depthZ: 1,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'SINGLE_PIN',
    totalTopStuds: 1,
    totalBottomTubes: 1,
    clutchEfficiency: 0.6,
    canStraddleSeam: false
  },
  'CORNER_BRICK_2x2': {
    signatureId: 'CORNER_BRICK_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'L_SHAPE',
    bottomTubePattern: 'L_SHAPE',
    totalTopStuds: 3,
    totalBottomTubes: 3,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },

  // --- Modern Curved Slopes (Studless Smooth Convex Top) ---
  'SLOPE_CURVED_2x1': {
    signatureId: 'SLOPE_CURVED_2x1',
    widthX: 1,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'SMOOTH_CURVED_RAMP',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 2,
    clutchEfficiency: 0.85,
    canStraddleSeam: true
  },
  'SLOPE_CURVED_2x2': {
    signatureId: 'SLOPE_CURVED_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'SMOOTH_CURVED_RAMP',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 4,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },
  'SLOPE_CURVED_4x1': {
    signatureId: 'SLOPE_CURVED_4x1',
    widthX: 1,
    depthZ: 4,
    heightY: 3,
    topStudPattern: 'SMOOTH_CURVED_RAMP',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 4,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },
  'SLOPE_CURVED_4x2': {
    signatureId: 'SLOPE_CURVED_4x2',
    widthX: 2,
    depthZ: 4,
    heightY: 3,
    topStudPattern: 'SMOOTH_CURVED_RAMP',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 8,
    clutchEfficiency: 0.95,
    canStraddleSeam: true
  },

  // --- Inverted Slopes (Bottom Concave Ramp, Top Studs) ---
  'SLOPE_INVERTED_2x1': {
    signatureId: 'SLOPE_INVERTED_2x1',
    widthX: 1,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'FULL_GRID',
    bottomTubePattern: 'INVERTED_RECESS',
    totalTopStuds: 2,
    totalBottomTubes: 1,
    clutchEfficiency: 0.75,
    canStraddleSeam: false
  },

  // --- 45° and 33° Slopes ---
  'SLOPE_45_2x1': {
    signatureId: 'SLOPE_45_2x1',
    widthX: 1,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'RAMP_WITH_ONE_STUD',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 1,
    totalBottomTubes: 2,
    clutchEfficiency: 0.8,
    canStraddleSeam: true
  },
  'SLOPE_45_2x2': {
    signatureId: 'SLOPE_45_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'RAMP_WITH_STUDS',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 2,
    totalBottomTubes: 4,
    clutchEfficiency: 0.85,
    canStraddleSeam: true
  },
  'CHEESE_SLOPE_1x1': {
    signatureId: 'CHEESE_SLOPE_1x1',
    widthX: 1,
    depthZ: 1,
    heightY: 2,
    topStudPattern: 'SMOOTH_33_RAMP',
    bottomTubePattern: 'SINGLE_PIN',
    totalTopStuds: 0,
    totalBottomTubes: 1,
    clutchEfficiency: 0.7,
    canStraddleSeam: false
  },
  'CHEESE_SLOPE_1x2': {
    signatureId: 'CHEESE_SLOPE_1x2',
    widthX: 1,
    depthZ: 2,
    heightY: 2,
    topStudPattern: 'SMOOTH_33_RAMP',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 2,
    clutchEfficiency: 0.8,
    canStraddleSeam: true
  },

  // --- Macaroni & Modern Corner Tiles ---
  'MACARONI_TILE_2x2': {
    signatureId: 'MACARONI_TILE_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 1,
    topStudPattern: 'SMOOTH_ROUND_CORNER',
    bottomTubePattern: 'ROUND_TUBE',
    totalTopStuds: 0,
    totalBottomTubes: 3,
    clutchEfficiency: 0.85,
    canStraddleSeam: true
  },
  'QUARTER_ROUND_TILE_1x1': {
    signatureId: 'QUARTER_ROUND_TILE_1x1',
    widthX: 1,
    depthZ: 1,
    heightY: 1,
    topStudPattern: 'SMOOTH_ARC',
    bottomTubePattern: 'SINGLE_PIN',
    totalTopStuds: 0,
    totalBottomTubes: 1,
    clutchEfficiency: 0.65,
    canStraddleSeam: false
  },

  // --- Studless Smooth Flat Tiles ---
  'TILE_2x2': {
    signatureId: 'TILE_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 1,
    topStudPattern: 'SMOOTH_FLAT',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 4,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },
  'TILE_1x2': {
    signatureId: 'TILE_1x2',
    widthX: 2,
    depthZ: 1,
    heightY: 1,
    topStudPattern: 'SMOOTH_FLAT',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 2,
    clutchEfficiency: 0.8,
    canStraddleSeam: true
  },
  'TILE_1x4': {
    signatureId: 'TILE_1x4',
    widthX: 4,
    depthZ: 1,
    heightY: 1,
    topStudPattern: 'SMOOTH_FLAT',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 4,
    clutchEfficiency: 0.85,
    canStraddleSeam: true
  },
  'TILE_1x1_ROUND': {
    signatureId: 'TILE_1x1_ROUND',
    widthX: 1,
    depthZ: 1,
    heightY: 1,
    topStudPattern: 'SMOOTH_ROUND',
    bottomTubePattern: 'SINGLE_PIN',
    totalTopStuds: 0,
    totalBottomTubes: 1,
    clutchEfficiency: 0.7,
    canStraddleSeam: false
  },

  // --- Domes, Dishes & Cones (System LEAF Pieces) ---
  'DOME_2x2': {
    signatureId: 'DOME_2x2',
    widthX: 2,
    depthZ: 2,
    heightY: 3,
    topStudPattern: 'SPHERICAL_DOME',
    bottomTubePattern: 'STANDARD_TUBES',
    totalTopStuds: 0,
    totalBottomTubes: 4,
    clutchEfficiency: 0.9,
    canStraddleSeam: true
  },
  'CONE_1x1': {
    signatureId: 'CONE_1x1',
    widthX: 1,
    depthZ: 1,
    heightY: 3,
    topStudPattern: 'HOLLOW_STUD',
    bottomTubePattern: 'SINGLE_PIN',
    totalTopStuds: 1,
    totalBottomTubes: 1,
    clutchEfficiency: 0.75,
    canStraddleSeam: false
  },
  'DISH_RADAR_2x2_INVERTED': {
    signatureId: 'DISH_RADAR_2x2_INVERTED',
    widthX: 2,
    depthZ: 2,
    heightY: 2,
    topStudPattern: 'SPHERICAL_DOME',
    bottomTubePattern: 'CENTER_STUD_RECESS',
    totalTopStuds: 1,
    totalBottomTubes: 1,
    clutchEfficiency: 0.8,
    canStraddleSeam: true
  }
};

/**
 * Calculates interlocking clutch strength and running-bond seam staggering.
 *
 * Running Bond Invariant:
 * When placing a brick B on layer Y resting upon layer Y-1:
 * - If B rests entirely within the boundary of a single brick below it, it creates a stacked seam (Score: 0.3).
 * - If B bridges 2 or more distinct bricks below it, it forms a classic interlocking running bond (Score: 1.5).
 * - Ground plane (layer 0): Base bricks resting on ground receive solid grounding score (1.0).
 */
export function evaluateClutchAndBond(
  candidateTubes: Array<{ x: number; z: number }>,
  layerY: number,
  occupiedCells: Map<string, string>, // key: "x,z,y" -> brickId
  brickPartMap: Map<string, string>
): { clutchScore: number; supportingBrickIds: string[]; isRunningBond: boolean } {
  if (layerY === 0) {
    // Ground plane: fully grounded
    return { clutchScore: 1.0, supportingBrickIds: [], isRunningBond: true };
  }

  const supportingBricks = new Set<string>();
  let engagedTubes = 0;

  for (const tube of candidateTubes) {
    const belowKey = `${tube.x},${tube.z},${layerY - 1}`;
    const supportingId = occupiedCells.get(belowKey);
    if (supportingId) {
      supportingBricks.add(supportingId);
      engagedTubes++;
    }
  }

  if (candidateTubes.length === 0) {
    return { clutchScore: 0.5, supportingBrickIds: [], isRunningBond: false };
  }

  const clutchRatio = engagedTubes / candidateTubes.length;

  if (clutchRatio === 0) {
    // Floating piece - zero support!
    return { clutchScore: 0.0, supportingBrickIds: [], isRunningBond: false };
  }

  // Running bond bonus if straddling multiple supporting bricks
  const isRunningBond = supportingBricks.size >= 2;
  const runningBondMultiplier = isRunningBond ? 1.5 : 0.8;
  const clutchScore = clutchRatio * runningBondMultiplier;

  return {
    clutchScore,
    supportingBrickIds: Array.from(supportingBricks),
    isRunningBond
  };
}
