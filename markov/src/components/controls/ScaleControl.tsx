/**
 * ScaleControl - Decoupled Brick Height & Scale Control Component.
 */

import React from 'react';

interface ScaleControlProps {
  targetHeightBricks: number;
  onChangeHeight: (h: number) => void;
}

export const ScaleControl: React.FC<ScaleControlProps> = ({
  targetHeightBricks,
  onChangeHeight
}) => {
  const presets = [
    { bricks: 12, label: '12b' },
    { bricks: 16, label: '16b' },
    { bricks: 24, label: '24b' },
    { bricks: 32, label: '32b' },
    { bricks: 48, label: '48b' }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          Scale (1*1*1 Bricks)
        </label>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700 }}>
          {targetHeightBricks} BRICKS ({targetHeightBricks * 24} LDU)
        </span>
      </div>

      <input
        type="range"
        min={8}
        max={64}
        step={1}
        value={targetHeightBricks}
        onChange={(e) => onChangeHeight(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginTop: 6 }}>
        {presets.map((preset) => (
          <button
            key={preset.bricks}
            onClick={() => onChangeHeight(preset.bricks)}
            style={{
              padding: '4px 2px',
              borderRadius: 4,
              border: 'none',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: targetHeightBricks === preset.bricks ? '#38bdf8' : '#1e293b',
              color: targetHeightBricks === preset.bricks ? '#0f172a' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
};
