/**
 * ColorModeSelector - Decoupled Color Scheme Control Component.
 */

import React from 'react';

export type ColorMode = 'island_components' | 'wfc_hierarchy' | 'actual';

interface ColorModeSelectorProps {
  colorMode: ColorMode;
  onChangeColorMode: (m: ColorMode) => void;
}

export const ColorModeSelector: React.FC<ColorModeSelectorProps> = ({
  colorMode,
  onChangeColorMode
}) => {
  const modes: Array<{ id: ColorMode; label: string; desc: string }> = [
    { id: 'island_components', label: '🏝️ Mesh Islands', desc: 'Each component has its own random color material' },
    { id: 'wfc_hierarchy', label: '🎨 WFC Scale N=', desc: 'Hierarchical scale levels (N=8..0)' },
    { id: 'actual', label: '🌈 Source RGB', desc: 'Direct 24-bit RGB texture sampling' }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          Color Material Scheme
        </label>
        <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600 }}>
          {colorMode === 'island_components' ? 'Random Materials' : colorMode === 'wfc_hierarchy' ? 'Multi-Scale' : 'Direct RGB'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {modes.map((cm) => (
          <button
            key={cm.id}
            onClick={() => onChangeColorMode(cm.id)}
            style={{
              padding: '7px 4px',
              borderRadius: 6,
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: colorMode === cm.id ? '#8b5cf6' : '#1e293b',
              color: colorMode === cm.id ? '#ffffff' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
            title={cm.desc}
          >
            {cm.label}
          </button>
        ))}
      </div>
    </div>
  );
};
