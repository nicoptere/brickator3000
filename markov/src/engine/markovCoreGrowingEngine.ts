/**
 * Multi-Head Markov Core Growing Engine.
 *
 * Implements high-throughput parallel frontier growth across multiple heads:
 * 1. Allocates N independent Growth Heads across distinct spatial sectors
 *    (Core spine, Ground foundation +X/+Z, Ground foundation -X/-Z, Top apex, Lateral flanks).
 * 2. In each tick, all N heads simultaneously fire Markov rewrite rules, placing
 *    multiple interlocking pieces in parallel without collisions.
 * 3. Uses O(1) candidate spatial pruning (querying pre-indexed catalog dimensions)
 *    to eliminate combinatorial bottleneck across 200+ authentic LDraw connectors.
 * 4. Seamlessly transitions from deep core structural FILL (with interlocking running bond)
 *    to surface EDGE (curved slopes, 45° slopes, macaroni) and LEAF (creature teeth, horns, dishes).
 * 5. Applies studless smooth flat tiles to exposed top horizontal surfaces.
 */

import {
  VoxelGrid,
  VoxelCell,
  PlacedBrick,
  FrontierPoint,
  GrowthStepResult,
  MarkovEngineOptions,
  PieceCategory,
  CurvatureClass,
  SlopeClass
} from './types';
import { CONNECTOR_DATABASE, LDrawConnectorMeta } from './connectorDatabase';
import { RotatedPieceVariant } from './pieceFingerprint';
import { LDU_STUD_PITCH, LDU_PLATE_HEIGHT, evaluateClutchAndBond } from './connectivityDictionary';

export interface GrowthHead {
  headId: number;
  name: string;
  colorHex: string;
  active: boolean;
  priorityY: number; // Preferred layer or sector
  placedCount: number;
}

export class MarkovCoreGrowingEngine {
  public grid: VoxelGrid;
  public options: MarkovEngineOptions;

  public placedBricks: Map<string, PlacedBrick> = new Map();
  public occupiedCellToBrickId: Map<string, string> = new Map(); // "x,z,y" -> brickId
  public brickIdToPartId: Map<string, string> = new Map(); // brickId -> partId

  // Multi-Head Management
  public heads: GrowthHead[] = [];
  public activeFrontiersByHead: Map<number, FrontierPoint[]> = new Map();
  public globalFrontier: FrontierPoint[] = [];

