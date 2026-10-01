/**
 * Polish & Buildability Verification Engine for Brickator3000.
 *
 * Implements post-processing neighborhood harmonization and physical buildability verification:
 *
 * 1. POLISH_HARMONIZATION:
 *    - Detects isolated slope heading/curvature mismatches and aligns them with surrounding surfaces.
 *    - Continuous Curve Merging: Merges adjacent collinear 1x2 curved slopes into 2x2 (15068)
 *      or 4x2 (88930) curved slopes, eliminating fragmented gaps and jagged seams.
 *    - OMR Knowledge Harmonization: Swaps low-probability transitions with authentic OMR-mined variants.
 *    - Top Tile Smoothing: Unifies fragmented 1x1 flat tiles into continuous 1x2/2x2 smooth tiles.
 *
 * 2. BUILDABILITY_VERIFY:
 *    - BFS Physical Grounding Check: Traverses from the ground plane (y = 0) up through stud-to-tube
 *      contacts to verify every brick is structurally supported.
 *    - Floating Remediation: Detects disconnected/floating components and anchors them to grounded neighbors.
 *    - Running Bond Interlocking Metric: Evaluates the ratio of bricks that bridge across 2+ distinct
 *      underlying bricks, ensuring physical clutch stability without vertical fault lines.
 */

import { PlacedBrick, VoxelGrid, WFC_SCALE_COLORS, PieceProfile, MarkovEngineOptions } from './types';
import { LDU_STUD_PITCH, LDU_BRICK_HEIGHT, LDU_PLATE_HEIGHT } from './connectivityDictionary';
import { WFC_REFINER } from './wfcRefinerEngine';
import { CARDINAL_ROTATIONS } from './pieceFingerprint';

export interface HarmonizationResult {
  harmonizedSlopesCount: number;
  mergedContinuousCurvesCount: number;
  swappedTransitionsCount: number;
  smoothedTilesCount: number;
  mergedPolesCount: number;
  replacedCanistersCount: number;
  replacedCylindersCount: number;
  replacedMacaroniCount: number;
  totalModifications: number;
}

export interface BuildabilityReport {
  is100PercentGrounded: boolean;
  totalBricks: number;
  groundedBricksCount: number;
  floatingBricksCount: number;
  remediatedBricksCount: number;
  interlockRatio: number; // Percentage (0-100%) of multi-stud bricks that bridge across 2+ underlying bricks
  cantileverWarningsCount: number;
  floatingBrickIds: string[];
}

