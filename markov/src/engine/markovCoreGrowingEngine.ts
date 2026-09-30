/**
 * Brickator3000 // Fast 2-Step Markov & WFC Structural Discretization Engine.
 *
 * Fully reworked pipeline operating on 1*1*1 BRICK units (20x20x24 LDU):
 *
 * STEP 1: SOLID STRUCTURAL BASE DISCRETIZATION (Running Bond)
 * - Rapidly discretizes the watertight 3D source volume into solid, authentic LEGO SYSTEM
 *   structural bricks at integer brick dimensions (height = 1 brick):
 *   - Macro Core (N = 8): 2x8, 2x6, 2x4, 1x8, 1x6 Bricks (Royal Blue)
 *   - Mid Running Bond (N = 4): 2x3, 2x2, 1x4, 1x3, 1x2 Bricks (Amber Gold)
 *   - Unit Detail (N = 1): 1x1x1 Bricks 3005, 3062b (Emerald Green)
 * - Enforces alternating layer orientations and running bond seam staggering.
 * - Direct 24-bit RGB color sampling ("Cheat Mode") preserving exact source textures.
 *
 * STEP 2: EXTERIOR SURFACE REPLACEMENT (WFC Boundary Slopes & Curves)
 * - Scans boundary cells exposed to exterior air using authentic surface normal gradients.
 * - Replaces exterior rectangular bricks with authentic LEGO SYSTEM curved slopes (11477, 15068, 60477, 88930),
 *   inverted curved slopes (24201, 3665, 3660), 45° slopes (3040, 3039, 3038), cheese slopes (85984, 54200),
 *   macaroni round corner tiles (27925), and inverted radar dishes (4740, 43898, 3960).
 * - STRICT OUTWARD NORMAL ALIGNMENT: Zero upside-down or reversed slopes.
 * - Hierarchy Level N = 2: Vibrant Magenta.
 * - Refills residual voxels using 2x2, 1x2, and 1x1x1 bricks (never floating plate fragments!).
 *
 * STEP 3: STUDLESS TOP FINISH
 * - Caps exposed top horizontal faces with smooth flat tiles (3068b 2x2, 3069b 1x2, 2431 1x4, 98138 1x1 round).
 * - Hierarchy Level N = 0: Cyan.
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
  SlopeClass,
  WFC_SCALE_COLORS
} from './types';
import { CONNECTOR_DATABASE, LDrawConnectorMeta } from './connectorDatabase';
import { RotatedPieceVariant } from './pieceFingerprint';
import { LDU_STUD_PITCH, LDU_BRICK_HEIGHT } from './connectivityDictionary';
import { WFC_REFINER } from './wfcRefinerEngine';
import { PolishHarmonizer, HarmonizationResult, BuildabilityReport } from './polishHarmonizer';

export interface GrowthHead {
  headId: number;
  name: string;
  colorHex: string;
  active: boolean;
  priorityY: number;
  placedCount: number;
}

export type DiscretizationPhase =
  | 'SURFACE_SHELL'
  | 'CORE_INFILL'
  | 'TILE_FINISH'
  | 'POLISH_HARMONIZATION'
  | 'BUILDABILITY_VERIFY'
  | 'DONE'
  | 'VOLUME_FILL'
  | 'SURFACE_REPLACE';

export interface StructuralPieceSpec {
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  w: number;
  d: number;
  h: number;
  scaleN: 16 | 8 | 4 | 2 | 1;
}

// Scale N = 8: Macro Core Structural Bricks
export const MACRO_CORE_BRICKS: StructuralPieceSpec[] = [
  { partId: '3007', name: 'Brick 2 x 8', category: 'FILL', profile: 'brick', w: 2, d: 8, h: 1, scaleN: 8 },
  { partId: '2456', name: 'Brick 2 x 6', category: 'FILL', profile: 'brick', w: 2, d: 6, h: 1, scaleN: 8 },
  { partId: '3001', name: 'Brick 2 x 4', category: 'FILL', profile: 'brick', w: 2, d: 4, h: 1, scaleN: 8 },
  { partId: '3008', name: 'Brick 1 x 8', category: 'FILL', profile: 'brick', w: 1, d: 8, h: 1, scaleN: 8 },
  { partId: '3009', name: 'Brick 1 x 6', category: 'FILL', profile: 'brick', w: 1, d: 6, h: 1, scaleN: 8 },
];

// Scale N = 4: Mid Running Bond Bricks
export const MID_RUNNING_BOND_BRICKS: StructuralPieceSpec[] = [
  { partId: '3002', name: 'Brick 2 x 3', category: 'FILL', profile: 'brick', w: 2, d: 3, h: 1, scaleN: 4 },
  { partId: '3003', name: 'Brick 2 x 2', category: 'FILL', profile: 'brick', w: 2, d: 2, h: 1, scaleN: 4 },
  { partId: '3010', name: 'Brick 1 x 4', category: 'FILL', profile: 'brick', w: 1, d: 4, h: 1, scaleN: 4 },
  { partId: '3622', name: 'Brick 1 x 3', category: 'FILL', profile: 'brick', w: 1, d: 3, h: 1, scaleN: 4 },
  { partId: '3004', name: 'Brick 1 x 2', category: 'FILL', profile: 'brick', w: 1, d: 2, h: 1, scaleN: 4 },
];

// Scale N = 1: Unit Detail 1*1*1 Bricks
export const UNIT_DETAIL_BRICKS: StructuralPieceSpec[] = [
  { partId: '3005', name: 'Brick 1 x 1', category: 'FILL', profile: 'brick', w: 1, d: 1, h: 1, scaleN: 1 },
  { partId: '3062b', name: 'Brick 1 x 1 Round', category: 'FILL', profile: 'brick', w: 1, d: 1, h: 1, scaleN: 1 }
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
  public currentPhase: DiscretizationPhase = 'SURFACE_SHELL';

  // Layer cursors for smooth animation
  public targetIslandId: number | null = null;
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

  public harmonizationResult: HarmonizationResult | null = null;
  public buildabilityReport: BuildabilityReport | null = null;

  private rng: () => number;

  constructor(grid: VoxelGrid, options: MarkovEngineOptions = {}) {
    this.grid = grid;
    const numHeads = Math.max(1, Math.min(16, options.numHeads ?? 4));

    this.options = {
      seedMode: options.seedMode ?? 'DEEPEST_CORE',
      staggerRunningBond: options.staggerRunningBond ?? true,
      enableModernWeirdParts: options.enableModernWeirdParts ?? true,
      enableStudlessTopFinish: options.enableStudlessTopFinish ?? false,
      directRGBSampling: options.directRGBSampling ?? true,
      randomSeed: options.randomSeed ?? 42,
      maxSteps: options.maxSteps ?? 5000,
      numHeads,
      batchStepSize: options.batchStepSize ?? 16,
      colorMode: options.colorMode ?? 'wfc_hierarchy'
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

    this.initSurfaceCandidates();
    this.currentPhase = this.options.enableModernWeirdParts ? 'SURFACE_SHELL' : 'CORE_INFILL';
    this.baseTilingLayerCursor = 0;
  }

  private cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  public isCellCovered(x: number, z: number, y: number): boolean {
    return this.occupiedCellToBrickId.has(this.cellKey(x, z, y));
  }

  /**
   * Commits a 1*1*1 brick into the model and updates cell mappings and WFC hierarchy color.
   */
  private commitBrick(
    startX: number,
    startZ: number,
    startY: number,
    connector: LDrawConnectorMeta,
    variant: RotatedPieceVariant,
    phase: 'SEED' | 'CORE_EXPANSION' | 'MANTLE' | 'SURFACE_EDGE' | 'LEAF_APEX' | 'TILE_FINISH',
    headId: number = 0,
    forcedColorHex?: string,
    scaleN: 16 | 8 | 4 | 2 | 1 = 4
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
          const hexStr = cell.colorHex.charCodeAt(0) === 35 ? cell.colorHex.slice(1) : cell.colorHex;
          const num = parseInt(hexStr, 16);
          if (!isNaN(num)) {
            sumR += (num >> 16) & 255;
            sumG += (num >> 8) & 255;
            sumB += num & 255;
            count++;
          }
        }
      }

      if (count > 0) {
        const avgR = (sumR / count) | 0;
        const avgG = (sumG / count) | 0;
        const avgB = (sumB / count) | 0;
        colorHex = `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1)}`;
      }
    }

    let dominantIslandId: number | undefined;
    let islandColorHex: string | undefined;
    const islandCounts = new Map<number, number>();

    for (const c of variant.occupiedCells) {
      const cell = this.grid.grid[startX + c.dx]?.[startZ + c.dz]?.[startY + c.dy];
      if (cell && cell.islandId !== undefined) {
        islandCounts.set(cell.islandId, (islandCounts.get(cell.islandId) || 0) + 1);
        if (!islandColorHex && cell.islandColorHex) {
          islandColorHex = cell.islandColorHex;
        }
      }
    }

    if (islandCounts.size > 0) {
      let maxC = 0;
      for (const [id, count] of islandCounts.entries()) {
        if (count > maxC) {
          maxC = count;
          dominantIslandId = id;
        }
      }
    }

    // Island components mode: every brick in the island receives the island's distinct color material
    if (dominantIslandId !== undefined && !forcedColorHex && islandColorHex && this.options.colorMode === 'island_components') {
      colorHex = islandColorHex;
    }

    // 1*1*1 Brick coordinates in LDraw: 20 LDU in X/Z, 24 LDU in Y
    const ldrawX = (startX + variant.widthX / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH + connector.ldrawOffset[0];
    const ldrawZ = -((startZ + variant.depthZ / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH + connector.ldrawOffset[1]);
    const ldrawY = -(startY + variant.heightY) * LDU_BRICK_HEIGHT;

    const scaleColorHex = phase === 'TILE_FINISH' ? WFC_SCALE_COLORS[0] : (WFC_SCALE_COLORS[scaleN] || WFC_SCALE_COLORS[4]);

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
      headId,
      scaleN,
      scaleColorHex,
      islandId: dominantIslandId,
      islandColorHex: islandColorHex || colorHex
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
   * Strictly isolates components: bricks cannot cross between different mesh islands.
   */
  private canFitSolidBlock(
    startX: number,
    startZ: number,
    startY: number,
    wX: number,
    wZ: number,
    hY: number = 1,
    requiredIslandId?: number
  ): boolean {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    if (startX + wX > numStudsX || startZ + wZ > numStudsZ || startY + hY > numPlatesY) return false;

    for (let dx = 0; dx < wX; dx++) {
      for (let dz = 0; dz < wZ; dz++) {
        for (let dy = 0; dy < hY; dy++) {
          const cell = this.grid.grid[startX + dx]?.[startZ + dz]?.[startY + dy];
          if (!cell || !cell.occupied) return false;
          if (this.isCellCovered(startX + dx, startZ + dz, startY + dy)) return false;
          if (requiredIslandId !== undefined && cell.islandId !== undefined && cell.islandId !== requiredIslandId) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Initializes candidate boundary cells for exterior surface shell discretization (Outside-In).
   */
  private initSurfaceCandidates(): void {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    this.surfaceCandidates = [];
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = this.grid.grid[x]?.[z]?.[y];
          if (
            cell &&
            cell.occupied &&
            cell.isBoundary &&
            (this.targetIslandId == null || cell.islandId === this.targetIslandId)
          ) {
            this.surfaceCandidates.push({ x, z, y });
          }
        }
      }
    }

    // Sort surface candidates:
    // 1. Prioritize cells with curved / angled slopes (slope_curved, slope_inverted, slope_33, slope_45, corner_macaroni, spherical_dome)
    // 2. Sort top-down (higher Y first) to lay sweeps (hood, roof, trunk) naturally
    // 3. For cells at the same layer and slope class, sort along the lateral sweep direction for contiguous slope chaining
    this.surfaceCandidates.sort((a, b) => {
      const cellA = this.grid.grid[a.x][a.z][a.y];
      const cellB = this.grid.grid[b.x][b.z][b.y];
      const hasSlopeA = cellA.slopeClass !== 'flat' || cellA.curvatureClass !== 'flat';
      const hasSlopeB = cellB.slopeClass !== 'flat' || cellB.curvatureClass !== 'flat';
      if (hasSlopeA && !hasSlopeB) return -1;
      if (!hasSlopeA && hasSlopeB) return 1;

      if (b.y !== a.y) return b.y - a.y;

      // Group by primary outward heading (Z-facing vs X-facing) to sweep each flank contiguously
      const [nxA, , nzA] = cellA.normal;
      const [nxB, , nzB] = cellB.normal;
      const isZHeadingA = Math.abs(nzA) >= Math.abs(nxA);
      const isZHeadingB = Math.abs(nzB) >= Math.abs(nxB);
      if (isZHeadingA !== isZHeadingB) {
        return isZHeadingA ? -1 : 1;
      }

      // Sweep along lateral run axis
      if (isZHeadingA) {
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
      } else {
        if (a.x !== b.x) return a.x - b.x;
        return a.z - b.z;
      }
    });

    this.surfaceCandidateCursor = 0;
  }

  /**
   * STEP 1: EXTERIOR SURFACE SHELL PASS (WFC SLOPES & CURVES - OUTSIDE-IN)
   * Discretizes boundary cells first using authentic LEGO curved slopes, inverted slopes,
   * 45° slopes, cheese slopes, macaroni, and radar dishes.
   * Multi-stud anchor searching allows 4-stud and 2-stud slopes to fit whenever any portion contains the voxel.
   * WFC OMR transition probability rewards parts that naturally continue adjoining curves.
   * Scale Level: N = 2 (Vibrant Magenta #ec4899).
   */
  private stepSurfaceShell(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    let placedInTick = 0;
    const maxPlacementsPerTick = this.options.batchStepSize ?? 16;

    while (this.surfaceCandidateCursor < this.surfaceCandidates.length && placedInTick < maxPlacementsPerTick) {
      const { x, z, y } = this.surfaceCandidates[this.surfaceCandidateCursor++];
      const cell = this.grid.grid[x]?.[z]?.[y];
      if (!cell || !cell.occupied || this.isCellCovered(x, z, y)) continue;
      if (this.targetIslandId != null && cell.islandId !== this.targetIslandId) continue;

      const islandId = cell.islandId;

      // Compute outward heading from surface normal (nx, ny, nz)
      const [nx, ny, nz] = cell.normal;
      let baseRot: 0 | 90 | 180 | 270 = 0;
      if (Math.abs(nz) >= Math.abs(nx)) {
        baseRot = nz >= 0 ? 0 : 180;
      } else {
        baseRot = nx >= 0 ? 270 : 90;
      }

      // Candidate parts for this surface feature - LARGEST & LONGEST FIRST!
      const candidatePartIds: string[] = [];

      // 1. Curved Slopes (Convex outer surfaces) - ONLY curved profiles, never flat 45° slopes
      if (cell.slopeClass === 'slope_curved' || cell.curvatureClass === 'cylindrical_convex') {
        candidatePartIds.push('88930', '61678', '15068', '11477', '85984');
      }

      // 2. Inverted Slopes (Underhangs)
      if (cell.slopeClass === 'slope_inverted') {
        candidatePartIds.push('93273', '24201', '3665', '3660');
      }

      // 3. Cheese Slopes & 33° Slopes
      if (cell.slopeClass === 'slope_33') {
        candidatePartIds.push('3298', '85984', '54200');
      }

      // 4. 45° Slopes
      if (cell.slopeClass === 'slope_45') {
        candidatePartIds.push('3038', '3039', '3040');
      }

      // 5. Macaroni & Round Corners
      if (cell.curvatureClass === 'corner_macaroni') {
        candidatePartIds.push('27925', '25269', '2357');
      }

      // 6. Spherical Dome Apex
      if (cell.curvatureClass === 'spherical_dome' && ny > 0.6) {
        candidatePartIds.push('4740', '43898', '3960');
      }

      // 7. General Boundary Fallback
      if (candidatePartIds.length === 0) {
        if (cell.slopeClass === 'slope_curved') {
          candidatePartIds.push('88930', '61678', '15068', '11477', '85984');
        } else if (cell.slopeClass === 'slope_45') {
          candidatePartIds.push('3038', '3039', '3040');
        } else if (cell.slopeClass === 'slope_33') {
          candidatePartIds.push('3298', '85984');
        } else {
          candidatePartIds.push('3068b', '3069b', '2431', '3010', '3004', '3005');
        }
      }

      // Neighbor directions for WFC OMR transition probability
      const neighbors = [
        { dx: 1, dz: 0, dy: 0, dir: '+X' as const },
        { dx: -1, dz: 0, dy: 0, dir: '-X' as const },
        { dx: 0, dz: 1, dy: 0, dir: '+Z' as const },
        { dx: 0, dz: -1, dy: 0, dir: '-Z' as const },
        { dx: 0, dz: 0, dy: 1, dir: '+Y' as const },
        { dx: 0, dz: 0, dy: -1, dir: '-Y' as const }
      ];

      // Score candidates: base priority (larger first) + WFC OMR transition boost
      const scoredCandidates = candidatePartIds.map((partId, idx) => {
        let maxProb = 0;
        for (const n of neighbors) {
          const nKey = this.cellKey(x + n.dx, z + n.dz, y + n.dy);
          const nBrickId = this.occupiedCellToBrickId.get(nKey);
          if (nBrickId) {
            const nBrick = this.placedBricks.get(nBrickId);
            if (nBrick) {
              const prob = WFC_REFINER.getTransitionProbability(nBrick.partId, n.dir, partId);
              if (prob > maxProb) maxProb = prob;
            }
          }
        }
        const score = (candidatePartIds.length - idx) * 10 + maxProb * 50;
        return { partId, score };
      });

      scoredCandidates.sort((a, b) => b.score - a.score);

      // Global best placement across all candidate parts, rotations, and anchor offsets
      let bestPlacement: {
        connector: any;
        variant: RotatedPieceVariant;
        anchor: { startX: number; startZ: number; startY: number };
        score: number;
      } | null = null;

      for (const item of scoredCandidates) {
        const candidatePartId = item.partId;
        const connector = CONNECTOR_DATABASE.getConnector(candidatePartId);
        if (!connector) continue;

        // Directional slopes must strictly follow outward normal heading (baseRot) - NEVER flipped 180° or sideways!
        const isDirectionalSlope =
          connector.profile === 'slope_curved' ||
          connector.profile === 'slope_inverted' ||
          connector.profile === 'slope_33' ||
          connector.profile === 'slope_45' ||
          connector.profile === 'cheese';

        const rotationsToTry: Array<0 | 90 | 180 | 270> = [baseRot];
        if (!isDirectionalSlope && (cell.curvatureClass === 'spherical_dome' || cell.slopeClass === 'flat')) {
          rotationsToTry.push(
            ((baseRot + 90) % 360) as any,
            ((baseRot + 180) % 360) as any,
            ((baseRot + 270) % 360) as any
          );
        }

        for (const rot of rotationsToTry) {
          const variant: RotatedPieceVariant | undefined = connector.fingerprint.variants.get(rot);
          if (!variant) continue;

          const wX = variant.widthX;
          const dZ = variant.depthZ;
          const hY = variant.heightY;

          // Test multi-stud anchor offsets so the piece can contain (x, z, y) at any position
          for (let ci = 0; ci < variant.occupiedCells.length; ci++) {
            const cellOffset: { dx: number; dz: number; dy: number } = variant.occupiedCells[ci];
            const startX: number = x - cellOffset.dx;
            const startZ: number = z - cellOffset.dz;
            const startY: number = y - cellOffset.dy;

            if (
              startX < 0 ||
              startZ < 0 ||
              startY < 0 ||
              startX + wX > numStudsX ||
              startZ + dZ > numStudsZ ||
              startY + hY > numPlatesY
            ) {
              continue;
            }

            let fits = true;
            for (let oi = 0; oi < variant.occupiedCells.length; oi++) {
              const offset: { dx: number; dz: number; dy: number } = variant.occupiedCells[oi];
              const gx = startX + offset.dx;
              const gz = startZ + offset.dz;
              const gy = startY + offset.dy;
              const cCell = this.grid.grid[gx]?.[gz]?.[gy];
              if (!cCell || !cCell.occupied || this.isCellCovered(gx, gz, gy)) {
                fits = false;
                break;
              }
              if (islandId !== undefined && cCell.islandId !== undefined && cCell.islandId !== islandId) {
                fits = false;
                break;
              }
            }

            if (fits) {
              // Base score combines candidate ranking and larger piece footprint
              let anchorScore = item.score + variant.occupiedCells.length * 20;

              // Lateral slope continuity bonus: check if adjacent in lateral run has matching slope & heading
              const isZHeading = rot === 0 || rot === 180;
              if (isZHeading) {
                const leftId = this.occupiedCellToBrickId.get(this.cellKey(startX - 1, startZ, startY));
                const rightId = this.occupiedCellToBrickId.get(this.cellKey(startX + wX, startZ, startY));
                if (leftId) {
                  const nb = this.placedBricks.get(leftId);
                  if (nb && nb.profile === connector.profile && nb.rotation === rot) {
                    anchorScore += 120;
                    if (nb.partId === candidatePartId) anchorScore += 60;
                  }
                }
                if (rightId) {
                  const nb = this.placedBricks.get(rightId);
                  if (nb && nb.profile === connector.profile && nb.rotation === rot) {
                    anchorScore += 120;
                    if (nb.partId === candidatePartId) anchorScore += 60;
                  }
                }
              } else {
                const frontId = this.occupiedCellToBrickId.get(this.cellKey(startX, startZ - 1, startY));
                const backId = this.occupiedCellToBrickId.get(this.cellKey(startX, startZ + dZ, startY));
                if (frontId) {
                  const nb = this.placedBricks.get(frontId);
                  if (nb && nb.profile === connector.profile && nb.rotation === rot) {
                    anchorScore += 120;
                    if (nb.partId === candidatePartId) anchorScore += 60;
                  }
                }
                if (backId) {
                  const nb = this.placedBricks.get(backId);
                  if (nb && nb.profile === connector.profile && nb.rotation === rot) {
                    anchorScore += 120;
                    if (nb.partId === candidatePartId) anchorScore += 60;
                  }
                }
              }

              if (!bestPlacement || anchorScore > bestPlacement.score) {
                bestPlacement = {
                  connector,
                  variant,
                  anchor: { startX, startZ, startY },
                  score: anchorScore
                };
              }
            }
          }
        }
      }

      if (bestPlacement) {
        const headId = (bestPlacement.anchor.startX + bestPlacement.anchor.startZ + bestPlacement.anchor.startY) % this.heads.length;
        const b = this.commitBrick(
          bestPlacement.anchor.startX,
          bestPlacement.anchor.startZ,
          bestPlacement.anchor.startY,
          bestPlacement.connector,
          bestPlacement.variant,
          'SURFACE_EDGE',
          headId,
          undefined,
          2
        );
        newBricks.push(b);
        placedInTick++;
      }
    }

    if (this.surfaceCandidateCursor >= this.surfaceCandidates.length) {
      this.currentPhase = 'CORE_INFILL';
      this.baseTilingLayerCursor = 0;
    }

    return newBricks;
  }

  /**
   * STEP 2: MACRO STRUCTURAL CORE INFILL (Running Bond - INSIDE-OUT)
   * Fills remaining interior voxels with solid LEGO SYSTEM bricks:
   * - Macro Core (N = 8): 2x8, 2x6, 2x4, 1x8, 1x6 Bricks (Royal Blue)
   * - Mid Running Bond (N = 4): 2x3, 2x2, 1x4, 1x3, 1x2 Bricks (Amber Gold)
   * - Unit Detail (N = 1): 1x1x1 Bricks 3005, 3062b (Emerald Green)
   */
  private stepCoreInfill(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    const y = this.baseTilingLayerCursor;
    if (y >= numPlatesY) {
      if (this.options.enableStudlessTopFinish) {
        this.currentPhase = 'TILE_FINISH';
        this.tileFinishCursor = 0;
      } else {
        this.currentPhase = 'DONE';
      }
      return newBricks;
    }

    const isEvenLayer = y % 2 === 0;
    const staggerX = isEvenLayer ? 0 : 1;
    const staggerZ = isEvenLayer ? 1 : 0;
    const orientations = isEvenLayer ? [false, true] : [true, false];

    for (let xStep = 0; xStep < numStudsX; xStep++) {
      const x = (xStep + staggerX) % numStudsX;
      for (let zStep = 0; zStep < numStudsZ; zStep++) {
        const z = (zStep + staggerZ) % numStudsZ;

        const cell = this.grid.grid[x]?.[z]?.[y];
        if (!cell || !cell.occupied || this.isCellCovered(x, z, y)) continue;
        if (this.targetIslandId != null && cell.islandId !== this.targetIslandId) continue;

        const islandId = cell.islandId;
        let placed = false;

        // 1. Try Macro Core Bricks (Scale N = 8: 2x8, 2x6, 2x4, 1x8, 1x6)
        for (const spec of MACRO_CORE_BRICKS) {
          for (const isRot of orientations) {
            const bw = isRot ? spec.d : spec.w;
            const bd = isRot ? spec.w : spec.d;
            const rot: 0 | 90 = isRot ? 90 : 0;

            if (this.canFitSolidBlock(x, z, y, bw, bd, 1, islandId)) {
              const connector = CONNECTOR_DATABASE.getConnector(spec.partId);
              if (connector) {
                const variant = connector.fingerprint.variants.get(rot)!;
                const headId = (x + z + y) % this.heads.length;
                const b = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', headId, undefined, spec.scaleN);
                newBricks.push(b);
                placed = true;
                break;
              }
            }
          }
          if (placed) break;
        }

        // 2. Try Mid Running Bond Bricks (Scale N = 4: 2x3, 2x2, 1x4, 1x3, 1x2)
        if (!placed) {
          for (const spec of MID_RUNNING_BOND_BRICKS) {
            for (const isRot of orientations) {
              const bw = isRot ? spec.d : spec.w;
              const bd = isRot ? spec.w : spec.d;
              const rot: 0 | 90 = isRot ? 90 : 0;

              if (this.canFitSolidBlock(x, z, y, bw, bd, 1, islandId)) {
                const connector = CONNECTOR_DATABASE.getConnector(spec.partId);
                if (connector) {
                  const variant = connector.fingerprint.variants.get(rot)!;
                  const headId = (x + z + y) % this.heads.length;
                  const b = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', headId, undefined, spec.scaleN);
                  newBricks.push(b);
                  placed = true;
                  break;
                }
              }
            }
            if (placed) break;
          }
        }

        // 3. Fallback to Unit 1*1*1 Brick (Scale N = 1: 3005, 3062b)
        if (!placed) {
          for (const spec of UNIT_DETAIL_BRICKS) {
            if (this.canFitSolidBlock(x, z, y, 1, 1, 1, islandId)) {
              const connector = CONNECTOR_DATABASE.getConnector(spec.partId);
              if (connector) {
                const variant = connector.fingerprint.variants.get(0)!;
                const headId = (x + z + y) % this.heads.length;
                const b = this.commitBrick(x, z, y, connector, variant, 'CORE_EXPANSION', headId, undefined, spec.scaleN);
                newBricks.push(b);
                placed = true;
                break;
              }
            }
          }
        }
      }
    }

    this.baseTilingLayerCursor++;

    if (this.baseTilingLayerCursor >= numPlatesY) {
      if (this.options.enableStudlessTopFinish) {
        this.currentPhase = 'TILE_FINISH';
        this.tileFinishCursor = 0;
      } else {
        this.currentPhase = 'DONE';
      }
    }

    return newBricks;
  }

  /**
   * STEP 3: STUDLESS TOP FINISH PASS
   * Caps exposed horizontal top surfaces with smooth flat tiles (3068b, 3069b, 2431, 98138).
   * Hierarchy Level N = 0 (Cyan #06b6d4).
   */
  private stepTileFinish(): PlacedBrick[] {
    const newBricks: PlacedBrick[] = [];
    const tileCatalog = [
      { partId: '87079', w: 2, d: 4, name: 'Tile 2 x 4' },
      { partId: '3068b', w: 2, d: 2, name: 'Tile 2 x 2 Flat' },
      { partId: '2431',  w: 1, d: 4, name: 'Tile 1 x 4 Flat' },
      { partId: '6636',  w: 1, d: 6, name: 'Tile 1 x 6 Flat' },
      { partId: '3069b', w: 1, d: 2, name: 'Tile 1 x 2 Flat' },
      { partId: '98138', w: 1, d: 1, name: 'Tile 1 x 1 Round Flat' }
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
          if (this.targetIslandId != null && placed.islandId !== this.targetIslandId) break;

          // Only standard uncapped bricks/plates are candidates for studless finishing
          if (
            placed.profile === 'tile_flat' ||
            placed.profile === 'slope_curved' ||
            placed.profile === 'slope_inverted' ||
            placed.profile === 'cheese' ||
            placed.profile === 'macaroni' ||
            placed.profile === 'dish' ||
            placed.growthPhase === 'TILE_FINISH'
          ) {
            break;
          }

          // Verify that the top face of the brick is fully exposed to the outside
          const topFaceY = placed.gridPos[2] + placed.size[2];
          let isFullyExposed = true;
          for (let bx = 0; bx < placed.size[0] && isFullyExposed; bx++) {
            for (let bz = 0; bz < placed.size[1] && isFullyExposed; bz++) {
              const gx = placed.gridPos[0] + bx;
              const gz = placed.gridPos[1] + bz;
              if (topFaceY < numPlatesY && this.occupiedCellToBrickId.has(this.cellKey(gx, gz, topFaceY))) {
                isFullyExposed = false;
              }
            }
          }
          if (!isFullyExposed) break;

          // Find exact matching authentic tile by footprint
          const bw = placed.size[0];
          const bd = placed.size[1];
          const matchingTile = tileCatalog.find(
            (tp) => (tp.w === bw && tp.d === bd) || (tp.w === bd && tp.d === bw)
          );

          if (matchingTile) {
            placed.profile = 'tile_flat';
            placed.partId = matchingTile.partId;
            placed.name = matchingTile.name;
            placed.growthPhase = 'TILE_FINISH';
            placed.scaleN = 1;
            placed.scaleColorHex = WFC_SCALE_COLORS[0]; // Cyan tile finish
            tilesPlaced++;
          }
          break;
        }
      }
    }

    if (tilesPlaced === 0) {
      this.currentPhase = 'POLISH_HARMONIZATION';
    }

    return newBricks;
  }

  /**
   * Harmonization step: smoothens slopes and unifies fragmented pieces.
   */
  public stepPolishHarmonization(): PlacedBrick[] {
    this.harmonizationResult = PolishHarmonizer.harmonizeNeighborhoods(
      this.placedBricks,
      this.occupiedCellToBrickId,
      this.grid
    );
    this.currentPhase = 'BUILDABILITY_VERIFY';
    return [];
  }

  /**
   * Buildability step: runs BFS grounding and interlocking verification.
   */
  public stepBuildabilityVerify(): PlacedBrick[] {
    this.buildabilityReport = PolishHarmonizer.verifyBuildability(
      this.placedBricks,
      this.occupiedCellToBrickId,
      this.grid
    );
    this.currentPhase = 'DONE';
    return [];
  }

  public harmonizeNeighborhoods(): HarmonizationResult {
    this.harmonizationResult = PolishHarmonizer.harmonizeNeighborhoods(
      this.placedBricks,
      this.occupiedCellToBrickId,
      this.grid
    );
    return this.harmonizationResult;
  }

  public verifyBuildability(): BuildabilityReport {
    this.buildabilityReport = PolishHarmonizer.verifyBuildability(
      this.placedBricks,
      this.occupiedCellToBrickId,
      this.grid
    );
    return this.buildabilityReport;
  }

  /**
   * Main simulation execution step.
   * Returns step results and coverage.
   */
  public step(): GrowthStepResult {
    this.stepIndex++;
    let newBricks: PlacedBrick[] = [];

    switch (this.currentPhase) {
      case 'SURFACE_SHELL':
        newBricks = this.stepSurfaceShell();
        break;
      case 'CORE_INFILL':
        newBricks = this.stepCoreInfill();
        break;
      case 'TILE_FINISH':
        newBricks = this.stepTileFinish();
        break;
      case 'POLISH_HARMONIZATION':
        newBricks = this.stepPolishHarmonization();
        break;
      case 'BUILDABILITY_VERIFY':
        newBricks = this.stepBuildabilityVerify();
        break;
      case 'DONE':
        break;
      case 'VOLUME_FILL':
        newBricks = this.stepCoreInfill();
        break;
      case 'SURFACE_REPLACE':
        newBricks = this.stepSurfaceShell();
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

  /**
   * Solves a single isolated island through all 3 discretization phases.
   */
  public solveSingleIsland(islandId: number, maxSteps: number = 1000): GrowthStepResult {
    this.targetIslandId = islandId;
    this.initSurfaceCandidates();
    this.currentPhase = this.options.enableModernWeirdParts ? 'SURFACE_SHELL' : 'CORE_INFILL';
    this.baseTilingLayerCursor = 0;
    let steps = 0;
    let res = this.step();
    while (res.phase !== 'DONE' && steps < maxSteps) {
      res = this.step();
      steps++;
    }
    this.targetIslandId = null;
    return res;
  }

  /**
   * Discretizes all islands independently one by one with dedicated seed cores.
   */
  public solveAllIslandsIndependently(maxStepsPerIsland: number = 1000): GrowthStepResult {
    const islands = this.grid.islands || [];
    if (islands.length === 0) {
      return this.solveAll(maxStepsPerIsland);
    }
    let lastRes: GrowthStepResult = this.solveSingleIsland(islands[0].id, maxStepsPerIsland);
    for (let i = 1; i < islands.length; i++) {
      lastRes = this.solveSingleIsland(islands[i].id, maxStepsPerIsland);
    }
    this.harmonizeNeighborhoods();
    this.verifyBuildability();
    return lastRes;
  }
}
