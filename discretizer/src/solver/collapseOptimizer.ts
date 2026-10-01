import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';

/**
 * Gravity & Connectivity Collapse Optimizer:
 * Identifies floating components (unconnected to y = 0) and collapses them downward
 * until supported, or removes ungrounded elements safely.
 */
export function runCollapsePass(
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  assemblyGraph: AssemblyGraph3D,
  integral?: IntegralVolume3D,
  enableVoxelRecompute: boolean = false
): boolean {
  const allBricks = assemblyGraph.getAllBricks();
  let changed = false;

  // Sort bricks by Y ascending so lower layers settle first
  const sorted = [...allBricks].sort((a, b) => a.gridPos[2] - b.gridPos[2]);

  for (const brick of sorted) {
    if (assemblyGraph.isGrounded(brick.instanceId)) {
      continue;
    }

    // Brick is ungrounded (floating in air)! Attempt to drop it downward along Y
    const [bx, bz, by] = brick.gridPos;
    const [bw, bd, bh] = brick.size;
    let targetY = -1;

    for (let dy = 1; dy <= by; dy++) {
      const testY = by - dy;
      const canConnect = testY === 0 || assemblyGraph.canConnectToGrounded(bx, bz, testY, brick.connectors);
      if (canConnect) {
        // Check collision with other bricks
        let canFit = true;
        for (let ly = 0; ly < bh; ly++) {
          for (let lz = 0; lz < bd; lz++) {
            for (let lx = 0; lx < bw; lx++) {
              if (brick.occupancyMask && !brick.occupancyMask[ly]?.[lz]?.[lx]) continue;
              const cellY = testY + ly;
              const owner = bitset.getCellOwner(bx + lx, bz + lz, cellY);
              if (owner !== null && owner !== brick.instanceId) {
                canFit = false;
                break;
              }
            }
            if (!canFit) break;
          }
          if (!canFit) break;
        }
        if (canFit) {
          targetY = testY;
          break;
        }
      }
    }

    if (targetY !== -1 && targetY !== by) {
      if (brick.occupancyMask) {
        bitset.releaseMask(bx, bz, by, brick.occupancyMask);
      } else {
        bitset.releaseRegion(bx, bz, by, bw, bd, bh);
      }
      assemblyGraph.removeBrick(brick.instanceId);

      brick.gridPos = [bx, bz, targetY];
      brick.ldrawPos = lattice.gridToLDraw(bx, bz, targetY, bw, bd, bh);
      if (brick.occupancyMask) {
        bitset.claimMask(bx, bz, targetY, brick.occupancyMask, brick.instanceId);
      } else {
        bitset.claimRegion(bx, bz, targetY, bw, bd, bh, brick.instanceId);
      }
      assemblyGraph.addBrick(brick);
      changed = true;
    } else if (!assemblyGraph.isGrounded(brick.instanceId)) {
      // Cannot be grounded safely; remove floating brick and free cells
      if (brick.occupancyMask) {
        bitset.releaseMask(bx, bz, by, brick.occupancyMask);
      } else {
        bitset.releaseRegion(bx, bz, by, bw, bd, bh);
      }
      assemblyGraph.removeBrick(brick.instanceId);
      changed = true;
    }
  }

  if (changed && enableVoxelRecompute && integral) {
    integral.build(lattice);
  }

  return changed;
}
