/**
 * High-performance 3D Dynamic Bitset for O(1) collision testing and voxel claim tracking.
 * Encodes active voxel availability using BigUint64Array bit words.
 */
export class LegoBitset3D {
  public readonly numStudsX: number;
  public readonly numStudsZ: number;
  public readonly numPlatesY: number;
  public readonly totalCells: number;

  private words: BigUint64Array;
  private readonly totalWords: number;

  // Array mapping each cell index to the placed brick instance ID (or empty string if unclaimed)
  private cellOwners: (string | null)[];

  constructor(numStudsX: number, numStudsZ: number, numPlatesY: number) {
    this.numStudsX = numStudsX;
    this.numStudsZ = numStudsZ;
    this.numPlatesY = numPlatesY;
    this.totalCells = numStudsX * numStudsZ * numPlatesY;

    this.totalWords = Math.ceil(this.totalCells / 64);
    this.words = new BigUint64Array(this.totalWords);
    this.cellOwners = new Array(this.totalCells).fill(null);
  }

  public getIndex(x: number, z: number, y: number): number {
    return (y * this.numStudsZ + z) * this.numStudsX + x;
  }

  public isInBounds(x: number, z: number, y: number): boolean {
    return (
      x >= 0 && x < this.numStudsX &&
      z >= 0 && z < this.numStudsZ &&
      y >= 0 && y < this.numPlatesY
    );
  }

  public setAvailable(x: number, z: number, y: number, available: boolean): void {
    if (!this.isInBounds(x, z, y)) return;
    const idx = this.getIndex(x, z, y);
    const wordIdx = Math.floor(idx / 64);
    const bitPos = BigInt(idx % 64);

    if (available) {
      this.words[wordIdx] |= (1n << bitPos);
    } else {
      this.words[wordIdx] &= ~(1n << bitPos);
    }
  }

  public isAvailable(x: number, z: number, y: number): boolean {
    if (!this.isInBounds(x, z, y)) return false;
    const idx = this.getIndex(x, z, y);
    const wordIdx = Math.floor(idx / 64);
    const bitPos = BigInt(idx % 64);
    return (this.words[wordIdx] & (1n << bitPos)) !== 0n;
  }

  /**
   * Initializes bitset from plate lattice occupancy:
   * Sets bit = 1 for occupied atomic voxels, and 0 for air.
   */
  public initializeFromLattice(occupancy: Uint8Array): void {
    this.words.fill(0n);
    this.cellOwners.fill(null);

    for (let i = 0; i < this.totalCells; i++) {
      if (occupancy[i] === 1) {
        const wordIdx = Math.floor(i / 64);
        const bitPos = BigInt(i % 64);
        this.words[wordIdx] |= (1n << bitPos);
      }
    }
  }

