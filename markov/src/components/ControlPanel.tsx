/**
 * Markov Growing Core Control Panel.
 *
 * Provides full control over:
 * - Model selection and custom file upload
 * - Arbitrary scale adjustment (target height in plates)
 * - Growing Core simulation parameters (seed mode, running bond, modern parts)
 * - Play / Pause / Step / Instant solver controls
 * - LDraw Export and inspector modal triggers
 */

import React from 'react';
import { MarkovEngineOptions } from '../engine/types';
import { ViewportMode } from './Viewport3D';

interface ControlPanelProps {
  modelType: string;
  onSelectModel: (type: string) => void;
  onFileUpload: (file: File) => void;
  targetHeightPlates: number;
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
  isMuted: boolean;
  onToggleMute: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  speed: number;
  onChangeSpeed: (s: number) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  modelType,
  onSelectModel,
  onFileUpload,
  targetHeightPlates,
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
  isMuted,
  onToggleMute,
  autoRotate,
  onToggleAutoRotate,
  speed,
  onChangeSpeed
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        width: 340,
        height: '100%',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(148, 163, 184, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        color: '#f8fafc',
        boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          background: 'linear-gradient(to right, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.9))'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              BRICKATOR<span style={{ color: '#e11d48' }}>3000</span>
            </h1>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', letterSpacing: '0.05em' }}>
              MARKOV GROWING CORE
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onToggleMute}
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              style={{
                background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 6,
                padding: '6px 8px',
                cursor: 'pointer',
                color: isMuted ? '#f87171' : '#34d399',
                fontSize: 12
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
                padding: '6px 8px',
                cursor: 'pointer',
                color: autoRotate ? '#38bdf8' : '#94a3b8',
                fontSize: 12
              }}
            >
              🔄
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Section 1: 3D Model Preset / Upload */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
            Input 3D Model
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
            {[
              { id: 'duck', label: '🦆 Duck' },
              { id: 'car', label: '🚗 Car' },
              { id: 'airplane', label: '✈️ Plane' },
              { id: 'dolphin', label: '🐬 Dolphin' },
              { id: 'dome_creature', label: '🔮 Dome' }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => onSelectModel(m.id)}
                style={{
                  padding: '8px 4px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: modelType === m.id ? '#38bdf8' : '#1e293b',
                  color: modelType === m.id ? '#0f172a' : '#cbd5e1',
                  transition: 'all 0.15s ease'
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px dashed rgba(148, 163, 184, 0.3)',
              backgroundColor: 'rgba(30, 41, 59, 0.4)',
              color: '#94a3b8',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            📁 Upload Custom 3D Model (GLB / OBJ / PLY)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf,.obj,.ply"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) onFileUpload(e.target.files[0]);
            }}
          />
        </div>

        {/* Section 2: Arbitrary Scale (Height in Plates) */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Scale (Height)
            </label>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700 }}>
              {targetHeightPlates} plates ({Math.round(targetHeightPlates / 3)} bricks)
            </span>
          </div>
          <input
            type="range"
            min={12}
            max={60}
            step={3}
            value={targetHeightPlates}
            onChange={e => onChangeHeight(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8' }}
          />
        </div>

        {/* Section 3: Viewport Mode */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
            Visualization Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { id: 'GROWING_CORE', label: '🌱 Growing Core' },
              { id: 'FINAL_MODEL', label: '🧱 Final Model' },
              { id: 'CORE_HEATMAP', label: '🔥 Core Depth' },
              { id: 'SLOPE_CURVATURE', label: '📐 Slopes/Normals' }
            ].map(vm => (
              <button
                key={vm.id}
                onClick={() => onChangeViewportMode(vm.id as ViewportMode)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 11,
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

        {/* Section 4: Parallel Growth Heads */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Parallel Growth Heads
            </label>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#10b981', fontWeight: 700 }}>
              {options.numHeads ?? 4} Heads
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
            {[1, 2, 4, 8].map(nh => (
              <button
                key={nh}
                onClick={() => onChangeOptions({ numHeads: nh })}
                style={{
                  padding: '6px 4px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: (options.numHeads ?? 4) === nh ? '#10b981' : '#1e293b',
                  color: (options.numHeads ?? 4) === nh ? '#0f172a' : '#cbd5e1'
                }}
              >
                {nh} {nh === 1 ? 'Head' : 'Heads'}
              </button>
            ))}
          </div>
        </div>

        {/* Section 5: Markov Growing Core Options */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
            Markov Constraints & Rules
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.staggerRunningBond}
                onChange={e => onChangeOptions({ staggerRunningBond: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Interlocking Running Bond (Overlap Seams)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableModernWeirdParts}
                onChange={e => onChangeOptions({ enableModernWeirdParts: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Modern & Weird Parts (Curved/Macaroni/Spines)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.enableStudlessTopFinish}
                onChange={e => onChangeOptions({ enableStudlessTopFinish: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Studless Top Finish (Smooth Tiles)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={options.directRGBSampling}
                onChange={e => onChangeOptions({ directRGBSampling: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              Direct 24-bit RGB Sampling ("Cheat Mode")
            </label>
          </div>
        </div>

        {/* Section 5: Playback & Speed */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Growth Speed
            </label>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1' }}>{speed}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={speed}
            onChange={e => onChangeSpeed(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8' }}
          />
        </div>
      </div>

      {/* Action Footer Buttons */}
      <div
        style={{
          padding: 16,
          borderTop: '1px solid rgba(148, 163, 184, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          backgroundColor: '#090a0f'
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            onClick={onTogglePlay}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: isPlaying ? '#f59e0b' : '#10b981',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
          >
            {isPlaying ? '⏸ Pause' : '▶ Grow Core'}
          </button>

          <button
            onClick={onStep}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.2)',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ⏭ Step 1x
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            onClick={onSolveAll}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ⚡ Solve Complete
          </button>

          <button
            onClick={onReset}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid rgba(148, 163, 184, 0.2)',
              backgroundColor: '#1e293b',
              color: '#cbd5e1',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ↺ Reset
          </button>
        </div>

        {/* Modal Triggers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          <button
            onClick={onOpenDatabase}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(56, 189, 248, 0.3)',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              color: '#38bdf8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            📚 Connectors DB
          </button>

          <button
            onClick={onOpenGallery}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(16, 185, 129, 0.3)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              color: '#34d399',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🏛️ OMR Gallery
          </button>
        </div>

        <button
          onClick={onExportLDR}
          style={{
            marginTop: 4,
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: '#e11d48',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          💾 Export .LDR (LDraw Cheat Mode)
        </button>
      </div>
    </div>
  );
};
