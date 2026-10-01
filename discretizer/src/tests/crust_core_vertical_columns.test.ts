import { PlateLattice3D } from '../core/PlateLattice3D';
import { GrowingSurfaceKernelSolver } from '../solver/kernelSolver';
import { createCurvatureFeatureOverlay, computeLatticeCurvatureGradient } from '../core/meshCurvature';
import * as THREE from 'three';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runCrustCoreAndVerticalColumnTests() {
  console.log('=== Running Crust vs Core & Vertical Column Verification Tests ===\n');

  // =========================================================================
  // Test 1: Crust vs Core Disambiguation (No cosmetic slopes in core depth >= 2)
  // =========================================================================
  console.log('[Test 1: Core Voxels (Depth >= 2) Contain Large Structural Bricks, Zero Slopes]');

  // Create a 16x16 solid cube with height 12 plates (verticalUnit = 'stud')
  const lattice = new PlateLattice3D(20, 20, 16);
  lattice.verticalUnit = 'stud';

  for (let y = 0; y < 12; y++) {
    for (let z = 2; z <= 17; z++) {
      for (let x = 2; x <= 17; x++) {
        // Angled normal on top boundary, horizontal on sides
        const ny = y >= 10 ? 0.7 : 0;
        lattice.setVoxel(x, z, y, 0x2563eb, [0, ny, 0], 1);
      }
    }
  }
  lattice.computeDistanceTransform();

  // Verify distance transform created depth >= 2 core voxels
  const centerDepth = lattice.getDepth(9, 9, 5);
  console.log(`Center voxel (9, 9, 5) depth: ${centerDepth}`);
  assert(centerDepth >= 2, 'Center of solid volume has depth >= 2 (Core)');

  // Snapshot initial depths before solve
  const initialDepth = new Map<string, number>();
  for (let y = 0; y < 12; y++) {
    for (let z = 2; z <= 17; z++) {
      for (let x = 2; x <= 17; x++) {
        initialDepth.set(`${x},${z},${y}`, lattice.getDepth(x, z, y));
      }
    }
  }

  const solver = new GrowingSurfaceKernelSolver(lattice, {
    dispatchStrategy: 'tiered',
    enableSlopes: true,
    enableCurvedSlopes: true,
    enableStudlessTiles: true,
    enableVoxelRecompute: true
  });

  const res = await solver.solve();
  console.log(`Total placed elements: ${res.bricks.length}`);

  // Check that NO slope or wedge was placed inside the core (all cells of slopes must have depth <= 1)
  const slopes = res.bricks.filter(
    b => b.category === 'SLOPE_CURVED' || b.category === 'SLOPE_45' || b.category === 'CHEESE_SLOPE' || b.category === 'WEDGE_PLATE'
  );
  console.log(`Cosmetic slopes/wedges placed on exterior crust: ${slopes.length}`);

  for (const s of slopes) {
    const [sx, sz, sy] = s.gridPos;
    const [sw, sd, sh] = s.size;
    for (let dy = 0; dy < sh; dy++) {
      for (let dz = 0; dz < sd; dz++) {
        for (let dx = 0; dx < sw; dx++) {
          if (s.occupancyMask?.[dy]?.[dz]?.[dx]) {
            const d = initialDepth.get(`${sx + dx},${sz + dz},${sy + dy}`) ?? 0;
            assert(d <= 1, `Cosmetic slope cell (${sx + dx}, ${sz + dz}, ${sy + dy}) is strictly on the crust (depth got ${d} <= 1)`);
          }
        }
      }
    }
  }
  assert(true, 'Zero cosmetic slopes penetrate into the structural core (depth >= 2)');

  // Verify that core voxels are filled with full-height bricks (h=3)
  const coreBricks = res.bricks.filter(b => {
    const [bx, bz, by] = b.gridPos;
    const d = initialDepth.get(`${bx},${bz},${by}`) ?? 0;
    return d >= 2;
  });
  console.log(`Bricks placed in core: ${coreBricks.length}`);
  const platesInCore = coreBricks.filter(b => b.size[2] === 1);
  console.log(`Plates with h=1 in core: ${platesInCore.length}`);
  assert(coreBricks.length > 0, 'Core is populated with structural bricks');
  assert(platesInCore.length === 0, 'Zero thin 1-plate slices placed in interior core (all core elements have h=3 full height)');

  // =========================================================================
  // Test 2: Vertical Column Discretization (Full-Height Bricks & 2453b Tall Brick)
  // =========================================================================
  console.log('\n[Test 2: Vertical Columns Discretized with Full-Height Bricks]');

  // Create an isolated vertical column (like the propeller / column) of 15 plates tall
  const columnLattice = new PlateLattice3D(10, 10, 20);
  columnLattice.verticalUnit = 'stud';

  // 1x1 column from y=0 to y=14 (15 plates continuous height)
  for (let y = 0; y < 15; y++) {
    columnLattice.setVoxel(5, 5, y, 0x111111, [1, 0, 0], 1);
  }
  // 1x2 column from y=0 to y=8 (9 plates continuous height)
  for (let y = 0; y < 9; y++) {
    columnLattice.setVoxel(2, 2, y, 0x111111, [0, 0, 1], 1);
    columnLattice.setVoxel(2, 3, y, 0x111111, [0, 0, 1], 1);
  }
  columnLattice.computeDistanceTransform();

  const columnSolver = new GrowingSurfaceKernelSolver(columnLattice, {
    dispatchStrategy: 'tiered',
    enableSlopes: false,
    enableStudlessTiles: false,
    enableVoxelRecompute: true
  });

  const columnRes = await columnSolver.solve();
  console.log(`Placed ${columnRes.bricks.length} bricks in vertical columns.`);

  // Check the 1x1 column at (5, 5):
  const colBricks1x1 = columnRes.bricks.filter(b => b.gridPos[0] === 5 && b.gridPos[1] === 5);
  console.log(`1x1 column bricks: ${colBricks1x1.length}, part IDs: ${colBricks1x1.map(b => b.partId).join(', ')}`);

  // It should be 1 tall brick 2453b (height 15) or standard bricks (h=3), NEVER 15 stacked 1-plates!
  const col1x1Plates = colBricks1x1.filter(b => b.size[2] === 1);
  assert(col1x1Plates.length === 0, 'Zero 1-plate slices in 15-plate vertical column');
  assert(colBricks1x1.some(b => b.partId === '2453b' || b.size[2] === 3), 'Column built with authentic full-height bricks (2453b or h=3)');

  // Check the 1x2 column at (2, 2)-(2, 3):
  const colBricks1x2 = columnRes.bricks.filter(b => b.gridPos[0] === 2 && (b.gridPos[1] === 2 || b.gridPos[1] === 3));
  console.log(`1x2 column bricks: ${colBricks1x2.length}, part IDs: ${colBricks1x2.map(b => b.partId).join(', ')}`);
  const col1x2Plates = colBricks1x2.filter(b => b.size[2] === 1);
  assert(col1x2Plates.length === 0, 'Zero 1-plate slices in 9-plate vertical column (built with h=3 bricks)');

  // =========================================================================
  // Test 3: Mesh Curvature Overlay & Feature Line Generation
  // =========================================================================
  console.log('\n[Test 3: Mesh Curvature Overlay Generation]');
  const testBox = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
  const overlay = createCurvatureFeatureOverlay(testBox);
  assert(overlay.children.length > 0, 'Feature line overlay generated children');
  const lineSegments = overlay.children[0] as THREE.LineSegments;
  assert(lineSegments.isLineSegments, 'Generated LineSegments overlay');
  assert(lineSegments.geometry.attributes.position.count > 0, 'Feature lines have non-zero vertex count');

  // Verify curvature gradient helper
  const grad = computeLatticeCurvatureGradient(lattice, 5, 5, 2);
  assert(grad.principalAxis === 'X' || grad.principalAxis === 'Z', 'Curvature gradient returns principal axis');

  console.log('\nALL CRUST VS CORE & VERTICAL COLUMN TESTS PASSED SUCCESSFULLY!');
}

runCrustCoreAndVerticalColumnTests();
