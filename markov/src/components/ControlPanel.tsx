/**
 * ControlPanel - Refactored, Decoupled Master Sidebar.
 *
 * Coordinates:
 * - ModelSelector (Presets + GLB/OBJ/PLY Upload + Source Mesh Overlay)
 * - ColorModeSelector (Island Random Colors | WFC Scale | Direct RGB)
 * - ScaleControl (1*1*1 Brick Height & quick presets)
 * - IslandInspector (Component List + Solo Isolation + Per-Island Discretization & WFC)
 * - PlaybackControls (Play/Step/Solve/Reset/Export)
 *
 * Follows DRY & KISS principles with rigid flex bounds (flexShrink: 0, minWidth: 360).
 */

import React from 'react';
import { MarkovEngineOptions } from '../engine/types';
import { ViewportMode, SourceMeshMode } from './Viewport3D';
import { ModelSelector } from './controls/ModelSelector';
import { ColorModeSelector, ColorMode } from './controls/ColorModeSelector';
import { ScaleControl } from './controls/ScaleControl';
import { IslandInspector, IslandMeta } from './controls/IslandInspector';
import { PlaybackControls } from './controls/PlaybackControls';
import { OMRCategory } from '../engine/wfcRefinerEngine';
import { MeshDistanceResult } from '../engine/meshDistanceMetric';
import { BuildabilityReport, HarmonizationResult } from '../engine/polishHarmonizer';

