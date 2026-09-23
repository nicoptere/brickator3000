import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { StudioScene } from './StudioScene.js';
import { MaterialFactory } from './MaterialFactory.js';
import { LDrawModelLoader } from './LDrawModelLoader.js';
import { ProceduralTextures } from './ProceduralTextures.js';
import { ContactGrounding } from './ContactGrounding.js';

export const LEGO_PALETTE = [
  { name: 'Bright Red', hex: '#DC2626' },
  { name: 'Bright Blue', hex: '#0055BF' },
  { name: 'Bright Yellow', hex: '#F2CD37' },
  { name: 'Dark Green', hex: '#237841' },
  { name: 'Dark Slate Black', hex: '#1B2A34' },
  { name: 'White', hex: '#F4F4F4' },
  { name: 'Medium Stone Grey', hex: '#A0A5A9' },
  { name: 'Dark Stone Grey', hex: '#6C6E68' },
  { name: 'Bright Orange', hex: '#FE8A18' },
  { name: 'Brick Yellow Tan', hex: '#D9BB7B' },
  { name: 'Lime Green', hex: '#BBE90B' },
  { name: 'Medium Azure', hex: '#36AEBF' },
  { name: 'Magenta Pink', hex: '#923978' },
  { name: 'Purple Blue', hex: '#4B3185' },
  { name: 'Reddish Brown', hex: '#583927' }
];

const FLOOR_TYPES = ['wood', 'stone', 'plastic', 'felt', 'tile'];

export class MultiPartClusterRenderer {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.gl = options.gl || this.canvas.getContext('webgl2');
    this.width = options.width || 512;
    this.height = options.height || 512;
    this.samples = options.samples || 64;
    this.bounces = options.bounces || 4;
    this.ldrawPath = options.ldrawPath || 'http://localhost:3005/ldraw/';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: this.gl,
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.bounces = this.bounces;
    this.pathTracer.renderDelay = 0;
    this.pathTracer.fadeDuration = 0;
    this.pathTracer.minSamples = 1;

    this.studioScene = new StudioScene(3000);
    this.camera = new THREE.PerspectiveCamera(35, this.width / this.height, 0.1, 5000);

    this.normalTex = ProceduralTextures.generateNormalNoiseTexture(256, 1.4);
    this.matFactory = new MaterialFactory(this.normalTex);
    this.loader = new LDrawModelLoader(this.ldrawPath);

