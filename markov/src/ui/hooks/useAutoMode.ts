import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { PlacedBrick, VoxelGrid, MarkovEngineOptions } from '../../engine/types';
import { MarkovCoreGrowingEngine } from '../../engine/markovCoreGrowingEngine';
import { MeshVoxelizer } from '../../engine/meshVoxelizer';
import { MeshIslandSegmenter } from '../../engine/meshIslandSegmenter';
import { MeshDistanceEvaluator, MeshDistanceResult } from '../../engine/meshDistanceMetric';
import { OMRCategory } from '../../engine/wfcRefinerEngine';
import { brickAudio } from '../../engine/brickAudio';
import { getAssetUrl } from '../../utils/url';
import { MODEL_PRESETS } from '../presets';
import { UploadedModelItem, IslandSummary, ColorMode, SourceMeshMode } from '../types';

export interface UseAutoModeParams {
  options: MarkovEngineOptions;
  targetHeightBricks: number;
  omrCategory: OMRCategory;
  uploadedModels: UploadedModelItem[];
  envelopeCacheRef: React.MutableRefObject<
    Map<string, { grid: VoxelGrid; modelObj: THREE.Object3D; islands: IslandSummary[]; rawIslands: any[] }>
  >;
  preferredSourceMeshModeRef: React.MutableRefObject<SourceMeshMode>;
  isAudioMutedRef: React.MutableRefObject<boolean>;
  setModelType: (t: string) => void;
  setModelUrl: (u: string | undefined) => void;
  setActiveCustomFile: (f: File | null) => void;
  activeCustomFileRef: React.MutableRefObject<File | null>;
  setSourceModel: (m: THREE.Object3D | null) => void;
  setGrid: (g: VoxelGrid | null) => void;
  setEngine: (e: MarkovCoreGrowingEngine | null) => void;
  setBricks: (b: PlacedBrick[]) => void;
  setCurrentStepIndex: (idx: number) => void;
  setPhase: (p: string) => void;
  setColorMode: (c: ColorMode) => void;
  setSourceMeshMode: (m: SourceMeshMode) => void;
  setIsPlaying: (p: boolean) => void;
  setIsLoading: (l: boolean) => void;
  setLoadingMessage: (msg: string) => void;
  setStats: (s: any) => void;
  setHarmonizationResult: (h: any) => void;
  setBuildabilityReport: (b: any) => void;
  setDistanceMetric: (d: MeshDistanceResult | null) => void;
}

