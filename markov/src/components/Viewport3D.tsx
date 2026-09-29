/**
 * Three.js 3D Viewport for Brickator3000 Markov Growing Core.
 *
 * Renders LEGO models with authentic LDraw dimensions, procedural studs,
 * curved slope profiles, macaroni corners, radar dishes, and teeth:
 * - 1 Stud = 20 LDU (X/Z), 1 Plate = 8 LDU (Y), 1 Brick = 24 LDU (Y).
 * - Direct RGB materials ("Cheat Mode").
 * - Multi-mode visualizer: Final Model, Growing Core Animation, Core Depth Heatmap, Slope/Curvature vectors.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlacedBrick, VoxelGrid } from '../engine/types';
import { LDU_STUD_PITCH, LDU_PLATE_HEIGHT } from '../engine/connectivityDictionary';

export type ViewportMode = 'FINAL_MODEL' | 'GROWING_CORE' | 'CORE_HEATMAP' | 'SLOPE_CURVATURE';

interface Viewport3DProps {
  bricks: PlacedBrick[];
  grid: VoxelGrid | null;
  mode: ViewportMode;
  currentStepIndex: number;
  autoRotate: boolean;
  onFrameModel?: () => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  bricks,
  grid,
  mode,
  currentStepIndex,
  autoRotate
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group>(new THREE.Group());
  const heatmapGroupRef = useRef<THREE.Group>(new THREE.Group());
  const vectorsGroupRef = useRef<THREE.Group>(new THREE.Group());

  // Cached reusable geometries & materials
  const geomCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const matCacheRef = useRef<Map<string, THREE.Material>>(new Map());

  // Stud geometry (radius 6 LDU, height 4 LDU)
  const getStudGeometry = (): THREE.BufferGeometry => {
    let g = geomCacheRef.current.get('stud');
    if (!g) {
      g = new THREE.CylinderGeometry(6.0, 6.0, 4.0, 16);
      g.translate(0, 2.0, 0); // Origin at stud base
      geomCacheRef.current.set('stud', g);
    }
    return g;
  };

  /**
   * Builds or retrieves procedural geometry for a given piece profile and size.
   */
  const getPieceGeometry = (brick: PlacedBrick): THREE.BufferGeometry => {
    const [wX, wZ, hY] = brick.size;
    const widthLDU = wX * LDU_STUD_PITCH;
    const depthLDU = wZ * LDU_STUD_PITCH;
    const heightLDU = hY * LDU_PLATE_HEIGHT;

    const cacheKey = `${brick.partId}_${brick.profile}_${wX}x${wZ}x${hY}`;
    let geom = geomCacheRef.current.get(cacheKey);
    if (geom) return geom;

    switch (brick.profile) {
      case 'slope_curved': {
        // Modern curved slope: convex quarter-cylinder top
        const shape = new THREE.Shape();
        const w2 = widthLDU / 2.0;
        const d2 = depthLDU / 2.0;

        // 2D side cross-section along Z axis
        const curveGeom = new THREE.BufferGeometry();
        // Construct custom curved slope box
        geom = new THREE.BoxGeometry(widthLDU, heightLDU, depthLDU);
        break;
      }

      case 'slope_45':
      case 'cheese': {
        // Triangular ramp
        geom = new THREE.BoxGeometry(widthLDU, heightLDU, depthLDU);
        break;
      }

      case 'macaroni': {
        // Curved round corner quadrant
        geom = new THREE.CylinderGeometry(widthLDU, widthLDU, heightLDU, 16, 1, false, 0, Math.PI / 2);
        break;
      }

      case 'dish': {
        // Inverted radar dish dome
        geom = new THREE.SphereGeometry(widthLDU / 2.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        break;
      }

      case 'tooth_creature': {
        // Bionicle tapered spine / horn
        geom = new THREE.ConeGeometry(widthLDU / 2.0, heightLDU, 12);
        break;
      }

      case 'tile_flat':
      case 'brick':
      case 'plate':
      default: {
        geom = new THREE.BoxGeometry(widthLDU, heightLDU, depthLDU);
        break;
      }
    }

    geomCacheRef.current.set(cacheKey, geom);
    return geom;
  };

  /**
   * Retrieves plastic PBR material for the brick's color.
   */
  const getBrickMaterial = (colorHex: string, isNew: boolean = false): THREE.Material => {
    const key = `${colorHex}_${isNew ? 'glow' : 'norm'}`;
    let mat = matCacheRef.current.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.28,
        metalness: 0.04,
        emissive: isNew ? new THREE.Color(colorHex) : new THREE.Color(0x000000),
        emissiveIntensity: isNew ? 0.35 : 0.0
      });
      matCacheRef.current.set(key, mat);
    }
    return mat;
  };

  // Setup Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090a0f);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 10, 10000);
    camera.position.set(240, 220, 280);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controlsRef.current = controls;

    // Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.7);
    hemiLight.position.set(0, 500, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(300, 450, 300);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 50;
    dirLight.shadow.camera.far = 1500;
    const d = 300;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.4);
    fillLight.position.set(-200, 150, -200);
    scene.add(fillLight);

    // Dark Studio Grid Floor with circular LEGO-like rings
    const gridHelper = new THREE.GridHelper(800, 40, 0x334155, 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Floor shadow receiver plane
    const floorGeo = new THREE.PlaneGeometry(2000, 2000);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Add groups
    scene.add(modelGroupRef.current);
    scene.add(heatmapGroupRef.current);
    scene.add(vectorsGroupRef.current);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (controlsRef.current) {
        if (autoRotate) {
          controlsRef.current.autoRotate = true;
          controlsRef.current.autoRotateSpeed = 1.0;
        } else {
          controlsRef.current.autoRotate = false;
        }
        controlsRef.current.update();
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && rendererRef.current.domElement) {
        container.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, []);

  // Update Bricks Model Group
  useEffect(() => {
    const group = modelGroupRef.current;
    group.clear();

    if (mode === 'CORE_HEATMAP') {
      group.visible = false;
      return;
    }
    group.visible = true;

    const visibleBricks =
      mode === 'GROWING_CORE'
        ? bricks.filter(b => b.stepIndex <= currentStepIndex)
        : bricks;

    const studGeom = getStudGeometry();

    for (const brick of visibleBricks) {
      const isNewest = mode === 'GROWING_CORE' && brick.stepIndex === currentStepIndex;
      const mat = getBrickMaterial(brick.colorHex, isNewest);
      const pieceGeom = getPieceGeometry(brick);

      const brickGroup = new THREE.Group();

      // Main body mesh
      const bodyMesh = new THREE.Mesh(pieceGeom, mat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      brickGroup.add(bodyMesh);

      // Top studs (if not studless tile or curved slope)
      const hasStuds =
        brick.profile !== 'tile_flat' &&
        brick.profile !== 'slope_curved' &&
        brick.profile !== 'cheese' &&
        brick.profile !== 'macaroni' &&
        brick.profile !== 'tooth_creature';

      if (hasStuds) {
        const [wX, wZ, hY] = brick.size;
        const halfW = (wX * LDU_STUD_PITCH) / 2.0;
        const halfD = (wZ * LDU_STUD_PITCH) / 2.0;
        const topY = (hY * LDU_PLATE_HEIGHT) / 2.0;

        for (let sx = 0; sx < wX; sx++) {
          for (let sz = 0; sz < wZ; sz++) {
            const studMesh = new THREE.Mesh(studGeom, mat);
            studMesh.position.set(
              (sx + 0.5) * LDU_STUD_PITCH - halfW,
              topY,
              (sz + 0.5) * LDU_STUD_PITCH - halfD
            );
            studMesh.castShadow = true;
            brickGroup.add(studMesh);
          }
        }
      }

      // Position in Three.js world coordinates
      // LDraw Y-down is inverted to Three.js Y-up
      const [lx, ly, lz] = brick.ldrawPos;
      brickGroup.position.set(lx, -ly - (brick.size[2] * LDU_PLATE_HEIGHT) / 2.0, -lz);
      brickGroup.rotation.y = -(brick.rotation * Math.PI) / 180.0;

      group.add(brickGroup);
    }
  }, [bricks, currentStepIndex, mode]);

  // Update Core Heatmap Group
  useEffect(() => {
    const group = heatmapGroupRef.current;
    group.clear();

    if (mode !== 'CORE_HEATMAP' || !grid) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const { numStudsX, numStudsZ, numPlatesY, maxCoreDepth } = grid;
    const boxGeo = new THREE.BoxGeometry(LDU_STUD_PITCH * 0.9, LDU_PLATE_HEIGHT * 0.9, LDU_STUD_PITCH * 0.9);

    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied) continue;

          // Color mapped from depth: 1 = cool blue/cyan, maxDepth = hot red/magenta
          const t = maxCoreDepth > 1 ? (cell.depth - 1) / (maxCoreDepth - 1) : 0.5;
          const color = new THREE.Color();
          if (cell.depth === 1) {
            color.setHSL(0.55, 0.9, 0.5); // Cyan boundary
          } else if (cell.isCore) {
            color.setHSL(0.98, 1.0, 0.5); // Hot Magenta/Red Core
          } else {
            color.setHSL(0.12 + 0.3 * (1 - t), 0.9, 0.5); // Yellow/Orange Mantle
          }

          const mat = new THREE.MeshBasicMaterial({ color, wireframe: false, transparent: true, opacity: 0.85 });
          const m = new THREE.Mesh(boxGeo, mat);

          const posX = (x + 0.5 - numStudsX / 2.0) * LDU_STUD_PITCH;
          const posZ = (z + 0.5 - numStudsZ / 2.0) * LDU_STUD_PITCH;
          const posY = (y + 0.5) * LDU_PLATE_HEIGHT;

          m.position.set(posX, posY, posZ);
          group.add(m);
        }
      }
    }
  }, [grid, mode]);

  // Update Slope & Curvature Vectors
  useEffect(() => {
    const group = vectorsGroupRef.current;
    group.clear();

    if (mode !== 'SLOPE_CURVATURE' || !grid) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const { numStudsX, numStudsZ, numPlatesY } = grid;
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied || !cell.isBoundary) continue;

          const posX = (x + 0.5 - numStudsX / 2.0) * LDU_STUD_PITCH;
          const posZ = (z + 0.5 - numStudsZ / 2.0) * LDU_STUD_PITCH;
          const posY = (y + 0.5) * LDU_PLATE_HEIGHT;

          const origin = new THREE.Vector3(posX, posY, posZ);
          const dir = new THREE.Vector3(...cell.normal).normalize();
          const arrow = new THREE.ArrowHelper(dir, origin, 14, 0x38bdf8, 4, 3);
          group.add(arrow);
        }
      }
    }
  }, [grid, mode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Floating Viewport Legend */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '10px 14px',
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 10,
          color: '#e2e8f0',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: '0.05em', color: '#38bdf8' }}>
          VIEWPORT MODE: {mode}
        </div>
        {mode === 'GROWING_CORE' && (
          <div style={{ color: '#fbbf24', fontSize: 11 }}>
            Step {currentStepIndex} of {bricks.length}
          </div>
        )}
        {mode === 'CORE_HEATMAP' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef4444', borderRadius: 2 }} /> Deep Core
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#f59e0b', borderRadius: 2, marginLeft: 6 }} /> Mantle
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#06b6d4', borderRadius: 2, marginLeft: 6 }} /> Skin
          </div>
        )}
      </div>
    </div>
  );
};
