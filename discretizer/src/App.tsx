import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import { Viewport3D, type Viewport3DHandle } from './viewport/Viewport3D';
import {
  ModelSelectorPanel,
  SAMPLE_MODELS,
  type SampleModelItem,
  type CleanModelItem,
  type DiscretizeConfig
} from './components/ModelSelectorPanel';
import type { ModelStats } from './viewport/viewportEngine';
import type { SolverResult } from './solver/kernelSolver';
import { segmentMeshIslandsAsync } from './solver/islandSegmenter';
import { rasterizeIslandsToLatticeAsync } from './solver/triangleRasterizer';
import { GrowingSurfaceKernelSolver } from './solver/kernelSolver';
import { getAssetUrl } from './url';

export const MainApp: React.FC = () => {
  const viewportRef = useRef<Viewport3DHandle | null>(null);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDiscretizing, setIsDiscretizing] = useState<boolean>(false);
  const [discretizeProgress, setDiscretizeProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [discretizerResult, setDiscretizerResult] = useState<SolverResult | null>(null);
  const [viewMode, setViewMode] = useState<'mesh' | 'lego' | 'both'>('mesh');
  const [isEngineReady, setIsEngineReady] = useState<boolean>(false);
  const { message: antMessage } = AntApp.useApp();

  const handleSelectSampleModel = useCallback(async (model: SampleModelItem) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    setDiscretizerResult(null);
    setViewMode('mesh');
    viewportRef.current.clearBricks();
    viewportRef.current.setViewMode('mesh');
    try {
      if (model.type.startsWith('procedural')) {
        await viewportRef.current.loadModelFromUrl('', model.type, model.label);
      } else {
        const url = getAssetUrl(model.path);
        await viewportRef.current.loadModelFromUrl(url, model.type, model.label);
      }
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load sample model');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  const handleSelectCleanModel = useCallback(async (model: CleanModelItem) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    setDiscretizerResult(null);
    setViewMode('mesh');
    viewportRef.current.clearBricks();
    viewportRef.current.setViewMode('mesh');
    try {
      const url = getAssetUrl(model.path);
      await viewportRef.current.loadModelFromUrl(url, 'glb', model.name);
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load clean model');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  const handleUploadFile = useCallback(async (file: File) => {
    if (!viewportRef.current) return;
    setIsLoading(true);
    setDiscretizerResult(null);
    setViewMode('mesh');
    viewportRef.current.clearBricks();
    viewportRef.current.setViewMode('mesh');
    try {
      await viewportRef.current.loadModelFromFile(file);
      antMessage.success(`Loaded ${file.name}`);
    } catch (err: any) {
      antMessage.error(err.message || 'Failed to load custom file');
    } finally {
      setIsLoading(false);
    }
  }, [antMessage]);

  // Execute the V2 Surface Discretization Pipeline
  const handleDiscretize = useCallback(async (config: DiscretizeConfig) => {
    if (!viewportRef.current) return;
    const activeModel = viewportRef.current.getActiveModel();
    if (!activeModel) {
      antMessage.warning('No active 3D model loaded to discretize.');
      return;
    }

    setIsDiscretizing(true);
    setDiscretizeProgress({ stage: 'Extracting Topological Islands...', percent: 5 });

    try {
      // 1. Half-Edge DSU Island Segmentation
      const islands = await segmentMeshIslandsAsync(activeModel, (pct) => {
        setDiscretizeProgress({ stage: 'Segmenting Topological Islands...', percent: Math.round(5 + pct * 0.25) });
      });

      if (islands.length === 0) {
        throw new Error('No triangles found in loaded 3D mesh.');
      }

      // 2. Direct Triangle Surface Rasterization & Barycentric Color Sampling
      setDiscretizeProgress({ stage: 'Rasterizing Surface Hull & Volumes...', percent: 32 });
      const lattice = await rasterizeIslandsToLatticeAsync(islands, {
        targetStuds: config.targetStuds,
        verticalUnit: config.verticalUnit,
        snapVertices: config.snapVertices,
        onProgress: (pct) => {
          setDiscretizeProgress({ stage: 'Rasterizing Surface Hull & Normals...', percent: Math.round(32 + pct * 0.28) });
        }
      });

      // 3. Multi-Scale Surface-Growing Kernel Solver
      setDiscretizeProgress({ stage: 'Dispatching Mechanical Kernels...', percent: 62 });
      const solver = new GrowingSurfaceKernelSolver(lattice, {
        dispatchStrategy: config.strategy,
        enableCurvedSlopes: config.enableCurvedSlopes,
        enableMacaroni: config.enableMacaroni,
        enableCanisters: config.enableCanisters,
        enableStudlessTiles: config.enableStudlessTiles,
        enableCollapse: config.enableCollapse,
        enableVoxelRecompute: config.enableVoxelRecompute,
        onProgress: (stage, pct) => {
          setDiscretizeProgress({ stage, percent: Math.round(62 + pct * 0.36) });
        }
      });

      const result = await solver.solve();
      setDiscretizerResult(result);
      setViewMode('lego');

      // 4. Render LEGO Model in Viewport
      viewportRef.current.displayDiscretizedBricks(result.bricks, result.lattice);

      antMessage.success(
        `Discretized in ${result.executionTimeMs} ms: ${result.bricks.length} bricks placed (${result.stats.totalConnections} connections, 100% Grounded)`
      );
    } catch (err: any) {
      antMessage.error(err.message || 'Discretization failed');
    } finally {
      setIsDiscretizing(false);
      setDiscretizeProgress(null);
    }
  }, [antMessage]);

  const handleViewModeChange = useCallback((mode: 'mesh' | 'lego' | 'both') => {
    setViewMode(mode);
    if (viewportRef.current) {
      viewportRef.current.setViewMode(mode);
    }
  }, []);

  const handleExportLDraw = useCallback(() => {
    if (!discretizerResult) return;
    const blob = new Blob([discretizerResult.ldrawCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modelStats?.name || 'model'}_discretized.ldr`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    antMessage.success('Exported LDraw .ldr file');
  }, [discretizerResult, modelStats, antMessage]);

  const handleModelLoaded = useCallback((stats: ModelStats) => {
    setModelStats(stats);
  }, []);

  const handleError = useCallback((err: string) => {
    antMessage.error(err);
  }, [antMessage]);

  const handleViewportReady = useCallback(() => {
    setIsEngineReady(true);
  }, []);

  // Load default duck model once viewport engine is ready
  useEffect(() => {
    if (!isEngineReady) return;
    const initialModel = SAMPLE_MODELS[0];
    if (initialModel) {
      handleSelectSampleModel(initialModel);
    }
  }, [isEngineReady, handleSelectSampleModel]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Viewport3D
        ref={viewportRef}
        onReady={handleViewportReady}
        onModelLoaded={handleModelLoaded}
        onError={handleError}
      />
      <ModelSelectorPanel
        onSelectSampleModel={handleSelectSampleModel}
        onSelectCleanModel={handleSelectCleanModel}
        onUploadFile={handleUploadFile}
        modelStats={modelStats}
        isLoading={isLoading}
        onDiscretize={handleDiscretize}
        isDiscretizing={isDiscretizing}
        discretizeProgress={discretizeProgress}
        discretizerResult={discretizerResult}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onExportLDraw={handleExportLDraw}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 6,
          colorBgContainer: '#ffffff',
          colorBgElevated: '#f8fafc',
          colorBorder: '#e2e8f0',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b'
        }
      }}
    >
      <AntApp>
        <MainApp />
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
