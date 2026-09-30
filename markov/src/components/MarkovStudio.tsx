/**
 * Brickator3000 // Markov Discretization Studio Master Dashboard.
 *
 * Coordinates:
 * - 3D Viewport with authentic LEGO rendering & Source 3D Mesh Overlay
 * - Two-Drawer Layout:
 *   - Left Drawer: SEC 1 Model Selector (Clean tree + Presets), SEC 2 Model Params & Islands
 *   - Right Drawer: Generation Settings, Scale, OMR Tensor, Polish & BFS Buildability, Action Controls
 * - 4-Phase Discretization Pipeline:
 *   1. Forward Volume Fill (1x1 Plates with direct RGB sampled colors)
 *   2. Backwards Agglomerative Brick Merging (Interlocking running bond)
 *   3. Exterior Surface Replacement (Curved slopes, inverted slopes, macaroni, horns)
 *   4. Studless Top Finish (Smooth flat tiles)
 * - Authentic LDraw piece IDs (3001.dat, 88930.dat, etc.) and exact 20x20x24 LDU dimensions
 * - Zero Emojis, Zero Fireworks, Zero Sounds, Zero Timeline Slider
 */

import React, { useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Viewport3D, ViewportMode, SourceMeshMode } from './Viewport3D';
import { LeftDrawer } from './LeftDrawer';
import { RightDrawer } from './RightDrawer';
import { ConnectorDatabaseInspector } from './ConnectorDatabaseInspector';
import { OMRGalleryInspector } from './OMRGalleryInspector';
import { PanelLeftIcon, PanelRightIcon } from './common/Icons';

import { VoxelGrid, PlacedBrick, MarkovEngineOptions, GrowthStepResult } from '../engine/types';
import { MeshVoxelizer } from '../engine/meshVoxelizer';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { LDrawExporter } from '../engine/ldrawExporter';
import { MeshIslandSegmenter } from '../engine/meshIslandSegmenter';
import { WFC_REFINER, OMRCategory } from '../engine/wfcRefinerEngine';
import { MeshDistanceEvaluator, MeshDistanceResult } from '../engine/meshDistanceMetric';
import { BuildabilityReport, HarmonizationResult } from '../engine/polishHarmonizer';

const MODEL_PRESETS: Record<
  string,
  { label: string; url: string; fallbackType: 'duck' | 'car' | 'dolphin' | 'airplane' | 'dome_creature' }
> = {
  spearman: { label: 'Spearman', url: '/models/spearman.glb', fallbackType: 'dome_creature' },
  beetle: { label: 'VW Beetle', url: '/models/clean/cars/vwbeetle.glb', fallbackType: 'car' },
  mini: { label: 'Mini Cooper', url: '/models/clean/cars/mini.glb', fallbackType: 'car' },
  concorde: { label: 'Concorde', url: '/models/clean/airplanes/concord.glb', fallbackType: 'airplane' },
  duck: { label: 'Duck', url: '/sample_models/duck.glb', fallbackType: 'duck' },
  dolphin: { label: 'Dolphin', url: '/sample_models/dolphin.glb', fallbackType: 'dolphin' },
  delacroix: { label: 'Delacroix', url: '/sample_models/delacroix_low_poly.ply', fallbackType: 'dome_creature' },
  prison: { label: 'Castle', url: '/sample_models/prison_0.obj', fallbackType: 'dome_creature' }
};

const PHASE_LABELS: Record<string, { title: string; color: string }> = {
  SURFACE_SHELL: { title: '1. WFC Exterior Skin (N = 2)', color: '#ec4899' },
  CORE_INFILL: { title: '2. Macro Structural Core (N = 8, 4)', color: '#38bdf8' },
  TILE_FINISH: { title: '3. Studless Top Finish (N = 0)', color: '#06b6d4' },
  POLISH_HARMONIZATION: { title: '4. Polish & Harmonization', color: '#c084fc' },
  BUILDABILITY_VERIFY: { title: '5. Buildability BFS Check', color: '#f59e0b' },
  DONE: { title: '6. Build Complete', color: '#34d399' }
};

