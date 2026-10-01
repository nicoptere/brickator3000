import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { RotatedKernelVariant } from '../kernels/types';
import type { PlacedBrick, EvaluationStep } from '../core/types';
import {
  evaluateCandidate,
  evaluateCandidateDetails,
  hasVoxelAtDepth0,
  type CandidateEvaluationResult,
  type EvaluatorConstraints,
  type EvaluatorOptions
} from './candidateEvaluator';
import { SpatialChunkBVH, type SpatialChunk } from './spatialChunkBVH';
import { refineBoundaryContours } from './marchingCubesRefiner';
import { applySpecialFinishElements, applyStudlessTopTiles, isVerticalPoleShaft } from './specialPiecesAndFinish';
import { swapUnitBricksForPlates } from './brickPlateSwapper';
import { runSmartBrickMergePass } from './smartBrickMerger';
import { computeLatticeCurvatureGradient } from '../core/meshCurvature';

export interface DispatcherOptions extends EvaluatorOptions {
  enableVoxelRecompute?: boolean;
  enableMacaroni?: boolean;
  enableCanisters?: boolean;
  enableSlopes?: boolean;
  enableCurvedSlopes?: boolean;
  onProgress?: (stage: string, percent: number) => void;
  evaluationSteps?: EvaluationStep[];
}

/**
 * Samples direct 24-bit RGB color from lattice cell centroids.
 */
export function sampleCentroidColor(
  x: number,
  z: number,
  y: number,
  w: number,
  d: number,
  h: number,
  lattice: PlateLattice3D
): { hex: string; packed: number } {
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

  if (count === 0) {
    return { hex: '#94a3b8', packed: 0x94a3b8 };
  }

  const r = Math.round(rSum / count);
  const g = Math.round(gSum / count);
  const b = Math.round(bSum / count);
  const packed = (r << 16) | (g << 8) | b;
  const hex = '#' + packed.toString(16).padStart(6, '0');

  return { hex, packed };
}

/**
 * Commits a validated candidate brick into bitset, lattice, and assembly graph.
 */
export function commitCandidate(
  x: number,
  z: number,
  y: number,
  variant: RotatedKernelVariant,
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  enableVoxelRecompute: boolean = false
): PlacedBrick {
  const [w, d, h] = variant.size;
  const instanceId = `b_${variant.partId}_${x}_${z}_${y}`;

  // 1. Claim voxels in active 64-bit bitset
  bitset.claimMask(x, z, y, variant.occupancyMask, instanceId);

  // 2. Direct 24-bit RGB sampling
  const sample = sampleCentroidColor(x, z, y, w, d, h, lattice);

  // 3. Authentic LDraw coordinates
  const ldrawPos = lattice.gridToLDraw(x, z, y, w, d, h);

  const placedBrick: PlacedBrick = {
    instanceId,
    partId: variant.partId,
    name: variant.name,
    gridPos: [x, z, y],
    baseSize: variant.def.baseSize,
    size: [w, d, h],
    rotation: variant.rotation,
    colorHex: sample.hex,
    colorPacked: sample.packed,
    ldrawPos,
    ldrawMatrix: variant.ldrawMatrix,
    category: variant.category,
    connectors: variant.connectors,
    occupancyMask: variant.occupancyMask
  };

  // 4. Register in assembly graph
  assemblyGraph.addBrick(placedBrick);

  // 5. Dynamic Voxel Space Recomputation (if enabled)
  if (enableVoxelRecompute) {
    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          if (variant.occupancyMask[dy]?.[dz]?.[dx]) {
            lattice.clearVoxel(x + dx, z + dz, y + dy);
          }
        }
      }
    }
    integral.build(lattice);
    lattice.computeDistanceTransform();
  }

  return placedBrick;
}

/**
 * Runs a single candidate placement pass over the active grid volume.
 */
