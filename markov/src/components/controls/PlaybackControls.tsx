/**
 * PlaybackControls - Decoupled Simulation & Solver Action Controls (Zero Emojis).
 */

import React from 'react';
import {
  PlayIcon,
  PauseIcon,
  RotateCcwIcon,
  DownloadIcon
} from '../common/Icons';

interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onExportLDR: () => void;
  speed: number;
  onChangeSpeed: (s: number) => void;
  isLoading: boolean;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onReset,
  onExportLDR,
  speed,
  onChangeSpeed,
  isLoading
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Speed Slider */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Growth Speed
          </label>
          <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: '#2563eb' }}>{speed}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={speed}
          onChange={(e) => onChangeSpeed(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
        />
      </div>

      {/* Main Play & Reset Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onTogglePlay}
          disabled={isLoading}
          style={{
            height: 34,
            borderRadius: 7,
            border: isPlaying ? '1px solid #bfdbfe' : 'none',
            fontSize: 12,
            fontWeight: 700,
            cursor: isLoading ? 'wait' : 'pointer',
            backgroundColor: isPlaying ? '#eff6ff' : '#2563eb',
            color: isPlaying ? '#2563eb' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease'
          }}
        >
          {isPlaying ? <PauseIcon size={14} color="#2563eb" /> : <PlayIcon size={14} color="#ffffff" />}
          <span>{isPlaying ? 'Pause' : 'Grow Model'}</span>
        </button>

        <button
          onClick={onReset}
          disabled={isLoading}
          style={{
            height: 34,
            borderRadius: 7,
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            color: '#475569',
            fontSize: 12,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease'
          }}
        >
          <RotateCcwIcon size={13} color="#475569" />
          <span>Reset</span>
        </button>
      </div>

      {/* LDraw Export */}
      <button
        onClick={onExportLDR}
        disabled={isLoading}
        style={{
          height: 34,
          borderRadius: 7,
          border: '1px solid #bfdbfe',
          backgroundColor: '#eff6ff',
          color: '#2563eb',
          fontSize: 12,
          fontWeight: 700,
          cursor: isLoading ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          transition: 'all 0.15s ease'
        }}
      >
        <DownloadIcon size={14} color="#2563eb" />
        <span>Export LDraw (.ldr)</span>
      </button>
    </div>
  );
};
