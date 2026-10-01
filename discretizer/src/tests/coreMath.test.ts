import { PlateLattice3D } from '../core/PlateLattice3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { PlacedBrick, ConnectorSite } from '../core/types';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASSED: ${msg}`);
}

async function runTestSuite() {
  console.log('--- Phase 1: Core Mathematical Structures & Unit Tests ---\n');

  // ==========================================
  // Test 1: PlateLattice3D and Distance Transform
  // ==========================================
  console.log('[Test Group 1: PlateLattice3D]');
  const lattice = new PlateLattice3D(10, 10, 12);
  assert(lattice.totalCells === 1200, 'Lattice cell count matches dimensions');

  // Fill a 4x4x6 solid block at [2..5] x [2..5] x [1..6]
  for (let y = 1; y <= 6; y++) {
    for (let z = 2; z <= 5; z++) {
      for (let x = 2; x <= 5; x++) {
        lattice.setVoxel(x, z, y, 0x2563eb, [0, 1, 0], 1);
      }
    }
  }

  assert(lattice.totalOccupied === 4 * 4 * 6, `Total occupied count is ${4 * 4 * 6}`);
  assert(lattice.isOccupied(2, 2, 1), 'Corner voxel is occupied');
  assert(!lattice.isOccupied(0, 0, 0), 'Empty voxel is not occupied');

  // Run distance transform
  lattice.computeDistanceTransform();
  // Outer boundary voxel should have depth 0
  assert(lattice.getDepth(2, 2, 1) === 0, 'Outer boundary voxel has depth 0');
  // Internal voxel (e.g. x=3, z=3, y=3) should have depth >= 1
  assert(lattice.getDepth(3, 3, 3) >= 1, `Internal voxel has depth >= 1 (got ${lattice.getDepth(3, 3, 3)})`);

  // LDraw coordinate conversion
  const [lx, ly, lz] = lattice.gridToLDraw(0, 0, 0, 2, 4, 3);
  assert(typeof lx === 'number' && typeof ly === 'number' && typeof lz === 'number', 'LDraw coordinates compute successfully');

  // ==========================================
  // Test 2: IntegralVolume3D Prefix Sum vs. Brute Force
  // ==========================================
  console.log('\n[Test Group 2: IntegralVolume3D O(1) Queries]');
  const integral = new IntegralVolume3D(10, 10, 12);
  integral.build(lattice);

  // Compare 50 random box queries against brute-force summation
  let matches = 0;
  for (let i = 0; i < 50; i++) {
    const x0 = Math.floor(Math.random() * 10);
    const x1 = x0 + Math.floor(Math.random() * (10 - x0));
    const z0 = Math.floor(Math.random() * 10);
    const z1 = z0 + Math.floor(Math.random() * (10 - z0));
    const y0 = Math.floor(Math.random() * 12);
    const y1 = y0 + Math.floor(Math.random() * (12 - y0));

    const fastSum = integral.queryBox(x0, z0, y0, x1, z1, y1);

    // Brute force
    let bruteSum = 0;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (lattice.isOccupied(x, z, y)) bruteSum++;
        }
      }
    }

    if (fastSum === bruteSum) matches++;
  }
  assert(matches === 50, 'All 50 random IntegralVolume3D queries match brute-force ground truth exactly');

  // Test full bounding box query
  const fullSolidSum = integral.queryBox(2, 2, 1, 5, 5, 6);
  assert(fullSolidSum === 4 * 4 * 6, `Full solid block query equals volume (${fullSolidSum})`);
  assert(integral.queryDensity(2, 2, 1, 5, 5, 6) === 1.0, 'Solid region has 1.0 density');

  // ==========================================
  // Test 3: LegoBitset3D 64-bit Dynamic Claiming
  // ==========================================
  console.log('\n[Test Group 3: LegoBitset3D Collision & Claims]');
  const bitset = new LegoBitset3D(10, 10, 12);
  bitset.initializeFromLattice(lattice.getOccupancyBuffer());

  assert(bitset.isRegionAvailable(2, 2, 1, 2, 2, 3), 'Unclaimed solid region is available');
  assert(!bitset.isRegionAvailable(0, 0, 0, 2, 2, 3), 'Air region is not available');

  // Claim a 2x2x3 brick at (2, 2, 1)
  bitset.claimRegion(2, 2, 1, 2, 2, 3, 'brick_001');
  assert(!bitset.isRegionAvailable(2, 2, 1, 2, 2, 3), 'Claimed region is no longer available');
  assert(bitset.getCellOwner(2, 2, 1) === 'brick_001', 'Cell owner matches placed brick instance');

  // Release region
  bitset.releaseRegion(2, 2, 1, 2, 2, 3);
  assert(bitset.isRegionAvailable(2, 2, 1, 2, 2, 3), 'Released region is available again');

  // ==========================================
  // Test 4: AssemblyGraph3D Mechanics & Grounding
  // ==========================================
  console.log('\n[Test Group 4: AssemblyGraph3D Mechanics & Grounding]');
  const graph = new AssemblyGraph3D();

  // Helper to generate connectors for a 2x2 standard brick (3 plates high)
  const make2x2Connectors = (): ConnectorSite[] => {
    const conns: ConnectorSite[] = [];
    // Top studs (y = 3, facing +Y, MALE)
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        conns.push({
          localPos: [x, z, 3],
          direction: [0, 0, 1],
          polarity: 'MALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
    // Bottom tubes (y = 0, facing -Y, FEMALE)
    for (let x = 0; x < 2; x++) {
      for (let z = 0; z < 2; z++) {
        conns.push({
          localPos: [x, z, 0],
          direction: [0, 0, -1],
          polarity: 'FEMALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
    return conns;
  };

  // Base brick resting on ground plane y = 0
  const baseBrick: PlacedBrick = {
    instanceId: 'base_brick',
    partId: '3004',
    name: 'Brick 2 x 2',
    gridPos: [2, 2, 0],
    baseSize: [2, 2, 3],
    size: [2, 2, 3],
    rotation: 0,
    colorHex: '#2563eb',
    colorPacked: 0x2563eb,
    ldrawPos: [0, 0, 0],
    ldrawMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    category: 'CORE_INFILL',
    connectors: make2x2Connectors()
  };

  graph.addBrick(baseBrick);
  assert(graph.isGrounded('base_brick'), 'Base brick at Y=0 is grounded');

  // Stacked brick directly on top at y = 3
  const stackedBrick: PlacedBrick = {
    instanceId: 'stacked_brick',
    partId: '3004',
    name: 'Brick 2 x 2',
    gridPos: [2, 2, 3],
    baseSize: [2, 2, 3],
    size: [2, 2, 3],
    rotation: 0,
    colorHex: '#2563eb',
    colorPacked: 0x2563eb,
    ldrawPos: [0, -24, 0],
    ldrawMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    category: 'CORE_INFILL',
    connectors: make2x2Connectors()
  };

  const edges = graph.addBrick(stackedBrick);
  assert(edges.length === 4, `Stacked 2x2 brick forms 4 mechanical stud/tube connections (got ${edges.length})`);
  assert(graph.isGrounded('stacked_brick'), 'Stacked brick inherits physical grounding from base brick');

  // Floating brick in mid-air at (6, 6, 6)
  const floatingBrick: PlacedBrick = {
    instanceId: 'floating_brick',
    partId: '3004',
    name: 'Brick 2 x 2',
    gridPos: [6, 6, 6],
    baseSize: [2, 2, 3],
    size: [2, 2, 3],
    rotation: 0,
    colorHex: '#2563eb',
    colorPacked: 0x2563eb,
    ldrawPos: [80, -48, 80],
    ldrawMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    category: 'CORE_INFILL',
    connectors: make2x2Connectors()
  };

  graph.addBrick(floatingBrick);
  assert(!graph.isGrounded('floating_brick'), 'Disconnected brick in mid-air is detected as floating (NOT grounded)');

  const stats = graph.getStats();
  assert(stats.totalBricks === 3, 'Graph has 3 total bricks');
  assert(stats.groundedBricks === 2, 'Graph has 2 grounded bricks');
  assert(stats.floatingBricks === 1, 'Graph correctly identifies 1 floating brick');
  assert(!stats.is100PercentGrounded, 'is100PercentGrounded correctly returns false when floating bricks exist');

  // Seam interlock test: stacked vs staggered
  // Exactly stacked seam at (2, 2, 6)
  const stackedScore = graph.evaluateSeamInterlock(2, 2, 6, 2, 2, 3);
  // Staggered seam shifted by 1 stud at (3, 2, 6)
  const staggeredScore = graph.evaluateSeamInterlock(3, 2, 6, 2, 2, 3);
  assert(staggeredScore > stackedScore, `Staggered running bond score (${staggeredScore}) > Stacked seam score (${stackedScore})`);

  console.log('\nALL PHASE 1 UNIT TESTS PASSED SUCCESSFULLY!');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
