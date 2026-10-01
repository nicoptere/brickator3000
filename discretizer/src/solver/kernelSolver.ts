import { PlateLattice3D } from '../core/PlateLattice3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import { KERNEL_CATALOG } from '../kernels/kernelCatalog';
import { generateKernelVariants } from '../kernels/kernelRotator';
import type { RotatedKernelVariant } from '../kernels/types';
import type { PlacedBrick, BuildabilityStats, ConnectorSite } from '../core/types';

export interface SolverOptions {
  dispatchStrategy?: 'tiered' | 'size_descent';
  enableSlopes?: boolean;
  enableCurvedSlopes?: boolean;
  enableMacaroni?: boolean;
  enableCanisters?: boolean;
  enableStudlessTiles?: boolean;
  enableCollapse?: boolean;
  enableVoxelRecompute?: boolean;
  colorVarianceThreshold?: number; // Standard deviation threshold in RGB space (default 45)
  onProgress?: (stage: string, percent: number) => void;
}

export interface SolverResult {
  bricks: PlacedBrick[];
  stats: BuildabilityStats;
  ldrawCode: string;
  lattice: PlateLattice3D;
  executionTimeMs: number;
}

export class GrowingSurfaceKernelSolver {
  private lattice: PlateLattice3D;
  private integral: IntegralVolume3D;
  private bitset: LegoBitset3D;
  private assemblyGraph: AssemblyGraph3D;
  private variants: RotatedKernelVariant[];
  private options: Required<SolverOptions>;

  constructor(lattice: PlateLattice3D, options: SolverOptions = {}) {
    this.lattice = lattice;
    this.integral = new IntegralVolume3D(lattice.numStudsX, lattice.numStudsZ, lattice.numPlatesY);
    this.bitset = new LegoBitset3D(lattice.numStudsX, lattice.numStudsZ, lattice.numPlatesY);
    this.assemblyGraph = new AssemblyGraph3D();

    this.options = {
      dispatchStrategy: options.dispatchStrategy ?? 'tiered',
      enableSlopes: options.enableSlopes ?? true,
      enableCurvedSlopes: options.enableCurvedSlopes ?? true,
      enableMacaroni: options.enableMacaroni ?? true,
      enableCanisters: options.enableCanisters ?? true,
      enableStudlessTiles: options.enableStudlessTiles ?? true,
      enableCollapse: options.enableCollapse ?? true,
      enableVoxelRecompute: options.enableVoxelRecompute ?? true,
      colorVarianceThreshold: options.colorVarianceThreshold ?? 45,
      onProgress: options.onProgress ?? (() => {})
    };

    // Filter catalog based on feature toggles
    const activeCatalog = KERNEL_CATALOG.filter(def => {
      // Default to LEGO System elements for pure geometry discretization
      if (def.system === 'TECHNIC') return false;

      const isSlope = def.category === 'SLOPE_CURVED' || def.category === 'CHEESE_SLOPE' || def.category === 'SLOPE_INVERTED' || def.category === 'SLOPE_45';
      if (isSlope && !this.options.enableCurvedSlopes) return false;
      if (def.category === 'MACARONI_WEDGE' && !this.options.enableMacaroni) return false;
      if ((def.category === 'ROUND_CANISTER' || def.category === 'ORGANIC_DOME') && !this.options.enableCanisters) return false;
      if (def.category === 'TILE_FLAT' && !this.options.enableStudlessTiles) return false;
      return true;
    });

    this.variants = generateKernelVariants(activeCatalog);
  }

