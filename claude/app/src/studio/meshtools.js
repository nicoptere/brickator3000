// Source-mesh tools that run on the main thread with three.js: welded vertex normals (to repair flipped triangles before
// the ray cast reads their winding) and connected components of the source mesh (the "islands" colour mode).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function welded(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tris.length; i++) { if (tris[i] < lo) lo = tris[i]; if (tris[i] > hi) hi = tris[i]; }
  const w = mergeVertices(g, Math.max(1e-9, (hi - lo) * 1e-6));
  return w;
}

/**
 * Welds coincident vertices, lets three.js compute the area-weighted vertex normals, then flips every triangle whose own
 * winding disagrees with the normals of its corners (a lone reversed face is outvoted by its neighbours).
 * Returns copies { tris, vcols, flipped }; the inputs are untouched.
 */
export function fixWinding(tris, vcols) {
  const w = welded(tris); w.computeVertexNormals();
  const idx = w.index.array, N = w.attributes.normal.array, P = w.attributes.position.array;
  const T = Float32Array.from(tris), C = Float32Array.from(vcols);
  let flipped = 0;
  for (let t = 0, nt = idx.length / 3; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) {
      flipped++; const o = t * 9;
      for (const A of [T, C]) for (let k = 0; k < 3; k++) { const x = A[o + 3 + k]; A[o + 3 + k] = A[o + 6 + k]; A[o + 6 + k] = x; }
    }
  }
  return { tris: T, vcols: C, flipped };
}

/** connected components of the source mesh (triangles sharing a welded vertex): { labels: Int32Array per triangle, count } */
export function meshIslands(tris) {
  const w = welded(tris), idx = w.index.array, nv = w.attributes.position.count, nt = idx.length / 3;
  const par = new Int32Array(nv).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nt; t++) {
    const a = find(idx[t * 3]), b = find(idx[t * 3 + 1]), c = find(idx[t * 3 + 2]);
    if (a !== b) par[b] = a; const a2 = find(a), c2 = find(c); if (a2 !== c2) par[c2] = a2;
  }
  const id = new Map(), labels = new Int32Array(nt);
  for (let t = 0; t < nt; t++) { const r = find(idx[t * 3]); if (!id.has(r)) id.set(r, id.size); labels[t] = id.get(r); }
  return { labels, count: id.size };
}

/** generate one random but well-spread THREE.Color per island */
export function islandPalette(count, seed = 7) {
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return Array.from({ length: count }, (_, i) => new THREE.Color().setHSL((i * 0.61803 + rnd() * 0.15) % 1, 0.55 + rnd() * 0.35, 0.45 + rnd() * 0.15, THREE.SRGBColorSpace));
}

/** one random but well-spread colour per island, expanded to per-corner linear RGB (9 floats per triangle) */
export function islandColors(labels, count, seed = 7) {
  const pal = islandPalette(count, seed);
  const out = new Float32Array(labels.length * 9);
  for (let t = 0; t < labels.length; t++) { const c = pal[labels[t]]; for (let k = 0; k < 3; k++) { out[t * 9 + k * 3] = c.r; out[t * 9 + k * 3 + 1] = c.g; out[t * 9 + k * 3 + 2] = c.b; } }
  return out;
}

/** smooth per-corner normals: weld coincident vertices, geometry.computeVertexNormals(), then read them back per triangle corner */
export function smoothNormals(tris) {
  const w = welded(tris); w.computeVertexNormals();
  const idx = w.index.array, N = w.attributes.normal.array, out = new Float32Array(idx.length * 3);
  for (let k = 0; k < idx.length; k++) { out[k * 3] = N[idx[k] * 3]; out[k * 3 + 1] = N[idx[k] * 3 + 1]; out[k * 3 + 2] = N[idx[k] * 3 + 2]; }
  return out;
}
