/**
 * Fast Spatial & Connectivity Fingerprint Encoder for LEGO Elements.
 *
 * Implements ultra-fast bitwise spatial fingerprinting:
 * - Encodes 3D piece occupancy and stud/tube connectivity into compact bitmasks.
 * - Precomputes all 4 cardinal rotations (0°, 90°, 180°, 270°) with exact LDraw matrices.
 * - Enables O(1) collision and envelope containment checks via bitwise operators.
 */

import { PieceCategory, PieceProfile, CurvatureClass, SlopeClass, StudConnection } from './types';

// Dimensions of local fingerprint volume (supports up to 8x8 bricks footprint)
export const FP_WIDTH_X = 8;
export const FP_DEPTH_Z = 8;
export const FP_HEIGHT_Y = 2;

/**
 * Packs 3D relative coordinate into a bit index: [0, 47].
 */
export function cellToBit(dx: number, dz: number, dy: number): bigint {
  const ix = Math.floor(dx);
  const iz = Math.floor(dz);
  const iy = Math.floor(dy);
  if (ix < 0 || ix >= FP_WIDTH_X || iz < 0 || iz >= FP_DEPTH_Z || iy < 0 || iy >= FP_HEIGHT_Y) {
    return 0n;
  }
  const index = ix + iz * FP_WIDTH_X + iy * (FP_WIDTH_X * FP_DEPTH_Z);
  return 1n << BigInt(index);
}

/**
 * Cardinal rotation matrices for LDraw (X, Z plane around Y axis).
 */
export const CARDINAL_ROTATIONS: Record<
  0 | 90 | 180 | 270,
  [number, number, number, number, number, number, number, number, number]
> = {
  0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  90: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  180: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  270: [0, 0, 1, 0, 1, 0, -1, 0, 0]
};

export interface RotatedPieceVariant {
  rotation: 0 | 90 | 180 | 270;
  widthX: number;
  depthZ: number;
  heightY: number;
  matrix: [number, number, number, number, number, number, number, number, number];
  occupiedCells: Array<{ dx: number; dz: number; dy: number }>;
  topStuds: Array<{ dx: number; dz: number }>;
  bottomTubes: Array<{ dx: number; dz: number }>;
  slopeHeading: number; // Rotated azimuth in degrees
  spatialBitmask: bigint;
  topStudsBitmask: bigint;
  bottomTubesBitmask: bigint;
}

export interface PieceDescriptor {
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  baseWidthX: number;
  baseDepthZ: number;
  baseHeightY: number; // plates
  slopeClass: SlopeClass;
  slopeAngle: number;
  baseHeading: number;
  curvatureClass: CurvatureClass;
  isModern: boolean;
  bondingCapacity: number;
  preferredDepth: [number, number]; // [minDepth, maxDepth]
  
  // Custom cell overrides for non-rectangular parts (e.g. corner bricks, macaroni, slopes)
  customOccupiedCells?: Array<{ dx: number; dz: number; dy: number }>;
  customTopStuds?: Array<{ dx: number; dz: number }>;
  customBottomTubes?: Array<{ dx: number; dz: number }>;
}

export class PieceFingerprint {
  public descriptor: PieceDescriptor;
  public variants: Map<0 | 90 | 180 | 270, RotatedPieceVariant> = new Map();

  constructor(descriptor: PieceDescriptor) {
    this.descriptor = descriptor;
    this.computeAllRotations();
  }

