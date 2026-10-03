// Photo-studio "cyclo": the floor is the bottom of a chamfered (filleted) cylinder whose wall rises all round, so there is no horizon line.
// Everything scales with the model: lights sit at `lightDist`, the cylinder is wider than that (it encloses the lights), the camera is kept inside it and above the floor,
// and the wall is tall enough that its rim is never in view from any allowed camera.
import * as THREE from 'three';
import { RectAreaLight } from 'three';

export const CYCLO = { lightK: 2.6, radiusK: 1.45, coveK: 0.32, heightK: 2.2, camK: 0.9 };

/** world units: `size` = the largest dimension of the model. returns the geometry numbers used by the camera limits as well */
export function cycloDims(size) {
  const lightDist = CYCLO.lightK * Math.max(size, 1), R = lightDist * CYCLO.radiusK;
  return { lightDist, R, cove: R * CYCLO.coveK, H: R * CYCLO.heightK, maxCam: R * CYCLO.camK };
}

export function cycloGeometry(size, seg = 96) {
  const { R, cove, H } = cycloDims(size), pts = [new THREE.Vector2(0, 0)];
  pts.push(new THREE.Vector2(R - cove, 0));
  for (let i = 1; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(R - cove + Math.sin(a) * cove, cove - Math.cos(a) * cove)); }   // quarter circle from the floor to the wall
  pts.push(new THREE.Vector2(R, H));
  const g = new THREE.LatheGeometry(pts, seg);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 4).fill(1), 4));   // same attributes as the other path-traced meshes
  return g;
}

export function cycloMaterial(dark) { return new THREE.MeshStandardMaterial({ color: dark ? 0x2b303b : 0xd9dde5, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }); }

/** three soft area lights of different strengths: big warm key, cool fill, narrow rim from behind. returns { lights, group } (RectAreaLights only light Standard / Physical materials and the path tracer) */
export function areaLights(size) {
  const { lightDist: L } = cycloDims(size), s = Math.max(size, 1), g = new THREE.Group();
  const spec = [   // [azimuth deg, elevation deg, width, height, intensity, colour]
    [38, 38, 1.1 * s, 0.9 * s, 11, 0xfff2e2],      // key
    [-62, 22, 1.5 * s, 1.0 * s, 4, 0xdbe8ff],      // fill
    [165, 34, 0.8 * s, 0.5 * s, 8, 0xffffff],     // rim
  ];
  const lights = spec.map(([az, el, w, h, i, c]) => {
    const l = new RectAreaLight(c, i, w, h), a = az * Math.PI / 180, e = el * Math.PI / 180;
    l.position.set(Math.sin(a) * Math.cos(e) * L, Math.sin(e) * L + 0.2 * s, Math.cos(a) * Math.cos(e) * L); l.lookAt(0, 0.4 * s, 0); g.add(l); return l;
  });
  return { lights, group: g };
}
