import type { GridCoord3D, VoxelCellData } from './types';

export class PlateLattice3D {
  public readonly numStudsX: number;
  public readonly numStudsZ: number;
  public readonly numPlatesY: number;
  public readonly totalCells: number;

  private occupancy: Uint8Array;
  private depth: Uint16Array;
  private normals: Float32Array; // 3 floats per cell (nx, ny, nz)
  private colors: Uint32Array; // 0x00RRGGBB
  private islands: Uint16Array;

  public totalOccupied: number = 0;
  public bounds: {
    minX: number;
    minZ: number;
    minY: number;
    maxX: number;
    maxZ: number;
    maxY: number;
  };

  // Continuous world-space bounding box and pitches for 1:1 mesh alignment
  public worldMin: [number, number, number] = [0, 0, 0];
  public worldStudPitch: number = 1.0;
  public worldPlatePitch: number = 0.4;

  constructor(numStudsX: number, numStudsZ: number, numPlatesY: number) {
    this.numStudsX = numStudsX;
    this.numStudsZ = numStudsZ;
    this.numPlatesY = numPlatesY;
    this.totalCells = numStudsX * numStudsZ * numPlatesY;

    this.occupancy = new Uint8Array(this.totalCells);
    this.depth = new Uint16Array(this.totalCells);
    this.normals = new Float32Array(this.totalCells * 3);
    this.colors = new Uint32Array(this.totalCells);
    this.islands = new Uint16Array(this.totalCells);

    this.bounds = {
      minX: numStudsX,
      minZ: numStudsZ,
      minY: numPlatesY,
      maxX: -1,
      maxZ: -1,
      maxY: -1
    };
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

  public setVoxel(
    x: number,
    z: number,
    y: number,
    colorPacked: number,
    normal: [number, number, number] = [0, 1, 0],
    islandId: number = 1
  ): boolean {
    if (!this.isInBounds(x, z, y)) return false;

    const idx = this.getIndex(x, z, y);
    if (this.occupancy[idx] === 0) {
      this.totalOccupied++;
      if (x < this.bounds.minX) this.bounds.minX = x;
      if (x > this.bounds.maxX) this.bounds.maxX = x;
      if (z < this.bounds.minZ) this.bounds.minZ = z;
      if (z > this.bounds.maxZ) this.bounds.maxZ = z;
      if (y < this.bounds.minY) this.bounds.minY = y;
      if (y > this.bounds.maxY) this.bounds.maxY = y;
    }

    this.occupancy[idx] = 1;
    this.colors[idx] = colorPacked;
    this.islands[idx] = islandId;

    const nIdx = idx * 3;
    this.normals[nIdx] = normal[0];
    this.normals[nIdx + 1] = normal[1];
    this.normals[nIdx + 2] = normal[2];

    return true;
  }

  public isOccupied(x: number, z: number, y: number): boolean {
    if (!this.isInBounds(x, z, y)) return false;
    return this.occupancy[this.getIndex(x, z, y)] === 1;
  }

  public getVoxel(x: number, z: number, y: number): VoxelCellData | null {
    if (!this.isInBounds(x, z, y)) return null;
    const idx = this.getIndex(x, z, y);
    if (this.occupancy[idx] === 0) return null;

    const nIdx = idx * 3;
    const colorPacked = this.colors[idx];
    const hex = '#' + colorPacked.toString(16).padStart(6, '0');

    return {
      occupied: true,
      colorHex: hex,
      colorPacked,
      normal: [this.normals[nIdx], this.normals[nIdx + 1], this.normals[nIdx + 2]],
      islandId: this.islands[idx],
      depth: this.depth[idx]
    };
  }

  public getDepth(x: number, z: number, y: number): number {
    if (!this.isInBounds(x, z, y)) return 0;
    return this.depth[this.getIndex(x, z, y)];
  }

  public getOccupancyBuffer(): Uint8Array {
    return this.occupancy;
  }

  /**
   * Computes discrete distance transform from exterior air into solid voxels.
   * Boundary surface hull voxels (touching empty air) receive depth 0.
   * Subsequent layers inward receive depth >= 1.
   */
  public computeDistanceTransform(): void {
    if (this.totalOccupied === 0) return;

    // Reset depths
    this.depth.fill(65535);

    const queue: number[] = [];
    const nx = this.numStudsX;
    const nz = this.numStudsZ;
    const ny = this.numPlatesY;

    // Pass 1: Identify all occupied voxels that touch empty air (6-connected neighbors)
    const offsets = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    for (let y = this.bounds.minY; y <= this.bounds.maxY; y++) {
      for (let z = this.bounds.minZ; z <= this.bounds.maxZ; z++) {
        for (let x = this.bounds.minX; x <= this.bounds.maxX; x++) {
          const idx = this.getIndex(x, z, y);
          if (this.occupancy[idx] === 0) continue;

          let touchesAir = false;
          for (const [dx, dz, dy] of offsets) {
            const nxPos = x + dx;
            const nzPos = z + dz;
            const nyPos = y + dy;

            if (!this.isInBounds(nxPos, nzPos, nyPos) || this.occupancy[this.getIndex(nxPos, nzPos, nyPos)] === 0) {
              touchesAir = true;
              break;
            }
          }

          if (touchesAir) {
            this.depth[idx] = 0; // Surface Hull boundary
            queue.push(x, z, y);
          }
        }
      }
    }

    // Pass 2: BFS outward/inward to propagate depth integers
    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cz = queue[head++];
      const cy = queue[head++];
      const curDepth = this.depth[this.getIndex(cx, cz, cy)];

      for (const [dx, dz, dy] of offsets) {
        const nxPos = cx + dx;
        const nzPos = cz + dz;
        const nyPos = cy + dy;

        if (this.isInBounds(nxPos, nzPos, nyPos)) {
          const nIdx = this.getIndex(nxPos, nzPos, nyPos);
          if (this.occupancy[nIdx] === 1 && this.depth[nIdx] > curDepth + 1) {
            this.depth[nIdx] = curDepth + 1;
            queue.push(nxPos, nzPos, nyPos);
          }
        }
      }
    }
  }

  /**
   * Convert discrete grid coordinates [x, z, y] and part dimensions [widthStuds, depthStuds, heightPlates]
   * to official LDraw position coordinates in LDU (centered horizontally, Y negative downwards).
   */
  public gridToLDraw(
    x: number,
    z: number,
    y: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number
  ): [number, number, number] {
    const ldrawX = (x + widthStuds / 2 - this.numStudsX / 2) * 20.0;
    const ldrawZ = (z + depthStuds / 2 - this.numStudsZ / 2) * 20.0;
    // In LDraw, 1 plate = 8 LDU. Origin Y=0 is the top surface of the piece, Y goes downward.
    const ldrawY = -(y * 8.0 + heightPlates * 8.0);
    return [ldrawX, ldrawY, ldrawZ];
  }

  /**
   * Convert discrete grid coordinates [gx, gz, gy] and optional offsets
   * directly to authentic continuous 3D world scene coordinates matching the input mesh.
   */
  public gridToWorld(gx: number, gz: number, gy: number): [number, number, number] {
    const wx = this.worldMin[0] + gx * this.worldStudPitch;
    const wy = this.worldMin[1] + gy * this.worldPlatePitch;
    const wz = this.worldMin[2] + gz * this.worldStudPitch;
    return [wx, wy, wz];
  }
}
