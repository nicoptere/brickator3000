/**
 * RightDrawer - Decoupled Master Right Drawer for Generation Settings, OMR, WFC & Polish.
 *
 * Implements:
 * - Scale Control (1*1*1 Brick Height & quick presets)
 * - Multi-Head Discretization Rules (Running bond, modern weird parts, studless finish, direct RGB)
 * - OMR Domain Knowledge Tensor selection (Vehicles, Architecture, Space, Universal)
 * - Polish & Structural Buildability (BFS grounding, running bond interlock, slope harmonization)
 * - Analytical Mesh Distance Fidelity (Mean Chamfer, RMS, Hausdorff, Surface Fidelity)
 * - Viewport Mode selector (Growing Core, Final Model, Depth Heatmap, Normals)
 * - Playback Controls (Play, Step, Solve All, Reset, Export LDraw, Modal triggers)
 * - Gluestack/Tailwind-inspired dark theme, medium-sized components, zero emojis.
 */

import React from 'react';
import { MarkovEngineOptions } from '../engine/types';
import { ViewportMode } from './Viewport3D';
import { ScaleControl } from './controls/ScaleControl';
import { PlaybackControls } from './controls/PlaybackControls';
import { OMRCategory } from '../engine/wfcRefinerEngine';
import { MeshDistanceResult } from '../engine/meshDistanceMetric';
import { BuildabilityReport, HarmonizationResult } from '../engine/polishHarmonizer';
import { RefreshIcon, SparklesIcon, CheckCircleIcon, AlertTriangleIcon, PanelRightIcon } from './common/Icons';

export interface RightDrawerProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  targetHeightBricks: number;
  onChangeHeight: (h: number) => void;
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

