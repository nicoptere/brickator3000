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
import { Volume2Icon, VolumeXIcon, SpinnerIcon } from './common/Icons';
import { getIslandColorHex } from '../engine/meshIslandSegmenter';

export type ViewportMode = 'FINAL_MODEL' | 'GROWING_CORE' | 'CORE_HEATMAP' | 'SLOPE_CURVATURE';
export type SourceMeshMode = 'ghost' | 'wireframe' | 'none';

interface Viewport3DProps {
  bricks: PlacedBrick[];
  grid: VoxelGrid | null;
  mode?: ViewportMode;
  currentStepIndex?: number;
  autoRotate?: boolean;
  onFrameModel?: () => void;
  sourceModel?: THREE.Object3D | null;
  sourceMeshMode?: SourceMeshMode;
  colorMode?: 'actual' | 'wfc_hierarchy' | 'island_components';
  selectedIslandId?: number | null;
  isLoading?: boolean;
  loadingMessage?: string;
  themeMode?: 'dark' | 'light';
  tweenKey?: number;
  isAudioMuted?: boolean;
  onToggleAudio?: () => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  bricks,
  grid,
  mode = 'FINAL_MODEL',
  currentStepIndex = 0,
  autoRotate = false,
  sourceModel = null,
  sourceMeshMode = 'none',
  colorMode = 'island_components',
  selectedIslandId = null,
  isLoading = false,
  loadingMessage = 'Loading 3D Model...',
  themeMode = 'dark',
  tweenKey,
  isAudioMuted = false,
  onToggleAudio
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const floorMatRef = useRef<THREE.ShadowMaterial | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const autoRotateRef = useRef<boolean>(autoRotate);
  const resetTurntableRef = useRef<boolean>(false);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

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
      color: 0x2563eb,
      emissive: 0x2563eb,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.1
    })
  );

  // Initialize Three.js Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isLight = themeMode === 'light';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isLight ? 0xf8fafc : 0x1e222b);
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
    
    // HD VSM Shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
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
    const hemiLight = new THREE.HemisphereLight(
      0xffffff,
      isLight ? 0xdbeafe : 0x1e293b,
      isLight ? 1.05 : 0.95
    );
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    // Key directional light with high-fidelity VSM soft shadows
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(250, 450, 250);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 1800;
    dirLight.shadow.camera.left = -500;
    dirLight.shadow.camera.right = 500;
    dirLight.shadow.camera.top = 500;
    dirLight.shadow.camera.bottom = -500;
    dirLight.shadow.bias = -0.0001;
    dirLight.shadow.radius = 4;
    dirLight.shadow.blurSamples = 16;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
    fillLight.position.set(-200, 150, -200);
    scene.add(fillLight);

    // Transparent ground shadow receiver plane (Grid removed per user directive)
    const floorGeo = new THREE.PlaneGeometry(6000, 6000);
    const floorMat = new THREE.ShadowMaterial({
      opacity: isLight ? 0.22 : 0.35,
      transparent: true,
      depthWrite: false
    });
    floorMatRef.current = floorMat;
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.05;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    scene.add(modelGroupRef.current);
    scene.add(heatmapGroupRef.current);
    scene.add(vectorsGroupRef.current);
    scene.add(sourceMeshGroupRef.current);

    let animId: number;
    const yAxis = new THREE.Vector3(0, 1, 0);
    const savedCameraPosition = new THREE.Vector3();
    const savedCameraQuaternion = new THREE.Quaternion();
    let turntableAngle = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (controlsRef.current && cameraRef.current && rendererRef.current && sceneRef.current) {
        const controls = controlsRef.current;
        const camera = cameraRef.current;
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const isAutoRotating = autoRotateRef.current;

        // OrbitControls should never handle autoRotate directly
        controls.autoRotate = false;

        // Reset turntable angle when requested (e.g. when framing a new model)
        if (resetTurntableRef.current) {
          turntableAngle = 0;
          resetTurntableRef.current = false;
        }

        // Run OrbitControls update (processes damping, user drag, pan, zoom on clean base coordinates)
        controls.update();

        // AFTER orbit.controls: save offset/orientation before, apply turntable motion, render, restore after
        if (isAutoRotating) {
          // 1. Save unrotated camera state before applying turntable offset
          savedCameraPosition.copy(camera.position);
          savedCameraQuaternion.copy(camera.quaternion);

          // 2. Advance turntable angle smoothly
          turntableAngle += 0.012;

          // 3. Apply turntable rotation around Y-axis relative to controls.target
          const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
          offset.applyAxisAngle(yAxis, turntableAngle);
          camera.position.copy(controls.target).add(offset);
          camera.lookAt(controls.target);

          // 4. Render frame with rotated turntable view
          renderer.render(scene, camera);

          // 5. Restore unrotated camera state after render
          camera.position.copy(savedCameraPosition);
          camera.quaternion.copy(savedCameraQuaternion);
        } else {
          renderer.render(scene, camera);
        }
      }
    };
    animate();

    const applyResize = (w: number, h: number) => {
      if (!rendererRef.current || !cameraRef.current || w <= 0 || h <= 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      if (sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    const handleWindowResize = () => {
      if (!containerRef.current) return;
      applyResize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };

    // ResizeObserver continuously watches container dimensions for immediate layout and drawer changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          applyResize(width, height);
        }
      }
    });
    resizeObserver.observe(container);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (rendererRef.current && rendererRef.current.domElement) {
        container.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      plasticMaterialRef.current?.dispose();
      highlightMaterialRef.current?.dispose();
    };
  }, []);

  // Dynamic Dark/Light Scene Background and Shadow Intensity Update
  useEffect(() => {
    if (!sceneRef.current) return;
    const isLight = themeMode === 'light';
    sceneRef.current.background = new THREE.Color(isLight ? 0xf8fafc : 0x1e222b);
    if (floorMatRef.current) {
      floorMatRef.current.opacity = isLight ? 0.22 : 0.35;
    }
    if (hemiLightRef.current) {
      hemiLightRef.current.groundColor.setHex(isLight ? 0xdbeafe : 0x1e293b);
      hemiLightRef.current.intensity = isLight ? 1.05 : 0.95;
    }
  }, [themeMode]);

  // Preserve camera view when changing mesh (don't reset view)
  const hasInitialFitRef = useRef<boolean>(false);
  const prevCenterYRef = useRef<number | null>(null);
  const lastTweenKeyRef = useRef<number>(0);

  // Smoothly tweens camera to 2.5 * bounding sphere radius in the direction of the camera
  const tweenCameraToBoundingSphere = React.useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !grid) return;
    resetTurntableRef.current = true;

    const camera = cameraRef.current;
    const controls = controlsRef.current;

    const widthX = grid.numStudsX * LDU_STUD_PITCH;
    const depthZ = grid.numStudsZ * LDU_STUD_PITCH;
    const heightY = grid.numPlatesY * LDU_PLATE_HEIGHT;

    const centerY = heightY / 2;
    // Circumscribed radius of the model's bounding box
    const radius = 0.5 * Math.sqrt(widthX * widthX + depthZ * depthZ + heightY * heightY);
    // 2.5 * bounding sphere radius
    const targetDistance = 2.5 * Math.max(radius, 40);

    // Direction of the camera relative to model center
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 0.001) {
      dir.set(1, 0.6, 1);
    }
    dir.normalize();

    // Place camera 2.5 * radius along current direction
    const targetPos = new THREE.Vector3(0, centerY, 0).addScaledVector(dir, targetDistance);
    const targetLookAt = new THREE.Vector3(0, centerY, 0);

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    const duration = 750; // ms

    const animateTween = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Smooth cubic ease-out
      const t = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, t);
      controls.target.lerpVectors(startTarget, targetLookAt, t);
      controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateTween);
      } else {
        prevCenterYRef.current = centerY;
      }
    };

    requestAnimationFrame(animateTween);
  }, [grid]);

  const zoomToFit = React.useCallback(() => {
    tweenCameraToBoundingSphere();
  }, [tweenCameraToBoundingSphere]);

  // Zoom in / frame whenever a mesh is loaded
  const lastSourceModelRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!grid || !sourceModel || !cameraRef.current || !controlsRef.current) return;
    if (lastSourceModelRef.current !== sourceModel) {
      lastSourceModelRef.current = sourceModel;
      tweenCameraToBoundingSphere();
    }
  }, [sourceModel, grid, tweenCameraToBoundingSphere]);

  // Auto-mode camera placement tween trigger
  useEffect(() => {
    if (tweenKey && tweenKey > lastTweenKeyRef.current) {
      lastTweenKeyRef.current = tweenKey;
      tweenCameraToBoundingSphere();
    }
  }, [tweenKey, tweenCameraToBoundingSphere]);

  // Update Source 3D Mesh Overlay Group (Multi-part colored Ghost View)
  useEffect(() => {
    const group = sourceMeshGroupRef.current;
    group.clear();

    if (sourceMeshMode === 'none' || !sourceModel || !grid) {
      group.visible = false;
      return;
    }

    group.visible = true;
    const isWire = sourceMeshMode === 'wireframe';

    const bbox = new THREE.Box3().setFromObject(sourceModel);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;

    const targetHeightLDU = grid.numPlatesY * LDU_PLATE_HEIGHT;
    const scaleFactor = targetHeightLDU / Math.max(size.y, 0.001);

    const islandGroup = new THREE.Group();
    islandGroup.scale.setScalar(scaleFactor);
    islandGroup.position.x = -center.x * scaleFactor;
    islandGroup.position.z = -center.z * scaleFactor;
    islandGroup.position.y = -bbox.min.y * scaleFactor;

    // Check if pre-segmented topological islands are available
    const islands = (grid as any).islands || [];
    if (islands.length > 0) {
      const isSolo = selectedIslandId != null;

      for (const isl of islands) {
        const isSelected = selectedIslandId === isl.id;
        const opacity = isWire
          ? (isSolo ? (isSelected ? 0.85 : 0.08) : 0.6)
          : (isSolo ? (isSelected ? 0.72 : 0.08) : 0.35);

        // Assign colors to the different parts of the mesh
        const partColor = (colorMode === 'actual' && isl.originalColorHex)
          ? isl.originalColorHex
          : isl.colorHex;

        const partMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(partColor),
          wireframe: isWire,
          transparent: true,
          opacity,
          roughness: 0.35,
          metalness: 0.05,
          depthWrite: false,
          side: THREE.DoubleSide
        });

        const partMesh = new THREE.Mesh(isl.geometry, partMaterial);
        partMesh.castShadow = true;
        partMesh.receiveShadow = true;
        islandGroup.add(partMesh);
      }
    } else {
      // Fallback: Multi-part child mesh traversal from source model
      const cloned = sourceModel.clone(true);
      let childIndex = 0;
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const partColor = getIslandColorHex(childIndex++);
          mesh.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(partColor),
            wireframe: isWire,
            transparent: true,
            opacity: isWire ? 0.6 : 0.32,
            roughness: 0.35,
            metalness: 0.05,
            depthWrite: false,
            side: THREE.DoubleSide
          });
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      islandGroup.add(cloned);
    }

    group.add(islandGroup);
  }, [sourceModel, grid, sourceMeshMode, selectedIslandId, colorMode]);

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

      const numStudsX = grid ? grid.numStudsX : 0;
      const numStudsZ = grid ? grid.numStudsZ : 0;
      const centerX = (brick.gridPos[0] + brick.size[0] / 2.0 - numStudsX / 2.0) * LDU_STUD_PITCH;
      const centerZ = (brick.gridPos[1] + brick.size[1] / 2.0 - numStudsZ / 2.0) * LDU_STUD_PITCH;
      const brickPosY = (brick.gridPos[2] + brick.size[2] / 2.0) * LDU_PLATE_HEIGHT;
      const brickRotY = -(brick.rotation * Math.PI) / 180.0;
      const brickPos = new THREE.Vector3(centerX, brickPosY, centerZ);
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
        const isRound =
          brick.profile === 'round_cylinder' ||
          brick.profile === 'round_plate' ||
          ['3062b', '6141', '3941', '4032', '4032a', '6222', '60474'].includes(brick.partId);
        const radiusLDU = (baseWX * LDU_STUD_PITCH) / 2.0;

        for (let sx = 0; sx < baseWX; sx++) {
          for (let sz = 0; sz < baseDZ; sz++) {
            const localX = (sx + 0.5) * LDU_STUD_PITCH - halfW;
            const localY = topY + 2.0;
            const localZ = (sz + 0.5) * LDU_STUD_PITCH - halfD;

            // Skip corner studs that stick outside round circular cylinders (e.g. 4x4 round brick)
            if (isRound && (localX * localX + localZ * localZ) > (radiusLDU - 2) * (radiusLDU - 2)) {
              continue;
            }

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
          const arrow = new THREE.ArrowHelper(dir, origin, 14, 0x2563eb, 4, 3);
          group.add(arrow);
        }
      }
    }
  }, [grid, mode, selectedIslandId]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />



      {/* Floating Audio Toggle Button (Top Right) */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          gap: 6,
          zIndex: 10
        }}
      >
        <button
          onClick={onToggleAudio}
          title={isAudioMuted ? 'Turn Sound On' : 'Turn Sound Off'}
          style={{
            height: 32,
            padding: '0 10px',
            borderRadius: 6,
            backgroundColor: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${isAudioMuted ? '#e2e8f0' : '#bfdbfe'}`,
            color: isAudioMuted ? '#64748b' : '#2563eb',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#eff6ff';
            e.currentTarget.style.borderColor = '#bfdbfe';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
            e.currentTarget.style.borderColor = isAudioMuted ? '#e2e8f0' : '#bfdbfe';
          }}
        >
          {isAudioMuted ? <VolumeXIcon size={14} color="#64748b" /> : <Volume2Icon size={14} color="#2563eb" />}
          <span>{isAudioMuted ? 'Sound Off' : 'Sound On'}</span>
        </button>
      </div>

      {/* Centered Model Loading Throbber Overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(30, 34, 43, 0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 15,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 22px',
              borderRadius: 12,
              backgroundColor: '#ffffff',
              border: '1px solid #bfdbfe',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              color: '#0f172a'
            }}
          >
            <SpinnerIcon size={22} color="#2563eb" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                Loading 3D Model
              </span>
              <span style={{ fontSize: 11, color: '#64748b', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {loadingMessage || 'Fetching geometry & texture buffers...'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
