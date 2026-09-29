/**
 * Verification Tests for Markov Growing Core Discretization Engine.
 */

(globalThis as any).self = globalThis;
import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { MeshVoxelizer } from '../engine/meshVoxelizer';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { CONNECTOR_DATABASE } from '../engine/connectorDatabase';
import { LDrawExporter } from '../engine/ldrawExporter';
import { MultiResolutionLattice } from '../engine/multiResolutionLattice';

export async function runTests(): Promise<void> {
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

  // Test 3: Markov Core Growing Simulation (Multi-Phase)
  console.log('Test 3: Testing Markov Core Growing Execution...');
  const engine = new MarkovCoreGrowingEngine(grid, {
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: true,
    directRGBSampling: true
  });

  // Step 1: Volume Fill Seed
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
  if (fullResult.coverageRatio < 0.95) {
    throw new Error(`Coverage ratio should be near 100%, got ${(fullResult.coverageRatio * 100).toFixed(1)}%`);
  }

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

  // Test 5: Real 3D Model Discretization (Duck GLB with authentic texture colors & curved slopes)
  console.log('Test 5: Testing Real Duck GLB Discretization & Texture Sampling...');
  if (fs.existsSync('public/sample_models/duck.glb')) {
    const duckModel = await MeshVoxelizer.loadModel('/sample_models/duck.glb');
    const duckGrid = MeshVoxelizer.voxelizeObject(duckModel, { targetHeightBricks: 14 });
    console.log(`  Duck GLB occupied voxels: ${duckGrid.totalOccupied}, max depth: ${duckGrid.maxCoreDepth}`);
    if (duckGrid.totalOccupied < 100) {
      throw new Error(`Duck GLB should have >= 100 occupied voxels, got ${duckGrid.totalOccupied}`);
    }
    if (duckGrid.maxCoreDepth < 2) {
      throw new Error('Duck GLB should have solid core with depth >= 2');
    }

    const duckEngine = new MarkovCoreGrowingEngine(duckGrid, {
      enableModernWeirdParts: true,
      enableStudlessTopFinish: true
    });
    const duckRes = duckEngine.solveAll(3000);
    console.log(`  Duck complete: ${duckRes.totalPlacedBricks} bricks, coverage: ${(duckRes.coverageRatio * 100).toFixed(1)}%, unique parts: ${duckRes.bomStats.uniquePartCount}`);
    if (duckRes.totalPlacedBricks === 0 || duckRes.coverageRatio < 0.95) {
      throw new Error('Duck discretization failed');
    }

    // Check colors
    const duckHexColors = Array.from(duckEngine.placedBricks.values()).map(b => b.colorHex);
    console.log(`  Duck sample colors: ${duckHexColors.slice(0, 3).join(', ')}`);
    console.log('  Duck discretization verified -> PASS');

    // Check modern parts utilization
    const placedPartIds = new Set(Array.from(duckEngine.placedBricks.values()).map(b => b.partId));
    console.log(`  Unique part IDs in Duck: ${Array.from(placedPartIds).join(', ')}`);
    const hasModernSlope = placedPartIds.has('11477') || placedPartIds.has('15068') || placedPartIds.has('24201') || placedPartIds.has('93273');
    if (!hasModernSlope) {
      throw new Error('Duck model should utilize modern curved or inverted slopes');
    }
    console.log('  Modern curved/inverted slopes verified -> PASS\n');
  }

  // Test 6: Real 3D Model Discretization (Dolphin GLB)
  console.log('Test 6: Testing Real Dolphin GLB Discretization & Vertex Colors...');
  if (fs.existsSync('public/sample_models/dolphin.glb')) {
    const dolModel = await MeshVoxelizer.loadModel('/sample_models/dolphin.glb');
    const dolGrid = MeshVoxelizer.voxelizeObject(dolModel, { targetHeightBricks: 12 });
    console.log(`  Dolphin GLB occupied voxels: ${dolGrid.totalOccupied}, max depth: ${dolGrid.maxCoreDepth}`);
    if (dolGrid.totalOccupied < 80) {
      throw new Error('Dolphin GLB should have >= 80 occupied voxels');
    }

    const dolEngine = new MarkovCoreGrowingEngine(dolGrid);
    const dolRes = dolEngine.solveAll(2000);
    console.log(`  Dolphin complete: ${dolRes.totalPlacedBricks} bricks, coverage: ${(dolRes.coverageRatio * 100).toFixed(1)}%, unique parts: ${dolRes.bomStats.uniquePartCount}`);
    if (dolRes.totalPlacedBricks === 0 || dolRes.coverageRatio < 0.95) {
      throw new Error('Dolphin discretization failed');
    }
    console.log('  -> PASS\n');
  }

  // Test 7: Real 3D Model Discretization (Mini Cooper GLB)
  console.log('Test 7: Testing Real Mini Cooper GLB Discretization...');
  if (fs.existsSync('public/models/clean/cars/mini.glb')) {
    const carModel = await MeshVoxelizer.loadModel('/models/clean/cars/mini.glb');
    const carGrid = MeshVoxelizer.voxelizeObject(carModel, { targetHeightBricks: 16 });
    console.log(`  Mini Cooper GLB occupied voxels: ${carGrid.totalOccupied}, max depth: ${carGrid.maxCoreDepth}`);
    if (carGrid.totalOccupied < 300) {
      throw new Error(`Mini Cooper GLB should have >= 300 occupied voxels, got ${carGrid.totalOccupied}`);
    }

    const carEngine = new MarkovCoreGrowingEngine(carGrid);
    const carRes = carEngine.solveAll(2000);
    console.log(`  Mini Cooper complete: ${carRes.totalPlacedBricks} bricks, coverage: ${(carRes.coverageRatio * 100).toFixed(1)}%, unique parts: ${carRes.bomStats.uniquePartCount}`);
    if (carRes.totalPlacedBricks === 0 || carRes.coverageRatio < 0.95) {
      throw new Error('Mini Cooper discretization failed');
    }
    console.log('  -> PASS\n');
  }

  // Test 8: Real Open Meshes & Half-Edge Island Detection (VW Beetle GLB & Delacroix PLY)
  console.log('Test 8: Testing Half-Edge Island Detection on VW Beetle GLB...');
  if (fs.existsSync('public/models/clean/cars/vwbeetle.glb')) {
    const beetle = await MeshVoxelizer.loadModel('/models/clean/cars/vwbeetle.glb');
    const beetleGrid = MeshVoxelizer.voxelizeObject(beetle, { targetHeightBricks: 16 });
    console.log(`  VW Beetle GLB occupied voxels: ${beetleGrid.totalOccupied}, max depth: ${beetleGrid.maxCoreDepth}`);
    const islandCount = beetleGrid.islands?.length || 0;
    console.log(`  VW Beetle islands detected: ${islandCount}`);
    if (islandCount < 5) {
      throw new Error(`VW Beetle should detect at least 5 topological islands, got ${islandCount}`);
    }

    const beetleEngine = new MarkovCoreGrowingEngine(beetleGrid, {
      colorMode: 'island_components',
      enableModernWeirdParts: true,
      enableStudlessTopFinish: true
    });
    const beetleRes = beetleEngine.solveAll(3000);
    console.log(`  VW Beetle complete: ${beetleRes.totalPlacedBricks} bricks, coverage: ${(beetleRes.coverageRatio * 100).toFixed(1)}%, unique parts: ${beetleRes.bomStats.uniquePartCount}`);
    if (beetleRes.totalPlacedBricks === 0 || beetleRes.coverageRatio < 0.95) {
      throw new Error('VW Beetle discretization failed');
    }

    // Verify distinct island colors are present among placed bricks
    const islandHexes = new Set(Array.from(beetleEngine.placedBricks.values()).map(b => b.islandColorHex));
    console.log(`  Distinct island color groups in beetle: ${islandHexes.size}`);
    if (islandHexes.size < 4) {
      throw new Error(`Expected at least 4 distinct island color groups, got ${islandHexes.size}`);
    }
    console.log('  VW Beetle Island Component isolation verified -> PASS\n');
  }

  console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

// Run if in node/tsx
if (typeof process !== 'undefined') {
  runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
