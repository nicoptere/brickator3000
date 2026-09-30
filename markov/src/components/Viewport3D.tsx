/**
 * Three.js 3D Viewport for Brickator3000 Markov Discretization Studio.
 *
 * Renders LEGO models with authentic LDraw dimensions, procedural studs,
 * curved slope profiles, macaroni corners, radar dishes, and teeth:
 * - 1 Stud = 20 LDU (X/Z), 1 Plate = 8 LDU (Y), 1 Brick = 24 LDU (Y).
 * - Multi-mode visualizer: Final Model, Growing Animation, Core Depth Heatmap, Slope/Curvature vectors.
 * - Source 3D Mesh Overlay: Ghost translucent solid or wireframe mode aligned with voxel volume.
 * - Island Solo Isolation: Inspect single sub-assemblies in isolation.
 *
 * Decoupled: uses LegoGeometryFactory and LegoMaterialFactory for clean single responsibility.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlacedBrick, VoxelGrid } from '../engine/types';
import { LDU_STUD_PITCH, LDU_BRICK_HEIGHT, LDU_PLATE_HEIGHT } from '../engine/connectivityDictionary';
import { LegoGeometryFactory } from './viewport/legoGeometryFactory';

export type ViewportMode = 'FINAL_MODEL' | 'GROWING_CORE' | 'CORE_HEATMAP' | 'SLOPE_CURVATURE';
export type SourceMeshMode = 'ghost' | 'wireframe' | 'none';

interface Viewport3DProps {
  bricks: PlacedBrick[];
  grid: VoxelGrid | null;
  mode: ViewportMode;
  currentStepIndex: number;
  autoRotate: boolean;
  onFrameModel?: () => void;
  sourceModel?: THREE.Object3D | null;
  sourceMeshMode?: SourceMeshMode;
  colorMode?: 'actual' | 'wfc_hierarchy' | 'island_components';
  selectedIslandId?: number | null;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  bricks,
  grid,
  mode,
  currentStepIndex,
  autoRotate,
  sourceModel = null,
  sourceMeshMode = 'none',
  colorMode = 'island_components',
  selectedIslandId = null
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const modelGroupRef = useRef<THREE.Group>(new THREE.Group());
  const heatmapGroupRef = useRef<THREE.Group>(new THREE.Group());
  const vectorsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const sourceMeshGroupRef = useRef<THREE.Group>(new THREE.Group());

  // Cached materials to avoid shader recompilation and memory leaks across ticks
  const plasticMaterialRef = useRef<THREE.MeshStandardMaterial>(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.04
    })
  );
  const highlightMaterialRef = useRef<THREE.MeshStandardMaterial>(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.1
    })
  );

  // Initialize Three.js Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090a0f);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      10000
    );
    camera.position.set(240, 180, 320);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
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
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.target.set(0, 40, 0);
    controlsRef.current = controls;

    // Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.7);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(200, 400, 200);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.4);
    fillLight.position.set(-200, 150, -200);
    scene.add(fillLight);

    // Studio Grid Floor
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

    scene.add(modelGroupRef.current);
    scene.add(heatmapGroupRef.current);
    scene.add(vectorsGroupRef.current);
    scene.add(sourceMeshGroupRef.current);

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (controlsRef.current) {
        controlsRef.current.autoRotate = autoRotate;
        controlsRef.current.autoRotateSpeed = 1.0;
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
      plasticMaterialRef.current?.dispose();
      highlightMaterialRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Update Source 3D Mesh Overlay Group
  useEffect(() => {
    const group = sourceMeshGroupRef.current;
    group.clear();

    if (sourceMeshMode === 'none' || !sourceModel || !grid) {
      group.visible = false;
      return;
    }

    group.visible = true;
    const cloned = sourceModel.clone(true);

    const bbox = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const targetHeightLDU = grid.numPlatesY * LDU_PLATE_HEIGHT;
      const scaleFactor = targetHeightLDU / Math.max(size.y, 0.001);
      cloned.scale.setScalar(scaleFactor);

      cloned.position.x = -center.x * scaleFactor;
      cloned.position.z = -center.z * scaleFactor;
      cloned.position.y = -bbox.min.y * scaleFactor;

      const isWire = sourceMeshMode === 'wireframe';
      const overlayMaterial = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        wireframe: isWire,
        transparent: true,
        opacity: isWire ? 0.6 : 0.22,
        roughness: 0.3,
        metalness: 0.1,
        depthWrite: false
      });

      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = overlayMaterial;
        }
      });

      group.add(cloned);
    }
  }, [sourceModel, grid, sourceMeshMode]);

  // Update Bricks Model Group
  useEffect(() => {
    const group = modelGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      if ((child as any).dispose) (child as any).dispose();
    }

    if (mode === 'CORE_HEATMAP') {
      group.visible = false;
      return;
    }
    group.visible = true;

    const visibleBricks =
      mode === 'GROWING_CORE'
        ? bricks.filter((b) => b.stepIndex <= currentStepIndex)
        : bricks;

    // Filter by selected island if soloing
    const filteredBricks =
      selectedIslandId != null
        ? visibleBricks.filter((b) => b.islandId === selectedIslandId)
        : visibleBricks;

    interface BrickInstanceData {
      matrix: THREE.Matrix4;
      color: THREE.Color;
    }

    const geomGroups = new Map<string, { geom: THREE.BufferGeometry; instances: BrickInstanceData[] }>();
    const studInstances: BrickInstanceData[] = [];
    let newestBrickOverlay: { geom: THREE.BufferGeometry; matrix: THREE.Matrix4 } | null = null;

    const yAxis = new THREE.Vector3(0, 1, 0);
    const scaleOne = new THREE.Vector3(1, 1, 1);
    const quat = new THREE.Quaternion();
    const identityQuat = new THREE.Quaternion();

    for (const brick of filteredBricks) {
      const isNewest = mode === 'GROWING_CORE' && brick.stepIndex === currentStepIndex;

      // Color selection: strictly use islandColorHex in island_components mode
      let displayColor = brick.islandColorHex || brick.colorHex;
      if (colorMode === 'island_components') {
        displayColor = brick.islandColorHex || brick.colorHex;
      } else if (colorMode === 'wfc_hierarchy') {
        displayColor = brick.scaleColorHex || brick.colorHex;
      } else {
        displayColor = brick.colorHex;
      }

      const color = new THREE.Color(displayColor);
      const pieceGeom = LegoGeometryFactory.getPieceGeometry(brick);

      const isQuarterTurn = brick.rotation === 90 || brick.rotation === 270;
      const baseWX = brick.baseSize ? brick.baseSize[0] : (isQuarterTurn ? brick.size[1] : brick.size[0]);
      const baseDZ = brick.baseSize ? brick.baseSize[1] : (isQuarterTurn ? brick.size[0] : brick.size[1]);
      const baseHY = brick.baseSize ? brick.baseSize[2] : brick.size[2];

      const cacheKey = `${brick.partId}_${brick.profile}_${baseWX}x${baseDZ}x${baseHY}`;

      const [lx, , lz] = brick.ldrawPos;
      const brickPosY = (brick.gridPos[1] + brick.size[2] / 2.0) * LDU_PLATE_HEIGHT;
      const brickRotY = -(brick.rotation * Math.PI) / 180.0;
      const brickPos = new THREE.Vector3(lx, brickPosY, -lz);
      quat.setFromAxisAngle(yAxis, brickRotY);

      const brickMatrix = new THREE.Matrix4().compose(brickPos, quat, scaleOne);

      if (isNewest) {
        newestBrickOverlay = { geom: pieceGeom, matrix: brickMatrix };
      }

      let gGroup = geomGroups.get(cacheKey);
      if (!gGroup) {
        gGroup = { geom: pieceGeom, instances: [] };
        geomGroups.set(cacheKey, gGroup);
      }
      gGroup.instances.push({ matrix: brickMatrix, color });

      // Top studs (if not studless tile, slope, dish, etc.)
      const hasStuds =
        brick.profile !== 'tile_flat' &&
        brick.profile !== 'slope_curved' &&
        brick.profile !== 'slope_45' &&
        brick.profile !== 'slope_33' &&
        brick.profile !== 'cheese' &&
        brick.profile !== 'macaroni' &&
        brick.profile !== 'tooth_creature' &&
        brick.profile !== 'dish' &&
        brick.profile !== 'cone' &&
        brick.profile !== 'wedge';

      if (hasStuds) {
        const halfW = (baseWX * LDU_STUD_PITCH) / 2.0;
        const halfD = (baseDZ * LDU_STUD_PITCH) / 2.0;
        const topY = (baseHY * LDU_PLATE_HEIGHT) / 2.0;

        for (let sx = 0; sx < baseWX; sx++) {
          for (let sz = 0; sz < baseDZ; sz++) {
            const localX = (sx + 0.5) * LDU_STUD_PITCH - halfW;
            const localY = topY + 2.0;
            const localZ = (sz + 0.5) * LDU_STUD_PITCH - halfD;

            const studPos = new THREE.Vector3(localX, localY, localZ).applyAxisAngle(yAxis, brickRotY).add(brickPos);
            const studMatrix = new THREE.Matrix4().compose(studPos, identityQuat, scaleOne);
            studInstances.push({ matrix: studMatrix, color });
          }
        }
      }
    }

    // Shared high-performance ABS plastic material with instance color support
    const plasticMaterial = plasticMaterialRef.current;

    for (const [, groupData] of geomGroups) {
      const count = groupData.instances.length;
      if (count === 0) continue;
      const instMesh = new THREE.InstancedMesh(groupData.geom, plasticMaterial, count);
      instMesh.castShadow = true;
      instMesh.receiveShadow = true;

      for (let i = 0; i < count; i++) {
        const inst = groupData.instances[i];
        instMesh.setMatrixAt(i, inst.matrix);
        instMesh.setColorAt(i, inst.color);
      }
      instMesh.instanceMatrix.needsUpdate = true;
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
      instMesh.computeBoundingSphere();
      group.add(instMesh);
    }

    if (studInstances.length > 0) {
      const studGeom = LegoGeometryFactory.getStudGeometry();
      const studInstMesh = new THREE.InstancedMesh(studGeom, plasticMaterial, studInstances.length);
      studInstMesh.castShadow = true;
      studInstMesh.receiveShadow = true;

      for (let i = 0; i < studInstances.length; i++) {
        const s = studInstances[i];
        studInstMesh.setMatrixAt(i, s.matrix);
        studInstMesh.setColorAt(i, s.color);
      }
      studInstMesh.instanceMatrix.needsUpdate = true;
      if (studInstMesh.instanceColor) studInstMesh.instanceColor.needsUpdate = true;
      studInstMesh.computeBoundingSphere();
      group.add(studInstMesh);
    }

    // Dedicated highlight mesh overlay for newly placed brick
    if (newestBrickOverlay) {
      const highlightMat = highlightMaterialRef.current;
      const highlightMesh = new THREE.Mesh(newestBrickOverlay.geom, highlightMat);
      highlightMesh.applyMatrix4(newestBrickOverlay.matrix);
      group.add(highlightMesh);
    }
  }, [bricks, currentStepIndex, mode, colorMode, selectedIslandId]);

  // Update Core Heatmap Group
  useEffect(() => {
    const group = heatmapGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      if ((child as any).dispose) (child as any).dispose();
    }

    if (mode !== 'CORE_HEATMAP' || !grid) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const { numStudsX, numStudsZ, numPlatesY, maxCoreDepth } = grid;
    const boxGeo = new THREE.BoxGeometry(LDU_STUD_PITCH * 0.9, LDU_PLATE_HEIGHT * 0.9, LDU_STUD_PITCH * 0.9);

    interface HeatmapCellData {
      matrix: THREE.Matrix4;
      color: THREE.Color;
    }
    const heatmapCells: HeatmapCellData[] = [];
    const scaleOne = new THREE.Vector3(1, 1, 1);
    const identityQuat = new THREE.Quaternion();

    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied) continue;
          if (selectedIslandId != null && cell.islandId !== selectedIslandId) continue;

          const t = maxCoreDepth > 1 ? (cell.depth - 1) / (maxCoreDepth - 1) : 0.5;
          const color = new THREE.Color();
          if (cell.depth === 1) {
            color.setHSL(0.55, 0.9, 0.5); // Cyan boundary
          } else if (cell.isCore) {
            color.setHSL(0.0, 0.95, 0.55); // Crimson deep core
          } else {
            color.setHSL(0.55 - t * 0.55, 0.9, 0.5);
          }

          const posX = (x + 0.5 - numStudsX / 2.0) * LDU_STUD_PITCH;
          const posZ = (z + 0.5 - numStudsZ / 2.0) * LDU_STUD_PITCH;
          const posY = (y + 0.5) * LDU_PLATE_HEIGHT;

          const matrix = new THREE.Matrix4().compose(new THREE.Vector3(posX, posY, posZ), identityQuat, scaleOne);
          heatmapCells.push({ matrix, color });
        }
      }
    }

    if (heatmapCells.length > 0) {
      const heatmapMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
        metalness: 0.1
      });
      const instMesh = new THREE.InstancedMesh(boxGeo, heatmapMat, heatmapCells.length);
      for (let i = 0; i < heatmapCells.length; i++) {
        instMesh.setMatrixAt(i, heatmapCells[i].matrix);
        instMesh.setColorAt(i, heatmapCells[i].color);
      }
      instMesh.instanceMatrix.needsUpdate = true;
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
      instMesh.computeBoundingSphere();
      group.add(instMesh);
    }
  }, [grid, mode, selectedIslandId]);

  // Update Slope & Curvature Vectors
  useEffect(() => {
    const group = vectorsGroupRef.current;
    group.clear();

    if (mode !== 'SLOPE_CURVATURE' || !grid) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const { numStudsX, numStudsZ } = grid;
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < grid.numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied || !cell.isBoundary) continue;
          if (selectedIslandId != null && cell.islandId !== selectedIslandId) continue;

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
  }, [grid, mode, selectedIslandId]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />

      {/* Floating Viewport Status Badge */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 12px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 8,
          color: '#f8fafc',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: '0.05em', color: '#38bdf8' }}>
          VIEWPORT: {mode}
        </div>
        {selectedIslandId != null && (
          <div style={{ color: '#c084fc', fontSize: 11, fontWeight: 600 }}>
            SOLO: Island #{selectedIslandId}
          </div>
        )}
        {sourceMeshMode !== 'none' && (
          <div style={{ color: '#94a3b8', fontSize: 11 }}>
            Source Mesh: {sourceMeshMode.toUpperCase()}
          </div>
        )}
        {mode === 'GROWING_CORE' && (
          <div style={{ color: '#fbbf24', fontSize: 11 }}>
            Step {currentStepIndex} of {bricks.length}
          </div>
        )}
      </div>
    </div>
  );
};
