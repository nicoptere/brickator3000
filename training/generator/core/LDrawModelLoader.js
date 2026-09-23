import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';

/**
 * LDrawModelLoader: Loads LDraw CAD models, merges sub-meshes into an optimized geometry,
 * inverts coordinates to Three.js orientation (+Y up), and centers/grounds the model.
 * Provides 3D rotation and ground alignment so the bounding box always rests at Y = 0.
 */
export class LDrawModelLoader {
  /**
   * @param {string} [partsPath='/ldraw/']
   */
  constructor(partsPath = '/ldraw/') {
    this.partsPath = partsPath;
    this.loader = new LDrawLoader();
    this.loader.setPartsLibraryPath(this.partsPath);
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.loader.smoothNormals = true;
  }

  /**
   * Loads and normalizes an LDraw part model
   * @param {string} partId e.g. "3001" or "3001.dat"
   * @returns {Promise<{ model: THREE.Group, bbox: THREE.Box3, sphere: THREE.Sphere, size: THREE.Vector3 }>}
   */
  async load(partId) {
    const cleanId = partId.replace(/\.dat$/, '');
    const modelUrl = `${this.partsPath.replace(/\/$/, '')}/parts/${cleanId}.dat`;

    const rawGroup = await this.loader.loadAsync(modelUrl);
    let model;
    try {
      model = LDrawUtils.mergeObject(rawGroup);
    } catch (err) {
      model = rawGroup;
    }

    // Coordinate conversion: LDraw (+Y down) to Three.js (+Y up)
    model.rotation.x = Math.PI;
    model.updateMatrixWorld(true);

    model.userData = {
      partId: cleanId,
      baseRotation: [0, 0, 0]
    };

    // Apply baseline grounding
    const bounds = this.applyRotationAndGround(model, 0, 0, 0);

    return {
      model,
      bbox: bounds.bbox,
      sphere: bounds.sphere,
      size: bounds.size
    };
  }

  /**
   * Applies 3D rotation on all 3 axes and strictly grounds the bounding box at Y = 0
   * @param {THREE.Object3D} model
   * @param {number} rx Rotation around X in radians
   * @param {number} ry Rotation around Y in radians
   * @param {number} rz Rotation around Z in radians
   * @returns {{ bbox: THREE.Box3, sphere: THREE.Sphere, size: THREE.Vector3, rotation: [number, number, number] }}
   */
  applyRotationAndGround(model, rx, ry, rz) {
    // Reset position to origin before rotation to prevent positional drift
    model.position.set(0, 0, 0);
    // Apply 3D rotation relative to LDraw base inversion
    model.rotation.set(Math.PI + rx, ry, rz);
    model.updateMatrixWorld(true);

    // Compute bounding box after 3-axis rotation
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());

    // Shift model so lowest point is at Y = 0 and centered on X, Z
    model.position.set(-center.x, -bbox.min.y, -center.z);
    model.updateMatrixWorld(true);

    // Recompute final world bounds
    const finalBbox = new THREE.Box3().setFromObject(model);
    const size = finalBbox.getSize(new THREE.Vector3());
    const sphere = finalBbox.getBoundingSphere(new THREE.Sphere());

    model.userData.bbox = finalBbox;
    model.userData.sphere = sphere;
    model.userData.size = size;
    model.userData.rotation = [rx, ry, rz];

    return {
      bbox: finalBbox,
      sphere,
      size,
      rotation: [rx, ry, rz]
    };
  }

  /**
   * Randomly rotates object on all 3 axes and re-grounds bounding box at Y = 0
   * @param {THREE.Object3D} model
   * @param {() => number} rng
   * @returns {{ bbox: THREE.Box3, sphere: THREE.Sphere, size: THREE.Vector3, rotation: [number, number, number] }}
   */
  applyRandomRotationAndGround(model, rng) {
    const rx = rng() * Math.PI * 2;
    const ry = rng() * Math.PI * 2;
    const rz = rng() * Math.PI * 2;
    return this.applyRotationAndGround(model, rx, ry, rz);
  }
}
