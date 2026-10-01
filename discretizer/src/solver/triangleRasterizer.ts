import * as THREE from 'three';
import { PlateLattice3D } from '../core/PlateLattice3D';
import type { MeshIsland } from './islandSegmenter';

export interface RasterizerOptions {
  /** Target resolution along largest horizontal dimension (default 24 studs) */
  targetStuds: number;
  onProgress?: (percent: number) => void;
}

/**
 * Direct Triangle Surface Rasterizer into PlateLattice3D with Barycentric 24-bit RGB and Normals.
 */
export async function rasterizeIslandsToLatticeAsync(
  islands: MeshIsland[],
  options: RasterizerOptions
): Promise<PlateLattice3D> {
  const { targetStuds, onProgress } = options;

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
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Horizontal stud pitch = 20 LDU, Plate height = 8 LDU
  // Stud to plate aspect ratio: height / width = 8 / 20 = 0.4
  const maxHorizontalDim = Math.max(size.x, size.z, 0.001);
  const studScale = targetStuds / maxHorizontalDim; // Grid units per world unit

  const numStudsX = Math.max(4, Math.ceil(size.x * studScale) + 4);
  const numStudsZ = Math.max(4, Math.ceil(size.z * studScale) + 4);
  // In LEGO, 1 stud = 20 LDU, 1 plate = 8 LDU => vertical resolution is 20/8 = 2.5 plates per stud
  const numPlatesY = Math.max(3, Math.ceil(size.y * studScale * 2.5) + 3);

  const lattice = new PlateLattice3D(numStudsX, numStudsZ, numPlatesY);

  const minX = bbox.min.x;
  const minZ = bbox.min.z;
  const minY = bbox.min.y;

  // Coordinate mapping from continuous 3D to integer plate grid
  const worldToGrid = (pt: THREE.Vector3): [number, number, number] => {
    const gx = Math.floor((pt.x - minX) * studScale + 2);
    const gz = Math.floor((pt.z - minZ) * studScale + 2);
    const gy = Math.floor((pt.y - minY) * studScale * 2.5 + 1);
    return [gx, gz, gy];
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

  // Rasterize surface triangles island-by-island
  let processedTris = 0;
  const totalTris = islands.reduce((acc, isl) => acc + isl.triangleCount, 0);

  for (const island of islands) {
    for (const tri of island.triangles) {
      const va = tri.a;
      const vb = tri.b;
      const vc = tri.c;
      const fn = tri.normal;

      // Compute edge lengths in world space
      const e1 = new THREE.Vector3().subVectors(vb, va);
      const e2 = new THREE.Vector3().subVectors(vc, va);
      const l1 = e1.length() * studScale * 2.5;
      const l2 = e2.length() * studScale * 2.5;

      const steps1 = Math.max(1, Math.ceil(l1 * 1.5));
      const steps2 = Math.max(1, Math.ceil(l2 * 1.5));

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

          lattice.setVoxel(
            gx,
            gz,
            gy,
            colorPacked,
            [fn.x, fn.y, fn.z],
            island.id
          );
        }
      }

      processedTris++;
      if (processedTris % 2500 === 0) {
        if (onProgress) onProgress(Math.round((processedTris / totalTris) * 85));
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  // Compute 6-connected distance transform (depth 0 = surface hull, depth >= 1 = interior core)
  if (onProgress) onProgress(90);
  lattice.computeDistanceTransform();

  if (onProgress) onProgress(100);
  return lattice;
}
