import { PlateLattice3D } from '../core/PlateLattice3D';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';
import { rasterizeIslandsToLatticeAsync } from '../solver/triangleRasterizer';
import type { MeshIsland } from '../solver/islandSegmenter';
import * as THREE from 'three';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runBrickUnitsAndHollowTest() {
  console.log('--- Testing Brick Units Mode & Hollow Core Discretization ---\n');

  // 1. Create a synthetic closed cube mesh island
  // Triangle box from [-4, -4, -4] to [4, 4, 4]
  const geom = new THREE.BoxGeometry(8, 8, 8).toNonIndexed();
  geom.computeVertexNormals();
  const pos = geom.attributes.position;
  const norm = geom.attributes.normal;

  const triangles: MeshIsland['triangles'] = [];
  for (let i = 0; i < pos.count; i += 3) {
    triangles.push({
      a: new THREE.Vector3().fromBufferAttribute(pos, i),
      b: new THREE.Vector3().fromBufferAttribute(pos, i + 1),
      c: new THREE.Vector3().fromBufferAttribute(pos, i + 2),
      normal: new THREE.Vector3().fromBufferAttribute(norm, i),
      material: undefined
    });
  }

  const island: MeshIsland = {
    id: 1,
    triangles,
    triangleCount: triangles.length
  };

  // 2. Test Hollow Core Rasterization in Brick Unit Mode
  console.log('[Rasterizing in Brick Unit Mode with Hollow Core]');
  const brickLattice = await rasterizeIslandsToLatticeAsync([island], {
    targetStuds: 16,
    verticalUnit: 'brick',
    hollowCore: true
  });

  console.log(`Brick Lattice dimensions: ${brickLattice.numStudsX} x ${brickLattice.numStudsZ} x ${brickLattice.numPlatesY}`);
  console.log(`Occupied boundary voxels: ${brickLattice.totalOccupied}`);
  console.log(`Lattice verticalUnit: ${brickLattice.verticalUnit}`);
  assert(brickLattice.verticalUnit === 'brick', 'Lattice verticalUnit is correctly brick');

  // Check that the interior center of the cube is completely hollow (unoccupied)
  const centerX = Math.floor(brickLattice.numStudsX / 2);
  const centerZ = Math.floor(brickLattice.numStudsZ / 2);
  const centerY = Math.floor(brickLattice.numPlatesY / 2);
  const isCenterOccupied = brickLattice.isOccupied(centerX, centerZ, centerY);
  console.log(`Is center voxel (${centerX}, ${centerZ}, ${centerY}) occupied: ${isCenterOccupied}`);
  assert(!isCenterOccupied, 'Core center is completely hollow (unoccupied)');

  // 3. Test Discretization in Brick Unit Mode
  console.log('\n[Solving Discretization in Brick Unit Mode]');
  const solver = new GrowingSurfaceKernelSolver(brickLattice, {
    dispatchStrategy: 'size_descent',
    enableVoxelRecompute: true
  });

  const result = await solver.solve();
  console.log(`Placed ${result.bricks.length} bricks in Brick Unit mode.`);

  // Verify that placed bricks in Brick Unit mode are 1-brick-tall pieces (size[2] === 1 brick unit)
  // NOT 1-plate-tall pieces!
  const brickUnitPieces = result.bricks.filter(b => b.size[2] === 1);
  console.log(`Bricks with height = 1 brick unit: ${brickUnitPieces.length} / ${result.bricks.length}`);
  assert(brickUnitPieces.length === result.bricks.length, 'All placed bricks in Brick Unit mode have height = 1 brick unit');

  // Check physical grounding
  console.log(`Grounding: ${result.stats.groundedBricks}/${result.stats.totalBricks} grounded.`);
  assert(result.stats.groundedBricks > 0, 'Model has grounded base in Brick Unit mode');

  console.log('\nALL BRICK UNITS & HOLLOW CORE TESTS PASSED SUCCESSFULLY!');
}

runBrickUnitsAndHollowTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
