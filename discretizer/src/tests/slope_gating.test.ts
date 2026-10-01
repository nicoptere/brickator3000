import { PlateLattice3D } from '../core/PlateLattice3D';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';
import { KERNEL_CATALOG } from '../kernels/kernelCatalog';
import { generateKernelVariants } from '../kernels/kernelRotator';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runSlopeGatingTest() {
  console.log('--- Testing Slope Gating on Vertical Walls & Dynamic Voxel Recompute ---\n');

  // 1. Create a vertical wall box (normals pointing horizontally outward: [1, 0, 0] or [0, 0, 1])
  // Size: 8 x 8 x 6 (width X, depth Z, height Y)
  const lattice = new PlateLattice3D(12, 12, 12);
  for (let y = 0; y < 6; y++) {
    for (let z = 2; z < 8; z++) {
      for (let x = 2; x < 8; x++) {
        // Vertical wall normals: outward horizontally
        let nx = 0;
        let nz = 0;
        if (x === 2) nx = -1;
        else if (x === 7) nx = 1;
        if (z === 2) nz = -1;
        else if (z === 7) nz = 1;
        const len = Math.hypot(nx, nz) || 1;

        // Normal has ny = 0 -> angleDeg = 90 deg (vertical wall!)
        lattice.setVoxel(x, z, y, 0xffffff, [nx / len, 0, nz / len], 1);
      }
    }
  }

  lattice.computeDistanceTransform();
  console.log(`Created vertical wall test box with ${lattice.totalOccupied} voxels.`);

  // 2. Run solver with slopes and curved slopes enabled
  const solver = new GrowingSurfaceKernelSolver(lattice, {
    dispatchStrategy: 'size_descent',
    enableSlopes: true,
    enableCurvedSlopes: true,
    enableStudlessTiles: true,
    enableVoxelRecompute: true
  });

  const result = await solver.solve();
  console.log(`Solver placed ${result.bricks.length} bricks.`);

  // Verify that NO slope bricks (SLOPE_45, CHEESE_SLOPE, SLOPE_CURVED) were placed on the vertical walls!
  const placedSlopes = result.bricks.filter(b =>
    b.category === 'SLOPE_45' ||
    b.category === 'CHEESE_SLOPE' ||
    b.category === 'SLOPE_CURVED'
  );

  console.log(`Placed slopes count on vertical wall box: ${placedSlopes.length}`);
  assert(placedSlopes.length === 0, 'Zero directional slopes placed on vertical walls (theta = 90 deg)');

  // Verify standard bricks or plates were used for the vertical walls
  const wallElements = result.bricks.filter(b =>
    b.category === 'BRICK_STANDARD' ||
    b.category === 'PLATE_STANDARD' ||
    b.category === 'MACARONI_WEDGE'
  );
  assert(wallElements.length > 0, 'Vertical walls built with standard bricks/plates/macaronis');
  console.log(`Vertical wall elements utilized: ${wallElements.length}`);

  // 3. Verify Dynamic Voxel Recompute
  // Since enableVoxelRecompute was true, placed solid voxels were cleared from the lattice
  console.log(`Remaining voxels in lattice after recompute: ${lattice.totalOccupied} / 216`);
  assert(lattice.totalOccupied < 216, 'Occupied voxels successfully cleared from lattice via dynamic recompute');
  assert(lattice.totalOccupied <= 16, 'Over 90% of model voxels claimed and cleared');

  console.log('\nALL SLOPE GATING & VOXEL RECOMPUTE TESTS PASSED!');
}

runSlopeGatingTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
