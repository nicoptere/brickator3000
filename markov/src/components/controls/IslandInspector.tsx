/**
 * IslandInspector - Decoupled Island Components & Per-Part Discretization Controller.
 *
 * Implements:
 * - Island component list with unique random color material badges
 * - Island Solo mode (isolate view and work on a single part)
 * - Independent per-island discretization trigger
 * - Per-part WFC refiner solver trigger
 * - Random color material re-roller
 */

import React from 'react';

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
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        borderRadius: 8,
        border: '1px solid rgba(148, 163, 184, 0.15)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Topological Islands ({islands.length})
          </span>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>
            {selectedIslandId != null ? `Viewing Island #${selectedIslandId} Solo` : 'Viewing Full Assembly'}
          </div>
        </div>

        <button
          onClick={onRerollColors}
          title="Re-randomize island color materials"
          style={{
            padding: '3px 8px',
            borderRadius: 5,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            backgroundColor: '#1e293b',
            color: '#38bdf8',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          🎲 Re-roll Colors
        </button>
      </div>

      {/* Independent Discretization & WFC Action Triggers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={onDiscretizeAllIndependently}
          disabled={isLoading}
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid rgba(56, 189, 248, 0.3)',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            color: '#38bdf8',
            fontSize: 10,
            fontWeight: 700,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
          title="Discretize all islands independently one by one with dedicated seed cores"
        >
          🧩 Discretize Separately
        </button>

        <button
          onClick={() => onSolveWfcOnIsland(selectedIslandId)}
          disabled={isLoading}
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid rgba(168, 85, 247, 0.3)',
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
            color: '#c084fc',
            fontSize: 10,
            fontWeight: 700,
            cursor: isLoading ? 'wait' : 'pointer'
          }}
          title="Run WFC adjacency optimization on individual part"
        >
          🎲 {selectedIslandId != null ? `WFC on Island #${selectedIslandId}` : 'WFC on Parts'}
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
          paddingRight: 4
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
            border: selectedIslandId === null ? '1px solid #38bdf8' : '1px solid transparent',
            backgroundColor: selectedIslandId === null ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.4)',
            color: selectedIslandId === null ? '#38bdf8' : '#94a3b8',
            fontSize: 11,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <span style={{ fontWeight: 600 }}>🌟 Show All Islands (Full Assembly)</span>
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
                border: isSelected ? '1px solid #c084fc' : '1px solid transparent',
                backgroundColor: isSelected ? 'rgba(192, 132, 252, 0.15)' : 'rgba(30, 41, 59, 0.3)',
                cursor: 'pointer',
                transition: 'background-color 0.1s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: isl.colorHex,
                    border: '1px solid rgba(255,255,255,0.3)',
                    boxShadow: `0 0 6px ${isl.colorHex}44`
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#f8fafc' : '#cbd5e1' }}>
                  {isl.name || `Island #${isl.id}`}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    padding: '2px 5px',
                    borderRadius: 3,
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    backgroundColor: '#0f172a',
                    color: '#38bdf8',
                    fontSize: 9,
                    cursor: 'pointer'
                  }}
                >
                  ⚡ Solo
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
