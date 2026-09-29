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

export interface MeshIsland {
  id: number;
  name: string;
  triangleCount: number;
  vertexCount: number;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  colorHex: string;
  colorCode: number;
  bbox: THREE.Box3;
  center: THREE.Vector3;
}

// 24 High-contrast, vibrant LEGO-style colors for distinct island visualization
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
   * Segments any Three.js Object3D into isolated topological half-edge islands.
   */
  public static segmentObject(
    object: THREE.Object3D,
    eps: number = 0.0005
  ): MeshIsland[] {
    object.updateMatrixWorld(true);

    const geometries: THREE.BufferGeometry[] = [];
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const nonIndexed = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        nonIndexed.applyMatrix4(mesh.matrixWorld);
        geometries.push(nonIndexed);
      }
    });

    if (geometries.length === 0) {
      return [];
    }

    // Merge into single non-indexed geometry
    let totalVertices = 0;
    for (const g of geometries) {
      totalVertices += g.attributes.position.count;
    }

    const posArray = new Float32Array(totalVertices * 3);
    const normArray = new Float32Array(totalVertices * 3);
    const colorArray = new Float32Array(totalVertices * 3);

    let offset = 0;
    for (const g of geometries) {
      const pos = g.attributes.position;
      const count = pos.count;
      const norm = g.attributes.normal;
      const col = g.attributes.color;

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

        if (col) {
          colorArray[dstIdx] = col.getX(i);
          colorArray[dstIdx + 1] = col.getY(i);
          colorArray[dstIdx + 2] = col.getZ(i);
        } else {
          colorArray[dstIdx] = 0.9;
          colorArray[dstIdx + 1] = 0.9;
          colorArray[dstIdx + 2] = 0.9;
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

    const islands: MeshIsland[] = [];

    sortedEntries.forEach(([root, triIndices], idx) => {
      const triCount = triIndices.length;
      const vertCount = triCount * 3;

      const subPos = new Float32Array(vertCount * 3);
      const subNorm = new Float32Array(vertCount * 3);
      const subCol = new Float32Array(vertCount * 3);

      const colorHex = VIBRANT_ISLAND_PALETTE[idx % VIBRANT_ISLAND_PALETTE.length];
      const threeColor = new THREE.Color(colorHex);

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

          // Paint vertices with island's assigned distinct color
          subCol[d] = threeColor.r;
          subCol[d + 1] = threeColor.g;
          subCol[d + 2] = threeColor.b;
        }
        writeIdx += 3;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(subPos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(subNorm, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(subCol, 3));
      geom.computeBoundingBox();

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
        metalness: 0.05
      });
      const mesh = new THREE.Mesh(geom, mat);

      islands.push({
        id: idx + 1,
        name,
        triangleCount: triCount,
        vertexCount: vertCount,
        geometry: geom,
        mesh,
        colorHex,
        colorCode: 15,
        bbox,
        center
      });
    });

    return islands;
  }
}
