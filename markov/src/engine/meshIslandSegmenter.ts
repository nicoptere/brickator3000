/**
 * Half-Edge Mesh Island Segmenter for Brickator3000.
 *
 * Implements prepass topological island extraction using half-edge connectivity:
 * 1. Traverses input 3D model (GLTF/OBJ/PLY) and extracts world-space triangles.
 * 2. Builds half-edge adjacency graph with spatial vertex quantization to heal UV/normal seams.
 * 3. Identifies connected triangle components (islands) via Disjoint-Set Union (DSU) / BFS.
 * 4. Isolates each submesh into its own clean BufferGeometry & Mesh.
 * 5. Assigns unique, vibrant random palette colors to every individual island.
 */

import * as THREE from 'three';
import { sampleAnyTexture } from './meshTextureSampler';

export interface MeshIsland {
  id: number;
  name: string;
  triangleCount: number;
  vertexCount: number;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  colorHex: string;
  originalColorHex?: string;
  colorCode: number;
  bbox: THREE.Box3;
  center: THREE.Vector3;
  texture?: THREE.Texture | null;
  decodedTexture?: any | null;
}

/**
 * Generates an authentic, high-contrast random LEGO color for any island index.
 * Uses golden-ratio hue distribution (137.508°) to guarantee adjacent indices never clash.
 */