  public stepIndex: number = 0;
  public currentPhase: 'SEED' | 'CORE_EXPANSION' | 'MANTLE' | 'SURFACE_EDGE' | 'LEAF_APEX' | 'TILE_FINISH' | 'DONE' = 'SEED';

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
      batchStepSize: options.batchStepSize ?? numHeads
    };

    let s = this.options.randomSeed!;
    this.rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    this.initMultiHeads();
  }

  private cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  private isCellCovered(x: number, z: number, y: number): boolean {
    return this.occupiedCellToBrickId.has(this.cellKey(x, z, y));
  }

  /**
   * Initializes N spatially distributed Growth Heads.
   */
  private initMultiHeads(): void {
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
        priorityY: i === 0 ? cy : (i === 1 ? 0 : (i === 2 ? Math.min(numPlatesY - 1, cy + 6) : 0)),
        placedCount: 0
      });
      this.activeFrontiersByHead.set(i, []);
    }

    // Seed 0: Deepest Core
    this.activeFrontiersByHead.get(0)!.push({
      x: cx,
      z: cz,
      y: Math.max(0, Math.floor(cy / 3) * 3),
      depth: this.grid.grid[cx]?.[cz]?.[cy]?.depth ?? 3,
      priority: 100,
      expectedCategory: 'FILL',
      expectedNormal: [0, 1, 0],
      supportingStudsCount: cy === 0 ? 8 : 4,
      assignedHeadId: 0
    });

    // Seed 1: Grounded Base (+X, +Z)
    if (numHeads > 1) {
      const bx = Math.min(numStudsX - 1, cx + 1);
      const bz = Math.min(numStudsZ - 1, cz + 1);
      this.activeFrontiersByHead.get(1)!.push({
        x: bx,
        z: bz,
        y: 0,
        depth: this.grid.grid[bx]?.[bz]?.[0]?.depth ?? 1,
        priority: 95,
        expectedCategory: 'FILL',
        expectedNormal: [0, 1, 0],
        supportingStudsCount: 8,
        assignedHeadId: 1
      });
    }

    // Seed 2: Grounded Base (-X, -Z)
    if (numHeads > 2) {
      const bx2 = Math.max(0, cx - 1);
      const bz2 = Math.max(0, cz - 1);
      this.activeFrontiersByHead.get(2)!.push({
        x: bx2,
        z: bz2,
        y: 0,
        depth: this.grid.grid[bx2]?.[bz2]?.[0]?.depth ?? 1,
        priority: 95,
        expectedCategory: 'FILL',
        expectedNormal: [0, 1, 0],
        supportingStudsCount: 8,
        assignedHeadId: 2
      });
    }

    // Seed 3: Upper Spine
    if (numHeads > 3) {
      const topY = Math.min(numPlatesY - 3, Math.max(0, cy + 3));
      this.activeFrontiersByHead.get(3)!.push({
        x: cx,
        z: cz,
        y: topY,
        depth: this.grid.grid[cx]?.[cz]?.[topY]?.depth ?? 2,
        priority: 90,
        expectedCategory: 'FILL',
        expectedNormal: [0, 1, 0],
        supportingStudsCount: 4,
        assignedHeadId: 3
      });
    }
  }

  /**
   * Fast O(1) probe of maximum unoccupied solid bounding box starting at (x, z, y).
   */
  private probeFreeSolidBox(startX: number, startZ: number, startY: number): [number, number, number] {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    // Check height in plates (1 to 3)
    let maxH = 0;
    for (let dy = 0; dy < 3; dy++) {
      const gy = startY + dy;
      if (gy >= numPlatesY) break;
      const cell = this.grid.grid[startX]?.[startZ]?.[gy];
      if (!cell || !cell.occupied || this.isCellCovered(startX, startZ, gy)) break;
      maxH++;
    }
    if (maxH === 0) return [0, 0, 0];

    // Check width in X studs (up to 8)
    let maxW = 0;
    for (let dx = 0; dx < 8; dx++) {
      const gx = startX + dx;
      if (gx >= numStudsX) break;
      let colFree = true;
      for (let dy = 0; dy < maxH; dy++) {
        const cell = this.grid.grid[gx]?.[startZ]?.[startY + dy];
        if (!cell || !cell.occupied || this.isCellCovered(gx, startZ, startY + dy)) {
          colFree = false;
          break;
        }
      }
      if (!colFree) break;
      maxW++;
    }

    // Check depth in Z studs (up to 8)
    let maxD = 0;
    for (let dz = 0; dz < 8; dz++) {
      const gz = startZ + dz;
      if (gz >= numStudsZ) break;
      let rowFree = true;
      for (let dx = 0; dx < maxW; dx++) {
        for (let dy = 0; dy < maxH; dy++) {
          const cell = this.grid.grid[startX + dx]?.[gz]?.[startY + dy];
          if (!cell || !cell.occupied || this.isCellCovered(startX + dx, gz, startY + dy)) {
            rowFree = false;
            break;
          }
        }
        if (!rowFree) break;
      }
      if (!rowFree) break;
      maxD++;
    }

    return [maxW, maxD, maxH];
  }

  /**
   * Fast bitwise validation: Can a piece variant fit at (startX, startZ, startY)?
   */
  private canFitPiece(
    startX: number,
    startZ: number,
    startY: number,
    variant: RotatedPieceVariant
  ): boolean {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    if (
      startX < 0 ||
      startZ < 0 ||
      startY < 0 ||
      startX + variant.widthX > numStudsX ||
      startZ + variant.depthZ > numStudsZ ||
      startY + variant.heightY > numPlatesY
    ) {
      return false;
    }

    for (const c of variant.occupiedCells) {
      const gx = startX + c.dx;
      const gz = startZ + c.dz;
      const gy = startY + c.dy;

      if (this.isCellCovered(gx, gz, gy)) return false;
      const cell = this.grid.grid[gx]?.[gz]?.[gy];
      if (!cell || !cell.occupied) return false;
    }

    return true;
  }

  /**
   * Commits a placed piece to the model, updating occupied grids and expanding frontiers.
   */
  private commitPiece(
    startX: number,
    startZ: number,
    startY: number,
    connector: LDrawConnectorMeta,
    variant: RotatedPieceVariant,
    phase: PlacedBrick['growthPhase'],
    clutchScore: number,
    headId: number,
    parentIds: string[] = []
  ): PlacedBrick {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    const brickId = `b_${this.stepIndex}_h${headId}_${connector.partId}_${startX}_${startY}_${startZ}`;

    // Sample dominant diffuse/vertex color (Cheat Mode direct RGB)
    let sumR = 0, sumG = 0, sumB = 0;
    let colorCode = 15;
    let colorHex = '#e2e8f0';
    let colorName = 'White';

    for (const c of variant.occupiedCells) {
      const cell = this.grid.grid[startX + c.dx][startZ + c.dz][startY + c.dy];
      if (cell) {
        colorCode = cell.colorCode;
        colorHex = cell.colorHex;
        colorName = cell.colorName;

        const cleanHex = colorHex.replace('#', '');
        sumR += parseInt(cleanHex.substring(0, 2), 16) || 200;
        sumG += parseInt(cleanHex.substring(2, 4), 16) || 200;
        sumB += parseInt(cleanHex.substring(4, 6), 16) || 200;
      }
    }

    if (this.options.directRGBSampling && variant.occupiedCells.length > 0) {
      const avgR = Math.round(sumR / variant.occupiedCells.length);
      const avgG = Math.round(sumG / variant.occupiedCells.length);
      const avgB = Math.round(sumB / variant.occupiedCells.length);
      colorHex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
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
      stepIndex: this.stepIndex,
      growthPhase: phase,
      clutchScore,
      parentBrickIds: parentIds,
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

    // BOM stats
    if (connector.category === 'LEAF') this.bomStats.leafCount++;
    else if (connector.category === 'EDGE') this.bomStats.edgeCount++;
    else if (connector.category === 'FILL') this.bomStats.fillCount++;
    this.bomStats.uniqueParts.add(connector.partId);

    this.heads[headId].placedCount++;

    // Expand Frontier for this head
    this.expandFrontierAround(startX, startZ, startY, variant, headId);

    return placed;
  }

  /**
   * Expands frontier for the specific growth head.
   */
  private expandFrontierAround(
    startX: number,
    startZ: number,
    startY: number,
    variant: RotatedPieceVariant,
    headId: number
  ): void {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    const frontierQueue = this.activeFrontiersByHead.get(headId) || this.globalFrontier;

    // 1. Top connection points (growth upward)
    const topY = startY + variant.heightY;
    if (topY >= 0 && topY < numPlatesY) {
      for (const stud of variant.topStuds) {
        const gx = Math.floor(startX + stud.dx);
        const gz = Math.floor(startZ + stud.dz);
        if (gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ) {
          const cell = this.grid.grid[gx]?.[gz]?.[topY];
          if (cell && cell.occupied && !this.isCellCovered(gx, gz, topY)) {
            frontierQueue.push({
              x: gx,
              z: gz,
              y: topY,
              depth: cell.depth,
              priority: cell.depth >= 2 ? 80 : 60,
              expectedCategory: cell.depth >= 2 ? 'FILL' : 'EDGE',
              expectedNormal: cell.normal,
              supportingStudsCount: 1,
              assignedHeadId: headId
            });
          }
        }
      }
    }

    // 2. Lateral perimeter points (growth outward)
    const perimeter = [
      { dx: -1, dz: 0 }, { dx: variant.widthX, dz: 0 },
      { dx: 0, dz: -1 }, { dx: 0, dz: variant.depthZ }
    ];

    for (const p of perimeter) {
      const gx = Math.floor(startX + p.dx);
      const gz = Math.floor(startZ + p.dz);
      const gy = startY;

      if (gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ && gy >= 0 && gy < numPlatesY) {
        const cell = this.grid.grid[gx]?.[gz]?.[gy];
        if (cell && cell.occupied && !this.isCellCovered(gx, gz, gy)) {
          frontierQueue.push({
            x: gx,
            z: gz,
            y: gy,
            depth: cell.depth,
            priority: cell.depth >= 2 ? 75 : 50,
            expectedCategory: cell.depth >= 2 ? 'FILL' : 'EDGE',
            expectedNormal: cell.normal,
            supportingStudsCount: gy === 0 ? 1 : 0,
            assignedHeadId: headId
          });
        }
      }
    }
  }

  /**
   * Executes a single multi-head growth step. All active heads fire concurrently!
   */
  public step(): GrowthStepResult {
    this.stepIndex++;
    const newBricks: PlacedBrick[] = [];

    // All heads attempt to place a piece in this tick
    for (const head of this.heads) {
      if (!head.active) continue;

      const placed = this.stepHead(head.headId);
      if (placed) {
        newBricks.push(placed);
      }
    }

    // Check if finished
    if (newBricks.length === 0) {
      // Check if all voxels covered
      if (this.occupiedCellToBrickId.size < this.grid.totalOccupied) {
        // Fallback pass: scan and cover any remaining isolated cells
        const uncovered = this.findNextUncoveredCell();
        if (uncovered) {
          const fallback = this.stepHeadAt(uncovered.x, uncovered.z, uncovered.y, 0);
          if (fallback) newBricks.push(fallback);
        }
      } else {
        if (this.options.enableStudlessTopFinish && this.currentPhase !== 'TILE_FINISH') {
          this.currentPhase = 'TILE_FINISH';
          const tile = this.applyStudlessTopTile();
          if (tile) newBricks.push(tile);
        } else {
          this.currentPhase = 'DONE';
        }
      }
    } else {
      if (this.currentPhase === 'SEED') {
        this.currentPhase = 'CORE_EXPANSION';
      }
    }

    return this.formatStepResult(newBricks);
  }

  /**
   * Executes one placement attempt for a specific growth head.
   */
  private stepHead(headId: number): PlacedBrick | null {
    const queue = this.activeFrontiersByHead.get(headId);
    if (!queue || queue.length === 0) {
      // Steal or scan a point in this head's spatial region
      const altPt = this.findUncoveredCellForHead(headId);
      if (!altPt) return null;
      return this.stepHeadAt(altPt.x, altPt.z, altPt.y, headId);
    }

    while (queue.length > 0) {
      const pt = queue.pop()!;
      if (!this.isCellCovered(pt.x, pt.z, pt.y)) {
        return this.stepHeadAt(pt.x, pt.z, pt.y, headId);
      }
    }

    return null;
  }

  /**
   * Fast O(1) piece matching & placement at target coordinate (tx, tz, ty).
   */
  private stepHeadAt(tx: number, tz: number, ty: number, headId: number): PlacedBrick | null {
    const cell = this.grid.grid[tx]?.[tz]?.[ty];
    if (!cell || !cell.occupied || this.isCellCovered(tx, tz, ty)) return null;

    // Fast probe of available solid space
    const [maxW, maxD, maxH] = this.probeFreeSolidBox(tx, tz, ty);

    let candidates: LDrawConnectorMeta[] = [];
    let phase: PlacedBrick['growthPhase'] = 'CORE_EXPANSION';

    if (cell.isBoundary || cell.depth <= 1) {
      phase = 'SURFACE_EDGE';

      // 1. Check dome / apex
      if (cell.curvatureClass === 'spherical_dome') {
        candidates.push(...(CONNECTOR_DATABASE.leafByProfile.get('dish') || []));
      }

      // 2. Check sharp cusp / Bionicle teeth
      if (cell.curvatureClass === 'sharp_cusp' && this.options.enableModernWeirdParts) {
        candidates.push(...(CONNECTOR_DATABASE.leafByProfile.get('tooth_creature') || []));
      }

      // 3. Check macaroni corners
      if (cell.curvatureClass === 'corner_macaroni' && this.options.enableModernWeirdParts) {
        candidates.push(...(CONNECTOR_DATABASE.edgeByCurvature.get('corner_macaroni') || []));
      }

      // 4. Check slopes and curved slopes
      if (cell.slopeClass === 'slope_curved' && this.options.enableModernWeirdParts) {
        candidates.push(...(CONNECTOR_DATABASE.edgeBySlope.get('slope_curved') || []));
      } else if (cell.slopeClass === 'slope_45') {
        candidates.push(...(CONNECTOR_DATABASE.edgeBySlope.get('slope_45') || []));
      } else if (cell.slopeClass === 'slope_33') {
        candidates.push(...(CONNECTOR_DATABASE.edgeBySlope.get('slope_33') || []));
      } else if (cell.slopeClass === 'slope_inverted') {
        candidates.push(...(CONNECTOR_DATABASE.edgeBySlope.get('slope_inverted') || []));
      }

      // 5. Add boundary structural bricks/plates
      candidates.push(...CONNECTOR_DATABASE.queryBestFillPieces(Math.min(4, maxW), Math.min(4, maxD), maxH >= 3 ? 3 : 1));
    } else {
      phase = cell.depth === 2 ? 'MANTLE' : 'CORE_EXPANSION';
      // Fast O(1) query for largest fitting structural FILL pieces
      candidates = CONNECTOR_DATABASE.queryBestFillPieces(maxW, maxD, maxH >= 3 ? 3 : 1);
    }

    // Evaluate candidates
    let bestConnector: LDrawConnectorMeta | null = null;
    let bestVariant: RotatedPieceVariant | null = null;
    let bestScore = -Infinity;
    let bestClutchScore = 1.0;
    let bestSupporters: string[] = [];

    for (const connector of candidates) {
      for (const rot of [0, 90, 180, 270] as const) {
        const variant = connector.fingerprint.variants.get(rot)!;
        if (this.canFitPiece(tx, tz, ty, variant)) {
          const clutchTubes = variant.bottomTubes.map(t => ({
            x: tx + t.dx,
            z: tz + t.dz
          }));

          const clutchInfo = evaluateClutchAndBond(
            clutchTubes,
            ty,
            this.occupiedCellToBrickId,
            this.brickIdToPartId
          );

          if (ty > 0 && clutchInfo.clutchScore <= 0.05) continue;

          const volume = variant.widthX * variant.depthZ * variant.heightY;
          const score =
            volume * 6.0 +
            clutchInfo.clutchScore * 40.0 +
            (clutchInfo.isRunningBond ? 35.0 : 0.0) +
            connector.bondingCapacity * 4.0;

          if (score > bestScore) {
            bestScore = score;
            bestConnector = connector;
            bestVariant = variant;
            bestClutchScore = clutchInfo.clutchScore;
            bestSupporters = clutchInfo.supportingBrickIds;
          }
        }
      }
    }

    if (bestConnector && bestVariant) {
      return this.commitPiece(
        tx,
        tz,
        ty,
        bestConnector,
        bestVariant,
        phase,
        bestClutchScore,
        headId,
        bestSupporters
      );
    }

    // Fallback: place single 1x1 plate (3024)
    const plate1x1 = CONNECTOR_DATABASE.getConnector('3024');
    if (plate1x1) {
      const v = plate1x1.fingerprint.variants.get(0)!;
      if (this.canFitPiece(tx, tz, ty, v)) {
        return this.commitPiece(tx, tz, ty, plate1x1, v, 'MANTLE', 0.5, headId);
      }
    }

    return null;
  }

  /**
   * Scans for an uncovered cell biased toward a head's spatial priority.
   */
  private findUncoveredCellForHead(headId: number): FrontierPoint | null {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    const head = this.heads[headId];
    const targetY = head.priorityY;

    // Scan near targetY first
    for (let dy = 0; dy < numPlatesY; dy++) {
      const y = (targetY + dy) % numPlatesY;
      for (let x = 0; x < numStudsX; x++) {
        for (let z = 0; z < numStudsZ; z++) {
          if (!this.isCellCovered(x, z, y)) {
            const cell = this.grid.grid[x][z][y];
            if (cell && cell.occupied) {
              return {
                x,
                z,
                y,
                depth: cell.depth,
                priority: 50,
                expectedCategory: cell.depth >= 2 ? 'FILL' : 'EDGE',
                expectedNormal: cell.normal,
                supportingStudsCount: y === 0 ? 1 : 0,
                assignedHeadId: headId
              };
            }
          }
        }
      }
    }

    return null;
  }

  private findNextUncoveredCell(): FrontierPoint | null {
    return this.findUncoveredCellForHead(0);
  }

  /**
   * Applies studless flat tiles to exposed top horizontal surfaces.
   */
  private applyStudlessTopTile(): PlacedBrick | null {
    const tileParts = ['3068b', '3069b', '2431', '98138'];

    for (const [brickId, placed] of this.placedBricks) {
      if (placed.category === 'LEAF' || placed.profile === 'tile_flat' || placed.profile === 'slope_curved') {
        continue;
      }

      const topY = placed.gridPos[2] + placed.size[2];
      if (topY >= this.grid.numPlatesY) continue;

      for (let dx = 0; dx < placed.size[0]; dx++) {
        for (let dz = 0; dz < placed.size[1]; dz++) {
          const gx = placed.gridPos[0] + dx;
          const gz = placed.gridPos[1] + dz;

          if (!this.isCellCovered(gx, gz, topY)) {
            for (const pid of tileParts) {
              const tile = CONNECTOR_DATABASE.getConnector(pid);
              if (!tile) continue;

              const variant = tile.fingerprint.variants.get(0)!;
              if (this.canFitPiece(gx, gz, topY, variant)) {
                return this.commitPiece(gx, gz, topY, tile, variant, 'TILE_FINISH', 1.0, 0);
              }
            }
          }
        }
      }
    }

    return null;
  }

  private formatStepResult(newBricks: PlacedBrick[] = []): GrowthStepResult {
    const totalPlaced = this.placedBricks.size;
    const placedVoxels = this.occupiedCellToBrickId.size;
    const targetVoxels = this.grid.totalOccupied;

    let activeHeads = 0;
    for (const head of this.heads) {
      if (head.active && (this.activeFrontiersByHead.get(head.headId)?.length || 0) > 0) {
        activeHeads++;
      }
    }

    let totalFrontier = 0;
    for (const list of this.activeFrontiersByHead.values()) {
      totalFrontier += list.length;
    }

    return {
      stepIndex: this.stepIndex,
      phase: this.currentPhase,
      newBrick: newBricks[0],
      newBricks,
      activeHeadsCount: Math.max(1, activeHeads),
      activeFrontierCount: totalFrontier,
      totalPlacedBricks: totalPlaced,
      totalPlacedVoxels: placedVoxels,
      totalTargetVoxels: targetVoxels,
      coverageRatio: targetVoxels > 0 ? placedVoxels / targetVoxels : 1.0,
      bomStats: {
        leafCount: this.bomStats.leafCount,
        edgeCount: this.bomStats.edgeCount,
        fillCount: this.bomStats.fillCount,
        uniquePartCount: this.bomStats.uniqueParts.size
      }
    };
  }

  /**
   * Solves the entire build in multi-head parallel batches until completion.
   */
  public solveAll(maxSteps: number = 3000): GrowthStepResult {
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