export function useAutoMode({
  options,
  targetHeightBricks,
  omrCategory,
  uploadedModels,
  envelopeCacheRef,
  preferredSourceMeshModeRef,
  isAudioMutedRef,
  setModelType,
  setModelUrl,
  setActiveCustomFile,
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
}: UseAutoModeParams) {
  const [isAutoMode, setIsAutoMode] = useState<boolean>(false);
  const isAutoModeRef = useRef<boolean>(false);
  const autoTimerRef = useRef<any>(null);
  const manifestModelsRef = useRef<Array<{ id: string; name: string; url?: string }>>([]);
  const [tweenKey, setTweenKey] = useState<number>(0);
  const currentAllBricksRef = useRef<PlacedBrick[]>([]);
  const autoPlaylistRef = useRef<Array<{ id: string; name: string; url?: string; file?: File }>>([]);
  const lastPlayedModelIdRef = useRef<string | null>(null);

  // Prefetch catalog for random candidate selection in Auto mode
  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const res = await fetch(getAssetUrl('models/clean_manifest.json'));
        if (res.ok) {
          const data = await res.json();
          const items: Array<{ id: string; name: string; url?: string }> = [];
          if (data.categories) {
            for (const cat of data.categories) {
              if (cat.models) {
                for (const m of cat.models) {
                  items.push({
                    id: m.id,
                    name: m.name,
                    url: getAssetUrl(m.path)
                  });
                }
              }
            }
          }
          manifestModelsRef.current = items;
        }
      } catch (e) {
        console.warn('Could not prefetch clean models manifest in useAutoMode', e);
      }
    };
    fetchCatalog();
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      isAutoModeRef.current = false;
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, []);

  // Candidate pool for random mesh selection in Auto mode (deduplicated by id)
  const getCandidateModels = useCallback(() => {
    const map = new Map<string, { id: string; name: string; url?: string; file?: File }>();

    // 1. Uploaded models in memory
    for (const u of uploadedModels) {
      map.set(u.id, { id: u.id, name: u.name, file: u.file });
    }

    // 2. Manifest clean catalog models
    for (const m of manifestModelsRef.current) {
      map.set(m.id, { id: m.id, name: m.name, url: m.url });
    }

    // 3. Preset models
    for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
      if (!map.has(key) && !key.includes('beetle')) {
        map.set(key, { id: key, name: preset.label, url: preset.url });
      }
    }

    return Array.from(map.values());
  }, [uploadedModels]);

  // Non-repeating random playlist selector
  const getNextAutoModel = useCallback((): { id: string; name: string; url?: string; file?: File } | null => {
    if (autoPlaylistRef.current.length === 0) {
      const all = getCandidateModels();
      if (all.length === 0) return null;
      // Fisher-Yates shuffle to build a non-repeating random playlist
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      if (shuffled.length > 1 && shuffled[0].id === lastPlayedModelIdRef.current) {
        [shuffled[0], shuffled[shuffled.length - 1]] = [shuffled[shuffled.length - 1], shuffled[0]];
      }
      autoPlaylistRef.current = shuffled;
    }
    const next = autoPlaylistRef.current.shift() || null;
    if (next) {
      lastPlayedModelIdRef.current = next.id;
    }
    return next;
  }, [getCandidateModels]);

  // Compute model to completion for Auto mode
  const computeModelAsync = async (candidate: {
    id: string;
    name: string;
    url?: string;
    file?: File;
  }): Promise<PlacedBrick[]> => {
    setIsPlaying(false);
    setIsLoading(true);
    setColorMode('island_components');
    setLoadingMessage(`Loading ${candidate.name}...`);
    setModelType(candidate.id);
    setModelUrl(candidate.url);
    if (candidate.file) {
      setActiveCustomFile(candidate.file);
      activeCustomFileRef.current = candidate.file;
    } else {
      setActiveCustomFile(null);
      activeCustomFileRef.current = null;
    }

    const modelKey = candidate.file
      ? `file_${candidate.file.name}_${candidate.file.size}`
      : candidate.url || candidate.id;
    const vMode = options.voxelizeMode || 'surface';
    const envKey = `${modelKey}_h${targetHeightBricks}_m${vMode}`;

    try {
      let modelObj: THREE.Object3D;
      let newGrid: VoxelGrid;

      if (envelopeCacheRef.current.has(envKey)) {
        const cached = envelopeCacheRef.current.get(envKey)!;
        modelObj = cached.modelObj;
        newGrid = cached.grid;
      } else {
        if (candidate.file) {
          modelObj = await MeshVoxelizer.loadModel(candidate.file);
        } else if (candidate.url) {
          modelObj = await MeshVoxelizer.loadModel(candidate.url);
        } else {
          const preset = MODEL_PRESETS[candidate.id] || MODEL_PRESETS['cars/vwbeetle.glb'];
          modelObj = await MeshVoxelizer.loadModel(preset.url);
        }

        const islands = await MeshIslandSegmenter.segmentObjectAsync(modelObj, 0.0005);
        const islandSummaries: IslandSummary[] = islands.map((isl) => ({
          id: isl.id,
          name: isl.name,
          triangleCount: isl.triangleCount,
          colorHex: isl.colorHex
        }));

        newGrid = MeshVoxelizer.voxelizeObject(modelObj, {
          targetHeightBricks,
          voxelizeMode: options.voxelizeMode || 'surface',
          precomputedIslands: islands
        });

        envelopeCacheRef.current.set(envKey, {
          grid: newGrid,
          modelObj,
          islands: islandSummaries,
          rawIslands: islands
        });
      }

      const newEngine = new MarkovCoreGrowingEngine(newGrid, options);
      newEngine.setOmrCategory(omrCategory);
      const res = newEngine.solveAll(3000);
      const solvedBricks = Array.from(newEngine.placedBricks.values());
      currentAllBricksRef.current = solvedBricks;

      setSourceModel(modelObj);
      setGrid(newGrid);
      setEngine(newEngine);
      setHarmonizationResult(newEngine.harmonizationResult);
      setBuildabilityReport(newEngine.buildabilityReport);
      if (modelObj && newGrid) {
        setDistanceMetric(MeshDistanceEvaluator.evaluate(solvedBricks, modelObj, newGrid));
      }
      setStats({
        totalPlaced: res.totalPlacedBricks,
        leafCount: res.bomStats.leafCount,
        edgeCount: res.bomStats.edgeCount,
        fillCount: res.bomStats.fillCount,
        uniqueParts: res.bomStats.uniquePartCount,
        coverage: Math.round(res.coverageRatio * 100)
      });

      return solvedBricks;
    } finally {
      setIsLoading(false);
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      autoTimerRef.current = setTimeout(resolve, ms);
    });

  const runAutoCycle = async () => {
    if (!isAutoModeRef.current) return;

    const candidate = getNextAutoModel();
    if (!candidate) return;

    let allBricks: PlacedBrick[] = [];
    try {
      allBricks = await computeModelAsync(candidate);
    } catch (e) {
      console.warn('Auto mode candidate compute failed, skipping:', e);
      if (isAutoModeRef.current) {
        autoTimerRef.current = setTimeout(runAutoCycle, 500);
      }
      return;
    }

    if (!isAutoModeRef.current || allBricks.length === 0) return;

    setTweenKey((prev) => prev + 1);

    // 1. Build progressively
    setBricks([]);
    setColorMode('island_components');
    setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');
    setPhase('SURFACE_SHELL');

    const totalBricks = allBricks.length;
    const batchStep = Math.max(1, Math.ceil(totalBricks / 80));
    let visibleCount = 0;

    while (visibleCount < totalBricks) {
      if (!isAutoModeRef.current) return;
      visibleCount = Math.min(totalBricks, visibleCount + batchStep);
      setBricks(allBricks.slice(0, visibleCount));
      setCurrentStepIndex(visibleCount);
      if (!isAudioMutedRef.current) {
        brickAudio.triggerBrickPlacement(visibleCount);
      }
      await sleep(25);
    }

    if (!isAutoModeRef.current) return;

    // 2. Model is fully built: switch to final colors, hide source mesh, and stay on screen for 5 seconds
    setBricks(allBricks);
    setColorMode('actual');
    setSourceMeshMode('none');
    setPhase('DONE');

    await sleep(5000);

    if (!isAutoModeRef.current) return;

    // 3. Unbuild: play build sequence backwards with final colors
    setColorMode('actual');
    while (visibleCount > 0) {
      if (!isAutoModeRef.current) return;
      visibleCount = Math.max(0, visibleCount - batchStep);
      setBricks(allBricks.slice(0, visibleCount));
      setCurrentStepIndex(visibleCount);
      await sleep(25);
    }

    if (!isAutoModeRef.current) return;

    // 4. When the last brick disappears, load next model
    setBricks([]);
    runAutoCycle();
  };

  const handleToggleAuto = () => {
    if (isAutoMode) {
      setIsAutoMode(false);
      isAutoModeRef.current = false;
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
      if (currentAllBricksRef.current && currentAllBricksRef.current.length > 0) {
        setBricks(currentAllBricksRef.current);
        setColorMode('actual');
        setSourceMeshMode('none');
        setPhase('DONE');
      }
    } else {
      setIsAutoMode(true);
      isAutoModeRef.current = true;
      runAutoCycle();
    }
  };

  return {
    isAutoMode,
    isAutoModeRef,
    tweenKey,
    handleToggleAuto
  };
}
