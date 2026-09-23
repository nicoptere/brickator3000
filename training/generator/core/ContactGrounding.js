import * as THREE from 'three';

/**
 * ContactGrounding.js — Physics Contact Alignment for LEGO 3D Models.
 * 
 * Solves the "floating / tip-balancing" artifact of purely random 3D rotations.
 * 1. Finds the global lowest vertex P1 after random rotation.
 * 2. Finds the second lowest distinct vertex P2 (separated by minimum physical threshold).
 * 3. Calculates the exact rotation angle and horizontal perpendicular axis to lay the segment P1-P2 flat on the ground plane.
 * 4. Optionally pivots around the P1-P2 ground edge until a 3rd vertex touches the ground (settleToFace).
 * 5. Strictly grounds the contact geometry at Y = 0 and centers on X, Z.
 */
export class ContactGrounding {
  /**
   * Extracts all world-space vertices from an Object3D/Group
   * @param {THREE.Object3D} model
   * @returns {THREE.Vector3[]}
   */
  static extractVertices(model) {
    model.updateMatrixWorld(true);
    const vertices = [];
    model.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const pos = child.geometry.attributes.position;
        if (!pos) return;
        const matrixWorld = child.matrixWorld;
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i);
          v.applyMatrix4(matrixWorld);
          vertices.push(v);
        }
      }
    });
    return vertices;
  }

  /**
   * Aligns the model so that its 2 lowest vertices rest on the ground plane (Y = 0).
   * 
   * @param {THREE.Object3D} model
   * @param {number} rx Initial rotation around X (radians)
   * @param {number} ry Initial rotation around Y (radians)
   * @param {number} rz Initial rotation around Z (radians)
   * @param {object} [options]
   * @param {boolean} [options.settleToFace=true] If true, pivots around the ground edge until a 3rd vertex touches ground
   * @returns {{ bbox: THREE.Box3, sphere: THREE.Sphere, size: THREE.Vector3 }}
   */
  static alignLowestSegmentToGround(model, rx, ry, rz, options = {}) {
    const { settleToFace = true } = options;

    // 1. Reset position and apply initial random 3D rotation relative to LDraw base inversion
    model.position.set(0, 0, 0);
    model.rotation.set(Math.PI + rx, ry, rz);
    model.updateMatrixWorld(true);

    let vertices = this.extractVertices(model);
    if (vertices.length < 3) {
      // Fallback for empty/degenerate mesh: standard bbox grounding
      return this._fallbackBboxGround(model);
    }

    // 2. Find global lowest vertex P1
    let p1 = vertices[0];
    for (let i = 1; i < vertices.length; i++) {
      if (vertices[i].y < p1.y) {
        p1 = vertices[i];
      }
    }

    // 3. Find 2nd lowest distinct vertex P2 separated by min distance
    const initialBbox = new THREE.Box3().setFromObject(model);
    const initialSize = initialBbox.getSize(new THREE.Vector3());
    const minDistinctDistance = Math.max(4.0, Math.min(initialSize.x, initialSize.z) * 0.20);

    let p2 = null;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const dist = v.distanceTo(p1);
      if (dist >= minDistinctDistance) {
        if (!p2 || v.y < p2.y) {
          p2 = v;
        }
      }
    }

    // 4. Align segment P1-P2 to ground
    if (p2) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const lxz = Math.sqrt(dx * dx + dz * dz);

      if (lxz > 1e-4 && dy > 1e-3) {
        const theta = Math.atan2(dy, lxz);
        // Horizontal rotation axis perpendicular to P1-P2 in XZ plane
        const axis = new THREE.Vector3(dz, 0, -dx).normalize();

        // Check if any other vertex touches the ground before P2 reaches horizontal
        let allowedTheta = theta;
        for (let i = 0; i < vertices.length; i++) {
          const v = vertices[i];
          const rx_i = v.x - p1.x;
          const ry_i = v.y - p1.y;
          const rz_i = v.z - p1.z;

          // (axis x r)_y = axis.z * rx - axis.x * rz
          const crossY = axis.z * rx_i - axis.x * rz_i;
          if (crossY < -1e-4 && ry_i > 1e-4) {
            const phi_i = Math.atan2(ry_i, -crossY);
            if (phi_i > 1e-4 && phi_i < allowedTheta) {
              allowedTheta = phi_i;
            }
          }
        }

        // Apply rotation around axis with pivot at P1
        const q = new THREE.Quaternion().setFromAxisAngle(axis, allowedTheta);
        model.applyQuaternion(q);
        model.updateMatrixWorld(true);
      }
    }

    // 5. Optional: Pivot around the grounded edge until a 3rd vertex touches ground (stable face rest)
    if (settleToFace) {
      vertices = this.extractVertices(model);
      // Re-find P1 and P2 after edge alignment
      let np1 = vertices[0];
      for (let i = 1; i < vertices.length; i++) {
        if (vertices[i].y < np1.y) np1 = vertices[i];
      }
      let np2 = null;
      for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        if (v.distanceTo(np1) >= minDistinctDistance) {
          if (!np2 || v.y < np2.y) np2 = v;
        }
      }

      if (np2) {
        // Edge vector in horizontal plane
        const edge = new THREE.Vector3().subVectors(np2, np1);
        edge.y = 0;
        if (edge.lengthSq() > 1e-4) {
          edge.normalize();
          // Find minimum positive and negative roll angles to hit ground
          let minPosAngle = Infinity;
          let minNegAngle = -Infinity;

          for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            const distFromEdge = new THREE.Vector3().crossVectors(edge, new THREE.Vector3().subVectors(v, np1)).length();
            if (distFromEdge < 2.0) continue;

            const rx_i = v.x - np1.x;
            const ry_i = v.y - np1.y;
            const rz_i = v.z - np1.z;
            const crossY = edge.z * rx_i - edge.x * rz_i;

            if (crossY < -1e-4 && ry_i > 1e-4) {
              const ang = Math.atan2(ry_i, -crossY);
              if (ang > 0 && ang < minPosAngle) minPosAngle = ang;
            } else if (crossY > 1e-4 && ry_i > 1e-4) {
              const ang = -Math.atan2(ry_i, crossY);
              if (ang < 0 && ang > minNegAngle) minNegAngle = ang;
            }
          }

          // Choose roll direction towards center of mass (smaller tilt or stable rest)
          const chosenRoll = isFinite(minPosAngle) ? minPosAngle : (isFinite(minNegAngle) ? minNegAngle : 0);
          if (Math.abs(chosenRoll) > 1e-4 && Math.abs(chosenRoll) < Math.PI / 2) {
            const rollQ = new THREE.Quaternion().setFromAxisAngle(edge, chosenRoll);
            model.applyQuaternion(rollQ);
            model.updateMatrixWorld(true);
          }
        }
      }
    }

    // 6. Final strict grounding: set lowest vertex to Y = 0 and center on X, Z
    const finalBbox = new THREE.Box3().setFromObject(model);
    const center = finalBbox.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -finalBbox.min.y, -center.z);
    model.updateMatrixWorld(true);

    const settledBbox = new THREE.Box3().setFromObject(model);
    const size = settledBbox.getSize(new THREE.Vector3());
    const sphere = settledBbox.getBoundingSphere(new THREE.Sphere());

    model.userData.bbox = settledBbox;
    model.userData.sphere = sphere;
    model.userData.size = size;

    return {
      bbox: settledBbox,
      sphere,
      size
    };
  }

  static _fallbackBboxGround(model) {
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bbox.min.y, -center.z);
    model.updateMatrixWorld(true);
    const finalBbox = new THREE.Box3().setFromObject(model);
    return {
      bbox: finalBbox,
      sphere: finalBbox.getBoundingSphere(new THREE.Sphere()),
      size: finalBbox.getSize(new THREE.Vector3())
    };
  }
}
