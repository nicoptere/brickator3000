import { PlateLattice3D } from '../core/PlateLattice3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { RotatedKernelVariant } from '../kernels/types';

export interface EvaluatorConstraints {
  enforceRunningBond?: boolean;
  requireExposedTop?: boolean;
  preferInterior?: boolean;
  requireApex?: boolean;
  requireDepth0?: boolean;
  checkPillar?: boolean;
  layerY?: number;
}

export interface EvaluatorOptions {
  enableStudlessTiles?: boolean;
  colorVarianceThreshold?: number;
}

/**
 * Checks whether at least one voxel in the candidate variant's solid occupancy touches the outer surface (depth 0).
 */
export function hasVoxelAtDepth0(
  x: number,
  z: number,
  y: number,
  variant: RotatedKernelVariant,
  lattice: PlateLattice3D
): boolean {
  const mask = variant.occupancyMask;
  const h = mask.length;
  const d = mask[0].length;
  const w = mask[0][0].length;

  for (let dy = 0; dy < h; dy++) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (mask[dy][dz][dx]) {
          if (lattice.getDepth(x + dx, z + dz, y + dy) === 0) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Finds representative surface normal for candidate kernel at (x, z, y), prioritizing outermost voxels (depth 0).
 */
export function getRepresentativeNormal(
  x: number,
  z: number,
  y: number,
  variant: RotatedKernelVariant,
  lattice: PlateLattice3D
): [number, number, number] | null {
  const mask = variant.occupancyMask;
  const h = mask.length;
  const d = mask[0].length;
  const w = mask[0][0].length;

  let bestNormal: [number, number, number] | null = null;
  let minDepth = Infinity;

  for (let dy = 0; dy < h; dy++) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (mask[dy][dz][dx]) {
          const v = lattice.getVoxel(x + dx, z + dz, y + dy);
          if (v && v.depth < minDepth) {
            minDepth = v.depth;
            bestNormal = v.normal;
            if (minDepth === 0) return bestNormal;
          }
        }
      }
    }
  }
  return bestNormal ?? lattice.getVoxel(x, z, y)?.normal ?? null;
}

/**
 * Calculates standard deviation in 24-bit RGB space across candidate cells to avoid crossing texture boundaries.
 */
export function calculateColorVariance(
  x: number,
  z: number,
  y: number,
  w: number,
  d: number,
  h: number,
  lattice: PlateLattice3D
): number {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let dy = 0; dy < h; dy++) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const v = lattice.getVoxel(x + dx, z + dz, y + dy);
        if (v) {
          const p = v.colorPacked;
          rSum += (p >> 16) & 0xff;
          gSum += (p >> 8) & 0xff;
          bSum += p & 0xff;
          count++;
        }
      }
    }
  }

  if (count <= 1) return 0;

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;

  let sqDiffSum = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const v = lattice.getVoxel(x + dx, z + dz, y + dy);
        if (v) {
          const p = v.colorPacked;
          const r = (p >> 16) & 0xff;
          const g = (p >> 8) & 0xff;
          const b = p & 0xff;
          sqDiffSum += (r - rMean) ** 2 + (g - gMean) ** 2 + (b - bMean) ** 2;
        }
      }
    }
  }

  return Math.sqrt(sqDiffSum / count);
}

/**
 * Checks whether candidate element has physical support directly underneath.
 */
export function hasSupportUnderneath(
  x: number,
  z: number,
  y: number,
  w: number,
  d: number,
  bitset: LegoBitset3D
): boolean {
  if (y === 0) return true;
  for (let dz = 0; dz < d; dz++) {
    for (let dx = 0; dx < w; dx++) {
      if (bitset.isClaimed(x + dx, z + dz, y - 1)) {
        return true;
      }
    }
  }
  return false;
}

export interface CandidateEvaluationResult {
  score: number;
  valid: boolean;
  loss: number;
  overlapRatio: number;
  modelCount: number;
  solidCount: number;
  airCount: number;
  rejectionReason?: string;
  targetVoxels: {
    pos: [number, number, number];
    status: 'MATCH' | 'AIR' | 'COLLISION';
  }[];
}

/**
 * Detailed candidate evaluation returning loss, overlap ratio, and target voxels for the inspector.
 */