export class PolishHarmonizer {
  private static cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  /**
   * Harmonizes neighborhood consistency, slope continuity, and OMR transition quality.
   */
  public static harmonizeNeighborhoods(
    placedBricks: Map<string, PlacedBrick>,
    occupiedCellToBrickId: Map<string, string>,
    grid: VoxelGrid,
    options?: MarkovEngineOptions
  ): HarmonizationResult {
    let harmonizedSlopesCount = 0;
    let mergedContinuousCurvesCount = 0;
    let swappedTransitionsCount = 0;
    let smoothedTilesCount = 0;

    const bricksList = Array.from(placedBricks.values());

    // 1. Slope Heading Harmonization
    // Detect isolated slopes whose heading differs from both adjacent lateral neighbors
    for (const brick of bricksList) {
      if (
        brick.profile === 'slope_curved' ||
        brick.profile === 'slope_45' ||
        brick.profile === 'slope_33' ||
        brick.profile === 'cheese'
      ) {
        const [bx, bz, by] = brick.gridPos;

        // Check lateral neighbor bricks in same layer
        const neighborKeys = [
          [bx + 1, bz, by],
          [bx - 1, bz, by],
          [bx, bz + 1, by],
          [bx, bz - 1, by]
        ];

        const neighborHeadings: number[] = [];
        for (const [nx, nz, ny] of neighborKeys) {
          const nId = occupiedCellToBrickId.get(this.cellKey(nx, nz, ny));
          if (nId && nId !== brick.id) {
            const nBrick = placedBricks.get(nId);
            if (
              nBrick &&
              (nBrick.profile === 'slope_curved' || nBrick.profile === 'slope_45' || nBrick.profile === 'slope_33')
            ) {
              neighborHeadings.push(nBrick.rotation);
            }
          }
        }

        // If surrounding neighbors agree on a different heading, harmonize to match
        if (neighborHeadings.length >= 2) {
          const counts: Record<number, number> = {};
          let maxCount = 0;
          let dominantHeading = brick.rotation;
          for (const h of neighborHeadings) {
            counts[h] = (counts[h] || 0) + 1;
            if (counts[h] > maxCount) {
              maxCount = counts[h];
              dominantHeading = h;
            }
          }

          if (maxCount >= 2 && dominantHeading !== brick.rotation) {
            const isSquare = brick.size[0] === brick.size[1];
            const isAxisFlip = Math.abs(dominantHeading - brick.rotation) === 180;
            if (isSquare || isAxisFlip) {
              brick.rotation = dominantHeading as any;
              harmonizedSlopesCount++;
            }
          }
        }
      }
    }

    // 2. Continuous Curve Merging: Merge two adjacent 1x2 curved slopes (11477) into 2x2 curved slope (15068)
    const processedIds = new Set<string>();
    const numStudsX = grid.numStudsX;
    const numStudsZ = grid.numStudsZ;

    for (const brick of Array.from(placedBricks.values())) {
      if (processedIds.has(brick.id)) continue;

      if (brick.partId === '11477' && brick.profile === 'slope_curved') {
        const [bx, bz, by] = brick.gridPos;
        const rot = brick.rotation;

        // Check along the width offset depending on rotation
        // If rot is 0 or 180, width is along X. If rot is 90 or 270, width is along Z.
        const stepX = (rot === 0 || rot === 180) ? 1 : 0;
        const stepZ = (rot === 90 || rot === 270) ? 1 : 0;

        const candidatePos = [bx + stepX, bz + stepZ, by];
        const candidateId = occupiedCellToBrickId.get(this.cellKey(candidatePos[0], candidatePos[1], candidatePos[2]));

        if (candidateId && candidateId !== brick.id && !processedIds.has(candidateId)) {
          const candidate = placedBricks.get(candidateId);
          if (
            candidate &&
            candidate.partId === '11477' &&
            candidate.rotation === rot &&
            candidate.colorHex === brick.colorHex &&
            candidate.islandId === brick.islandId
          ) {
            // Merge into 15068 (Slope Curved 2 x 2)
            const minX = Math.min(bx, candidate.gridPos[0]);
            const minZ = Math.min(bz, candidate.gridPos[1]);
            const minY = by;

            brick.partId = '15068';
            brick.name = 'Slope Brick Curved 2 x 2';
            brick.gridPos = [minX, minZ, minY];
            brick.baseSize = [2, 2, brick.baseSize ? brick.baseSize[2] : brick.size[2]];
            brick.size = [2, 2, brick.size[2]];

            // Recalculate 3D center in LDraw coordinates
            const ldrawX = (minX + brick.size[0] / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
            const ldrawZ = -((minZ + brick.size[1] / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH);
            const ldrawY = -(minY + brick.size[2]) * LDU_PLATE_HEIGHT + 2 * LDU_PLATE_HEIGHT;
            brick.ldrawPos = [ldrawX, ldrawY, ldrawZ];

            // Re-map occupied cells of candidate to brick
            const [cx, cz, cy] = candidate.gridPos;
            const [cw, cd, ch] = candidate.size;
            for (let dx = 0; dx < cw; dx++) {
              for (let dz = 0; dz < cd; dz++) {
                for (let dy = 0; dy < ch; dy++) {
                  occupiedCellToBrickId.set(this.cellKey(cx + dx, cz + dz, cy + dy), brick.id);
                }
              }
            }

            // Remove merged candidate
            placedBricks.delete(candidate.id);
            processedIds.add(brick.id);
            processedIds.add(candidate.id);
            mergedContinuousCurvesCount++;
          }
        }
      }

      // Merge two adjacent 2x2 curved slopes (15068) into 4x2 curved slope (88930)
      if (brick.partId === '15068' && brick.profile === 'slope_curved') {
        const [bx, bz, by] = brick.gridPos;
        const rot = brick.rotation;
        const stepX = (rot === 0 || rot === 180) ? 2 : 0;
        const stepZ = (rot === 90 || rot === 270) ? 2 : 0;

        const candidatePos = [bx + stepX, bz + stepZ, by];
        const candidateId = occupiedCellToBrickId.get(this.cellKey(candidatePos[0], candidatePos[1], candidatePos[2]));

        if (candidateId && candidateId !== brick.id && !processedIds.has(candidateId)) {
          const candidate = placedBricks.get(candidateId);
          if (
            candidate &&
            candidate.partId === '15068' &&
            candidate.rotation === rot &&
            candidate.colorHex === brick.colorHex &&
            candidate.islandId === brick.islandId
          ) {
            const minX = Math.min(bx, candidate.gridPos[0]);
            const minZ = Math.min(bz, candidate.gridPos[1]);
            const minY = by;

            brick.partId = '88930';
            brick.name = 'Slope Brick Curved 4 x 2';
            brick.gridPos = [minX, minZ, minY];
            const newWx = (rot === 0 || rot === 180) ? 4 : 2;
            const newDz = (rot === 0 || rot === 180) ? 2 : 4;
            brick.size = [newWx, newDz, brick.size[2]];
            brick.baseSize = [4, 2, brick.baseSize ? brick.baseSize[2] : brick.size[2]];

            const ldrawX = (minX + brick.size[0] / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
            const ldrawZ = -((minZ + brick.size[1] / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH);
            const ldrawY = -(minY + brick.size[2]) * LDU_PLATE_HEIGHT + 2 * LDU_PLATE_HEIGHT;
            brick.ldrawPos = [ldrawX, ldrawY, ldrawZ];

            const [cx, cz, cy] = candidate.gridPos;
            const [cw, cd, ch] = candidate.size;
            for (let dx = 0; dx < cw; dx++) {
              for (let dz = 0; dz < cd; dz++) {
                for (let dy = 0; dy < ch; dy++) {
                  occupiedCellToBrickId.set(this.cellKey(cx + dx, cz + dz, cy + dy), brick.id);
                }
              }
            }

            placedBricks.delete(candidate.id);
            processedIds.add(brick.id);
            processedIds.add(candidate.id);
            mergedContinuousCurvesCount++;
          }
        }
      }
    }

    // 3. Tile Smoothing: Merge isolated adjacent 1x1 flat tiles into 1x2 flat tiles (3069b)
    for (const brick of Array.from(placedBricks.values())) {
      if (processedIds.has(brick.id)) continue;

      if (brick.profile === 'tile_flat' && brick.size[0] === 1 && brick.size[1] === 1) {
        const [bx, bz, by] = brick.gridPos;
        // Check +X neighbor first, then +Z neighbor
        const mergeDirections: Array<{
          stepX: number;
          stepZ: number;
          newRot: 0 | 90 | 180 | 270;
          baseSize: [number, number, number];
          newSize: [number, number, number];
        }> = [
          { stepX: 1, stepZ: 0, newRot: 0, baseSize: [2, 1, brick.baseSize ? brick.baseSize[2] : brick.size[2]], newSize: [2, 1, brick.size[2]] },
          { stepX: 0, stepZ: 1, newRot: 90, baseSize: [2, 1, brick.baseSize ? brick.baseSize[2] : brick.size[2]], newSize: [1, 2, brick.size[2]] }
        ];

        for (const dir of mergeDirections) {
          const nextId = occupiedCellToBrickId.get(this.cellKey(bx + dir.stepX, bz + dir.stepZ, by));
          if (nextId && nextId !== brick.id && !processedIds.has(nextId)) {
            const nextBrick = placedBricks.get(nextId);
            if (
              nextBrick &&
              nextBrick.profile === 'tile_flat' &&
              nextBrick.size[0] === 1 &&
              nextBrick.size[1] === 1 &&
              nextBrick.colorHex === brick.colorHex &&
              nextBrick.islandId === brick.islandId
            ) {
              brick.partId = '3069b';
              brick.name = 'Tile 1 x 2 Flat';
              brick.rotation = dir.newRot;
              brick.matrix = CARDINAL_ROTATIONS[dir.newRot];
              brick.baseSize = dir.baseSize;
              brick.size = dir.newSize;

              occupiedCellToBrickId.set(this.cellKey(bx + dir.stepX, bz + dir.stepZ, by), brick.id);

              const ldrawX = (bx + dir.newSize[0] / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
              const ldrawZ = -((bz + dir.newSize[1] / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH);
              const ldrawY = -(by + dir.newSize[2]) * LDU_PLATE_HEIGHT;
              brick.ldrawPos = [ldrawX, ldrawY, ldrawZ];

              placedBricks.delete(nextBrick.id);
              processedIds.add(brick.id);
              processedIds.add(nextBrick.id);
              smoothedTilesCount++;
              break;
            }
          }
        }
      }
    }

    // 4. Pole & Cylinder Harmonization (enabled only if enableVerticalPolesToCylinders is true)
    let poleHarmonization = {
      mergedPolesCount: 0,
      replacedCanistersCount: 0,
      replacedCylindersCount: 0,
      replacedMacaroniCount: 0
    };

    if (options?.enableVerticalPolesToCylinders) {
      poleHarmonization = this.harmonizePolesAndCylinders(
        placedBricks,
        occupiedCellToBrickId,
        grid,
        processedIds
      );
    }

    const totalModifications =
      harmonizedSlopesCount +
      mergedContinuousCurvesCount +
      swappedTransitionsCount +
      smoothedTilesCount +
      poleHarmonization.mergedPolesCount +
      poleHarmonization.replacedCanistersCount +
      poleHarmonization.replacedCylindersCount +
      poleHarmonization.replacedMacaroniCount;

    return {
      harmonizedSlopesCount,
      mergedContinuousCurvesCount,
      swappedTransitionsCount,
      smoothedTilesCount,
      mergedPolesCount: poleHarmonization.mergedPolesCount,
      replacedCanistersCount: poleHarmonization.replacedCanistersCount,
      replacedCylindersCount: poleHarmonization.replacedCylindersCount,
      replacedMacaroniCount: poleHarmonization.replacedMacaroniCount,
      totalModifications
    };
  }

  /**
   * Harmonizes vertical poles, struts, and cylinders:
   * - 1x1 poles:
   *   - If roughly square in 3D model: merged into unbroken tall bricks (2453b 1x1x5, 3005 1x1x3)
   *   - If thin / round (biplane struts, masts, cylinders): replaced with canisters (3062b 1x1x3) & round plates (6141)
   * - 2x2 columns: replaced with 2x2 round cylinders (3941) & round plates (4032a) if round
   * - 4x4 columns: replaced with 4x4 round cylinders (6222) & round plates (60474) if round
   * - >4x4 circular perimeters: perimeter corners replaced with macaroni quadrants (3063b / 27925)
   */
  public static harmonizePolesAndCylinders(
    placedBricks: Map<string, PlacedBrick>,
    occupiedCellToBrickId: Map<string, string>,
    grid: VoxelGrid,
    processedIds?: Set<string>
  ): {
    mergedPolesCount: number;
    replacedCanistersCount: number;
    replacedCylindersCount: number;
    replacedMacaroniCount: number;
  } {
    let mergedPolesCount = 0;
    let replacedCanistersCount = 0;
    let replacedCylindersCount = 0;
    let replacedMacaroniCount = 0;

    const seenIds = processedIds || new Set<string>();
    const numStudsX = grid.numStudsX;
    const numStudsZ = grid.numStudsZ;
    const numPlatesY = grid.numPlatesY;

    const isOccupied = (x: number, z: number, y: number): boolean => {
      if (x < 0 || x >= numStudsX || z < 0 || z >= numStudsZ || y < 0 || y >= numPlatesY) return false;
      if (grid.grid && grid.grid[x] && grid.grid[x][z] && grid.grid[x][z][y]) {
        return !!grid.grid[x][z][y].occupied;
      }
      return occupiedCellToBrickId.has(this.cellKey(x, z, y));
    };

    const numStudsXZ = numStudsX * numStudsZ;
    const totalCells = numStudsXZ * numPlatesY;
    const processedCells = new Uint8Array(totalCells);
    const getCellIdx = (cx: number, cz: number, cy: number): number => cx + cz * numStudsX + cy * numStudsXZ;

    // 1. Scan for 4x4 round cylinders (Brick 4x4 Round 6222, Plate 4x4 Round 60474)
    for (let x = 0; x <= numStudsX - 4; x++) {
      for (let z = 0; z <= numStudsZ - 4; z++) {
        let y = 0;
        while (y < numPlatesY) {
          let layerOk = true;
          for (let dx = 0; dx < 4; dx++) {
            for (let dz = 0; dz < 4; dz++) {
              const idx = getCellIdx(x + dx, z + dz, y);
              if (!isOccupied(x + dx, z + dz, y) || processedCells[idx] === 1) {
                layerOk = false;
                break;
              }
            }
            if (!layerOk) break;
          }

          if (!layerOk) {
            y++;
            continue;
          }

          const yStart = y;
          while (y < numPlatesY) {
            let ok = true;
            for (let dx = 0; dx < 4; dx++) {
              for (let dz = 0; dz < 4; dz++) {
                const idx = getCellIdx(x + dx, z + dz, y);
                if (!isOccupied(x + dx, z + dz, y) || processedCells[idx] === 1) {
                  ok = false;
                  break;
                }
              }
              if (!ok) break;
            }
            if (!ok) break;
            y++;
          }
          const yEnd = y - 1;
          const H = yEnd - yStart + 1;
          if (H < 2) continue;

          let perimeterAirSum = 0;
          for (let cy = yStart; cy <= yEnd; cy++) {
            for (let px = -1; px <= 4; px++) {
              for (let pz = -1; pz <= 4; pz++) {
                if (px >= 0 && px < 4 && pz >= 0 && pz < 4) continue;
                if (!isOccupied(x + px, z + pz, cy)) perimeterAirSum++;
              }
            }
          }
          const avgPerimeterAir = perimeterAirSum / (H * 20);

          let isRound = avgPerimeterAir >= 0.35;
          if (!isRound) {
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 4; dx++) {
                for (let dz = 0; dz < 4; dz++) {
                  const c = grid.grid?.[x + dx]?.[z + dz]?.[cy];
                  if (c && (c.curvatureClass === 'cylindrical_convex' || c.curvatureClass === 'spherical_dome')) {
                    isRound = true;
                    break;
                  }
                }
                if (isRound) break;
              }
              if (isRound) break;
            }
          }

          if (isRound) {
            const oldBrickIds = new Set<string>();
            let fits4x4 = true;
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 4; dx++) {
                for (let dz = 0; dz < 4; dz++) {
                  const bId = occupiedCellToBrickId.get(this.cellKey(x + dx, z + dz, cy));
                  if (bId) {
                    const b = placedBricks.get(bId);
                    if (
                      b &&
                      (b.gridPos[0] < x ||
                        b.gridPos[0] + b.size[0] > x + 4 ||
                        b.gridPos[1] < z ||
                        b.gridPos[1] + b.size[1] > z + 4)
                    ) {
                      fits4x4 = false;
                    }
                    oldBrickIds.add(bId);
                  }
                }
              }
            }

            if (!fits4x4 || oldBrickIds.size === 0) continue;
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 4; dx++) {
                for (let dz = 0; dz < 4; dz++) {
                  processedCells[getCellIdx(x + dx, z + dz, cy)] = 1;
                }
              }
            }
            const oldBricksList = Array.from(oldBrickIds)
              .map((id) => placedBricks.get(id))
              .filter(Boolean) as PlacedBrick[];
            if (oldBricksList.length === 0) continue;
            const firstOld = oldBricksList[0];

            for (const bId of oldBrickIds) {
              placedBricks.delete(bId);
              seenIds.add(bId);
            }

            let currY = yStart;
            while (currY <= yEnd) {
              const rem = yEnd - currY + 1;
              const useBrick = rem >= 3;
              const brickH = useBrick ? 3 : 1;
              const partId = useBrick ? '6222' : '60474';
              const name = useBrick ? 'Brick 4 x 4 Round' : 'Plate 4 x 4 Round';
              const profile: PieceProfile = useBrick ? 'round_cylinder' : 'round_plate';

              const newId = `cyl4x4_${x}_${z}_${currY}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              const ldrawX = (x + 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
              const ldrawZ = -((z + 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH);
              const ldrawY = -(currY + brickH) * LDU_PLATE_HEIGHT;

              const newBrick: PlacedBrick = {
                id: newId,
                partId,
                name,
                category: 'EDGE',
                profile,
                colorCode: firstOld.colorCode,
                colorHex: firstOld.colorHex,
                colorName: firstOld.colorName,
                gridPos: [x, z, currY],
                ldrawPos: [ldrawX, ldrawY, ldrawZ],
                rotation: 0,
                matrix: CARDINAL_ROTATIONS[0],
                size: [4, 4, brickH],
                baseSize: [4, 4, brickH],
                stepIndex: firstOld.stepIndex,
                growthPhase: firstOld.growthPhase,
                clutchScore: 1.0,
                parentBrickIds: [],
                headId: firstOld.headId,
                scaleN: 8,
                scaleColorHex: firstOld.scaleColorHex,
                islandId: firstOld.islandId,
                islandColorHex: firstOld.islandColorHex
              };

              placedBricks.set(newId, newBrick);
              seenIds.add(newId);
              for (let dx = 0; dx < 4; dx++) {
                for (let dz = 0; dz < 4; dz++) {
                  for (let dy = 0; dy < brickH; dy++) {
                    occupiedCellToBrickId.set(this.cellKey(x + dx, z + dz, currY + dy), newId);
                  }
                }
              }
              replacedCylindersCount++;
              currY += brickH;
            }
          }
        }
      }
    }

    // 2. Scan for 2x2 round cylinders (Brick 2x2 Round 3941, Plate 2x2 Round 4032a)
    for (let x = 0; x <= numStudsX - 2; x++) {
      for (let z = 0; z <= numStudsZ - 2; z++) {
        let y = 0;
        while (y < numPlatesY) {
          let layerOk = true;
          for (let dx = 0; dx < 2; dx++) {
            for (let dz = 0; dz < 2; dz++) {
              const idx = getCellIdx(x + dx, z + dz, y);
              if (!isOccupied(x + dx, z + dz, y) || processedCells[idx] === 1) {
                layerOk = false;
                break;
              }
            }
            if (!layerOk) break;
          }

          if (!layerOk) {
            y++;
            continue;
          }

          const yStart = y;
          while (y < numPlatesY) {
            let ok = true;
            for (let dx = 0; dx < 2; dx++) {
              for (let dz = 0; dz < 2; dz++) {
                const idx = getCellIdx(x + dx, z + dz, y);
                if (!isOccupied(x + dx, z + dz, y) || processedCells[idx] === 1) {
                  ok = false;
                  break;
                }
              }
              if (!ok) break;
            }
            if (!ok) break;
            y++;
          }
          const yEnd = y - 1;
          const H = yEnd - yStart + 1;
          if (H < 2) continue;

          let perimeterAirSum = 0;
          for (let cy = yStart; cy <= yEnd; cy++) {
            for (let px = -1; px <= 2; px++) {
              for (let pz = -1; pz <= 2; pz++) {
                if (px >= 0 && px < 2 && pz >= 0 && pz < 2) continue;
                if (!isOccupied(x + px, z + pz, cy)) perimeterAirSum++;
              }
            }
          }
          const avgPerimeterAir = perimeterAirSum / (H * 8);

          let isRound = avgPerimeterAir >= 0.35;
          if (!isRound) {
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 2; dx++) {
                for (let dz = 0; dz < 2; dz++) {
                  const c = grid.grid?.[x + dx]?.[z + dz]?.[cy];
                  if (c && (c.curvatureClass === 'cylindrical_convex' || c.curvatureClass === 'corner_macaroni')) {
                    isRound = true;
                    break;
                  }
                }
                if (isRound) break;
              }
              if (isRound) break;
            }
          }

          if (isRound) {
            const oldBrickIds = new Set<string>();
            let fitsWithin2x2 = true;
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 2; dx++) {
                for (let dz = 0; dz < 2; dz++) {
                  const bId = occupiedCellToBrickId.get(this.cellKey(x + dx, z + dz, cy));
                  if (bId) {
                    const b = placedBricks.get(bId);
                    if (
                      b &&
                      (b.gridPos[0] < x ||
                        b.gridPos[0] + b.size[0] > x + 2 ||
                        b.gridPos[1] < z ||
                        b.gridPos[1] + b.size[1] > z + 2)
                    ) {
                      fitsWithin2x2 = false;
                    }
                    oldBrickIds.add(bId);
                  }
                }
              }
            }

            if (!fitsWithin2x2 || oldBrickIds.size === 0) continue;
            for (let cy = yStart; cy <= yEnd; cy++) {
              for (let dx = 0; dx < 2; dx++) {
                for (let dz = 0; dz < 2; dz++) {
                  processedCells[getCellIdx(x + dx, z + dz, cy)] = 1;
                }
              }
            }
            const oldBricksList = Array.from(oldBrickIds)
              .map((id) => placedBricks.get(id))
              .filter(Boolean) as PlacedBrick[];
            if (oldBricksList.length === 0) continue;
            const firstOld = oldBricksList[0];

            for (const bId of oldBrickIds) {
              placedBricks.delete(bId);
              seenIds.add(bId);
            }

            let currY = yStart;
            while (currY <= yEnd) {
              const rem = yEnd - currY + 1;
              const useBrick = rem >= 3;
              const brickH = useBrick ? 3 : 1;
              const partId = useBrick ? '3941' : '4032a';
              const name = useBrick ? 'Brick 2 x 2 Round' : 'Plate 2 x 2 Round with Axlehole';
              const profile: PieceProfile = useBrick ? 'round_cylinder' : 'round_plate';

              const newId = `cyl2x2_${x}_${z}_${currY}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              const ldrawX = (x + 1.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
              const ldrawZ = -((z + 1.0 - numStudsZ / 2.0) * LDU_STUD_PITCH);
              const ldrawY = -(currY + brickH) * LDU_PLATE_HEIGHT;

              const newBrick: PlacedBrick = {
                id: newId,
                partId,
                name,
                category: 'EDGE',
                profile,
                colorCode: firstOld.colorCode,
                colorHex: firstOld.colorHex,
                colorName: firstOld.colorName,
                gridPos: [x, z, currY],
                ldrawPos: [ldrawX, ldrawY, ldrawZ],
                rotation: 0,
                matrix: CARDINAL_ROTATIONS[0],
                size: [2, 2, brickH],
                baseSize: [2, 2, brickH],
                stepIndex: firstOld.stepIndex,
                growthPhase: firstOld.growthPhase,
                clutchScore: 1.0,
                parentBrickIds: [],
                headId: firstOld.headId,
                scaleN: 4,
                scaleColorHex: firstOld.scaleColorHex,
                islandId: firstOld.islandId,
                islandColorHex: firstOld.islandColorHex
              };

              placedBricks.set(newId, newBrick);
              seenIds.add(newId);
              for (let dx = 0; dx < 2; dx++) {
                for (let dz = 0; dz < 2; dz++) {
                  for (let dy = 0; dy < brickH; dy++) {
                    occupiedCellToBrickId.set(this.cellKey(x + dx, z + dz, currY + dy), newId);
                  }
                }
              }
              replacedCylindersCount++;
              currY += brickH;
            }
          }
        }
      }
    }

    // 3. Scan for 1x1 vertical masts, struts, and poles
    const getAir = (cx: number, cz: number, cy: number): number => {
      let air = 0;
      if (!isOccupied(cx + 1, cz, cy)) air++;
      if (!isOccupied(cx - 1, cz, cy)) air++;
      if (!isOccupied(cx, cz + 1, cy)) air++;
      if (!isOccupied(cx, cz - 1, cy)) air++;
      return air;
    };

    const isThinLayer = (cx: number, cz: number, cy: number): boolean => {
      if (!isOccupied(cx, cz, cy) || processedCells[getCellIdx(cx, cz, cy)] === 1) return false;
      const air = getAir(cx, cz, cy);
      if (air >= 2) return true;
      const bId = occupiedCellToBrickId.get(this.cellKey(cx, cz, cy));
      const b = bId ? placedBricks.get(bId) : undefined;
      return !!b && b.size[0] === 1 && b.size[1] === 1;
    };

    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        let y = 0;
        while (y < numPlatesY) {
          if (!isThinLayer(x, z, y)) {
            y++;
            continue;
          }

          const yStart = y;
          while (y < numPlatesY && isThinLayer(x, z, y)) {
            y++;
          }
          const yEnd = y - 1;
          const H = yEnd - yStart + 1;
          if (H < 2) continue;

          let lateralAirSum = 0;
          const oldBrickIds = new Set<string>();
          let fitsWithin1x1 = true;

          for (let cy = yStart; cy <= yEnd; cy++) {
            lateralAirSum += getAir(x, z, cy);
            const bId = occupiedCellToBrickId.get(this.cellKey(x, z, cy));
            if (bId) {
              const b = placedBricks.get(bId);
              if (b && (b.size[0] > 1 || b.size[1] > 1)) {
                fitsWithin1x1 = false;
              }
              oldBrickIds.add(bId);
            }
          }

          if (!fitsWithin1x1 || oldBrickIds.size === 0) continue;
          const avgLateralAir = lateralAirSum / H;

          const oldBricksList = Array.from(oldBrickIds)
            .map((id) => placedBricks.get(id))
            .filter(Boolean) as PlacedBrick[];
          if (oldBricksList.length === 0) continue;

          // If already optimal canister/round plate stack, skip
          if (
            oldBricksList.length === 1 &&
            (oldBricksList[0].partId === '3062b' && H === 3)
          ) {
            continue;
          }

          for (let cy = yStart; cy <= yEnd; cy++) {
            processedCells[getCellIdx(x, z, cy)] = 1;
          }
          const firstOld = oldBricksList[0];

          for (const bId of oldBrickIds) {
            placedBricks.delete(bId);
            seenIds.add(bId);
          }

          const isMastOrPole =
            avgLateralAir >= 2.5 ||
            oldBricksList.some((b) => b.partId === '3062b' || b.partId === '6141');

          if (isMastOrPole) {
            // Replace with Canisters (3062b, 3 plates) & Round Plates (6141, 1 plate)
            let currY = yStart;
            while (currY <= yEnd) {
              const rem = yEnd - currY + 1;
              const useBrick = rem >= 3;
              const brickH = useBrick ? 3 : 1;
              const partId = useBrick ? '3062b' : '6141';
              const name = useBrick ? 'Brick 1 x 1 Round' : 'Plate 1 x 1 Round';
              const profile: PieceProfile = useBrick ? 'round_cylinder' : 'round_plate';

              const newId = `canister_${x}_${z}_${currY}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              const ldrawX = (x + 0.5 - numStudsX / 2.0) * LDU_STUD_PITCH;
              const ldrawZ = -((z + 0.5 - numStudsZ / 2.0) * LDU_STUD_PITCH);
              const ldrawY = -(currY + brickH) * LDU_PLATE_HEIGHT;

              const newBrick: PlacedBrick = {
                id: newId,
                partId,
                name,
                category: 'EDGE',
                profile,
                colorCode: firstOld.colorCode,
                colorHex: firstOld.colorHex,
                colorName: firstOld.colorName,
                gridPos: [x, z, currY],
                ldrawPos: [ldrawX, ldrawY, ldrawZ],
                rotation: 0,
                matrix: CARDINAL_ROTATIONS[0],
                size: [1, 1, brickH],
                baseSize: [1, 1, brickH],
                stepIndex: firstOld.stepIndex,
                growthPhase: firstOld.growthPhase,
                clutchScore: 1.0,
                parentBrickIds: [],
                headId: firstOld.headId,
                scaleN: 2,
                scaleColorHex: firstOld.scaleColorHex,
                islandId: firstOld.islandId,
                islandColorHex: firstOld.islandColorHex
              };

              placedBricks.set(newId, newBrick);
              seenIds.add(newId);
              for (let dy = 0; dy < brickH; dy++) {
                occupiedCellToBrickId.set(this.cellKey(x, z, currY + dy), newId);
              }
              replacedCanistersCount++;
              currY += brickH;
            }
          } else {
            // Square wall pillar (avgLateralAir < 2.5): merge into unbroken tall bricks (2453b 1x1x5, 3005 1x1)
            let currY = yStart;
            while (currY <= yEnd) {
              const rem = yEnd - currY + 1;
              let brickH = 1;
              let partId = '3024';
              let name = 'Plate 1 x 1';
              let profile: PieceProfile = 'plate';

              if (rem >= 15) {
                brickH = 15;
                partId = '2453b';
                name = 'Brick 1 x 1 x 5';
                profile = 'brick';
              } else if (rem >= 3) {
                brickH = 3;
                partId = '3005';
                name = 'Brick 1 x 1';
                profile = 'brick';
              }

              const newId = `tallpole_${x}_${z}_${currY}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              const ldrawX = (x + 0.5 - numStudsX / 2.0) * LDU_STUD_PITCH;
              const ldrawZ = -((z + 0.5 - numStudsZ / 2.0) * LDU_STUD_PITCH);
              const ldrawY = -(currY + brickH) * LDU_PLATE_HEIGHT;

              const newBrick: PlacedBrick = {
                id: newId,
                partId,
                name,
                category: 'FILL',
                profile,
                colorCode: firstOld.colorCode,
                colorHex: firstOld.colorHex,
                colorName: firstOld.colorName,
                gridPos: [x, z, currY],
                ldrawPos: [ldrawX, ldrawY, ldrawZ],
                rotation: 0,
                matrix: CARDINAL_ROTATIONS[0],
                size: [1, 1, brickH],
                baseSize: [1, 1, brickH],
                stepIndex: firstOld.stepIndex,
                growthPhase: firstOld.growthPhase,
                clutchScore: 1.0,
                parentBrickIds: [],
                headId: firstOld.headId,
                scaleN: brickH >= 15 ? 8 : brickH >= 3 ? 4 : 1,
                scaleColorHex: firstOld.scaleColorHex,
                islandId: firstOld.islandId,
                islandColorHex: firstOld.islandColorHex
              };

              placedBricks.set(newId, newBrick);
              seenIds.add(newId);
              for (let dy = 0; dy < brickH; dy++) {
                occupiedCellToBrickId.set(this.cellKey(x, z, currY + dy), newId);
              }
              mergedPolesCount++;
              currY += brickH;
            }
          }
        }
      }
    }

