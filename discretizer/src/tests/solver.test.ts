import { PlateLattice3D } from '../core/PlateLattice3D';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

function createSyntheticDomeLattice(): PlateLattice3D {
  const lattice = new PlateLattice3D(16, 16, 18);
  const centerX = 8;
  const centerZ = 8;
  const radius = 6;

  for (let y = 0; y < 15; y++) {
    const currentRadius = Math.max(1, radius * Math.cos((y / 15) * (Math.PI / 2)));
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - centerX;
        const dz = z - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= currentRadius) {
          const len = Math.sqrt(dx * dx + dz * dz + 4);
          const nx = dx / len;
          const nz = dz / len;
          const ny = 2.0 / len;

          lattice.setVoxel(x, z, y, 0x2563eb, [nx, ny, nz], 1);
        }
      }
    }
  }

  lattice.computeDistanceTransform();
  return lattice;
}

async function runSolverTest() {
  console.log('--- Phase 3: Surface-Growing Discretization Solver Tests ---\n');

  const lattice = createSyntheticDomeLattice();
  console.log(`Generated synthetic dome lattice with ${lattice.totalOccupied} occupied voxels.`);
  assert(lattice.totalOccupied > 100, 'Synthetic dome populated with voxels');

  // Run Solver in Tiered mode (Default)
  console.log('\n[Running Tiered Multi-Pass Solver]');
  const solver = new GrowingSurfaceKernelSolver(lattice, {
    dispatchStrategy: 'tiered',
    enableSlopes: true,
    enableCurvedSlopes: true,
    enableStudlessTiles: true,
    enableVoxelRecompute: true,
    onProgress: () => {}
  });

  const result = await solver.solve();
  console.log(`Solver placed ${result.bricks.length} bricks in ${result.executionTimeMs} ms.`);
  console.log(`Grounding: ${result.stats.groundedBricks}/${result.stats.totalBricks} bricks (${result.stats.is100PercentGrounded ? '100% Grounded' : 'Has floating bricks'}).`);
  console.log(`Total Connections: ${result.stats.totalConnections}`);

  assert(result.bricks.length > 0, 'Solver placed bricks successfully');
  assert(result.stats.groundedBricks > 0, 'Discretized model has physically grounded base');
  assert(result.stats.groundedBricks / result.stats.totalBricks >= 0.75, 'Over 75% of model bricks are grounded without support pillars');
  assert(result.stats.totalConnections > 0, 'Mechanical connections formed between bricks');

  // Verify LDraw lines format
  const ldrawLines = result.ldrawCode.split('\n').filter(l => l.startsWith('1 '));
  assert(ldrawLines.length === result.bricks.length, 'Every placed brick generates an authentic LDraw line');
  assert(ldrawLines[0].includes('0x22563EB'), 'Direct 24-bit RGB (0x2RRGGBB) format verified in LDraw line');

  // Check variety of placed parts (modern, bionicle, standard)
  const uniquePartIds = new Set(result.bricks.map(b => b.partId));
  console.log(`Unique part types utilized: ${Array.from(uniquePartIds).join(', ')}`);
  assert(uniquePartIds.size >= 3, `Diverse parts utilized (got ${uniquePartIds.size} distinct part types)`);

  // Run Solver in Size-Descent mode with fresh lattice
  console.log('\n[Running Size-Descent Solver]');
  const sdLattice = createSyntheticDomeLattice();
  const sizeDescentSolver = new GrowingSurfaceKernelSolver(sdLattice, {
    dispatchStrategy: 'size_descent',
    enableVoxelRecompute: true
  });
  const sdResult = await sizeDescentSolver.solve();
  console.log(`Size-descent placed ${sdResult.bricks.length} bricks with ${sdResult.stats.groundedBricks}/${sdResult.stats.totalBricks} grounded.`);
  assert(sdResult.bricks.length > 0, 'Size-descent solver completed successfully');
  assert(sdResult.stats.groundedBricks > 0, 'Size-descent model has grounded bricks');

  console.log('\nALL PHASE 3 SOLVER TESTS PASSED SUCCESSFULLY!');
}

runSolverTest().catch((err) => {
  console.error('Solver test failed:', err);
  process.exit(1);
});
