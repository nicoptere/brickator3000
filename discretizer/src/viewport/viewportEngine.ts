import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSParser } from '../parsers/tdsParser';
import type { PlacedBrick } from '../core/types';
import type { PlateLattice3D } from '../core/PlateLattice3D';

export interface ModelStats {
  name: string;
  triangleCount: number;
  vertexCount: number;
  dimensions: { x: number; y: number; z: number };
}

export interface ViewportEngineOptions {
  onModelLoaded?: (stats: ModelStats) => void;
  onLoadingProgress?: (progress: number) => void;
}

export class ViewportEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private modelRoot: THREE.Group;
  private bricksRoot: THREE.Group;
  private currentViewMode: 'mesh' | 'lego' | 'both' = 'mesh';
  private gridHelper!: THREE.GridHelper;
  private floorPlane!: THREE.Mesh;
  private animFrameId: number = 0;
  private isDisposed: boolean = false;
  private options: ViewportEngineOptions;

  constructor(container: HTMLElement, options: ViewportEngineOptions = {}) {
    this.container = container;
    this.options = options;

    // Scene with dark grey background (per GEMINI.md rule: #1e222b)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e222b);

    // Camera
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(16, 14, 20);

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 4, 0);
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // Slightly below floor
    this.controls.minDistance = 2;
    this.controls.maxDistance = 150;

    // Lighting setup
    this.setupLighting();

    // Studio Ground Grid & Contact Shadow Plane
    this.setupGround();

    // Model Container Root
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // Discretized Bricks Container Root
    this.bricksRoot = new THREE.Group();
    this.scene.add(this.bricksRoot);

    // Start render loop
    this.render = this.render.bind(this);
    this.render();
  }

  private setupLighting(): void {
    // Ambient / Hemisphere light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222630, 0.85);
    hemiLight.position.set(0, 40, 0);
    this.scene.add(hemiLight);

    // Key directional light with soft shadows
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(20, 35, 25);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 100;
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.bias = -0.0001;
    this.scene.add(keyLight);

    // Fill directional light
    const fillLight = new THREE.DirectionalLight(0x90b0e0, 0.5);
    fillLight.position.set(-20, 20, -15);
    this.scene.add(fillLight);
  }

  private setupGround(): void {
    // Subtle floor grid (size: 40, divisions: 40, dark grey lines per GEMINI.md)
    this.gridHelper = new THREE.GridHelper(40, 40, 0x3b4252, 0x2e3440);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    // Soft shadow receiver plane
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.floorPlane = new THREE.Mesh(floorGeo, floorMat);
    this.floorPlane.rotation.x = -Math.PI / 2;
    this.floorPlane.position.y = -0.01;
    this.floorPlane.receiveShadow = true;
    this.scene.add(this.floorPlane);
  }

  public resize(): void {
    if (!this.container || this.isDisposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private render(): void {
    if (this.isDisposed) return;
    this.animFrameId = requestAnimationFrame(this.render);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public clearModel(): void {
    while (this.modelRoot.children.length > 0) {
      const child = this.modelRoot.children[0];
      this.modelRoot.remove(child);
      if ((child as any).geometry) {
        (child as any).geometry.dispose();
      }
      if ((child as any).material) {
        const mat = (child as any).material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat.dispose();
      }
    }
  }

  public async loadModelFromUrl(url: string, fileType: string, modelName: string): Promise<void> {
    this.clearModel();
    if (this.options.onLoadingProgress) this.options.onLoadingProgress(10);

    let loadedObject: THREE.Object3D | null = null;

    if (fileType === 'glb' || fileType === 'gltf') {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url, (xhr) => {
        if (xhr.total > 0 && this.options.onLoadingProgress) {
          this.options.onLoadingProgress(Math.round((xhr.loaded / xhr.total) * 90));
        }
      });
      loadedObject = gltf.scene;
    } else if (fileType === 'obj') {
      const loader = new OBJLoader();
      loadedObject = await loader.loadAsync(url);
    } else if (fileType === 'ply') {
      const loader = new PLYLoader();
      const geom = await loader.loadAsync(url);
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.4,
        metalness: 0.1,
        vertexColors: geom.hasAttribute('color')
      });
      loadedObject = new THREE.Mesh(geom, mat);
    } else if (fileType === '3ds') {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const parser = new TDSParser(buffer);
      loadedObject = parser.parse();
    } else if (fileType === 'procedural_sphere') {
      const geom = new THREE.SphereGeometry(4, 64, 32);
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        roughness: 0.3,
        metalness: 0.1
      });
      loadedObject = new THREE.Mesh(geom, mat);
    } else if (fileType === 'procedural_torus') {
      const geom = new THREE.TorusKnotGeometry(3, 1, 128, 32);
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        roughness: 0.25,
        metalness: 0.2
      });
      loadedObject = new THREE.Mesh(geom, mat);
    }

    if (!loadedObject) {
      throw new Error(`Unsupported model file format: ${fileType}`);
    }

    this.processLoadedModel(loadedObject, modelName);
  }

  public async loadModelFromFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const arrayBuffer = await file.arrayBuffer();
    this.clearModel();

    let loadedObject: THREE.Object3D | null = null;

    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(arrayBuffer, '');
      loadedObject = gltf.scene;
    } else if (ext === 'obj') {
      const text = new TextDecoder().decode(arrayBuffer);
      const loader = new OBJLoader();
      loadedObject = loader.parse(text);
    } else if (ext === 'ply') {
      const loader = new PLYLoader();
      const geom = loader.parse(arrayBuffer);
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.4,
        vertexColors: geom.hasAttribute('color')
      });
      loadedObject = new THREE.Mesh(geom, mat);
    } else if (ext === '3ds') {
      const parser = new TDSParser(arrayBuffer);
      loadedObject = parser.parse();
    } else {
      throw new Error(`Unsupported file extension: .${ext}`);
    }

    this.processLoadedModel(loadedObject, file.name);
  }

  private processLoadedModel(obj: THREE.Object3D, name: string): void {
    let vertexCount = 0;
    let triangleCount = 0;

    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.geometry) {
          const geo = mesh.geometry;
          if (geo.index) {
            triangleCount += geo.index.count / 3;
          } else if (geo.attributes.position) {
            triangleCount += geo.attributes.position.count / 3;
          }
          if (geo.attributes.position) {
            vertexCount += geo.attributes.position.count;
          }
        }
      }
    });

    // Compute bounding box and normalize scale & position
    const bbox = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Target bounding height around 8 units
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const targetDim = 8.0;
    const scale = targetDim / maxDim;
    obj.scale.setScalar(scale);

    // Re-center model and position base on ground plane Y = 0
    obj.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);

    this.modelRoot.add(obj);

    // Camera framing
    const scaledSize = size.clone().multiplyScalar(scale);
    const camDist = Math.max(scaledSize.x, scaledSize.y, scaledSize.z) * 2.2;
    this.camera.position.set(camDist * 0.9, scaledSize.y * 1.1 + camDist * 0.4, camDist * 1.1);
    this.controls.target.set(0, scaledSize.y * 0.5, 0);
    this.controls.update();

    if (this.options.onModelLoaded) {
      this.options.onModelLoaded({
        name,
        triangleCount: Math.round(triangleCount),
        vertexCount: Math.round(vertexCount),
        dimensions: {
          x: Math.round(size.x * 100) / 100,
          y: Math.round(size.y * 100) / 100,
          z: Math.round(size.z * 100) / 100
        }
      });
    }
  }

  public clearBricks(): void {
    while (this.bricksRoot.children.length > 0) {
      const child = this.bricksRoot.children[0];
      this.bricksRoot.remove(child);
      child.traverse((c) => {
        if ((c as any).geometry) (c as any).geometry.dispose();
        if ((c as any).material) {
          const m = (c as any).material;
          if (Array.isArray(m)) m.forEach(x => x.dispose());
          else m.dispose();
        }
      });
    }
  }

  public setViewMode(mode: 'mesh' | 'lego' | 'both'): void {
    this.currentViewMode = mode;
    if (mode === 'mesh') {
      this.modelRoot.visible = true;
      this.bricksRoot.visible = false;
      this.setMeshOpacity(1.0);
    } else if (mode === 'lego') {
      this.modelRoot.visible = false;
      this.bricksRoot.visible = true;
    } else {
      this.modelRoot.visible = true;
      this.bricksRoot.visible = true;
      this.setMeshOpacity(0.35); // Semi-transparent overlay comparison
    }
  }

  private setMeshOpacity(opacity: number): void {
    this.modelRoot.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = (child as THREE.Mesh).material;
        const mats = Array.isArray(m) ? m : [m];
        mats.forEach(mat => {
          mat.transparent = opacity < 1.0;
          mat.opacity = opacity;
        });
      }
    });
  }

  /**
   * Display placed LEGO bricks with realistic ABS plastic materials and top studs.
   */
  public displayDiscretizedBricks(bricks: PlacedBrick[], lattice: PlateLattice3D): void {
    this.clearBricks();

    // Align LEGO scale with loaded mesh bounds
    const bbox = new THREE.Box3().setFromObject(this.modelRoot);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const studPitch = (size.x || 8.0) / lattice.numStudsX;
    const platePitch = studPitch * 0.4;

    const group = new THREE.Group();

    // Shared stud cylinder geometry (radius 0.24 * studPitch, height 0.18 * studPitch)
    const studGeo = new THREE.CylinderGeometry(studPitch * 0.24, studPitch * 0.24, studPitch * 0.18, 16);

    for (const brick of bricks) {
      const [bx, bz, by] = brick.gridPos;
      const [bw, bd, bh] = brick.size;

      // Position in scene
      const posX = (bx + bw / 2 - lattice.numStudsX / 2) * studPitch;
      const posZ = (bz + bd / 2 - lattice.numStudsZ / 2) * studPitch;
      const posY = (by + bh / 2) * platePitch;

      const brickWidth = bw * studPitch;
      const brickDepth = bd * studPitch;
      const brickHeight = bh * platePitch;

      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(brick.colorHex),
        roughness: 0.2,
        metalness: 0.05,
        clearcoat: 0.35,
        clearcoatRoughness: 0.1
      });

      // Body mesh
      let bodyGeo: THREE.BufferGeometry;
      if (brick.category === 'ROUND_CANISTER') {
        bodyGeo = new THREE.CylinderGeometry(brickWidth * 0.48, brickWidth * 0.48, brickHeight, 24);
      } else {
        bodyGeo = new THREE.BoxGeometry(brickWidth - 0.01, brickHeight - 0.005, brickDepth - 0.01);
      }

      const bodyMesh = new THREE.Mesh(bodyGeo, mat);
      bodyMesh.position.set(posX, posY, posZ);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      group.add(bodyMesh);

      // Top studs (omit for smooth flat tiles and curved slopes)
      const hasTopStuds = brick.category !== 'TILE_FLAT' && brick.category !== 'SLOPE_CURVED' && brick.category !== 'CHEESE_SLOPE';
      if (hasTopStuds) {
        for (let sx = 0; sx < bw; sx++) {
          for (let sz = 0; sz < bd; sz++) {
            const studMesh = new THREE.Mesh(studGeo, mat);
            const studX = (bx + sx + 0.5 - lattice.numStudsX / 2) * studPitch;
            const studZ = (bz + sz + 0.5 - lattice.numStudsZ / 2) * studPitch;
            const studY = (by + bh) * platePitch + (studPitch * 0.09);
            studMesh.position.set(studX, studY, studZ);
            studMesh.castShadow = true;
            group.add(studMesh);
          }
        }
      }
    }

    this.bricksRoot.add(group);
    this.setViewMode('lego');
  }

  public getActiveModel(): THREE.Object3D | null {
    return this.modelRoot.children.length > 0 ? this.modelRoot.children[0] : null;
  }

  public getModelRoot(): THREE.Group {
    return this.modelRoot;
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.animFrameId);
    this.controls.dispose();
    this.renderer.dispose();
    this.clearModel();
    if (this.renderer.domElement && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