export function evaluateCandidateDetails(
  x: number,
  z: number,
  y: number,
  variant: RotatedKernelVariant,
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: EvaluatorOptions,
  constraints: EvaluatorConstraints = {}
): CandidateEvaluationResult {
  const [w, d, h] = variant.size;
  const targetVoxels: { pos: [number, number, number]; status: 'MATCH' | 'AIR' | 'COLLISION' }[] = [];

  // 1. Grid boundary check
  if (
    x < 0 || x + w > lattice.numStudsX ||
    z < 0 || z + d > lattice.numStudsZ ||
    y < 0 || y + h > lattice.numPlatesY
  ) {
    return {
      score: -1,
      valid: false,
      loss: 999,
      overlapRatio: 0,
      modelCount: 0,
      solidCount: 0,
      airCount: 0,
      rejectionReason: 'Out of lattice bounds',
      targetVoxels
    };
  }

  // 2. Physical Collision Check & Continuous Bounding Volume Overlap
  const mask = variant.occupancyMask;
  let solidCount = 0;
  let modelCount = 0;
  let airCount = 0;
  let collisionCount = 0;
  let outsideDistSum = 0;

  for (let dy = 0; dy < h; dy++) {
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const isSolid = mask ? mask[dy]?.[dz]?.[dx] : true;
        const cellX = x + dx;
        const cellZ = z + dz;
        const cellY = y + dy;

        if (isSolid) {
          solidCount++;
          if (bitset.isClaimed(cellX, cellZ, cellY)) {
            collisionCount++;
            targetVoxels.push({ pos: [cellX, cellZ, cellY], status: 'COLLISION' });
          } else if (lattice.isOccupied(cellX, cellZ, cellY)) {
            modelCount++;
            targetVoxels.push({ pos: [cellX, cellZ, cellY], status: 'MATCH' });
          } else {
            airCount++;
            targetVoxels.push({ pos: [cellX, cellZ, cellY], status: 'AIR' });
            // Distance check to model surface
            const hasNeighbor =
              lattice.isOccupied(cellX + 1, cellZ, cellY) ||
              lattice.isOccupied(cellX - 1, cellZ, cellY) ||
              lattice.isOccupied(cellX, cellZ + 1, cellY) ||
              lattice.isOccupied(cellX, cellZ - 1, cellY) ||
              lattice.isOccupied(cellX, cellZ, cellY + 1) ||
              lattice.isOccupied(cellX, cellZ, cellY - 1);
            outsideDistSum += hasNeighbor ? 1.0 : 2.5;
          }
        } else {
          // Cutout cell of slope/wedge: must not collide with an already-claimed brick
          if (bitset.isClaimed(cellX, cellZ, cellY)) {
            collisionCount++;
            targetVoxels.push({ pos: [cellX, cellZ, cellY], status: 'COLLISION' });
          }
        }
      }
    }
  }

  if (collisionCount > 0) {
    return {
      score: -1,
      valid: false,
      loss: 999,
      overlapRatio: 0,
      modelCount,
      solidCount,
      airCount,
      rejectionReason: `Physical collision with placed brick (${collisionCount} cells)`,
      targetVoxels
    };
  }

  if (solidCount === 0) {
    return {
      score: -1,
      valid: false,
      loss: 999,
      overlapRatio: 0,
      modelCount: 0,
      solidCount: 0,
      airCount: 0,
      rejectionReason: 'Candidate has 0 solid cells',
      targetVoxels
    };
  }

  const overlapRatio = modelCount / solidCount;

  const studArea = w * d;

  // Minimum overlap threshold based on candidate volume / tier:
  // 1x1 pieces must be 100% inside model volume.
  // Larger bricks (e.g. 2x4, 2x6, 1x4, 2x2) allow 70% to 80% overlap so they greedily span!
  let minOverlap = 0.85;
  if (studArea === 1) {
    minOverlap = 0.95; // Small 1x1 pieces must tightly match model
  } else if (studArea >= 8) {
    minOverlap = 0.70; // 2x4 (8 studs), 2x6 (12 studs), 2x8 (16 studs) greedily span
  } else if (studArea >= 4) {
    minOverlap = 0.75; // 2x2 (4 studs), 1x4 (4 studs)
  } else if (studArea >= 2) {
    minOverlap = 0.80; // 1x2 (2 studs)
  }

  // Slopes / wedges / curves allow slightly relaxed overlap when normal aligns
  if (
    variant.category === 'SLOPE_CURVED' ||
    variant.category === 'SLOPE_45' ||
    variant.category === 'CHEESE_SLOPE' ||
    variant.category === 'SLOPE_INVERTED' ||
    variant.category === 'WEDGE_PLATE'
  ) {
    minOverlap = Math.min(minOverlap, 0.65);
  }

  if (overlapRatio < minOverlap) {
    return {
      score: -1,
      valid: false,
      loss: (1 - overlapRatio) * 50,
      overlapRatio,
      modelCount,
      solidCount,
      airCount,
      rejectionReason: `Overlap ${Math.round(overlapRatio * 100)}% below min ${Math.round(minOverlap * 100)}%`,
      targetVoxels
    };
  }

  // 3. Continuous Loss Metric: air penalty + boundary distance penalty
  const loss = (1.0 - overlapRatio) * 35.0 + (outsideDistSum / solidCount) * 12.0;

  // 4. Mechanical Connectivity: At y > 0, piece must connect to an already-grounded brick
  if (y > 0 && !assemblyGraph.canConnectToGrounded(x, z, y, variant.connectors)) {
    return {
      score: -1,
      valid: false,
      loss: loss + 100,
      overlapRatio,
      modelCount,
      solidCount,
      airCount,
      rejectionReason: 'Not connected to grounded brick at y > 0',
      targetVoxels
    };
  }

  // 5. Check canisters: never float in mid-air, strictly restricted to dedicated vertical pillar pass
  if (variant.category === 'ROUND_CANISTER') {
    if (!constraints.checkPillar) {
      return {
        score: -1,
        valid: false,
        loss: 80,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: 'Canisters restricted to dedicated vertical pole pass',
        targetVoxels
      };
    }

    if (y > 0 && !hasSupportUnderneath(x, z, y, w, d, bitset)) {
      return {
        score: -1,
        valid: false,
        loss: 80,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: 'Canister requires solid support underneath',
        targetVoxels
      };
    }

    // Must be an isolated vertical column (no horizontal neighbors in X or Z)
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        const hasHorizontalNeighbor =
          (dx === 0 && lattice.isOccupied(cx - 1, cz, y)) ||
          (dx === w - 1 && lattice.isOccupied(cx + 1, cz, y)) ||
          (dz === 0 && lattice.isOccupied(cx, cz - 1, y)) ||
          (dz === d - 1 && lattice.isOccupied(cx, cz + 1, y));
        if (hasHorizontalNeighbor) {
          return {
            score: -1,
            valid: false,
            loss: 80,
            overlapRatio,
            modelCount,
            solidCount,
            airCount,
            rejectionReason: 'Canister restricted to isolated vertical poles/uprights',
            targetVoxels
          };
        }
      }
    }
  }

  // 7. Hemispherical Apex Domes / Inverted Dishes: strictly for top apexes
  if (variant.category === 'ORGANIC_DOME') {
    if (!constraints.requireApex) {
      return {
        score: -1,
        valid: false,
        loss: 80,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: 'Organic dome reserved for apex only',
        targetVoxels
      };
    }
    const hasAirAbove = !lattice.isOccupied(x, z, y + h);
    if (!hasAirAbove) {
      return {
        score: -1,
        valid: false,
        loss: 80,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: 'Apex dome requires open air above',
        targetVoxels
      };
    }
  }

  const isDirectionalSlope =
    variant.category === 'SLOPE_CURVED' ||
    variant.category === 'SLOPE_45' ||
    variant.category === 'CHEESE_SLOPE' ||
    variant.category === 'SLOPE_INVERTED';

  let normalScore = 0;

  if (isDirectionalSlope) {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (!vNorm) {
      return {
        score: -1,
        valid: false,
        loss: 60,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: 'No surface normal found for slope',
        targetVoxels
      };
    }

    const [nx, ny, nz] = vNorm;
    const len = Math.hypot(nx, ny, nz) || 1;
    const cosAngle = Math.max(-1, Math.min(1, ny / len));
    const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

    const isInverted = variant.category === 'SLOPE_INVERTED';

    if (isInverted) {
      const undersideCos = Math.max(-1, Math.min(1, -ny / len));
      const undersideAngleDeg = (Math.acos(undersideCos) * 180) / Math.PI;
      if (undersideAngleDeg < 18 || undersideAngleDeg > 65) {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Slope inverted angle mismatch',
          targetVoxels
        };
      }
      if (y > 0 && lattice.isOccupied(x, z, y - 1)) {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Slope inverted blocked below',
          targetVoxels
        };
      }

      const [tnx, tny, tnz] = variant.targetNormal;
      const hNorm = Math.hypot(nx, nz);
      const tHoriz = Math.hypot(tnx, tnz);
      if (hNorm > 0.01 && tHoriz > 0.01) {
        const horizDot = (nx * tnx + nz * tnz) / (hNorm * tHoriz);
        if (horizDot < 0.25) {
          return {
            score: -1,
            valid: false,
            loss: 60,
            overlapRatio,
            modelCount,
            solidCount,
            airCount,
            rejectionReason: 'Slope inverted horizontal dot product too low',
            targetVoxels
          };
        }
        normalScore += horizDot * 40.0;
      } else {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Slope inverted normal horizontal degenerate',
          targetVoxels
        };
      }
    } else {
      if (ny < -0.15) {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Upward slope facing downwards',
          targetVoxels
        };
      }
      if (angleDeg < 18 || angleDeg > 65) {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Surface angle outside slope range (18-65 deg)',
          targetVoxels
        };
      }

      const [tnx, tny, tnz] = variant.targetNormal;
      const hNorm = Math.hypot(nx, nz);
      const tHoriz = Math.hypot(tnx, tnz);
      if (hNorm > 0.01 && tHoriz > 0.01) {
        const horizDot = (nx * tnx + nz * tnz) / (hNorm * tHoriz);
        if (horizDot < 0.35) {
          return {
            score: -1,
            valid: false,
            loss: 60,
            overlapRatio,
            modelCount,
            solidCount,
            airCount,
            rejectionReason: 'Slope orientation does not match surface gradient',
            targetVoxels
          };
        }
        normalScore += horizDot * 40.0;
      } else {
        return {
          score: -1,
          valid: false,
          loss: 60,
          overlapRatio,
          modelCount,
          solidCount,
          airCount,
          rejectionReason: 'Slope normal horizontal degenerate',
          targetVoxels
        };
      }

      if (variant.category === 'SLOPE_45') {
        if (angleDeg >= 32 && angleDeg <= 58) {
          normalScore += 75.0;
        } else {
          return { score: -1, valid: false, loss: 50, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Slope 45 angle mismatch', targetVoxels };
        }
      } else if (variant.category === 'CHEESE_SLOPE') {
        if (angleDeg >= 18 && angleDeg <= 42) {
          normalScore += 75.0;
        } else {
          return { score: -1, valid: false, loss: 50, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Cheese slope angle mismatch', targetVoxels };
        }
      } else if (variant.category === 'SLOPE_CURVED') {
        if (angleDeg >= 20 && angleDeg <= 65) {
          normalScore += 70.0;
        } else {
          return { score: -1, valid: false, loss: 50, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Curved slope angle mismatch', targetVoxels };
        }
      }
    }
  } else if (variant.category === 'WEDGE_PLATE') {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (!vNorm) return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'No normal for wedge', targetVoxels };
    const [nx, ny, nz] = vNorm;
    const [tnx, tny, tnz] = variant.targetNormal;
    const hNorm = Math.hypot(nx, nz);
    const tHoriz = Math.hypot(tnx, tnz);

    if (hNorm > 0.01 && tHoriz > 0.01) {
      const horizDot = (nx * tnx + nz * tnz) / (hNorm * tHoriz);
      if (horizDot < 0.30) return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Wedge normal dot too low', targetVoxels };
      normalScore += horizDot * 50.0;
    } else {
      return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Wedge normal horizontal degenerate', targetVoxels };
    }
  } else if (variant.category === 'TILE_FLAT') {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (!vNorm || vNorm[1] < 0.50) return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Tile requires upward facing normal', targetVoxels };

    const topY = y + h;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (lattice.isOccupied(x + dx, z + dz, topY)) {
          return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Tile blocked above', targetVoxels };
        }
      }
    }
    normalScore += 80.0;
  } else if (variant.category === 'ORGANIC_DOME') {
    normalScore += 80.0;
  } else if (variant.category === 'MACARONI_WEDGE') {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (vNorm) {
      const [nx, ny, nz] = vNorm;
      const len = Math.hypot(nx, ny, nz) || 1;
      const cosAngle = Math.max(-1, Math.min(1, ny / len));
      const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;
      if (angleDeg >= 45) {
        normalScore += 55.0;
      }
    }
  } else if (variant.category === 'BIONICLE_CREATURE') {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (vNorm) {
      const [nx, ny, nz] = vNorm;
      const [tnx, tny, tnz] = variant.targetNormal;
      const dot = nx * tnx + ny * tny + nz * tnz;
      if (dot > 0.35) {
        normalScore += dot * 55.0;
      } else {
        return { score: -1, valid: false, loss: 60, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Bionicle normal dot too low', targetVoxels };
      }
    }
  } else if (variant.category === 'BRICK_STANDARD' || variant.category === 'PLATE_STANDARD') {
    const vNorm = getRepresentativeNormal(x, z, y, variant, lattice);
    if (vNorm) {
      const [nx, ny, nz] = vNorm;
      const len = Math.hypot(nx, ny, nz) || 1;
      const cosAngle = Math.max(-1, Math.min(1, ny / len));
      const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

      const isSurface = hasVoxelAtDepth0(x, z, y, variant, lattice);
      if (isSurface) {
        if (angleDeg > 65) {
          normalScore += 50.0;
        } else if (angleDeg >= 18 && angleDeg <= 65) {
          if (constraints.preferInterior) {
            return { score: -1, valid: false, loss: 50, overlapRatio, modelCount, solidCount, airCount, rejectionReason: 'Sloping surface reserved for slopes', targetVoxels };
          } else {
            normalScore -= 30.0;
          }
        }
      }
    }
  }

  // 8. Color Variance Gating (Preserve texture boundaries)
  if (w * d > 1 && options.colorVarianceThreshold !== undefined) {
    const variance = calculateColorVariance(x, z, y, w, d, h, lattice);
    if (variance > options.colorVarianceThreshold) {
      return {
        score: -1,
        valid: false,
        loss: 40,
        overlapRatio,
        modelCount,
        solidCount,
        airCount,
        rejectionReason: `Color variance (${Math.round(variance)}) exceeds threshold`,
        targetVoxels
      };
    }
  }

  // 9. Seam Interlocking & Running Bond
  let interlockScore = 0;
  if (constraints.enforceRunningBond || variant.def.tier === 5) {
    interlockScore = assemblyGraph.evaluateSeamInterlock(x, z, y, w, d, h);
  }

  // Alternating layer orientation bias for masonry running bond (criss-cross):
  const brickLayer = Math.floor(y / (lattice.verticalUnit === 'brick' ? 1 : 3));
  const isEvenBrick = brickLayer % 2 === 0;
  let orientationScore = 0;
  if (w !== d) {
    if (isEvenBrick && w > d) orientationScore += 1.0;
    else if (!isEvenBrick && d > w) orientationScore += 1.0;
  }

  // OMR Frequency bonus:
  const omrBonus = variant.def.omrFrequency ? Math.min(2.5, variant.def.omrFrequency / 25.0) : 0;

  // 10. Volume & Footprint Score: Exponential scaling favoring larger smart bricks (2x4, 2x6, 1x4, 2x2):
  const volumeScore = Math.pow(studArea, 1.35) * 8.0;

  // Heavy penalty for single stud pieces, bonus for large bricks:
  let singleStudPenalty = 0;
  if (studArea === 1) {
    singleStudPenalty = -45.0;
  } else if (studArea >= 8) {
    singleStudPenalty = 25.0; // Bonus for large smart bricks (2x4, 2x6, 2x8)
  } else if (studArea >= 4) {
    singleStudPenalty = 15.0; // Bonus for 2x2, 1x4
  }

  const lossDeduction = loss * 1.2;
  const groundBonus = y > 0 ? 25.0 : 10.0;
  const baseScore = variant.def.weightBonus * 10.0 + volumeScore + normalScore + orientationScore + omrBonus + groundBonus + singleStudPenalty - lossDeduction;
  const finalScore = Math.max(0.1, baseScore + interlockScore);

  return {
    score: finalScore,
    valid: true,
    loss,
    overlapRatio,
    modelCount,
    solidCount,
    airCount,
    targetVoxels
  };
}

/**
 * Evaluates a candidate kernel permutation at (x, z, y), returning a comprehensive score or -1 if invalid.
 */
export function evaluateCandidate(
  x: number,
  z: number,
  y: number,
  variant: RotatedKernelVariant,
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: EvaluatorOptions,
  constraints: EvaluatorConstraints = {}
): number {
  const details = evaluateCandidateDetails(
    x,
    z,
    y,
    variant,
    lattice,
    bitset,
    integral,
    assemblyGraph,
    options,
    constraints
  );
  return details.valid ? details.score : -1;
}
