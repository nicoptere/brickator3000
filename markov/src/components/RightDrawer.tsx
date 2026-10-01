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
import { ScaleControl } from './controls/ScaleControl';
import { PlaybackControls } from './controls/PlaybackControls';
import { OMRCategory } from '../engine/wfcRefinerEngine';
import { MeshDistanceResult } from '../engine/meshDistanceMetric';
import { BuildabilityReport, HarmonizationResult } from '../engine/polishHarmonizer';
import { SunIcon, MoonIcon, CheckCircleIcon, PanelRightIcon, RefreshIcon } from './common/Icons';

export interface RightDrawerProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  targetHeightBricks: number;
  onChangeHeight: (h: number) => void;
  options: MarkovEngineOptions;
  onChangeOptions: (opts: Partial<MarkovEngineOptions>) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onExportLDR: () => void;
  themeMode: 'dark' | 'light';
  onToggleThemeMode: () => void;
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
  isPlaying,
  onTogglePlay,
  onReset,
  onExportLDR,
  themeMode,
  onToggleThemeMode,
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
        backgroundColor: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 25,
        color: '#0f172a',
        boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.05)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PanelRightIcon size={16} color="#2563eb" />
            <h1 style={{ fontSize: 14, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#0f172a' }}>
              BRICKATOR<span style={{ color: '#2563eb' }}>3000</span>
            </h1>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#2563eb', letterSpacing: '0.05em' }}>
            GENERATION & SOLVER SETTINGS
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={onToggleThemeMode}
            title={`Switch to ${themeMode === 'dark' ? 'Light' : 'Dark'} Viewport`}
            style={{
              height: 28,
              padding: '0 8px',
              borderRadius: 5,
              border: '1px solid #e2e8f0',
              backgroundColor: '#f1f5f9',
              color: '#0f172a',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
          >
            {themeMode === 'dark' ? (
              <SunIcon size={13} color="#2563eb" />
            ) : (
              <MoonIcon size={13} color="#2563eb" />
            )}
            <span>{themeMode === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          <button
            onClick={onToggleOpen}
            title="Collapse Panel"
            style={{
              height: 28,
              padding: '0 8px',
              borderRadius: 5,
              border: '1px solid #e2e8f0',
              backgroundColor: '#f1f5f9',
              color: '#475569',
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
            backgroundColor: '#eff6ff',
            borderBottom: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: '#2563eb'
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
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Discretization Rules
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, backgroundColor: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.staggerRunningBond}
                onChange={(e) => onChangeOptions({ staggerRunningBond: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Interlocking Running Bond
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableModernWeirdParts}
                onChange={(e) => onChangeOptions({ enableModernWeirdParts: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Curved Slopes, Macaroni & Dishes
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableStudlessTopFinish}
                onChange={(e) => onChangeOptions({ enableStudlessTopFinish: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Studless Top Finish (Smooth Tiles)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.directRGBSampling}
                onChange={(e) => onChangeOptions({ directRGBSampling: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Direct RGB Sampling (0x2RRGGBB)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enablePolishPass !== false}
                onChange={(e) => onChangeOptions({ enablePolishPass: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Run Polish Pass
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableBuildabilityVerify !== false}
                onChange={(e) => onChangeOptions({ enableBuildabilityVerify: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Verify Buildability
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!options.enableVerticalPolesToCylinders}
                onChange={(e) => onChangeOptions({ enableVerticalPolesToCylinders: e.target.checked })}
                style={{ accentColor: '#2563eb' }}
              />
              Pillars (Canisters & Cylinders)
            </label>
          </div>

          {/* Harmonization & Buildability Status Badge */}
          {(harmonizationResult || buildabilityReport) && (
            <div
              style={{
                marginTop: 6,
                padding: '6px 8px',
                borderRadius: 6,
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                fontSize: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 3
              }}
            >
              {harmonizationResult && (
                <div style={{ color: '#2563eb' }}>
                  Curves: {harmonizationResult.mergedContinuousCurvesCount} | Slopes: {harmonizationResult.harmonizedSlopesCount}
                  {harmonizationResult.replacedCanistersCount > 0 && ` | Canisters: ${harmonizationResult.replacedCanistersCount}`}
                  {harmonizationResult.replacedCylindersCount > 0 && ` | Cylinders: ${harmonizationResult.replacedCylindersCount}`}
                </div>
              )}
              {buildabilityReport && (
                <div style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircleIcon size={12} color="#2563eb" />
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

        {/* 3. OMR Knowledge Tensor */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
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
                    border: isSelected ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#2563eb' : '#f8fafc',
                    color: isSelected ? '#ffffff' : '#475569',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Analytical Mesh Distance Fidelity Metric */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Surface Mesh Fidelity
            </label>
            {onEvaluateDistance && (
              <button
                onClick={onEvaluateDistance}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
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
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: 10,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6
              }}
            >
              <div>
                <div style={{ color: '#64748b' }}>Mean Chamfer:</div>
                <div style={{ color: '#2563eb', fontWeight: 700 }}>
                  {distanceMetric.meanDistanceMm} mm <span style={{ color: '#64748b', fontSize: 9 }}>({distanceMetric.meanDistanceLDU} LDU)</span>
                </div>
              </div>
              <div>
                <div style={{ color: '#64748b' }}>RMS Error:</div>
                <div style={{ color: '#2563eb', fontWeight: 700 }}>{distanceMetric.rmsDistanceMm} mm</div>
              </div>
              <div>
                <div style={{ color: '#64748b' }}>Max Hausdorff:</div>
                <div style={{ color: '#2563eb', fontWeight: 700 }}>{distanceMetric.maxDistanceMm} mm</div>
              </div>
              <div>
                <div style={{ color: '#64748b' }}>Fidelity Score:</div>
                <div style={{ color: '#2563eb', fontWeight: 700 }}>{distanceMetric.surfaceFidelityScore}%</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', backgroundColor: '#f8fafc', padding: 8, borderRadius: 6, border: '1px solid #e2e8f0' }}>
              Solve model to calculate Chamfer & Hausdorff surface error.
            </div>
          )}
        </div>
      </div>

      {/* Action Footer Buttons */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
        <PlaybackControls
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          onReset={onReset}
          onExportLDR={onExportLDR}
          speed={speed}
          onChangeSpeed={onChangeSpeed}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
