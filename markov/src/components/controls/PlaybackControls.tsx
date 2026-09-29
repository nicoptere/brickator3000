/**
 * PlaybackControls - Decoupled Engine Playback & Action Triggers.
 */

import React from 'react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStep: () => void;
  onSolveAll: () => void;
  onReset: () => void;
  onExportLDR: () => void;
  onOpenDatabase: () => void;
  onOpenGallery: () => void;
  speed: number;
  onChangeSpeed: (s: number) => void;
  isLoading: boolean;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onStep,
  onSolveAll,
  onReset,
  onExportLDR,
  onOpenDatabase,
  onOpenGallery,
  speed,
  onChangeSpeed,
  isLoading
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Speed Slider */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Growth Speed
          </label>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1' }}>{speed}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={speed}
          onChange={(e) => onChangeSpeed(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: '#38bdf8' }}
        />
      </div>

      {/* Main Play & Step Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onTogglePlay}
          disabled={isLoading}
          style={{
            padding: '9px 12px',
            borderRadius: 7,
            border: 'none',
            fontSize: 12,
            fontWeight: 700,
            cursor: isLoading ? 'wait' : 'pointer',
            backgroundColor: isPlaying ? '#f59e0b' : '#10b981',
            color: '#0f172a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          {isPlaying ? '⏸ Pause' : '▶ Grow Model'}
        </button>

        <button
          onClick={onStep}
          disabled={isLoading}
          style={{
            padding: '9px 12px',
            borderRadius: 7,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            backgroundColor: '#1e293b',
            color: '#f8fafc',
            fontSize: 12,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
        >
          ⏭ Step 1x
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onSolveAll}
          disabled={isLoading}
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
        >
          ⚡ Solve All
        </button>

        <button
          onClick={onReset}
          disabled={isLoading}
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            fontSize: 11,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
        >
          ↺ Reset
        </button>
      </div>

      {/* Database & OMR Triggers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onOpenDatabase}
          style={{
            padding: '7px 8px',
            borderRadius: 6,
            border: '1px solid rgba(56, 189, 248, 0.3)',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            color: '#38bdf8',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          📚 Connectors
        </button>

        <button
          onClick={onOpenGallery}
          style={{
            padding: '7px 8px',
            borderRadius: 6,
            border: '1px solid rgba(16, 185, 129, 0.3)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: '#34d399',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          🏛️ OMR Gallery
        </button>
      </div>

      {/* LDraw Export */}
      <button
        onClick={onExportLDR}
        disabled={isLoading}
        style={{
          padding: '9px 12px',
          borderRadius: 7,
          border: 'none',
          backgroundColor: '#e11d48',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 700,
          cursor: isLoading ? 'wait' : 'pointer'
        }}
      >
        💾 Export .LDR (0x2RRGGBB)
      </button>
    </div>
  );
};
