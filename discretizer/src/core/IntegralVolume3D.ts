import { PlateLattice3D } from './PlateLattice3D';
import type { BoundingBox3D } from './types';

/**
 * 3D Integral Volume (Summed-Area Table) for O(1) box occupancy and density queries.
 */
export class IntegralVolume3D {
  public readonly numStudsX: number;
  public readonly numStudsZ: number;
  public readonly numPlatesY: number;

  private readonly strideX: number;
  private readonly strideZ: number;
  private readonly strideY: number;

  // Stored in table of dimensions (numStudsX + 1) x (numStudsZ + 1) x (numPlatesY + 1)
  private table: Int32Array;

  constructor(numStudsX: number, numStudsZ: number, numPlatesY: number) {
    this.numStudsX = numStudsX;
    this.numStudsZ = numStudsZ;
    this.numPlatesY = numPlatesY;

    this.strideX = 1;
    this.strideZ = numStudsX + 1;
    this.strideY = (numStudsX + 1) * (numStudsZ + 1);

    const totalElements = (numStudsX + 1) * (numStudsZ + 1) * (numPlatesY + 1);
    this.table = new Int32Array(totalElements);
  }

  private getTableIndex(x: number, z: number, y: number): number {
    return y * this.strideY + z * this.strideZ + x * this.strideX;
  }

  /**
   * Builds the 3D Integral Volume from the source PlateLattice3D.
   * Uses cache-efficient separable 3-pass prefix summation:
   * 1. Cumulative along X
   * 2. Cumulative along Z
   * 3. Cumulative along Y
   */
  public build(lattice: PlateLattice3D): void {
    const nx = this.numStudsX;
    const nz = this.numStudsZ;
    const ny = this.numPlatesY;
    const occ = lattice.getOccupancyBuffer();

    this.table.fill(0);

    // Pass 1: Copy occupancy to 1-indexed table and accumulate along X
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        let runningSumX = 0;
        for (let x = 0; x < nx; x++) {
          const occVal = occ[lattice.getIndex(x, z, y)];
          runningSumX += occVal;
          this.table[this.getTableIndex(x + 1, z + 1, y + 1)] = runningSumX;
        }
      }
    }

    // Pass 2: Accumulate along Z
    for (let y = 1; y <= ny; y++) {
      for (let z = 1; z <= nz; z++) {
        for (let x = 1; x <= nx; x++) {
          const idx = this.getTableIndex(x, z, y);
          const prevZIdx = this.getTableIndex(x, z - 1, y);
          this.table[idx] += this.table[prevZIdx];
        }
      }
    }

    // Pass 3: Accumulate along Y
    for (let y = 1; y <= ny; y++) {
      for (let z = 1; z <= nz; z++) {
        for (let x = 1; x <= nx; x++) {
          const idx = this.getTableIndex(x, z, y);
          const prevYIdx = this.getTableIndex(x, z, y - 1);
          this.table[idx] += this.table[prevYIdx];
        }
      }
    }
  }

  /**
   * Queries the sum of occupied voxels within the axis-aligned box [minX..maxX] x [minZ..maxZ] x [minY..maxY].
   * Clamped to grid bounds. Returns in O(1) time using exactly 8 array lookups.
   */
  public queryBox(minX: number, minZ: number, minY: number, maxX: number, maxZ: number, maxY: number): number {
    const x0 = Math.max(0, Math.min(minX, this.numStudsX));
    const x1 = Math.max(0, Math.min(maxX + 1, this.numStudsX));
    const z0 = Math.max(0, Math.min(minZ, this.numStudsZ));
    const z1 = Math.max(0, Math.min(maxZ + 1, this.numStudsZ));
    const y0 = Math.max(0, Math.min(minY, this.numPlatesY));
    const y1 = Math.max(0, Math.min(maxY + 1, this.numPlatesY));

    if (x0 >= x1 || z0 >= z1 || y0 >= y1) return 0;

    // Inclusion-Exclusion formula for 3D box:
    // S = + I(x1, z1, y1)
    //     - I(x0, z1, y1) - I(x1, z0, y1) - I(x1, z1, y0)
    //     + I(x0, z0, y1) + I(x0, z1, y0) + I(x1, z0, y0)
    //     - I(x0, z0, y0)

    const v111 = this.table[this.getTableIndex(x1, z1, y1)];
    const v011 = this.table[this.getTableIndex(x0, z1, y1)];
    const v101 = this.table[this.getTableIndex(x1, z0, y1)];
    const v110 = this.table[this.getTableIndex(x1, z1, y0)];
    const v001 = this.table[this.getTableIndex(x0, z0, y1)];
    const v010 = this.table[this.getTableIndex(x0, z1, y0)];
    const v100 = this.table[this.getTableIndex(x1, z0, y0)];
    const v000 = this.table[this.getTableIndex(x0, z0, y0)];

    return v111 - v011 - v101 - v110 + v001 + v010 + v100 - v000;
  }

  /**
   * Returns normalized occupancy density [0.0 .. 1.0] of the box.
   */
  public queryDensity(minX: number, minZ: number, minY: number, maxX: number, maxZ: number, maxY: number): number {
    const width = maxX - minX + 1;
    const depth = maxZ - minZ + 1;
    const height = maxY - minY + 1;
    const volume = width * depth * height;
    if (volume <= 0) return 0;

    const count = this.queryBox(minX, minZ, minY, maxX, maxZ, maxY);
    return Math.max(0, Math.min(1.0, count / volume));
  }
}