    this.maskRenderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType
    });

    this.cachedFloorTextures = [];
    for (let fIdx = 0; fIdx < FLOOR_TYPES.length; fIdx++) {
      for (let sIdx = 0; sIdx < 3; sIdx++) {
        const fType = FLOOR_TYPES[fIdx];
        const tex = ProceduralTextures.generateBackgroundTexture(fType, 2000 + fIdx * 100 + sIdx * 19, 512, '#3a3e45');
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(24, 24);
        tex.needsUpdate = true;
        this.cachedFloorTextures.push(tex);
      }
    }

    this.isCompilingFirst = true;
  }

  async renderClusterScene(partConfigs, sceneIndex, rng = Math.random) {
    const clusterGroup = new THREE.Group();
    clusterGroup.name = 'ClusterGroup';
    const loadedInstances = [];

    // 1. Setup Floor
    const floorType = FLOOR_TYPES[sceneIndex % FLOOR_TYPES.length];
    const floorTex = this.cachedFloorTextures[sceneIndex % this.cachedFloorTextures.length];
    this.studioScene.setFloorMaterial(floorTex);
    this.studioScene.setFloorRoughness(0.55);
    this.studioScene.setFloorMetalness(0.15);

    // 2. Load models and layout in cluster
    const clusterRadius = 40 + partConfigs.length * 10;

    for (let i = 0; i < partConfigs.length; i++) {
      const cfg = partConfigs[i];
      const modelData = await this.loader.load(cfg.partId);
      const color = cfg.colorHex || LEGO_PALETTE[Math.floor(rng() * LEGO_PALETTE.length)].hex;
      const plasticMat = this.matFactory.createPlasticMaterial(color);
      this.matFactory.applyToModel(modelData.model, plasticMat);

      // Stable face grounding
      const faceIdx = Math.floor(rng() * 4);
      const rotBase = [
        [0, 0, 0],
        [Math.PI, 0, 0],
        [Math.PI / 2, 0, 0],
        [-Math.PI / 2, 0, 0]
      ][faceIdx];
      const yaw = rng() * Math.PI * 2;
      const perturbX = (rng() - 0.5) * 0.08;
      const perturbZ = (rng() - 0.5) * 0.08;
      ContactGrounding.alignLowestSegmentToGround(
        modelData.model,
        rotBase[0] + perturbX,
        rotBase[1] + yaw,
        rotBase[2] + perturbZ,
        { settleToFace: true }
      );

      // Position in cluster
      let posX = 0, posZ = 0;
      if (i > 0) {
        const angle = ((i - 1) / (partConfigs.length - 1)) * Math.PI * 2 + (rng() - 0.5) * 0.4;
        const dist = 35 + rng() * 45; // 35 to 80 units distance
        posX = Math.cos(angle) * dist;
        posZ = Math.sin(angle) * dist;
      }
      modelData.model.position.x += posX;
      modelData.model.position.z += posZ;
      modelData.model.updateMatrixWorld(true);

      clusterGroup.add(modelData.model);
      loadedInstances.push({
        instanceId: i + 1,
        partId: cfg.partId,
        colorHex: color,
        model: modelData.model
      });
    }

    this.studioScene.setModel(clusterGroup);

    // 3. Camera setup: centered exactly on cluster
    const clusterBox = new THREE.Box3().setFromObject(clusterGroup);
    const clusterSphere = clusterBox.getBoundingSphere(new THREE.Sphere());
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const fitDist = (clusterSphere.radius * 1.35) / Math.sin(fovRad / 2);

    const elevDeg = 38 + rng() * 25; // 38° to 63°
    const azimDeg = rng() * 360;
    const elevRad = (elevDeg * Math.PI) / 180;
    const azimRad = (azimDeg * Math.PI) / 180;

    const cx = clusterSphere.center.x + fitDist * Math.cos(elevRad) * Math.sin(azimRad);
    const cy = Math.max(clusterSphere.radius * 0.5, fitDist * Math.sin(elevRad));
    const cz = clusterSphere.center.z + fitDist * Math.cos(elevRad) * Math.cos(azimRad);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(clusterSphere.center.x, 0, clusterSphere.center.z);
    this.camera.updateMatrixWorld(true);

    // Soft room lighting
    this.studioScene.randomizeLighting(clusterSphere.radius, rng, sceneIndex % 4);
    this.studioScene.keyLight.intensity = Math.max(3.5, this.studioScene.keyLight.intensity * 0.85);
    this.studioScene.rimLight.intensity = Math.max(1.8, this.studioScene.rimLight.intensity * 0.85);

    // 4. Pass A: Path Tracer Beauty Render
    this.pathTracer.setScene(this.studioScene.scene, this.camera);
    this.pathTracer.reset();

    if (this.isCompilingFirst) {
      this.pathTracer.renderSample();
      if (this.pathTracer._pathTracer && this.pathTracer._pathTracer._compilePromise) {
        await this.pathTracer._pathTracer._compilePromise;
      }
      this.pathTracer.reset();
      this.isCompilingFirst = false;
    }

    while (this.pathTracer.samples < this.samples) {
      this.pathTracer.renderSample();
    }

    const beautyPng = this.canvas.toBuffer('image/png');

    // 5. Pass B: Instant Unlit Instance ID Stencil Pass (< 2ms, NO TONE MAPPING)
    const instancesData = this._extractInstanceMasksAndYolo(loadedInstances, clusterGroup);

    return {
      beautyPng,
      instances: instancesData,
      floorType
    };
  }

  _extractInstanceMasksAndYolo(loadedInstances, clusterGroup) {
    const origMaterials = new Map();
    this.studioScene.floorMesh.visible = false;
    const prevBg = this.studioScene.scene.background;
    this.studioScene.scene.background = null;

    // DISABLE tone mapping & sRGB gamma for integer color rendering
    const prevToneMapping = this.renderer.toneMapping;
    const prevColorSpace = this.renderer.outputColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    for (const inst of loadedInstances) {
      const idVal = inst.instanceId * 30; // 30, 60, 90, 120, 150...
      const norm = idVal / 255;
      const idMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(norm, norm, norm, THREE.LinearSRGBColorSpace)
      });

      inst.model.traverse((child) => {
        if (child.isMesh) {
          origMaterials.set(child, child.material);
          child.material = idMat;
        }
      });
    }

    this.renderer.setRenderTarget(this.maskRenderTarget);
    this.renderer.clear();
    this.renderer.render(this.studioScene.scene, this.camera);

    const maskBuf = new Uint8Array(this.width * this.height * 4);
    this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, maskBuf);
    this.renderer.setRenderTarget(null);

    // Restore original materials, tone mapping & color space
    this.renderer.toneMapping = prevToneMapping;
    this.renderer.outputColorSpace = prevColorSpace;
    this.studioScene.floorMesh.visible = true;
    this.studioScene.scene.background = prevBg;
    for (const [mesh, mat] of origMaterials.entries()) {
      mesh.material = mat;
    }

    const results = [];
    for (const inst of loadedInstances) {
      const targetVal = inst.instanceId * 30;
      let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
      let visiblePixels = 0;

      for (let y = 0; y < this.height; y++) {
        const flippedY = this.height - 1 - y;
        for (let x = 0; x < this.width; x++) {
          const idx = (y * this.width + x) * 4;
          const r = maskBuf[idx];
          if (Math.abs(r - targetVal) <= 5) {
            visiblePixels++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (flippedY < minY) minY = flippedY;
            if (flippedY > maxY) maxY = flippedY;
          }
        }
      }

      if (visiblePixels < 20) continue;

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const xCenter = (minX + bw / 2) / this.width;
      const yCenter = (minY + bh / 2) / this.height;
      const normW = bw / this.width;
      const normH = bh / this.height;

      const polygonNorm = [
        minX / this.width, minY / this.height,
        (maxX + 1) / this.width, minY / this.height,
        (maxX + 1) / this.width, (maxY + 1) / this.height,
        minX / this.width, (maxY + 1) / this.height
      ];

      results.push({
        partId: inst.partId,
        colorHex: inst.colorHex,
        instanceId: inst.instanceId,
        visiblePixels,
        bbox: { minX, minY, maxX, maxY, width: bw, height: bh },
        yoloBbox: [xCenter, yCenter, normW, normH],
        polygonNorm
      });
    }

    return results;
  }
}
