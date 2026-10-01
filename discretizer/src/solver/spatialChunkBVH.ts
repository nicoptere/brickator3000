import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';

export interface ChunkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface SpatialChunk {
  id: string;
  level: number; // 0: Coarse (8x8x2), 1: Medium (4x4x1), 2: Fine (2x2x1)
  bounds: ChunkBounds;
  totalVolume: number;
  activeCount: number;
  density: number;
}

/**
 * 3D Hierarchical Spatial Chunk Partition & Spatial Hash BVH.
 * Partitions the voxel space into multi-resolution hierarchical chunks (coarse to fine)
 * to evaluate candidate kernels against larger-to-smaller chunks of the voxel space.
 */
export class SpatialChunkBVH {
  private coarseChunks: SpatialChunk[] = [];
  private mediumChunks: SpatialChunk[] = [];
  private fineChunks: SpatialChunk[] = [];
  private spatialHash: Map<string, SpatialChunk> = new Map();

  public readonly numStudsX: number;
  public readonly numStudsZ: number;
  public readonly numPlatesY: number;

  constructor(numStudsX: number, numStudsZ: number, numPlatesY: number) {
    this.numStudsX = numStudsX;
    this.numStudsZ = numStudsZ;
    this.numPlatesY = numPlatesY;
  }

  private hashKey(level: number, cx: number, cz: number, cy: number): string {
    return `${level}_${cx}_${cz}_${cy}`;
  }

  /**
   * Builds the hierarchical chunk decomposition for a given layer Y or the full lattice.
   */
  public build(
    lattice: PlateLattice3D,
    bitset: LegoBitset3D,
    layerY?: number
  ): void {
    this.coarseChunks = [];
    this.mediumChunks = [];
    this.fineChunks = [];
    this.spatialHash.clear();

    const startY = layerY !== undefined ? layerY : 0;
    const endY = layerY !== undefined ? layerY : this.numPlatesY - 1;

    const isBrickMode = lattice.verticalUnit === 'brick';
    const coarseStepY = isBrickMode ? 2 : 4;
    const mediumStepY = 1;
    const fineStepY = 1;

    // 1. Level 0: Coarse Chunks (8 x 8 x coarseStepY)
    const coarseStepXZ = 8;
    for (let y = startY; y <= endY; y += coarseStepY) {
      const y1 = Math.min(endY, y + coarseStepY - 1);
      for (let z = 0; z < this.numStudsZ; z += coarseStepXZ) {
        const z1 = Math.min(this.numStudsZ - 1, z + coarseStepXZ - 1);
        for (let x = 0; x < this.numStudsX; x += coarseStepXZ) {
          const x1 = Math.min(this.numStudsX - 1, x + coarseStepXZ - 1);

          const chunk = this.createChunk(0, x, x1, z, z1, y, y1, bitset);
          if (chunk.activeCount > 0) {
            this.coarseChunks.push(chunk);
            this.spatialHash.set(chunk.id, chunk);
          }
        }
      }
    }

    // 2. Level 1: Medium Chunks (4 x 4 x mediumStepY)
    const mediumStepXZ = 4;
    for (let y = startY; y <= endY; y += mediumStepY) {
      const y1 = Math.min(endY, y + mediumStepY - 1);
      for (let z = 0; z < this.numStudsZ; z += mediumStepXZ) {
        const z1 = Math.min(this.numStudsZ - 1, z + mediumStepXZ - 1);
        for (let x = 0; x < this.numStudsX; x += mediumStepXZ) {
          const x1 = Math.min(this.numStudsX - 1, x + mediumStepXZ - 1);

          const chunk = this.createChunk(1, x, x1, z, z1, y, y1, bitset);
          if (chunk.activeCount > 0) {
            this.mediumChunks.push(chunk);
            this.spatialHash.set(chunk.id, chunk);
          }
        }
      }
    }

    // 3. Level 2: Fine Chunks (2 x 2 x fineStepY)
    const fineStepXZ = 2;
    for (let y = startY; y <= endY; y += fineStepY) {
      const y1 = Math.min(endY, y + fineStepY - 1);
      for (let z = 0; z < this.numStudsZ; z += fineStepXZ) {
        const z1 = Math.min(this.numStudsZ - 1, z + fineStepXZ - 1);
        for (let x = 0; x < this.numStudsX; x += fineStepXZ) {
          const x1 = Math.min(this.numStudsX - 1, x + fineStepXZ - 1);

          const chunk = this.createChunk(2, x, x1, z, z1, y, y1, bitset);
          if (chunk.activeCount > 0) {
            this.fineChunks.push(chunk);
            this.spatialHash.set(chunk.id, chunk);
          }
        }
      }
    }

    // Sort chunks by density descending so highest-density chunks are filled first
    this.coarseChunks.sort((a, b) => b.density - a.density);
    this.mediumChunks.sort((a, b) => b.density - a.density);
    this.fineChunks.sort((a, b) => b.density - a.density);
  }

  private createChunk(
    level: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    minY: number,
    maxY: number,
    bitset: LegoBitset3D
  ): SpatialChunk {
    const vol = (maxX - minX + 1) * (maxZ - minZ + 1) * (maxY - minY + 1);
    let active = 0;

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (let cx = minX; cx <= maxX; cx++) {
          if (bitset.isAvailable(cx, cz, cy)) {
            active++;
          }
        }
      }
    }

    const id = this.hashKey(level, minX, minZ, minY);
    return {
      id,
      level,
      bounds: { minX, maxX, minZ, maxZ, minY, maxY },
      totalVolume: vol,
      activeCount: active,
      density: vol > 0 ? active / vol : 0
    };
  }

  /**
   * Refreshes the active count and density of a chunk against the current bitset.
   */
  public refreshChunk(chunk: SpatialChunk, bitset: LegoBitset3D): void {
    const { minX, maxX, minZ, maxZ, minY, maxY } = chunk.bounds;
    let active = 0;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (let cx = minX; cx <= maxX; cx++) {
          if (bitset.isAvailable(cx, cz, cy)) {
            active++;
          }
        }
      }
    }
    chunk.activeCount = active;
    chunk.density = chunk.totalVolume > 0 ? active / chunk.totalVolume : 0;
  }

  public getCoarseChunks(): SpatialChunk[] {
    return this.coarseChunks;
  }

  public getMediumChunks(): SpatialChunk[] {
    return this.mediumChunks;
  }

  public getFineChunks(): SpatialChunk[] {
    return this.fineChunks;
  }
}
