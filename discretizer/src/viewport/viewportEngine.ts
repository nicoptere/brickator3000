import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSParser } from '../parsers/tdsParser';
import type { PlacedBrick, EvaluationStep } from '../core/types';
import type { PlateLattice3D } from '../core/PlateLattice3D';
import { createCurvatureFeatureOverlay } from '../core/meshCurvature';

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

export type ViewportLayoutMode = 'split4' | 'voxel' | 'eval' | 'lego' | 'inspector' | 'mesh';

export class ViewportEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private modelRoot: THREE.Group;
  private bricksRoot: THREE.Group;
  private voxelRoot: THREE.Group;
  private evalRoot: THREE.Group;
  private inspectorRoot: THREE.Group;
  private currentViewMode: 'mesh' | 'lego' | 'both' = 'mesh';
  private currentLayoutMode: ViewportLayoutMode = 'lego';
  private currentLattice: PlateLattice3D | null = null;
  private currentBricks: PlacedBrick[] = [];
  private currentInspectionStep: EvaluationStep | null = null;
  private gridHelper!: THREE.GridHelper;
  private floorPlane!: THREE.Mesh;
  private animFrameId: number = 0;
  private isDisposed: boolean = false;
  private options: ViewportEngineOptions;
  private isSnappingActive: boolean = false;
  private lastTargetStuds: number = 16;
  private lastVerticalUnit: 'stud' | 'brick' = 'stud';

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

    // Voxel Space Container Root (Quadrant 1)
    this.voxelRoot = new THREE.Group();
    this.scene.add(this.voxelRoot);

    // Physical Candidate Evaluation Root (Quadrant 2)
    this.evalRoot = new THREE.Group();
    this.scene.add(this.evalRoot);

    // Step-by-Step Inspector Root (Quadrant 4)
    this.inspectorRoot = new THREE.Group();
    this.scene.add(this.inspectorRoot);

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

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    if (this.currentLayoutMode === 'split4') {
      const halfW = Math.floor(width / 2);
      const halfH = Math.floor(height / 2);

      this.renderer.setScissorTest(true);

      // Quadrant 1 (Top-Left): Source Mesh with Texture & Curvature/Feature Lines
      this.configureQuadrantVisibility('mesh');
      this.renderer.setViewport(0, halfH, halfW, halfH);
      this.renderer.setScissor(0, halfH, halfW, halfH);
      this.camera.aspect = halfW / halfH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      // Quadrant 2 (Top-Right): Physical Candidate Evaluation View
      this.configureQuadrantVisibility('eval');
      this.renderer.setViewport(halfW, halfH, halfW, halfH);
      this.renderer.setScissor(halfW, halfH, halfW, halfH);
      this.camera.aspect = halfW / halfH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      // Quadrant 3 (Bottom-Left): LEGO Assembly View
      this.configureQuadrantVisibility('lego');
      this.renderer.setViewport(0, 0, halfW, halfH);
      this.renderer.setScissor(0, 0, halfW, halfH);
      this.camera.aspect = halfW / halfH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      // Quadrant 4 (Bottom-Right): Step-by-Step Inspector View
      this.configureQuadrantVisibility('inspector');
      this.renderer.setViewport(halfW, 0, halfW, halfH);
      this.renderer.setScissor(halfW, 0, halfW, halfH);
      this.camera.aspect = halfW / halfH;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    } else {
      this.renderer.setScissorTest(false);
      this.configureQuadrantVisibility(this.currentLayoutMode);
      this.renderer.setViewport(0, 0, width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    }
  }

  private configureQuadrantVisibility(mode: ViewportLayoutMode): void {
    if (mode === 'voxel') {
      this.modelRoot.visible = (this.currentViewMode === 'both');
      this.voxelRoot.visible = true;
      this.evalRoot.visible = false;
      this.bricksRoot.visible = false;
      this.inspectorRoot.visible = false;
    } else if (mode === 'eval') {
      this.modelRoot.visible = false;
      this.voxelRoot.visible = true;
      this.evalRoot.visible = true;
      this.bricksRoot.visible = false;
      this.inspectorRoot.visible = false;
    } else if (mode === 'lego') {
      this.modelRoot.visible = (this.currentViewMode === 'both');
      this.voxelRoot.visible = false;
      this.evalRoot.visible = false;
      this.bricksRoot.visible = true;
      this.inspectorRoot.visible = false;
    } else if (mode === 'inspector') {
      this.modelRoot.visible = false;
      this.voxelRoot.visible = false;
      this.evalRoot.visible = false;
      this.bricksRoot.visible = true;
      this.inspectorRoot.visible = true;
    } else {
      this.modelRoot.visible = true;
      this.voxelRoot.visible = false;
      this.evalRoot.visible = false;
      this.bricksRoot.visible = false;
      this.inspectorRoot.visible = false;
    }
  }

  public clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
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
        vertexColors: geom.hasAttribute('color'),
        side: THREE.DoubleSide
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
        color: 0xffffff,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      loadedObject = new THREE.Mesh(geom, mat);
    } else if (fileType === 'procedural_torus') {
      const geom = new THREE.TorusKnotGeometry(3, 1, 128, 32);
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        roughness: 0.25,
        metalness: 0.2,
        side: THREE.DoubleSide
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
        vertexColors: geom.hasAttribute('color'),
        side: THREE.DoubleSide
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

        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach(m => {
            m.side = THREE.DoubleSide;
            m.transparent = false;
            m.opacity = 1.0;
            m.depthWrite = true;
          });
        }

        if (mesh.geometry) {
          const geo = mesh.geometry;
          if (!geo.attributes.normal) {
            geo.computeVertexNormals();
          }
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
    obj.updateMatrixWorld(true);

    // Add curvature & feature line overlay on the opaque model
    const overlay = createCurvatureFeatureOverlay(obj);
    obj.add(overlay);

    // Cache original bounding box and geometry positions for grid snapping
    const origBBox = new THREE.Box3().setFromObject(obj);
    obj.userData.origBBox = origBBox;

    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        if (m.geometry && m.geometry.attributes.position) {
          m.geometry.userData.originalPositions = m.geometry.attributes.position.clone();
        }
      }
    });

    this.modelRoot.add(obj);

    // Re-apply current view mode so the newly loaded mesh is properly visible
    this.setViewMode(this.currentViewMode);

    // If grid snapping is active, snap the newly loaded mesh
    if (this.isSnappingActive) {
      this.updateMeshSnapping(true, this.lastTargetStuds, this.lastVerticalUnit);
    }

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

  /**
   * Visually quantizes mesh vertices to the discrete plate/brick lattice grid.
   */
  public updateMeshSnapping(
    snap: boolean,
    targetStuds: number = 16,
    verticalUnit: 'stud' | 'brick' = 'stud'
  ): void {
    this.isSnappingActive = snap;
    this.lastTargetStuds = targetStuds;
    this.lastVerticalUnit = verticalUnit;

    const obj = this.getActiveModel();
    if (!obj) return;

    const bbox: THREE.Box3 = obj.userData.origBBox || new THREE.Box3().setFromObject(obj);
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeZ = bbox.max.z - bbox.min.z;
    const maxDim = Math.max(sizeX, sizeZ, 0.001);

    const worldStudPitch = maxDim / targetStuds;
    const worldPlatePitch = verticalUnit === 'brick' ? worldStudPitch * 1.2 : worldStudPitch * 0.4;

    obj.updateMatrixWorld(true);

    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geom = mesh.geometry;
        if (!geom || !geom.attributes.position) return;

        const origPosAttr = geom.userData.originalPositions as THREE.BufferAttribute | undefined;
        if (!origPosAttr) return;

        const posAttr = geom.attributes.position;
        const count = origPosAttr.count;

        if (!snap) {
          // Restore continuous smooth original coordinates
          if (posAttr instanceof THREE.BufferAttribute) {
            posAttr.copy(origPosAttr);
            posAttr.needsUpdate = true;
          }
          geom.computeVertexNormals();
          geom.computeBoundingBox();
          geom.computeBoundingSphere();
          return;
        }

        // Quantize coordinates to discrete LEGO grid pitch in world space
        const matrixWorld = mesh.matrixWorld;
        const invMatrix = new THREE.Matrix4().copy(matrixWorld).invert();
        const v = new THREE.Vector3();

        for (let i = 0; i < count; i++) {
          v.fromBufferAttribute(origPosAttr, i);
          v.applyMatrix4(matrixWorld);

          const sx = Math.round((v.x - bbox.min.x) / worldStudPitch) * worldStudPitch + bbox.min.x;
          const sz = Math.round((v.z - bbox.min.z) / worldStudPitch) * worldStudPitch + bbox.min.z;
          const sy = Math.round((v.y - bbox.min.y) / worldPlatePitch) * worldPlatePitch + bbox.min.y;

          v.set(sx, sy, sz);
          v.applyMatrix4(invMatrix);
          posAttr.setXYZ(i, v.x, v.y, v.z);
        }

        posAttr.needsUpdate = true;
        geom.computeVertexNormals();
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
      }
    });
  }

  public clearBricks(): void {
    this.clearGroup(this.bricksRoot);
    this.clearGroup(this.voxelRoot);
    this.clearGroup(this.evalRoot);
    this.clearGroup(this.inspectorRoot);
    this.currentBricks = [];
    this.currentLattice = null;
    this.currentInspectionStep = null;
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
   * Display placed LEGO bricks with high-performance THREE.InstancedMesh and exact bounding box alignment.
   */
  public displayDiscretizedBricks(bricks: PlacedBrick[], lattice: PlateLattice3D): void {
    this.clearBricks();
    this.currentLattice = lattice;
    this.currentBricks = bricks;

    // Build Q1 Voxel Space View
    this.displayVoxelSpace(lattice);

    // Build Q2 Physical Candidate Testing View
    this.displayCandidateEvaluation(lattice, bricks);

    if (bricks.length === 0) return;

    const group = new THREE.Group();

    // High quality shared ABS plastic material
    const plasticMat = new THREE.MeshPhysicalMaterial({
      roughness: 0.18,
      metalness: 0.02,
      clearcoat: 0.35,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide
    });

    // 1. Separate bricks by shape category
    const boxBricks: PlacedBrick[] = [];
    const cylinderBricks: PlacedBrick[] = [];
    const slopeCurvedBricks: PlacedBrick[] = [];
    const slope45Bricks: PlacedBrick[] = [];
    const cheeseSlopeBricks: PlacedBrick[] = [];
    const slopeInvertedBricks: PlacedBrick[] = [];

    // Build occupied cells set to eliminate covered studs
    const occupiedCells = new Set<string>();

    for (const b of bricks) {
      for (let dy = 0; dy < b.size[2]; dy++) {
        for (let dz = 0; dz < b.size[1]; dz++) {
          for (let dx = 0; dx < b.size[0]; dx++) {
            occupiedCells.add(`${b.gridPos[0] + dx},${b.gridPos[1] + dz},${b.gridPos[2] + dy}`);
          }
        }
      }

      const isCyl = b.category === 'ROUND_CANISTER' || b.category === 'ORGANIC_DOME' || b.category === 'TECHNIC_PIN' || b.partId === '98138' || b.partId === '6141';

      if (isCyl) {
        cylinderBricks.push(b);
      } else if (b.category === 'SLOPE_45') {
        slope45Bricks.push(b);
      } else if (b.category === 'CHEESE_SLOPE') {
        cheeseSlopeBricks.push(b);
      } else if (b.category === 'SLOPE_INVERTED') {
        slopeInvertedBricks.push(b);
      } else if (b.category === 'SLOPE_CURVED') {
        slopeCurvedBricks.push(b);
      } else {
        boxBricks.push(b);
      }
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const studPitch = lattice.worldStudPitch;
    const platePitch = lattice.worldPlatePitch;
    const gapH = Math.min(0.012, studPitch * 0.02);
    const gapV = Math.min(0.006, platePitch * 0.02);

    const renderInstanced = (
      brickList: PlacedBrick[],
      geometry: THREE.BufferGeometry,
      isBox: boolean = false
    ) => {
      if (brickList.length === 0) return;
      geometry.computeVertexNormals();
      const mesh = new THREE.InstancedMesh(geometry, plasticMat, brickList.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      for (let i = 0; i < brickList.length; i++) {
        const b = brickList[i];
        const [bw, bd, bh] = b.size;
        const [baseW, baseD, baseH] = b.baseSize;
        const [wx, wy, wz] = lattice.gridToWorld(b.gridPos[0] + bw / 2, b.gridPos[1] + bd / 2, b.gridPos[2] + bh / 2);

        dummy.position.set(wx, wy, wz);
        if (isBox) {
          dummy.rotation.set(0, 0, 0);
          const isTileInBrickMode = b.category === 'TILE_FLAT' && lattice.verticalUnit === 'brick';
          const heightScale = isTileInBrickMode ? Math.max(0.01, platePitch / 3 - gapV) : (bh * platePitch - gapV);
          if (isTileInBrickMode) {
            dummy.position.set(wx, wy - platePitch * (1 / 3), wz);
          }
          dummy.scale.set(bw * studPitch - gapH, heightScale, bd * studPitch - gapH);
        } else {
          dummy.rotation.set(0, -(b.rotation * Math.PI) / 180, 0);
          dummy.scale.set(baseW * studPitch - gapH, baseH * platePitch - gapV, baseD * studPitch - gapH);
        }
        dummy.updateMatrix();

        mesh.setMatrixAt(i, dummy.matrix);
        color.set(b.colorHex);
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    };

    // 2. Standard Box Bricks / Plates / Tiles
    const boxGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    renderInstanced(boxBricks, boxGeo, true);

    // 3. Cylinders / Round Canisters / Round Plates
    const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 24);
    renderInstanced(cylinderBricks, cylGeo, false);

    // 4. Modern Curved Slopes
    const sCurved = new THREE.Shape();
    sCurved.moveTo(-0.5, -0.5);
    sCurved.lineTo(0.5, -0.5);
    sCurved.lineTo(0.5, -0.167);
    sCurved.quadraticCurveTo(0.1, 0.45, -0.5, 0.5);
    sCurved.lineTo(-0.5, -0.5);
    const geoCurved = new THREE.ExtrudeGeometry(sCurved, { depth: 1.0, bevelEnabled: false });
    geoCurved.rotateY(-Math.PI / 2);
    geoCurved.center();
    renderInstanced(slopeCurvedBricks, geoCurved, false);

    // 5. Authentic 45° Flat Slopes (3040, 3039, 3037)
    const s45 = new THREE.Shape();
    s45.moveTo(-0.5, -0.5);
    s45.lineTo(0.5, -0.5);
    s45.lineTo(-0.5, 0.5);
    s45.lineTo(-0.5, -0.5);
    const geo45 = new THREE.ExtrudeGeometry(s45, { depth: 1.0, bevelEnabled: false });
    geo45.rotateY(-Math.PI / 2);
    geo45.center();
    renderInstanced(slope45Bricks, geo45, false);

    // 6. Authentic 31° Cheese Slopes (54200, 85984)
    const sCheese = new THREE.Shape();
    sCheese.moveTo(-0.5, -0.5);
    sCheese.lineTo(0.5, -0.5);
    sCheese.lineTo(0.5, -0.35);
    sCheese.lineTo(-0.5, 0.5);
    sCheese.lineTo(-0.5, -0.5);
    const geoCheese = new THREE.ExtrudeGeometry(sCheese, { depth: 1.0, bevelEnabled: false });
    geoCheese.rotateY(-Math.PI / 2);
    geoCheese.center();
    renderInstanced(cheeseSlopeBricks, geoCheese, false);

    // 7. Authentic Inverted Slopes (24201, 93273, 32803, 3665)
    const sInv = new THREE.Shape();
    sInv.moveTo(-0.5, 0.5);
    sInv.lineTo(0.5, 0.5);
    sInv.lineTo(0.5, 0.167);
    sInv.lineTo(-0.5, -0.5);
    sInv.lineTo(-0.5, 0.5);
    const geoInv = new THREE.ExtrudeGeometry(sInv, { depth: 1.0, bevelEnabled: false });
    geoInv.rotateY(-Math.PI / 2);
    geoInv.center();
    renderInstanced(slopeInvertedBricks, geoInv, false);

    // 8. Unified Instanced Mesh for Exposed Top Studs (Covered studs omitted!)
    const studRadius = studPitch * 0.24;
    const studHeight = studPitch * 0.18;
    const studGeo = new THREE.CylinderGeometry(studRadius, studRadius, studHeight, 16);
    studGeo.computeVertexNormals();

    interface VisibleStud {
      pos: [number, number, number];
      colorHex: string;
    }
    const visibleStuds: VisibleStud[] = [];

    for (const b of bricks) {
      const isSmooth =
        b.category === 'TILE_FLAT' ||
        b.category === 'SLOPE_CURVED' ||
        b.category === 'CHEESE_SLOPE' ||
        b.category === 'SLOPE_45' ||
        b.category === 'ORGANIC_DOME' ||
        b.category === 'TECHNIC_BEAM' ||
        b.category === 'TECHNIC_AXLE' ||
        b.partId === '98138' ||
        b.partId === '14769';
      if (isSmooth) continue;

      const topGy = b.gridPos[2] + b.size[2];

      for (let sx = 0; sx < b.size[0]; sx++) {
        for (let sz = 0; sz < b.size[1]; sz++) {
          const gx = b.gridPos[0] + sx;
          const gz = b.gridPos[1] + sz;

          // Check if covered by another brick above
          if (occupiedCells.has(`${gx},${gz},${topGy}`)) {
            continue; // Stud is covered by upper brick!
          }

          const [sxW, syW, szW] = lattice.gridToWorld(gx + 0.5, gz + 0.5, topGy);
          visibleStuds.push({
            pos: [sxW, syW + studHeight * 0.5, szW],
            colorHex: b.colorHex
          });
        }
      }
    }

    if (visibleStuds.length > 0) {
      const studMesh = new THREE.InstancedMesh(studGeo, plasticMat, visibleStuds.length);
      studMesh.castShadow = true;
      studMesh.receiveShadow = true;

      for (let i = 0; i < visibleStuds.length; i++) {
        const s = visibleStuds[i];
        dummy.position.set(s.pos[0], s.pos[1], s.pos[2]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1.0, 1.0, 1.0);
        dummy.updateMatrix();

        studMesh.setMatrixAt(i, dummy.matrix);
        color.set(s.colorHex);
        studMesh.setColorAt(i, color);
      }

      studMesh.instanceMatrix.needsUpdate = true;
      if (studMesh.instanceColor) studMesh.instanceColor.needsUpdate = true;
      group.add(studMesh);
    }

    this.bricksRoot.add(group);
    this.setViewMode('lego');
    this.setLayoutMode('split4');
  }

  public setLayoutMode(mode: ViewportLayoutMode): void {
    this.currentLayoutMode = mode;
  }

  public getLayoutMode(): ViewportLayoutMode {
    return this.currentLayoutMode;
  }

  public getCurrentLattice(): PlateLattice3D | null {
    return this.currentLattice;
  }

  public displayVoxelSpace(lattice: PlateLattice3D): void {
    this.currentLattice = lattice;
    this.clearGroup(this.voxelRoot);

    const b = lattice.bounds;
    const occupiedVoxels: { x: number; z: number; y: number; colorHex: string }[] = [];

    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          const v = lattice.getVoxel(x, z, y);
          if (v && v.occupied) {
            occupiedVoxels.push({ x, z, y, colorHex: v.colorHex });
          }
        }
      }
    }

    if (occupiedVoxels.length === 0) return;

    const studPitch = lattice.worldStudPitch;
    const platePitch = lattice.worldPlatePitch;
    const boxGeo = new THREE.BoxGeometry(studPitch * 0.92, platePitch * 0.92, studPitch * 0.92);
    const voxelMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.InstancedMesh(boxGeo, voxelMat, occupiedVoxels.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < occupiedVoxels.length; i++) {
      const v = occupiedVoxels[i];
      const [wx, wy, wz] = lattice.gridToWorld(v.x + 0.5, v.z + 0.5, v.y + 0.5);
      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      mesh.setMatrixAt(i, dummy.matrix);
      color.set(v.colorHex);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.voxelRoot.add(mesh);
  }

  public displayCandidateEvaluation(lattice: PlateLattice3D, bricks: PlacedBrick[]): void {
    this.clearGroup(this.evalRoot);

    const studPitch = lattice.worldStudPitch;
    const platePitch = lattice.worldPlatePitch;

    // Visualizes bounding boxes of placed and candidate pieces
    for (let i = 0; i < Math.min(bricks.length, 160); i++) {
      const b = bricks[i];
      const [bw, bd, bh] = b.size;
      const [wx, wy, wz] = lattice.gridToWorld(b.gridPos[0] + bw / 2, b.gridPos[1] + bd / 2, b.gridPos[2] + bh / 2);

      const boxGeo = new THREE.BoxGeometry(bw * studPitch, bh * platePitch, bd * studPitch);
      const edges = new THREE.EdgesGeometry(boxGeo);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.6 }));
      line.position.set(wx, wy, wz);
      this.evalRoot.add(line);
    }
  }

  public setInspectionStep(step: EvaluationStep | null): void {
    this.currentInspectionStep = step;
    this.clearGroup(this.inspectorRoot);

    if (!step || !this.currentLattice) return;
    const lattice = this.currentLattice;
    const studPitch = lattice.worldStudPitch;
    const platePitch = lattice.worldPlatePitch;

    const [bw, bd, bh] = step.size;
    const [wx, wy, wz] = lattice.gridToWorld(step.gridPos[0] + bw / 2, step.gridPos[1] + bd / 2, step.gridPos[2] + bh / 2);

    // 1. Candidate Wireframe Bounding Box Gizmo
    const boxGeo = new THREE.BoxGeometry(bw * studPitch, bh * platePitch, bd * studPitch);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const boxColor = step.status === 'ACCEPTED' ? 0x22c55e : (step.status === 'REJECTED' ? 0xef4444 : 0xf59e0b);
    const boxLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: boxColor, linewidth: 3 }));
    boxLines.position.set(wx, wy, wz);
    this.inspectorRoot.add(boxLines);

    // 2. Candidate Part 3D Volume Gizmo
    const partMat = new THREE.MeshPhysicalMaterial({
      color: step.status === 'ACCEPTED' ? 0x2563eb : (step.status === 'REJECTED' ? 0xef4444 : 0xf59e0b),
      transparent: true,
      opacity: 0.75,
      roughness: 0.2,
      emissive: step.status === 'ACCEPTED' ? 0x1d4ed8 : 0x000000,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide
    });

    const candidateMesh = new THREE.Mesh(boxGeo, partMat);
    candidateMesh.position.set(wx, wy, wz);
    this.inspectorRoot.add(candidateMesh);

    // 3. 3D Coordinate Orientation Arrows Gizmo
    const axes = new THREE.AxesHelper(Math.max(bw, bd, bh) * studPitch * 0.9);
    axes.position.set(wx, wy, wz);
    this.inspectorRoot.add(axes);

    // 4. Highlighted Target Voxels
    if (step.targetVoxels && step.targetVoxels.length > 0) {
      const matchGeo = new THREE.BoxGeometry(studPitch * 0.88, platePitch * 0.88, studPitch * 0.88);
      const matchMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.85,
        emissive: 0x15803d,
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide
      });

      const airMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.75,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide
      });

      for (const tv of step.targetVoxels) {
        const [tvX, tvY, tvZ] = lattice.gridToWorld(tv.pos[0] + 0.5, tv.pos[1] + 0.5, tv.pos[2] + 0.5);
        if (tv.status === 'MATCH') {
          const mMesh = new THREE.Mesh(matchGeo, matchMat);
          mMesh.position.set(tvX, tvY, tvZ);
          this.inspectorRoot.add(mMesh);
        } else if (tv.status === 'AIR') {
          const aMesh = new THREE.Mesh(matchGeo, airMat);
          aMesh.position.set(tvX, tvY, tvZ);
          this.inspectorRoot.add(aMesh);
        } else if (tv.status === 'COLLISION') {
          const cEdges = new THREE.EdgesGeometry(matchGeo);
          const cLines = new THREE.LineSegments(cEdges, new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 2 }));
          cLines.position.set(tvX, tvY, tvZ);
          this.inspectorRoot.add(cLines);
        }
      }
    }
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
