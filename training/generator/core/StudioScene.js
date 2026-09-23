import * as THREE from 'three';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';

/**
 * StudioScene: Manages the 3D studio environment including the physical ground plane,
 * Kelvin-calibrated directional key light, SSS rim light, and panoramic environment.
 */
export class StudioScene {
  static KELVIN_LIGHTS = [
    { name: '2800K Warm Tungsten', hex: 0xffebd2 },
    { name: '3500K Halogen Studio', hex: 0xfff1e0 },
    { name: '5000K Neutral Daylight', hex: 0xfffaed },
    { name: '5600K Photographic Daylight', hex: 0xfafafa },
    { name: '6500K Cool Fluorescent', hex: 0xeef5fc }
  ];

  static LIGHT_TIERS = [
    {
      id: 0,
      name: 'Tier 1: Subtle Moody (Dim)',
      baseKey: 2.75,
      baseRim: 1.68,
      ambientTop: 0x2a3448,
      ambientBottom: 0x111620
    },
    {
      id: 1,
      name: 'Tier 2: Balanced Studio (Medium)',
      baseKey: 5.25,
      baseRim: 2.75,
      ambientTop: 0x37455f,
      ambientBottom: 0x19202d
    },
    {
      id: 2,
      name: 'Tier 3: High Contrast (Bright)',
      baseKey: 8.0,
      baseRim: 3.88,
      ambientTop: 0x2d384e,
      ambientBottom: 0x131823
    },
    {
      id: 3,
      name: 'Tier 4: Intense Spotlight (Hard)',
      baseKey: 11.75,
      baseRim: 5.25,
      ambientTop: 0x202837,
      ambientBottom: 0x0c1019
    }
  ];

  /**
   * @param {number} [floorSize=3000]
   */
  constructor(floorSize = 3000) {
    this.scene = new THREE.Scene();
    this.floorSize = floorSize;
    this.currentModel = null;

    this.floorRoughness = 0.40; // Default 0.40 (+/- 0.2)
    this.floorMetalness = 0.40; // Default 0.40 (+/- 0.2)
    this.activeTierIndex = 1; // Default to Tier 2: Balanced Studio

    this.setupEnvironment();
    this.setupFloor();
    this.setupLighting();
  }

  setupEnvironment() {
    this.gradientEnv = new GradientEquirectTexture();
    this.applyAmbientDome(this.activeTierIndex);
    this.scene.environment = this.gradientEnv;
    this.scene.background = this.gradientEnv;
  }

  applyAmbientDome(tierIndex = 1) {
    const tier = StudioScene.LIGHT_TIERS[tierIndex] || StudioScene.LIGHT_TIERS[1];
    this.gradientEnv.topColor.setHex(tier.ambientTop);
    this.gradientEnv.bottomColor.setHex(tier.ambientBottom);
    this.gradientEnv.update();
  }

