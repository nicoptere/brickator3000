import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { RotatedKernelVariant } from '../kernels/types';
import type { PlacedBrick } from '../core/types';
import { SYSTEM_TILES } from '../kernels/systemTiles';
import { generateKernelVariants } from '../kernels/kernelRotator';
import { commitCandidate, runPass } from './pipelineDispatcher';

/**
 * Checks whether cell (x, z, y) belongs to a genuine multi-layer vertical pole/column
 * that is horizontally isolated (no 8-connected horizontal neighbors in X or Z).
 */
export function isVerticalPoleShaft(
  x: number,
  z: number,
  y: number,
  lattice: PlateLattice3D,
  bitset?: LegoBitset3D
): boolean {
  const isCellActive = (cx: number, cz: number, cy: number) => {
    return lattice.isOccupied(cx, cz, cy) || (bitset ? bitset.isClaimed(cx, cz, cy) : false);
  };

  // 1. Strict 8-connected horizontal isolation check at current layer
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (isCellActive(x + dx, z + dz, y)) return false;
    }
  }

  // 2. Must have vertical continuity: at least one occupied/claimed cell directly above or below
  const hasVerticalAbove = isCellActive(x, z, y + 1);
  const hasVerticalBelow = y > 0 && isCellActive(x, z, y - 1);
  if (!hasVerticalAbove && !hasVerticalBelow) return false;

  // 3. The adjacent vertical cell must also be horizontally isolated
  if (hasVerticalAbove) {
    let hasHorizAbove = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (isCellActive(x + dx, z + dz, y + 1)) {
          hasHorizAbove = true;
          break;
        }
      }
      if (hasHorizAbove) break;
    }
    if (!hasHorizAbove) return true;
  }

  if (hasVerticalBelow) {
    let hasHorizBelow = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (isCellActive(x + dx, z + dz, y - 1)) {
          hasHorizBelow = true;
          break;
        }
      }
      if (hasHorizBelow) break;
    }
    if (!hasHorizBelow) return true;
  }

  return false;
}

/**
 * Applies special finish elements (apex dishes, macaroni curves, isolated vertical pole canisters).
 */
export async function applySpecialFinishElements(
  variants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: any
): Promise<void> {
  const apexVariants = variants.filter(v => v.category === 'ORGANIC_DOME');
  const macaroniVariants = variants.filter(v => v.category === 'MACARONI_WEDGE');
  const canisterVariants = variants.filter(v => v.category === 'ROUND_CANISTER');
  const bionicleVariants = variants.filter(v => v.category === 'BIONICLE_CREATURE');

  const b = lattice.bounds;

  // 1. Apex dishes/domes at topmost layers
  if (options.enableCanisters && apexVariants.length > 0) {
    for (let y = b.maxY; y >= Math.max(0, b.maxY - 2); y--) {
      await runPass(apexVariants, lattice, bitset, integral, assemblyGraph, options, {
        layerY: y,
        requireApex: true
      });
    }
  }

  // 2. Curved macaroni round tiles on rounded perimeter corners
  if (options.enableMacaroni && macaroniVariants.length > 0) {
    for (let y = b.minY; y <= b.maxY; y++) {
      await runPass(macaroniVariants, lattice, bitset, integral, assemblyGraph, options, {
        layerY: y,
        requireDepth0: true
      });
    }
  }

  // 3. Vertical round canister columns: strictly restricted to verified multi-layer vertical pole shafts!
  if (options.enableCanisters && canisterVariants.length > 0) {
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          if (!bitset.isAvailable(x, z, y)) continue;
          if (!isVerticalPoleShaft(x, z, y, lattice, bitset)) continue;

          for (const variant of canisterVariants) {
            if (variant.size[0] === 1 && variant.size[1] === 1) {
              if (y === 0 || assemblyGraph.canConnectToGrounded(x, z, y, variant.connectors)) {
                commitCandidate(
                  x,
                  z,
                  y,
                  variant,
                  lattice,
                  bitset,
                  integral,
                  assemblyGraph,
                  options.enableVoxelRecompute
                );
                break;
              }
            }
          }
        }
      }
    }
  }

  // 4. Bionicle decorative barbs/horns only on sharp ridge crests (not flat surfaces)
  if (bionicleVariants.length > 0) {
    for (let y = b.minY; y <= b.maxY; y++) {
      await runPass(bionicleVariants, lattice, bitset, integral, assemblyGraph, options, {
        layerY: y,
        requireDepth0: true
      });
    }
  }
}

