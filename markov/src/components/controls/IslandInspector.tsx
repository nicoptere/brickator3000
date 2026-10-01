/**
 * IslandInspector - Topological Island Components & Per-Part Controller (Zero Emojis).
 */

import React from 'react';
import { RefreshIcon } from '../common/Icons';

export interface IslandMeta {
  id: number;
  triangleCount: number;
  colorHex: string;
  name?: string;
}

interface IslandInspectorProps {
  islands: IslandMeta[];
  selectedIslandId: number | null;
  onSelectIsland: (id: number | null) => void;
  onDiscretizeIsland: (id: number) => void;
  onDiscretizeAllIndependently: () => void;
  onSolveWfcOnIsland: (id: number | null) => void;
  onRerollColors: () => void;
  isLoading: boolean;
}

export const IslandInspector: React.FC<IslandInspectorProps> = ({
  islands,
  selectedIslandId,
  onSelectIsland,
  onDiscretizeIsland,
  onDiscretizeAllIndependently,
  onSolveWfcOnIsland,
  onRerollColors,
  isLoading
}) => {
  if (!islands || islands.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Topological Islands ({islands.length})
          </span>
          <div style={{ fontSize: 10, color: '#64748b' }}>
            {selectedIslandId != null ? `Viewing Island #${selectedIslandId} Solo` : 'Viewing Full Assembly'}
          </div>
        </div>

        <button
          onClick={onRerollColors}
          title="Re-randomize island color materials"
          style={{
            height: 24,
            padding: '0 8px',
            borderRadius: 4,
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            color: '#2563eb',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <RefreshIcon size={11} />
          <span>Re-roll Colors</span>
        </button>
      </div>

      {/* Discretization & WFC Action Triggers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
        <button
          onClick={onDiscretizeAllIndependently}
          disabled={isLoading}
          style={{
            height: 28,
            padding: '0 6px',
            borderRadius: 5,
            border: '1px solid #bfdbfe',
            backgroundColor: '#eff6ff',
            color: '#2563eb',
            fontSize: 10,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
          title="Discretize all islands independently one by one with dedicated seed cores"
        >
          Discretize Separately
        </button>

        <button
          onClick={() => onSolveWfcOnIsland(selectedIslandId)}
          disabled={isLoading}
          style={{
            height: 28,
            padding: '0 6px',
            borderRadius: 5,
            border: '1px solid #bfdbfe',
            backgroundColor: '#eff6ff',
            color: '#2563eb',
            fontSize: 10,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
          title="Run WFC adjacency optimization on individual part or assembly"
        >
          {selectedIslandId != null ? `WFC on Island #${selectedIslandId}` : 'WFC on Parts'}
        </button>
      </div>

      {/* Island List with Solo Selection and Color Badges */}
      <div
        style={{
          maxHeight: 140,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          paddingRight: 2
        }}
      >
        <button
          onClick={() => onSelectIsland(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 8px',
            borderRadius: 5,
            border: selectedIslandId === null ? '1px solid #2563eb' : '1px solid #e2e8f0',
            backgroundColor: selectedIslandId === null ? '#eff6ff' : '#ffffff',
            color: selectedIslandId === null ? '#2563eb' : '#475569',
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <span style={{ fontWeight: 600 }}>Show All Islands (Full Assembly)</span>
          <span style={{ fontSize: 9, opacity: 0.7 }}>All Parts</span>
        </button>

        {islands.map((isl) => {
          const isSelected = selectedIslandId === isl.id;
          return (
            <div
              key={isl.id}
              onClick={() => onSelectIsland(isSelected ? null : isl.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                borderRadius: 5,
                border: isSelected ? '1px solid #2563eb' : '1px solid #e2e8f0',
                backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'background-color 0.1s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    flexShrink: 0,
                    backgroundColor: isl.colorHex,
                    border: '1px solid rgba(0,0,0,0.15)',
                    boxShadow: `0 1px 3px rgba(0,0,0,0.1)`
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? '#2563eb' : '#0f172a',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {isl.name || `Island #${isl.id}`}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                  {isl.triangleCount} tris
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscretizeIsland(isl.id);
                  }}
                  title={`Discretize Island #${isl.id} alone`}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: '1px solid #bfdbfe',
                    backgroundColor: '#eff6ff',
                    color: '#2563eb',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Solo
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
