/**
 * Multi-Head Markov Discretization & Backwards Optimization Engine.
 *
 * Implements the 4-phase LEGO discretization pipeline:
 * 1. FORWARD PASS (Watertight 1x1 Plate Voxel Volume):
 *    Fills the 3D model volume with unit 1x1 plates (3024) having true RGB colors sampled directly from the mesh.
 * 2. BACKWARDS OPTIMIZATION (Agglomerative Merging with Running Bond):
 *    Merges contiguous 1x1 plates of compatible color into larger structural bricks (2x4, 2x2, 1x4, 1x2...)
 *    and plates (2x8, 2x4, 1x4, 1x2...) while enforcing interlocking staggered seams.
 * 3. EXTERIOR SURFACE REPLACEMENT PASS:
 *    Evaluates boundary cells (normals, slope angle/heading, curvature) and replaces exterior blocks with
 *    authentic LDraw slopes (curved slopes 11477/15068/61678, inverted slopes 24201/93273, 45°/33° slopes),
 *    macaroni corner tiles (27925, 25269), radar dishes (4740), and Bionicle teeth/horns (53451, 41669).
 * 4. STUDLESS TOP FINISH PASS:
 *    Caps exposed horizontal top surfaces with smooth studless tiles (3068b, 3069b, 2431, 98138).
 */

import {
  VoxelGrid,
  VoxelCell,
  PlacedBrick,
  FrontierPoint,
  GrowthStepResult,
  MarkovEngineOptions,
  PieceCategory,
  PieceProfile,
  CurvatureClass,
  SlopeClass
} from './types';
import { CONNECTOR_DATABASE, LDrawConnectorMeta } from './connectorDatabase';
import { RotatedPieceVariant } from './pieceFingerprint';
import { LDU_STUD_PITCH, LDU_PLATE_HEIGHT } from './connectivityDictionary';

export interface GrowthHead {
  headId: number;
  name: string;
  colorHex: string;
  active: boolean;
  priorityY: number;
  placedCount: number;
}

export type DiscretizationPhase =
  | 'VOLUME_FILL'
  | 'OPTIMIZE_MERGE'
  | 'SURFACE_REPLACE'
  | 'TILE_FINISH'
  | 'DONE';

export class MarkovCoreGrowingEngine {
  public grid: VoxelGrid;
  public options: MarkovEngineOptions;

  public placedBricks: Map<string, PlacedBrick> = new Map();
  public occupiedCellToBrickId: Map<string, string> = new Map(); // "x,z,y" -> brickId
  public brickIdToPartId: Map<string, string> = new Map(); // brickId -> partId

  // Multi-Head Management
  public heads: GrowthHead[] = [];
  public activeFrontiersByHead: Map<number, FrontierPoint[]> = new Map();
  public fillFrontierQueue: Array<{ x: number; z: number; y: number; dist: number }> = [];

  public stepIndex: number = 0;
  public currentPhase: DiscretizationPhase = 'VOLUME_FILL';

  // Merge & replacement scan cursors for smooth step-by-step playback
  private mergeLayerCursor: number = 0;
  private surfaceCandidateCursor: number = 0;
  private surfaceCandidates: Array<{ x: number; z: number; y: number }> = [];
  private tileFinishCursor: number = 0;

  public bomStats = {
    leafCount: 0,
    edgeCount: 0,
    fillCount: 0,
    uniqueParts: new Set<string>()
  };

  private rng: () => number;

  constructor(grid: VoxelGrid, options: MarkovEngineOptions = {}) {
    this.grid = grid;
    const numHeads = Math.max(1, Math.min(16, options.numHeads ?? 4));

    this.options = {
      seedMode: options.seedMode ?? 'DEEPEST_CORE',
      staggerRunningBond: options.staggerRunningBond ?? true,
      enableModernWeirdParts: options.enableModernWeirdParts ?? true,
      enableStudlessTopFinish: options.enableStudlessTopFinish ?? true,
      directRGBSampling: options.directRGBSampling ?? true,
      randomSeed: options.randomSeed ?? 42,
      maxSteps: options.maxSteps ?? 5000,
      numHeads,
      batchStepSize: options.batchStepSize ?? 16
    };

    let s = this.options.randomSeed!;
    this.rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    this.initHeadsAndFrontier();
  }

  private cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  public isCellCovered(x: number, z: number, y: number): boolean {
    return this.occupiedCellToBrickId.has(this.cellKey(x, z, y));
  }