export const RightDrawer: React.FC<RightDrawerProps> = ({
  isOpen,
  onToggleOpen,
  targetHeightBricks,
  onChangeHeight,
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
  autoRotate,
  onToggleAutoRotate,
  speed,
  onChangeSpeed,
  isLoading = false,
  loadingMessage = 'Processing model...',
  omrCategory = 'vehicles',
  onChangeOmrCategory,
  onHarmonizeNeighborhoods,
  onVerifyBuildability,
  onEvaluateDistance,
  distanceMetric = null,
  buildabilityReport = null,
  harmonizationResult = null
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        width: 360,
        minWidth: 360,
        maxWidth: 360,
        flexShrink: 0,
        height: '100%',
        backgroundColor: '#090a0f',
        borderLeft: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 25,
        color: '#f8fafc',
        boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          backgroundColor: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PanelRightIcon size={16} color="#38bdf8" />
            <h1 style={{ fontSize: 14, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              BRICKATOR<span style={{ color: '#0284c7' }}>3000</span>
            </h1>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#38bdf8', letterSpacing: '0.05em' }}>
            GENERATION & SOLVER SETTINGS
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={onToggleAutoRotate}
            title={autoRotate ? 'Disable Auto Rotation' : 'Enable Auto Rotation'}
            style={{
              height: 28,
              padding: '0 8px',
              borderRadius: 5,
              border: autoRotate ? '1px solid #0284c7' : '1px solid #334155',
              backgroundColor: autoRotate ? 'rgba(2, 132, 199, 0.2)' : '#1e293b',
              color: autoRotate ? '#38bdf8' : '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <RefreshIcon size={12} />
            <span>Rotate</span>
          </button>

          <button
            onClick={onToggleOpen}
            title="Collapse Panel"
            style={{
              height: 28,
              padding: '0 8px',
              borderRadius: 5,
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Hide
          </button>
        </div>
      </div>

      {/* Loading Banner */}
      {isLoading && (
        <div
          style={{
            padding: '8px 14px',
            backgroundColor: 'rgba(2, 132, 199, 0.15)',
            borderBottom: '1px solid rgba(2, 132, 199, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: '#38bdf8'
          }}
        >
          <div style={{ animation: 'spin 1s linear infinite' }}>
            <RefreshIcon size={12} />
          </div>
          <div style={{ fontWeight: 600 }}>{loadingMessage}</div>
        </div>
      )}

      {/* Scrollable Settings Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 1. Scale & Brick Resolution */}
        <ScaleControl
          targetHeightBricks={targetHeightBricks}
          onChangeHeight={onChangeHeight}
        />

        {/* 2. Discretization Rules */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Discretization Rules
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, backgroundColor: '#0f172a', padding: 8, borderRadius: 6, border: '1px solid #1e293b' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.staggerRunningBond}
                onChange={(e) => onChangeOptions({ staggerRunningBond: e.target.checked })}
                style={{ accentColor: '#0284c7' }}
              />
              Interlocking Running Bond
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableModernWeirdParts}
                onChange={(e) => onChangeOptions({ enableModernWeirdParts: e.target.checked })}
                style={{ accentColor: '#0284c7' }}
              />
              Curved Slopes, Macaroni & Dishes
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableStudlessTopFinish}
                onChange={(e) => onChangeOptions({ enableStudlessTopFinish: e.target.checked })}
                style={{ accentColor: '#0284c7' }}
              />
              Studless Top Finish (Smooth Tiles)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.directRGBSampling}
                onChange={(e) => onChangeOptions({ directRGBSampling: e.target.checked })}
                style={{ accentColor: '#0284c7' }}
              />
              Direct RGB Sampling (0x2RRGGBB)
            </label>
          </div>
        </div>

        {/* 3. OMR Knowledge Tensor */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            OMR Knowledge Profile
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { id: 'vehicles', label: 'Vehicles' },
              { id: 'architecture', label: 'Architecture' },
              { id: 'space', label: 'Space & Sci-Fi' },
              { id: 'universal', label: 'Universal (1.4k)' }
            ].map((cat) => {
              const isSelected = omrCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => onChangeOmrCategory && onChangeOmrCategory(cat.id as OMRCategory)}
                  style={{
                    height: 30,
                    borderRadius: 6,
                    border: isSelected ? '1px solid #0284c7' : '1px solid #334155',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#0284c7' : '#1e293b',
                    color: isSelected ? '#ffffff' : '#94a3b8',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Polish & Structural Buildability */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
            Polish & Structural Buildability
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Toggle 1: Run Polish Pass */}
            <div
              onClick={() => onChangeOptions({ enablePolishPass: options.enablePolishPass === false ? true : false })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: '#0f172a',
                border: (options.enablePolishPass !== false) ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid #1e293b',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SparklesIcon size={14} color={options.enablePolishPass !== false ? '#c084fc' : '#64748b'} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: options.enablePolishPass !== false ? '#f8fafc' : '#94a3b8' }}>
                    Run Polish Pass
                  </div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>
                    Harmonize slopes & merge continuous curves
                  </div>
                </div>
              </div>

              {/* Modern Switch Pill */}
              <div
                style={{
                  width: 34,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: options.enablePolishPass !== false ? '#9333ea' : '#334155',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  flexShrink: 0
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: '#ffffff',
                    position: 'absolute',
                    top: 2,
                    left: options.enablePolishPass !== false ? 18 : 2,
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }}
                />
              </div>
            </div>

            {/* Toggle 2: Verify Buildability */}
            <div
              onClick={() => onChangeOptions({ enableBuildabilityVerify: options.enableBuildabilityVerify === false ? true : false })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: '#0f172a',
                border: (options.enableBuildabilityVerify !== false) ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #1e293b',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircleIcon size={14} color={options.enableBuildabilityVerify !== false ? '#fbbf24' : '#64748b'} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: options.enableBuildabilityVerify !== false ? '#f8fafc' : '#94a3b8' }}>
                    Verify Buildability
                  </div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>
                    BFS physical grounding & running bond interlock
                  </div>
                </div>
              </div>

              {/* Modern Switch Pill */}
              <div
                style={{
                  width: 34,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: options.enableBuildabilityVerify !== false ? '#d97706' : '#334155',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  flexShrink: 0
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: '#ffffff',
                    position: 'absolute',
                    top: 2,
                    left: options.enableBuildabilityVerify !== false ? 18 : 2,
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }}
                />
              </div>
            </div>

            {/* Harmonization & Buildability Status Badge */}
            {(harmonizationResult || buildabilityReport) && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  backgroundColor: '#0f172a',
                  border: '1px solid #1e293b',
                  fontSize: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                {harmonizationResult && (
                  <div style={{ color: '#c084fc' }}>
                    Merged Curves: {harmonizationResult.mergedContinuousCurvesCount} | Slopes Aligned: {harmonizationResult.harmonizedSlopesCount}
                  </div>
                )}
                {buildabilityReport && (
                  <div style={{ color: buildabilityReport.is100PercentGrounded ? '#34d399' : '#f87171', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {buildabilityReport.is100PercentGrounded ? <CheckCircleIcon size={12} /> : <AlertTriangleIcon size={12} />}
                    <span>
                      {buildabilityReport.is100PercentGrounded
                        ? '100% Grounded & Buildable'
                        : `${buildabilityReport.floatingBricksCount} Floating Bricks`}
                      {' '}| Interlock: {buildabilityReport.interlockRatio}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 5. Analytical Mesh Distance Fidelity Metric */}
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
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Calculate Distance
              </button>
            )}
          </div>

          {distanceMetric ? (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: '#0f172a',
                border: '1px solid #1e293b',
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
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', backgroundColor: '#0f172a', padding: 8, borderRadius: 6, border: '1px solid #1e293b' }}>
              Solve model to calculate Chamfer & Hausdorff surface error.
            </div>
          )}
        </div>

        {/* 6. Viewport Mode Selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Viewport Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { id: 'GROWING_CORE', label: 'Growing Core' },
              { id: 'FINAL_MODEL', label: 'Final Model' },
              { id: 'CORE_HEATMAP', label: 'Core Depth' },
              { id: 'SLOPE_CURVATURE', label: 'Normals' }
            ].map((vm) => {
              const isSelected = viewportMode === vm.id;
              return (
                <button
                  key={vm.id}
                  onClick={() => onChangeViewportMode(vm.id as ViewportMode)}
                  style={{
                    height: 28,
                    borderRadius: 6,
                    border: isSelected ? '1px solid #0284c7' : '1px solid #334155',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#0284c7' : '#1e293b',
                    color: isSelected ? '#ffffff' : '#cbd5e1',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {vm.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Action Footer Buttons */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
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
