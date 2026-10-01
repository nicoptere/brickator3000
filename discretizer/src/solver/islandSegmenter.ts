import * as THREE from 'three';

export interface MeshIsland {
  id: number;
  triangleCount: number;
  triangles: {
    a: THREE.Vector3;
    b: THREE.Vector3;
    c: THREE.Vector3;
    normal: THREE.Vector3;
    uvA?: THREE.Vector2;
    uvB?: THREE.Vector2;
    uvC?: THREE.Vector2;
    colorA?: THREE.Color;
    colorB?: THREE.Color;
    colorC?: THREE.Color;
    material?: THREE.Material;
  }[];
}

/**
 * Segment 3D Object hierarchy into isolated topological mesh islands using Half-Edge DSU.
 * Prevents part bleed across distinct assemblies (e.g. wheels fusing into body).
 */
export async function segmentMeshIslandsAsync(
  root: THREE.Object3D,
  onProgress?: (percent: number) => void
): Promise<MeshIsland[]> {
  root.updateMatrixWorld(true);

  // Collect all world-space triangles
  interface RawTriangle {
    a: THREE.Vector3;
    b: THREE.Vector3;
    c: THREE.Vector3;
    normal: THREE.Vector3;
    uvA?: THREE.Vector2;
    uvB?: THREE.Vector2;
    uvC?: THREE.Vector2;
    colorA?: THREE.Color;
    colorB?: THREE.Color;
    colorC?: THREE.Color;
    material?: THREE.Material;
  }

  const allTriangles: RawTriangle[] = [];

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry;
      if (!geom) return;

      const pos = geom.attributes.position;
      if (!pos) return;

      const uv = geom.attributes.uv;
      const col = geom.attributes.color;
      const norm = geom.attributes.normal;
      const index = geom.index;

      const getVertex = (i: number): THREE.Vector3 => {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        return v.applyMatrix4(mesh.matrixWorld);
      };

      const getUV = (i: number): THREE.Vector2 | undefined => {
        if (!uv) return undefined;
        return new THREE.Vector2(uv.getX(i), uv.getY(i));
      };

      const getColor = (i: number): THREE.Color | undefined => {
        if (!col) return undefined;
        return new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
      };

      const getNormal = (i: number): THREE.Vector3 => {
        if (norm) {
          const n = new THREE.Vector3(norm.getX(i), norm.getY(i), norm.getZ(i));
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
          return n.applyMatrix3(normalMatrix).normalize();
        }
        return new THREE.Vector3(0, 1, 0);
      };

      const numTris = index ? index.count / 3 : pos.count / 3;

      for (let t = 0; t < numTris; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        const va = getVertex(i0);
        const vb = getVertex(i1);
        const vc = getVertex(i2);

        // Face normal
        const ab = new THREE.Vector3().subVectors(vb, va);
        const ac = new THREE.Vector3().subVectors(vc, va);
        const fn = new THREE.Vector3().crossVectors(ab, ac).normalize();
        if (fn.lengthSq() < 0.0001) {
          fn.copy(getNormal(i0));
        }

        allTriangles.push({
          a: va,
          b: vb,
          c: vc,
          normal: fn,
          uvA: getUV(i0),
          uvB: getUV(i1),
          uvC: getUV(i2),
          colorA: getColor(i0),
          colorB: getColor(i1),
          colorC: getColor(i2),
          material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        });
      }
    }
  });

  if (allTriangles.length === 0) return [];
  if (onProgress) onProgress(20);
  await new Promise(r => setTimeout(r, 0));

  // Vertex spatial quantization (epsilon = 0.0005)
  const EPS = 0.0005;
  const hashVertex = (v: THREE.Vector3): string => {
    const qx = Math.round(v.x / EPS);
    const qy = Math.round(v.y / EPS);
    const qz = Math.round(v.z / EPS);
    return `${qx},${qy},${qz}`;
  };

  const canonicalEdge = (k1: string, k2: string): string => {
    return k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
  };

  // Edge map: edgeKey -> triangleIndex[]
  const edgeMap = new Map<string, number[]>();
  for (let i = 0; i < allTriangles.length; i++) {
    const tri = allTriangles[i];
    const kA = hashVertex(tri.a);
    const kB = hashVertex(tri.b);
    const kC = hashVertex(tri.c);

    const e1 = canonicalEdge(kA, kB);
    const e2 = canonicalEdge(kB, kC);
    const e3 = canonicalEdge(kC, kA);

    for (const e of [e1, e2, e3]) {
      let list = edgeMap.get(e);
      if (!list) {
        list = [];
        edgeMap.set(e, list);
      }
      list.push(i);
    }
  }

  if (onProgress) onProgress(45);
  await new Promise(r => setTimeout(r, 0));

  // Disjoint-Set Union across shared edges
  const dsu = new Int32Array(allTriangles.length);
  for (let i = 0; i < allTriangles.length; i++) dsu[i] = i;

  const find = (i: number): number => {
    let root = i;
    while (dsu[root] !== root) root = dsu[root];
    let curr = i;
    while (curr !== root) {
      const next = dsu[curr];
      dsu[curr] = root;
      curr = next;
    }
    return root;
  };

  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) dsu[rj] = ri;
  };

  for (const triList of edgeMap.values()) {
    if (triList.length > 1) {
      const first = triList[0];
      for (let k = 1; k < triList.length; k++) {
        union(first, triList[k]);
      }
    }
  }

  if (onProgress) onProgress(75);
  await new Promise(r => setTimeout(r, 0));

  // Group triangles by island root
  const islandGroups = new Map<number, RawTriangle[]>();
  for (let i = 0; i < allTriangles.length; i++) {
    const rootId = find(i);
    let list = islandGroups.get(rootId);
    if (!list) {
      list = [];
      islandGroups.set(rootId, list);
    }
    list.push(allTriangles[i]);
  }

  // Convert to sorted MeshIsland array (descending by triangle count)
  const islands: MeshIsland[] = Array.from(islandGroups.values())
    .map((tris, idx) => ({
      id: idx + 1,
      triangleCount: tris.length,
      triangles: tris
    }))
    .sort((a, b) => b.triangleCount - a.triangleCount);

  if (onProgress) onProgress(100);
  return islands;
}