  /**
   * Initializes multi-head queues and orders volume fill queue by distance from core.
   */
  private initHeadsAndFrontier(): void {
    const numHeads = this.options.numHeads!;
    const headColors = [
      '#38bdf8', '#f59e0b', '#10b981', '#ec4899',
      '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'
    ];

    const { coreCentroid, numPlatesY, numStudsX, numStudsZ } = this.grid;
    const [cx, cz, cy] = coreCentroid;

    for (let i = 0; i < numHeads; i++) {
      this.heads.push({
        headId: i,
        name: `Head ${i + 1}`,
        colorHex: headColors[i % headColors.length],
        active: true,
        priorityY: i === 0 ? cy : (i === 1 ? 0 : Math.min(numPlatesY - 1, cy + i * 2)),
        placedCount: 0
      });
      this.activeFrontiersByHead.set(i, []);
    }

    // Build ordered queue of all occupied cells sorted outward from core centroid
    const allOccupied: Array<{ x: number; z: number; y: number; dist: number }> = [];
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = this.grid.grid[x][z][y];
          if (cell && cell.occupied) {
            const dx = x - cx;
            const dz = z - cz;
            const dy = (y - cy) * 0.5; // Bias horizontal expansion slightly
            const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
            allOccupied.push({ x, z, y, dist });
          }
        }
      }
    }

    // Sort outward: closest to core centroid first
    allOccupied.sort((a, b) => a.dist - b.dist);
    this.fillFrontierQueue = allOccupied;
  }

  /**
   * Checks if two hex colors are visually compatible for merging.
   */
  private areColorsCompatible(hex1: string, hex2: string, threshold: number = 28): boolean {
    if (hex1 === hex2) return true;
    const clean1 = hex1.replace('#', '');
    const clean2 = hex2.replace('#', '');
    const r1 = parseInt(clean1.substring(0, 2), 16) || 0;
    const g1 = parseInt(clean1.substring(2, 4), 16) || 0;
    const b1 = parseInt(clean1.substring(4, 6), 16) || 0;

    const r2 = parseInt(clean2.substring(0, 2), 16) || 0;
    const g2 = parseInt(clean2.substring(2, 4), 16) || 0;
    const b2 = parseInt(clean2.substring(4, 6), 16) || 0;

    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) <= threshold;
  }

  /**
   * Commits a placed brick into the model and updates spatial indexes and BOM.
   */
  private commitBrick(
    startX: number,
    startZ: number,
    startY: number,
    connector: LDrawConnectorMeta,
    variant: RotatedPieceVariant,
    phase: PlacedBrick['growthPhase'],
    headId: number = 0,
    forcedColorHex?: string
  ): PlacedBrick {
    const { numStudsX, numStudsZ } = this.grid;
    const brickId = `b_${this.stepIndex}_${connector.partId}_${startX}_${startY}_${startZ}`;

    // Sample dominant diffuse/vertex color
    let sumR = 0, sumG = 0, sumB = 0;
    let colorCode = 15;
    let colorHex = forcedColorHex || '#f4f4f4';
    let colorName = 'White';

    if (!forcedColorHex) {
      for (const c of variant.occupiedCells) {
        const cell = this.grid.grid[startX + c.dx]?.[startZ + c.dz]?.[startY + c.dy];
        if (cell) {
          colorCode = cell.colorCode;
          colorName = cell.colorName;
          const cleanHex = cell.colorHex.replace('#', '');
          sumR += parseInt(cleanHex.substring(0, 2), 16) || 200;
          sumG += parseInt(cleanHex.substring(2, 4), 16) || 200;
          sumB += parseInt(cleanHex.substring(4, 6), 16) || 200;
        }
      }

      if (variant.occupiedCells.length > 0) {
        const avgR = Math.round(sumR / variant.occupiedCells.length);
        const avgG = Math.round(sumG / variant.occupiedCells.length);
        const avgB = Math.round(sumB / variant.occupiedCells.length);
        colorHex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
      }
    }

    const ldrawX = (startX + variant.widthX / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH + connector.ldrawOffset[0];
    const ldrawZ = -((startZ + variant.depthZ / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH + connector.ldrawOffset[1]);
    const ldrawY = -(startY + variant.heightY) * LDU_PLATE_HEIGHT;

    const placed: PlacedBrick = {
      id: brickId,
      partId: connector.partId,
      name: connector.name,
      category: connector.category,
      profile: connector.profile,
      colorCode,
      colorHex,
      colorName,
      gridPos: [startX, startZ, startY],
      ldrawPos: [ldrawX, ldrawY, ldrawZ],
      rotation: variant.rotation,
      matrix: variant.matrix,
      size: [variant.widthX, variant.depthZ, variant.heightY],
      baseSize: [connector.footprint[0], connector.footprint[1], connector.footprint[2]],
      stepIndex: this.stepIndex,
      growthPhase: phase,
      clutchScore: 1.0,
      parentBrickIds: [],
      headId
    };

    this.placedBricks.set(brickId, placed);
    this.brickIdToPartId.set(brickId, connector.partId);

    // Register covered voxels
    for (const c of variant.occupiedCells) {
      const gx = startX + c.dx;
      const gz = startZ + c.dz;
      const gy = startY + c.dy;
      const key = this.cellKey(gx, gz, gy);
      this.occupiedCellToBrickId.set(key, brickId);

      const cell = this.grid.grid[gx]?.[gz]?.[gy];
      if (cell) {
        cell.assignedBrickId = brickId;
        cell.assignedCategory = connector.category;
      }
    }

    // Update BOM
    if (connector.category === 'LEAF') this.bomStats.leafCount++;
    else if (connector.category === 'EDGE') this.bomStats.edgeCount++;
    else if (connector.category === 'FILL') this.bomStats.fillCount++;
    this.bomStats.uniqueParts.add(connector.partId);

    if (this.heads[headId]) {
      this.heads[headId].placedCount++;
    }

    return placed;
  }

  /**
   * Removes a brick from the model and frees its voxels.
   */
  private removeBrick(brickId: string): PlacedBrick | null {
    const placed = this.placedBricks.get(brickId);
    if (!placed) return null;

    this.placedBricks.delete(brickId);
    this.brickIdToPartId.delete(brickId);

    // Free cell mappings
    const [startX, startZ, startY] = placed.gridPos;
    const [wX, wZ, hY] = placed.size;

    for (let dx = 0; dx < wX; dx++) {
      for (let dz = 0; dz < wZ; dz++) {
        for (let dy = 0; dy < hY; dy++) {
          const key = this.cellKey(startX + dx, startZ + dz, startY + dy);
          if (this.occupiedCellToBrickId.get(key) === brickId) {
            this.occupiedCellToBrickId.delete(key);
            const cell = this.grid.grid[startX + dx]?.[startZ + dz]?.[startY + dy];
            if (cell) {
              cell.assignedBrickId = undefined;
            }
          }
        }
      }
    }

    // Adjust BOM count
    if (placed.category === 'LEAF') this.bomStats.leafCount = Math.max(0, this.bomStats.leafCount - 1);
    else if (placed.category === 'EDGE') this.bomStats.edgeCount = Math.max(0, this.bomStats.edgeCount - 1);
    else if (placed.category === 'FILL') this.bomStats.fillCount = Math.max(0, this.bomStats.fillCount - 1);

    return placed;
  }

  /**
   * Phase 1: Forward Pass (Watertight 1x1 Plate Voxel Volume).
   * Places unit 1x1 plates (3024) across the solid volume.
   */
  private stepForwardVolumeFill(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const plate1x1 = CONNECTOR_DATABASE.getConnector('3024');
    if (!plate1x1) return newBricks;
    const variant = plate1x1.fingerprint.variants.get(0)!;

    const batchSize = Math.max(1, this.options.batchStepSize ?? 16);
    let placedInBatch = 0;

    while (this.fillFrontierQueue.length > 0 && placedInBatch < batchSize) {
      const pt = this.fillFrontierQueue.shift()!;
      if (!this.isCellCovered(pt.x, pt.z, pt.y)) {
        const cell = this.grid.grid[pt.x]?.[pt.z]?.[pt.y];
        if (cell && cell.occupied) {
          const headId = placedInBatch % this.heads.length;
          const placed = this.commitBrick(
            pt.x,
            pt.z,
            pt.y,
            plate1x1,
            variant,
            'CORE_EXPANSION',
            headId,
            cell.colorHex
          );
          newBricks.push(placed);
          placedInBatch++;
        }
      }
    }

    // Check if volume fill complete
    if (this.occupiedCellToBrickId.size >= this.grid.totalOccupied || this.fillFrontierQueue.length === 0) {
      if (this.options.enableModernWeirdParts) {
        this.currentPhase = 'SURFACE_REPLACE';
        this.initSurfaceCandidates();
      } else {
        this.currentPhase = 'OPTIMIZE_MERGE';
        this.mergeLayerCursor = 0;
      }
    }

    return newBricks;
  }

  /**
   * Phase 2: Backwards Optimization / Agglomerative Merging.
   * Merges contiguous 1x1 plates of compatible color into larger bricks and plates with running bond seams.
   */
  private stepBackwardOptimizeMerge(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    // Ordered list of structural brick candidates (height 3 plates = 24 LDU)
    const brickParts = [
      { partId: '3001', w: 2, d: 4, h: 3 }, // Brick 2 x 4
      { partId: '2456', w: 2, d: 6, h: 3 }, // Brick 2 x 6
      { partId: '3002', w: 2, d: 3, h: 3 }, // Brick 2 x 3
      { partId: '3003', w: 2, d: 2, h: 3 }, // Brick 2 x 2
      { partId: '3010', w: 1, d: 4, h: 3 }, // Brick 1 x 4
      { partId: '3622', w: 1, d: 3, h: 3 }, // Brick 1 x 3
      { partId: '3004', w: 1, d: 2, h: 3 }, // Brick 1 x 2
      { partId: '3062a', w: 1, d: 1, h: 3 } // Brick 1 x 1 Round Cylinder
    ];

    // Ordered list of plate candidates (height 1 plate = 8 LDU)
    const plateParts = [
      { partId: '3034', w: 2, d: 8, h: 1 }, // Plate 2 x 8
      { partId: '3795', w: 2, d: 6, h: 1 }, // Plate 2 x 6
      { partId: '3020', w: 2, d: 4, h: 1 }, // Plate 2 x 4
      { partId: '3021', w: 2, d: 3, h: 1 }, // Plate 2 x 3
      { partId: '3022', w: 2, d: 2, h: 1 }, // Plate 2 x 2
      { partId: '3460', w: 1, d: 8, h: 1 }, // Plate 1 x 8
      { partId: '3666', w: 1, d: 6, h: 1 }, // Plate 1 x 6
      { partId: '3710', w: 1, d: 4, h: 1 }, // Plate 1 x 4
      { partId: '3623', w: 1, d: 3, h: 1 }, // Plate 1 x 3
      { partId: '3023', w: 1, d: 2, h: 1 }  // Plate 1 x 2
    ];

    let mergesDone = 0;
    const maxMergesPerTick = 16;

    // Scan layers starting from mergeLayerCursor
    while (this.mergeLayerCursor < numPlatesY && mergesDone < maxMergesPerTick) {
      const y = this.mergeLayerCursor;
      const canTryBricks = y + 2 < numPlatesY;
      const layerStagger = (Math.floor(y / 3) % 2) * 2; // Running bond offset
      let layerHadMerge = false;

      for (let xOffset = 0; xOffset < numStudsX && mergesDone < maxMergesPerTick; xOffset++) {
        const x = (xOffset + layerStagger) % numStudsX;
        for (let z = 0; z < numStudsZ && mergesDone < maxMergesPerTick; z++) {
          const key = this.cellKey(x, z, y);
          const currentBrickId = this.occupiedCellToBrickId.get(key);
          if (!currentBrickId) continue;

          // Only merge if currently covered by unit 1x1 plates
          const currentPart = this.brickIdToPartId.get(currentBrickId);
          if (currentPart !== '3024') continue;

          const baseCell = this.grid.grid[x]?.[z]?.[y];
          if (!baseCell) continue;

          // 1. Try Height-3 Bricks first if valid
          let merged = false;
          if (canTryBricks) {
            for (const bp of brickParts) {
              for (const isRot of [false, true]) {
                const bw = isRot ? bp.d : bp.w;
                const bd = isRot ? bp.w : bp.d;
                const rot = isRot ? 90 : 0;

                if (x + bw <= numStudsX && z + bd <= numStudsZ) {
                  let allMatch = true;
                  const bricksToRemove = new Set<string>();

                  for (let dx = 0; dx < bw && allMatch; dx++) {
                    for (let dz = 0; dz < bd && allMatch; dz++) {
                      for (let dy = 0; dy < 3 && allMatch; dy++) {
                        const cell = this.grid.grid[x + dx]?.[z + dz]?.[y + dy];
                        if (!cell || !cell.occupied) {
                          allMatch = false;
                          break;
                        }

                        const bId = this.occupiedCellToBrickId.get(this.cellKey(x + dx, z + dz, y + dy));
                        if (!bId || this.brickIdToPartId.get(bId) !== '3024') {
                          allMatch = false;
                          break;
                        }

                        if (!this.areColorsCompatible(baseCell.colorHex, cell.colorHex)) {
                          allMatch = false;
                          break;
                        }

                        bricksToRemove.add(bId);
                      }
                    }
                  }

                  if (allMatch && bricksToRemove.size === bw * bd * 3) {
                    // Execute Brick Merge
                    const connector = CONNECTOR_DATABASE.getConnector(bp.partId);
                    if (connector) {
                      const variant = connector.fingerprint.variants.get(rot as any)!;
                      for (const bId of bricksToRemove) {
                        this.removeBrick(bId);
                      }

                      const newBrick = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', 0, baseCell.colorHex);
                      newBricks.push(newBrick);
                      mergesDone++;
                      merged = true;
                      layerHadMerge = true;
                      break;
                    }
                  }
                }
              }
              if (merged) break;
            }
          }

          // 2. Try Height-1 Plates if brick didn't fit
          if (!merged) {
            for (const pp of plateParts) {
              for (const isRot of [false, true]) {
                const pw = isRot ? pp.d : pp.w;
                const pd = isRot ? pp.w : pp.d;
                const rot = isRot ? 90 : 0;

                if (x + pw <= numStudsX && z + pd <= numStudsZ) {
                  let allMatch = true;
                  const platesToRemove = new Set<string>();

                  for (let dx = 0; dx < pw && allMatch; dx++) {
                    for (let dz = 0; dz < pd && allMatch; dz++) {
                      const cell = this.grid.grid[x + dx]?.[z + dz]?.[y];
                      if (!cell || !cell.occupied) {
                        allMatch = false;
                        break;
                      }

                      const bId = this.occupiedCellToBrickId.get(this.cellKey(x + dx, z + dz, y));
                      if (!bId || this.brickIdToPartId.get(bId) !== '3024') {
                        allMatch = false;
                        break;
                      }

                      if (!this.areColorsCompatible(baseCell.colorHex, cell.colorHex)) {
                        allMatch = false;
                        break;
                      }

                      platesToRemove.add(bId);
                    }
                  }

                  if (allMatch && platesToRemove.size === pw * pd) {
                    const connector = CONNECTOR_DATABASE.getConnector(pp.partId);
                    if (connector) {
                      const variant = connector.fingerprint.variants.get(rot as any)!;
                      for (const bId of platesToRemove) {
                        this.removeBrick(bId);
                      }

                      const newPlate = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', 0, baseCell.colorHex);
                      newBricks.push(newPlate);
                      mergesDone++;
                      merged = true;
                      layerHadMerge = true;
                      break;
                    }
                  }
                }
              }
              if (merged) break;
            }
          }
        }
      }

      if (!layerHadMerge || mergesDone < maxMergesPerTick) {
        this.mergeLayerCursor++;
      }
    }

    if (this.mergeLayerCursor >= numPlatesY) {
      this.currentPhase = this.options.enableStudlessTopFinish ? 'TILE_FINISH' : 'DONE';
      this.tileFinishCursor = 0;
    }

    return newBricks;
  }

  /**
   * Initializes list of boundary cells for the exterior surface replacement pass.
   */
  private initSurfaceCandidates(): void {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    this.surfaceCandidates = [];
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = this.grid.grid[x][z][y];
          if (cell && cell.occupied && cell.isBoundary) {
            this.surfaceCandidates.push({ x, z, y });
          }
        }
      }
    }
    this.surfaceCandidateCursor = 0;
  }

  /**
   * Phase 3: Exterior Surface Replacement Pass.
   * Evaluates boundary features (slopes, curves, macaroni, crests) and replaces exterior pieces with database parts.
   */
  private stepSurfaceReplace(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    let replacedInTick = 0;
    const maxReplacementsPerTick = 12;

    while (this.surfaceCandidateCursor < this.surfaceCandidates.length && replacedInTick < maxReplacementsPerTick) {
      const { x, z, y } = this.surfaceCandidates[this.surfaceCandidateCursor++];
      const cell = this.grid.grid[x]?.[z]?.[y];
      if (!cell || !cell.occupied) continue;

      const currentBId = this.occupiedCellToBrickId.get(this.cellKey(x, z, y));
      if (!currentBId) continue;
      const currentBrick = this.placedBricks.get(currentBId);
      if (currentBrick && (currentBrick.category === 'LEAF' || currentBrick.growthPhase === 'SURFACE_EDGE')) {
        continue;
      }

      let baseRot: 0 | 90 | 180 | 270 = 0;
      if (cell.slopeHeading === 90) baseRot = 90;
      else if (cell.slopeHeading === 180) baseRot = 180;
      else if (cell.slopeHeading === 270) baseRot = 270;

      const candidatePartIds: string[] = [];

      // 1. Modern Curved Slopes (Convex curves & slopes)
      if ((cell.slopeClass === 'slope_curved' || cell.curvatureClass === 'cylindrical_convex') && this.options.enableModernWeirdParts) {
        candidatePartIds.push('15068', '11477', '88930', '61678', '85984', '54200', '3039', '3040');
      } else if (cell.slopeClass === 'slope_curved') {
        candidatePartIds.push('3039', '3040', '85984', '54200');
      }

      // 2. Inverted Slopes (Underhangs)
      if (cell.slopeClass === 'slope_inverted') {
        if (this.options.enableModernWeirdParts) {
          candidatePartIds.push('93273', '24201');
        }
      }

      // 3. Cheese & 33° Slopes
      if (cell.slopeClass === 'slope_33') {
        candidatePartIds.push('85984', '54200');
      }

      // 4. 45° Slopes
      if (cell.slopeClass === 'slope_45') {
        candidatePartIds.push('3040', '3039');
      }

      // 5. Macaroni Corners
      if (cell.curvatureClass === 'corner_macaroni' && this.options.enableModernWeirdParts) {
        candidatePartIds.push('27925', '25269');
      }

      // 6. Spherical Dome Apex
      if (cell.curvatureClass === 'spherical_dome') {
        candidatePartIds.push('4740');
      }

      // 7. Sharp Cusp / Creature Horns
      if (cell.curvatureClass === 'sharp_cusp' && this.options.enableModernWeirdParts) {
        candidatePartIds.push('53451', '41669');
      }

      let placedCandidate = false;

      for (const candidatePartId of candidatePartIds) {
        const connector = CONNECTOR_DATABASE.getConnector(candidatePartId);
        if (!connector) continue;

        const rotationsToTry: Array<0 | 90 | 180 | 270> = [
          baseRot,
          ((baseRot + 90) % 360) as (0 | 90 | 180 | 270),
          ((baseRot + 180) % 360) as (0 | 90 | 180 | 270),
          ((baseRot + 270) % 360) as (0 | 90 | 180 | 270)
        ];

        for (const rot of rotationsToTry) {
          const variant: RotatedPieceVariant | undefined = connector.fingerprint.variants.get(rot);
          if (!variant) continue;

          // Try placing with base at y, or base stepping down into volume: baseY = y - variant.heightY + 1
          const baseYsToTry = [
            Math.max(0, y - variant.heightY + 1),
            y
          ];

          for (const tryY of baseYsToTry) {
            if (
              x + variant.widthX <= numStudsX &&
              z + variant.depthZ <= numStudsZ &&
              tryY + variant.heightY <= numPlatesY
            ) {
              let footprintValid = true;
              const bricksToReplace = new Set<string>();

              for (let ci = 0; ci < variant.occupiedCells.length; ci++) {
                const c: { dx: number; dz: number; dy: number } = variant.occupiedCells[ci];
                const gx = x + c.dx;
                const gz = z + c.dz;
                const gy = tryY + c.dy;
                const cCell = this.grid.grid[gx]?.[gz]?.[gy];
                if (!cCell || !cCell.occupied) {
                  footprintValid = false;
                  break;
                }
                const bId = this.occupiedCellToBrickId.get(this.cellKey(gx, gz, gy));
                if (bId) {
                  const existingBrick = this.placedBricks.get(bId);
                  if (existingBrick && (existingBrick.category === 'LEAF' || existingBrick.growthPhase === 'SURFACE_EDGE')) {
                    footprintValid = false;
                    break;
                  }
                  bricksToReplace.add(bId);
                }
              }

              if (footprintValid && bricksToReplace.size > 0) {
                const freedCells: Array<{ x: number; z: number; y: number }> = [];
                for (const bId of bricksToReplace) {
                  const oldB = this.placedBricks.get(bId);
                  if (oldB) {
                    for (let dx = 0; dx < oldB.size[0]; dx++) {
                      for (let dz = 0; dz < oldB.size[1]; dz++) {
                        for (let dy = 0; dy < oldB.size[2]; dy++) {
                          freedCells.push({
                            x: oldB.gridPos[0] + dx,
                            z: oldB.gridPos[1] + dz,
                            y: oldB.gridPos[2] + dy
                          });
                        }
                      }
                    }
                  }
                  this.removeBrick(bId);
                }

                const newPiece = this.commitBrick(x, z, tryY, connector, variant, 'SURFACE_EDGE', 0, cell.colorHex);
                newBricks.push(newPiece);
                replacedInTick++;
                placedCandidate = true;

                // Refill any leftover freed cells not covered by newPiece with 1x1 plates
                const plate1x1 = CONNECTOR_DATABASE.getConnector('3024');
                if (plate1x1) {
                  const pVariant = plate1x1.fingerprint.variants.get(0)!;
                  for (const fc of freedCells) {
                    if (!this.isCellCovered(fc.x, fc.z, fc.y)) {
                      const fCell = this.grid.grid[fc.x]?.[fc.z]?.[fc.y];
                      if (fCell && fCell.occupied) {
                        this.commitBrick(fc.x, fc.z, fc.y, plate1x1, pVariant, 'CORE_EXPANSION', 0, fCell.colorHex);
                      }
                    }
                  }
                }

                break;
              }
            }
          }
          if (placedCandidate) break;
        }
        if (placedCandidate) break;
      }
    }

    if (this.surfaceCandidateCursor >= this.surfaceCandidates.length) {
      this.currentPhase = 'OPTIMIZE_MERGE';
      this.mergeLayerCursor = 0;
    }

    return newBricks;
  }

  /**
   * Phase 4: Studless Top Finish Pass.
   * Caps exposed top horizontal surfaces with smooth flat tiles.
   */
  private stepTileFinish(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const tileParts = [
      { partId: '3068b', w: 2, d: 2 }, // Tile 2 x 2
      { partId: '3069b', w: 1, d: 2 }, // Tile 1 x 2
      { partId: '2431', w: 1, d: 4 },  // Tile 1 x 4
      { partId: '98138', w: 1, d: 1 }  // Tile 1 x 1 Round Flat
    ];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    let tilesPlaced = 0;
    const maxTilesPerTick = 16;

    for (let x = 0; x < numStudsX && tilesPlaced < maxTilesPerTick; x++) {
      for (let z = 0; z < numStudsZ && tilesPlaced < maxTilesPerTick; z++) {
        for (let y = numPlatesY - 1; y >= 0; y--) {
          const key = this.cellKey(x, z, y);
          const brickId = this.occupiedCellToBrickId.get(key);
          if (!brickId) continue;

          const placed = this.placedBricks.get(brickId);
          if (!placed) break;

          // If already a tile or slope, top is finished
          if (
            placed.profile === 'tile_flat' ||
            placed.profile === 'slope_curved' ||
            placed.profile === 'cheese' ||
            placed.profile === 'macaroni' ||
            placed.growthPhase === 'TILE_FINISH'
          ) {
            break;
          }

          // Check if top face of this brick is exposed to air
          const topFaceY = placed.gridPos[2] + placed.size[2];
          const isTopExposed = topFaceY >= numPlatesY || !this.occupiedCellToBrickId.has(this.cellKey(x, z, topFaceY));
          if (!isTopExposed) break;

          // If placed brick is height 1 (plate), try replacing with a flat tile
          if (placed.size[2] === 1 && placed.gridPos[2] === y) {
            let tileReplaced = false;

            for (const tp of tileParts) {
              for (const isRot of [false, true]) {
                const tw = isRot ? tp.d : tp.w;
                const td = isRot ? tp.w : tp.d;
                const rot = isRot ? 90 : 0;

                if (x + tw <= numStudsX && z + td <= numStudsZ) {
                  let canReplace = true;
                  const platesToReplace = new Set<string>();

                  for (let dx = 0; dx < tw && canReplace; dx++) {
                    for (let dz = 0; dz < td && canReplace; dz++) {
                      const cKey = this.cellKey(x + dx, z + dz, y);
                      const bId = this.occupiedCellToBrickId.get(cKey);
                      if (!bId) { canReplace = false; break; }

                      const b = this.placedBricks.get(bId);
                      if (!b || b.size[2] !== 1 || b.profile === 'tile_flat') {
                        canReplace = false;
                        break;
                      }

                      if (y + 1 < numPlatesY && this.occupiedCellToBrickId.has(this.cellKey(x + dx, z + dz, y + 1))) {
                        canReplace = false;
                        break;
                      }

                      platesToReplace.add(bId);
                    }
                  }

                  if (canReplace && platesToReplace.size > 0) {
                    const connector = CONNECTOR_DATABASE.getConnector(tp.partId);
                    if (connector) {
                      const variant = connector.fingerprint.variants.get(rot as any)!;
                      const freedCells: Array<{ x: number; z: number; y: number }> = [];
                      for (const bId of platesToReplace) {
                        const oldB = this.placedBricks.get(bId);
                        if (oldB) {
                          for (let fx = 0; fx < oldB.size[0]; fx++) {
                            for (let fz = 0; fz < oldB.size[1]; fz++) {
                              for (let fy = 0; fy < oldB.size[2]; fy++) {
                                freedCells.push({
                                  x: oldB.gridPos[0] + fx,
                                  z: oldB.gridPos[1] + fz,
                                  y: oldB.gridPos[2] + fy
                                });
                              }
                            }
                          }
                        }
                        this.removeBrick(bId);
                      }

                      const newTile = this.commitBrick(x, z, y, connector, variant, 'TILE_FINISH', 0, placed.colorHex);
                      newBricks.push(newTile);
                      tilesPlaced++;
                      tileReplaced = true;

                      // Refill any leftover freed cells not covered by newTile with 1x1 plates
                      const plate1x1 = CONNECTOR_DATABASE.getConnector('3024');
                      if (plate1x1) {
                        const pVariant = plate1x1.fingerprint.variants.get(0)!;
                        for (const fc of freedCells) {
                          if (!this.isCellCovered(fc.x, fc.z, fc.y)) {
                            const fCell = this.grid.grid[fc.x]?.[fc.z]?.[fc.y];
                            if (fCell && fCell.occupied) {
                              this.commitBrick(fc.x, fc.z, fc.y, plate1x1, pVariant, 'CORE_EXPANSION', 0, fCell.colorHex);
                            }
                          }
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (tileReplaced) break;
            }
          }

          break; // Processed topmost brick of this (x, z) column
        }
      }
    }

    if (tilesPlaced === 0) {
      this.currentPhase = 'DONE';
    }

    return newBricks;
  }

  /**
   * Executes a single discretization step according to the current phase.
   */
  public step(): GrowthStepResult {
    this.stepIndex++;
    let newBricks: PlacedBrick[] = [];

    switch (this.currentPhase) {
      case 'VOLUME_FILL':
        newBricks = this.stepForwardVolumeFill();
        break;

      case 'SURFACE_REPLACE':
        newBricks = this.stepSurfaceReplace();
        break;

      case 'OPTIMIZE_MERGE':
        newBricks = this.stepBackwardOptimizeMerge();
        break;

      case 'TILE_FINISH':
        newBricks = this.stepTileFinish();
        break;

      case 'DONE':
      default:
        break;
    }

    return this.formatStepResult(newBricks);
  }

  private formatStepResult(newBricks: PlacedBrick[] = []): GrowthStepResult {
    const totalPlaced = this.placedBricks.size;
    const placedVoxels = this.occupiedCellToBrickId.size;
    const targetVoxels = this.grid.totalOccupied;

    return {
      stepIndex: this.stepIndex,
      phase: this.currentPhase,
      newBrick: newBricks[0],
      newBricks,
      activeHeadsCount: this.heads.length,
      activeFrontierCount: this.fillFrontierQueue.length,
      totalPlacedBricks: totalPlaced,
      totalPlacedVoxels: placedVoxels,
      totalTargetVoxels: targetVoxels,
      coverageRatio: targetVoxels > 0 ? Math.min(1.0, placedVoxels / targetVoxels) : 1.0,
      bomStats: {
        leafCount: this.bomStats.leafCount,
        edgeCount: this.bomStats.edgeCount,
        fillCount: this.bomStats.fillCount,
        uniquePartCount: this.bomStats.uniqueParts.size
      }
    };
  }

  /**
   * Solves the complete discretization pipeline to completion.
   */
  public solveAll(maxSteps: number = 4000): GrowthStepResult {
    let lastResult = this.formatStepResult();
    let steps = 0;

    while (this.currentPhase !== 'DONE' && steps < maxSteps) {
      lastResult = this.step();
      steps++;
      if (lastResult.newBricks.length === 0) break;
    }

    return lastResult;
  }
}