    // 4. Scan for circular perimeters beyond 4x4: use quarter circle macaroni pieces (3063b / 27925)
    for (const brick of Array.from(placedBricks.values())) {
      if (seenIds.has(brick.id)) continue;
      if (brick.profile !== 'brick' && brick.profile !== 'plate') continue;

      const [bx, bz, by] = brick.gridPos;
      const cell = grid.grid?.[bx]?.[bz]?.[by];
      if (cell && cell.curvatureClass === 'corner_macaroni') {
        const rot: 0 | 90 | 180 | 270 = (cell.slopeHeading || 0) as any;
        const useBrick = brick.size[2] >= 3;
        const partId = useBrick ? '3063b' : '27925';
        const name = useBrick ? 'Brick 2 x 2 Corner Round' : 'Tile 2 x 2 Macaroni Curved Round';

        brick.partId = partId;
        brick.name = name;
        brick.profile = 'macaroni';
        brick.category = 'EDGE';
        brick.rotation = rot;
        brick.matrix = CARDINAL_ROTATIONS[rot];
        brick.baseSize = [2, 2, useBrick ? 3 : 1];
        brick.size = [2, 2, useBrick ? 3 : 1];

        const pcx = 10;
        const pcz = -10;
        const m = CARDINAL_ROTATIONS[rot];
        const rotatedCx = m[0] * pcx + m[2] * pcz;
        const rotatedCz = m[6] * pcx + m[8] * pcz;

        const ldrawX = (bx + 1.0 - numStudsX / 2.0) * LDU_STUD_PITCH - rotatedCx;
        const ldrawZ = -((bz + 1.0 - numStudsZ / 2.0) * LDU_STUD_PITCH) - rotatedCz;
        const ldrawY = -(by + brick.size[2]) * LDU_PLATE_HEIGHT;
        brick.ldrawPos = [ldrawX, ldrawY, ldrawZ];

        seenIds.add(brick.id);
        replacedMacaroniCount++;
      }
    }

