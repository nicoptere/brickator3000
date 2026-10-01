/**
 * ColorModeSelector - Color Scheme Control Component (Zero Emojis).
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
    { id: 'island_components', label: 'Mesh Islands', desc: 'Each component has its own random color material' },
    { id: 'wfc_hierarchy', label: 'WFC Scale N=', desc: 'Hierarchical scale levels (N=8..0)' },
    { id: 'actual', label: 'Source RGB', desc: 'Direct 24-bit RGB texture sampling' }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        >
          Color Material Scheme
        </label>
        <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>
          {colorMode === 'island_components' ? 'Random Materials' : colorMode === 'wfc_hierarchy' ? 'Multi-Scale' : 'Direct RGB'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
        {modes.map((cm) => {
          const isSelected = colorMode === cm.id;
          return (
            <button
              key={cm.id}
              onClick={() => onChangeColorMode(cm.id)}
              style={{
                height: 30,
                padding: '0 4px',
                borderRadius: 6,
                border: isSelected ? '1px solid #2563eb' : '1px solid #e2e8f0',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: isSelected ? '#2563eb' : '#f8fafc',
                color: isSelected ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease'
              }}
              title={cm.desc}
            >
              {cm.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
