import * as THREE from 'three';

/**
 * CameraChoreographer: Implements the 16-shot choreographed dataset camera matrix
 * and randomized photo poses based on bounding sphere dimensions.
 */
export class CameraChoreographer {
  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(camera) {
    this.camera = camera;
  }

  /**
   * Computes shot configuration for one of the 16 choreographed matrix shots
   * @param {number} shotIdx 0 to 15
   * @param {number} sphereRadius
   * @param {() => number} rng
   * @returns {object}
   */
  getShotConfig(shotIdx, sphereRadius, rng) {
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const fitDist = (sphereRadius * 1.15) / Math.sin(fovRad / 2);

    let distance, targetOffsetX, targetOffsetY, elevationDeg, azimuthDeg, rollDeg;
    let category = '';

    if (shotIdx < 4) {
      // 0-3: CLOSE-UP (Fills 75%-90% of frame)
      category = 'Close-up';
      distance = fitDist * (0.85 + rng() * 0.15);
      targetOffsetX = (rng() - 0.5) * sphereRadius * 0.15;
      targetOffsetY = (rng() - 0.5) * sphereRadius * 0.10;
      elevationDeg = 25 + rng() * 30; // 25° - 55°
      azimuthDeg = shotIdx * 90 + rng() * 35;
      rollDeg = (rng() - 0.5) * 6;
    } else if (shotIdx < 8) {
      // 4-7: CROPPED (Camera close, target shifted so borders clip)
      category = 'Cropped';
      distance = fitDist * (0.58 + rng() * 0.10);
      const angle = rng() * Math.PI * 2;
      targetOffsetX = Math.cos(angle) * sphereRadius * 0.45;
      targetOffsetY = Math.sin(angle) * sphereRadius * 0.35;
      elevationDeg = 20 + rng() * 35;
      azimuthDeg = shotIdx * 90 + rng() * 40;
      rollDeg = (rng() - 0.5) * 8;
    } else if (shotIdx < 12) {
      // 8-11: FROM AFAR (25%-38% frame coverage on table)
      category = 'From Afar';
      distance = fitDist * (2.1 + rng() * 0.5);
      targetOffsetX = (rng() - 0.5) * sphereRadius * 0.2;
      targetOffsetY = 0;
      elevationDeg = 28 + rng() * 28;
      azimuthDeg = shotIdx * 90 + rng() * 45;
      rollDeg = (rng() - 0.5) * 5;
    } else {
      // 12-15: VARIED ANGLES & PERSPECTIVES
      const sub = shotIdx - 12;
      if (sub === 0) {
        category = 'Low Angle Desk-Level';
        distance = fitDist * 1.15;
        targetOffsetX = 0; targetOffsetY = 0;
        elevationDeg = 13 + rng() * 5;
        azimuthDeg = 35 + rng() * 30;
        rollDeg = 0;
      } else if (sub === 1) {
        category = 'Top-Down Isometric';
        distance = fitDist * 1.25;
        targetOffsetX = (rng() - 0.5) * sphereRadius * 0.1;
        targetOffsetY = (rng() - 0.5) * sphereRadius * 0.1;
        elevationDeg = 78 + rng() * 8;
        azimuthDeg = 45 + rng() * 45;
        rollDeg = (rng() - 0.5) * 8;
      } else if (sub === 2) {
        category = 'Dutch Tilted 3/4';
        distance = fitDist * 1.05;
        targetOffsetX = (rng() - 0.5) * sphereRadius * 0.15;
        targetOffsetY = 0;
        elevationDeg = 38 + rng() * 12;
        azimuthDeg = 215 + rng() * 30;
        rollDeg = (rng() > 0.5 ? 1 : -1) * (10 + rng() * 6);
      } else {
        category = 'Dramatic Rim Silhouette';
        distance = fitDist * 1.15;
        targetOffsetX = 0; targetOffsetY = 0;
        elevationDeg = 28 + rng() * 16;
        azimuthDeg = 310 + rng() * 35;
        rollDeg = (rng() - 0.5) * 5;
      }
    }

    return {
      category,
      distance,
      targetOffset: new THREE.Vector3(targetOffsetX, targetOffsetY, 0),
      elevationDeg,
      azimuthDeg,
      rollDeg,
      elevation: elevationDeg * (Math.PI / 180),
      azimuth: azimuthDeg * (Math.PI / 180),
      roll: rollDeg * (Math.PI / 180)
    };
  }

  /**
   * Applies one of the 16 choreographed shots to the camera
   * @param {number} shotIdx
   * @param {THREE.Sphere} sphere
   * @param {() => number} rng
   * @param {THREE.Vector3} modelSize
   * @returns {object}
   */
  applyShot(shotIdx, sphere, rng, modelSize) {
    const cfg = this.getShotConfig(shotIdx, sphere.radius, rng);

    const cx = Math.cos(cfg.azimuth) * Math.cos(cfg.elevation) * cfg.distance;
    const cy = Math.sin(cfg.elevation) * cfg.distance;
    const cz = Math.sin(cfg.azimuth) * Math.cos(cfg.elevation) * cfg.distance;

    this.camera.position.set(cx, Math.max(cy, modelSize.y * 0.25), cz);
    const target = new THREE.Vector3(0, modelSize.y * 0.5, 0).add(cfg.targetOffset);
    this.camera.lookAt(target);

    if (Math.abs(cfg.roll) > 0.001) {
      this.camera.rotation.z += cfg.roll;
    }

    return {
      shotIndex: shotIdx,
      category: cfg.category,
      distance: cfg.distance,
      elevationDeg: cfg.elevationDeg,
      azimuthDeg: cfg.azimuthDeg,
      rollDeg: cfg.rollDeg,
      target
    };
  }

  /**
   * Applies an arbitrary randomized camera pose
   * @param {THREE.Sphere} sphere
   * @param {() => number} rng
   * @param {THREE.Vector3} modelSize
   * @returns {object}
   */
  randomizeOrbit(sphere, rng, modelSize) {
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const fitDist = (sphere.radius * 1.15) / Math.sin(fovRad / 2);

    const distance = fitDist * (0.75 + rng() * 1.25);
    const elevationDeg = 15 + rng() * 65; // 15° to 80°
    const azimuthDeg = rng() * 360;
    const rollDeg = (rng() - 0.5) * 8;

    const elRad = elevationDeg * (Math.PI / 180);
    const azRad = azimuthDeg * (Math.PI / 180);
    const rollRad = rollDeg * (Math.PI / 180);

    const cx = Math.cos(azRad) * Math.cos(elRad) * distance;
    const cy = Math.sin(elRad) * distance;
    const cz = Math.sin(azRad) * Math.cos(elRad) * distance;

    this.camera.position.set(cx, Math.max(cy, modelSize.y * 0.2), cz);
    const target = new THREE.Vector3(0, modelSize.y * 0.5, 0);
    this.camera.lookAt(target);

    if (Math.abs(rollRad) > 0.001) {
      this.camera.rotation.z += rollRad;
    }

    return {
      category: 'Randomized Orbit',
      distance,
      elevationDeg,
      azimuthDeg,
      rollDeg,
      target
    };
  }
}
