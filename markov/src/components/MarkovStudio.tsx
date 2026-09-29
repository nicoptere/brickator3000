/**
 * Brickator3000 // Markov Discretization Studio Master Dashboard.
 *
 * Coordinates:
 * - 3D Viewport with authentic LEGO rendering & Source 3D Mesh Overlay
 * - Control panel with model selection (Duck, Dolphin, Mini, Beetle, Concorde, Delacroix, Castle)
 * - 4-Phase Discretization Pipeline:
 *   1. Forward Volume Fill (1x1 Plates with direct RGB sampled colors)
 *   2. Backwards Agglomerative Brick Merging (Interlocking running bond)
 *   3. Exterior Surface Replacement (Curved slopes, inverted slopes, macaroni, horns)
 *   4. Studless Top Finish (Smooth flat tiles)
 * - Interactive step scrubbing timeline
 * - Real-time BOM & graph statistics HUD
 * - Connector Database and OMR Gallery modal inspectors
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import confetti from 'canvas-confetti';
import { Viewport3D, ViewportMode, SourceMeshMode } from './Viewport3D';
import { ControlPanel } from './ControlPanel';
import { ConnectorDatabaseInspector } from './ConnectorDatabaseInspector';
import { OMRGalleryInspector } from './OMRGalleryInspector';

import { VoxelGrid, PlacedBrick, MarkovEngineOptions, GrowthStepResult } from '../engine/types';
import { MeshVoxelizer } from '../engine/meshVoxelizer';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { LDrawExporter } from '../engine/ldrawExporter';
import { brickAudio } from '../engine/brickAudio';

const MODEL_PRESETS: Record<
  string,
  { label: string; url: string; fallbackType: 'duck' | 'car' | 'dolphin' | 'airplane' | 'dome_creature' }
> = {
  duck: { label: 'Duck', url: '/sample_models/duck.glb', fallbackType: 'duck' },
  dolphin: { label: 'Dolphin', url: '/sample_models/dolphin.glb', fallbackType: 'dolphin' },
  mini: { label: 'Mini Cooper', url: '/models/clean/cars/mini.glb', fallbackType: 'car' },
  beetle: { label: 'VW Beetle', url: '/models/clean/cars/vwbeetle.glb', fallbackType: 'car' },
  concorde: { label: 'Concorde', url: '/models/clean/airplanes/concord.glb', fallbackType: 'airplane' },
  delacroix: { label: 'Delacroix', url: '/sample_models/delacroix_low_poly.ply', fallbackType: 'dome_creature' },
  prison: { label: 'Castle', url: '/sample_models/prison_0.obj', fallbackType: 'dome_creature' }
};

const PHASE_LABELS: Record<string, { title: string; color: string }> = {
  VOLUME_FILL: { title: '1. VOLUME FILL (1x1 PLATES)', color: '#38bdf8' },
  SURFACE_REPLACE: { title: '2. EXTERIOR SLOPES/TILES', color: '#a855f7' },
  OPTIMIZE_MERGE: { title: '3. BACKWARDS BRICK MERGE', color: '#f59e0b' },
  TILE_FINISH: { title: '4. STUDLESS FINISH', color: '#10b981' },
  DONE: { title: '5. BUILD COMPLETE', color: '#34d399' }
};

export const MarkovStudio: React.FC = () => {
  const [modelType, setModelType] = useState<string>('duck');
  const [targetHeightPlates, setTargetHeightPlates] = useState<number>(24);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('GROWING_CORE');
  const [sourceMeshMode, setSourceMeshMode] = useState<SourceMeshMode>('ghost');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(6);

  // Modals
  const [isDatabaseOpen, setIsDatabaseOpen] = useState<boolean>(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

  // Loading state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('Loading 3D model...');

  // Engine & Simulation State
  const [sourceModel, setSourceModel] = useState<THREE.Object3D | null>(null);
  const [grid, setGrid] = useState<VoxelGrid | null>(null);
  const [engine, setEngine] = useState<MarkovCoreGrowingEngine | null>(null);
  const [bricks, setBricks] = useState<PlacedBrick[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>('VOLUME_FILL');

  const [options, setOptions] = useState<MarkovEngineOptions>({
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: true,
    directRGBSampling: true,
    batchStepSize: 16
  });

  const [stats, setStats] = useState({
    totalPlaced: 0,
    leafCount: 0,
    edgeCount: 0,
    fillCount: 0,
    uniqueParts: 0,
    coverage: 0
  });

  // Re-build Voxel Grid from authentic 3D model or custom upload
  const initializeModel = useCallback(
    async (type: string, heightPlates: number, opts: MarkovEngineOptions, customFile?: File) => {
      setIsPlaying(false);
      setIsLoading(true);
      setLoadingMessage('Loading authentic 3D model & materials...');

      try {
        let modelObj: THREE.Object3D;
        if (customFile) {
          modelObj = await MeshVoxelizer.loadModel(customFile);
        } else {
          const preset = MODEL_PRESETS[type] || MODEL_PRESETS['duck'];
          try {
            modelObj = await MeshVoxelizer.loadModel(preset.url);
          } catch (err) {
            console.warn(`Could not load model at ${preset.url}, using procedural model`, err);
            modelObj = MeshVoxelizer.createSampleModel(preset.fallbackType);
          }
        }

        setLoadingMessage('Voxelizing 3D volume into 1x1 plates & sampling colors...');
        const newGrid = MeshVoxelizer.voxelizeObject(modelObj, {
          targetHeightPlates: heightPlates
        });

        const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);

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
        const fallbackObj = MeshVoxelizer.createSampleModel('duck');
        const newGrid = MeshVoxelizer.voxelizeObject(fallbackObj, { targetHeightPlates: heightPlates });
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
    initializeModel(modelType, targetHeightPlates, options);
  }, []);

  const handleSelectModel = (type: string) => {
    setModelType(type);
    initializeModel(type, targetHeightPlates, options);
  };

  const handleChangeHeight = (h: number) => {
    setTargetHeightPlates(h);
    initializeModel(modelType, h, options);
  };

  const handleChangeOptions = (newOpts: Partial<MarkovEngineOptions>) => {
    const merged = { ...options, ...newOpts };
    setOptions(merged);
    initializeModel(modelType, targetHeightPlates, merged);
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

    if (res.newBricks && res.newBricks.length > 0) {
      // Audio feedback on brick placement
      brickAudio.triggerBrickPlacement(res.newBricks[0].gridPos[2]);
    }

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
      confetti({ particleCount: 70, spread: 75, origin: { y: 0.6 } });
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

  // Solve entire model to completion
  const handleSolveAll = () => {
    if (!engine) return;
    setIsPlaying(false);
    const res = engine.solveAll(3000);
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
    confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 } });
  };

  const handleReset = () => {
    initializeModel(modelType, targetHeightPlates, options);
  };

  const handleExportLDR = () => {
    if (bricks.length === 0) return;
    const content = LDrawExporter.exportToLDraw(bricks, `Brickator_${modelType}`, options.directRGBSampling);
    LDrawExporter.downloadLDrawFile(content, `brickator_${modelType}.ldr`);
  };

  const handleFileUpload = (file: File) => {
    setModelType('custom');
    initializeModel('custom', targetHeightPlates, options, file);
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
        position: 'relative'
      }}
    >
      {/* 3D Viewport Area */}
      <div style={{ flex: 1, height: '100%', position: 'relative' }}>
        <Viewport3D
          bricks={bricks}
          grid={grid}
          mode={viewportMode}
          currentStepIndex={currentStepIndex}
          autoRotate={autoRotate}
          sourceModel={sourceModel}
          sourceMeshMode={sourceMeshMode}
        />

        {/* Top Floating HUD: Real-time BOM & Pipeline Analytics */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 200,
            right: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'flex-end',
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              padding: '8px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: 12,
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              color: '#f8fafc',
              fontSize: 12
            }}
          >
            <div>
              <span style={{ color: '#94a3b8' }}>Phase:</span>{' '}
              <span style={{ fontWeight: 700, color: currentPhaseInfo.color }}>{currentPhaseInfo.title}</span>
            </div>

            <div style={{ width: 1, height: 16, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

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

            <div style={{ width: 1, height: 16, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div>
              <span style={{ color: '#94a3b8' }}>Parts:</span>{' '}
              <span style={{ fontWeight: 700, color: '#a78bfa' }}>{stats.uniqueParts}</span>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Coverage:</span>{' '}
              <span style={{ fontWeight: 700, color: '#34d399' }}>{stats.coverage}%</span>
            </div>
          </div>
        </div>

        {/* Bottom Interactive Growth Timeline Slider */}
        {bricks.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: 24,
              right: 24,
              padding: '12px 20px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)'
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', whiteSpace: 'nowrap' }}>
              Timeline ({currentStepIndex} / {bricks.length})
            </span>
            <input
              type="range"
              min={1}
              max={bricks.length}
              value={currentStepIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentStepIndex(parseInt(e.target.value));
              }}
              style={{ flex: 1, accentColor: '#38bdf8' }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setCurrentStepIndex(Math.max(1, currentStepIndex - 1))}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                ◀ Step
              </button>
              <button
                onClick={() => setCurrentStepIndex(Math.min(bricks.length, currentStepIndex + 1))}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  fontSize: 11,
                  cursor: 'pointer'
                }}
              >
                Step ▶
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Side Control Panel */}
      <ControlPanel
        modelType={modelType}
        onSelectModel={handleSelectModel}
        onFileUpload={handleFileUpload}
        targetHeightPlates={targetHeightPlates}
        onChangeHeight={handleChangeHeight}
        options={options}
        onChangeOptions={handleChangeOptions}
        viewportMode={viewportMode}
        onChangeViewportMode={setViewportMode}
        sourceMeshMode={sourceMeshMode}
        onChangeSourceMeshMode={setSourceMeshMode}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onStep={executeStep}
        onSolveAll={handleSolveAll}
        onReset={handleReset}
        onExportLDR={handleExportLDR}
        onOpenDatabase={() => setIsDatabaseOpen(true)}
        onOpenGallery={() => setIsGalleryOpen(true)}
        isMuted={isMuted}
        onToggleMute={() => setIsMuted(brickAudio.toggleMute())}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        speed={speed}
        onChangeSpeed={setSpeed}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
      />

      {/* Inspectors */}
      <ConnectorDatabaseInspector isOpen={isDatabaseOpen} onClose={() => setIsDatabaseOpen(false)} />
      <OMRGalleryInspector isOpen={isGalleryOpen} onClose={() => setIsGalleryOpen(false)} />
    </div>
  );
};