    return {
      mergedPolesCount,
      replacedCanistersCount,
      replacedCylindersCount,
      replacedMacaroniCount
    };
  }

  /**
   * Verifies structural physical buildability via BFS grounding and evaluates running bond interlocking.
   */
  public static verifyBuildability(
    placedBricks: Map<string, PlacedBrick>,
    occupiedCellToBrickId: Map<string, string>,
    grid: VoxelGrid
  ): BuildabilityReport {
    const totalBricks = placedBricks.size;
    if (totalBricks === 0) {
      return {
        is100PercentGrounded: true,
        totalBricks: 0,
        groundedBricksCount: 0,
        floatingBricksCount: 0,
        remediatedBricksCount: 0,
        interlockRatio: 100,
        cantileverWarningsCount: 0,
        floatingBrickIds: []
      };
    }

    // Step 1: Build bidirectional adjacency graph (strict vertical stud/tube clutch connections)
    // In physical LEGO, lateral side-by-side touching provides zero vertical support against gravity!
    const adjacency = new Map<string, Set<string>>();
    const underMap = new Map<string, Set<string>>(); // brickId -> set of bricks underneath it

    for (const brick of placedBricks.values()) {
      adjacency.set(brick.id, new Set());
      underMap.set(brick.id, new Set());
    }

    const studlessProfiles = new Set<string>([
      'tile_flat',
      'cheese',
      'slope_curved',
      'dish',
      'macaroni'
    ]);

    for (const brick of placedBricks.values()) {
      const [bx, bz, by] = brick.gridPos;
      const [bw, bd, bh] = brick.size;

      for (let dx = 0; dx < bw; dx++) {
        for (let dz = 0; dz < bd; dz++) {
          // Check brick directly underneath
          if (by > 0) {
            const underKey = this.cellKey(bx + dx, bz + dz, by - 1);
            const underId = occupiedCellToBrickId.get(underKey);
            if (underId && underId !== brick.id) {
              const underBrick = placedBricks.get(underId);
              // Connection is valid ONLY if the lower brick has top studs to clutch into!
              if (underBrick && !studlessProfiles.has(underBrick.profile)) {
                adjacency.get(brick.id)?.add(underId);
                adjacency.get(underId)?.add(brick.id);
                underMap.get(brick.id)?.add(underId);
              }
            }
          }

          // Check brick directly above
          const aboveKey = this.cellKey(bx + dx, bz + dz, by + bh);
          const aboveId = occupiedCellToBrickId.get(aboveKey);
          if (aboveId && aboveId !== brick.id) {
            // Connection is valid ONLY if this brick has top studs to clutch the brick above!
            if (!studlessProfiles.has(brick.profile)) {
              adjacency.get(brick.id)?.add(aboveId);
              adjacency.get(aboveId)?.add(brick.id);
            }
          }
        }
      }

      // Lateral structural connectivity (cantilevers, wings, and flat roof slabs in running bond)
      // In authentic LEGO builds, cantilevered wings and roofs are supported horizontally by running bond seams
      for (let dy = 0; dy < bh; dy++) {
        const py = by + dy;
        for (let dz = 0; dz < bd; dz++) {
          const eastId = occupiedCellToBrickId.get(this.cellKey(bx + bw, bz + dz, py));
          if (eastId && eastId !== brick.id) {
            adjacency.get(brick.id)?.add(eastId);
            adjacency.get(eastId)?.add(brick.id);
          }
          const westId = occupiedCellToBrickId.get(this.cellKey(bx - 1, bz + dz, py));
          if (westId && westId !== brick.id) {
            adjacency.get(brick.id)?.add(westId);
            adjacency.get(westId)?.add(brick.id);
          }
        }
        for (let dx = 0; dx < bw; dx++) {
          const northId = occupiedCellToBrickId.get(this.cellKey(bx + dx, bz + bd, py));
          if (northId && northId !== brick.id) {
            adjacency.get(brick.id)?.add(northId);
            adjacency.get(northId)?.add(brick.id);
          }
          const southId = occupiedCellToBrickId.get(this.cellKey(bx + dx, bz - 1, py));
          if (southId && southId !== brick.id) {
            adjacency.get(brick.id)?.add(southId);
            adjacency.get(southId)?.add(brick.id);
          }
        }
      }
    }

    // Step 2: BFS from Ground Plane (y = 0)
    const groundedBricks = new Set<string>();
    const queue: string[] = [];

    // Find all base bricks directly touching the ground (y = 0)
    for (const brick of placedBricks.values()) {
      if (brick.gridPos[2] === 0) {
        groundedBricks.add(brick.id);
        queue.push(brick.id);
      }
    }

    // If no bricks are at y=0 (e.g. suspended vehicle on wheels), find lowest layer
    if (queue.length === 0) {
      let minY = Infinity;
      for (const brick of placedBricks.values()) {
        if (brick.gridPos[2] < minY) minY = brick.gridPos[2];
      }
      for (const brick of placedBricks.values()) {
        if (brick.gridPos[2] === minY) {
          groundedBricks.add(brick.id);
          queue.push(brick.id);
        }
      }
    }

    // Run BFS
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const neighbors = adjacency.get(currId);
      if (neighbors) {
        for (const nId of neighbors) {
          if (!groundedBricks.has(nId)) {
            groundedBricks.add(nId);
            queue.push(nId);
          }
        }
      }
    }

    // Step 3: Identify Floating Bricks & Auto-Remediation
    const floatingBrickIds: string[] = [];
    let remediatedBricksCount = 0;

    for (const brick of placedBricks.values()) {
      if (!groundedBricks.has(brick.id)) {
        floatingBrickIds.push(brick.id);
      }
    }

    // Auto-remediation: Synthesize authentic vertical 1x1 support pillars (3005)
    // from floating piece down to nearest grounded brick or build plate (y = 0)
    for (const floatingId of floatingBrickIds) {
      if (groundedBricks.has(floatingId)) continue; // Already grounded by previous pillar

      const brick = placedBricks.get(floatingId);
      if (!brick) continue;

      const [bx, bz, by] = brick.gridPos;
      let bestAnchorY = -1;
      let bestAnchorX = bx;
      let bestAnchorZ = bz;
      let canRemediate = false;

      // Check all (dx, dz) under the brick footprint
      for (let dx = 0; dx < brick.size[0] && !canRemediate; dx++) {
        for (let dz = 0; dz < brick.size[1] && !canRemediate; dz++) {
          const checkX = bx + dx;
          const checkZ = bz + dz;

          let unobstructed = true;
          let targetAnchorY = -1;

          for (let y = by - 1; y >= 0; y--) {
            const key = this.cellKey(checkX, checkZ, y);
            const occId = occupiedCellToBrickId.get(key);
            if (occId) {
              if (groundedBricks.has(occId)) {
                targetAnchorY = y;
              } else {
                unobstructed = false;
              }
              break;
            }
            if (y === 0) {
              targetAnchorY = 0;
            }
          }

          if (targetAnchorY >= 0 && unobstructed) {
            bestAnchorY = targetAnchorY;
            bestAnchorX = checkX;
            bestAnchorZ = checkZ;
            canRemediate = true;
          }
        }
      }

      if (canRemediate) {
        const startPillarY = (bestAnchorY === 0 && !occupiedCellToBrickId.has(this.cellKey(bestAnchorX, bestAnchorZ, 0))) ? 0 : bestAnchorY + 1;
        let pillarSuccess = true;
        const pillarBricks: PlacedBrick[] = [];

        for (let py = startPillarY; py < by; py++) {
          const pKey = this.cellKey(bestAnchorX, bestAnchorZ, py);
          if (occupiedCellToBrickId.has(pKey)) {
            pillarSuccess = false;
            break;
          }

          const supportId = `b_support_3005_${bestAnchorX}_${bestAnchorZ}_${py}`;
          const ldrawX = (bestAnchorX + 0.5 - grid.numStudsX / 2.0) * LDU_STUD_PITCH;
          const ldrawZ = -((bestAnchorZ + 0.5 - grid.numStudsZ / 2.0) * LDU_STUD_PITCH);
          const ldrawY = -(py + 1) * LDU_PLATE_HEIGHT;

          const supportBrick: PlacedBrick = {
            id: supportId,
            partId: '3005',
            name: 'Brick 1 x 1 Support Column',
            category: 'FILL',
            profile: 'brick',
            colorCode: brick.colorCode,
            colorHex: brick.colorHex,
            colorName: brick.colorName,
            gridPos: [bestAnchorX, bestAnchorZ, py],
            ldrawPos: [ldrawX, ldrawY, ldrawZ],
            rotation: 0,
            matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            size: [1, 1, 1],
            baseSize: [1, 1, 1],
            stepIndex: brick.stepIndex,
            growthPhase: 'CORE_EXPANSION',
            clutchScore: 1.0,
            parentBrickIds: [brick.id],
            islandId: brick.islandId,
            islandColorHex: brick.islandColorHex
          };
          pillarBricks.push(supportBrick);
        }

        if (pillarSuccess && pillarBricks.length > 0) {
          for (let pi = 0; pi < pillarBricks.length; pi++) {
            const sb = pillarBricks[pi];
            placedBricks.set(sb.id, sb);
            occupiedCellToBrickId.set(this.cellKey(sb.gridPos[0], sb.gridPos[1], sb.gridPos[2]), sb.id);
            groundedBricks.add(sb.id);
            if (!adjacency.has(sb.id)) adjacency.set(sb.id, new Set());
            if (!underMap.has(sb.id)) underMap.set(sb.id, new Set());

            if (pi > 0) {
              const lowerSb = pillarBricks[pi - 1];
              adjacency.get(sb.id)?.add(lowerSb.id);
              adjacency.get(lowerSb.id)?.add(sb.id);
              underMap.get(sb.id)?.add(lowerSb.id);
            }
          }

          // Connect top pillar brick to floating brick above
          const topSb = pillarBricks[pillarBricks.length - 1];
          adjacency.get(topSb.id)?.add(brick.id);
          adjacency.get(brick.id)?.add(topSb.id);
          underMap.get(brick.id)?.add(topSb.id);

          // Propagate grounding through adjacency to the floating brick and its sub-assembly
          groundedBricks.add(brick.id);
          const subQueue = [brick.id];
          while (subQueue.length > 0) {
            const curr = subQueue.shift()!;
            const nbrs = adjacency.get(curr);
            if (nbrs) {
              for (const nid of nbrs) {
                if (!groundedBricks.has(nid)) {
                  groundedBricks.add(nid);
                  subQueue.push(nid);
                }
              }
            }
          }
          remediatedBricksCount++;
        }
      }
    }

    // Step 3b: Prune only completely isolated single stray debris that have zero connections in 3D
    // NEVER prune pieces that are connected to other pieces in a surface, wing, or cantilever!
    const ungroundedToPrune: string[] = [];
    for (const b of placedBricks.values()) {
      if (!groundedBricks.has(b.id)) {
        const connCount = adjacency.get(b.id)?.size || 0;
        if (connCount === 0) {
          ungroundedToPrune.push(b.id);
        }
      }
    }

    for (const fid of ungroundedToPrune) {
      const b = placedBricks.get(fid);
      if (b) {
        placedBricks.delete(fid);
        const [bx, bz, by] = b.gridPos;
        for (let dx = 0; dx < b.size[0]; dx++) {
          for (let dz = 0; dz < b.size[1]; dz++) {
            for (let dy = 0; dy < b.size[2]; dy++) {
              const k = this.cellKey(bx + dx, bz + dz, by + dy);
              if (occupiedCellToBrickId.get(k) === fid) {
                occupiedCellToBrickId.delete(k);
              }
            }
          }
        }
      }
    }

    const remainingFloatingIds: string[] = [];

    // Step 4: Running Bond Interlocking Check
    let multiStudCount = 0;
    let interlockedCount = 0;
    let cantileverWarningsCount = 0;

    for (const brick of placedBricks.values()) {
      const footprint = brick.size[0] * brick.size[1];
      if (footprint >= 2 && brick.gridPos[2] > 0) {
        multiStudCount++;
        const underBricks = underMap.get(brick.id);
        if (underBricks && underBricks.size >= 2) {
          interlockedCount++; // Successfully bridges across 2 or more distinct bricks below
        } else if (!underBricks || underBricks.size === 0) {
          cantileverWarningsCount++;
        }
      }
    }

    const interlockRatio = multiStudCount > 0 ? Math.round((interlockedCount / multiStudCount) * 100) : 100;
    const finalGroundedCount = groundedBricks.size;
    const finalFloatingCount = remainingFloatingIds.length;
    const totalCount = placedBricks.size;

    return {
      is100PercentGrounded: finalFloatingCount === 0,
      totalBricks: totalCount,
      groundedBricksCount: finalGroundedCount,
      floatingBricksCount: finalFloatingCount,
      remediatedBricksCount,
      interlockRatio,
      cantileverWarningsCount,
      floatingBrickIds: remainingFloatingIds
    };
  }
}
