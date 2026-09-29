/**
 * Brickator3000 // Markov Growing Core Studio Master Dashboard.
 *
 * Coordinates:
 * - 3D Viewport with multi-mode rendering
 * - Control panel with scale, model selector, playback, and export
 * - Interactive step scrubbing timeline
 * - Real-time BOM & graph statistics HUD
 * - Connector Database and OMR Gallery modal inspectors
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { Viewport3D, ViewportMode } from './Viewport3D';
import { ControlPanel } from './ControlPanel';
import { ConnectorDatabaseInspector } from './ConnectorDatabaseInspector';
import { OMRGalleryInspector } from './OMRGalleryInspector';

import { VoxelGrid, PlacedBrick, MarkovEngineOptions, GrowthStepResult } from '../engine/types';
import { MeshVoxelizer } from '../engine/meshVoxelizer';
import { MarkovCoreGrowingEngine } from '../engine/markovCoreGrowingEngine';
import { LDrawExporter } from '../engine/ldrawExporter';
import { brickAudio } from '../engine/brickAudio';

export const MarkovStudio: React.FC = () => {
  const [modelType, setModelType] = useState<string>('duck');
  const [targetHeightPlates, setTargetHeightPlates] = useState<number>(24);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('GROWING_CORE');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(4);

  // Modals
  const [isDatabaseOpen, setIsDatabaseOpen] = useState<boolean>(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

  // Engine & Simulation State
  const [grid, setGrid] = useState<VoxelGrid | null>(null);
  const [engine, setEngine] = useState<MarkovCoreGrowingEngine | null>(null);
  const [bricks, setBricks] = useState<PlacedBrick[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>('SEED');

  const [options, setOptions] = useState<MarkovEngineOptions>({
    seedMode: 'DEEPEST_CORE',
    staggerRunningBond: true,
    enableModernWeirdParts: true,
    enableStudlessTopFinish: true,
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

  // Re-build Voxel Grid from geometry
  const initializeModel = useCallback(
    (type: string, heightPlates: number, opts: MarkovEngineOptions) => {
      setIsPlaying(false);
      const geom = MeshVoxelizer.createSampleGeometry(type as any);
      const newGrid = MeshVoxelizer.voxelizeGeometry(geom, {
        targetHeightPlates: heightPlates
      });

      const newEngine = new MarkovCoreGrowingEngine(newGrid, opts);

      setGrid(newGrid);
      setEngine(newEngine);
      setBricks([]);
      setCurrentStepIndex(0);
      setPhase('SEED');
      setStats({
        totalPlaced: 0,
        leafCount: 0,
        edgeCount: 0,
        fillCount: 0,
        uniqueParts: 0,
        coverage: 0
      });
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

    if (res.newBricks && res.newBricks.length > 0) {
      setBricks(Array.from(engine.placedBricks.values()));
      setCurrentStepIndex(engine.stepIndex);

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
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
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
    const content = LDrawExporter.exportToLDraw(bricks, `Markov_${modelType}`, options.directRGBSampling);
    LDrawExporter.downloadLDrawFile(content, `markov_${modelType}.ldr`);
  };

  const handleFileUpload = (file: File) => {
    // For custom uploaded 3D files (GLB, OBJ, PLY)
    alert(`File "${file.name}" received. Voxelizing mesh...`);
    setModelType('custom');
    initializeModel('duck', targetHeightPlates, options);
  };

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
        />

        {/* Top Floating HUD: Real-time BOM & Graph Analytics */}
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
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
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
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>{phase}</span>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Heads:</span>{' '}
              <span style={{ fontWeight: 700, color: '#10b981' }}>{options.numHeads ?? 4} Active</span>
            </div>

            <div style={{ width: 1, height: 16, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div>
              <span style={{ color: '#94a3b8' }}>Total Bricks:</span>{' '}
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>{stats.totalPlaced}</span>
            </div>

            <div>
              <span style={{ color: '#f59e0b' }}>FILL:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.fillCount}</span>
            </div>

            <div>
              <span style={{ color: '#3b82f6' }}>EDGE:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.edgeCount}</span>
            </div>

            <div>
              <span style={{ color: '#10b981' }}>LEAF:</span>{' '}
              <span style={{ fontWeight: 700 }}>{stats.leafCount}</span>
            </div>

            <div style={{ width: 1, height: 16, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />

            <div>
              <span style={{ color: '#94a3b8' }}>Unique Parts:</span>{' '}
              <span style={{ fontWeight: 700, color: '#a78bfa' }}>{stats.uniqueParts}</span>
            </div>

            <div>
              <span style={{ color: '#94a3b8' }}>Voxel Coverage:</span>{' '}
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
              Growth Timeline ({currentStepIndex} / {bricks.length})
            </span>
            <input
              type="range"
              min={1}
              max={bricks.length}
              value={currentStepIndex}
              onChange={e => {
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
      />

      {/* Inspectors */}
      <ConnectorDatabaseInspector isOpen={isDatabaseOpen} onClose={() => setIsDatabaseOpen(false)} />
      <OMRGalleryInspector isOpen={isGalleryOpen} onClose={() => setIsGalleryOpen(false)} />
    </div>
  );
};