  /**
   * Fast region test: checks if all voxels in [x..x+w-1] x [z..z+d-1] x [y..y+h-1] are available.
   */
  public isRegionAvailable(
    x: number,
    z: number,
    y: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number
  ): boolean {
    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return false;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          const idx = this.getIndex(x + dx, z + dz, y + dy);
          const wordIdx = Math.floor(idx / 64);
          const bitPos = BigInt(idx % 64);
          if ((this.words[wordIdx] & (1n << bitPos)) === 0n) {
            return false; // Already claimed or not part of solid model
          }
        }
      }
    }
    return true;
  }

  /**
   * Checks whether placing a bounding volume would physically collide with an already-claimed brick.
   * Hard physical constraint: two bricks cannot occupy the same physical cell.
   */
  public hasRegionCollision(
    x: number,
    z: number,
    y: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number
  ): boolean {
    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return true; // Out of bounds
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          const idx = this.getIndex(x + dx, z + dz, y + dy);
          if (this.cellOwners[idx] !== null) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Checks whether placing a 3D mask would physically collide with an already-claimed brick.
   */
  public hasMaskCollision(
    x: number,
    z: number,
    y: number,
    mask: boolean[][][]
  ): boolean {
    const heightPlates = mask.length;
    if (heightPlates === 0) return true;
    const depthStuds = mask[0].length;
    if (depthStuds === 0) return true;
    const widthStuds = mask[0][0].length;

    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return true;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          if (mask[dy][dz][dx]) {
            const idx = this.getIndex(x + dx, z + dz, y + dy);
            if (this.cellOwners[idx] !== null) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Claims a block of voxels for a placed brick instance.
   * Clears availability bits (sets to 0) and records owner instanceId.
   */
  public claimRegion(
    x: number,
    z: number,
    y: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number,
    brickInstanceId: string
  ): void {
    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          const idx = this.getIndex(x + dx, z + dz, y + dy);
          const wordIdx = Math.floor(idx / 64);
          const bitPos = BigInt(idx % 64);
          if (wordIdx < this.words.length) {
            this.words[wordIdx] &= ~(1n << bitPos);
          }
          if (idx < this.cellOwners.length) {
            this.cellOwners[idx] = brickInstanceId;
          }
        }
      }
    }
  }

  /**
   * Releases a claimed region (e.g. for rollback or replacement).
   */
  public releaseRegion(
    x: number,
    z: number,
    y: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number
  ): void {
    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          const idx = this.getIndex(x + dx, z + dz, y + dy);
          const wordIdx = Math.floor(idx / 64);
          const bitPos = BigInt(idx % 64);
          if (wordIdx < this.words.length) {
            this.words[wordIdx] |= (1n << bitPos);
          }
          if (idx < this.cellOwners.length) {
            this.cellOwners[idx] = null;
          }
        }
      }
    }
  }

  /**
   * Evaluates if a 3D mask is available at (x, z, y):
   * - Cells where mask[dy][dz][dx] === true MUST be occupied in the model and unclaimed.
   * - Cells where mask[dy][dz][dx] === false (the receded cutout of slopes/wedges) MUST NOT collide with an already-claimed brick.
   */
  public isMaskAvailable(
    x: number,
    z: number,
    y: number,
    mask: boolean[][][]
  ): boolean {
    const heightPlates = mask.length;
    if (heightPlates === 0) return false;
    const depthStuds = mask[0].length;
    if (depthStuds === 0) return false;
    const widthStuds = mask[0][0].length;

    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return false;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          const isSolid = mask[dy][dz][dx];
          const idx = this.getIndex(x + dx, z + dz, y + dy);
          const wordIdx = Math.floor(idx / 64);
          const bitPos = BigInt(idx % 64);

          if (isSolid) {
            // Must be solid voxel in model AND unclaimed
            if ((this.words[wordIdx] & (1n << bitPos)) === 0n) {
              return false;
            }
          } else {
            // Cutout region of slope/wedge: must not collide with an already-claimed brick
            if (this.cellOwners[idx] !== null) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Claims voxels corresponding to the solid cells of the 3D mask.
   */
  public claimMask(
    x: number,
    z: number,
    y: number,
    mask: boolean[][][],
    brickInstanceId: string
  ): void {
    const heightPlates = mask.length;
    if (heightPlates === 0) return;
    const depthStuds = mask[0].length;
    if (depthStuds === 0) return;
    const widthStuds = mask[0][0].length;

    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          if (mask[dy][dz][dx]) {
            const idx = this.getIndex(x + dx, z + dz, y + dy);
            const wordIdx = Math.floor(idx / 64);
            const bitPos = BigInt(idx % 64);
            if (wordIdx < this.words.length) {
              this.words[wordIdx] &= ~(1n << bitPos);
            }
            if (idx < this.cellOwners.length) {
              this.cellOwners[idx] = brickInstanceId;
            }
          }
        }
      }
    }
  }

  /**
   * Releases voxels corresponding to the solid cells of the 3D mask.
   */
  public releaseMask(
    x: number,
    z: number,
    y: number,
    mask: boolean[][][]
  ): void {
    const heightPlates = mask.length;
    if (heightPlates === 0) return;
    const depthStuds = mask[0].length;
    if (depthStuds === 0) return;
    const widthStuds = mask[0][0].length;

    if (
      x < 0 || x + widthStuds > this.numStudsX ||
      z < 0 || z + depthStuds > this.numStudsZ ||
      y < 0 || y + heightPlates > this.numPlatesY
    ) {
      return;
    }

    for (let dy = 0; dy < heightPlates; dy++) {
      for (let dz = 0; dz < depthStuds; dz++) {
        for (let dx = 0; dx < widthStuds; dx++) {
          if (mask[dy][dz][dx]) {
            const idx = this.getIndex(x + dx, z + dz, y + dy);
            const wordIdx = Math.floor(idx / 64);
            const bitPos = BigInt(idx % 64);
            if (wordIdx < this.words.length) {
              this.words[wordIdx] |= (1n << bitPos);
            }
            if (idx < this.cellOwners.length) {
              this.cellOwners[idx] = null;
            }
          }
        }
      }
    }
  }

  public getCellOwner(x: number, z: number, y: number): string | null {
    if (!this.isInBounds(x, z, y)) return null;
    return this.cellOwners[this.getIndex(x, z, y)];
  }

  public isClaimed(x: number, z: number, y: number): boolean {
    if (!this.isInBounds(x, z, y)) return false;
    return this.cellOwners[this.getIndex(x, z, y)] !== null;
  }
}
