/**
 * ModelParamsInspector - Left Drawer Section 2 Component.
 *
 * Encapsulates:
 * - Voxel Shell Mode: Surface (Hits Only) vs Solid Volume
 * - 3D Source Mesh Overlay: Ghost Solid, Wireframe, Hidden
 * - Color Material Scheme: Mesh Islands, WFC Scale N=, Source RGB
 * - Topological Islands Inspector: Solo isolation, independent discretization, WFC on parts, re-roll colors
 *
 * Clean Gluestack/Tailwind-inspired styling with zero emojis.
 */

import React from 'react';
import { SourceMeshMode } from '../Viewport3D';
import { ColorModeSelector, ColorMode } from './ColorModeSelector';
import { IslandInspector, IslandMeta } from './IslandInspector';

interface ModelParamsInspectorProps {
  voxelizeMode: 'surface' | 'solid';
  onChangeVoxelizeMode: (m: 'surface' | 'solid') => void;
  sourceMeshMode: SourceMeshMode;
  onChangeSourceMeshMode: (m: SourceMeshMode) => void;
  colorMode: ColorMode;
  onChangeColorMode: (m: ColorMode) => void;
  islands?: IslandMeta[];
  selectedIslandId: number | null;
  onSelectIsland: (id: number | null) => void;
  onDiscretizeIsland: (id: number) => void;
  onDiscretizeAllIndependently: () => void;
  onSolveWfcOnIsland: (id: number | null) => void;
  onRerollColors: () => void;
  isLoading: boolean;
}

export const ModelParamsInspector: React.FC<ModelParamsInspectorProps> = ({
  voxelizeMode,
  onChangeVoxelizeMode,
  sourceMeshMode,
  onChangeSourceMeshMode,
  colorMode,
  onChangeColorMode,
  islands = [],
  selectedIslandId,
  onSelectIsland,
  onDiscretizeIsland,
  onDiscretizeAllIndependently,
  onSolveWfcOnIsland,
  onRerollColors,
  isLoading
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1. Voxel Shell Mode */}
      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 6
          }}
        >
          Voxel Shell Mode
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {[
            { id: 'surface', label: 'Surface (Hits Only)' },
            { id: 'solid', label: 'Solid Volume' }
          ].map((vm) => {
            const isSelected = voxelizeMode === vm.id;
            return (
              <button
                key={vm.id}
                onClick={() => onChangeVoxelizeMode(vm.id as 'surface' | 'solid')}
                style={{
                  height: 30,
                  padding: '0 6px',
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
                {vm.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. 3D Source Mesh Overlay */}
      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 6
          }}
        >
          3D Source Mesh Overlay
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { id: 'ghost', label: 'Ghost Solid' },
            { id: 'wireframe', label: 'Wireframe' },
            { id: 'none', label: 'Hidden' }
          ].map((sm) => {
            const isSelected = sourceMeshMode === sm.id;
            return (
              <button
                key={sm.id}
                onClick={() => onChangeSourceMeshMode(sm.id as SourceMeshMode)}
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
              >
                {sm.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Color Material Scheme */}
      <ColorModeSelector
        colorMode={colorMode}
        onChangeColorMode={onChangeColorMode}
      />
    </div>
  );
};
