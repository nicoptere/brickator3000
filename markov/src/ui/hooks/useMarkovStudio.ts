import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { PlacedBrick, VoxelGrid, MarkovEngineOptions, GrowthStepResult } from '../../engine/types';
import { MarkovCoreGrowingEngine } from '../../engine/markovCoreGrowingEngine';
import { PolishHarmonizer, HarmonizationResult, BuildabilityReport } from '../../engine/polishHarmonizer';
import { WFC_REFINER, OMRCategory } from '../../engine/wfcRefinerEngine';
import { MeshDistanceEvaluator, MeshDistanceResult } from '../../engine/meshDistanceMetric';
import { LDrawExporter } from '../../engine/ldrawExporter';
import { MeshIslandSegmenter } from '../../engine/meshIslandSegmenter';
import { brickAudio } from '../../engine/brickAudio';
import { getAssetUrl } from '../../utils/url';
import { PHASE_LABELS } from '../presets';
import { ColorMode, ThemeMode } from '../types';
import { useModelVoxelizer } from './useModelVoxelizer';
import { useAutoMode } from './useAutoMode';

export function useMarkovStudio() {
  const [colorMode, setColorMode] = useState<ColorMode>('island_components');
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);

  // Two Drawer visibility states
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState<boolean>(true);
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState<boolean>(true);

  const [colorSeed, setColorSeed] = useState<number>(1);
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [speed, setSpeed] = useState<number>(6);

  // Audio State
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const isAudioMutedRef = useRef<boolean>(false);
  const handleToggleAudio = () => {
    const newMuted = !isAudioMuted;
    setIsAudioMuted(newMuted);
    isAudioMutedRef.current = newMuted;
    brickAudio.setMuted(newMuted);
    if (!newMuted) {
      brickAudio.unlock();
      brickAudio.triggerBrickPlacement();
    }
  };

  // Modals
  const [isDatabaseOpen, setIsDatabaseOpen] = useState<boolean>(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

  // Engine & Simulation State
  const [bricks, setBricks] = useState<PlacedBrick[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>('SURFACE_SHELL');

  const [options, setOptions] = useState<MarkovEngineOptions>({
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: true,
    enablePolishPass: true,
    enableBuildabilityVerify: true,
    enableVerticalPolesToCylinders: false,
    voxelizeMode: 'surface',
    batchStepSize: 4,
    directRGBSampling: true
  });

  const [stats, setStats] = useState({
    totalPlaced: 0,
    leafCount: 0,
    edgeCount: 0,
    fillCount: 0,
    uniqueParts: 0,
    coverage: 0
  });

  const [omrCategory, setOmrCategory] = useState<OMRCategory>('architecture');
  const [distanceMetric, setDistanceMetric] = useState<MeshDistanceResult | null>(null);
  const [buildabilityReport, setBuildabilityReport] = useState<BuildabilityReport | null>(null);
  const [harmonizationResult, setHarmonizationResult] = useState<HarmonizationResult | null>(null);

  const isAutoModeRef = useRef<boolean>(false);

  // Model Voxelizer Hook
  const {
    modelType,
    setModelType,
    modelUrl,
    setModelUrl,
    targetHeightBricks,
    setTargetHeightBricks,
    sourceMeshMode,
    setSourceMeshMode,
    preferredSourceMeshModeRef,
    handleUserChangeSourceMeshMode,
    isLoading,
    setIsLoading,
    loadingMessage,
    setLoadingMessage,
    preprocessState,
    sourceModel,
    setSourceModel,
    grid,
    setGrid,
    engine,
    setEngine,
    uploadedModels,
    activeCustomFileRef,
    envelopeCacheRef,
    initializeModel,
    handleSelectModel,
    handleChangeHeight,
    handleFileUpload,
    handleSelectUploadedModel,
    handleReloadUploadedModel
  } = useModelVoxelizer({
    omrCategory,
    options,
    isAutoModeRef,
    onModelReady: (newEngine) => {
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
      setHarmonizationResult(null);
      setBuildabilityReport(null);
      setDistanceMetric(null);
      setColorMode('island_components');
      setIsPlaying(true);
    }
  });

  // Auto Slideshow Hook
  const { isAutoMode, tweenKey, handleToggleAuto } = useAutoMode({
    options,
    targetHeightBricks,
    omrCategory,
    uploadedModels,
    envelopeCacheRef,
    preferredSourceMeshModeRef,
    isAudioMutedRef,
    setModelType,
    setModelUrl,
    setActiveCustomFile: () => {},
    activeCustomFileRef,
    setSourceModel,
    setGrid,
    setEngine,
    setBricks,
    setCurrentStepIndex,
    setPhase,
    setColorMode,
    setSourceMeshMode,
    setIsPlaying,
    setIsLoading,
    setLoadingMessage,
    setStats,
    setHarmonizationResult,
    setBuildabilityReport,
    setDistanceMetric
  });

  // Synchronize ref
  isAutoModeRef.current = isAutoMode;

  // Initialize on mount: load Nordstad by default
  useEffect(() => {
    initializeModel(
      'architecture/nordstad.glb',
      16,
      options,
      undefined,
      getAssetUrl('models/clean/architecture/nordstad.glb')
    );
  }, []);

  // Resize WebGL canvas whenever drawers open or close
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 40);
    return () => clearTimeout(timer);
  }, [isLeftDrawerOpen, isRightDrawerOpen]);

  // Harmonize Neighborhoods Polish Pass
  const handleHarmonizeNeighborhoods = () => {
    if (!engine || !grid || bricks.length === 0) return;
    setIsPlaying(false);
    const result = engine.harmonizeNeighborhoods();
    setHarmonizationResult(result);
    const updated = Array.from(engine.placedBricks.values());
    setBricks(updated);
    setStats((prev) => ({
      ...prev,
      uniqueParts: new Set(updated.map((b) => b.partId)).size
    }));
  };

  // Verify Buildability with BFS Physical Grounding
  const handleVerifyBuildability = () => {
    if (!engine || !grid || bricks.length === 0) return;
    setIsPlaying(false);
    const report = engine.verifyBuildability();
    setBuildabilityReport(report);
  };

  const handleChangeOptions = (newOpts: Partial<MarkovEngineOptions>) => {
    const merged = { ...options, ...newOpts };
    setOptions(merged);

    // If only polish or buildability was toggled on an existing solved model, execute immediately
    const onlyPolishOrBuildToggled = Object.keys(newOpts).every(
      (k) => k === 'enablePolishPass' || k === 'enableBuildabilityVerify'
    );
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

    // Envelope Invariant: If resolution and voxelizeMode haven't changed, reuse the existing grid envelope immediately!
    const voxelModeChanged = newOpts.voxelizeMode && newOpts.voxelizeMode !== options.voxelizeMode;
    if (grid && sourceModel && !voxelModeChanged) {
      setIsPlaying(false);
      const newEngine = new MarkovCoreGrowingEngine(grid, merged);
      newEngine.setOmrCategory(omrCategory);
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
      setHarmonizationResult(null);
      setBuildabilityReport(null);
      setDistanceMetric(null);
      setColorMode('island_components');
      setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');
      setIsPlaying(true);
      return;
    }

    initializeModel(modelType, targetHeightBricks, merged, activeCustomFileRef.current || undefined, modelUrl);
  };

  const handleChangeOmrCategory = (cat: OMRCategory) => {
    setOmrCategory(cat);
    if (engine) {
      engine.setOmrCategory(cat);
    }
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

    if (!isAudioMutedRef.current) {
      brickAudio.triggerBrickPlacement(res.stepIndex);
    }

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
      setHarmonizationResult(engine.harmonizationResult);
      setBuildabilityReport(engine.buildabilityReport);
      if (sourceModel && grid) {
        setDistanceMetric(MeshDistanceEvaluator.evaluate(Array.from(engine.placedBricks.values()), sourceModel, grid));
      }
      setColorMode('actual');
      setSourceMeshMode('none');
      return false;
    }

    return true;
  }, [engine, sourceModel, grid, setSourceMeshMode]);

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
    timeoutId = setTimeout(loop, 250 / speed);

    return () => clearTimeout(timeoutId);
  }, [isPlaying, executeStep, speed]);

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
    setPhase(engine.currentPhase);
    setColorMode('actual');
    setSourceMeshMode('none');
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
    setPhase(engine.currentPhase);
    setColorMode('actual');
    setSourceMeshMode('none');
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
    setColorMode('actual');
    setSourceMeshMode('none');
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
    if (!grid || !sourceModel) {
      initializeModel(modelType, targetHeightBricks, options, activeCustomFileRef.current || undefined, modelUrl);
      return;
    }
    setIsPlaying(false);
    setColorMode('island_components');
    setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');
    const newEngine = new MarkovCoreGrowingEngine(grid, options);
    newEngine.setOmrCategory(omrCategory);
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
    setHarmonizationResult(null);
    setBuildabilityReport(null);
    setDistanceMetric(null);
    setIsPlaying(false);
  };

  const handleExportLDR = () => {
    if (bricks.length === 0) return;
    const content = LDrawExporter.exportToLDraw(bricks, `Brickator_${modelType}`, options.directRGBSampling);
    LDrawExporter.downloadLDrawFile(content, `brickator_${modelType}.ldr`);
  };

  const currentPhaseInfo = PHASE_LABELS[phase] || { title: phase, color: '#2563eb' };

  return {
    modelType,
    modelUrl,
    targetHeightBricks,
    sourceMeshMode,
    handleUserChangeSourceMeshMode,
    colorMode,
    setColorMode,
    selectedIslandId,
    setSelectedIslandId,
    isLeftDrawerOpen,
    setIsLeftDrawerOpen,
    isRightDrawerOpen,
    setIsRightDrawerOpen,
    themeMode,
    setThemeMode,
    speed,
    setSpeed,
    isAudioMuted,
    handleToggleAudio,
    isDatabaseOpen,
    setIsDatabaseOpen,
    isGalleryOpen,
    setIsGalleryOpen,
    isLoading,
    loadingMessage,
    preprocessState,
    sourceModel,
    grid,
    engine,
    bricks,
    currentStepIndex,
    isPlaying,
    setIsPlaying,
    phase,
    currentPhaseInfo,
    options,
    stats,
    omrCategory,
    distanceMetric,
    buildabilityReport,
    harmonizationResult,
    uploadedModels,
    isAutoMode,
    tweenKey,
    handleToggleAuto,
    handleSelectModel,
    handleChangeHeight,
    handleChangeOptions,
    handleChangeOmrCategory,
    handleFileUpload,
    handleSelectUploadedModel,
    handleReloadUploadedModel,
    executeStep,
    handleHarmonizeNeighborhoods,
    handleVerifyBuildability,
    handleEvaluateDistance,
    handleSolveAll,
    handleDiscretizeIsland,
    handleDiscretizeAllIndependently,
    handleSolveWfcOnIsland,
    handleRerollColors,
    handleReset,
    handleExportLDR
  };
}
