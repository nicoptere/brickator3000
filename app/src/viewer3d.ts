import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { getAssetUrl } from './url';

export class Viewer3D {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private ldrawLoader: LDrawLoader;
  private modelRoot: THREE.Group;
  private currentLoadId: number = 0;
  private animId: number = 0;
  private materialsPromise: Promise<void> | null = null;
  private cachedMaterials: any[] = [];
  private isPaused: boolean = false;
  private isContextLost: boolean = false;
  private lastLoadedPartId: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene & Model Root
    this.scene = new THREE.Scene();
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // Camera
    const aspect = container.clientWidth / (container.clientHeight || 1);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 3000);
    this.camera.position.set(60, 50, 70);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    // Handle WebGL context loss gracefully (e.g. during heavy SAHI inference)
    this.renderer.domElement.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault(); // REQUIRED: tells browser context can be restored
      console.warn('⚠️ WebGL context lost in 3D viewer. Pausing rendering...');
      this.isContextLost = true;
    }, false);

    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('✓ WebGL context restored in 3D viewer. Restoring 3D model...');
      this.isContextLost = false;
      if (this.lastLoadedPartId) {
        this.loadModel(this.lastLoadedPartId);
      }
    }, false);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.0;

    // Prevent tap and double-tap on WebGL canvas, allowing only drag/pan
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    this.renderer.domElement.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      e.stopPropagation();
    });

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
    this.scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(100, 150, 100);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight2.position.set(-100, 80, -100);
    this.scene.add(dirLight2);

    // LDraw Loader with URL rewriting to prevent 404s on primitives, subparts & duplicate paths
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url: string) => {
      // 1. Normalize any Windows backslashes in LDraw subobject paths
      let cleanUrl = url.replace(/\\|%5c/gi, '/');

      // 2. Collapse duplicate folder prefixes introduced by Three.js LDrawLoader relative path resolution:
      // e.g. /ldraw/parts/parts/s/... -> /ldraw/parts/s/...
      //      /ldraw/p/parts/s/...     -> /ldraw/parts/s/...
      //      /ldraw/models/parts/s/...-> /ldraw/parts/s/...
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/parts\//gi, '/ldraw/parts/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/p\//gi, '/ldraw/p/');
      cleanUrl = cleanUrl.replace(/\/ldraw\/(parts|p|models)\/models\//gi, '/ldraw/parts/');

      // If LDrawLoader attempts to look for subparts in /ldraw/p/s/ or /ldraw/models/s/ or /ldraw/s/, route to /ldraw/parts/s/
      cleanUrl = cleanUrl.replace(/\/ldraw\/(p|models)?\/?s\//gi, '/ldraw/parts/s/');

      // Handle any repeated /parts/parts/ prefix
      while (/\/ldraw\/parts\/parts\//i.test(cleanUrl)) {
        cleanUrl = cleanUrl.replace(/\/ldraw\/parts\/parts\//gi, '/ldraw/parts/');
      }

      // 3. If Three.js tries /ldraw/parts/8/ or /ldraw/parts/48/ for primitives, route to /ldraw/p/
      cleanUrl = cleanUrl.replace(/\/ldraw\/parts\/(8|48)\//i, '/ldraw/p/$1/');

      // 4. If Three.js attempts to look in /parts/ for an LDraw primitive, route directly to /p/
      const match = cleanUrl.match(/\/ldraw\/parts\/([^\/]+)$/i);
      if (match) {
        const fname = match[1].toLowerCase();
        if (/^(\d+-\d+|stud|box|rect|disc|cyli|ring|peghol|npeghol|axle|edge|chrd|circle|cone|tang|clip|clh|stug|wpin|conn|r0|t0|u0)/i.test(fname)) {
          cleanUrl = cleanUrl.replace(/\/ldraw\/parts\//i, '/ldraw/p/');
        }
      }

      // 5. Lowercase LDraw file paths to ensure compatibility with case-sensitive Linux web servers
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

    // Cache preloaded materials permanently so load() doesn't wipe them
    this.materialsPromise = this.ldrawLoader.preloadMaterials(getAssetUrl('ldraw/LDConfig.ldr')).then(() => {
      if (Array.isArray((this.ldrawLoader as any).materials)) {
        this.cachedMaterials = [...(this.ldrawLoader as any).materials];
      }
    }).catch(err => {
      console.warn('Could not preload LDConfig.ldr materials:', err);
    });

    window.addEventListener('resize', this.resize.bind(this));
    this.animate();
  }

  public attachTo(newContainer: HTMLElement) {
    if (!newContainer) return;
    this.container = newContainer;
    if (this.renderer.domElement.parentElement !== newContainer) {
      if (this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
      newContainer.appendChild(this.renderer.domElement);
    }
    this.resume();
  }

  public detach() {
    this.pause();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
    this.resize();
  }

  public resize() {
    if (!this.container || !this.container.isConnected) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  public clearModel() {
    this.currentLoadId++;
    while (this.modelRoot.children.length > 0) {
      const child = this.modelRoot.children[0];
      this.modelRoot.remove(child);
      child.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        // IMPORTANT: Never dispose shared materials from LDConfig.ldr / LDrawLoader!
        // Doing so destroys the WebGL programs for all parts sharing those colors.
        // Only dispose dynamic ad-hoc materials.
        if (obj.material && (obj.material as any).userData?.isDynamicFallback) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: any) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
  }

  public async loadModel(partId: string): Promise<boolean> {
    this.clearModel();
    const loadId = this.currentLoadId;
    this.lastLoadedPartId = partId;

    if (this.materialsPromise) await this.materialsPromise;
    if (this.cachedMaterials.length > 0) {
      (this.ldrawLoader as any).setMaterials(this.cachedMaterials);
    }

    const cleanId = String(partId || '').trim()
      .replace(/^parts\//i, '')
      .replace(/^p\//i, '')
      .replace(/\.dat$/i, '');

    const candidates = [
      getAssetUrl(`ldraw/parts/${cleanId}.dat`),
      getAssetUrl(`ldraw/parts/${cleanId.toLowerCase()}.dat`),
      getAssetUrl(`ldraw/p/${cleanId}.dat`),
      getAssetUrl(`ldraw/p/${cleanId.toLowerCase()}.dat`),
    ];

    const baseMatch = cleanId.match(/^(\d+)/);
    if (baseMatch && baseMatch[1] !== cleanId) {
      candidates.push(
        getAssetUrl(`ldraw/parts/${baseMatch[1]}.dat`),
        getAssetUrl(`ldraw/parts/${baseMatch[1].toLowerCase()}.dat`)
      );
    }

    let ldrText: string | null = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          ldrText = await res.text();
          break;
        }
      } catch (_) {}
    }

    if (!ldrText) {
      console.warn(`Could not fetch LDraw model text for part: ${partId}`);
      return false;
    }

    let group: THREE.Group | null = null;
    try {
      group = await new Promise<THREE.Group>((resolve, reject) => {
        (this.ldrawLoader as any).parse(
          ldrText,
          (parsedGroup: THREE.Group) => resolve(parsedGroup),
          (err: any) => reject(err)
        );
      });
    } catch (err) {
      console.warn(`Could not parse LDraw model for ${partId}:`, err);
      return false;
    }

    // If another model load request started while this one was downloading, discard this group
    if (this.currentLoadId !== loadId) {
      if (group) {
        group.traverse((obj: any) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material && (obj.material as any).userData?.isDynamicFallback) {
            if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
            else obj.material.dispose();
          }
        });
      }
      return false;
    }

    if (!group) return false;

    try {
      // Ensure any leftover children are cleared
      while (this.modelRoot.children.length > 0) {
        this.modelRoot.remove(this.modelRoot.children[0]);
      }

      // Sanitize all children so no mesh/line has invalid material
      group.traverse((child: any) => {
        if (child.isMesh) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m: any) => {
              if (m && m.isMaterial) return m;
              const fallback = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                roughness: 0.3,
                metalness: 0.1
              });
              fallback.userData = { isDynamicFallback: true };
              return fallback;
            });
          } else if (!child.material || !child.material.isMaterial) {
            const fallback = new THREE.MeshStandardMaterial({
              color: 0xcccccc,
              roughness: 0.3,
              metalness: 0.1
            });
            fallback.userData = { isDynamicFallback: true };
            child.material = fallback;
          }
        }
        if (child.isLineSegments) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m: any) => {
              if (m && m.isMaterial) return m;
              const fallback = new THREE.LineBasicMaterial({ color: 0x333333 });
              fallback.userData = { isDynamicFallback: true };
              return fallback;
            });
          } else if (!child.material || !child.material.isMaterial) {
            const fallback = new THREE.LineBasicMaterial({ color: 0x333333 });
            fallback.userData = { isDynamicFallback: true };
            child.material = fallback;
          }
        }
      });

      group.rotation.x = Math.PI; // LDraw inversion
      group.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 20);

      group.position.sub(center);
      this.modelRoot.add(group);

      // Adjust camera distance to fit piece nicely
      const dist = maxDim * 2.2;
      this.camera.position.set(dist * 0.7, dist * 0.6, dist * 0.7);
      this.camera.lookAt(0, 0, 0);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.resize();
      return true;
    } catch (err) {
      console.warn(`Could not render LDraw 3D model for ${partId}:`, err);
      return false;
    }
  }

  public async loadLDrawText(ldrText: string): Promise<boolean> {
    this.clearModel();
    const loadId = this.currentLoadId;

    if (this.materialsPromise) await this.materialsPromise;
    if (this.cachedMaterials.length > 0) {
      (this.ldrawLoader as any).setMaterials(this.cachedMaterials);
    }

    try {
      const group = await new Promise<THREE.Group>((resolve, reject) => {
        (this.ldrawLoader as any).parse(
          ldrText,
          (parsedGroup: THREE.Group) => resolve(parsedGroup),
          (err: any) => reject(err)
        );
      });

      if (this.currentLoadId !== loadId || !group || !(group instanceof THREE.Object3D)) return false;

      while (this.modelRoot.children.length > 0) {
        this.modelRoot.remove(this.modelRoot.children[0]);
      }

      // Sanitize all children so no mesh/line has material == null
      group.traverse((child: any) => {
        if (child.isMesh && (!child.material || child.material === null)) {
          const fallback = new THREE.MeshStandardMaterial({
            color: 0xe02424,
            roughness: 0.3,
            metalness: 0.1
          });
          fallback.userData = { isDynamicFallback: true };
          child.material = fallback;
        }
        if (child.isLineSegments && (!child.material || child.material === null)) {
          const fallback = new THREE.LineBasicMaterial({ color: 0x333333 });
          fallback.userData = { isDynamicFallback: true };
          child.material = fallback;
        }
      });

      group.rotation.x = Math.PI;
      group.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 20);

      group.position.sub(center);
      this.modelRoot.add(group);

      const dist = maxDim * 2.2;
      this.camera.position.set(dist * 0.7, dist * 0.6, dist * 0.7);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.resize();
      return true;
    } catch (err) {
      console.warn('Could not parse LDraw model string:', err);
      return false;
    }
  }

  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    if (this.isPaused || this.isContextLost) return;
    if (!this.container || !this.container.isConnected) return;

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) {
      const curW = this.renderer.domElement.clientWidth;
      const curH = this.renderer.domElement.clientHeight;
      if (Math.abs(curW - w) > 2 || Math.abs(curH - h) > 2) {
        this.resize();
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  public destroy() {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
    if (this.container && this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
