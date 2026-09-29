/**
 * Brickator3000 // Fast 2-Step Markov & Structural Discretization Engine.
 *
 * Implements the qualitative 2-step LEGO discretization pipeline:
 *
 * STEP 1: SOLID STRUCTURAL BASE DISCRETIZATION (Previous High-Performance Engine)
 * - Rapidly discretizes the watertight 3D source volume into solid, authentic LEGO SYSTEM
 *   structural bricks (2x8, 2x6, 2x4, 2x3, 2x2, 1x8, 1x6, 1x4, 1x2, 1x1) and plates (2x8 to 1x1).
 * - Enforces authentic interlocking running bond with alternating X/Z orientations across layers.
 * - Direct 24-bit RGB color sampling ("Cheat Mode") preserving exact source textures and gradients.
 * - Computes solid base geometry in milliseconds.
 *
 * STEP 2: EXTERIOR SURFACE REPLACEMENT & STUDLESS FINISH
 * - Scans boundary cells exposed to exterior air using authentic surface normal gradients.
 * - Replaces exterior rectangular bricks with authentic LEGO SYSTEM curved slopes (11477, 15068, 61678, 88930),
 *   inverted curved slopes (24201, 93273), 45° slopes (3040, 3039), cheese slopes (54200, 85984),
 *   macaroni round corner tiles (27925, 25269), and inverted radar dishes (4740, 43898).
 * - STRICT OUTWARD NORMAL ALIGNMENT: Zero upside-down or reversed slopes.
 * - ZERO BIONICLE / CONSTRACTION / CREATURE SHAPES.
 * - Studless top finish capping exposed horizontal top plates with smooth tiles (3068b, 3069b, 2431, 98138).
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
  | 'SURFACE_REPLACE'
  | 'TILE_FINISH'
  | 'DONE';

interface StructuralPieceSpec {
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  w: number;
  d: number;
  h: number;
}

const STRUCTURAL_BRICKS: StructuralPieceSpec[] = [
  { partId: '3007', name: 'Brick 2 x 8', category: 'FILL', profile: 'brick', w: 2, d: 8, h: 3 },
  { partId: '2456', name: 'Brick 2 x 6', category: 'FILL', profile: 'brick', w: 2, d: 6, h: 3 },
  { partId: '3001', name: 'Brick 2 x 4', category: 'FILL', profile: 'brick', w: 2, d: 4, h: 3 },
  { partId: '3002', name: 'Brick 2 x 3', category: 'FILL', profile: 'brick', w: 2, d: 3, h: 3 },
  { partId: '3003', name: 'Brick 2 x 2', category: 'FILL', profile: 'brick', w: 2, d: 2, h: 3 },
  { partId: '3008', name: 'Brick 1 x 8', category: 'FILL', profile: 'brick', w: 1, d: 8, h: 3 },
  { partId: '3009', name: 'Brick 1 x 6', category: 'FILL', profile: 'brick', w: 1, d: 6, h: 3 },
  { partId: '3010', name: 'Brick 1 x 4', category: 'FILL', profile: 'brick', w: 1, d: 4, h: 3 },
  { partId: '3622', name: 'Brick 1 x 3', category: 'FILL', profile: 'brick', w: 1, d: 3, h: 3 },
  { partId: '3004', name: 'Brick 1 x 2', category: 'FILL', profile: 'brick', w: 1, d: 2, h: 3 },
  { partId: '3005', name: 'Brick 1 x 1', category: 'FILL', profile: 'brick', w: 1, d: 1, h: 3 }
];

const STRUCTURAL_PLATES: StructuralPieceSpec[] = [
  { partId: '3034', name: 'Plate 2 x 8', category: 'FILL', profile: 'plate', w: 2, d: 8, h: 1 },
  { partId: '3795', name: 'Plate 2 x 6', category: 'FILL', profile: 'plate', w: 2, d: 6, h: 1 },
  { partId: '3020', name: 'Plate 2 x 4', category: 'FILL', profile: 'plate', w: 2, d: 4, h: 1 },
  { partId: '3021', name: 'Plate 2 x 3', category: 'FILL', profile: 'plate', w: 2, d: 3, h: 1 },
  { partId: '3022', name: 'Plate 2 x 2', category: 'FILL', profile: 'plate', w: 2, d: 2, h: 1 },
  { partId: '3460', name: 'Plate 1 x 8', category: 'FILL', profile: 'plate', w: 1, d: 8, h: 1 },
  { partId: '3666', name: 'Plate 1 x 6', category: 'FILL', profile: 'plate', w: 1, d: 6, h: 1 },
  { partId: '3710', name: 'Plate 1 x 4', category: 'FILL', profile: 'plate', w: 1, d: 4, h: 1 },
  { partId: '3623', name: 'Plate 1 x 3', category: 'FILL', profile: 'plate', w: 1, d: 3, h: 1 },
  { partId: '3023', name: 'Plate 1 x 2', category: 'FILL', profile: 'plate', w: 1, d: 2, h: 1 },
  { partId: '3024', name: 'Plate 1 x 1', category: 'FILL', profile: 'plate', w: 1, d: 1, h: 1 }
];

export class MarkovCoreGrowingEngine {
  public grid: VoxelGrid;
  public options: MarkovEngineOptions;

  public placedBricks: Map<string, PlacedBrick> = new Map();
  public occupiedCellToBrickId: Map<string, string> = new Map(); // "x,z,y" -> brickId
  public brickIdToPartId: Map<string, string> = new Map(); // brickId -> partId

  // Multi-Head Management
  public heads: GrowthHead[] = [];
  public stepIndex: number = 0;
  public currentPhase: DiscretizationPhase = 'VOLUME_FILL';

  // Layer cursors for smooth animation
  private baseTilingLayerCursor: number = 0;
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

    // Initialize Multi-Heads
    const headColors = ['#38bdf8', '#fbbf24', '#34d399', '#f43f5e', '#a855f7', '#ec4899', '#6366f1', '#14b8a6'];
    for (let i = 0; i < numHeads; i++) {
      this.heads.push({
        headId: i,
        name: `Builder-${i + 1}`,
        colorHex: headColors[i % headColors.length],
        active: true,
        priorityY: i,
        placedCount: 0
      });
    }

    this.baseTilingLayerCursor = 0;
    this.currentPhase = 'VOLUME_FILL';
  }

  private cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  public isCellCovered(x: number, z: number, y: number): boolean {
    return this.occupiedCellToBrickId.has(this.cellKey(x, z, y));
  }

  /**
   * Commits a brick into the model and updates cell mappings.
   */
  private commitBrick(
    startX: number,
    startZ: number,
    startY: number,
    connector: LDrawConnectorMeta,
    variant: RotatedPieceVariant,
    phase: 'SEED' | 'CORE_EXPANSION' | 'MANTLE' | 'SURFACE_EDGE' | 'LEAF_APEX' | 'TILE_FINISH',
    headId: number = 0,
    forcedColorHex?: string
  ): PlacedBrick {
    const brickId = `b_${connector.partId}_${startX}_${startZ}_${startY}_${variant.rotation}_${this.stepIndex}_${Math.floor(this.rng() * 10000)}`;
    const { numStudsX, numStudsZ } = this.grid;

    let sumR = 0, sumG = 0, sumB = 0;
    let colorCode = 15;
    let colorHex = forcedColorHex || '#f4f4f4';
    let colorName = 'White';

    if (!forcedColorHex) {
      let count = 0;
      for (const c of variant.occupiedCells) {
        const cell = this.grid.grid[startX + c.dx]?.[startZ + c.dz]?.[startY + c.dy];
        if (cell) {
          colorCode = cell.colorCode;
          colorName = cell.colorName;
          const cleanHex = cell.colorHex.replace('#', '');
          sumR += parseInt(cleanHex.substring(0, 2), 16) || 200;
          sumG += parseInt(cleanHex.substring(2, 4), 16) || 200;
          sumB += parseInt(cleanHex.substring(4, 6), 16) || 200;
          count++;
        }
      }

      if (count > 0) {
        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);
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
   * Removes a brick from the model and frees its covered voxels.
   */
  private removeBrick(brickId: string): PlacedBrick | null {
    const placed = this.placedBricks.get(brickId);
    if (!placed) return null;

    this.placedBricks.delete(brickId);
    this.brickIdToPartId.delete(brickId);

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

    if (placed.category === 'LEAF') this.bomStats.leafCount = Math.max(0, this.bomStats.leafCount - 1);
    else if (placed.category === 'EDGE') this.bomStats.edgeCount = Math.max(0, this.bomStats.edgeCount - 1);
    else if (placed.category === 'FILL') this.bomStats.fillCount = Math.max(0, this.bomStats.fillCount - 1);

    return placed;
  }

  /**
   * Checks if a solid block of dimensions (wX, wZ, hY) fits into unoccupied voxels.
   */
  private canFitSolidBlock(startX: number, startZ: number, startY: number, wX: number, wZ: number, hY: number): boolean {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    if (startX + wX > numStudsX || startZ + wZ > numStudsZ || startY + hY > numPlatesY) return false;

    for (let dx = 0; dx < wX; dx++) {
      for (let dz = 0; dz < wZ; dz++) {
        for (let dy = 0; dy < hY; dy++) {
          const cell = this.grid.grid[startX + dx]?.[startZ + dz]?.[startY + dy];
          if (!cell || !cell.occupied) return false;
          if (this.isCellCovered(startX + dx, startZ + dz, startY + dy)) return false;
        }
      }
    }
    return true;
  }

  /**
   * STEP 1: FAST STRUCTURAL BASE DISCRETIZATION
   * Tiles the 3D voxel volume into solid structural LEGO SYSTEM bricks with running bond.
   * Processes 3-4 layers per tick for rapid, qualitative generation.
   */
  private stepBaseSolidDiscretization(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    // Process up to 3 vertical plate levels per tick (1 standard brick layer)
    const layersToProcess = Math.min(3, numPlatesY - this.baseTilingLayerCursor);
    const endY = this.baseTilingLayerCursor + layersToProcess;

    for (let y = this.baseTilingLayerCursor; y < endY; y++) {
      const canTryBrick = y + 2 < numPlatesY;
      const brickLayerIndex = Math.floor(y / 3);
      const isEvenLayer = brickLayerIndex % 2 === 0;

      // Running bond stagger: offset start position on alternating layers
      const staggerX = isEvenLayer ? 0 : 1;
      const staggerZ = isEvenLayer ? 1 : 0;

      for (let xStep = 0; xStep < numStudsX; xStep++) {
        const x = (xStep + staggerX) % numStudsX;
        for (let zStep = 0; zStep < numStudsZ; zStep++) {
          const z = (zStep + staggerZ) % numStudsZ;

          const cell = this.grid.grid[x]?.[z]?.[y];
          if (!cell || !cell.occupied || this.isCellCovered(x, z, y)) continue;

          let placed = false;

          // 1. Try Height-3 Bricks first if valid
          if (canTryBrick) {
            for (const spec of STRUCTURAL_BRICKS) {
              const orientations = isEvenLayer ? [false, true] : [true, false];
              for (const isRot of orientations) {
                const bw = isRot ? spec.d : spec.w;
                const bd = isRot ? spec.w : spec.d;
                const rot: 0 | 90 = isRot ? 90 : 0;

                if (this.canFitSolidBlock(x, z, y, bw, bd, 3)) {
                  const connector = CONNECTOR_DATABASE.getConnector(spec.partId);
                  if (connector) {
                    const variant = connector.fingerprint.variants.get(rot)!;
                    const headId = (x + z + y) % this.heads.length;
                    const b = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', headId);
                    newBricks.push(b);
                    placed = true;
                    break;
                  }
                }
              }
              if (placed) break;
            }
          }

          // 2. Fallback to Height-1 Plates if brick didn't fit
          if (!placed) {
            for (const spec of STRUCTURAL_PLATES) {
              const orientations = isEvenLayer ? [false, true] : [true, false];
              for (const isRot of orientations) {
                const pw = isRot ? spec.d : spec.w;
                const pd = isRot ? spec.w : spec.d;
                const rot: 0 | 90 = isRot ? 90 : 0;

                if (this.canFitSolidBlock(x, z, y, pw, pd, 1)) {
                  const connector = CONNECTOR_DATABASE.getConnector(spec.partId);
                  if (connector) {
                    const variant = connector.fingerprint.variants.get(rot)!;
                    const headId = (x + z + y) % this.heads.length;
                    const b = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', headId);
                    newBricks.push(b);
                    placed = true;
                    break;
                  }
                }
              }
              if (placed) break;
            }
          }
        }
      }
    }

    this.baseTilingLayerCursor = endY;

    // When base solid volume is 100% tiled, transition to surface replacement
    if (this.baseTilingLayerCursor >= numPlatesY) {
      if (this.options.enableModernWeirdParts) {
        this.currentPhase = 'SURFACE_REPLACE';
        this.initSurfaceCandidates();
      } else if (this.options.enableStudlessTopFinish) {
        this.currentPhase = 'TILE_FINISH';
        this.tileFinishCursor = 0;
      } else {
        this.currentPhase = 'DONE';
      }
    }

    return newBricks;
  }

  /**
   * Initializes candidate boundary cells for exterior surface replacement.
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
   * STEP 2: EXTERIOR SURFACE REPLACEMENT PASS
   * Evaluates boundary cells and replaces exterior rectangular bricks with authentic LEGO SYSTEM
   * curved slopes, inverted slopes, 45° slopes, cheese slopes, macaroni, and radar dishes.
   * STRICT OUTWARD HEADING ALIGNMENT: Never places backward or upside down pieces!
   */
  private stepSurfaceReplace(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    let replacedInTick = 0;
    const maxReplacementsPerTick = 16;

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

      // Compute outward heading from surface normal (nx, ny, nz)
      // Normal points outward towards air
      const [nx, ny, nz] = cell.normal;
      let baseRot: 0 | 90 | 180 | 270 = 0;
      if (Math.abs(nz) >= Math.abs(nx)) {
        baseRot = nz >= 0 ? 0 : 180;
      } else {
        baseRot = nx >= 0 ? 270 : 90;
      }

      const candidatePartIds: string[] = [];

      // 1. Curved Slopes (Convex outer surfaces)
      if (cell.slopeClass === 'slope_curved' || cell.curvatureClass === 'cylindrical_convex') {
        candidatePartIds.push('15068', '11477', '88930', '61678', '85984', '54200', '3039', '3040');
      }

      // 2. Inverted Slopes (Underhangs)
      if (cell.slopeClass === 'slope_inverted') {
        candidatePartIds.push('24201', '93273');
      }

      // 3. Cheese Slopes & 33° Slopes
      if (cell.slopeClass === 'slope_33') {
        candidatePartIds.push('85984', '54200', '3298');
      }

      // 4. 45° Slopes
      if (cell.slopeClass === 'slope_45') {
        candidatePartIds.push('3040', '3039', '3038');
      }

      // 5. Macaroni & Round Corners
      if (cell.curvatureClass === 'corner_macaroni') {
        candidatePartIds.push('27925', '25269');
      }

      // 6. Spherical Dome Apex (crown top with authentic radar dishes)
      if (cell.curvatureClass === 'spherical_dome' && ny > 0.6) {
        candidatePartIds.push('4740', '43898', '3960');
      }

      let placedCandidate = false;

      for (const candidatePartId of candidatePartIds) {
        const connector = CONNECTOR_DATABASE.getConnector(candidatePartId);
        if (!connector) continue;

        // ONLY use the exact outward heading (never rotate 180 degrees backwards!)
        const variant = connector.fingerprint.variants.get(baseRot);
        if (!variant) continue;

        const tryY = Math.max(0, y - variant.heightY + 1);

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
            const freedVoxels: Array<{ x: number; z: number; y: number; colorHex: string }> = [];
            for (const bId of bricksToReplace) {
              const b = this.placedBricks.get(bId);
              if (b) {
                const [bx, bz, by] = b.gridPos;
                const [bw, bd, bh] = b.size;
                for (let dx = 0; dx < bw; dx++) {
                  for (let dz = 0; dz < bd; dz++) {
                    for (let dy = 0; dy < bh; dy++) {
                      const cx = bx + dx;
                      const cz = bz + dz;
                      const cy = by + dy;
                      const cell = this.grid.grid[cx]?.[cz]?.[cy];
                      if (cell && cell.occupied) {
                        freedVoxels.push({ x: cx, z: cz, y: cy, colorHex: cell.colorHex });
                      }
                    }
                  }
                }
              }
              this.removeBrick(bId);
            }

            const newSlope = this.commitBrick(x, z, tryY, connector, variant, 'SURFACE_EDGE', 0, cell.colorHex);
            newBricks.push(newSlope);
            replacedInTick++;
            placedCandidate = true;

            // Refill any residual voxels that were part of old bricks but not covered by the new slope
            for (const fv of freedVoxels) {
              if (!this.isCellCovered(fv.x, fv.z, fv.y)) {
                const p1x1 = CONNECTOR_DATABASE.getConnector('3024');
                if (p1x1) {
                  const pVar = p1x1.fingerprint.variants.get(0)!;
                  const resPlate = this.commitBrick(fv.x, fv.z, fv.y, p1x1, pVar, 'CORE_EXPANSION', 0, fv.colorHex);
                  newBricks.push(resPlate);
                }
              }
            }
            break;
          }
        }
      }
    }

    if (this.surfaceCandidateCursor >= this.surfaceCandidates.length) {
      this.currentPhase = this.options.enableStudlessTopFinish ? 'TILE_FINISH' : 'DONE';
      this.tileFinishCursor = 0;
    }

    return newBricks;
  }

  /**
   * STEP 3: STUDLESS TOP FINISH PASS
   * Caps exposed horizontal top surfaces with smooth flat tiles (3068b, 3069b, 2431, 98138).
   */
  private stepTileFinish(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const tileParts = [
      { partId: '3068b', w: 2, d: 2 }, // Tile 2 x 2 Flat
      { partId: '3069b', w: 1, d: 2 }, // Tile 1 x 2 Flat
      { partId: '2431', w: 1, d: 4 },  // Tile 1 x 4 Flat
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

          // If already a tile or slope, top is already smooth
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
            for (const tp of tileParts) {
              for (const isRot of [false, true]) {
                const tw = isRot ? tp.d : tp.w;
                const td = isRot ? tp.w : tp.d;
                const rot: 0 | 90 = isRot ? 90 : 0;

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
                      const variant = connector.fingerprint.variants.get(rot)!;
                      const freedVoxels: Array<{ x: number; z: number; y: number; colorHex: string }> = [];
                      for (const bId of platesToReplace) {
                        const b = this.placedBricks.get(bId);
                        if (b) {
                          const [bx, bz, by] = b.gridPos;
                          const [bw, bd, bh] = b.size;
                          for (let dx = 0; dx < bw; dx++) {
                            for (let dz = 0; dz < bd; dz++) {
                              for (let dy = 0; dy < bh; dy++) {
                                const cx = bx + dx;
                                const cz = bz + dz;
                                const cy = by + dy;
                                const cell = this.grid.grid[cx]?.[cz]?.[cy];
                                if (cell && cell.occupied) {
                                  freedVoxels.push({ x: cx, z: cz, y: cy, colorHex: cell.colorHex });
                                }
                              }
                            }
                          }
                        }
                        this.removeBrick(bId);
                      }

                      const newTile = this.commitBrick(x, z, y, connector, variant, 'TILE_FINISH', 0, placed.colorHex);
                      newBricks.push(newTile);
                      tilesPlaced++;

                      for (const fv of freedVoxels) {
                        if (!this.isCellCovered(fv.x, fv.z, fv.y)) {
                          const p1x1 = CONNECTOR_DATABASE.getConnector('3024');
                          if (p1x1) {
                            const pVar = p1x1.fingerprint.variants.get(0)!;
                            const resPlate = this.commitBrick(fv.x, fv.z, fv.y, p1x1, pVar, 'CORE_EXPANSION', 0, fv.colorHex);
                            newBricks.push(resPlate);
                          }
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (tilesPlaced >= maxTilesPerTick) break;
            }
          }
          break;
        }
      }
    }

    if (tilesPlaced === 0) {
      this.currentPhase = 'DONE';
    }

    return newBricks;
  }

  /**
   * Main simulation execution step.
   * Returns step results and coverage.
   */
  public step(): GrowthStepResult {
    this.stepIndex++;
    let newBricks: PlacedBrick[] = [];

    switch (this.currentPhase) {
      case 'VOLUME_FILL':
        newBricks = this.stepBaseSolidDiscretization();
        break;
      case 'SURFACE_REPLACE':
        newBricks = this.stepSurfaceReplace();
        break;
      case 'TILE_FINISH':
        newBricks = this.stepTileFinish();
        break;
      case 'DONE':
        break;
    }

    const coverageRatio = this.grid.totalOccupied > 0
      ? Math.min(1.0, this.occupiedCellToBrickId.size / this.grid.totalOccupied)
      : 1.0;

    return {
      stepIndex: this.stepIndex,
      phase: this.currentPhase,
      newBrick: newBricks[0],
      newBricks,
      activeHeadsCount: this.heads.filter((h) => h.active).length,
      activeFrontierCount: this.currentPhase === 'DONE' ? 0 : 1,
      totalPlacedBricks: this.placedBricks.size,
      totalPlacedVoxels: this.occupiedCellToBrickId.size,
      totalTargetVoxels: this.grid.totalOccupied,
      coverageRatio,
      bomStats: {
        leafCount: this.bomStats.leafCount,
        edgeCount: this.bomStats.edgeCount,
        fillCount: this.bomStats.fillCount,
        uniquePartCount: this.bomStats.uniqueParts.size
      }
    };
  }

  /**
   * Solves the full model to completion in a single synchronous call.
   */
  public solveAll(maxSteps: number = 3000): GrowthStepResult {
    let res = this.step();
    let steps = 0;
    while (this.currentPhase !== 'DONE' && steps < maxSteps) {
      res = this.step();
      steps++;
    }
    return res;
  }
}