/**
 * Applies smooth studless flat tiles to cover 100% of exposed upward-facing studs.
 */
export async function applyStudlessTopTiles(
  tileVariants: RotatedKernelVariant[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  integral: IntegralVolume3D,
  assemblyGraph: AssemblyGraph3D,
  options: any
): Promise<number> {
  let activeTileVariants = tileVariants.filter(v => v.category === 'TILE_FLAT');
  if (activeTileVariants.length === 0) {
    activeTileVariants = generateKernelVariants(SYSTEM_TILES, lattice.verticalUnit).filter(
      v => v.category === 'TILE_FLAT'
    );
  }
  if (activeTileVariants.length === 0) return 0;

  const placedBricks = assemblyGraph.getAllBricks();
  if (placedBricks.length === 0) return 0;

  const occupiedCells = new Set<string>();
  for (const b of placedBricks) {
    for (let dy = 0; dy < b.size[2]; dy++) {
      for (let dz = 0; dz < b.size[1]; dz++) {
        for (let dx = 0; dx < b.size[0]; dx++) {
          occupiedCells.add(`${b.gridPos[0] + dx},${b.gridPos[1] + dz},${b.gridPos[2] + dy}`);
        }
      }
    }
  }

  // Group exposed upward-facing studs by topY
  const exposedByLayer = new Map<number, Set<string>>();
  const colorByStud = new Map<string, { hex: string; packed: number }>();

  for (const b of placedBricks) {
    // Smooth/sloped elements without upward studs
    if (
      b.category === 'TILE_FLAT' ||
      b.category === 'SLOPE_CURVED' ||
      b.category === 'CHEESE_SLOPE' ||
      b.category === 'ORGANIC_DOME' ||
      b.partId === '98138'
    ) {
      continue;
    }

    const topY = b.gridPos[2] + b.size[2];
    if (topY >= lattice.numPlatesY) continue;

    for (let dx = 0; dx < b.size[0]; dx++) {
      for (let dz = 0; dz < b.size[1]; dz++) {
        const gx = b.gridPos[0] + dx;
        const gz = b.gridPos[1] + dz;

        // Is there already a brick occupying this stud at topY?
        if (occupiedCells.has(`${gx},${gz},${topY}`)) continue;
        if (bitset.isClaimed(gx, gz, topY)) continue;

        // Is there a solid interior voxel directly above? (inside model)
        if (topY + 1 < lattice.numPlatesY && lattice.isOccupied(gx, gz, topY + 1)) continue;

        if (!exposedByLayer.has(topY)) {
          exposedByLayer.set(topY, new Set());
        }
        exposedByLayer.get(topY)!.add(`${gx},${gz}`);
        colorByStud.set(`${gx},${gz},${topY}`, { hex: b.colorHex, packed: b.colorPacked });
      }
    }
  }

  // Prioritize compact 2-wide and standard flat tiles: 2x4 (87079), 2x2 (3068b), 1x4 (2431), 1x2 (3069b), then larger strips
  const tilePriority = new Map<string, number>([
    ['87079', 10], // 2x4
    ['3068b', 9],  // 2x2
    ['2431', 8],   // 1x4
    ['3069b', 7],  // 1x2
    ['6636', 6],   // 1x6
    ['4162', 5],   // 1x8
    ['63864', 4],  // 1x3
    ['14769', 3],  // 2x2 round
    ['98138', 2],  // 1x1 round
    ['3070b', 1],  // 1x1
  ]);

  const sortedTiles = [...activeTileVariants].sort((a, b) => {
    const pA = tilePriority.get(a.partId) ?? 0;
    const pB = tilePriority.get(b.partId) ?? 0;
    if (pB !== pA) return pB - pA;
    const areaA = a.size[0] * a.size[1];
    const areaB = b.size[0] * b.size[1];
    return areaB - areaA;
  });

  let tilesPlaced = 0;
  const isBrickMode = lattice.verticalUnit === 'brick';

  for (const [topY, studSet] of exposedByLayer) {
    if (studSet.size === 0) continue;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const key of studSet) {
      const [sx, sz] = key.split(',').map(Number);
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sz < minZ) minZ = sz;
      if (sz > maxZ) maxZ = sz;
    }

    // Pass 1: Try rectangular tiles from largest to smallest (area >= 2)
    for (const tileVar of sortedTiles) {
      const [tw, td, th] = tileVar.size;
      if (tw * td < 2) continue; // Exclude 1x1 in first pass

      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          let canFit = true;
          for (let dz = 0; dz < td; dz++) {
            for (let dx = 0; dx < tw; dx++) {
              if (!studSet.has(`${x + dx},${z + dz}`) || bitset.isClaimed(x + dx, z + dz, topY)) {
                canFit = false;
                break;
              }
            }
            if (!canFit) break;
          }

          if (canFit) {
            const instanceId = `tile_${tileVar.partId}_${x}_${z}_${topY}`;
            bitset.claimMask(x, z, topY, tileVar.occupancyMask, instanceId);

            const baseColor = colorByStud.get(`${x},${z},${topY}`) || { hex: '#94a3b8', packed: 0x94a3b8 };
            
            // In LDraw:
            // In brick mode, the top of the brick below is at -(topY * 24).
            // A tile of height 8 LDU has top at -(topY * 24 + 8).
            // In stud mode: -(topY * 8 + 8).
            const unitH = isBrickMode ? 24.0 : 8.0;
            const tileLdrawH = 8.0;
            const ldrawX = (x + tw / 2 - lattice.numStudsX / 2) * 20.0;
            const ldrawZ = (z + td / 2 - lattice.numStudsZ / 2) * 20.0;
            const ldrawY = -(topY * unitH + tileLdrawH);

            const placedTile: PlacedBrick = {
              instanceId,
              partId: tileVar.partId,
              name: tileVar.name,
              gridPos: [x, z, topY],
              baseSize: tileVar.def.baseSize,
              size: [tw, td, th],
              rotation: tileVar.rotation,
              colorHex: baseColor.hex,
              colorPacked: baseColor.packed,
              ldrawPos: [ldrawX, ldrawY, ldrawZ],
              ldrawMatrix: tileVar.ldrawMatrix,
              category: 'TILE_FLAT',
              connectors: tileVar.connectors,
              occupancyMask: tileVar.occupancyMask
            };

            assemblyGraph.addBrick(placedTile);
            tilesPlaced++;

            for (let dz = 0; dz < td; dz++) {
              for (let dx = 0; dx < tw; dx++) {
                studSet.delete(`${x + dx},${z + dz}`);
                occupiedCells.add(`${x + dx},${z + dz},${topY}`);
              }
            }
          }
        }
      }
    }

    // Pass 2: Cover any remaining single isolated studs with 1x1 flat tiles (3070b)
    const v1x1 = sortedTiles.find(t => t.size[0] === 1 && t.size[1] === 1 && t.partId === '3070b') ||
                 sortedTiles.find(t => t.size[0] === 1 && t.size[1] === 1);
    if (v1x1 && studSet.size > 0) {
      for (const key of Array.from(studSet)) {
        const [x, z] = key.split(',').map(Number);
        if (bitset.isClaimed(x, z, topY)) continue;

        const instanceId = `tile_${v1x1.partId}_${x}_${z}_${topY}`;
        bitset.claimMask(x, z, topY, v1x1.occupancyMask, instanceId);

        const baseColor = colorByStud.get(`${x},${z},${topY}`) || { hex: '#94a3b8', packed: 0x94a3b8 };
        const unitH = isBrickMode ? 24.0 : 8.0;
        const tileLdrawH = 8.0;
        const ldrawX = (x + 0.5 - lattice.numStudsX / 2) * 20.0;
        const ldrawZ = (z + 0.5 - lattice.numStudsZ / 2) * 20.0;
        const ldrawY = -(topY * unitH + tileLdrawH);

        const placedTile: PlacedBrick = {
          instanceId,
          partId: v1x1.partId,
          name: v1x1.name,
          gridPos: [x, z, topY],
          baseSize: v1x1.def.baseSize,
          size: [1, 1, v1x1.size[2]],
          rotation: 0,
          colorHex: baseColor.hex,
          colorPacked: baseColor.packed,
          ldrawPos: [ldrawX, ldrawY, ldrawZ],
          ldrawMatrix: v1x1.ldrawMatrix,
          category: 'TILE_FLAT',
          connectors: v1x1.connectors,
          occupancyMask: v1x1.occupancyMask
        };

        assemblyGraph.addBrick(placedTile);
        tilesPlaced++;
        studSet.delete(key);
        occupiedCells.add(`${x},${z},${topY}`);
      }
    }
  }

  return tilesPlaced;
}
