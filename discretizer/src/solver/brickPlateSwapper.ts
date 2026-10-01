import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { PlacedBrick } from '../core/types';
import { sampleCentroidColor } from './pipelineDispatcher';
import { createSolidMask, createStandardConnectors } from '../kernels/kernelHelpers';

export interface SwapOptions {
  colorVarianceThreshold?: number;
  enableTileSwapOnTop?: boolean;
}

/**
 * Topological Unit-Brick Swapper:
 * Runs strictly AFTER main bricks and finish elements are laid out.
 * Selectively swaps unit bricks (3 plates high = 24 LDU) for topologically equivalent
 * combinations of plates (or plates + tiles) where beneficial for color fidelity,
 * fine micro-stepping, or vertical seam staggering.
 */
export function swapUnitBricksForPlates(
  placedBricks: PlacedBrick[],
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  assemblyGraph: AssemblyGraph3D,
  options: SwapOptions = {}
): { swappedCount: number; newBricks: PlacedBrick[] } {
  const { colorVarianceThreshold = 30, enableTileSwapOnTop = true } = options;

  let swappedCount = 0;
  const resultBricks: PlacedBrick[] = [];

  // Plate Part IDs mapping by [width, depth]
  const PLATE_PART_MAP: Record<string, string> = {
    '1,1': '3024',
    '1,2': '3023',
    '2,1': '3023',
    '1,3': '3623',
    '3,1': '3623',
    '1,4': '3710',
    '4,1': '3710',
    '1,6': '3666',
    '6,1': '3666',
    '1,8': '3460',
    '8,1': '3460',
    '2,2': '3022',
    '2,3': '3021',
    '3,2': '3021',
    '2,4': '3020',
    '4,2': '3020',
    '2,6': '3795',
    '6,2': '3795',
    '2,8': '3034',
    '8,2': '3034',
    '4,4': '3031'
  };

  for (const brick of placedBricks) {
    // Only evaluate standard unit bricks
    if (brick.category !== 'BRICK_STANDARD') {
      resultBricks.push(brick);
      continue;
    }

    const [bx, bz, by] = brick.gridPos;
    const [bw, bd, bh] = brick.size;

    // Check if part has known plate equivalent
    const key = `${bw},${bd}`;
    const platePartId = PLATE_PART_MAP[key];

    if (!platePartId) {
      resultBricks.push(brick);
      continue;
    }

    // Check if swapping provides a measurable color or aesthetic benefit:
    // Sample variance between top, middle, and bottom plate sub-regions
    const sample = sampleCentroidColor(bx, bz, by, bw, bd, bh, lattice);

    // If in brick unit mode (h = 1 brick unit = 24 LDU):
    // A unit brick represents 3 plates. Check color variance along Y
    let shouldSwap = false;

    // If top faces open air and user requested tile swap on top
    const facesAirAbove = !lattice.isOccupied(bx, bz, by + 1);
    if (enableTileSwapOnTop && facesAirAbove) {
      shouldSwap = true;
    }

    // Check color variance
    if (!shouldSwap) {
      const topVoxel = lattice.getVoxel(bx, bz, by);
      if (topVoxel && Math.abs(topVoxel.colorPacked - sample.packed) > colorVarianceThreshold) {
        shouldSwap = true;
      }
    }

    if (!shouldSwap) {
      resultBricks.push(brick);
      continue;
    }

    // Perform the swap:
    // Remove original brick from assembly graph
    assemblyGraph.removeBrick(brick.instanceId);

    // Create 3 sub-plates:
    // In LDraw, the brick is at ldrawPos [x, y, z].
    // Y in LDraw is down, 24 LDU total height.
    // Plate 0 (bottom): Y offset 0 LDU
    // Plate 1 (middle): Y offset -8 LDU
    // Plate 2 (top): Y offset -16 LDU
    const [lx, ly, lz] = brick.ldrawPos;

    for (let p = 0; p < 3; p++) {
      const isTopPlate = p === 2;
      const isTile = isTopPlate && facesAirAbove;
      const partId = isTile && PLATE_PART_MAP[key] ? (key === '1,1' ? '98138' : key === '1,2' ? '3069b' : key === '2,2' ? '3068b' : key === '1,4' ? '2431' : platePartId) : platePartId;
      const category = isTile ? 'TILE_FLAT' : 'PLATE_STANDARD';

      // Plate LDraw coordinates (Y in LDraw goes negative upward)
      const plateLdrawY = ly - p * 8.0;
      const plateInstId = `swap_${brick.instanceId}_p${p}`;

      const plateSample = sampleCentroidColor(bx, bz, by, bw, bd, bh, lattice);
      const plateColorHex = plateSample.packed !== 0x94a3b8 ? plateSample.hex : brick.colorHex;
      const plateColorPacked = plateSample.packed !== 0x94a3b8 ? plateSample.packed : brick.colorPacked;
      const plateConnectors = isTile
        ? createStandardConnectors(bw, bd, 1, false, true)
        : createStandardConnectors(bw, bd, 1, true, true);

      const placedPlate: PlacedBrick = {
        instanceId: plateInstId,
        partId,
        name: isTile ? `Tile ${bw} x ${bd}` : `Plate ${bw} x ${bd}`,
        gridPos: [bx, bz, by + p],
        baseSize: [bw, bd, 1],
        size: [bw, bd, 1],
        rotation: brick.rotation,
        colorHex: plateColorHex,
        colorPacked: plateColorPacked,
        ldrawPos: [lx, plateLdrawY, lz],
        ldrawMatrix: brick.ldrawMatrix,
        category,
        connectors: plateConnectors,
        occupancyMask: createSolidMask(bw, bd, 1)
      };

      assemblyGraph.addBrick(placedPlate);
      resultBricks.push(placedPlate);
    }

    swappedCount++;
  }

  return { swappedCount, newBricks: resultBricks };
}