export function getIslandColorHex(index: number, seed: number = 0): string {
  const hue = Math.round((index * 137.50776405 + seed * 53) % 360);
  const s = 0.88;
  const l = 0.52;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (val: number) => Math.round((val + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// 24 High-contrast, vibrant LEGO-style colors for fallback
export const VIBRANT_ISLAND_PALETTE: string[] = [
  '#ef4444', // Crimson Red
  '#3b82f6', // Royal Blue
  '#10b981', // Emerald Green
  '#f59e0b', // Amber / Gold
  '#8b5cf6', // Violet Purple
  '#06b6d4', // Electric Cyan
  '#ec4899', // Hot Pink
  '#f97316', // Tangerine Orange
  '#14b8a6', // Teal
  '#84cc16', // Lime Green
  '#e11d48', // Ruby Rose
  '#6366f1', // Indigo
  '#d946ef', // Magenta Fuchsia
  '#eab308', // Yellow
  '#a855f7', // Purple
  '#0284c7', // Sky Blue
  '#f43f5e', // Coral Rose
  '#16a34a', // Forest Green
  '#d97706', // Ochre Amber
  '#7c3aed', // Deep Violet
  '#2563eb', // Cobalt Blue
  '#059669', // Mint Jade
  '#ea580c', // Bright Rust
  '#db2777'  // Deep Pink
];

export class MeshIslandSegmenter {
  /**
   * Asynchronously segments any Three.js Object3D into isolated topological half-edge islands.
   * Yields to the event loop at key phases to allow UI progress rendering.
   */
  public static async segmentObjectAsync(
    object: THREE.Object3D,
    eps: number = 0.0005,
    onProgress?: (progress0to1: number, statusText: string) => void
  ): Promise<MeshIsland[]> {
    onProgress?.(0.05, 'Traversing mesh hierarchy and extracting geometry buffers...');
    await new Promise((r) => setTimeout(r, 0));

    object.updateMatrixWorld(true);

    interface GeometryItem {
      geometry: THREE.BufferGeometry;
      materialColor?: THREE.Color;
      texture?: THREE.Texture | null;
      decodedTexture?: any;
    }
    const geometries: GeometryItem[] = [];

    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const nonIndexed = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        nonIndexed.applyMatrix4(mesh.matrixWorld);

        let matColor: THREE.Color | undefined;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (mat && (mat as any).color) {
          matColor = (mat as any).color;
        }

        const texture = (mat as any)?.map || (mesh as any).userData?.texture || (object as any)?.userData?.texture || null;
        const decodedTexture = (mesh as any).userData?.decodedTexture || (mat as any)?.map?.userData?.decodedTexture || (object as any)?.userData?.decodedTexture || null;

        geometries.push({ geometry: nonIndexed, materialColor: matColor, texture, decodedTexture });
      }
    });

    if (geometries.length === 0) {
      onProgress?.(1.0, 'No meshes found.');
      return [];
    }

    let totalVertices = 0;
    for (const item of geometries) {
      totalVertices += item.geometry.attributes.position.count;
    }

    onProgress?.(0.2, `Merged ${geometries.length} submesh buffers (${totalVertices} vertices)...`);
    await new Promise((r) => setTimeout(r, 0));

    const posArray = new Float32Array(totalVertices * 3);
    const normArray = new Float32Array(totalVertices * 3);
    const colorArray = new Float32Array(totalVertices * 3);
    const uvArray = new Float32Array(totalVertices * 2);
    let hasAnyUv = false;

    let offset = 0;
    for (const item of geometries) {
      const g = item.geometry;
      const pos = g.attributes.position;
      const count = pos.count;
      const norm = g.attributes.normal;
      const col = g.attributes.color;
      const uv = g.attributes.uv;
      if (uv) hasAnyUv = true;

      for (let i = 0; i < count; i++) {
        const dstIdx = (offset + i) * 3;
        posArray[dstIdx] = pos.getX(i);
        posArray[dstIdx + 1] = pos.getY(i);
        posArray[dstIdx + 2] = pos.getZ(i);

        if (norm) {
          normArray[dstIdx] = norm.getX(i);
          normArray[dstIdx + 1] = norm.getY(i);
          normArray[dstIdx + 2] = norm.getZ(i);
        } else {
          normArray[dstIdx] = 0;
          normArray[dstIdx + 1] = 1.0;
          normArray[dstIdx + 2] = 0;
        }

        let sampledColor: THREE.Color | null = null;
        if (col) {
          sampledColor = new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
        } else if (uv && (item.texture || item.decodedTexture)) {
          sampledColor = sampleAnyTexture(item.texture || item.decodedTexture, uv.getX(i), uv.getY(i));
        }

        if (sampledColor) {
          colorArray[dstIdx] = sampledColor.r;
          colorArray[dstIdx + 1] = sampledColor.g;
          colorArray[dstIdx + 2] = sampledColor.b;
        } else if (item.materialColor) {
          colorArray[dstIdx] = item.materialColor.r;
          colorArray[dstIdx + 1] = item.materialColor.g;
          colorArray[dstIdx + 2] = item.materialColor.b;
        } else {
          colorArray[dstIdx] = 0.9;
          colorArray[dstIdx + 1] = 0.9;
          colorArray[dstIdx + 2] = 0.9;
        }

        if (uv) {
          const uvDst = (offset + i) * 2;
          uvArray[uvDst] = uv.getX(i);
          uvArray[uvDst + 1] = uv.getY(i);
        }
      }

      offset += count;
    }

    const numTriangles = Math.floor(totalVertices / 3);
    if (numTriangles === 0) return [];

    onProgress?.(0.4, `Building half-edge topological adjacency map for ${numTriangles} triangles...`);
    await new Promise((r) => setTimeout(r, 0));

    const vKey = (vx: number, vy: number, vz: number): string =>
      `${Math.round(vx / eps)}_${Math.round(vy / eps)}_${Math.round(vz / eps)}`;

    const edgeToTris = new Map<string, number[]>();

    for (let t = 0; t < numTriangles; t++) {
      const i0 = t * 3;
      const i1 = t * 3 + 1;
      const i2 = t * 3 + 2;

      const k0 = vKey(posArray[i0 * 3], posArray[i0 * 3 + 1], posArray[i0 * 3 + 2]);
      const k1 = vKey(posArray[i1 * 3], posArray[i1 * 3 + 1], posArray[i1 * 3 + 2]);
      const k2 = vKey(posArray[i2 * 3], posArray[i2 * 3 + 1], posArray[i2 * 3 + 2]);

      const e01 = k0 < k1 ? `${k0}:${k1}` : `${k1}:${k0}`;
      const e12 = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
      const e20 = k2 < k0 ? `${k2}:${k0}` : `${k0}:${k2}`;

      for (const e of [e01, e12, e20]) {
        let list = edgeToTris.get(e);
        if (!list) {
          list = [];
          edgeToTris.set(e, list);
        }
        list.push(t);
      }
    }

    onProgress?.(0.65, `Executing Disjoint-Set Union across ${edgeToTris.size} shared edges...`);
    await new Promise((r) => setTimeout(r, 0));

    const parent = new Int32Array(numTriangles);
    for (let i = 0; i < numTriangles; i++) parent[i] = i;

    const find = (i: number): number => {
      let root = i;
      while (root !== parent[root]) {
        root = parent[root];
      }
      let curr = i;
      while (curr !== root) {
        const next = parent[curr];
        parent[curr] = root;
        curr = next;
      }
      return root;
    };

    const union = (i: number, j: number): void => {
      const r1 = find(i);
      const r2 = find(j);
      if (r1 !== r2) {
        parent[r1] = r2;
      }
    };

    for (const tris of edgeToTris.values()) {
      for (let k = 1; k < tris.length; k++) {
        union(tris[0], tris[k]);
      }
    }

    const islandsMap = new Map<number, number[]>();
    for (let t = 0; t < numTriangles; t++) {
      const root = find(t);
      let list = islandsMap.get(root);
      if (!list) {
        list = [];
        islandsMap.set(root, list);
      }
      list.push(t);
    }

    const sortedEntries = Array.from(islandsMap.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );

    onProgress?.(0.85, `Detected ${sortedEntries.length} topological islands. Building submesh geometries...`);
    await new Promise((r) => setTimeout(r, 0));

    const dominantTexture = geometries.find((g) => g.texture)?.texture || null;
    const dominantDecoded = geometries.find((g) => g.decodedTexture)?.decodedTexture || null;

    const islands: MeshIsland[] = [];

    sortedEntries.forEach(([root, triIndices], idx) => {
      const triCount = triIndices.length;
      const vertCount = triCount * 3;

      const subPos = new Float32Array(vertCount * 3);
      const subNorm = new Float32Array(vertCount * 3);
      const subCol = new Float32Array(vertCount * 3);
      const subUv = hasAnyUv ? new Float32Array(vertCount * 2) : null;

      const colorHex = getIslandColorHex(idx);
      const threeColor = new THREE.Color(colorHex);

      let sumOrigR = 0, sumOrigG = 0, sumOrigB = 0;

      let writeIdx = 0;
      for (const t of triIndices) {
        const srcOffset = t * 3;
        for (let v = 0; v < 3; v++) {
          const s = (srcOffset + v) * 3;
          const d = (writeIdx + v) * 3;

          subPos[d] = posArray[s];
          subPos[d + 1] = posArray[s + 1];
          subPos[d + 2] = posArray[s + 2];

          subNorm[d] = normArray[s];
          subNorm[d + 1] = normArray[s + 1];
          subNorm[d + 2] = normArray[s + 2];

          subCol[d] = colorArray[s];
          subCol[d + 1] = colorArray[s + 1];
          subCol[d + 2] = colorArray[s + 2];

          sumOrigR += colorArray[s];
          sumOrigG += colorArray[s + 1];
          sumOrigB += colorArray[s + 2];

          if (subUv) {
            const uSrc = (srcOffset + v) * 2;
            const uDst = (writeIdx + v) * 2;
            subUv[uDst] = uvArray[uSrc];
            subUv[uDst + 1] = uvArray[uSrc + 1];
          }
        }
        writeIdx += 3;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(subPos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(subNorm, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(subCol, 3));
      if (subUv) {
        geom.setAttribute('uv', new THREE.BufferAttribute(subUv, 2));
      }
      geom.computeBoundingBox();

      const avgR = vertCount > 0 ? Math.round((sumOrigR / vertCount) * 255) : 240;
      const avgG = vertCount > 0 ? Math.round((sumOrigG / vertCount) * 255) : 240;
      const avgB = vertCount > 0 ? Math.round((sumOrigB / vertCount) * 255) : 240;
      const toHex = (val: number) => Math.max(0, Math.min(255, val)).toString(16).padStart(2, '0');
      const originalColorHex = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;

      const bbox = geom.boundingBox || new THREE.Box3();
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      let name = `Island ${idx + 1}`;
      if (idx === 0) name = 'Main Shell / Body';
      else if (triCount > 400) name = `Sub-assembly ${idx + 1}`;
      else if (triCount > 200) name = `Component ${idx + 1}`;
      else name = `Detail Part ${idx + 1}`;

      const mat = new THREE.MeshStandardMaterial({
        color: threeColor,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geom, mat);

      if (dominantTexture) {
        mesh.userData.texture = dominantTexture;
      }
      if (dominantDecoded) {
        mesh.userData.decodedTexture = dominantDecoded;
      }

      islands.push({
        id: idx + 1,
        name,
        triangleCount: triCount,
        vertexCount: vertCount,
        geometry: geom,
        mesh,
        colorHex,
        originalColorHex,
        colorCode: 15,
        bbox,
        center,
        texture: dominantTexture,
        decodedTexture: dominantDecoded
      });
    });

    onProgress?.(1.0, `Completed extraction: ${islands.length} topological mesh islands.`);
    return islands;
  }

  /**
   * Segments any Three.js Object3D into isolated topological half-edge islands (synchronous).
   */
  public static segmentObject(
    object: THREE.Object3D,
    eps: number = 0.0005,
    onProgress?: (progress0to1: number, statusText: string) => void
  ): MeshIsland[] {
    object.updateMatrixWorld(true);

    interface GeometryItem {
      geometry: THREE.BufferGeometry;
      materialColor?: THREE.Color;
      texture?: THREE.Texture | null;
      decodedTexture?: any;
    }
    const geometries: GeometryItem[] = [];

    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const nonIndexed = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        nonIndexed.applyMatrix4(mesh.matrixWorld);

        let matColor: THREE.Color | undefined;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (mat && (mat as any).color) {
          matColor = (mat as any).color;
        }

        const texture = (mat as any)?.map || (mesh as any).userData?.texture || (object as any)?.userData?.texture || null;
        const decodedTexture = (mesh as any).userData?.decodedTexture || (mat as any)?.map?.userData?.decodedTexture || (object as any)?.userData?.decodedTexture || null;

        geometries.push({ geometry: nonIndexed, materialColor: matColor, texture, decodedTexture });
      }
    });

    if (geometries.length === 0) {
      return [];
    }

    // Merge into single non-indexed geometry
    let totalVertices = 0;
    for (const item of geometries) {
      totalVertices += item.geometry.attributes.position.count;
    }

    const posArray = new Float32Array(totalVertices * 3);
    const normArray = new Float32Array(totalVertices * 3);
    const colorArray = new Float32Array(totalVertices * 3);
    const uvArray = new Float32Array(totalVertices * 2);
    let hasAnyUv = false;

    let offset = 0;
    for (const item of geometries) {
      const g = item.geometry;
      const pos = g.attributes.position;
      const count = pos.count;
      const norm = g.attributes.normal;
      const col = g.attributes.color;
      const uv = g.attributes.uv;
      if (uv) hasAnyUv = true;

      for (let i = 0; i < count; i++) {
        const dstIdx = (offset + i) * 3;
        posArray[dstIdx] = pos.getX(i);
        posArray[dstIdx + 1] = pos.getY(i);
        posArray[dstIdx + 2] = pos.getZ(i);

        if (norm) {
          normArray[dstIdx] = norm.getX(i);
          normArray[dstIdx + 1] = norm.getY(i);
          normArray[dstIdx + 2] = norm.getZ(i);
        } else {
          normArray[dstIdx] = 0;
          normArray[dstIdx + 1] = 1.0;
          normArray[dstIdx + 2] = 0;
        }

        let sampledColor: THREE.Color | null = null;
        if (col) {
          sampledColor = new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
        } else if (uv && (item.texture || item.decodedTexture)) {
          sampledColor = sampleAnyTexture(item.texture || item.decodedTexture, uv.getX(i), uv.getY(i));
        }

        if (sampledColor) {
          colorArray[dstIdx] = sampledColor.r;
          colorArray[dstIdx + 1] = sampledColor.g;
          colorArray[dstIdx + 2] = sampledColor.b;
        } else if (item.materialColor) {
          colorArray[dstIdx] = item.materialColor.r;
          colorArray[dstIdx + 1] = item.materialColor.g;
          colorArray[dstIdx + 2] = item.materialColor.b;
        } else {
          colorArray[dstIdx] = 0.9;
          colorArray[dstIdx + 1] = 0.9;
          colorArray[dstIdx + 2] = 0.9;
        }

        if (uv) {
          const uvDst = (offset + i) * 2;
          uvArray[uvDst] = uv.getX(i);
          uvArray[uvDst + 1] = uv.getY(i);
        }
      }

      offset += count;
    }

    const numTriangles = Math.floor(totalVertices / 3);
    if (numTriangles === 0) return [];

    // Spatial vertex quantization key for robust half-edge stitching across split normals/UVs
    const vKey = (vx: number, vy: number, vz: number): string =>
      `${Math.round(vx / eps)}_${Math.round(vy / eps)}_${Math.round(vz / eps)}`;

    // Build undirected edge adjacency map: edgeKey -> list of triangle indices
    const edgeToTris = new Map<string, number[]>();

    for (let t = 0; t < numTriangles; t++) {
      const i0 = t * 3;
      const i1 = t * 3 + 1;
      const i2 = t * 3 + 2;

      const k0 = vKey(posArray[i0 * 3], posArray[i0 * 3 + 1], posArray[i0 * 3 + 2]);
      const k1 = vKey(posArray[i1 * 3], posArray[i1 * 3 + 1], posArray[i1 * 3 + 2]);
      const k2 = vKey(posArray[i2 * 3], posArray[i2 * 3 + 1], posArray[i2 * 3 + 2]);

      const e01 = k0 < k1 ? `${k0}:${k1}` : `${k1}:${k0}`;
      const e12 = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
      const e20 = k2 < k0 ? `${k2}:${k0}` : `${k0}:${k2}`;

      for (const e of [e01, e12, e20]) {
        let list = edgeToTris.get(e);
        if (!list) {
          list = [];
          edgeToTris.set(e, list);
        }
        list.push(t);
      }
    }

    // Disjoint Set Union (DSU) / Union-Find on triangles
    const parent = new Int32Array(numTriangles);
    for (let i = 0; i < numTriangles; i++) parent[i] = i;

    const find = (i: number): number => {
      let root = i;
      while (root !== parent[root]) {
        root = parent[root];
      }
      let curr = i;
      while (curr !== root) {
        const next = parent[curr];
        parent[curr] = root;
        curr = next;
      }
      return root;
    };

    const union = (i: number, j: number): void => {
      const r1 = find(i);
      const r2 = find(j);
      if (r1 !== r2) {
        parent[r1] = r2;
      }
    };

    // Union all triangles that share an edge
    for (const tris of edgeToTris.values()) {
      for (let k = 1; k < tris.length; k++) {
        union(tris[0], tris[k]);
      }
    }

    // Group triangle indices by island root
    const islandsMap = new Map<number, number[]>();
    for (let t = 0; t < numTriangles; t++) {
      const root = find(t);
      let list = islandsMap.get(root);
      if (!list) {
        list = [];
        islandsMap.set(root, list);
      }
      list.push(t);
    }

    // Sort islands by triangle count descending (largest main body first)
    const sortedEntries = Array.from(islandsMap.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );

    const dominantTexture = geometries.find(g => g.texture)?.texture || null;
    const dominantDecoded = geometries.find(g => g.decodedTexture)?.decodedTexture || null;

    const islands: MeshIsland[] = [];

    sortedEntries.forEach(([root, triIndices], idx) => {
      const triCount = triIndices.length;
      const vertCount = triCount * 3;

      const subPos = new Float32Array(vertCount * 3);
      const subNorm = new Float32Array(vertCount * 3);
      const subCol = new Float32Array(vertCount * 3);
      const subUv = hasAnyUv ? new Float32Array(vertCount * 2) : null;

      const colorHex = getIslandColorHex(idx);
      const threeColor = new THREE.Color(colorHex);

      let sumOrigR = 0, sumOrigG = 0, sumOrigB = 0;

      let writeIdx = 0;
      for (const t of triIndices) {
        const srcOffset = t * 3;
        for (let v = 0; v < 3; v++) {
          const s = (srcOffset + v) * 3;
          const d = (writeIdx + v) * 3;

          subPos[d] = posArray[s];
          subPos[d + 1] = posArray[s + 1];
          subPos[d + 2] = posArray[s + 2];

          subNorm[d] = normArray[s];
          subNorm[d + 1] = normArray[s + 1];
          subNorm[d + 2] = normArray[s + 2];

          // Retain authentic source mesh colors in subCol
          subCol[d] = colorArray[s];
          subCol[d + 1] = colorArray[s + 1];
          subCol[d + 2] = colorArray[s + 2];

          sumOrigR += colorArray[s];
          sumOrigG += colorArray[s + 1];
          sumOrigB += colorArray[s + 2];

          if (subUv) {
            const uSrc = (srcOffset + v) * 2;
            const uDst = (writeIdx + v) * 2;
            subUv[uDst] = uvArray[uSrc];
            subUv[uDst + 1] = uvArray[uSrc + 1];
          }
        }
        writeIdx += 3;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(subPos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(subNorm, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(subCol, 3));
      if (subUv) {
        geom.setAttribute('uv', new THREE.BufferAttribute(subUv, 2));
      }
      geom.computeBoundingBox();

      const avgR = vertCount > 0 ? Math.round((sumOrigR / vertCount) * 255) : 240;
      const avgG = vertCount > 0 ? Math.round((sumOrigG / vertCount) * 255) : 240;
      const avgB = vertCount > 0 ? Math.round((sumOrigB / vertCount) * 255) : 240;
      const toHex = (val: number) => Math.max(0, Math.min(255, val)).toString(16).padStart(2, '0');
      const originalColorHex = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;

      const bbox = geom.boundingBox || new THREE.Box3();
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      // Name part descriptively based on index and triangle volume
      let name = `Island ${idx + 1}`;
      if (idx === 0) name = 'Main Shell / Body';
      else if (triCount > 400) name = `Sub-assembly ${idx + 1}`;
      else if (triCount > 200) name = `Component ${idx + 1}`;
      else name = `Detail Part ${idx + 1}`;

      const mat = new THREE.MeshStandardMaterial({
        color: threeColor,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geom, mat);

      if (dominantTexture) {
        mesh.userData.texture = dominantTexture;
      }
      if (dominantDecoded) {
        mesh.userData.decodedTexture = dominantDecoded;
      }

      islands.push({
        id: idx + 1,
        name,
        triangleCount: triCount,
        vertexCount: vertCount,
        geometry: geom,
        mesh,
        colorHex,
        originalColorHex,
        colorCode: 15,
        bbox,
        center,
        texture: dominantTexture,
        decodedTexture: dominantDecoded
      });
    });

    return islands;
  }

  /**
   * Re-randomizes the color materials of all islands using a new random seed.
   */
  public static recolorIslands(islands: MeshIsland[], seed: number = 1): void {
    islands.forEach((isl, idx) => {
      isl.colorHex = getIslandColorHex(idx, seed);
      if (isl.mesh && isl.mesh.material) {
        (isl.mesh.material as THREE.MeshStandardMaterial).color.set(isl.colorHex);
      }
    });
  }
}
