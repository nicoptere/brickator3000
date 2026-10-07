// Any supported file -> { tris: Float32Array, vcols: Float32Array (linear RGB per corner) }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { parseGLB } from './brickgen/mesh.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const texCache = new WeakMap();
/** pixel data of a material's colour map (browser only) so textured models, like the duck, become per-vertex colours */
function texData(map) {
  if (!map || !map.image || typeof document === 'undefined') return null;
  if (texCache.has(map)) return texCache.get(map);
  let out = null;
  try {
    const im = map.image, w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0); out = { w, h, d: cx.getImageData(0, 0, w, h).data, flipY: map.flipY };
  } catch {}
  texCache.set(map, out); return out;
}
function sampleTex(t, u, v) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(t.w - 1, Math.floor(u * t.w)), y = Math.min(t.h - 1, Math.floor((t.flipY ? 1 - v : v) * t.h)), i = (y * t.w + x) * 4;
  return [s2l(t.d[i] / 255), s2l(t.d[i + 1] / 255), s2l(t.d[i + 2] / 255)];
}

function fromObject3D(root) {
  root.updateMatrixWorld(true);
  const T = [], C = []; let hasColor = false;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.getAttribute('position'), col = g.getAttribute('color'); if (col) hasColor = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const v = new THREE.Vector3();
    const matColor = (k) => {
      let m = mats[0];
      if (g.groups && g.groups.length && mats.length > 1) { const grp = g.groups.find((gr) => k >= gr.start && k < gr.start + gr.count); if (grp) m = mats[grp.materialIndex] || m; }
      return m && m.color ? m.color : new THREE.Color(0.7, 0.7, 0.7);
    };
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); T.push(v.x, v.y, v.z);
      if (col) C.push(col.getX(k), col.getY(k), col.getZ(k));
      else {
        const c = matColor(k), mm = mats[0], uv = g.getAttribute('uv'), td = uv && mm && mm.map ? texData(mm.map) : null;
        if (td) { const t = sampleTex(td, uv.getX(k), uv.getY(k)); C.push(t[0] * c.r, t[1] * c.g, t[2] * c.b); hasColor = true; } else C.push(c.r, c.g, c.b);
      }
    }
  });
  return { tris: Float32Array.from(T), vcols: Float32Array.from(C), hasColor };
}

function geometryToModel(geo) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb3b3b3, side: THREE.DoubleSide }));
  return fromObject3D(mesh);
}

import { parseLDrawToModel } from './ldrawLoader.js';

export async function loadModel(name, buffer) {
  const ext = name.split('.').pop().toLowerCase();
  let m;
  if (ext === 'ldr' || ext === 'mpd' || ext === 'mdp') {
    const text = new TextDecoder('utf-8').decode(buffer);
    return parseLDrawToModel(text, name);
  }
  if (ext === 'glb') {
    m = parseGLB(buffer);                                   // keeps COLOR_0 exactly as stored
    if (!m.hasColor) {                                      // no vertex colours: let three resolve materials / textures-free colours
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      m = fromObject3D(gltf.scene);
    }
  } else if (ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(new TextDecoder().decode(buffer), '');
    m = fromObject3D(gltf.scene);
  } else if (ext === 'obj') m = fromObject3D(new OBJLoader().parse(new TextDecoder().decode(buffer)));
  else if (ext === 'ply') m = geometryToModel(new PLYLoader().parse(buffer));
  else if (ext === 'stl') m = geometryToModel(new STLLoader().parse(buffer));
  else throw new Error(`unsupported format .${ext}`);
  if (!m.tris.length) throw new Error('no triangles found');
  return m;
}

/** rotate so that `up` becomes +Y ('y' | 'z' | '-z' | 'x') */
export function reorient(m, up) {
  if (!m || m.isLDraw || up === 'y') return m;
  const t = m.tris.slice();
  for (let k = 0; k < t.length; k += 3) {
    const x = t[k], y = t[k + 1], z = t[k + 2];
    if (up === 'z') { t[k] = x; t[k + 1] = z; t[k + 2] = -y; }
    else if (up === '-z') { t[k] = x; t[k + 1] = -z; t[k + 2] = y; }
    else if (up === 'x') { t[k] = -y; t[k + 1] = x; t[k + 2] = z; }
  }
  return { ...m, tris: t };
}

