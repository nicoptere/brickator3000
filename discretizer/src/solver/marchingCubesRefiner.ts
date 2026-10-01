import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { RotatedKernelVariant } from '../kernels/types';
import { evaluateCandidate } from './candidateEvaluator';
import { commitCandidate } from './pipelineDispatcher';

export interface ContourGradient {
  gx: number;
  gy: number;
  gz: number;
  angleDeg: number;
  isCurved: boolean;
  isCorner: boolean;
  isInverted: boolean;
}

/**
 * Computes local 2x2x2 / 26-neighborhood marching contour gradient for boundary cell (x, z, y).
 */
export function computeContourGradient(
  x: number,
  z: number,
  y: number,
  lattice: PlateLattice3D
): ContourGradient | null {
  const v = lattice.getVoxel(x, z, y);
  if (!v) return null;

  // Discrete central difference gradient across 3x3x3 neighborhood
  let gx = 0, gy = 0, gz = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const occ = lattice.isOccupied(x + dx, z + dz, y + dy) ? 1 : 0;
        gx -= dx * occ;
        gz -= dz * occ;
        gy -= dy * occ;
      }
    }
  }

  const len = Math.hypot(gx, gy, gz);
  if (len < 0.001) {
    const [nx, ny, nz] = v.normal;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const cosA = Math.max(-1, Math.min(1, Math.abs(ny / nLen)));
    const angle = (Math.acos(cosA) * 180) / Math.PI;
    return {
      gx: nx / nLen,
      gy: ny / nLen,
      gz: nz / nLen,
      angleDeg: angle,
      isCurved: false,
      isCorner: false,
      isInverted: ny < -0.15
    };
  }

  const fnx = gx / len;
  const fny = gy / len;
  const fnz = gz / len;

  const cosAngle = Math.max(-1, Math.min(1, Math.abs(fny)));
  const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

  // Check curvature / corner
  const hDist = Math.hypot(fnx, fnz);
  const isCorner = hDist > 0.4 && Math.abs(fnx) > 0.25 && Math.abs(fnz) > 0.25;
  const isInverted = fny < -0.15;
  const isCurved = angleDeg >= 20 && angleDeg <= 60 && !isCorner;

  return {
    gx: fnx,
    gy: fny,
    gz: fnz,
    angleDeg,
    isCurved,
    isCorner,
    isInverted
  };
}

/**
 * Marching Cubes & Gradient Contour Refiner:
 * Evaluates boundary surface cells to match authentic 45° slopes, 31° cheese slopes,
 * curved slopes, inverted slopes, and corner wedges to continuous geometry.
 */
export async function refineBoundaryContours(
  slopeVariants: RotatedKernelVariant[],
  wedgeVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: any,
  layerY?: number
): Promise<number> {
  const b = lattice.bounds;
  const startY = layerY !== undefined ? layerY : b.minY;
  const endY = layerY !== undefined ? layerY : b.maxY;

  let refinedCount = 0;

  for (let y = startY; y <= endY; y++) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!bitset.isAvailable(x, z, y)) continue;

        const contour = computeContourGradient(x, z, y, lattice);
        if (!contour) continue;

        // Skip nearly flat horizontal surfaces (<18°) and pure vertical walls (>70°)
        if (contour.angleDeg < 18 || contour.angleDeg > 70) continue;

        // Select candidate slopes matching contour gradient
        let matchingVariants: RotatedKernelVariant[] = [];

        if (contour.isInverted) {
          matchingVariants = slopeVariants.filter(v => v.category === 'SLOPE_INVERTED');
        } else if (contour.isCorner && wedgeVariants.length > 0) {
          matchingVariants = [...wedgeVariants, ...slopeVariants];
        } else if (contour.angleDeg >= 38 && contour.angleDeg <= 55) {
          // 45° slopes
          matchingVariants = slopeVariants.filter(v => v.category === 'SLOPE_45' || v.category === 'SLOPE_CURVED');
        } else if (contour.angleDeg >= 20 && contour.angleDeg < 38) {
          // 31°/33° cheese or shallow slopes
          matchingVariants = slopeVariants.filter(v => v.category === 'CHEESE_SLOPE' || v.category === 'SLOPE_CURVED');
        } else {
          matchingVariants = slopeVariants;
        }

        let bestVariant: RotatedKernelVariant | null = null;
        let bestScore = 0;

        for (const variant of matchingVariants) {
          const score = evaluateCandidate(
            x,
            z,
            y,
            variant,
            lattice,
            bitset,
            integral,
            assemblyGraph,
            options,
            { layerY: y, requireDepth0: true }
          );

          if (score > bestScore) {
            bestScore = score;
            bestVariant = variant;
          }
        }

        if (bestVariant && bestScore > 0) {
          commitCandidate(
            x,
            z,
            y,
            bestVariant,
            lattice,
            bitset,
            integral,
            assemblyGraph,
            options.enableVoxelRecompute
          );
          refinedCount++;
        }
      }
    }
  }

  return refinedCount;
}