export async function runPass(
  candidateVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions,
  constraints: EvaluatorConstraints = {}
): Promise<void> {
  if (candidateVariants.length === 0) return;

  const b = lattice.bounds;
  let ops = 0;

  const startY = constraints.layerY !== undefined ? constraints.layerY : b.minY;
  const endY = constraints.layerY !== undefined ? constraints.layerY : b.maxY;

  for (let y = startY; y <= endY; y++) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!bitset.isAvailable(x, z, y)) continue;

        const voxel = lattice.getVoxel(x, z, y);
        if (!voxel) continue;

        // Skip anchors too deep to touch depth 0 in surface passes
        if (constraints.requireDepth0 && voxel.depth > 2) continue;

        // Top tiles must face open air
        if (constraints.requireExposedTop && lattice.isOccupied(x, z, y + 1)) continue;

        // Check if apex
        if (constraints.requireApex) {
          const isNearApex = y >= b.maxY - 2;
          const hasAirAbove = !lattice.isOccupied(x, z, y + 1);
          if (!isNearApex || !hasAirAbove) continue;
        }

        let bestVariant: RotatedKernelVariant | null = null;
        let bestScore = 0;
        let bestAnchor = { x, z };
        let bestDetails: CandidateEvaluationResult | null = null;

        for (const variant of candidateVariants) {
          const w = variant.size[0];
          const d = variant.size[1];

          const offsets: [number, number][] = [];
          for (let offZ = 0; offZ < d; offZ++) {
            for (let offX = 0; offX < w; offX++) {
              offsets.push([offX, offZ]);
            }
          }

          for (const [offX, offZ] of offsets) {
            const ax = x - offX;
            const az = z - offZ;

            if (
              ax < 0 || ax + w > lattice.numStudsX ||
              az < 0 || az + d > lattice.numStudsZ
            ) {
              continue;
            }

            if (constraints.requireDepth0 && !hasVoxelAtDepth0(ax, az, y, variant, lattice)) {
              continue;
            }

            const details = evaluateCandidateDetails(
              ax,
              az,
              y,
              variant,
              lattice,
              bitset,
              integral,
              assemblyGraph,
              options,
              constraints
            );

            if (details.valid && details.score > bestScore + 0.001) {
              bestScore = details.score;
              bestVariant = variant;
              bestAnchor = { x: ax, z: az };
              bestDetails = details;
            } else if (
              details.valid &&
              Math.abs(details.score - bestScore) <= 0.001 &&
              bestVariant &&
              details.score > 0
            ) {
              const volCurrent = w * d * variant.size[2];
              const volBest = bestVariant.size[0] * bestVariant.size[1] * bestVariant.size[2];
              if (volCurrent > volBest) {
                bestScore = details.score;
                bestVariant = variant;
                bestAnchor = { x: ax, z: az };
                bestDetails = details;
              }
            } else if (!details.valid && options.evaluationSteps && options.evaluationSteps.length < 250 && Math.random() < 0.02) {
              options.evaluationSteps.push({
                stepIndex: options.evaluationSteps.length,
                stage: constraints.layerY !== undefined ? `Layer ${constraints.layerY}` : 'Placement Pass',
                partId: variant.partId,
                partName: variant.name,
                category: variant.category,
                gridPos: [ax, az, y],
                size: [w, d, variant.size[2]],
                rotation: variant.rotation,
                occupancyMask: variant.occupancyMask,
                overlapRatio: details.overlapRatio,
                loss: details.loss,
                score: -1,
                status: 'REJECTED',
                rejectionReason: details.rejectionReason,
                targetVoxels: details.targetVoxels
              });
            }
          }
        }

        if (bestVariant && bestScore > 0 && bestDetails) {
          commitCandidate(
            bestAnchor.x,
            bestAnchor.z,
            y,
            bestVariant,
            lattice,
            bitset,
            integral,
            assemblyGraph,
            options.enableVoxelRecompute
          );

          if (options.evaluationSteps && options.evaluationSteps.length < 250) {
            options.evaluationSteps.push({
              stepIndex: options.evaluationSteps.length,
              stage: constraints.layerY !== undefined ? `Layer ${constraints.layerY}` : 'Candidate Fit',
              partId: bestVariant.partId,
              partName: bestVariant.name,
              category: bestVariant.category,
              gridPos: [bestAnchor.x, bestAnchor.z, y],
              size: [bestVariant.size[0], bestVariant.size[1], bestVariant.size[2]],
              rotation: bestVariant.rotation,
              occupancyMask: bestVariant.occupancyMask,
              overlapRatio: bestDetails.overlapRatio,
              loss: bestDetails.loss,
              score: bestScore,
              status: 'ACCEPTED',
              targetVoxels: bestDetails.targetVoxels
            });
          }
        }

        ops++;
        if (ops % 1500 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
  }
}

/**
 * Runs candidate placement over spatial chunks, prioritizing highest-density chunks first.
 */
export async function runChunkPass(
  chunks: SpatialChunk[],
  candidateVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions,
  constraints: EvaluatorConstraints = {}
): Promise<void> {
  if (candidateVariants.length === 0 || chunks.length === 0) return;

  for (const chunk of chunks) {
    if (chunk.activeCount === 0) continue;
    const { minX, maxX, minZ, maxZ, minY, maxY } = chunk.bounds;

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!bitset.isAvailable(x, z, y)) continue;

          let bestVariant: RotatedKernelVariant | null = null;
          let bestScore = 0;
          let bestAnchor = { x, z };
          let bestDetails: CandidateEvaluationResult | null = null;

          for (const variant of candidateVariants) {
            const w = variant.size[0];
            const d = variant.size[1];

            const offsets: [number, number][] = [];
            for (let offZ = 0; offZ < d; offZ++) {
              for (let offX = 0; offX < w; offX++) {
                offsets.push([offX, offZ]);
              }
            }

            for (const [offX, offZ] of offsets) {
              const ax = x - offX;
              const az = z - offZ;

              if (
                ax < 0 || ax + w > lattice.numStudsX ||
                az < 0 || az + d > lattice.numStudsZ
              ) {
                continue;
              }

              if (constraints.requireDepth0 && !hasVoxelAtDepth0(ax, az, y, variant, lattice)) {
                continue;
              }

              const details = evaluateCandidateDetails(
                ax,
                az,
                y,
                variant,
                lattice,
                bitset,
                integral,
                assemblyGraph,
                options,
                constraints
              );

              if (details.valid && details.score > bestScore + 0.001) {
                bestScore = details.score;
                bestVariant = variant;
                bestAnchor = { x: ax, z: az };
                bestDetails = details;
              } else if (
                details.valid &&
                Math.abs(details.score - bestScore) <= 0.001 &&
                bestVariant &&
                details.score > 0
              ) {
                const volCurrent = w * d * variant.size[2];
                const volBest = bestVariant.size[0] * bestVariant.size[1] * bestVariant.size[2];
                if (volCurrent > volBest) {
                  bestScore = details.score;
                  bestVariant = variant;
                  bestAnchor = { x: ax, z: az };
                  bestDetails = details;
                }
              }
            }
          }

          if (bestVariant && bestScore > 0 && bestDetails) {
            commitCandidate(
              bestAnchor.x,
              bestAnchor.z,
              y,
              bestVariant,
              lattice,
              bitset,
              integral,
              assemblyGraph,
              options.enableVoxelRecompute
            );

            if (options.evaluationSteps && options.evaluationSteps.length < 250) {
              options.evaluationSteps.push({
                stepIndex: options.evaluationSteps.length,
                stage: constraints.layerY !== undefined ? `Chunk Layer ${constraints.layerY}` : 'Chunk Fit',
                partId: bestVariant.partId,
                partName: bestVariant.name,
                category: bestVariant.category,
                gridPos: [bestAnchor.x, bestAnchor.z, y],
                size: [bestVariant.size[0], bestVariant.size[1], bestVariant.size[2]],
                rotation: bestVariant.rotation,
                occupancyMask: bestVariant.occupancyMask,
                overlapRatio: bestDetails.overlapRatio,
                loss: bestDetails.loss,
                score: bestScore,
                status: 'ACCEPTED',
                targetVoxels: bestDetails.targetVoxels
              });
            }
          }
        }
      }
    }
  }
}