export const MarkovStudio: React.FC = () => {
  const [modelType, setModelType] = useState<string>('beetle'); // Default to VW Beetle
  const [modelUrl, setModelUrl] = useState<string | undefined>(undefined);
  const [targetHeightBricks, setTargetHeightBricks] = useState<number>(16); // Default 16 bricks (1*1*1 brick grid)
  const [viewportMode, setViewportMode] = useState<ViewportMode>('FINAL_MODEL');
  const [sourceMeshMode, setSourceMeshMode] = useState<SourceMeshMode>('ghost');
  const [colorMode, setColorMode] = useState<'island_components' | 'wfc_hierarchy' | 'actual'>('island_components');
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);

  // Two Drawer visibility states
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState<boolean>(true);
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState<boolean>(true);

  const [colorSeed, setColorSeed] = useState<number>(1);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(6);

  // Modals
  const [isDatabaseOpen, setIsDatabaseOpen] = useState<boolean>(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

  // Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('Loading 3D model & segmenting islands...');

  // Engine & Simulation State
  const [sourceModel, setSourceModel] = useState<THREE.Object3D | null>(null);
  const [grid, setGrid] = useState<VoxelGrid | null>(null);
  const [engine, setEngine] = useState<MarkovCoreGrowingEngine | null>(null);
  const [bricks, setBricks] = useState<PlacedBrick[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>('SURFACE_SHELL');

  const [options, setOptions] = useState<MarkovEngineOptions>({
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: false, // Default to false so authentic LEGO cylindrical studs appear on exposed brick tops
    enablePolishPass: true,
    enableBuildabilityVerify: true,
    directRGBSampling: true,
    batchStepSize: 16,
    colorMode: 'island_components',
    voxelizeMode: 'surface'
  });

  const [stats, setStats] = useState({
    totalPlaced: 0,
    leafCount: 0,
    edgeCount: 0,
    fillCount: 0,
    uniqueParts: 0,
    coverage: 0
  });

  const [omrCategory, setOmrCategory] = useState<OMRCategory>('vehicles');
  const [distanceMetric, setDistanceMetric] = useState<MeshDistanceResult | null>(null);
  const [buildabilityReport, setBuildabilityReport] = useState<BuildabilityReport | null>(null);
  const [harmonizationResult, setHarmonizationResult] = useState<HarmonizationResult | null>(null);

  // Re-build Voxel Grid from authentic 3D model or custom upload
  const initializeModel = useCallback(
    async (type: string, heightBricks: number, opts: MarkovEngineOptions, customFile?: File, customUrl?: string) => {
      setIsPlaying(false);
      setIsLoading(true);
      setLoadingMessage('Loading authentic 3D model & extracting half-edge islands...');

      try {
        let modelObj: THREE.Object3D;
        if (customFile) {
          modelObj = await MeshVoxelizer.loadModel(customFile);
        } else if (customUrl) {
          modelObj = await MeshVoxelizer.loadModel(customUrl);
        } else {
          const preset = MODEL_PRESETS[type] || MODEL_PRESETS['beetle'];
          try {
            modelObj = await MeshVoxelizer.loadModel(preset.url);
          } catch (err) {
            console.warn(`Could not load model at ${preset.url}, using procedural model`, err);
            modelObj = MeshVoxelizer.createSampleModel(preset.fallbackType);
          }
        }

        setLoadingMessage('Voxelizing into 1*1*1 bricks & isolating mesh components...');
        const newGrid = MeshVoxelizer.voxelizeObject(modelObj, {
          targetHeightBricks: heightBricks,
          voxelizeMode: opts.voxelizeMode || 'surface'
        });

        const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);
        newEngine.setOmrCategory(omrCategory);

        setSourceModel(modelObj);
        setGrid(newGrid);
        setEngine(newEngine);
        setBricks([]);
        setCurrentStepIndex(0);
        setPhase(newEngine.currentPhase);
        setStats({
          totalPlaced: 0,
          leafCount: 0,
          edgeCount: 0,
          fillCount: 0,
          uniqueParts: 0,
          coverage: 0
        });
      } catch (err: any) {
        console.error('Failed to initialize model:', err);
        const fallbackObj = MeshVoxelizer.createSampleModel('car');
        const newGrid = MeshVoxelizer.voxelizeObject(fallbackObj, {
          targetHeightBricks: heightBricks,
          voxelizeMode: opts.voxelizeMode || 'surface'
        });
        const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);
        setSourceModel(fallbackObj);
        setGrid(newGrid);
        setEngine(newEngine);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Initialize on mount
  useEffect(() => {
    initializeModel(modelType, targetHeightBricks, options);
  }, []);

  const handleSelectModel = (type: string, url?: string) => {
    setModelType(type);
    setModelUrl(url);
    initializeModel(type, targetHeightBricks, options, undefined, url);
  };

  const handleChangeHeight = (h: number) => {
    setTargetHeightBricks(h);
    initializeModel(modelType, h, options, undefined, modelUrl);
  };

  const handleChangeOptions = (newOpts: Partial<MarkovEngineOptions>) => {
    const merged = { ...options, ...newOpts };
    setOptions(merged);

    // If only polish or buildability was toggled on an existing solved model, execute immediately
    const onlyPolishOrBuildToggled =
      Object.keys(newOpts).every((k) => k === 'enablePolishPass' || k === 'enableBuildabilityVerify');
    if (onlyPolishOrBuildToggled && engine && bricks.length > 0) {
      engine.options = { ...engine.options, ...newOpts };
      if (newOpts.enablePolishPass && !options.enablePolishPass) {
        handleHarmonizeNeighborhoods();
      }
      if (newOpts.enableBuildabilityVerify && !options.enableBuildabilityVerify) {
        handleVerifyBuildability();
      }
      return;
    }

    initializeModel(modelType, targetHeightBricks, merged, undefined, modelUrl);
  };

  // Perform single step
  const executeStep = useCallback(() => {
    if (!engine) return false;

    if (engine.currentPhase === 'DONE') {
      setIsPlaying(false);
      return false;
    }

    const res: GrowthStepResult = engine.step();
    setPhase(res.phase);

    setBricks(Array.from(engine.placedBricks.values()));
    setCurrentStepIndex(engine.stepIndex);

    setStats({
      totalPlaced: res.totalPlacedBricks,
      leafCount: res.bomStats.leafCount,
      edgeCount: res.bomStats.edgeCount,
      fillCount: res.bomStats.fillCount,
      uniqueParts: res.bomStats.uniquePartCount,
      coverage: Math.round(res.coverageRatio * 100)
    });

    if (res.phase === 'DONE') {
      setIsPlaying(false);
      setViewportMode('FINAL_MODEL');
      return false;
    }

    return true;
  }, [engine]);

  // Animation Loop for continuous play
  useEffect(() => {
    if (!isPlaying) return;

    let timeoutId: any;
    const loop = () => {
      const continuePlaying = executeStep();
      if (continuePlaying && isPlaying) {
        const delay = Math.max(16, 250 / speed);
        timeoutId = setTimeout(loop, delay);
      }
    };

    loop();

    return () => clearTimeout(timeoutId);
  }, [isPlaying, speed, executeStep]);

  // Harmonize slopes, curves, and OMR transitions
  const handleHarmonizeNeighborhoods = () => {
    if (!engine || bricks.length === 0 || !grid) return;
    const res = engine.harmonizeNeighborhoods();
    setHarmonizationResult(res);
    setBricks(Array.from(engine.placedBricks.values()));
    if (sourceModel) {
      setDistanceMetric(MeshDistanceEvaluator.evaluate(Array.from(engine.placedBricks.values()), sourceModel, grid));
    }
  };

  // Verify BFS physical grounding and running bond interlock
  const handleVerifyBuildability = () => {
    if (!engine || bricks.length === 0 || !grid) return;
    const rep = engine.verifyBuildability();
    setBuildabilityReport(rep);
    setBricks(Array.from(engine.placedBricks.values()));
  };

  // Switch category OMR profile
  const handleChangeOmrCategory = async (cat: OMRCategory) => {
    setOmrCategory(cat);
    await WFC_REFINER.switchCategory(cat);
    if (engine) {
      engine.setOmrCategory(cat);
    }
    if (grid && bricks.length > 0) {
      const metrics = WFC_REFINER.refineModel(bricks, grid);
      const updated = [...bricks];
      setBricks(updated);
      if (engine) {
        engine.syncBricksFromWfc(updated);
      }
      setStats((prev) => ({
        ...prev,
        uniqueParts: new Set(updated.map((b) => b.partId)).size
      }));
    }
  };

  // Calculate analytical surface distance to ground truth mesh
  const handleEvaluateDistance = () => {
    if (!sourceModel || bricks.length === 0 || !grid) return;
    const res = MeshDistanceEvaluator.evaluate(bricks, sourceModel, grid);
    setDistanceMetric(res);
  };

  // Solve entire model to completion
  const handleSolveAll = () => {
    if (!engine) return;
    setIsPlaying(false);
    const res = engine.solveAll(3000);
    const solvedBricks = Array.from(engine.placedBricks.values());
    setBricks(solvedBricks);
    setCurrentStepIndex(engine.stepIndex);
    setViewportMode('FINAL_MODEL');
    setPhase(engine.currentPhase);
    setStats({
      totalPlaced: res.totalPlacedBricks,
      leafCount: res.bomStats.leafCount,
      edgeCount: res.bomStats.edgeCount,
      fillCount: res.bomStats.fillCount,
      uniqueParts: res.bomStats.uniquePartCount,
      coverage: Math.round(res.coverageRatio * 100)
    });
    setHarmonizationResult(engine.harmonizationResult);
    setBuildabilityReport(engine.buildabilityReport);
    if (sourceModel && grid) {
      setDistanceMetric(MeshDistanceEvaluator.evaluate(solvedBricks, sourceModel, grid));
    }
  };

  // Discretize single island alone
  const handleDiscretizeIsland = (islandId: number) => {
    if (!engine) return;
    setIsPlaying(false);
    setSelectedIslandId(islandId);
    const res = engine.solveSingleIsland(islandId, 1500);
    setBricks(Array.from(engine.placedBricks.values()));
    setCurrentStepIndex(engine.stepIndex);
    setViewportMode('FINAL_MODEL');
    setPhase(engine.currentPhase);
    setStats({
      totalPlaced: res.totalPlacedBricks,
      leafCount: res.bomStats.leafCount,
      edgeCount: res.bomStats.edgeCount,
      fillCount: res.bomStats.fillCount,
      uniqueParts: res.bomStats.uniquePartCount,
      coverage: Math.round(res.coverageRatio * 100)
    });
  };

  // Discretize all islands independently one by one with dedicated seed cores
  const handleDiscretizeAllIndependently = () => {
    if (!engine) return;
    setIsPlaying(false);
    setSelectedIslandId(null);
    const res = engine.solveAllIslandsIndependently(1500);
    setBricks(Array.from(engine.placedBricks.values()));
    setCurrentStepIndex(engine.stepIndex);
    setPhase(engine.currentPhase);
    setStats({
      totalPlaced: res.totalPlacedBricks,
      leafCount: res.bomStats.leafCount,
      edgeCount: res.bomStats.edgeCount,
      fillCount: res.bomStats.fillCount,
      uniqueParts: res.bomStats.uniquePartCount,
      coverage: Math.round(res.coverageRatio * 100)
    });
  };

  // Solve WFC on single island or full assembly
  const handleSolveWfcOnIsland = (islandId: number | null) => {
    if (!grid || bricks.length === 0) return;
    setIsPlaying(false);
    if (islandId != null) {
      WFC_REFINER.refineIsland(islandId, bricks, grid);
    } else {
      WFC_REFINER.refineModel(bricks, grid);
    }
    const updated = [...bricks];
    setBricks(updated);
    if (engine) {
      engine.syncBricksFromWfc(updated);
    }
    setStats((prev) => ({
      ...prev,
      uniqueParts: new Set(updated.map((b) => b.partId)).size
    }));
  };

  // Re-roll random colors for all islands
  const handleRerollColors = () => {
    if (!grid || !grid.islands) return;
    const newSeed = colorSeed + 1;
    setColorSeed(newSeed);
    MeshIslandSegmenter.recolorIslands(grid.islands, newSeed);

    if (engine) {
      const islandColorMap = new Map(grid.islands.map((i) => [i.id, i.colorHex]));
      for (const b of engine.placedBricks.values()) {
        if (b.islandId !== undefined && islandColorMap.has(b.islandId)) {
          const newColor = islandColorMap.get(b.islandId)!;
          b.islandColorHex = newColor;
          if (colorMode === 'island_components') {
            b.colorHex = newColor;
          }
        }
      }
      setBricks(Array.from(engine.placedBricks.values()));
    }
  };

  const handleReset = () => {
    initializeModel(modelType, targetHeightBricks, options, undefined, modelUrl);
  };

  const handleExportLDR = () => {
    if (bricks.length === 0) return;
    const content = LDrawExporter.exportToLDraw(bricks, `Brickator_${modelType}`, options.directRGBSampling);
    LDrawExporter.downloadLDrawFile(content, `brickator_${modelType}.ldr`);
  };

  const handleFileUpload = (file: File) => {
    setModelType('custom');
    setModelUrl(undefined);
    initializeModel('custom', targetHeightBricks, options, file);
  };

  const currentPhaseInfo = PHASE_LABELS[phase] || { title: phase, color: '#38bdf8' };

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#090a0f',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      {/* 1. Left Drawer Panel: SEC 1 (Model Selector) & SEC 2 (Params & Islands) */}
      <LeftDrawer
        isOpen={isLeftDrawerOpen}
        onToggleOpen={() => setIsLeftDrawerOpen(!isLeftDrawerOpen)}
        currentModelId={modelType}
        onSelectModel={handleSelectModel}
        onFileUpload={handleFileUpload}
        voxelizeMode={options.voxelizeMode || 'surface'}
        onChangeVoxelizeMode={(m) => handleChangeOptions({ voxelizeMode: m })}
        sourceMeshMode={sourceMeshMode}
        onChangeSourceMeshMode={setSourceMeshMode}
        colorMode={colorMode}
        onChangeColorMode={setColorMode}
        islands={grid?.islands}
        selectedIslandId={selectedIslandId}
        onSelectIsland={setSelectedIslandId}
        onDiscretizeIsland={handleDiscretizeIsland}
        onDiscretizeAllIndependently={handleDiscretizeAllIndependently}
        onSolveWfcOnIsland={handleSolveWfcOnIsland}
        onRerollColors={handleRerollColors}
        isLoading={isLoading}
      />

      {/* 2. Center 3D Viewport Area */}
      <div style={{ flex: '1 1 0%', minWidth: 0, height: '100%', position: 'relative', overflow: 'hidden' }}>
        <Viewport3D
          bricks={bricks}
          grid={grid}
          mode={viewportMode}
          currentStepIndex={currentStepIndex}
          autoRotate={autoRotate}
          sourceModel={sourceModel}
          sourceMeshMode={sourceMeshMode}
          colorMode={colorMode}
          selectedIslandId={selectedIslandId}
        />

        {/* Floating Drawer Toggle Buttons */}
        <div style={{ position: 'absolute', top: 14, left: 16, zIndex: 30, display: 'flex', gap: 8 }}>
          {!isLeftDrawerOpen && (
            <button
              onClick={() => setIsLeftDrawerOpen(true)}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px solid #334155',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(8px)',
                color: '#f8fafc',
                fontWeight: 600,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
              }}
            >
              <PanelLeftIcon size={14} color="#38bdf8" />
              <span>Show Models</span>
            </button>
          )}
        </div>

        <div style={{ position: 'absolute', top: 14, right: 16, zIndex: 30, display: 'flex', gap: 8 }}>
          {!isRightDrawerOpen && (
            <button
              onClick={() => setIsRightDrawerOpen(true)}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px solid #334155',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(8px)',
                color: '#f8fafc',
                fontWeight: 600,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
              }}
            >
              <PanelRightIcon size={14} color="#38bdf8" />
              <span>Show Settings</span>
            </button>
          )}
        </div>

        {/* Top Floating HUD: Real-time BOM & Pipeline Analytics */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: isLeftDrawerOpen ? 16 : 140,
            right: isRightDrawerOpen ? 16 : 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div
            style={{
              padding: '6px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: 8,
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              color: '#f8fafc',
              fontSize: 11,
              pointerEvents: 'auto'
            }}
          >
            <div>
              <span style={{ color: '#94a3b8' }}>Phase:</span>{' '}
              <span style={{ fontWeight: 700, color: currentPhaseInfo.color }}>{currentPhaseInfo.title}</span>
            </div>

            <div style={{ width: 1, height: 14, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div>
              <span style={{ color: '#94a3b8' }}>Bricks:</span>{' '}
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>{stats.totalPlaced}</span>
            </div>

            <div>
              <span style={{ color: '#f59e0b' }}>FILL:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.fillCount}</span>
            </div>

            <div>
              <span style={{ color: '#38bdf8' }}>EDGE:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.edgeCount}</span>
            </div>

            <div>
              <span style={{ color: '#10b981' }}>LEAF:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.leafCount}</span>
            </div>

            <div style={{ width: 1, height: 14, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div>
              <span style={{ color: '#94a3b8' }}>Parts:</span>{' '}
              <span style={{ fontWeight: 700, color: '#a78bfa' }}>{stats.uniqueParts}</span>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Coverage:</span>{' '}
              <span style={{ fontWeight: 700, color: '#34d399' }}>{stats.coverage}%</span>
            </div>

            <div style={{ width: 1, height: 14, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div style={{ fontSize: 10, color: '#64748b' }}>
              Authentic LDraw System (20x20x24 LDU)
            </div>
          </div>
        </div>
      </div>

      {/* 3. Right Drawer Panel: Generation Settings, Scale, OMR, WFC, Polish */}
      <RightDrawer
        isOpen={isRightDrawerOpen}
        onToggleOpen={() => setIsRightDrawerOpen(!isRightDrawerOpen)}
        targetHeightBricks={targetHeightBricks}
        onChangeHeight={handleChangeHeight}
        options={options}
        onChangeOptions={handleChangeOptions}
        viewportMode={viewportMode}
        onChangeViewportMode={setViewportMode}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (!isPlaying) setViewportMode('GROWING_CORE');
          setIsPlaying(!isPlaying);
        }}
        onStep={() => {
          setViewportMode('GROWING_CORE');
          executeStep();
        }}
        onSolveAll={handleSolveAll}
        onReset={handleReset}
        onExportLDR={handleExportLDR}
        onOpenDatabase={() => setIsDatabaseOpen(true)}
        onOpenGallery={() => setIsGalleryOpen(true)}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        speed={speed}
        onChangeSpeed={setSpeed}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        omrCategory={omrCategory}
        onChangeOmrCategory={handleChangeOmrCategory}
        onHarmonizeNeighborhoods={handleHarmonizeNeighborhoods}
        onVerifyBuildability={handleVerifyBuildability}
        onEvaluateDistance={handleEvaluateDistance}
        distanceMetric={distanceMetric}
        buildabilityReport={buildabilityReport}
        harmonizationResult={harmonizationResult}
      />

      {/* Inspectors */}
      <ConnectorDatabaseInspector isOpen={isDatabaseOpen} onClose={() => setIsDatabaseOpen(false)} />
      <OMRGalleryInspector isOpen={isGalleryOpen} onClose={() => setIsGalleryOpen(false)} />
    </div>
  );
};