  /**
   * Precomputes all 4 cardinal rotation variants for nanosecond matching.
   */
  private computeAllRotations(): void {
    const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

    for (const rot of rotations) {
      const isQuarterTurn = rot === 90 || rot === 270;
      const wX = isQuarterTurn ? this.descriptor.baseDepthZ : this.descriptor.baseWidthX;
      const wZ = isQuarterTurn ? this.descriptor.baseWidthX : this.descriptor.baseDepthZ;
      const hY = this.descriptor.baseHeightY;

      // Base cells
      let rawCells = this.descriptor.customOccupiedCells;
      if (!rawCells) {
        rawCells = [];
        for (let dx = 0; dx < this.descriptor.baseWidthX; dx++) {
          for (let dz = 0; dz < this.descriptor.baseDepthZ; dz++) {
            for (let dy = 0; dy < hY; dy++) {
              rawCells.push({ dx, dz, dy });
            }
          }
        }
      }

      // Base top studs
      let rawTopStuds = this.descriptor.customTopStuds;
      if (!rawTopStuds) {
        if (
          this.descriptor.profile === 'tile_flat' ||
          this.descriptor.profile === 'slope_curved' ||
          this.descriptor.profile === 'cheese' ||
          this.descriptor.profile === 'macaroni' ||
          this.descriptor.profile === 'tooth_creature'
        ) {
          rawTopStuds = [];
        } else {
          rawTopStuds = [];
          for (let dx = 0; dx < this.descriptor.baseWidthX; dx++) {
            for (let dz = 0; dz < this.descriptor.baseDepthZ; dz++) {
              rawTopStuds.push({ dx, dz });
            }
          }
        }
      }

      // Base bottom tubes
      let rawBottomTubes = this.descriptor.customBottomTubes;
      if (!rawBottomTubes) {
        rawBottomTubes = [];
        for (let dx = 0; dx < this.descriptor.baseWidthX; dx++) {
          for (let dz = 0; dz < this.descriptor.baseDepthZ; dz++) {
            rawBottomTubes.push({ dx, dz });
          }
        }
      }

      // Rotate coordinates around pivot
      const transformCoord = (
        x: number,
        z: number,
        origW: number,
        origD: number
      ): { dx: number; dz: number } => {
        switch (rot) {
          case 0:
            return { dx: x, dz: z };
          case 90:
            // 90 deg clockwise: (x, z) -> (origD - 1 - z, x)
            return { dx: origD - 1 - z, dz: x };
          case 180:
            // 180 deg: (x, z) -> (origW - 1 - x, origD - 1 - z)
            return { dx: origW - 1 - x, dz: origD - 1 - z };
          case 270:
            // 270 deg clockwise: (x, z) -> (z, origW - 1 - x)
            return { dx: z, dz: origW - 1 - x };
        }
      };

      const rotatedCells = rawCells.map(c => {
        const { dx, dz } = transformCoord(c.dx, c.dz, this.descriptor.baseWidthX, this.descriptor.baseDepthZ);
        return { dx, dz, dy: c.dy };
      });

      const rotatedTopStuds = rawTopStuds.map(s =>
        transformCoord(s.dx, s.dz, this.descriptor.baseWidthX, this.descriptor.baseDepthZ)
      );

      const rotatedBottomTubes = rawBottomTubes.map(t =>
        transformCoord(t.dx, t.dz, this.descriptor.baseWidthX, this.descriptor.baseDepthZ)
      );

      // Compute bitmasks
      let spatialBitmask = 0n;
      for (const c of rotatedCells) {
        spatialBitmask |= cellToBit(c.dx, c.dz, c.dy);
      }

      let topStudsBitmask = 0n;
      for (const s of rotatedTopStuds) {
        topStudsBitmask |= cellToBit(s.dx, s.dz, 0);
      }

      let bottomTubesBitmask = 0n;
      for (const b of rotatedBottomTubes) {
        bottomTubesBitmask |= cellToBit(b.dx, b.dz, 0);
      }

      const rotatedHeading = (this.descriptor.baseHeading + rot) % 360;

      this.variants.set(rot, {
        rotation: rot,
        widthX: wX,
        depthZ: wZ,
        heightY: hY,
        matrix: CARDINAL_ROTATIONS[rot],
        occupiedCells: rotatedCells,
        topStuds: rotatedTopStuds,
        bottomTubes: rotatedBottomTubes,
        slopeHeading: rotatedHeading,
        spatialBitmask,
        topStudsBitmask,
        bottomTubesBitmask
      });
    }
  }

  /**
   * Fast bitwise check: Does this variant fit inside the local target mask without collision?
   */
  public fitsBitwise(
    variant: RotatedPieceVariant,
    targetEnvelopeMask: bigint,
    placedSolidMask: bigint
  ): boolean {
    // 1. Collision check: must not overlap with placed solids
    if ((variant.spatialBitmask & placedSolidMask) !== 0n) {
      return false;
    }
    // 2. Containment check: all solid cells of the piece must be inside the target envelope
    if ((variant.spatialBitmask & ~targetEnvelopeMask) !== 0n) {
      return false;
    }
    return true;
  }
}
