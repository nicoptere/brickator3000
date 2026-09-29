import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { getAssetUrl } from '../url';

export interface StudioOptions {
  maxSamples: number;
  usePathTracing: boolean;
  onSampleProgress?: (current: number, max: number) => void;
  onModelLoaded?: () => void;
}

export class PathTracerStudioEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private pathTracer: WebGLPathTracer | null = null;
  private controls: OrbitControls;
  private ldrawLoader: LDrawLoader;
  private modelRoot: THREE.Group;
  private studioLights: THREE.Group;
  private floorPlane: THREE.Mesh;

  private isRunning: boolean = true;
  private animFrameId: number = 0;
  private currentSamples: number = 0;
  private maxSamples: number = 512;
  private usePathTracing: boolean = true;
  private onSampleProgress?: (current: number, max: number) => void;
  private onModelLoaded?: () => void;
  private isDisposed: boolean = false;

  constructor(container: HTMLElement, options?: Partial<StudioOptions>) {
    this.container = container;
    this.maxSamples = options?.maxSamples ?? 512;
    this.usePathTracing = options?.usePathTracing ?? true;
    this.onSampleProgress = options?.onSampleProgress;
    this.onModelLoaded = options?.onModelLoaded;

    // 1. Scene & Hierarchy
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12161f);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // 2. Camera Setup
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 5000);
    this.camera.position.set(120, 90, 140);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    // 4. Studio Environment & Canonical 3-Point Lighting
    this.studioLights = new THREE.Group();
    this.scene.add(this.studioLights);

    // Canonical Key Light (Warm softbox, high intensity)
    const keyLight = new THREE.DirectionalLight(0xfffaed, 2.5);
    keyLight.position.set(150, 200, 100);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0001;
    this.studioLights.add(keyLight);

    // Canonical Fill Light (Cool diffuse light)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.2);
    fillLight.position.set(-150, 120, 80);
    this.studioLights.add(fillLight);

    // Canonical Rim / Kicker Light (Silhouette & bevel separation from rear)
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(0, 160, -180);
    this.studioLights.add(rimLight);

    // Subtle ambient bounce
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.studioLights.add(ambientLight);

    // Studio Horizon Floor Plane
    const floorGeo = new THREE.PlaneGeometry(2000, 2000);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x181e2b,
      roughness: 0.35,
      metalness: 0.05
    });
    this.floorPlane = new THREE.Mesh(floorGeo, floorMat);
    this.floorPlane.rotation.x = -Math.PI / 2;
    this.floorPlane.position.y = 0;
    this.floorPlane.receiveShadow = true;
    this.scene.add(this.floorPlane);

    // 5. Studio Gradient Environment for glossy reflections
    try {
      const gradientTex = new GradientEquirectTexture();
      gradientTex.topColor.set(0x2d3748);
      gradientTex.bottomColor.set(0x0f172a);
      gradientTex.update();
      this.scene.environment = gradientTex;
    } catch (e) {
      console.warn('GradientEquirectTexture fallback:', e);
    }

    // 6. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 20, 0);

    // Reset path tracing on camera movement
    this.controls.addEventListener('change', () => {
      this.resetPathTracer();
    });

    // 7. Path Tracer Initialization
    this.initPathTracer();

    // 8. LDraw Loader Configuration
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url: string) => {
      let cleanUrl = url.replace(/\\|%5c/gi, '/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/parts\//gi, '/ldraw/parts/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/p\//gi, '/ldraw/p/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/models\//gi, '/ldraw/parts/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(p|models)?\/?s\//gi, '/ldraw/parts/s/');
      while (/\/ldraw\/parts\/parts\//i.test(cleanUrl)) {
        cleanUrl = cleanUrl.replace(/\/ldraw\/parts\/parts\//gi, '/ldraw/parts/');
      }
      cleanUrl = cleanUrl.replace(/\/ldraw\/parts\/(8|48)\//i, '/ldraw/p/$1/');

      const match = cleanUrl.match(/\/ldraw\/parts\/([^\/]+)$/i);
      if (match) {
        const fname = match[1].toLowerCase();
        if (/^(\d+-\d+|stud|box|rect|disc|cyli|ring|peghol|npeghol|axle|edge|chrd|circle|cone|tang|clip|clh|stug|wpin|conn|r0|t0|u0)/i.test(fname)) {
          cleanUrl = cleanUrl.replace(/\/ldraw\/parts\//i, '/ldraw/p/');
        }
      }

      const partsMatch = cleanUrl.match(/\/ldraw\/(parts|p)\/(.*)$/i);
      if (partsMatch) {
        const base = cleanUrl.substring(0, cleanUrl.indexOf('/ldraw/'));
        cleanUrl = `${base}/ldraw/${partsMatch[1].toLowerCase()}/${partsMatch[2].toLowerCase()}`;
      }
      return cleanUrl;
    });

    this.ldrawLoader = new LDrawLoader(loadingManager);
    (this.ldrawLoader as any).setPartsLibraryPath(getAssetUrl('ldraw/'));
    (this.ldrawLoader as any).setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.ldrawLoader.smoothNormals = true;

    // Preload LDConfig materials
    this.ldrawLoader.preloadMaterials(getAssetUrl('ldraw/LDConfig.ldr')).catch(err => {
      console.warn('LDraw LDConfig preload failed:', err);
    });

    // 9. Resize Listener & Animation Loop
    window.addEventListener('resize', this.handleResize);
    this.startLoop();
  }

  private initPathTracer() {
    try {
      this.pathTracer = new WebGLPathTracer(this.renderer);
      // Fix upstream three-gpu-pathtracer typo where dispose() accesses this._renderQuad instead of this._quad
      if (!(this.pathTracer as any)._renderQuad && (this.pathTracer as any)._quad) {
        (this.pathTracer as any)._renderQuad = (this.pathTracer as any)._quad;
      }
      this.pathTracer.bounces = 4;
      this.pathTracer.filterGlossyFactor = 0.5;
      this.pathTracer.tiles.set(1, 1);
      this.pathTracer.setScene(this.scene, this.camera);
    } catch (err) {
      console.warn('three-gpu-pathtracer initialization failed, falling back to WebGL:', err);
      this.pathTracer = null;
      this.usePathTracing = false;
    }
  }

  public resetPathTracer() {
    this.currentSamples = 0;
    if (this.pathTracer) {
      this.pathTracer.reset();
    }
  }

  public setUsePathTracing(enabled: boolean) {
    this.usePathTracing = enabled && !!this.pathTracer;
    this.resetPathTracer();
  }

  public setMaxSamples(max: number) {
    this.maxSamples = Math.max(1, max);
    this.resetPathTracer();
  }

  /**
   * Loads an LDraw (.ldr) text model into the studio scene
   */
  public async loadLdrContent(ldrText: string): Promise<void> {
    while (this.modelRoot.children.length > 0) {
      const child = this.modelRoot.children[0];
      this.modelRoot.remove(child);
    }

    try {
      const group = await new Promise<THREE.Group>((resolve, reject) => {
        (this.ldrawLoader as any).parse(
          ldrText,
          (parsedGroup: THREE.Group) => resolve(parsedGroup),
          (err: any) => reject(err)
        );
      });

      // Enhance materials for realistic ABS plastic (glossy reflection, subtle clearcoat)
      group.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const mesh = c as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of materials) {
            if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              stdMat.roughness = 0.18; // Glossy ABS plastic
              stdMat.metalness = 0.0;
              (stdMat as any).clearcoat = 0.35;
              (stdMat as any).clearcoatRoughness = 0.1;
            }
          }
        }
      });

      // Center the model and place firmly on floor plane
      const bbox = new THREE.Box3().setFromObject(group);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      // Offset so bottom sits at y=0, centered at (0,0) in X/Z
      group.position.x = -center.x;
      group.position.z = -center.z;
      group.position.y = -bbox.min.y;

      this.modelRoot.add(group);

      // Fit camera nicely around the model
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      this.camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.8);
      this.controls.target.set(0, size.y * 0.45, 0);
      this.controls.update();

      // Update path tracer scene
      if (this.pathTracer) {
        this.pathTracer.setScene(this.scene, this.camera);
        this.resetPathTracer();
      }

      this.onModelLoaded?.();
    } catch (err) {
      console.error('Failed to parse LDraw model in studio:', err);
      throw err;
    }
  }

  /**
   * Loads a raw 3D mesh / geometry directly into the studio scene for preview
   */
  public loadGeometryPreview(geometry: THREE.BufferGeometry, materialColor: number = 0xf2cd37): void {
    while (this.modelRoot.children.length > 0) {
      this.modelRoot.remove(this.modelRoot.children[0]);
    }

    const hasVertexColors = geometry.hasAttribute('color');
    const mat = new THREE.MeshStandardMaterial({
      color: hasVertexColors ? 0xffffff : materialColor,
      vertexColors: hasVertexColors,
      roughness: 0.25,
      metalness: 0.05
    });

    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox || new THREE.Box3();
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    mesh.position.x = -center.x;
    mesh.position.z = -center.z;
    mesh.position.y = -bbox.min.y;

    this.modelRoot.add(mesh);

    const maxDim = Math.max(size.x, size.y, size.z, 20);
    this.camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.8);
    this.controls.target.set(0, size.y * 0.45, 0);
    this.controls.update();

    if (this.pathTracer) {
      this.pathTracer.setScene(this.scene, this.camera);
      this.resetPathTracer();
    }

    this.onModelLoaded?.();
  }

  private startLoop() {
    const loop = () => {
      if (this.isDisposed) return;
      this.animFrameId = requestAnimationFrame(loop);

      this.controls.update();

      if (this.usePathTracing && this.pathTracer) {
        if (this.currentSamples < this.maxSamples) {
          this.pathTracer.renderSample();
          this.currentSamples = this.pathTracer.samples;
          this.onSampleProgress?.(this.currentSamples, this.maxSamples);
        }
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  private handleResize = () => {
    if (!this.container || this.isDisposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    if (this.pathTracer) {
      this.pathTracer.setScene(this.scene, this.camera);
      this.resetPathTracer();
    }
  };

  public resize() {
    this.handleResize();
  }

  public dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);

    try {
      this.controls.dispose();
    } catch (_) {}

    try {
      this.renderer.dispose();
    } catch (_) {}

    if (this.pathTracer) {
      try {
        if (!(this.pathTracer as any)._renderQuad && (this.pathTracer as any)._quad) {
          (this.pathTracer as any)._renderQuad = (this.pathTracer as any)._quad;
        }
        this.pathTracer.dispose();
      } catch (err) {
        console.warn('three-gpu-pathtracer dispose warning ignored:', err);
      }
      this.pathTracer = null;
    }

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
