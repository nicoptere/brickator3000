import { useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { VoxelGrid, MarkovEngineOptions } from '../../engine/types';
import { MarkovCoreGrowingEngine } from '../../engine/markovCoreGrowingEngine';
import { MeshVoxelizer } from '../../engine/meshVoxelizer';
import { MeshIslandSegmenter } from '../../engine/meshIslandSegmenter';
import { OMRCategory } from '../../engine/wfcRefinerEngine';
import { getAssetUrl } from '../../utils/url';
import { MODEL_PRESETS } from '../presets';
import { PreprocessState, IslandSummary, UploadedModelItem, SourceMeshMode } from '../types';

export interface UseModelVoxelizerParams {
  omrCategory: OMRCategory;
  options: MarkovEngineOptions;
  onModelReady?: (engine: MarkovCoreGrowingEngine, modelObj: THREE.Object3D, grid: VoxelGrid) => void;
  isAutoModeRef: React.MutableRefObject<boolean>;
}

export function useModelVoxelizer({
  omrCategory,
  options,
  onModelReady,
  isAutoModeRef
}: UseModelVoxelizerParams) {
  const [modelType, setModelType] = useState<string>('architecture/nordstad.glb');
  const [modelUrl, setModelUrl] = useState<string | undefined>(getAssetUrl('models/clean/architecture/nordstad.glb'));
  const [targetHeightBricks, setTargetHeightBricks] = useState<number>(16);
  const [sourceMeshMode, setSourceMeshMode] = useState<SourceMeshMode>('ghost');
  const preferredSourceMeshModeRef = useRef<SourceMeshMode>('ghost');

  const handleUserChangeSourceMeshMode = (mode: SourceMeshMode) => {
    if (mode !== 'none') {
      preferredSourceMeshModeRef.current = mode;
    }
    setSourceMeshMode(mode);
  };

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('Loading 3D model & segmenting islands...');

  const [preprocessState, setPreprocessState] = useState<PreprocessState>({
    isOpen: false,
    modelName: 'Nordstad',
    progressPercent: 0,
    stageTitle: 'Loading 3D Model',
    stageDetail: 'Fetching geometry buffers and texture assets...',
    currentStageIndex: 0,
    detectedIslands: []
  });

  const [sourceModel, setSourceModel] = useState<THREE.Object3D | null>(null);
  const [grid, setGrid] = useState<VoxelGrid | null>(null);
  const [engine, setEngine] = useState<MarkovCoreGrowingEngine | null>(null);

  const [uploadedModels, setUploadedModels] = useState<UploadedModelItem[]>([]);
  const [activeCustomFile, setActiveCustomFile] = useState<File | null>(null);
  const activeCustomFileRef = useRef<File | null>(null);

  // In-memory envelope cache
  const envelopeCacheRef = useRef<
    Map<string, { grid: VoxelGrid; modelObj: THREE.Object3D; islands: IslandSummary[]; rawIslands: any[] }>
  >(new Map());

  const initializeModel = useCallback(
    async (
      type: string,
      heightBricks: number,
      opts: MarkovEngineOptions,
      customFile?: File,
      customUrl?: string
    ) => {
      setIsLoading(true);
      setLoadingMessage('Loading authentic 3D model & extracting half-edge islands...');

      let displayName = 'Nordstad';
      if (customFile) {
        displayName = customFile.name;
      } else {
        const rawUrl = customUrl || type;
        const filename = rawUrl.split('/').pop()?.replace(/\.(glb|gltf|obj|ply)$/i, '') || 'Nordstad';
        if (filename.toLowerCase().includes('nordstad')) displayName = 'Nordstad';
        else if (filename.toLowerCase().includes('beetle')) displayName = 'VW Beetle';
        else if (filename.toLowerCase().includes('mini')) displayName = 'Mini Cooper';
        else if (filename.toLowerCase().includes('concord')) displayName = 'Concorde';
        else displayName = filename.charAt(0).toUpperCase() + filename.slice(1);
      }

      const modelKey = customFile ? `file_${customFile.name}_${customFile.size}` : (customUrl || type);
      const vMode = opts.voxelizeMode || 'surface';
      const envKey = `${modelKey}_h${heightBricks}_m${vMode}`;

      // Envelope cache hit (re-selection at same resolution)
      if (envelopeCacheRef.current.has(envKey)) {
        const cached = envelopeCacheRef.current.get(envKey)!;
        setIsLoading(false);
        setPreprocessState((prev) => ({ ...prev, isOpen: false }));

        const newEngine = new MarkovCoreGrowingEngine(cached.grid, opts);
        newEngine.setOmrCategory(omrCategory);

        setSourceModel(cached.modelObj);
        setGrid(cached.grid);
        setEngine(newEngine);
        setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');

        if (onModelReady) {
          onModelReady(newEngine, cached.modelObj, cached.grid);
        }
        return;
      }

      setPreprocessState({
        isOpen: !isAutoModeRef.current,
        modelName: displayName,
        progressPercent: 5,
        stageTitle: 'Loading 3D Geometry & Textures',
        stageDetail: 'Fetching asset buffers and decoding meshes...',
        currentStageIndex: 0,
        detectedIslands: []
      });

      await new Promise((r) => setTimeout(r, 40));

      try {
        const onProgress = (loaded: number, total: number) => {
          if (total > 0) {
            const percent = Math.min(24, Math.round((loaded / total) * 20) + 4);
            const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
            const totalMb = (total / (1024 * 1024)).toFixed(1);
            const detail = `Downloading 3D geometry: ${loadedMb} MB / ${totalMb} MB (${Math.round((loaded / total) * 100)}%)...`;
            setLoadingMessage(detail);
            setPreprocessState((prev) => ({
              ...prev,
              progressPercent: percent,
              stageDetail: detail
            }));
          }
        };

        let modelObj: THREE.Object3D;
        if (customFile) {
          modelObj = await MeshVoxelizer.loadModel(customFile, onProgress);
        } else if (customUrl) {
          modelObj = await MeshVoxelizer.loadModel(customUrl, onProgress);
        } else {
          const preset = MODEL_PRESETS[type] || MODEL_PRESETS['cars/vwbeetle.glb'] || MODEL_PRESETS['beetle'];
          try {
            modelObj = await MeshVoxelizer.loadModel(preset.url, onProgress);
          } catch (err) {
            console.warn(`Could not load model at ${preset.url}, using procedural model`, err);
            modelObj = MeshVoxelizer.createSampleModel(preset.fallbackType);
          }
        }

        setPreprocessState((prev) => ({
          ...prev,
          progressPercent: 25,
          stageTitle: 'Topological Island Extraction',
          stageDetail: 'Building half-edge adjacency graph and stitching UV seams...',
          currentStageIndex: 1
        }));
        await new Promise((r) => setTimeout(r, 30));

        const islands = await MeshIslandSegmenter.segmentObjectAsync(
          modelObj,
          0.0005,
          (subRatio, statusText) => {
            const mappedPercent = Math.round(25 + subRatio * 35);
            setPreprocessState((prev) => ({
              ...prev,
              progressPercent: mappedPercent,
              stageDetail: statusText
            }));
          }
        );

        const islandSummaries: IslandSummary[] = islands.map((isl) => ({
          id: isl.id,
          name: isl.name,
          triangleCount: isl.triangleCount,
          colorHex: isl.colorHex
        }));

        setPreprocessState((prev) => ({
          ...prev,
          progressPercent: 62,
          stageTitle: 'Surface & Envelope Voxelization',
          stageDetail: `Discretizing surface across ${heightBricks} brick layers with direct RGB colors...`,
          currentStageIndex: 2,
          detectedIslands: islandSummaries
        }));
        await new Promise((r) => setTimeout(r, 30));

        const newGrid = MeshVoxelizer.voxelizeObject(modelObj, {
          targetHeightBricks: heightBricks,
          voxelizeMode: opts.voxelizeMode || 'surface',
          precomputedIslands: islands
        });

        envelopeCacheRef.current.set(envKey, {
          grid: newGrid,
          modelObj,
          islands: islandSummaries,
          rawIslands: islands
        });

        setPreprocessState((prev) => ({
          ...prev,
          progressPercent: 88,
          stageTitle: 'Initialize Markov Core Engine',
          stageDetail: 'Synthesizing multi-head growth seeds and querying OMR tensor...',
          currentStageIndex: 3
        }));
        await new Promise((r) => setTimeout(r, 30));

        const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);
        newEngine.setOmrCategory(omrCategory);

        setSourceModel(modelObj);
        setGrid(newGrid);
        setEngine(newEngine);
        setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');

        setPreprocessState((prev) => ({
          ...prev,
          progressPercent: 100,
          stageTitle: 'Mesh Pre-Processing Complete',
          stageDetail: `Extracted ${islands.length} topological islands. Starting live model growth!`,
          currentStageIndex: 4
        }));
        await new Promise((r) => setTimeout(r, 260));
        setPreprocessState((prev) => ({ ...prev, isOpen: false }));

        if (onModelReady) {
          onModelReady(newEngine, modelObj, newGrid);
        }
      } catch (err: any) {
        console.error('Failed to initialize model:', err);
        setPreprocessState((prev) => ({ ...prev, isOpen: false }));
        const fallbackObj = MeshVoxelizer.createSampleModel('car');
        const newGrid = MeshVoxelizer.voxelizeObject(fallbackObj, {
          targetHeightBricks: heightBricks,
          voxelizeMode: opts.voxelizeMode || 'surface'
        });
        const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);
        setSourceModel(fallbackObj);
        setGrid(newGrid);
        setEngine(newEngine);
        setSourceMeshMode(preferredSourceMeshModeRef.current || 'ghost');

        if (onModelReady) {
          onModelReady(newEngine, fallbackObj, newGrid);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [omrCategory, onModelReady, isAutoModeRef]
  );

  const handleSelectModel = (type: string, url?: string) => {
    setActiveCustomFile(null);
    activeCustomFileRef.current = null;
    setModelType(type);
    setModelUrl(url);
    initializeModel(type, targetHeightBricks, options, undefined, url);
  };

  const handleChangeHeight = (h: number) => {
    setTargetHeightBricks(h);
    initializeModel(modelType, h, options, activeCustomFileRef.current || undefined, modelUrl);
  };

  const handleFileUpload = (file: File) => {
    const id = `custom_${file.name}_${Date.now()}`;
    const sizeFormatted =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(file.size / 1024)} KB`;
    const newItem: UploadedModelItem = {
      id,
      name: file.name.replace(/\.(glb|gltf|obj|ply)$/i, ''),
      file,
      sizeFormatted,
      timestamp: Date.now()
    };

    setUploadedModels((prev) => {
      const filtered = prev.filter((m) => m.name !== newItem.name);
      return [newItem, ...filtered];
    });

    setActiveCustomFile(file);
    activeCustomFileRef.current = file;
    setModelType(id);
    setModelUrl(undefined);
    initializeModel(id, targetHeightBricks, options, file);
  };

  const handleSelectUploadedModel = (item: UploadedModelItem) => {
    if (item.file) {
      setActiveCustomFile(item.file);
      activeCustomFileRef.current = item.file;
      setModelType(item.id);
      setModelUrl(undefined);
      initializeModel(item.id, targetHeightBricks, options, item.file);
    }
  };

  const handleReloadUploadedModel = (item: UploadedModelItem) => {
    handleSelectUploadedModel(item);
  };

  return {
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
    setPreprocessState,
    sourceModel,
    setSourceModel,
    grid,
    setGrid,
    engine,
    setEngine,
    uploadedModels,
    activeCustomFile,
    activeCustomFileRef,
    envelopeCacheRef,
    initializeModel,
    handleSelectModel,
    handleChangeHeight,
    handleFileUpload,
    handleSelectUploadedModel,
    handleReloadUploadedModel
  };
}