  setupFloor() {
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      roughness: this.floorRoughness,
      metalness: this.floorMetalness,
      side: THREE.DoubleSide
    });

    this.floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.floorSize, this.floorSize),
      this.floorMat
    );
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
  }

  setupLighting() {
    // Key Light (casts direct contact shadows)
    this.keyLight = new THREE.DirectionalLight(0xfffaed, 5.25);
    this.keyLight.position.set(90, 160, 70);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);
    this.keyLight.target.position.set(0, 10, 0);

    // Rim Light (backlight highlighting ABS translucent edges)
    this.rimLight = new THREE.DirectionalLight(0xffffff, 2.75);
    this.rimLight.position.set(-90, 80, -70);
    this.scene.add(this.rimLight);
  }

  /**
   * Randomizes key light Kelvin temperature and angular placement using chosen or random light tier
   * @param {number} sphereRadius
   * @param {() => number} rng
   * @param {number|null} [forcedTier=null]
   * @returns {object}
   */
  randomizeLighting(sphereRadius, rng, forcedTier = null) {
    const tierIdx = forcedTier !== null && forcedTier >= 0 && forcedTier < 4
      ? forcedTier
      : Math.floor(rng() * StudioScene.LIGHT_TIERS.length);

    this.activeTierIndex = tierIdx;
    const tier = StudioScene.LIGHT_TIERS[tierIdx];
    this.applyAmbientDome(tierIdx);

    const kelvinChoice = StudioScene.KELVIN_LIGHTS[
      Math.floor(rng() * StudioScene.KELVIN_LIGHTS.length)
    ];

    this.keyLight.color.setHex(kelvinChoice.hex);
    this.keyLight.intensity = tier.baseKey * (0.92 + rng() * 0.16);

    const keyDist = Math.max(250, sphereRadius * 3.8);
    const keyAz = rng() * Math.PI * 2;
    const keyEl = (28 + rng() * 37) * (Math.PI / 180); // 28° to 65°

    this.keyLight.position.set(
      Math.cos(keyAz) * Math.cos(keyEl) * keyDist,
      Math.sin(keyEl) * keyDist,
      Math.sin(keyAz) * Math.cos(keyEl) * keyDist
    );

    // Rim light positioned opposite to key light
    const rimAz = keyAz + Math.PI + (rng() - 0.5) * 0.5;
    const rimEl = (20 + rng() * 25) * (Math.PI / 180);

    this.rimLight.position.set(
      Math.cos(rimAz) * Math.cos(rimEl) * keyDist,
      Math.sin(rimEl) * keyDist,
      Math.sin(rimAz) * Math.cos(rimEl) * keyDist
    );
    this.rimLight.intensity = tier.baseRim * (0.9 + rng() * 0.2);

    return {
      tierId: tier.id,
      tierName: tier.name,
      kelvinName: kelvinChoice.name,
      kelvinHex: kelvinChoice.hex,
      keyIntensity: this.keyLight.intensity,
      keyElevationDeg: Math.round(keyEl * (180 / Math.PI)),
      keyAzimuthDeg: Math.round(keyAz * (180 / Math.PI))
    };
  }

  /**
   * Sets floor material texture while preserving user roughness/metalness
   * @param {THREE.Texture} [map]
   * @param {number} [roughness]
   * @param {number} [metalness]
   */
  setFloorMaterial(map = null, roughness = null, metalness = null) {
    if (roughness !== null) this.floorRoughness = roughness;
    if (metalness !== null) this.floorMetalness = metalness;

    if (map) {
      this.floorMat.map = map;
      this.floorMat.color.setHex(0xffffff);
    } else {
      this.floorMat.map = null;
      this.floorMat.color.setHex(0x242830);
    }
    this.floorMat.roughness = this.floorRoughness;
    this.floorMat.metalness = this.floorMetalness;
    this.floorMat.needsUpdate = true;
  }

  setFloorRoughness(roughness) {
    this.floorRoughness = Math.max(0.0, Math.min(1.0, roughness));
    this.floorMat.roughness = this.floorRoughness;
    this.floorMat.needsUpdate = true;
  }

  setFloorMetalness(metalness) {
    this.floorMetalness = Math.max(0.0, Math.min(1.0, metalness));
    this.floorMat.metalness = this.floorMetalness;
    this.floorMat.needsUpdate = true;
  }

  /**
   * Randomizes floor roughness and metalness within +/- 0.2 around 0.4 ([0.2, 0.6])
   * @param {() => number} rng
   * @returns {{ roughness: number, metalness: number }}
   */
  randomizeFloorPbr(rng) {
    const roughness = 0.4 + (rng() - 0.5) * 0.4;
    const metalness = 0.4 + (rng() - 0.5) * 0.4;
    this.setFloorRoughness(roughness);
    this.setFloorMetalness(metalness);
    return { roughness, metalness };
  }

  /**
   * Attaches a LEGO model to the scene
   * @param {THREE.Object3D} model
   */
  setModel(model) {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
    }
    this.currentModel = model;
    if (this.currentModel) {
      this.scene.add(this.currentModel);
    }
  }
}
