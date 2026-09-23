import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { StudioScene } from './StudioScene.js';
import { MaterialFactory } from './MaterialFactory.js';
import { LDrawModelLoader } from './LDrawModelLoader.js';
import { ProceduralTextures, FLOOR_PATTERNS, TABLETOP_PALETTES } from './ProceduralTextures.js';

export const DENSE_LEGO_PALETTE = [
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

export const DENSE_FLOOR_TYPES = FLOOR_PATTERNS;

export class DensePileRenderer {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.gl = options.gl || this.canvas.getContext('webgl2');
    this.width = options.width || 224;
    this.height = options.height || 224;
    this.samples = options.samples || 64;
    this.bounces = options.bounces || 4;
    this.ldrawPath = options.ldrawPath || 'http://localhost:3005/ldraw/';

    // Initialize WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: this.gl,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // Initialize Path Tracer
    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.bounces = this.bounces;
    this.pathTracer.renderDelay = 0;
    this.pathTracer.fadeDuration = 0;
    this.pathTracer.minSamples = 1;
    this.pathTracer.tiles.set(1, 1);

    this.studioScene = new StudioScene(5000);
    this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 1.0, 50000);

    // Helpers
    this.normalTex = ProceduralTextures.generateNormalNoiseTexture(256, 1.4);
    this.matFactory = new MaterialFactory(this.normalTex);
    this.loader = new LDrawModelLoader(this.ldrawPath);

    this.floorCache = new Map();

    this.isCompilingFirst = true;
  }

  /**
   * Sets the camera pose relative to the pile
   * @param {THREE.Box3} pileBox 
   * @param {'topdown' | 'isometric' | 'angle45' | 'low'} viewType 
   * @param {() => number} rng 
   */
  setupCameraForPile(pileBox, viewType = 'topdown', rng = Math.random, cameraDistLdu = null) {
    const center = pileBox.getCenter(new THREE.Vector3());
    const sphere = pileBox.getBoundingSphere(new THREE.Sphere());
    const fovRad = (this.camera.fov * Math.PI) / 180;
    
    // Fit distance closer to the dense cluster core so peripheral pieces spill offscreen naturally
    const baseDist = (sphere.radius * 0.72) / Math.sin(fovRad / 2);

    let elevDeg = 82;
    let azimDeg = rng() * 360;
    let dist = cameraDistLdu ? (cameraDistLdu * (0.96 + rng() * 0.08)) : baseDist;

    if (viewType === 'topdown') {
      elevDeg = 76 + rng() * 10; // 76° to 86°
      if (!cameraDistLdu) dist = baseDist * 0.95;
    } else if (viewType === 'isometric') {
      elevDeg = 52 + (rng() - 0.5) * 8; // ~52°
      if (!cameraDistLdu) dist = baseDist * 1.0;
    } else if (viewType === 'angle45') {
      elevDeg = 42 + (rng() - 0.5) * 6; // ~42°
      if (!cameraDistLdu) dist = baseDist * 1.05;
    } else if (viewType === 'low') {
      elevDeg = 24 + (rng() - 0.5) * 6; // ~24°
      if (!cameraDistLdu) dist = baseDist * 1.10;
    }

    const elevRad = (elevDeg * Math.PI) / 180;
    const azimRad = (azimDeg * Math.PI) / 180;

    const cx = center.x + dist * Math.cos(elevRad) * Math.sin(azimRad);
    const cy = Math.max(10, dist * Math.sin(elevRad));
    const cz = center.z + dist * Math.cos(elevRad) * Math.cos(azimRad);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(center.x, Math.max(0, center.y * 0.3), center.z);
    this.camera.far = Math.max(50000, dist * 4.0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    return {
      viewType,
      elevDeg: Math.round(elevDeg),
      azimDeg: Math.round(azimDeg),
      dist: Math.round(dist),
      cameraDistLdu: cameraDistLdu ? Math.round(cameraDistLdu) : null
    };
  }

  /**
   * Renders Pass A (512 SPP Path Traced Beauty) and Pass B (24-bit Stencil)
   * @param {THREE.Group} pileGroup 
   * @param {Array<object>} instances 
   * @param {object} viewConfig { viewType, sceneIdx, rng }
   */
  async renderPileScene(pileGroup, instances, viewConfig = {}) {
    const rng = viewConfig.rng || Math.random;
    const sceneIdx = viewConfig.sceneIdx || 0;
    const viewType = viewConfig.viewType || 'topdown';

    // 1. Setup Floor (Randomized pattern & color for every new image)
    const fPattern = FLOOR_PATTERNS[Math.floor(rng() * FLOOR_PATTERNS.length)];
    const fPalette = TABLETOP_PALETTES[Math.floor(rng() * TABLETOP_PALETTES.length)];
    const fSeed = Math.floor(rng() * 100000);
    const floorTex = ProceduralTextures.generateBackgroundTexture(fPattern, fSeed, 128, fPalette.hex);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(16, 16);
    floorTex.needsUpdate = true;

    if (this._currentFloorTex) {
      try { this._currentFloorTex.dispose(); } catch (_) {}
    }
    this._currentFloorTex = floorTex;

    let roughness = 0.55;
    let metalness = 0.08;
    if (fPattern === 'tray') { roughness = 0.35; metalness = 0.05; }
    else if (fPattern === 'tile') { roughness = 0.22; metalness = 0.12; }
    else if (fPattern === 'felt') { roughness = 0.95; metalness = 0.01; }
    else if (fPattern === 'wood') { roughness = 0.50; metalness = 0.04; }
    else if (fPattern === 'slate') { roughness = 0.65; metalness = 0.15; }

    this.studioScene.setFloorMaterial(floorTex, roughness, metalness);

    // 2. Set Model & Camera
    this.studioScene.setModel(pileGroup);
    const pileBox = new THREE.Box3().setFromObject(pileGroup);
    const cameraInfo = this.setupCameraForPile(pileBox, viewType, rng, viewConfig.cameraDistLdu);

    // 3. Lighting (Soft diffused studio light + subtle rim)
    this.studioScene.randomizeLighting(pileBox.getBoundingSphere(new THREE.Sphere()).radius, rng, sceneIdx % 4);
    this.studioScene.keyLight.intensity = Math.max(3.8, this.studioScene.keyLight.intensity * 0.9);
    this.studioScene.rimLight.intensity = Math.max(2.0, this.studioScene.rimLight.intensity * 0.9);

    // 4. Pass A: Path Tracer (128 SPP)
    this.pathTracer.setScene(this.studioScene.scene, this.camera);
    this.pathTracer.reset();

    // Always ensure shader compilation finishes after setting scene
    this.pathTracer.renderSample();
    if (this.pathTracer._pathTracer && this.pathTracer._pathTracer._compilePromise) {
      await this.pathTracer._pathTracer._compilePromise;
    }
    this.pathTracer.reset();

    const tStartRender = Date.now();
    while (this.pathTracer.samples < this.samples) {
      this.pathTracer.renderSample();
    }
    const renderSec = ((Date.now() - tStartRender) / 1000).toFixed(2);

    const beautyPng = this.canvas.toBuffer('image/png');

    // 5. Pass B: 24-bit Integer ID Stencil Pass (< 15ms)
    const stencilPng = this._renderStencilPass(instances);

    return {
      beautyPng,
      stencilPng,
      cameraInfo,
      floorType: fPattern,
      floorPalette: fPalette.name,
      renderSec,
      width: this.width,
      height: this.height,
      samples: this.samples,
      instancesMeta: instances.map(inst => ({
        instanceId: inst.instanceId,
        partId: inst.partId,
        colorHex: inst.colorHex
      }))
    };
  }

  _renderStencilPass(instances) {
    const origMaterials = new Map();
    this.studioScene.floorMesh.visible = false;
    const prevBg = this.studioScene.scene.background;
    this.studioScene.scene.background = null;

    const prevToneMapping = this.renderer.toneMapping;
    const prevColorSpace = this.renderer.outputColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // Assign 24-bit color to each instance
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const id = inst.instanceId; // 1 to N
      const r = (id & 0xFF) / 255;
      const g = ((id >> 8) & 0xFF) / 255;
      const b = ((id >> 16) & 0xFF) / 255;

      const idMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
      });

      inst.model.traverse(child => {
        if (child.isMesh) {
          origMaterials.set(child, child.material);
          child.material = idMat;
        }
      });
    }

    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.studioScene.scene, this.camera);

    const stencilPng = this.canvas.toBuffer('image/png');

    // Restore settings
    this.renderer.toneMapping = prevToneMapping;
    this.renderer.outputColorSpace = prevColorSpace;
    this.studioScene.floorMesh.visible = true;
    this.studioScene.scene.background = prevBg;
    for (const [mesh, mat] of origMaterials.entries()) {
      mesh.material = mat;
    }

    return stencilPng;
  }
}
