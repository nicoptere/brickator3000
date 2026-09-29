/**
 * Markov Core Growing Engine.
 *
 * Implements the Synthetic "Growing Core" Markov Model:
 * 1. Seeds the topological Deep Core centroid of the 3D voxel volume with large structural FILL bricks.
 * 2. Iteratively grows outward from the core frontier using Markov rewrite rules.
 * 3. Enforces running bond interlocking (overlapping layer seams for structural strength).
 * 4. As the frontier touches the surface envelope (depth = 1), snaps EDGE & LEAF connectors:
 *    - Curved slopes (11477, 15068, 61678, 88930) for convex cylindrical curvature
 *    - Inverted slopes (24201, 93273) for concave underhangs
 *    - 45° slopes (3040, 3039) and cheese slopes (54200, 85984) for lattice slope gradients
 *    - Macaroni tiles (27925, 25269) for curved perimeter corners
 *    - Inverted radar dishes (4740) for spherical dome apexes
 *    - Bionicle teeth & horns (41669, 53451) for sharp organic cusps and crests
 * 5. Finishes exposed top horizontal surfaces with studless flat tiles (3068b, 3069b, 2431).
 */

import {
  VoxelGrid,
  VoxelCell,
  PlacedBrick,
  FrontierPoint,
  GrowthStepResult,
  MarkovEngineOptions,
  PieceCategory
} from './types';
import { CONNECTOR_DATABASE, LDrawConnectorMeta } from './connectorDatabase';
import { RotatedPieceVariant } from './pieceFingerprint';
import { LDU_STUD_PITCH, LDU_PLATE_HEIGHT, evaluateClutchAndBond } from './connectivityDictionary';

export class MarkovCoreGrowingEngine {
  public grid: VoxelGrid;
  public options: MarkovEngineOptions;

  public placedBricks: Map<string, PlacedBrick> = new Map();
  public occupiedCellToBrickId: Map<string, string> = new Map(); // "x,z,y" -> brickId
  public brickIdToPartId: Map<string, string> = new Map(); // brickId -> partId

  public activeFrontier: FrontierPoint[] = [];
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
    this.options = {
      seedMode: options.seedMode ?? 'DEEPEST_CORE',
      staggerRunningBond: options.staggerRunningBond ?? true,
      enableModernWeirdParts: options.enableModernWeirdParts ?? true,
      enableStudlessTopFinish: options.enableStudlessTopFinish ?? true,
      directRGBSampling: options.directRGBSampling ?? true,
      randomSeed: options.randomSeed ?? 42,
      maxSteps: options.maxSteps ?? 5000
    };

