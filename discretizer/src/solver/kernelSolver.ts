import { PlateLattice3D } from '../core/PlateLattice3D';
import { IntegralVolume3D } from '../core/IntegralVolume3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import { KERNEL_CATALOG } from '../kernels/kernelCatalog';
import { get18kKernelCatalog } from '../kernels/parts18kLoader';
import { generateKernelVariants } from '../kernels/kernelRotator';
import type { RotatedKernelVariant } from '../kernels/types';
import type { PlacedBrick, BuildabilityStats, EvaluationStep } from '../core/types';
import { dispatchTieredPipeline, dispatchSizeDescentPipeline } from './pipelineDispatcher';
import { runCollapsePass } from './collapseOptimizer';
import { generateLDrawScript } from './ldrawExporter';

export interface SolverOptions {
  dispatchStrategy?: 'tiered' | 'size_descent';
  enableSlopes?: boolean;
  enableCurvedSlopes?: boolean;
  enableMacaroni?: boolean;
  enableCanisters?: boolean;
  enableStudlessTiles?: boolean;
  enableCollapse?: boolean;
  enableVoxelRecompute?: boolean;
  colorVarianceThreshold?: number;
  useFull18kCatalog?: boolean;
  onProgress?: (stage: string, percent: number) => void;
}

export interface SolverResult {
  bricks: PlacedBrick[];
  stats: BuildabilityStats;
  ldrawCode: string;
  lattice: PlateLattice3D;
  executionTimeMs: number;
  evaluationSteps?: EvaluationStep[];
}

/**
 * GrowingSurfaceKernelSolver:
 * Master coordinator for surface-growing LEGO discretization.
 * Delegates candidate evaluation, layer dispatching, collapse optimization,
 * and LDraw script compilation to specialized modular functions.
 */
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
      useFull18kCatalog: options.useFull18kCatalog ?? false,
      onProgress: options.onProgress ?? (() => {})
    };

    const baseSource = this.options.useFull18kCatalog ? get18kKernelCatalog() : KERNEL_CATALOG;

    // Filter catalog based on feature toggles and verticalUnit mode
    const activeCatalog = baseSource.filter(def => {
      if (def.system === 'TECHNIC') return false;

      if (def.category === 'SLOPE_CURVED' && !this.options.enableCurvedSlopes) return false;
      if (def.category === 'MACARONI_WEDGE' && !this.options.enableMacaroni) return false;
      if ((def.category === 'ROUND_CANISTER' || def.category === 'ORGANIC_DOME') && !this.options.enableCanisters) return false;
      if (def.category === 'TILE_FLAT' && !this.options.enableStudlessTiles) return false;
      return true;
    });

    this.variants = generateKernelVariants(activeCatalog, this.lattice.verticalUnit);
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

    // 3. Dispatch Outward-In Pipeline
    const evaluationSteps: EvaluationStep[] = [];
    const dispatcherOptions = {
      enableStudlessTiles: this.options.enableStudlessTiles,
      colorVarianceThreshold: this.options.colorVarianceThreshold,
      enableVoxelRecompute: this.options.enableVoxelRecompute,
      enableMacaroni: this.options.enableMacaroni,
      enableCanisters: this.options.enableCanisters,
      enableSlopes: this.options.enableSlopes,
      enableCurvedSlopes: this.options.enableCurvedSlopes,
      evaluationSteps,
      onProgress
    };

    if (this.options.dispatchStrategy === 'tiered') {
      await dispatchTieredPipeline(
        this.variants,
        this.lattice,
        this.bitset,
        this.integral,
        this.assemblyGraph,
        dispatcherOptions
      );
    } else {
      await dispatchSizeDescentPipeline(
        this.variants,
        this.lattice,
        this.bitset,
        this.integral,
        this.assemblyGraph,
        dispatcherOptions
      );
    }

    // 4. Grounding Verification & Dynamic Collapse Pass
    if (this.options.enableCollapse) {
      onProgress('Verifying Grounding & Running Collapse Pass...', 90);
      runCollapsePass(
        this.lattice,
        this.bitset,
        this.assemblyGraph,
        this.integral,
        this.options.enableVoxelRecompute
      );
      await new Promise(r => setTimeout(r, 0));
    }

    // 5. Build LDraw Model Script
    onProgress('Compiling LDraw Model...', 95);
    const placedBricks = this.assemblyGraph.getAllBricks();
    const ldrawCode = generateLDrawScript(placedBricks);
    const stats = this.assemblyGraph.getStats();

    onProgress('Discretization Complete', 100);
    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      bricks: placedBricks,
      stats,
      ldrawCode,
      lattice: this.lattice,
      executionTimeMs,
      evaluationSteps
    };
  }
}
