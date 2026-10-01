import * as THREE from 'three';
import type { PlateLattice3D } from './PlateLattice3D';

export interface CurvatureGradientResult {
  principalAxis: 'X' | 'Z';
  gradientX: number;
  gradientZ: number;
  isCorner: boolean;
  isFlat: boolean;
}

/**
 * Creates visual curvature and feature line overlays for a 3D model.
 * Renders sharp crease lines (dihedral angle >= 20 deg) and curvature flow lines
 * in royal blue accent (#2563eb) over the opaque textured mesh in Quadrant 1.
 */
export function createCurvatureFeatureOverlay(root: THREE.Object3D): THREE.Group {
  const overlayGroup = new THREE.Group();
  overlayGroup.name = '__feature_curvature_overlay__';

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x2563eb,
    linewidth: 1.5,
    depthTest: true,
    transparent: true,
    opacity: 0.85
  });

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry) return;

      // Extract crease / feature edges (threshold 20 degrees)
      let edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 20);

      // If the mesh is very smooth and produces few crease edges, adapt to lower threshold
      if (edgesGeom.attributes.position && edgesGeom.attributes.position.count < 12) {
        edgesGeom.dispose();
        edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 10);
      }

      const lines = new THREE.LineSegments(edgesGeom, lineMat);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(mesh.matrixWorld);

      overlayGroup.add(lines);
    }
  });

  return overlayGroup;
}

/**
 * Computes discrete normal curvature gradients around a surface voxel in PlateLattice3D.
 * Compares the surface normal with neighboring surface voxels along X and Z axes
 * to determine the principal axis of curvature and detect ridges/corners.
 */
export function computeLatticeCurvatureGradient(
  lattice: PlateLattice3D,
  x: number,
  z: number,
  y: number
): CurvatureGradientResult {
  const current = lattice.getVoxel(x, z, y);
  if (!current) {
    return { principalAxis: 'Z', gradientX: 0, gradientZ: 0, isCorner: false, isFlat: true };
  }

  const [nx, ny, nz] = current.normal;

  // Sample neighbors along X
  const left = lattice.getVoxel(x - 1, z, y);
  const right = lattice.getVoxel(x + 1, z, y);
  let gradX = 0;
  if (left && right) {
    const dX0 = left.normal[0] - right.normal[0];
    const dY0 = left.normal[1] - right.normal[1];
    const dZ0 = left.normal[2] - right.normal[2];
    gradX = Math.hypot(dX0, dY0, dZ0);
  } else if (left) {
    gradX = Math.hypot(left.normal[0] - nx, left.normal[1] - ny, left.normal[2] - nz);
  } else if (right) {
    gradX = Math.hypot(right.normal[0] - nx, right.normal[1] - ny, right.normal[2] - nz);
  }

  // Sample neighbors along Z
  const back = lattice.getVoxel(x, z - 1, y);
  const front = lattice.getVoxel(x, z + 1, y);
  let gradZ = 0;
  if (back && front) {
    const dX1 = back.normal[0] - front.normal[0];
    const dY1 = back.normal[1] - front.normal[1];
    const dZ1 = back.normal[2] - front.normal[2];
    gradZ = Math.hypot(dX1, dY1, dZ1);
  } else if (back) {
    gradZ = Math.hypot(back.normal[0] - nx, back.normal[1] - ny, back.normal[2] - nz);
  } else if (front) {
    gradZ = Math.hypot(front.normal[0] - nx, front.normal[1] - ny, front.normal[2] - nz);
  }

  const isFlat = gradX < 0.1 && gradZ < 0.1;
  const isCorner = Math.abs(gradX - gradZ) < 0.25 && (gradX > 0.3 || gradZ > 0.3);
  const principalAxis = gradX >= gradZ ? 'X' : 'Z';

  return {
    principalAxis,
    gradientX: gradX,
    gradientZ: gradZ,
    isCorner,
    isFlat
  };
}
