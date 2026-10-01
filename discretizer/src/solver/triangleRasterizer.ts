import * as THREE from 'three';
import { PlateLattice3D } from '../core/PlateLattice3D';
import type { MeshIsland } from './islandSegmenter';

export interface RasterizerOptions {
  /** Target resolution along largest horizontal dimension (default 24 units, up to 64) */
  targetStuds: number;
  /** Vertical unit mode: 'stud' (plates, 1 unit = 0.4 stud = 8 LDU) or 'brick' (1 unit = 3 plates = 1.2 studs = 24 LDU) */
  verticalUnit?: 'stud' | 'brick';
  /** Snaps mesh triangle vertices to the discrete grid before rasterization */
  snapVertices?: boolean;
  /** Leave the core hollow, discretizing only the outer shell/hull (default true per user directive) */
  hollowCore?: boolean;
  /** Morphological thickness of the outer shell in voxels (default 2 to eliminate holes and provide brick depth) */
  shellThickness?: number;
  onProgress?: (percent: number) => void;
}

/**
 * Direct Triangle Surface Rasterizer into PlateLattice3D with Barycentric 24-bit RGB and Normals.
 * Discretizes the surface hull into 6-connected voxels, leaving the interior core hollow per user directive.
 */
export async function rasterizeIslandsToLatticeAsync(
  islands: MeshIsland[],
  options: RasterizerOptions
): Promise<PlateLattice3D> {
  const { targetStuds, verticalUnit = 'stud', snapVertices = false, hollowCore = true, shellThickness = 2, onProgress } = options;

  // 1. Calculate world bounding box across all islands
  const bbox = new THREE.Box3();
  for (const island of islands) {
    for (const tri of island.triangles) {
      bbox.expandByPoint(tri.a);
      bbox.expandByPoint(tri.b);
      bbox.expandByPoint(tri.c);
    }
  }

  const size = new THREE.Vector3();
  bbox.getSize(size);

  // Resolution along largest dimension: 2 to 128 units
  const resolution = Math.max(2, Math.min(128, targetStuds));
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const worldStudPitch = maxDim / resolution;
  // Authentic LEGO vertical pitch:
  // Plate mode: 1 unit = 1 plate = 8 LDU = 0.4 studs
  // Brick mode: 1 unit = 1 brick = 24 LDU = 3 plates = 1.2 studs
  const worldPlatePitch = verticalUnit === 'brick' ? worldStudPitch * 1.2 : worldStudPitch * 0.4;

  const numStudsX = Math.max(1, Math.ceil(size.x / worldStudPitch));
  const numStudsZ = Math.max(1, Math.ceil(size.z / worldStudPitch));
  const numPlatesY = Math.max(1, Math.ceil(size.y / worldPlatePitch)) + 4;

  const lattice = new PlateLattice3D(numStudsX, numStudsZ, numPlatesY);
  lattice.verticalUnit = verticalUnit;
  lattice.worldMin = [bbox.min.x, bbox.min.y, bbox.min.z];
  lattice.worldStudPitch = worldStudPitch;
  lattice.worldPlatePitch = worldPlatePitch;

  const minX = bbox.min.x;
  const minZ = bbox.min.z;
  const minY = bbox.min.y;

  // Direct 1:1 coordinate mapping from continuous 3D to integer plate grid
  const worldToGrid = (pt: THREE.Vector3): [number, number, number] => {
    const gx = Math.min(numStudsX - 1, Math.max(0, Math.floor((pt.x - minX) / worldStudPitch)));
    const gz = Math.min(numStudsZ - 1, Math.max(0, Math.floor((pt.z - minZ) / worldStudPitch)));
    const gy = Math.min(numPlatesY - 1, Math.max(0, Math.floor((pt.y - minY) / worldPlatePitch)));
    return [gx, gz, gy];
  };

  const snapPoint = (pt: THREE.Vector3): THREE.Vector3 => {
    if (!snapVertices) return pt;
    const sx = Math.round((pt.x - minX) / worldStudPitch) * worldStudPitch + minX;
    const sz = Math.round((pt.z - minZ) / worldStudPitch) * worldStudPitch + minZ;
    const sy = Math.round((pt.y - minY) / worldPlatePitch) * worldPlatePitch + minY;
    return new THREE.Vector3(sx, sy, sz);
  };

  // Helper to extract 24-bit packed RGB color
  const sampleColor = (
    tri: MeshIsland['triangles'][0],
    u: number,
    v: number,
    w: number
  ): number => {
    // 1. Vertex colors
    if (tri.colorA && tri.colorB && tri.colorC) {
      const r = Math.round((tri.colorA.r * w + tri.colorB.r * u + tri.colorC.r * v) * 255);
      const g = Math.round((tri.colorA.g * w + tri.colorB.g * u + tri.colorC.g * v) * 255);
      const b = Math.round((tri.colorA.b * w + tri.colorB.b * u + tri.colorC.b * v) * 255);
      return (r << 16) | (g << 8) | b;
    }

    // 2. Material color
    if (tri.material && (tri.material as any).color) {
      const c = (tri.material as any).color as THREE.Color;
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);
      return (r << 16) | (g << 8) | b;
    }

    // Default neutral grey
    return 0x94a3b8;
  };

  // Step 1: Rasterize surface triangles island-by-island
  let processedTris = 0;
  const totalTris = islands.reduce((acc, isl) => acc + isl.triangleCount, 0);

  for (const island of islands) {
    for (const tri of island.triangles) {
      const va = snapPoint(tri.a);
      const vb = snapPoint(tri.b);
      const vc = snapPoint(tri.c);
      const fn = tri.normal;

      // Compute edge lengths relative to plate pitch for dense sampling
      const e1 = new THREE.Vector3().subVectors(vb, va);
      const e2 = new THREE.Vector3().subVectors(vc, va);
      const l1 = Math.max(1, e1.length() / worldPlatePitch);
      const l2 = Math.max(1, e2.length() / worldPlatePitch);

      const steps1 = Math.max(1, Math.ceil(l1 * 2.0));
      const steps2 = Math.max(1, Math.ceil(l2 * 2.0));

      for (let s1 = 0; s1 <= steps1; s1++) {
        const u = s1 / steps1;
        for (let s2 = 0; s2 <= steps2 - s1; s2++) {
          const v = s2 / steps2;
          const w = 1.0 - u - v;
          if (w < 0) continue;

          const p = new THREE.Vector3()
            .copy(va)
            .addScaledVector(e1, u)
            .addScaledVector(e2, v);

          const [gx, gz, gy] = worldToGrid(p);
          const colorPacked = sampleColor(tri, u, v, w);

          lattice.setVoxel(gx, gz, gy, colorPacked, [fn.x, fn.y, fn.z], island.id);
        }
      }

      processedTris++;
      if (processedTris % 2500 === 0) {
        if (onProgress) onProgress(Math.round((processedTris / totalTris) * 50));
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  // Step 2: Close micro-apertures and narrow joint gaps on thin struts/stems
  closeJointGaps(lattice);

  // Step 3: Aperture-Sealed Exterior Flood Fill or Morphological Shell Thickening
  if (!hollowCore) {
    if (onProgress) onProgress(65);
    fillInteriorCavities(lattice);
    closeJointGaps(lattice);
  } else if (shellThickness > 1) {
    if (onProgress) onProgress(65);
    thickenHollowShell(lattice, shellThickness);
    closeJointGaps(lattice);
  }

  // Step 4: Compute 6-connected distance transform
  if (onProgress) onProgress(85);
  lattice.computeDistanceTransform();

  if (onProgress) onProgress(100);
  return lattice;
}

/**
 * Enforces 6-connectivity (face contact) across narrow articulated joints,
 * thin struts, and multi-mesh boundaries to prevent disjoint components.
 */
function closeJointGaps(lattice: PlateLattice3D): void {
  const { numStudsX, numStudsZ, numPlatesY } = lattice;
  for (let y = 1; y < numPlatesY - 1; y++) {
    for (let z = 1; z < numStudsZ - 1; z++) {
      for (let x = 1; x < numStudsX - 1; x++) {
        if (!lattice.isOccupied(x, z, y)) {
          const hasX = lattice.isOccupied(x - 1, z, y) && lattice.isOccupied(x + 1, z, y);
          const hasZ = lattice.isOccupied(x, z - 1, y) && lattice.isOccupied(x, z + 1, y);
          const hasY = lattice.isOccupied(x, z, y - 1) && lattice.isOccupied(x, z, y + 1);
          if (hasX || hasZ || hasY) {
            const sampleX = hasX ? x - 1 : x;
            const sampleZ = hasZ ? z - 1 : z;
            const sampleY = hasY ? y - 1 : y;
            const refColor = lattice.getVoxel(sampleX, sampleZ, sampleY)?.colorPacked ?? 0x94a3b8;
            lattice.setVoxel(x, z, y, refColor, [0, 1, 0], 0);
          }
        }
      }
    }
  }
}

/**
 * Aperture-Sealed Exterior Flood Fill:
 * Uses 26-connectivity morphological boundary sealing to prevent exterior air
 * from leaking through diagonal triangle seams into the interior of watertight meshes.
 * Solidly fills enclosed interior volumes while strictly preserving open exterior air
 * (e.g. open space between table legs, open arches).
 */
function fillInteriorCavities(lattice: PlateLattice3D): void {
  const { numStudsX, numStudsZ, numPlatesY } = lattice;

  // Snapshot original solid surface mask
  const solid: boolean[][][] = [];
  for (let x = 0; x < numStudsX; x++) {
    solid[x] = [];
    for (let z = 0; z < numStudsZ; z++) {
      solid[x][z] = [];
      for (let y = 0; y < numPlatesY; y++) {
        solid[x][z][y] = lattice.isOccupied(x, z, y);
      }
    }
  }

  // 1. Morphologically dilate boundary (26-connectivity) by 1 cell to seal micro-apertures
  const dilated: boolean[][][] = [];
  for (let x = 0; x < numStudsX; x++) {
    dilated[x] = [];
    for (let z = 0; z < numStudsZ; z++) {
      dilated[x][z] = [];
      for (let y = 0; y < numPlatesY; y++) {
        let occ = false;
        for (let dx = -1; dx <= 1 && !occ; dx++) {
          for (let dz = -1; dz <= 1 && !occ; dz++) {
            for (let dy = -1; dy <= 1 && !occ; dy++) {
              const ax = x + dx, az = z + dz, ay = y + dy;
              if (ax >= 0 && ax < numStudsX && az >= 0 && az < numStudsZ && ay >= 0 && ay < numPlatesY) {
                if (solid[ax][az][ay]) occ = true;
              }
            }
          }
        }
        dilated[x][z][y] = occ;
      }
    }
  }

  // 2. Flood fill exterior air on padded grid
  const padX = numStudsX + 2;
  const padZ = numStudsZ + 2;
  const padY = numPlatesY + 2;

  const isExterior: boolean[][][] = [];
  for (let x = 0; x < padX; x++) {
    isExterior[x] = [];
    for (let z = 0; z < padZ; z++) {
      isExterior[x][z] = new Array(padY).fill(false);
    }
  }

  const queue: [number, number, number][] = [[0, 0, 0]];
  isExterior[0][0][0] = true;
  let qHead = 0;

  while (qHead < queue.length) {
    const [cx, cz, cy] = queue[qHead++];
    const neighbors: [number, number, number][] = [
      [cx + 1, cz, cy], [cx - 1, cz, cy],
      [cx, cz + 1, cy], [cx, cz - 1, cy],
      [cx, cz, cy + 1], [cx, cz, cy - 1]
    ];

    for (const [nx, nz, ny] of neighbors) {
      if (nx >= 0 && nx < padX && nz >= 0 && nz < padZ && ny >= 0 && ny < padY) {
        if (!isExterior[nx][nz][ny]) {
          const gx = nx - 1;
          const gz = nz - 1;
          const gy = ny - 1;
          const isInside = gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ && gy >= 0 && gy < numPlatesY;
          const isOccupied = isInside && dilated[gx][gz][gy];
          if (!isOccupied) {
            isExterior[nx][nz][ny] = true;
            queue.push([nx, nz, ny]);
          }
        }
      }
    }
  }

  // 3. Compute original surface bounding ranges
  const minX_zy: number[][] = [];
  const maxX_zy: number[][] = [];
  for (let z = 0; z < numStudsZ; z++) {
    minX_zy[z] = new Array(numPlatesY).fill(-1);
    maxX_zy[z] = new Array(numPlatesY).fill(-1);
    for (let y = 0; y < numPlatesY; y++) {
      for (let x = 0; x < numStudsX; x++) {
        if (solid[x][z][y]) {
          if (minX_zy[z][y] === -1) minX_zy[z][y] = x;
          maxX_zy[z][y] = x;
        }
      }
    }
  }

  const minZ_xy: number[][] = [];
  const maxZ_xy: number[][] = [];
  for (let x = 0; x < numStudsX; x++) {
    minZ_xy[x] = new Array(numPlatesY).fill(-1);
    maxZ_xy[x] = new Array(numPlatesY).fill(-1);
    for (let y = 0; y < numPlatesY; y++) {
      for (let z = 0; z < numStudsZ; z++) {
        if (solid[x][z][y]) {
          if (minZ_xy[x][y] === -1) minZ_xy[x][y] = z;
          maxZ_xy[x][y] = z;
        }
      }
    }
  }

  // 4. Fill all interior cavities within the original geometry boundary
  for (let x = 0; x < numStudsX; x++) {
    for (let z = 0; z < numStudsZ; z++) {
      for (let y = 0; y < numPlatesY; y++) {
        if (!lattice.isOccupied(x, z, y)) {
          const notExt = !isExterior[x + 1][z + 1][y + 1];
          const boundedX = minX_zy[z][y] !== -1 && x >= minX_zy[z][y] && x <= maxX_zy[z][y];
          const boundedZ = minZ_xy[x][y] !== -1 && z >= minZ_xy[x][y] && z <= maxZ_xy[x][y];

          if (notExt && (boundedX || boundedZ)) {
            let nearestCol = 0x94a3b8;
            let minDistSq = Infinity;
            for (let dx = -3; dx <= 3 && minDistSq > 1; dx++) {
              for (let dz = -3; dz <= 3 && minDistSq > 1; dz++) {
                const ax = x + dx, az = z + dz;
                if (ax >= 0 && ax < numStudsX && az >= 0 && az < numStudsZ) {
                  if (solid[ax][az][y]) {
                    const d2 = dx * dx + dz * dz;
                    if (d2 < minDistSq) {
                      minDistSq = d2;
                      const vox = lattice.getVoxel(ax, az, y);
                      if (vox) nearestCol = vox.colorPacked;
                    }
                  }
                }
              }
            }
            lattice.setVoxel(x, z, y, nearestCol, [0, 1, 0], 0);
          }
        }
      }
    }
  }
}

/**
 * Thickens a hollow shell inward by `thickness` voxels (default 2).
 * Expands inward along inverted surface normals while strictly keeping
 * exterior air untouched and preserving the hollow interior core.
 */
function thickenHollowShell(lattice: PlateLattice3D, thickness: number = 2): void {
  if (thickness <= 1) return;

  const { numStudsX, numStudsZ, numPlatesY } = lattice;

  // 1. Identify exterior air using 26-connectivity flood fill from padded boundary
  const padX = numStudsX + 2;
  const padZ = numStudsZ + 2;
  const padY = numPlatesY + 2;

  const isExterior: boolean[][][] = [];
  for (let x = 0; x < padX; x++) {
    isExterior[x] = [];
    for (let z = 0; z < padZ; z++) {
      isExterior[x][z] = new Array(padY).fill(false);
    }
  }

  const queue: [number, number, number][] = [[0, 0, 0]];
  isExterior[0][0][0] = true;
  let qHead = 0;

  while (qHead < queue.length) {
    const [cx, cz, cy] = queue[qHead++];
    const neighbors: [number, number, number][] = [
      [cx + 1, cz, cy], [cx - 1, cz, cy],
      [cx, cz + 1, cy], [cx, cz - 1, cy],
      [cx, cz, cy + 1], [cx, cz, cy - 1]
    ];

    for (const [nx, nz, ny] of neighbors) {
      if (nx >= 0 && nx < padX && nz >= 0 && nz < padZ && ny >= 0 && ny < padY) {
        if (!isExterior[nx][nz][ny]) {
          const gx = nx - 1;
          const gz = nz - 1;
          const gy = ny - 1;
          const isInside = gx >= 0 && gx < numStudsX && gz >= 0 && gz < numStudsZ && gy >= 0 && gy < numPlatesY;
          const isOccupied = isInside && lattice.isOccupied(gx, gz, gy);
          if (!isOccupied) {
            isExterior[nx][nz][ny] = true;
            queue.push([nx, nz, ny]);
          }
        }
      }
    }
  }

  // 2. Perform inward dilation for (thickness - 1) layers
  for (let step = 0; step < thickness - 1; step++) {
    const candidates: { x: number; z: number; y: number; col: number; n: [number, number, number] }[] = [];

    for (let y = 0; y < numPlatesY; y++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let x = 0; x < numStudsX; x++) {
          if (lattice.isOccupied(x, z, y)) {
            const vox = lattice.getVoxel(x, z, y)!;
            const [nx, ny, nz] = vox.normal;

            const neighbors: [number, number, number][] = [
              [x + 1, z, y], [x - 1, z, y],
              [x, z + 1, y], [x, z - 1, y],
              [x, z, y + 1], [x, z, y - 1]
            ];

            for (const [ax, az, ay] of neighbors) {
              if (ax >= 0 && ax < numStudsX && az >= 0 && az < numStudsZ && ay >= 0 && ay < numPlatesY) {
                if (!lattice.isOccupied(ax, az, ay)) {
                  // Must not be exterior air
                  if (!isExterior[ax + 1][az + 1][ay + 1]) {
                    // Inward test: step direction dot normal <= 0.1
                    const dx = ax - x;
                    const dz = az - z;
                    const dy = ay - y;
                    const dot = dx * nx + dz * nz + dy * ny;
                    if (dot <= 0.25) {
                      candidates.push({ x: ax, z: az, y: ay, col: vox.colorPacked, n: vox.normal });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    for (const c of candidates) {
      if (!lattice.isOccupied(c.x, c.z, c.y)) {
        lattice.setVoxel(c.x, c.z, c.y, c.col, c.n, 0);
      }
    }
  }
}