  public async solve(): Promise<SolverResult> {
    const startTime = performance.now();
    const { onProgress } = this.options;

    // 1. Build Static 3D Integral Volume
    onProgress('Building 3D Integral Volume...', 10);
    this.integral.build(this.lattice);
    await new Promise(r => setTimeout(r, 0));

    // 2. Initialize Dynamic 64-bit Bitset
    onProgress('Initializing Active Bitset...', 20);
    this.bitset.initializeFromLattice(this.lattice.getOccupancyBuffer());
    await new Promise(r => setTimeout(r, 0));

    // 3. Dispatch Kernels
    if (this.options.dispatchStrategy === 'tiered') {
      await this.solveTieredPipeline();
    } else {
      await this.solveSizeDescentPipeline();
    }

    // 4. Grounding Verification & Dynamic Collapse Pass
    if (this.options.enableCollapse) {
      onProgress('Verifying Grounding & Running Collapse Pass...', 90);
      this.runCollapsePass();
      await new Promise(r => setTimeout(r, 0));
    }

    // 5. Build LDraw Model Script
    onProgress('Compiling LDraw Model...', 95);
    const placedBricks = this.assemblyGraph.getAllBricks();
    const ldrawCode = this.generateLDrawScript(placedBricks);
    const stats = this.assemblyGraph.getStats();

    onProgress('Discretization Complete', 100);
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      bricks: placedBricks,
      stats,
      ldrawCode,
      lattice: this.lattice,
      executionTimeMs
    };
  }

  /**
   * Strategy 1: Tiered Multi-Pass Pipeline (Default)
   * Hierarchical feature passes: Ground Foundation -> Core Infill -> Slopes -> Macaronis -> Canisters -> Tiles -> Plates
   */
  private async solveTieredPipeline(): Promise<void> {
    const { onProgress } = this.options;

    // Pass 1: Foundation at Ground Plane (y = 0)
    onProgress('Pass 1: Ground Plane Foundation...', 15);
    const foundationVariants = this.variants
      .filter(v => v.category.startsWith('BRICK') || v.category.startsWith('PLATE'))
      .sort((a, b) => (b.size[0] * b.size[1] * b.size[2]) - (a.size[0] * a.size[1] * a.size[2]));
    await this.runGroundPass(foundationVariants);

    // Pass 2: Core Infill Bricks (prefer interior voxels so exterior sloped voxels are preserved)
    onProgress('Pass 2: Interlocked Core Infill (Running Bond)...', 30);
    const coreBricks = this.variants.filter(v => v.category.startsWith('BRICK'));
    await this.runPass(coreBricks, { preferInterior: true, enforceRunningBond: true });

    // Pass 3: Modern Curved, 45°, 33°, and Inverted Slopes on exposed sloping surfaces
    if (this.options.enableSlopes || this.options.enableCurvedSlopes) {
      onProgress('Pass 3: Slopes (45°, 33°, Curved & Inverted)...', 50);
      const slopeVariants = this.variants.filter(v =>
        v.category === 'SLOPE_45' ||
        v.category === 'CHEESE_SLOPE' ||
        v.category === 'SLOPE_CURVED' ||
        v.category === 'SLOPE_INVERTED'
      );
      await this.runPass(slopeVariants, { requireDepth0: true });
    }

    // Pass 4: Macaroni Corners & Wedges (Tier 3)
    if (this.options.enableMacaroni) {
      onProgress('Pass 4: Macaroni Corners & Wedges...', 65);
      await this.runPass(this.variants.filter(v => v.def.tier === 3), { requireDepth0: true });
    }

    // Pass 5: Cylinders & Round Canisters (Tier 4)
    if (this.options.enableCanisters) {
      onProgress('Pass 5: Cylinders & Round Columns...', 75);
      await this.runPass(this.variants.filter(v => v.def.tier === 4), { checkPillar: true });
    }

    // Pass 6: Studless Top Tile Finishes (Tier 7) - run BEFORE plates on top exposed surfaces!
    if (this.options.enableStudlessTiles) {
      onProgress('Pass 6: Studless Top Tile Finishes...', 85);
      await this.runPass(this.variants.filter(v => v.def.tier === 7 || v.def.category === 'TILE_FLAT'), { requireExposedTop: true });
    }

    // Pass 7: Detail & Structural Infill Plates (Tier 6)
    onProgress('Pass 7: Structural Infill Plates...', 90);
    await this.runPass(this.variants.filter(v => v.def.tier === 6), {});

    // Pass 8: Final Fallback Core Bricks for any remaining interior voids
    await this.runPass(coreBricks, { enforceRunningBond: true });
  }

  private async runGroundPass(foundationVariants: RotatedKernelVariant[]): Promise<void> {
    const b = this.lattice.bounds;
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (!this.bitset.isAvailable(x, z, 0)) continue;
        let bestV: RotatedKernelVariant | null = null;
        let bestS = -1;
        for (const v of foundationVariants) {
          const s = this.evaluateCandidate(x, z, 0, v, {});
          if (s > bestS && s > 0) {
            bestS = s;
            bestV = v;
          }
        }
        if (bestV) {
          this.commitCandidate(x, z, 0, bestV);
        }
      }
    }
  }

  /**
   * Strategy 2: Size-Descent with Surface Preservation
   * Prioritizes ground anchor, then sorts core by volume, followed by surface slopes and finish tiles.
   */
  private async solveSizeDescentPipeline(): Promise<void> {
    const { onProgress } = this.options;

    // Pass 1: Foundation at Ground Plane (y = 0) to establish grounded physical anchor
    onProgress('Pass 1: Ground Plane Foundation...', 15);
    const foundationBricks = this.variants.filter(
      v => v.def.tier === 5 || v.def.category === 'BRICK_STANDARD' || v.def.category === 'PLATE_STANDARD'
    );
    await this.runGroundPass(foundationBricks);

    // Pass 2: Greedy Size-Descent on Core Volume (excluding tiles and domes)
    onProgress('Pass 2: Core Size-Descent Infill...', 40);
    const coreBricks = [...this.variants.filter(
      v => v.def.category !== 'TILE_FLAT' && v.def.category !== 'ORGANIC_DOME'
    )].sort((a, b) => {
      const volA = a.size[0] * a.size[1] * a.size[2];
      const volB = b.size[0] * b.size[1] * b.size[2];
      return volB - volA;
    });
    await this.runPass(coreBricks, { enforceRunningBond: true });

    // Pass 3: Exterior Slopes
    if (this.options.enableCurvedSlopes) {
      onProgress('Pass 3: Surface Slopes...', 65);
      await this.runPass(this.variants.filter(v => v.def.tier === 2), { requireDepth0: true });
    }

    // Pass 4: Top Studless Tiles
    if (this.options.enableStudlessTiles) {
      onProgress('Pass 4: Studless Top Finish...', 80);
      await this.runPass(this.variants.filter(v => v.def.tier === 7 || v.def.category === 'TILE_FLAT'), { requireExposedTop: true });
    }

    // Pass 5: Detail & Structural Infill Plates
    onProgress('Pass 5: Structural Detail Plates...', 88);
    await this.runPass(this.variants.filter(v => v.def.tier === 6), {});

    // Pass 6: Collapse Pass (if enabled)
    if (this.options.enableCollapse) {
      onProgress('Pass 6: Gravity & Connectivity Collapse...', 93);
      this.runCollapsePass();
    }
  }

  private async runPass(
    candidateVariants: RotatedKernelVariant[],
    constraints: {
      requireDepth0?: boolean;
      requireExposedTop?: boolean;
      requireApex?: boolean;
      checkPillar?: boolean;
      enforceRunningBond?: boolean;
      preferInterior?: boolean;
    } = {}
  ): Promise<void> {
    if (candidateVariants.length === 0) return;

    const b = this.lattice.bounds;
    let ops = 0;

    // Iterate through active lattice space
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          if (!this.bitset.isAvailable(x, z, y)) continue;

          const voxel = this.lattice.getVoxel(x, z, y);
          if (!voxel) continue;

          if (constraints.requireDepth0 && voxel.depth !== 0) continue;

          // Check if apex
          if (constraints.requireApex) {
            const isNearApex = y >= b.maxY - 2;
            const hasAirAbove = !this.lattice.isOccupied(x, z, y + 1);
            if (!isNearApex || !hasAirAbove) continue;
          }

          // Evaluate candidate variants at this anchor (x, z, y)
          let bestVariant: RotatedKernelVariant | null = null;
          let bestScore = -Infinity;

          for (const variant of candidateVariants) {
            const score = this.evaluateCandidate(x, z, y, variant, constraints);
            if (score > bestScore + 0.001) {
              bestScore = score;
              bestVariant = variant;
            } else if (Math.abs(score - bestScore) <= 0.001 && bestVariant && score > 0) {
              // Tie-breaker: alternate long-axis orientation across layers for running bond
              const isEven = Math.floor(y / 3) % 2 === 0;
              if (isEven && variant.size[0] > variant.size[1]) {
                bestVariant = variant;
              } else if (!isEven && variant.size[1] > variant.size[0]) {
                bestVariant = variant;
              }
            }
          }

          if (bestVariant) {
            this.commitCandidate(x, z, y, bestVariant);
          }

          ops++;
          if (ops % 1500 === 0) {
            await new Promise(r => setTimeout(r, 0));
          }
        }
      }
    }
  }

  private evaluateCandidate(
    x: number,
    z: number,
    y: number,
    variant: RotatedKernelVariant,
    constraints: {
      enforceRunningBond?: boolean;
      requireExposedTop?: boolean;
      preferInterior?: boolean;
      requireApex?: boolean;
    } = {}
  ): number {
    const [w, d, h] = variant.size;

    // 1. Instant O(1) Bounding Box Bitset Check: Must be completely available
    if (!this.bitset.isRegionAvailable(x, z, y, w, d, h)) {
      return -1;
    }

    // Mechanical Connectivity: At y > 0, piece must connect to an already-grounded brick
    if (y > 0 && !this.assemblyGraph.canConnectToGrounded(x, z, y, variant.connectors)) {
      return -1;
    }

    // Check canisters: never float in mid-air without support underneath
    if (variant.category === 'ROUND_CANISTER') {
      if (y > 0 && !this.hasSupportUnderneath(x, z, y, w, d)) {
        return -1;
      }
    }

    // Hemispherical Apex Domes / Inverted Dishes (Tier 1): strictly for top apexes, never in vertical column
    if (variant.category === 'ORGANIC_DOME') {
      if (!constraints.requireApex) return -1;
      const hasAirAbove = !this.lattice.isOccupied(x, z, y + h);
      if (!hasAirAbove) return -1;
    }

    const isDirectionalSlope =
      variant.category === 'SLOPE_CURVED' ||
      variant.category === 'SLOPE_45' ||
      variant.category === 'CHEESE_SLOPE' ||
      variant.category === 'SLOPE_INVERTED';

    let normalScore = 0;

    if (isDirectionalSlope) {
      const vNorm = this.lattice.getVoxel(x, z, y)?.normal;
      if (!vNorm) return -1;

      const [nx, ny, nz] = vNorm;
      const len = Math.hypot(nx, ny, nz) || 1;
      const cosAngle = Math.max(-1, Math.min(1, ny / len));
      const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

      const isInverted = variant.category === 'SLOPE_INVERTED';

      if (isInverted) {
        // Inverted slope: overhang / underside (negative Y normal)
        if (ny >= -0.20) return -1;
        // Underside must descend into empty air below
        if (y > 0 && this.lattice.isOccupied(x, z, y - 1)) return -1;
      } else {
        // Upward slope: requires upward or lateral face
        if (ny < -0.20) return -1;
        // Flat horizontal surfaces (tabletop, roof) must NOT use directional slopes
        if (angleDeg < 22) return -1;

        // Top surface must not be blocked by solid voxels
        const topY = y + h;
        for (let dz = 0; dz < d; dz++) {
          for (let dx = 0; dx < w; dx++) {
            if (this.lattice.isOccupied(x + dx, z + dz, topY)) return -1;
          }
        }

        // Check physical step contour into empty air based on heading:
        // A slope must descend from solid into empty air!
        if (variant.rotation === 0) {
          // Descends in +Z: front face at z + d touches empty air, normal nz is positive
          const airInFront = z + d >= this.lattice.numStudsZ || !this.lattice.isOccupied(x, z + d, y);
          if (!airInFront || nz < 0.10) return -1;
        } else if (variant.rotation === 180) {
          // Descends in -Z: front face at z - 1 touches empty air, normal nz is negative
          const airInFront = z - 1 < 0 || !this.lattice.isOccupied(x, z - 1, y);
          if (!airInFront || nz > -0.10) return -1;
        } else if (variant.rotation === 90) {
          // Descends in -X: front face at x - 1 touches empty air, normal nx is negative
          const airInFront = x - 1 < 0 || !this.lattice.isOccupied(x - 1, z, y);
          if (!airInFront || nx > -0.10) return -1;
        } else if (variant.rotation === 270) {
          // Descends in +X: front face at x + w touches empty air, normal nx is positive
          const airInFront = x + w >= this.lattice.numStudsX || !this.lattice.isOccupied(x + w, z, y);
          if (!airInFront || nx < 0.10) return -1;
        }

        // Horizontal normal alignment
        const [tnx, tny, tnz] = variant.targetNormal;
        const hNorm = Math.hypot(nx, nz);
        const tHoriz = Math.hypot(tnx, tnz);
        if (hNorm > 0.01 && tHoriz > 0.01) {
          const horizDot = (nx * tnx + nz * tnz) / (hNorm * tHoriz);
          if (horizDot < 0.60) return -1;
        }

        // Slope angle classification bonus:
        // 45° slopes match ~45° surfaces
        if (variant.category === 'SLOPE_45') {
          if (angleDeg >= 36 && angleDeg <= 54) {
            normalScore += 50.0; // 45° slope match!
          } else {
            normalScore += 15.0;
          }
        } else if (variant.category === 'CHEESE_SLOPE') {
          if (angleDeg >= 22 && angleDeg < 36) {
            normalScore += 50.0; // 30°/33° slope match!
          } else {
            normalScore += 15.0;
          }
        } else if (variant.category === 'SLOPE_CURVED') {
          if (angleDeg > 54 || (angleDeg >= 30 && angleDeg <= 60)) {
            normalScore += 45.0; // Curved slope match!
          } else {
            normalScore += 15.0;
          }
        }
      }
    } else if (variant.category === 'TILE_FLAT') {
      const vNorm = this.lattice.getVoxel(x, z, y)?.normal;
      if (vNorm && vNorm[1] > 0.80) {
        normalScore += 30.0; // Flat upward face matches tiles
      }
      const topY = y + h;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          if (this.lattice.isOccupied(x + dx, z + dz, topY)) return -1;
        }
      }
    } else if (constraints.preferInterior) {
      // Don't place core bricks on voxels that have empty air and normal angle > 22° (save them for slopes!)
      const vNorm = this.lattice.getVoxel(x, z, y)?.normal;
      if (vNorm) {
        const len = Math.hypot(vNorm[0], vNorm[1], vNorm[2]) || 1;
        const angleDeg = (Math.acos(Math.max(-1, Math.min(1, vNorm[1] / len))) * 180) / Math.PI;
        if (angleDeg >= 22 && this.lattice.getDepth(x, z, y) === 0) {
          return -1; // Reserve boundary surface slope voxel for actual slope elements!
        }
      }
    }

    // 2. Instant O(1) Integral Volume Check: Slopes/Tiles on perimeter require lower density
    const solidCount = this.integral.queryBox(x, z, y, x + w - 1, z + d - 1, y + h - 1);
    const volume = w * d * h;
    const isSurfaceSlope = variant.def.tier === 2 || variant.def.tier === 3;
    const isTile = variant.def.category === 'TILE_FLAT';
    const minDensity = isSurfaceSlope ? 0.35 : (isTile ? 0.40 : 0.65);
    if (solidCount < volume * minDensity) {
      return -1;
    }

    // 4. Color Variance Gating (Preserve texture boundaries)
    if (w * d > 1) {
      const variance = this.calculateColorVariance(x, z, y, w, d, h);
      if (variance > this.options.colorVarianceThreshold) {
        return -1; // Color variance too high; do not place large piece across boundary
      }
    }

    // 5. Seam Interlocking & Running Bond (LTRON / Assembly Graph)
    let interlockScore = 0;
    if (constraints.enforceRunningBond || variant.def.tier === 5) {
      interlockScore = this.assemblyGraph.evaluateSeamInterlock(x, z, y, w, d, h);
    }

    // Alternating layer orientation bias for masonry running bond (criss-cross):
    const brickLayer = Math.floor(y / 3);
    const isEvenBrick = brickLayer % 2 === 0;
    let orientationScore = 0;
    if (w !== d) {
      if (isEvenBrick && w > d) orientationScore += 1.0;
      else if (!isEvenBrick && d > w) orientationScore += 1.0;
    }

    // OMR Frequency bonus:
    const omrBonus = variant.def.omrFrequency ? Math.min(2.5, variant.def.omrFrequency / 25.0) : 0;

    // Combined multi-objective score: interlock can boost running bond, clamped to remain valid
    const volumeScore = Math.log2(volume + 1) * 3.0;
    const baseScore = variant.def.weightBonus + volumeScore + normalScore + orientationScore + omrBonus;
    return Math.max(0.1, baseScore + interlockScore);
  }

  private calculateColorVariance(x: number, z: number, y: number, w: number, d: number, h: number): number {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const v = this.lattice.getVoxel(x + dx, z + dz, y + dy);
          if (v) {
            const p = v.colorPacked;
            rSum += (p >> 16) & 0xff;
            gSum += (p >> 8) & 0xff;
            bSum += p & 0xff;
            count++;
          }
        }
      }
    }

    if (count <= 1) return 0;

    const rMean = rSum / count;
    const gMean = gSum / count;
    const bMean = bSum / count;

    let sqDiffSum = 0;
    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const v = this.lattice.getVoxel(x + dx, z + dz, y + dy);
          if (v) {
            const p = v.colorPacked;
            const r = (p >> 16) & 0xff;
            const g = (p >> 8) & 0xff;
            const b = p & 0xff;
            sqDiffSum += (r - rMean) ** 2 + (g - gMean) ** 2 + (b - bMean) ** 2;
          }
        }
      }
    }

    return Math.sqrt(sqDiffSum / count);
  }

  private hasSupportUnderneath(x: number, z: number, y: number, w: number, d: number): boolean {
    if (y === 0) return true;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.bitset.isClaimed(x + dx, z + dz, y - 1)) {
          return true;
        }
      }
    }
    return false;
  }

  private commitCandidate(x: number, z: number, y: number, variant: RotatedKernelVariant): void {
    const [w, d, h] = variant.size;
    const instanceId = `b_${variant.partId}_${x}_${z}_${y}`;

    // 1. Claim voxels in active 64-bit bitset
    this.bitset.claimRegion(x, z, y, w, d, h, instanceId);

    // 2. Sample surface-centroid 24-bit direct color ("Cheat Mode")
    const sample = this.sampleCentroidColor(x, z, y, w, d, h);

    // 3. Compute authentic LDraw world coordinate
    const ldrawPos = this.lattice.gridToLDraw(x, z, y, w, d, h);

    const placedBrick: PlacedBrick = {
      instanceId,
      partId: variant.partId,
      name: variant.name,
      gridPos: [x, z, y],
      baseSize: variant.def.baseSize,
      size: [w, d, h],
      rotation: variant.rotation,
      colorHex: sample.hex,
      colorPacked: sample.packed,
      ldrawPos,
      ldrawMatrix: variant.ldrawMatrix,
      category: variant.category,
      connectors: variant.connectors
    };

    // 4. Register in mechanical assembly graph
    this.assemblyGraph.addBrick(placedBrick);
  }

  private sampleCentroidColor(x: number, z: number, y: number, w: number, d: number, h: number): { hex: string; packed: number } {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const v = this.lattice.getVoxel(x + dx, z + dz, y + dy);
          if (v) {
            const p = v.colorPacked;
            rSum += (p >> 16) & 0xff;
            gSum += (p >> 8) & 0xff;
            bSum += p & 0xff;
            count++;
          }
        }
      }
    }

    if (count === 0) {
      return { hex: '#94a3b8', packed: 0x94a3b8 };
    }

    const r = Math.round(rSum / count);
    const g = Math.round(gSum / count);
    const b = Math.round(bSum / count);
    const packed = (r << 16) | (g << 8) | b;
    const hex = '#' + packed.toString(16).padStart(6, '0');

    return { hex, packed };
  }

  /**
   * Gravity & Connectivity Collapse Pass:
   * Identifies any floating components (bricks not grounded to y = 0) and collapses them
   * downward along Y until they rest on a supported brick, or removes them safely.
   */
  private runCollapsePass(): void {
    const allBricks = this.assemblyGraph.getAllBricks();
    let changed = false;

    // Sort bricks by Y ascending so lower layers settle first
    const sorted = [...allBricks].sort((a, b) => a.gridPos[2] - b.gridPos[2]);

    for (const brick of sorted) {
      if (this.assemblyGraph.isGrounded(brick.instanceId)) {
        continue;
      }

      // Brick is ungrounded (floating in air)! Attempt to drop it downward along Y
      const [bx, bz, by] = brick.gridPos;
      const [bw, bd, bh] = brick.size;
      let targetY = -1;

      for (let dy = 1; dy <= by; dy++) {
        const testY = by - dy;
        const canConnect = testY === 0 || this.assemblyGraph.canConnectToGrounded(bx, bz, testY, brick.connectors);
        if (canConnect) {
          // Check collision with other bricks
          let canFit = true;
          for (let ly = 0; ly < bh; ly++) {
            for (let lz = 0; lz < bd; lz++) {
              for (let lx = 0; lx < bw; lx++) {
                const cellY = testY + ly;
                const owner = this.bitset.getCellOwner(bx + lx, bz + lz, cellY);
                if (owner !== null && owner !== brick.instanceId) {
                  canFit = false;
                  break;
                }
              }
              if (!canFit) break;
            }
            if (!canFit) break;
          }
          if (canFit) {
            targetY = testY;
            break;
          }
        }
      }

      if (targetY !== -1 && targetY !== by) {
        this.bitset.releaseRegion(bx, bz, by, bw, bd, bh);
        this.assemblyGraph.removeBrick(brick.instanceId);

        brick.gridPos = [bx, bz, targetY];
        brick.ldrawPos = this.lattice.gridToLDraw(bx, bz, targetY, bw, bd, bh);
        this.bitset.claimRegion(bx, bz, targetY, bw, bd, bh, brick.instanceId);
        this.assemblyGraph.addBrick(brick);
        changed = true;
      } else if (!this.assemblyGraph.isGrounded(brick.instanceId)) {
        // Cannot be grounded safely; remove floating brick and free cells
        this.bitset.releaseRegion(bx, bz, by, bw, bd, bh);
        this.assemblyGraph.removeBrick(brick.instanceId);
        changed = true;
      }
    }

    if (changed && this.options.enableVoxelRecompute) {
      this.integral.build(this.lattice);
    }
  }

  /**
   * Generates standard LDraw format model text file (.ldr)
   * Format: 1 <color> <x> <y> <z> <a> <b> <c> <d> <e> <f> <g> <h> <i> <part>.dat
   */
  private generateLDrawScript(bricks: PlacedBrick[]): string {
    const lines: string[] = [
      '0 Brickator3000 Discretizer V2 Model',
      '0 Name: model.ldr',
      '0 Author: Brickator Surface-Growing Discretizer Engine',
      ''
    ];

    for (const b of bricks) {
      const [x, y, z] = b.ldrawPos;
      const [a, c, e, d, f, g, h, i, j] = b.ldrawMatrix;
      // Direct 24-bit RGB format: 0x2RRGGBB
      const ldrawColor = '0x2' + b.colorHex.replace('#', '').toUpperCase();
      lines.push(
        `1 ${ldrawColor} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ` +
        `${a} ${c} ${e} ${d} ${f} ${g} ${h} ${i} ${j} ${b.partId}.dat`
      );
    }

    return lines.join('\n');
  }
}