/**
 * Selects and places authentic modern curved slopes, 45° slopes, cheese slopes,
 * inverted slopes, and corner wedges on angled/curved boundary facets.
 */
export async function placeBoundarySlopesAndWedges(
  slopeVariants: RotatedKernelVariant[],
  wedgeVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions,
  layerY?: number
): Promise<number> {
  const b = lattice.bounds;
  const startY = layerY !== undefined ? layerY : b.minY;
  const endY = layerY !== undefined ? layerY : b.maxY;
  let slopesPlaced = 0;

  for (let y = startY; y <= endY; y++) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!bitset.isAvailable(x, z, y)) continue;

        const v = lattice.getVoxel(x, z, y);
        if (!v) continue;

        // Surface hull check
        if (lattice.getDepth(x, z, y) > 1) continue;

        const [nx, ny, nz] = v.normal;
        const len = Math.hypot(nx, ny, nz) || 1;
        const fnx = nx / len;
        const fny = ny / len;
        const fnz = nz / len;

        // Vertical wall gating (per slope_gating.test.ts: theta = 90 deg, |fny| < 0.15)
        // Skip vertical walls!
        if (Math.abs(fny) < 0.15) continue;

        // Flat horizontal top deck (fny > 0.85) -> Skip! Handled by standard bricks + studless flat tiles
        if (fny > 0.85) continue;

        const curv = computeLatticeCurvatureGradient(lattice, x, z, y);
        const isCorner = curv.isCorner || (Math.abs(fnx) > 0.35 && Math.abs(fnz) > 0.35);
        const isInverted = fny < -0.15;

        let targetRot = 0;
        if (curv.principalAxis === 'X') {
          targetRot = fnx < 0 ? 90 : 270;
        } else {
          targetRot = fnz > 0 ? 0 : 180;
        }

        let candidates: RotatedKernelVariant[] = [];

        if (isInverted) {
          candidates = slopeVariants.filter(
            s => s.category === 'SLOPE_INVERTED' && s.rotation === targetRot
          );
        } else if (isCorner && wedgeVariants.length > 0) {
          candidates = [
            ...wedgeVariants.filter(w => Math.abs(w.rotation - targetRot) < 90),
            ...slopeVariants.filter(s => s.rotation === targetRot)
          ];
        } else {
          const curved = slopeVariants.filter(
            s => s.category === 'SLOPE_CURVED' && s.rotation === targetRot
          );
          const slope45 = slopeVariants.filter(
            s => s.category === 'SLOPE_45' && s.rotation === targetRot
          );
          const cheese = slopeVariants.filter(
            s => s.category === 'CHEESE_SLOPE' && s.rotation === targetRot
          );
          candidates = [...curved, ...slope45, ...cheese];
        }

        if (candidates.length === 0) continue;

        // Sort by volume descending so larger slopes (2x2, 4x1) are tried first
        candidates.sort((c1, c2) => {
          const v1 = c1.size[0] * c1.size[1] * c1.size[2];
          const v2 = c2.size[0] * c2.size[1] * c2.size[2];
          return v2 - v1;
        });

        let placed = false;
        for (const variant of candidates) {
          const [sw, sd, sh] = variant.size;

          for (let oz = 0; oz < sd; oz++) {
            for (let ox = 0; ox < sw; ox++) {
              const ax = x - ox;
              const az = z - oz;

              if (
                ax < b.minX || ax + sw - 1 > b.maxX ||
                az < b.minZ || az + sd - 1 > b.maxZ ||
                y + sh - 1 > b.maxY
              ) {
                continue;
              }

              // Upward slopes must not be buried beneath solid model structure above
              if (!isInverted) {
                let buried = false;
                for (let dz = 0; dz < sd; dz++) {
                  for (let dx = 0; dx < sw; dx++) {
                    const cx = ax + dx;
                    const cz = az + dz;
                    if (y + sh < lattice.numPlatesY && lattice.isOccupied(cx, cz, y + sh)) {
                      buried = true;
                      break;
                    }
                  }
                  if (buried) break;
                }
                if (buried) continue;
              }

              let collision = false;
              let solidCount = 0;
              let modelCount = 0;

              for (let dy = 0; dy < sh; dy++) {
                for (let dz = 0; dz < sd; dz++) {
                  for (let dx = 0; dx < sw; dx++) {
                    const isSolid = variant.occupancyMask[dy]?.[dz]?.[dx] ?? true;
                    const cx = ax + dx;
                    const cz = az + dz;
                    const cy = y + dy;

                    if (isSolid) {
                      solidCount++;
                      if (bitset.isClaimed(cx, cz, cy)) {
                        collision = true;
                        break;
                      }
                      // Core protection: cosmetic slope must NOT claim interior core voxels!
                      if (lattice.getDepth(cx, cz, cy) >= 2) {
                        collision = true;
                        break;
                      }
                      if (lattice.isOccupied(cx, cz, cy)) {
                        modelCount++;
                      }
                    } else {
                      if (bitset.isClaimed(cx, cz, cy)) {
                        collision = true;
                        break;
                      }
                    }
                  }
                  if (collision) break;
                }
                if (collision) break;
              }

              if (collision || solidCount === 0) continue;
              if (modelCount / solidCount < 0.60) continue;

              // Mechanical grounding check: must snap to grounded elements below
              if (y > b.minY && !assemblyGraph.canConnectToGrounded(ax, az, y, variant.connectors)) {
                continue;
              }

              commitCandidate(
                ax,
                az,
                y,
                variant,
                lattice,
                bitset,
                integral,
                assemblyGraph,
                options.enableVoxelRecompute
              );
              slopesPlaced++;
              placed = true;
              break;
            }
            if (placed) break;
          }
          if (placed) break;
        }
      }
    }
  }

  return slopesPlaced;
}