export interface ControlPanelProps {
  modelType: string;
  onSelectModel: (type: string) => void;
  onFileUpload: (file: File) => void;
  sourceMeshMode: SourceMeshMode;
  onChangeSourceMeshMode: (m: SourceMeshMode) => void;
  targetHeightBricks: number;
  onChangeHeight: (h: number) => void;
  colorMode: ColorMode;
  onChangeColorMode: (m: ColorMode) => void;
  islands?: IslandMeta[];
  selectedIslandId: number | null;
  onSelectIsland: (id: number | null) => void;
  onDiscretizeIsland: (id: number) => void;
  onDiscretizeAllIndependently: () => void;
  onSolveWfcOnIsland: (id: number | null) => void;
  onRerollColors: () => void;
  options: MarkovEngineOptions;
  onChangeOptions: (opts: Partial<MarkovEngineOptions>) => void;
  viewportMode: ViewportMode;
  onChangeViewportMode: (m: ViewportMode) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStep: () => void;
  onSolveAll: () => void;
  onReset: () => void;
  onExportLDR: () => void;
  onOpenDatabase: () => void;
  onOpenGallery: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  speed: number;
  onChangeSpeed: (s: number) => void;
  isLoading?: boolean;
  loadingMessage?: string;
  omrCategory?: OMRCategory;
  onChangeOmrCategory?: (c: OMRCategory) => void;
  onHarmonizeNeighborhoods?: () => void;
  onVerifyBuildability?: () => void;
  onEvaluateDistance?: () => void;
  distanceMetric?: MeshDistanceResult | null;
  buildabilityReport?: BuildabilityReport | null;
  harmonizationResult?: HarmonizationResult | null;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  modelType,
  onSelectModel,
  onFileUpload,
  sourceMeshMode,
  onChangeSourceMeshMode,
  targetHeightBricks,
  onChangeHeight,
  colorMode,
  onChangeColorMode,
  islands = [],
  selectedIslandId,
  onSelectIsland,
  onDiscretizeIsland,
  onDiscretizeAllIndependently,
  onSolveWfcOnIsland,
  onRerollColors,
  options,
  onChangeOptions,
  viewportMode,
  onChangeViewportMode,
  isPlaying,
  onTogglePlay,
  onStep,
  onSolveAll,
  onReset,
  onExportLDR,
  onOpenDatabase,
  onOpenGallery,
  isMuted,
  onToggleMute,
  autoRotate,
  onToggleAutoRotate,
  speed,
  onChangeSpeed,
  isLoading = false,
  loadingMessage = 'Loading model...',
  omrCategory = 'vehicles',
  onChangeOmrCategory,
  onHarmonizeNeighborhoods,
  onVerifyBuildability,
  onEvaluateDistance,
  distanceMetric = null,
  buildabilityReport = null,
  harmonizationResult = null
}) => {
  return (
    <div
      style={{
        width: 360,
        minWidth: 360,
        maxWidth: 360,
        flexShrink: 0,
        height: '100%',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(148, 163, 184, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        color: '#f8fafc',
        boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.5)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          background: 'linear-gradient(to right, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.95))'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              BRICKATOR<span style={{ color: '#e11d48' }}>3000</span>
            </h1>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#38bdf8', letterSpacing: '0.05em' }}>
              MARKOV & WFC DISCRETIZATION
            </div>
          </div>

          <div style={{ display: 'flex', gap: 5 }}>
            <button
              onClick={onToggleMute}
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              style={{
                background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                color: isMuted ? '#f87171' : '#34d399',
                fontSize: 11
              }}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button
              onClick={onToggleAutoRotate}
              title="Toggle Auto Rotation"
              style={{
                background: autoRotate ? 'rgba(56, 189, 248, 0.2)' : 'rgba(51, 65, 85, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                color: autoRotate ? '#38bdf8' : '#94a3b8',
                fontSize: 11
              }}
            >
              🔄
            </button>
          </div>
        </div>
      </div>

      {/* Loading Banner */}
      {isLoading && (
        <div
          style={{
            padding: '8px 14px',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: '#38bdf8'
          }}
        >
          <div style={{ animation: 'spin 1s linear infinite' }}>⏳</div>
          <div style={{ fontWeight: 600 }}>{loadingMessage}</div>
        </div>
      )}

      {/* Scrollable Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 1. Model Selection & Overlay */}
        <ModelSelector
          modelType={modelType}
          onSelectModel={onSelectModel}
          onFileUpload={onFileUpload}
          sourceMeshMode={sourceMeshMode}
          onChangeSourceMeshMode={onChangeSourceMeshMode}
          voxelizeMode={options.voxelizeMode || 'surface'}
          onChangeVoxelizeMode={(m) => onChangeOptions({ voxelizeMode: m })}
          isLoading={isLoading}
        />

        {/* 2. Color Mode Selector */}
        <ColorModeSelector
          colorMode={colorMode}
          onChangeColorMode={onChangeColorMode}
        />

        {/* 3. Scale (1*1*1 Bricks) */}
        <ScaleControl
          targetHeightBricks={targetHeightBricks}
          onChangeHeight={onChangeHeight}
        />

        {/* 4. Island Components & Solo Isolation */}
        <IslandInspector
          islands={islands}
          selectedIslandId={selectedIslandId}
          onSelectIsland={onSelectIsland}
          onDiscretizeIsland={onDiscretizeIsland}
          onDiscretizeAllIndependently={onDiscretizeAllIndependently}
          onSolveWfcOnIsland={onSolveWfcOnIsland}
          onRerollColors={onRerollColors}
          isLoading={isLoading}
        />

        {/* 5. Viewport Mode Selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Viewport Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { id: 'GROWING_CORE', label: '🌱 Growing Core' },
              { id: 'FINAL_MODEL', label: '🧱 Final Model' },
              { id: 'CORE_HEATMAP', label: '🔥 Core Depth' },
              { id: 'SLOPE_CURVATURE', label: '📐 Normals' }
            ].map((vm) => (
              <button
                key={vm.id}
                onClick={() => onChangeViewportMode(vm.id as ViewportMode)}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: viewportMode === vm.id ? '#6366f1' : '#1e293b',
                  color: viewportMode === vm.id ? '#ffffff' : '#cbd5e1'
                }}
              >
                {vm.label}
              </button>
            ))}
          </div>
        </div>

        {/* 6. Discretization Rules */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Discretization Rules
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.staggerRunningBond}
                onChange={(e) => onChangeOptions({ staggerRunningBond: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Interlocking Running Bond
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableModernWeirdParts}
                onChange={(e) => onChangeOptions({ enableModernWeirdParts: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Curved Slopes, Macaroni & Dishes
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableStudlessTopFinish}
                onChange={(e) => onChangeOptions({ enableStudlessTopFinish: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Studless Top Finish (Smooth Tiles)
            </label>
          </div>
        </div>

        {/* 7. OMR Category Profile Selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            OMR Knowledge Profile
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { id: 'vehicles', label: '🏎️ Vehicles & Cars' },
              { id: 'architecture', label: '🏛️ Architecture' },
              { id: 'space', label: '🚀 Space & Sci-Fi' },
              { id: 'universal', label: '🌐 Universal (1.4k)' }
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => onChangeOmrCategory && onChangeOmrCategory(cat.id as OMRCategory)}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: omrCategory === cat.id ? '#0284c7' : '#1e293b',
                  color: omrCategory === cat.id ? '#ffffff' : '#94a3b8',
                  boxShadow: omrCategory === cat.id ? '0 0 12px rgba(2, 132, 199, 0.4)' : 'none'
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 8. Polish & Buildability Post-Processing */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Polish & Structural Buildability
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                onClick={onHarmonizeNeighborhoods}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  backgroundColor: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
                title="Detect isolated slope mismatches and merge adjacent continuous curves"
              >
                ✨ Harmonize Slopes
              </button>
              <button
                onClick={onVerifyBuildability}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#fbbf24',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
                title="BFS Grounding Check from y=0 build plate & running bond interlocking verification"
              >
                🏗️ Verify Grounding
              </button>
            </div>

            {/* Harmonization & Buildability Status Badge */}
            {(harmonizationResult || buildabilityReport) && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(30, 41, 59, 0.7)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  fontSize: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3
                }}
              >
                {harmonizationResult && (
                  <div style={{ color: '#c084fc' }}>
                    Merged Curves: {harmonizationResult.mergedContinuousCurvesCount} | Slopes Aligned: {harmonizationResult.harmonizedSlopesCount}
                  </div>
                )}
                {buildabilityReport && (
                  <div style={{ color: buildabilityReport.is100PercentGrounded ? '#34d399' : '#f87171' }}>
                    {buildabilityReport.is100PercentGrounded ? '✅ 100% Grounded & Buildable' : `⚠️ ${buildabilityReport.floatingBricksCount} Floating Bricks`}
                    {' '}| Interlock: {buildabilityReport.interlockRatio}%
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 9. Analytical Mesh Distance Fidelity Metric */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Surface Mesh Fidelity
            </label>
            {onEvaluateDistance && (
              <button
                onClick={onEvaluateDistance}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                📐 Calculate Distance
              </button>
            )}
          </div>

          {distanceMetric ? (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontSize: 10,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6
              }}
            >
              <div>
                <div style={{ color: '#94a3b8' }}>Mean Chamfer:</div>
                <div style={{ color: '#38bdf8', fontWeight: 700 }}>
                  {distanceMetric.meanDistanceMm} mm <span style={{ color: '#64748b', fontSize: 9 }}>({distanceMetric.meanDistanceLDU} LDU)</span>
                </div>
              </div>
              <div>
                <div style={{ color: '#94a3b8' }}>RMS Error:</div>
                <div style={{ color: '#38bdf8', fontWeight: 700 }}>{distanceMetric.rmsDistanceMm} mm</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8' }}>Max Hausdorff:</div>
                <div style={{ color: '#f59e0b', fontWeight: 700 }}>{distanceMetric.maxDistanceMm} mm</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8' }}>Fidelity Score:</div>
                <div style={{ color: '#34d399', fontWeight: 700 }}>{distanceMetric.surfaceFidelityScore}%</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
              Solve model to calculate Chamfer & Hausdorff surface error.
            </div>
          )}
        </div>
      </div>

      {/* Action Footer Buttons */}
      <div style={{ padding: 14, borderTop: '1px solid rgba(148, 163, 184, 0.15)', backgroundColor: '#090a0f' }}>
        <PlaybackControls
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          onStep={onStep}
          onSolveAll={onSolveAll}
          onReset={onReset}
          onExportLDR={onExportLDR}
          onOpenDatabase={onOpenDatabase}
          onOpenGallery={onOpenGallery}
          speed={speed}
          onChangeSpeed={onChangeSpeed}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
