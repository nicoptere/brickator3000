import { PlateLattice3D } from '../core/PlateLattice3D';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runRedesignVerificationTests() {
  console.log('=== Running Comprehensive Discretizer Redesign Verification Tests ===\n');

  // =========================================================================
  // Test 1: Maximal Rectangle Decomposition & Prevention of Atomic 1x1 Bricks
  // =========================================================================
  console.log('[Test 1: Maximal Rectangle Decomposition & Brick Packing on Solid Volume]');
  // Create a 12 x 12 x 4 solid volume in brick mode
  const solidLattice = new PlateLattice3D(14, 14, 10);
  solidLattice.verticalUnit = 'brick';
  for (let y = 0; y < 4; y++) {
    for (let z = 1; z <= 12; z++) {
      for (let x = 1; x <= 12; x++) {
        // Vertical walls on exterior, interior flat
        solidLattice.setVoxel(x, z, y, 0x2563eb, [0, y === 3 ? 1 : 0, 0], 1);
      }
    }
  }
  solidLattice.computeDistanceTransform();

  const solver1 = new GrowingSurfaceKernelSolver(solidLattice, {
    dispatchStrategy: 'size_descent',
    enableSlopes: false,
    enableStudlessTiles: false, // test pure brick packing first
    enableVoxelRecompute: true
  });

  const res1 = await solver1.solve();
  console.log(`Placed ${res1.bricks.length} bricks in solid 12x12x4 block.`);

  const largeBricks = res1.bricks.filter(b => b.size[0] * b.size[1] >= 4);
  const atomic1x1Bricks = res1.bricks.filter(b => b.size[0] === 1 && b.size[1] === 1);
  const largeRatio = (largeBricks.length / res1.bricks.length) * 100;
  const atomicRatio = (atomic1x1Bricks.length / res1.bricks.length) * 100;

  console.log(`Large bricks (>= 4 studs): ${largeBricks.length} (${largeRatio.toFixed(1)}%)`);
  console.log(`Atomic 1x1 bricks: ${atomic1x1Bricks.length} (${atomicRatio.toFixed(1)}%)`);

  assert(largeRatio >= 85, `Large bricks dominate the layout (got ${largeRatio.toFixed(1)}% >= 85%)`);
  assert(atomicRatio <= 5, `Atomic 1x1 bricks strictly discouraged (got ${atomicRatio.toFixed(1)}% <= 5%)`);
  assert(res1.stats.is100PercentGrounded, 'All placed bricks are 100% physically grounded');

  // Verify layer-to-layer running bond / orientation alternation
  const layer0Bricks = res1.bricks.filter(b => b.gridPos[2] === 0);
  const layer1Bricks = res1.bricks.filter(b => b.gridPos[2] === 1);
  const layer0XMajor = layer0Bricks.filter(b => b.size[0] > b.size[1]).length;
  const layer1ZMajor = layer1Bricks.filter(b => b.size[1] > b.size[0]).length;
  console.log(`Layer 0 X-major bricks: ${layer0XMajor}/${layer0Bricks.length}`);
  console.log(`Layer 1 Z-major bricks: ${layer1ZMajor}/${layer1Bricks.length}`);
  assert(layer0XMajor > layer0Bricks.length / 2, 'Layer 0 is predominantly X-major');
  assert(layer1ZMajor > layer1Bricks.length / 2, 'Layer 1 is predominantly Z-major (staggered running bond)');

  // =========================================================================
  // Test 2: Complete Studless Flat Tile Coverage on Exposed Top Surfaces
  // =========================================================================
  console.log('\n[Test 2: Complete Studless Top Tile Coverage]');
  const tileLattice = new PlateLattice3D(14, 14, 10);
  tileLattice.verticalUnit = 'brick';
  for (let y = 0; y < 3; y++) {
    for (let z = 2; z <= 10; z++) {
      for (let x = 2; x <= 10; x++) {
        tileLattice.setVoxel(x, z, y, 0xef4444, [0, y === 2 ? 1 : 0, 0], 1);
      }
    }
  }
  tileLattice.computeDistanceTransform();

  const solver2 = new GrowingSurfaceKernelSolver(tileLattice, {
    dispatchStrategy: 'size_descent',
    enableSlopes: false,
    enableStudlessTiles: true, // test studless top tiles!
    enableVoxelRecompute: true
  });

  const res2 = await solver2.solve();
  const placedTiles = res2.bricks.filter(b => b.category === 'TILE_FLAT');
  console.log(`Placed ${placedTiles.length} flat tiles on top of the model.`);
  assert(placedTiles.length > 0, 'Smooth flat tiles are actively placed on top of the model');

  // Verify tile part types used
  const tilePartIds = new Set(placedTiles.map(t => t.partId));
  console.log(`Tile part types utilized: ${Array.from(tilePartIds).join(', ')}`);
  assert(tilePartIds.has('3068b') || tilePartIds.has('2431') || tilePartIds.has('3069b') || tilePartIds.has('98138'),
    'Authentic flat tile parts (3068b, 2431, 3069b, 98138) utilized');

  // Verify that all exposed top studs of the bricks are covered by tiles
  const brickOccupied = new Set<string>();
  for (const b of res2.bricks) {
    for (let dy = 0; dy < b.size[2]; dy++) {
      for (let dz = 0; dz < b.size[1]; dz++) {
        for (let dx = 0; dx < b.size[0]; dx++) {
          brickOccupied.add(`${b.gridPos[0] + dx},${b.gridPos[1] + dz},${b.gridPos[2] + dy}`);
        }
      }
    }
  }

  // Find any uncovered exposed studs on top of standard bricks
  let uncoveredTopStuds = 0;
  for (const b of res2.bricks) {
    if (b.category !== 'BRICK_STANDARD') continue;
    const topY = b.gridPos[2] + b.size[2];
    for (let dz = 0; dz < b.size[1]; dz++) {
      for (let dx = 0; dx < b.size[0]; dx++) {
        const gx = b.gridPos[0] + dx;
        const gz = b.gridPos[1] + dz;
        if (!brickOccupied.has(`${gx},${gz},${topY}`)) {
          uncoveredTopStuds++;
        }
      }
    }
  }
  console.log(`Uncovered top studs remaining: ${uncoveredTopStuds}`);
  assert(uncoveredTopStuds === 0, '100% of exposed top studs are covered with smooth flat tiles (studless finish)');

  // =========================================================================
  // Test 3: Active Slope and Wedge Selection on Angled Facets
  // =========================================================================
  console.log('\n[Test 3: Active Slope and Wedge Utilization on Angled Surface Contours]');
  // Create an angled roof / pyramid ramp lattice (45° and curved slopes)
  const roofLattice = new PlateLattice3D(12, 12, 10);
  roofLattice.verticalUnit = 'brick';
  for (let y = 0; y < 5; y++) {
    const margin = y;
    for (let z = margin; z < 10 - margin; z++) {
      for (let x = margin; x < 10 - margin; x++) {
        // Angled normals facing outward and upward (45 deg)
        let nx = 0, nz = 0;
        if (x === margin) nx = -1;
        else if (x === 9 - margin) nx = 1;
        if (z === margin) nz = -1;
        else if (z === 9 - margin) nz = 1;
        const hLen = Math.hypot(nx, nz) || 1;
        const norm: [number, number, number] = [
          (nx / hLen) * 0.707,
          0.707,
          (nz / hLen) * 0.707
        ];
        roofLattice.setVoxel(x, z, y, 0x10b981, norm, 1);
      }
    }
  }
  roofLattice.computeDistanceTransform();

  const solver3 = new GrowingSurfaceKernelSolver(roofLattice, {
    dispatchStrategy: 'size_descent',
    enableSlopes: true,
    enableCurvedSlopes: true,
    enableStudlessTiles: true,
    enableVoxelRecompute: true
  });

  const res3 = await solver3.solve();
  const placedSlopes = res3.bricks.filter(
    b =>
      b.category === 'SLOPE_CURVED' ||
      b.category === 'SLOPE_45' ||
      b.category === 'CHEESE_SLOPE' ||
      b.category === 'WEDGE_PLATE'
  );
  console.log(`Placed ${placedSlopes.length} slopes/wedges on angled roof contours.`);
  assert(placedSlopes.length > 0, 'Slopes and wedges are actively selected and placed on angled boundary facets');

  const slopePartTypes = new Set(placedSlopes.map(s => s.partId));
  console.log(`Slope part types utilized: ${Array.from(slopePartTypes).join(', ')}`);
  assert(
    slopePartTypes.has('11477') ||
    slopePartTypes.has('15068') ||
    slopePartTypes.has('3040') ||
    slopePartTypes.has('3039') ||
    slopePartTypes.has('54200') ||
    slopePartTypes.has('61678') ||
    slopePartTypes.has('88930'),
    'Modern curved slopes and 45° slopes utilized'
  );

  // =========================================================================
  // Test 4: Canister Strictness (Zero Canisters on Flat Surfaces, Only on Poles)
  // =========================================================================
  console.log('\n[Test 4: Canister Strictness - Zero Canisters on Flat Tops]');
  // Check res1 and res2 (flat solid blocks): ZERO canisters should be placed!
  const flatBlockCanisters1 = res1.bricks.filter(b => b.category === 'ROUND_CANISTER');
  const flatBlockCanisters2 = res2.bricks.filter(b => b.category === 'ROUND_CANISTER');
  console.log(`Canisters placed on solid block 1: ${flatBlockCanisters1.length}`);
  console.log(`Canisters placed on solid block 2: ${flatBlockCanisters2.length}`);
  assert(flatBlockCanisters1.length === 0, 'Zero canisters placed on flat surfaces / solid blocks in Test 1');
  assert(flatBlockCanisters2.length === 0, 'Zero canisters placed on flat surfaces / solid blocks in Test 2');

  // Now create a scene with an authentic isolated vertical pole (mast)
  console.log('[Test 4B: Canisters Placed on Actual Isolated Vertical Pole Shaft]');
  const poleLattice = new PlateLattice3D(10, 10, 8);
  poleLattice.verticalUnit = 'brick';
  // 1x1 vertical column at (4, 4) spanning y = 0 to 3, surrounded by empty air
  for (let y = 0; y < 4; y++) {
    poleLattice.setVoxel(4, 4, y, 0xf59e0b, [0, 0, 0], 1);
  }
  poleLattice.computeDistanceTransform();

  const solver4 = new GrowingSurfaceKernelSolver(poleLattice, {
    dispatchStrategy: 'size_descent',
    enableCanisters: true,
    enableStudlessTiles: false,
    enableVoxelRecompute: true
  });

  const res4 = await solver4.solve();
  const poleCanisters = res4.bricks.filter(b => b.category === 'ROUND_CANISTER');
  console.log(`Canisters placed on isolated vertical pole: ${poleCanisters.length}`);
  assert(poleCanisters.length > 0, 'Canisters (3062b) successfully utilized on authentic isolated vertical pole shafts');

  console.log('\nALL REDESIGN VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runRedesignVerificationTests().catch(err => {
  console.error('Redesign verification tests failed:', err);
  process.exit(1);
});