/**
 * 2D Maximal Rectangle / Greedy Brick Packing per Layer with Running Bond Seam Staggering.
 * Prioritizes large 2xN bricks (2x8, 2x6, 2x4, 2x3, 2x2), then 1xN bricks (1x8, 1x6, 1x4, 1x3, 1x2).
 * Strictly discourages or prevents atomic 1x1 bricks until all larger shapes have been exhausted.
 */
export function packLayerBricks(
  layerY: number,
  brickHeight: number,
  brickVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): number {
  const b = lattice.bounds;
  const layerIdx = Math.floor(layerY / brickHeight);
  const isXMajor = layerIdx % 2 === 0;
  const startXOffset = (layerIdx % 3) * 2;
  const startZOffset = ((layerIdx + 1) % 3) * 2;

  const variantMap = new Map<string, RotatedKernelVariant>();
  for (const v of brickVariants) {
    if (v.size[2] !== brickHeight) continue;
    const key = `${v.size[0]},${v.size[1]}`;
    if (!variantMap.has(key)) {
      variantMap.set(key, v);
    }
  }

  const shapes2x = isXMajor
    ? [
        [8, 2], [2, 8],
        [6, 2], [2, 6],
        [4, 2], [2, 4],
        [3, 2], [2, 3],
        [2, 2]
      ]
    : [
        [2, 8], [8, 2],
        [2, 6], [6, 2],
        [2, 4], [4, 2],
        [2, 3], [3, 2],
        [2, 2]
      ];

  const shapes1x = isXMajor
    ? [
        [8, 1], [1, 8],
        [6, 1], [1, 6],
        [4, 1], [1, 4],
        [3, 1], [1, 3],
        [2, 1], [1, 2]
      ]
    : [
        [1, 8], [8, 1],
        [1, 6], [6, 1],
        [1, 4], [4, 1],
        [1, 3], [3, 1],
        [1, 2], [2, 1]
      ];

  let placedCount = 0;

  const canFitBrick = (x: number, z: number, w: number, d: number): boolean => {
    if (
      x < b.minX || x + w - 1 > b.maxX ||
      z < b.minZ || z + d - 1 > b.maxZ ||
      layerY + brickHeight - 1 > b.maxY
    ) {
      return false;
    }

    let modelCount = 0;
    const totalCells = w * d * brickHeight;

    for (let dy = 0; dy < brickHeight; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const cx = x + dx;
          const cz = z + dz;
          const cy = layerY + dy;

          if (bitset.isClaimed(cx, cz, cy)) return false;
          if (lattice.isOccupied(cx, cz, cy)) {
            if (options.enableCanisters && isVerticalPoleShaft(cx, cz, cy, lattice, bitset)) {
              return false; // Reserved for vertical canister pass
            }
            modelCount++;
          }
        }
      }
    }

    if (modelCount === 0) return false;

    const area = w * d;
    let minOverlap = 1.0;
    if (area >= 8) minOverlap = 0.45;
    else if (area >= 4) minOverlap = 0.50;
    else if (area >= 3) minOverlap = 0.67;
    else minOverlap = 1.0;

    const overlap = modelCount / totalCells;
    if (overlap < minOverlap) return false;

    // Grounding check
    if (layerY > lattice.bounds.minY) {
      let hasSupport = false;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          if (bitset.isClaimed(x + dx, z + dz, layerY - 1)) {
            const ownerId = bitset.getCellOwner(x + dx, z + dz, layerY - 1);
            if (ownerId && assemblyGraph.isGrounded(ownerId)) {
              hasSupport = true;
              break;
            }
          }
        }
        if (hasSupport) break;
      }
      if (!hasSupport) return false;
    }

    return true;
  };

  // 1. Pass 2A: Large 2xN Bricks
  for (const [w, d] of shapes2x) {
    const variant = variantMap.get(`${w},${d}`);
    if (!variant) continue;

    for (let stepZ = 0; stepZ < lattice.numStudsZ; stepZ++) {
      const z = (stepZ + startZOffset) % lattice.numStudsZ;
      if (z < b.minZ || z > b.maxZ) continue;

      for (let stepX = 0; stepX < lattice.numStudsX; stepX++) {
        const x = (stepX + startXOffset) % lattice.numStudsX;
        if (x < b.minX || x > b.maxX) continue;

        if (canFitBrick(x, z, w, d)) {
          commitCandidate(x, z, layerY, variant, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  // 2. Pass 2B: 1xN Margin Bricks
  for (const [w, d] of shapes1x) {
    const variant = variantMap.get(`${w},${d}`);
    if (!variant) continue;

    for (let stepZ = 0; stepZ < lattice.numStudsZ; stepZ++) {
      const z = (stepZ + startZOffset) % lattice.numStudsZ;
      if (z < b.minZ || z > b.maxZ) continue;

      for (let stepX = 0; stepX < lattice.numStudsX; stepX++) {
        const x = (stepX + startXOffset) % lattice.numStudsX;
        if (x < b.minX || x > b.maxX) continue;

        if (canFitBrick(x, z, w, d)) {
          commitCandidate(x, z, layerY, variant, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  // 3. Pass 2C: Absolute Last Resort Fallback (1x1)
  const v1x1 = variantMap.get('1,1');
  if (v1x1) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!bitset.isAvailable(x, z, layerY)) continue;
        if (!lattice.isOccupied(x, z, layerY)) continue;
        if (options.enableCanisters && isVerticalPoleShaft(x, z, layerY, lattice, bitset)) {
          continue; // Reserved for vertical pole canister pass
        }

        if (canFitBrick(x, z, 1, 1)) {
          commitCandidate(x, z, layerY, v1x1, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  return placedCount;
}

/**
 * 2D Maximal Rectangle / Greedy Plate Packing for single-plate leftover layers.
 */
export function packLayerPlates(
  layerY: number,
  plateVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): number {
  const b = lattice.bounds;
  const isXMajor = layerY % 2 === 0;
  const startXOffset = (layerY % 3) * 2;
  const startZOffset = ((layerY + 1) % 3) * 2;

  const variantMap = new Map<string, RotatedKernelVariant>();
  for (const v of plateVariants) {
    if (v.size[2] !== 1) continue;
    const key = `${v.size[0]},${v.size[1]}`;
    if (!variantMap.has(key)) {
      variantMap.set(key, v);
    }
  }

  const shapes2x = isXMajor
    ? [
        [8, 2], [2, 8],
        [6, 2], [2, 6],
        [4, 2], [2, 4],
        [3, 2], [2, 3],
        [2, 2]
      ]
    : [
        [2, 8], [8, 2],
        [2, 6], [6, 2],
        [2, 4], [4, 2],
        [2, 3], [3, 2],
        [2, 2]
      ];

  const shapes1x = isXMajor
    ? [
        [8, 1], [1, 8],
        [6, 1], [1, 6],
        [4, 1], [1, 4],
        [3, 1], [1, 3],
        [2, 1], [1, 2]
      ]
    : [
        [1, 8], [8, 1],
        [1, 6], [6, 1],
        [1, 4], [4, 1],
        [1, 3], [3, 1],
        [1, 2], [2, 1]
      ];

  let placedCount = 0;

  const canFitPlate = (x: number, z: number, w: number, d: number): boolean => {
    if (
      x < b.minX || x + w - 1 > b.maxX ||
      z < b.minZ || z + d - 1 > b.maxZ ||
      layerY > b.maxY
    ) {
      return false;
    }

    let modelCount = 0;
    const totalCells = w * d;

    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        if (bitset.isClaimed(cx, cz, layerY)) return false;
        if (lattice.isOccupied(cx, cz, layerY)) {
          if (options.enableCanisters && isVerticalPoleShaft(cx, cz, layerY, lattice, bitset)) {
            return false;
          }
          modelCount++;
        }
      }
    }

    if (modelCount === 0) return false;
    const area = w * d;
    let minOverlap = 1.0;
    if (area >= 8) minOverlap = 0.45;
    else if (area >= 4) minOverlap = 0.50;
    else if (area >= 3) minOverlap = 0.67;
    else minOverlap = 1.0;
    if (modelCount / totalCells < minOverlap) return false;

    if (layerY > lattice.bounds.minY) {
      let hasSupport = false;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          if (bitset.isClaimed(x + dx, z + dz, layerY - 1)) {
            const ownerId = bitset.getCellOwner(x + dx, z + dz, layerY - 1);
            if (ownerId && assemblyGraph.isGrounded(ownerId)) {
              hasSupport = true;
              break;
            }
          }
        }
        if (hasSupport) break;
      }
      if (!hasSupport) return false;
    }

    return true;
  };

  for (const [w, d] of shapes2x) {
    const variant = variantMap.get(`${w},${d}`);
    if (!variant) continue;
    for (let stepZ = 0; stepZ < lattice.numStudsZ; stepZ++) {
      const z = (stepZ + startZOffset) % lattice.numStudsZ;
      if (z < b.minZ || z > b.maxZ) continue;
      for (let stepX = 0; stepX < lattice.numStudsX; stepX++) {
        const x = (stepX + startXOffset) % lattice.numStudsX;
        if (x < b.minX || x > b.maxX) continue;
        if (canFitPlate(x, z, w, d)) {
          commitCandidate(x, z, layerY, variant, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  for (const [w, d] of shapes1x) {
    const variant = variantMap.get(`${w},${d}`);
    if (!variant) continue;
    for (let stepZ = 0; stepZ < lattice.numStudsZ; stepZ++) {
      const z = (stepZ + startZOffset) % lattice.numStudsZ;
      if (z < b.minZ || z > b.maxZ) continue;
      for (let stepX = 0; stepX < lattice.numStudsX; stepX++) {
        const x = (stepX + startXOffset) % lattice.numStudsX;
        if (x < b.minX || x > b.maxX) continue;
        if (canFitPlate(x, z, w, d)) {
          commitCandidate(x, z, layerY, variant, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  const v1x1 = variantMap.get('1,1');
  if (v1x1) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!bitset.isAvailable(x, z, layerY)) continue;
        if (!lattice.isOccupied(x, z, layerY)) continue;
        if (options.enableCanisters && isVerticalPoleShaft(x, z, layerY, lattice, bitset)) {
          continue; // Reserved for vertical pole canister pass
        }
        if (canFitPlate(x, z, 1, 1)) {
          commitCandidate(x, z, layerY, v1x1, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  return placedCount;
}

/**
 * Fills the deep interior volume (core voxels, depth >= 2) with large structural bricks.
 * Strictly avoids placing thin plates or cosmetic slopes inside the structural core.
 */
export function packCoreBricks(
  brickVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): number {
  const b = lattice.bounds;
  const isBrickMode = lattice.verticalUnit === 'brick';
  const brickHeight = isBrickMode ? 1 : 3;
  let placedCount = 0;

  const validBricks = brickVariants.filter(v => v.category === 'BRICK_STANDARD' && v.size[2] === brickHeight);
  const variantMap = new Map<string, RotatedKernelVariant>();
  for (const v of validBricks) {
    const key = `${v.size[0]},${v.size[1]}`;
    if (!variantMap.has(key)) variantMap.set(key, v);
  }

  // Large structural core shapes in priority order: 2x8, 2x6, 2x4, 1x8, 1x6, 2x3, 2x2, 1x4, 1x3, 1x2
  const baseShapes = [
    [8, 2], [2, 8],
    [6, 2], [2, 6],
    [4, 2], [2, 4],
    [8, 1], [1, 8],
    [6, 1], [1, 6],
    [3, 2], [2, 3],
    [2, 2],
    [4, 1], [1, 4],
    [3, 1], [1, 3],
    [2, 1], [1, 2]
  ];

  for (let y = b.minY; y <= b.maxY - brickHeight + 1; y += brickHeight) {
    const layerIdx = Math.floor(y / brickHeight);
    const isXMajor = layerIdx % 2 === 0;
    const shapes = isXMajor
      ? baseShapes
      : baseShapes.map(([w, d]): [number, number] => [d, w]);

    for (const [w, d] of shapes) {
      const variant = variantMap.get(`${w},${d}`);
      if (!variant) continue;

      for (let z = b.minZ; z <= b.maxZ - d + 1; z++) {
        for (let x = b.minX; x <= b.maxX - w + 1; x++) {
          let hasCoreCell = false;
          let canFit = true;

          for (let dy = 0; dy < brickHeight; dy++) {
            for (let dz = 0; dz < d; dz++) {
              for (let dx = 0; dx < w; dx++) {
                const cx = x + dx;
                const cz = z + dz;
                const cy = y + dy;

                if (!lattice.isOccupied(cx, cz, cy) || bitset.isClaimed(cx, cz, cy)) {
                  canFit = false;
                  break;
                }
                if (lattice.getDepth(cx, cz, cy) >= 2) {
                  hasCoreCell = true;
                }
              }
              if (!canFit) break;
            }
            if (!canFit) break;
          }

          if (!canFit || !hasCoreCell) continue;

          // Grounding check
          if (y > b.minY) {
            let hasSupport = false;
            for (let dz = 0; dz < d; dz++) {
              for (let dx = 0; dx < w; dx++) {
                if (bitset.isClaimed(x + dx, z + dz, y - 1)) {
                  const ownerId = bitset.getCellOwner(x + dx, z + dz, y - 1);
                  if (ownerId && assemblyGraph.isGrounded(ownerId)) {
                    hasSupport = true;
                    break;
                  }
                }
              }
              if (hasSupport) break;
            }
            if (!hasSupport) continue;
          }

          commitCandidate(x, z, y, variant, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
          placedCount++;
        }
      }
    }
  }

  return placedCount;
}

/**
 * Scans for narrow vertical column features (masts, antennas, propeller blades, landing gear)
 * and fills them with full-height bricks (height 3 plates or 15-plate tall brick 2453b).
 * Prevents vertical structures from decomposing into dozens of flimsy 1-plate slices.
 */
export function packVerticalColumns(
  brickVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): number {
  if (lattice.verticalUnit === 'brick') return 0;
  const b = lattice.bounds;
  let placedCount = 0;

  const v2453b = brickVariants.find(v => v.partId === '2453b');
  const v1x1x3 = brickVariants.find(v => v.partId === '3005' && v.size[0] === 1 && v.size[1] === 1 && v.size[2] === 3);
  const vCanister = options.enableCanisters
    ? brickVariants.find(v => v.category === 'ROUND_CANISTER' && v.size[0] === 1 && v.size[1] === 1 && v.size[2] === 3)
    : null;

  for (let z = b.minZ; z <= b.maxZ; z++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      let y = b.minY;
      while (y <= b.maxY) {
        if (!lattice.isOccupied(x, z, y) || bitset.isClaimed(x, z, y)) {
          y++;
          continue;
        }

        // Measure continuous vertical span
        let spanEnd = y;
        while (spanEnd + 1 <= b.maxY && lattice.isOccupied(x, z, spanEnd + 1) && !bitset.isClaimed(x, z, spanEnd + 1)) {
          spanEnd++;
        }

        const spanHeight = spanEnd - y + 1;

        if (spanHeight >= 3) {
          let currentY = y;
          let remaining = spanHeight;

          // Place 1x1x5 tall brick (15 plates) when remaining >= 15
          while (remaining >= 15 && v2453b) {
            commitCandidate(x, z, currentY, v2453b, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
            placedCount++;
            currentY += 15;
            remaining -= 15;
          }

          // Place 1x1x3 full-height bricks when remaining >= 3
          while (remaining >= 3) {
            const brickToUse = (vCanister && isVerticalPoleShaft(x, z, currentY, lattice, bitset)) ? vCanister : v1x1x3;
            if (brickToUse) {
              commitCandidate(x, z, currentY, brickToUse, lattice, bitset, integral, assemblyGraph, options.enableVoxelRecompute);
              placedCount++;
              currentY += 3;
              remaining -= 3;
            } else {
              break;
            }
          }

          y = spanEnd + 1;
        } else {
          y++;
        }
      }
    }
  }

  return placedCount;
}

/**
 * Strategy 1: Tiered Multi-Pass Outward-In Pipeline with 2D Maximal Rectangle Packing and Running Bond.
 */
export async function dispatchTieredPipeline(
  variants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): Promise<void> {
  const { onProgress } = options;
  const b = lattice.bounds;
  const isBrickMode = lattice.verticalUnit === 'brick';

  const wallBricks = variants.filter(v => v.category === 'BRICK_STANDARD');
  const plateVariants = variants.filter(v => v.category === 'PLATE_STANDARD');
  const slopeVariants = variants.filter(
    v =>
      v.category === 'SLOPE_45' ||
      v.category === 'CHEESE_SLOPE' ||
      v.category === 'SLOPE_CURVED' ||
      v.category === 'SLOPE_INVERTED'
  );
  const wedgeVariants = variants.filter(v => v.category === 'WEDGE_PLATE');
  const specialVariants = variants.filter(
    v =>
      v.category === 'BIONICLE_CREATURE' ||
      v.category === 'MACARONI_WEDGE' ||
      v.category === 'ROUND_CANISTER' ||
      v.category === 'ORGANIC_DOME'
  );
  const tileVariants = variants.filter(v => v.category === 'TILE_FLAT');

  // Phase 1: Dedicated Vertical Structural Columns (e.g. propellers, masts, struts)
  if (!isBrickMode) {
    if (onProgress) onProgress('Discretizing Vertical Structural Columns...', 15);
    packVerticalColumns(wallBricks, lattice, bitset, integral, assemblyGraph, options);
  }

  // Phase 2: Core Discretization (Interior voxels depth >= 2 with large structural bricks only)
  if (onProgress) onProgress('Filling Interior Core with Structural Bricks...', 25);
  packCoreBricks(wallBricks, lattice, bitset, integral, assemblyGraph, options);

  // Phase 3: Cosmetic Surface Crust (Slopes, Wedges, Curves on depth 0-1)
  if (options.enableSlopes !== false && slopeVariants.length > 0) {
    if (onProgress) onProgress('Fitting Cosmetic Surface Slopes & Wedges...', 40);
    for (let y = b.minY; y <= b.maxY; y++) {
      await placeBoundarySlopesAndWedges(
        slopeVariants,
        wedgeVariants,
        lattice,
        bitset,
        integral,
        assemblyGraph,
        options,
        y
      );
    }
  }

  // Phase 4: Remaining Crust Discretization (Standard Bricks & Plates)
  if (isBrickMode) {
    for (let y = b.minY; y <= b.maxY; y++) {
      packLayerBricks(y, 1, wallBricks, lattice, bitset, integral, assemblyGraph, options);
      if (y % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  } else {
    for (let y = b.minY; y <= b.maxY; y += 3) {
      packLayerBricks(y, 3, wallBricks, lattice, bitset, integral, assemblyGraph, options);
    }
    for (let y = b.minY; y <= b.maxY; y++) {
      packLayerPlates(y, plateVariants, lattice, bitset, integral, assemblyGraph, options);
      if (y % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // Phase 5: Special Finish Elements (isolated vertical poles, macaroni, apex dishes)
  if (onProgress) onProgress('Placing Special Finish Elements...', 75);
  await applySpecialFinishElements(specialVariants, lattice, bitset, integral, assemblyGraph, options);

  // Phase 6: Studless Top Tiles (covers 100% of exposed upward studs with smooth flat tiles)
  if (options.enableStudlessTiles !== false) {
    if (onProgress) onProgress('Applying Studless Top Tiles...', 82);
    await applyStudlessTopTiles(tileVariants, lattice, bitset, integral, assemblyGraph, options);
  }

  // Phase 7: Smart Brick & Plate Merger (Vertical Stack Coalescing + Horizontal Consolidation)
  if (onProgress) onProgress('Consolidating Smart Interlocking Bricks...', 92);
  const mergeRes1 = runSmartBrickMergePass(lattice, bitset, assemblyGraph, options.evaluationSteps?.length ?? 0);
  if (mergeRes1.mergedCount > 0 && options.evaluationSteps && options.evaluationSteps.length < 250) {
    options.evaluationSteps.push(...mergeRes1.steps);
  }
}

/**
 * Strategy 2: Size-Descent Outward-In Pipeline with 2D Maximal Rectangle Packing and Running Bond.
 */
export async function dispatchSizeDescentPipeline(
  variants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: DispatcherOptions
): Promise<void> {
  const { onProgress } = options;
  const b = lattice.bounds;
  const isBrickMode = lattice.verticalUnit === 'brick';

  const wallBricks = variants.filter(v => v.category === 'BRICK_STANDARD');
  const plateVariants = variants.filter(v => v.category === 'PLATE_STANDARD');
  const slopeVariants = variants.filter(
    v =>
      v.category === 'SLOPE_45' ||
      v.category === 'CHEESE_SLOPE' ||
      v.category === 'SLOPE_CURVED' ||
      v.category === 'SLOPE_INVERTED'
  );
  const wedgeVariants = variants.filter(v => v.category === 'WEDGE_PLATE');
  const specialVariants = variants.filter(
    v =>
      v.category === 'BIONICLE_CREATURE' ||
      v.category === 'MACARONI_WEDGE' ||
      v.category === 'ROUND_CANISTER' ||
      v.category === 'ORGANIC_DOME'
  );
  const tileVariants = variants.filter(v => v.category === 'TILE_FLAT');

  // Phase 1: Dedicated Vertical Structural Columns (e.g. propellers, masts, struts)
  if (!isBrickMode) {
    if (onProgress) onProgress('Discretizing Vertical Structural Columns...', 15);
    packVerticalColumns(wallBricks, lattice, bitset, integral, assemblyGraph, options);
  }

  // Phase 2: Core Discretization (Interior voxels depth >= 2 with large structural bricks only)
  if (onProgress) onProgress('Filling Interior Core with Structural Bricks...', 25);
  packCoreBricks(wallBricks, lattice, bitset, integral, assemblyGraph, options);

  // Phase 3: Cosmetic Surface Crust (Slopes, Wedges, Curves on depth 0-1)
  if (options.enableSlopes !== false && slopeVariants.length > 0) {
    if (onProgress) onProgress('Fitting Cosmetic Surface Slopes & Wedges...', 40);
    for (let y = b.minY; y <= b.maxY; y++) {
      await placeBoundarySlopesAndWedges(
        slopeVariants,
        wedgeVariants,
        lattice,
        bitset,
        integral,
        assemblyGraph,
        options,
        y
      );
    }
  }

  // Phase 4: Remaining Crust Discretization (Standard Bricks & Plates)
  if (isBrickMode) {
    for (let y = b.minY; y <= b.maxY; y++) {
      packLayerBricks(y, 1, wallBricks, lattice, bitset, integral, assemblyGraph, options);
      if (y % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  } else {
    for (let y = b.minY; y <= b.maxY; y += 3) {
      packLayerBricks(y, 3, wallBricks, lattice, bitset, integral, assemblyGraph, options);
    }
    for (let y = b.minY; y <= b.maxY; y++) {
      packLayerPlates(y, plateVariants, lattice, bitset, integral, assemblyGraph, options);
      if (y % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // Phase 5: Special Finish Elements (isolated vertical poles, macaroni, apex dishes)
  if (onProgress) onProgress('Placing Special Finish Elements...', 75);
  await applySpecialFinishElements(specialVariants, lattice, bitset, integral, assemblyGraph, options);

  // Phase 6: Studless Top Tiles (covers 100% of exposed upward studs with smooth flat tiles)
  if (options.enableStudlessTiles !== false) {
    if (onProgress) onProgress('Applying Studless Top Tiles...', 82);
    await applyStudlessTopTiles(tileVariants, lattice, bitset, integral, assemblyGraph, options);
  }

  // Phase 7: Smart Brick Consolidation Pass (Vertical Stack Coalescing + Horizontal Consolidation)
  if (onProgress) onProgress('Consolidating Smart Interlocking Bricks...', 92);
  const mergeRes2 = runSmartBrickMergePass(lattice, bitset, assemblyGraph, options.evaluationSteps?.length ?? 0);
  if (mergeRes2.mergedCount > 0 && options.evaluationSteps && options.evaluationSteps.length < 250) {
    options.evaluationSteps.push(...mergeRes2.steps);
  }
}

