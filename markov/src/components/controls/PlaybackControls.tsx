/**
 * PlaybackControls - Decoupled Simulation & Solver Action Controls (Zero Emojis).
 */

import React from 'react';
import {
  PlayIcon,
  PauseIcon,
  StepForwardIcon,
  SparklesIcon,
  RotateCcwIcon,
  DownloadIcon,
  DatabaseIcon,
  GridIcon
} from '../common/Icons';

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
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#38bdf8' }}>{speed}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={speed}
          onChange={(e) => onChangeSpeed(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
        />
      </div>

      {/* Main Play & Step Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onTogglePlay}
          disabled={isLoading}
          style={{
            height: 34,
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
          {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          <span>{isPlaying ? 'Pause' : 'Grow Model'}</span>
        </button>

        <button
          onClick={onStep}
          disabled={isLoading}
          style={{
            height: 34,
            borderRadius: 7,
            border: '1px solid #334155',
            backgroundColor: '#1e293b',
            color: '#f8fafc',
            fontSize: 12,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <StepForwardIcon size={14} />
          <span>Step 1x</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onSolveAll}
          disabled={isLoading}
          style={{
            height: 32,
            borderRadius: 6,
            border: 'none',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 700,
            cursor: isLoading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5
          }}
        >
          <SparklesIcon size={13} />
          <span>Solve Model</span>
        </button>

        <button
          onClick={onReset}
          disabled={isLoading}
          style={{
            height: 32,
            borderRadius: 6,
            border: '1px solid #334155',
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            fontSize: 11,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5
          }}
        >
          <RotateCcwIcon size={13} />
          <span>Reset</span>
        </button>
      </div>

      {/* Database & OMR Inspector Modals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onOpenDatabase}
          style={{
            height: 30,
            borderRadius: 6,
            border: '1px solid rgba(56, 189, 248, 0.3)',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            color: '#38bdf8',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5
          }}
        >
          <DatabaseIcon size={13} />
          <span>Connectors</span>
        </button>

        <button
          onClick={onOpenGallery}
          style={{
            height: 30,
            borderRadius: 6,
            border: '1px solid rgba(16, 185, 129, 0.3)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: '#34d399',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5
          }}
        >
          <GridIcon size={13} />
          <span>OMR Gallery</span>
        </button>
      </div>

      {/* LDraw Export */}
      <button
        onClick={onExportLDR}
        disabled={isLoading}
        style={{
          height: 34,
          borderRadius: 7,
          border: 'none',
          backgroundColor: '#e11d48',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 700,
          cursor: isLoading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }}
      >
        <DownloadIcon size={14} />
        <span>Export LDraw (.ldr)</span>
      </button>
    </div>
  );
};
