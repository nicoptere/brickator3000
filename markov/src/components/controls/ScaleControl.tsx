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
    { bricks: 4, label: '4b' },
    { bricks: 8, label: '8b' },
    { bricks: 12, label: '12b' },
    { bricks: 16, label: '16b' },
    { bricks: 24, label: '24b' },
    { bricks: 32, label: '32b' }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          Scale (1*1*1 Bricks)
        </label>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#2563eb', fontWeight: 700 }}>
          {targetHeightBricks} BRICKS ({targetHeightBricks * 24} LDU)
        </span>
      </div>

      <input
        type="range"
        min={2}
        max={32}
        step={1}
        value={targetHeightBricks}
        onChange={(e) => onChangeHeight(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginTop: 6 }}>
        {presets.map((preset) => (
          <button
            key={preset.bricks}
            onClick={() => onChangeHeight(preset.bricks)}
            style={{
              padding: '4px 2px',
              borderRadius: 4,
              border: targetHeightBricks === preset.bricks ? '1px solid #2563eb' : '1px solid #e2e8f0',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: targetHeightBricks === preset.bricks ? '#2563eb' : '#f8fafc',
              color: targetHeightBricks === preset.bricks ? '#ffffff' : '#475569',
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
