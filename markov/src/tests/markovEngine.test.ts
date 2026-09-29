/**
 * Verification Tests for Markov Growing Core Discretization Engine.
 */

import * as THREE from 'three';
import { MeshVoxelizer } from '../engine/meshVoxelizer';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { CONNECTOR_DATABASE } from '../engine/connectorDatabase';
import { LDrawExporter } from '../engine/ldrawExporter';
import { MultiResolutionLattice } from '../engine/multiResolutionLattice';

export function runTests(): void {
  console.log('=== RUNNING MARKOV GROWING CORE ENGINE TESTS ===\n');

  // Test 1: Connector Database
  console.log('Test 1: Validating Connector Database...');
  const allConnectors = Array.from(CONNECTOR_DATABASE.connectors.values());
  console.log(`  Total connectors: ${allConnectors.length}`);
  const fillParts = CONNECTOR_DATABASE.getByCategory('FILL');
  const edgeParts = CONNECTOR_DATABASE.getByCategory('EDGE');
  const leafParts = CONNECTOR_DATABASE.getByCategory('LEAF');
  console.log(`  FILL parts: ${fillParts.length}, EDGE parts: ${edgeParts.length}, LEAF parts: ${leafParts.length}`);
  if (fillParts.length === 0 || edgeParts.length === 0 || leafParts.length === 0) {
    throw new Error('Connector database must contain FILL, EDGE, and LEAF parts');
  }
  console.log('  -> PASS\n');

  // Test 2: Voxelization & Distance Transform
  console.log('Test 2: Validating Voxelization & Core Depth Field...');
  const geom = MeshVoxelizer.createSampleGeometry('duck');
  const grid = MeshVoxelizer.voxelizeGeometry(geom, { targetHeightPlates: 21 });
  console.log(`  Grid dimensions: ${grid.numStudsX} x ${grid.numStudsZ} x ${grid.numPlatesY}`);
  console.log(`  Total occupied voxels: ${grid.totalOccupied}`);
  console.log(`  Max Core Depth: ${grid.maxCoreDepth}`);
  console.log(`  Core Centroid: [${grid.coreCentroid.join(', ')}]`);
  if (grid.totalOccupied === 0) {
    throw new Error('Voxel grid has 0 occupied voxels');
  }
  if (grid.maxCoreDepth < 2) {
    throw new Error('Core depth field should be >= 2 for solid volume');
  }
  console.log('  -> PASS\n');

  // Test 3: Markov Core Growing Simulation
  console.log('Test 3: Testing Markov Core Growing Execution...');
  const engine = new MarkovCoreGrowingEngine(grid, {
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: true,
    directRGBSampling: true
  });

  // Step 1: Seed
  const step1 = engine.step();
  console.log(`  Step 1 Result: phase=${step1.phase}, placedBricks=${step1.totalPlacedBricks}`);
  if (!step1.newBrick) {
    throw new Error('Step 1 should plant seed brick');
  }
  console.log(`  Seed brick: ${step1.newBrick.name} (${step1.newBrick.partId}) at [${step1.newBrick.gridPos.join(', ')}]`);

  // Run 50 steps
  for (let i = 0; i < 50; i++) {
    engine.step();
    if (engine.currentPhase === 'DONE') break;
  }
  console.log(`  After 50 steps: total placed bricks = ${engine.placedBricks.size}`);
  console.log(`  BOM: FILL=${engine.bomStats.fillCount}, EDGE=${engine.bomStats.edgeCount}, LEAF=${engine.bomStats.leafCount}, unique parts=${engine.bomStats.uniqueParts.size}`);
  if (engine.placedBricks.size < 5) {
    throw new Error('Engine should have placed bricks');
  }
  console.log('  -> PASS\n');

  // Test 4: Complete Solve & LDraw Export
  console.log('Test 4: Testing Complete Solve & LDraw Export...');
  const fullResult = engine.solveAll(2000);
  console.log(`  Solved in ${engine.stepIndex} steps`);
  console.log(`  Total bricks: ${fullResult.totalPlacedBricks}`);
  console.log(`  Voxel coverage: ${(fullResult.coverageRatio * 100).toFixed(1)}%`);
  console.log(`  Unique parts utilized: ${fullResult.bomStats.uniquePartCount}`);

  const bricksList = Array.from(engine.placedBricks.values());
  const ldrContent = LDrawExporter.exportToLDraw(bricksList, 'Test_Duck_Model', true);
  console.log(`  Generated LDraw file (${ldrContent.split('\n').length} lines)`);
  if (!ldrContent.includes('0 FILE') || !ldrContent.includes('0x2')) {
    throw new Error('LDraw export should contain header and 0x2 hex colors');
  }
  console.log('  Sample LDraw line:');
  const sampleLine = ldrContent.split('\n').find(l => l.startsWith('1 0x2'));
  console.log(`    ${sampleLine}`);
  console.log('  -> PASS\n');

  console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

// Run if in node/tsx
if (typeof process !== 'undefined') {
  runTests();
}
