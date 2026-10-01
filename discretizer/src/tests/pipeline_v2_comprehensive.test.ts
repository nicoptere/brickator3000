import * as THREE from 'three';
import { rasterizeIslandsToLatticeAsync } from '../solver/triangleRasterizer';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';
import type { MeshIsland } from '../solver/islandSegmenter';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runComprehensivePipelineTest() {
  console.log('--- Testing Comprehensive Discretization V2 Pipeline ---\n');

  // 1. Create a Procedural Sphere Mesh Island (radius 10)
  const geom = new THREE.SphereGeometry(10, 32, 16).toNonIndexed();
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

  // 2. Rasterize with 2-voxel thick watertight hollow shell in Brick Unit Mode
  console.log('[Step 1: Rasterizing Procedural Sphere into 2-Thick Watertight Shell in Brick Unit Mode]');
  const lattice = await rasterizeIslandsToLatticeAsync([island], {
    targetStuds: 16,
    verticalUnit: 'brick',
    hollowCore: true,
    shellThickness: 2
  });

  console.log(`Lattice dimensions: ${lattice.numStudsX} x ${lattice.numStudsZ} x ${lattice.numPlatesY}`);
  console.log(`Total occupied shell voxels: ${lattice.totalOccupied}`);
  assert(lattice.totalOccupied > 1000, 'Watertight shell has substantial volume (no hole punching)');

  // Verify that the deep interior center is completely hollow air
  const cx = Math.floor(lattice.numStudsX / 2);
  const cz = Math.floor(lattice.numStudsZ / 2);
  const cy = Math.floor(lattice.numPlatesY / 2);
  const isCenterOccupied = lattice.isOccupied(cx, cz, cy);
  console.log(`Center voxel (${cx}, ${cz}, ${cy}) occupied: ${isCenterOccupied}`);
  assert(!isCenterOccupied, 'Deep internal core is completely hollow');

  // 3. Run Solver with Hierarchical Size-Descent, Spatial BVH, Marching Cubes, and Unit-Brick Swaps
  console.log('\n[Step 2: Running Hierarchical Multi-Scale Solver with Marching Cubes & Unit-Brick Swap]');
  const solver = new GrowingSurfaceKernelSolver(lattice, {
    dispatchStrategy: 'size_descent',
    enableSlopes: true,
    enableCurvedSlopes: true,
    enableMacaroni: true,
    enableCanisters: true,
    enableStudlessTiles: true,
    enableCollapse: true,
    enableVoxelRecompute: true
  });

  const result = await solver.solve();
  console.log(`Placed ${result.bricks.length} total elements in ${result.executionTimeMs} ms.`);
  assert(result.bricks.length >= 100, `Model built extensive multi-layer shell (got ${result.bricks.length} bricks, expected >= 100)`);

  // Verify multi-layer height coverage (not just layer 0!)
  const layersWithBricks = new Set<number>();
  for (const b of result.bricks) {
    layersWithBricks.add(b.gridPos[2]);
  }
  console.log(`Layers with placed bricks: ${layersWithBricks.size} layers (Y = ${Array.from(layersWithBricks).sort((a,b)=>a-b).join(', ')})`);
  assert(layersWithBricks.size >= 8, 'Bricks span across at least 8 vertical layers, successfully building the full sphere');

  // 4. Verify Physical Grounding
  console.log(`Grounding: ${result.stats.groundedBricks}/${result.stats.totalBricks} (${Math.round((result.stats.groundedBricks/result.stats.totalBricks)*100)}%)`);
  assert(result.stats.is100PercentGrounded, 'Discretized model is 100% physically grounded');

  // 5. Verify LDraw code generation with 24-bit direct color format
  assert(result.ldrawCode.length > 0, 'Authentic LDraw script generated');
  const ldrawLines = result.ldrawCode.split('\n').filter(l => l.startsWith('1 '));
  assert(ldrawLines.length === result.bricks.length, 'Every placed element produces an LDraw line');
  assert(ldrawLines[0].includes('0x2'), 'Direct 24-bit RGB format verified');

  console.log('\nALL COMPREHENSIVE PIPELINE V2 TESTS PASSED SUCCESSFULLY!');
}

runComprehensivePipelineTest().catch(err => {
  console.error('Comprehensive test failed:', err);
  process.exit(1);
});