    // Simple deterministic PRNG
    let s = this.options.randomSeed!;
    this.rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    this.initFrontier();
  }

  private cellKey(x: number, z: number, y: number): string {
    return `${x},${z},${y}`;
  }

  private isCellCovered(x: number, z: number, y: number): boolean {
    return this.occupiedCellToBrickId.has(this.cellKey(x, z, y));
  }

  /**
   * Initializes the engine by seeding the core anchor.
   */
  private initFrontier(): void {
    const { coreCentroid, numPlatesY } = this.grid;
    let [seedX, seedZ, seedY] = coreCentroid;

    if (this.options.seedMode === 'GROUNDED_BASE') {
      seedY = 0;
    } else {
      // Align to brick layer height (multiple of 3 plates)
      seedY = Math.max(0, Math.floor(seedY / 3) * 3);
    }

    // Push initial seed cell
    this.activeFrontier.push({
      x: seedX,
      z: seedZ,
      y: seedY,
      depth: this.grid.grid[seedX]?.[seedZ]?.[seedY]?.depth ?? 3,
      priority: 100,
      expectedCategory: 'FILL',
      expectedNormal: [0, 1, 0],
      supportingStudsCount: seedY === 0 ? 8 : 4
    });
  }

  /**
   * Attempts to seed the initial core anchor piece.
   */
  private plantSeed(): PlacedBrick | null {
    const candidateParts = ['3001', '3002', '3003', '3004', '3005']; // 2x4, 2x3, 2x2, 1x2, 1x1
    const pt = this.activeFrontier.shift();
    if (!pt) return null;

    const { x: startX, z: startZ, y: startY } = pt;

    for (const partId of candidateParts) {
      const connector = CONNECTOR_DATABASE.getConnector(partId);
      if (!connector) continue;

      for (const rot of [0, 90] as const) {
        const variant = connector.fingerprint.variants.get(rot)!;
        const sX = Math.max(0, startX - Math.floor(variant.widthX / 2));
        const sZ = Math.max(0, startZ - Math.floor(variant.depthZ / 2));

        if (this.canFitPiece(sX, sZ, startY, variant)) {
          const brick = this.commitPiece(sX, sZ, startY, connector, variant, 'SEED', 1.0);
          this.currentPhase = 'CORE_EXPANSION';
          return brick;
        }
      }
    }

    this.currentPhase = 'CORE_EXPANSION';
    return null;
  }

  /**
   * Validates if a piece variant fits inside the target 3D envelope without collisions.
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

      // 1. Collision check: must not be covered
      if (this.isCellCovered(gx, gz, gy)) {
        return false;
      }

      // 2. Containment check: must be inside target 3D solid envelope
      const cell = this.grid.grid[gx]?.[gz]?.[gy];
      if (!cell || !cell.occupied) {
        return false;
      }
    }

    return true;
  }

  /**
   * Commits a placed piece to the model, updating occupied grids and expanding the active frontier.
   */
  private commitPiece(
    startX: number,
    startZ: number,
    startY: number,
    connector: LDrawConnectorMeta,
    variant: RotatedPieceVariant,
    phase: PlacedBrick['growthPhase'],
    clutchScore: number,
    parentIds: string[] = []
  ): PlacedBrick {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;
    const brickId = `brick_${this.stepIndex}_${connector.partId}_${startX}_${startY}_${startZ}`;

    // Sample dominant diffuse/vertex color from occupied cells (Direct RGB Cheat Mode)
    let sumR = 0, sumG = 0, sumB = 0;
    let colorCode = 15; // White fallback
    let colorHex = '#e2e8f0';
    let colorName = 'White';

    for (const c of variant.occupiedCells) {
      const cell = this.grid.grid[startX + c.dx][startZ + c.dz][startY + c.dy];
      if (cell) {
        colorCode = cell.colorCode;
        colorHex = cell.colorHex;
        colorName = cell.colorName;

        // Parse hex for RGB average
        const cleanHex = colorHex.replace('#', '');
        const r = parseInt(cleanHex.substring(0, 2), 16) || 200;
        const g = parseInt(cleanHex.substring(2, 4), 16) || 200;
        const b = parseInt(cleanHex.substring(4, 6), 16) || 200;
        sumR += r; sumG += g; sumB += b;
      }
    }

    if (this.options.directRGBSampling && variant.occupiedCells.length > 0) {
      const avgR = Math.round(sumR / variant.occupiedCells.length);
      const avgG = Math.round(sumG / variant.occupiedCells.length);
      const avgB = Math.round(sumB / variant.occupiedCells.length);
      colorHex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
    }

    // World & LDraw coordinates (1 stud = 20 LDU X/Z, 1 plate = 8 LDU Y)
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
      parentBrickIds: parentIds
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

    // Update BOM stats
    if (connector.category === 'LEAF') this.bomStats.leafCount++;
    else if (connector.category === 'EDGE') this.bomStats.edgeCount++;
    else if (connector.category === 'FILL') this.bomStats.fillCount++;
    this.bomStats.uniqueParts.add(connector.partId);

    // Expand Frontier to adjacent uncovered solid cells
    this.expandFrontierAround(startX, startZ, startY, variant, placed);

    return placed;
  }

  /**
   * Discovers new frontier expansion points adjacent to the newly placed piece.
   */
  private expandFrontierAround(
    startX: number,
    startZ: number,
    startY: number,
    variant: RotatedPieceVariant,
    placed: PlacedBrick
  ): void {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    // 1. Top connection points (growth upward)
    const topY = startY + variant.heightY;
    if (topY >= 0 && topY < numPlatesY) {
      for (const stud of variant.topStuds) {
        const gx = Math.floor(startX + stud.dx);
        const gz = Math.floor(startZ + stud.dz);
        if (gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ) {
          const cell = this.grid.grid[gx]?.[gz]?.[topY];
          if (cell && cell.occupied && !this.isCellCovered(gx, gz, topY)) {
            this.activeFrontier.push({
              x: gx,
              z: gz,
              y: topY,
              depth: cell.depth,
              priority: cell.depth >= 2 ? 80 : 60,
              expectedCategory: cell.depth >= 2 ? 'FILL' : 'EDGE',
              expectedNormal: cell.normal,
              supportingStudsCount: 1
            });
          }
        }
      }
    }

    // 2. Lateral perimeter points (growth outward)
    const perimeterChecks = [
      { dx: -1, dz: 0 }, { dx: variant.widthX, dz: 0 },
      { dx: 0, dz: -1 }, { dx: 0, dz: variant.depthZ }
    ];

    for (const p of perimeterChecks) {
      const gx = Math.floor(startX + p.dx);
      const gz = Math.floor(startZ + p.dz);
      const gy = startY;

      if (gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ && gy >= 0 && gy < numPlatesY) {
        const cell = this.grid.grid[gx]?.[gz]?.[gy];
        if (cell && cell.occupied && !this.isCellCovered(gx, gz, gy)) {
          this.activeFrontier.push({
            x: gx,
            z: gz,
            y: gy,
            depth: cell.depth,
            priority: cell.depth >= 2 ? 75 : 50,
            expectedCategory: cell.depth >= 2 ? 'FILL' : 'EDGE',
            expectedNormal: cell.normal,
            supportingStudsCount: gy === 0 ? 1 : 0
          });
        }
      }
    }
  }

  /**
   * Executes a single Markov growth step.
   */
  public step(): GrowthStepResult {
    this.stepIndex++;

    if (this.currentPhase === 'SEED') {
      const seedBrick = this.plantSeed();
      return this.formatStepResult(seedBrick || undefined);
    }

    if (this.currentPhase === 'DONE') {
      return this.formatStepResult();
    }

    // Find uncovered solid cell from frontier or scan
    let targetPoint: FrontierPoint | null = null;

    // Filter out already covered frontier points
    while (this.activeFrontier.length > 0) {
      const candidate = this.activeFrontier.pop()!;
      if (!this.isCellCovered(candidate.x, candidate.z, candidate.y)) {
        targetPoint = candidate;
        break;
      }
    }

    // If frontier is exhausted, scan for any unassigned occupied cell
    if (!targetPoint) {
      targetPoint = this.findNextUncoveredCell();
    }

    if (!targetPoint) {
      // All cells covered or unreachable! Transition to studless top finish
      if (this.options.enableStudlessTopFinish && this.currentPhase !== 'TILE_FINISH') {
        this.currentPhase = 'TILE_FINISH';
        const tileBrick = this.applyStudlessTopTile();
        if (tileBrick) return this.formatStepResult(tileBrick);
      }

      this.currentPhase = 'DONE';
      return this.formatStepResult();
    }

    const { x: tx, z: tz, y: ty, depth } = targetPoint;
    const cell = this.grid.grid[tx][tz][ty];

    // Determine target phase & piece category
    let phase: PlacedBrick['growthPhase'] = 'CORE_EXPANSION';
    let targetCategory: PieceCategory = 'FILL';

    if (cell.isBoundary || depth <= 1) {
      phase = 'SURFACE_EDGE';
      targetCategory = 'EDGE';
    } else if (depth === 2) {
      phase = 'MANTLE';
      targetCategory = 'FILL';
    }

    // Query candidate pieces from ConnectorDatabase
    const candidates = this.getCandidatesForCell(cell, targetCategory);

    // Evaluate candidates with Markov scoring function
    let bestConnector: LDrawConnectorMeta | null = null;
    let bestVariant: RotatedPieceVariant | null = null;
    let bestScore = -Infinity;
    let bestClutchInfo: { clutchScore: number; supportingBrickIds: string[] } = {
      clutchScore: 1.0,
      supportingBrickIds: []
    };

    for (const connector of candidates) {
      const rotations = [0, 90, 180, 270] as const;

      for (const rot of rotations) {
        const variant = connector.fingerprint.variants.get(rot)!;

        // Try anchor offsets so that (tx, tz, ty) is covered
        for (let ox = 0; ox < variant.widthX; ox++) {
          for (let oz = 0; oz < variant.depthZ; oz++) {
            const startX = tx - ox;
            const startZ = tz - oz;
            const startY = ty;

            if (this.canFitPiece(startX, startZ, startY, variant)) {
              // Evaluate physical clutch & running bond interlock
              const clutchTubes = variant.bottomTubes.map(t => ({
                x: startX + t.dx,
                z: startZ + t.dz
              }));

              const clutchInfo = evaluateClutchAndBond(
                clutchTubes,
                startY,
                this.occupiedCellToBrickId,
                this.brickIdToPartId
              );

              // Disallow completely floating pieces (zero clutch unless grounded at layer 0)
              if (startY > 0 && clutchInfo.clutchScore <= 0.05) {
                continue;
              }

              // Compute Markov likelihood score
              const volume = variant.widthX * variant.depthZ * variant.heightY;
              const runningBondBonus = clutchInfo.isRunningBond ? 30.0 : 0.0;
              const bondingBonus = connector.bondingCapacity * 4.0;
              
              let featureMatchBonus = 0.0;
              // Feature matching bonuses
              if (cell.curvatureClass === 'spherical_dome' && connector.profile === 'dish') {
                featureMatchBonus += 80.0;
              } else if (cell.curvatureClass === 'sharp_cusp' && connector.profile === 'tooth_creature') {
                featureMatchBonus += 70.0;
              } else if (cell.curvatureClass === 'corner_macaroni' && connector.profile === 'macaroni') {
                featureMatchBonus += 60.0;
              } else if (cell.slopeClass === 'slope_curved' && connector.profile === 'slope_curved') {
                featureMatchBonus += 50.0;
              } else if (cell.slopeClass === 'slope_45' && connector.profile === 'slope_45') {
                featureMatchBonus += 40.0;
              } else if (cell.slopeClass === 'slope_33' && connector.profile === 'cheese') {
                featureMatchBonus += 35.0;
              }

              const score =
                volume * 5.0 +
                clutchInfo.clutchScore * 40.0 +
                runningBondBonus +
                bondingBonus +
                featureMatchBonus +
                this.rng() * 5.0; // Stochastic temperature for variety

              if (score > bestScore) {
                bestScore = score;
                bestConnector = connector;
                bestVariant = variant;
                bestClutchInfo = clutchInfo;
              }
            }
          }
        }
      }
    }

    if (bestConnector && bestVariant) {
      // Find optimal anchor
      let chosenStartX = tx;
      let chosenStartZ = tz;
      for (let ox = 0; ox < bestVariant.widthX; ox++) {
        for (let oz = 0; oz < bestVariant.depthZ; oz++) {
          if (this.canFitPiece(tx - ox, tz - oz, ty, bestVariant)) {
            chosenStartX = tx - ox;
            chosenStartZ = tz - oz;
            break;
          }
        }
      }

      const placed = this.commitPiece(
        chosenStartX,
        chosenStartZ,
        ty,
        bestConnector,
        bestVariant,
        phase,
        bestClutchInfo.clutchScore,
        bestClutchInfo.supportingBrickIds
      );

      return this.formatStepResult(placed);
    }

    // Fallback: place single 1x1 plate (3024) to guarantee 100% complete coverage
    const plateConnector = CONNECTOR_DATABASE.getConnector('3024');
    if (plateConnector) {
      const variant = plateConnector.fingerprint.variants.get(0)!;
      if (this.canFitPiece(tx, tz, ty, variant)) {
        const fallback = this.commitPiece(
          tx,
          tz,
          ty,
          plateConnector,
          variant,
          'MANTLE',
          0.5
        );
        return this.formatStepResult(fallback);
      }
    }

    return this.formatStepResult();
  }

  /**
   * Retrieves candidate connectors appropriate for the cell's depth and feature class.
   */
  private getCandidatesForCell(cell: VoxelCell, category: PieceCategory): LDrawConnectorMeta[] {
    const list: LDrawConnectorMeta[] = [];

    if (cell.isBoundary || cell.depth <= 1) {
      // Prioritize specialized LEAF & EDGE modern parts
      if (cell.curvatureClass === 'spherical_dome') {
        const dish = CONNECTOR_DATABASE.getConnector('4740');
        if (dish) list.push(dish);
      }
      if (cell.curvatureClass === 'sharp_cusp' && this.options.enableModernWeirdParts) {
        const tooth = CONNECTOR_DATABASE.getConnector('41669');
        const horn = CONNECTOR_DATABASE.getConnector('53451');
        if (tooth) list.push(tooth);
        if (horn) list.push(horn);
      }
      if (cell.curvatureClass === 'corner_macaroni' && this.options.enableModernWeirdParts) {
        const mac = CONNECTOR_DATABASE.getConnector('27925');
        const qr = CONNECTOR_DATABASE.getConnector('25269');
        if (mac) list.push(mac);
        if (qr) list.push(qr);
      }
      if (cell.slopeClass === 'slope_curved' && this.options.enableModernWeirdParts) {
        const sc2 = CONNECTOR_DATABASE.getConnector('11477');
        const sc22 = CONNECTOR_DATABASE.getConnector('15068');
        const sc4 = CONNECTOR_DATABASE.getConnector('61678');
        if (sc2) list.push(sc2);
        if (sc22) list.push(sc22);
        if (sc4) list.push(sc4);
      }
      if (cell.slopeClass === 'slope_45') {
        const s45 = CONNECTOR_DATABASE.getConnector('3040');
        const s45_2 = CONNECTOR_DATABASE.getConnector('3039');
        if (s45) list.push(s45);
        if (s45_2) list.push(s45_2);
      }
      if (cell.slopeClass === 'slope_33') {
        const cheese = CONNECTOR_DATABASE.getConnector('54200');
        const cheese2 = CONNECTOR_DATABASE.getConnector('85984');
        if (cheese) list.push(cheese);
        if (cheese2) list.push(cheese2);
      }
      if (cell.slopeClass === 'slope_inverted' && this.options.enableModernWeirdParts) {
        const inv = CONNECTOR_DATABASE.getConnector('24201');
        const inv4 = CONNECTOR_DATABASE.getConnector('93273');
        if (inv) list.push(inv);
        if (inv4) list.push(inv4);
      }

      // Add boundary plates and bricks
      const plates = ['3023', '3024', '3710', '3022', '3004', '3005', '3003'];
      for (const pid of plates) {
        const c = CONNECTOR_DATABASE.getConnector(pid);
        if (c) list.push(c);
      }
    } else {
      // Core & Mantle: Heavy FILL pieces with high clutch
      const fillIds = ['3007', '2456', '3001', '3002', '3003', '3010', '3622', '3004', '3005', '2357', '3020', '3022', '3710', '3023', '3024', '3794b'];
      for (const pid of fillIds) {
        const c = CONNECTOR_DATABASE.getConnector(pid);
        if (c) list.push(c);
      }
    }

    return list;
  }

  /**
   * Scans for any unassigned occupied cell in the grid.
   */
  private findNextUncoveredCell(): FrontierPoint | null {
    const { numStudsX, numStudsZ, numPlatesY } = this.grid;

    // Scan from bottom layer up, prioritizing grounded support
    for (let y = 0; y < numPlatesY; y++) {
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
                supportingStudsCount: y === 0 ? 1 : 0
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Applies studless flat tiles to exposed top horizontal surfaces (LEGO Design Standard).
   */
  private applyStudlessTopTile(): PlacedBrick | null {
    const tileParts = ['3068b', '3069b', '2431', '98138']; // 2x2, 1x2, 1x4, 1x1 round

    for (const [brickId, placed] of this.placedBricks) {
      if (placed.category === 'LEAF' || placed.profile === 'tile_flat' || placed.profile === 'slope_curved') {
        continue;
      }

      const topY = placed.gridPos[2] + placed.size[2];
      if (topY >= this.grid.numPlatesY) continue;

      // Check if top studs are exposed to air
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
                return this.commitPiece(gx, gz, topY, tile, variant, 'TILE_FINISH', 1.0);
              }
            }
          }
        }
      }
    }

    return null;
  }

  private formatStepResult(newBrick?: PlacedBrick): GrowthStepResult {
    const totalPlaced = this.placedBricks.size;
    const placedVoxels = this.occupiedCellToBrickId.size;
    const targetVoxels = this.grid.totalOccupied;

    return {
      stepIndex: this.stepIndex,
      phase: this.currentPhase,
      newBrick,
      activeFrontierCount: this.activeFrontier.length,
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
   * Solves the entire build until completion or max steps.
   */
  public solveAll(maxSteps: number = 2000): GrowthStepResult {
    let lastResult = this.formatStepResult();
    let steps = 0;

    while (this.currentPhase !== 'DONE' && steps < maxSteps) {
      lastResult = this.step();
      steps++;
    }

    return lastResult;
  }
}
