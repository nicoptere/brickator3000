/**
 * Connector Database & Connectivity Dictionary Inspector Modal/Drawer.
 *
 * Displays the complete LDraw connector database sorted as LEAF, EDGE, FILL, EMPTY:
 * - Details stud/tube counts, dimensions, slope angle, curvature classification.
 * - Shows equivalence table between pieces and connectivity information.
 */

import React, { useState } from 'react';
import { CONNECTOR_DATABASE, LDrawConnectorMeta } from '../engine/connectorDatabase';
import { CONNECTIVITY_SIGNATURES } from '../engine/connectivityDictionary';
import { PieceCategory } from '../engine/types';

interface ConnectorDatabaseInspectorProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectorDatabaseInspector: React.FC<ConnectorDatabaseInspectorProps> = ({
  isOpen,
  onClose
}) => {
  const [selectedCategory, setSelectedCategory] = useState<PieceCategory | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const allConnectors = Array.from(CONNECTOR_DATABASE.connectors.values());
  const filtered = allConnectors.filter(c => {
    if (selectedCategory !== 'ALL' && c.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return c.partId.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: '90%',
          maxWidth: 1100,
          maxHeight: '85vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, rgba(30, 41, 59, 0.5), rgba(15, 23, 42, 0.8))'
          }}
        >
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#38bdf8' }}>
              LDraw Connector Database & Connectivity Dictionary
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
              Hyperedge classification: LEAF, EDGE, FILL & stud equivalence tables
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 16,
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 6
            }}
          >
            Close
          </button>
        </div>

        {/* Filters Bar */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            backgroundColor: '#1e293b'
          }}
        >
          <input
            type="text"
            placeholder="Search part ID or name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.25)',
              backgroundColor: '#090a0f',
              color: '#f8fafc',
              fontSize: 13,
              outline: 'none',
              width: 260
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            {(['ALL', 'FILL', 'EDGE', 'LEAF'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor:
                    selectedCategory === cat
                      ? cat === 'LEAF'
                        ? '#10b981'
                        : cat === 'EDGE'
                        ? '#3b82f6'
                        : cat === 'FILL'
                        ? '#f59e0b'
                        : '#38bdf8'
                      : '#334155',
                  color: selectedCategory === cat ? '#ffffff' : '#cbd5e1',
                  transition: 'all 0.15s ease'
                }}
              >
                {cat} ({cat === 'ALL' ? allConnectors.length : CONNECTOR_DATABASE.getByCategory(cat as PieceCategory).length})
              </button>
            ))}
          </div>
        </div>

        {/* Table Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16
            }}
          >
            {filtered.map(connector => {
              const [wX, wZ, hY] = connector.footprint;
              const catColor =
                connector.category === 'LEAF'
                  ? '#10b981'
                  : connector.category === 'EDGE'
                  ? '#3b82f6'
                  : '#f59e0b';

              const topStuds = connector.fingerprint.variants.get(0)?.topStuds.length ?? 0;
              const bottomTubes = connector.fingerprint.variants.get(0)?.bottomTubes.length ?? 0;

              return (
                <div
                  key={connector.partId}
                  style={{
                    backgroundColor: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          backgroundColor: `${catColor}22`,
                          color: catColor,
                          border: `1px solid ${catColor}44`,
                          marginRight: 6
                        }}
                      >
                        {connector.category}
                      </span>
                      {connector.isModern && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: '#8b5cf622',
                            color: '#a78bfa',
                            border: '1px solid #8b5cf644'
                          }}
                        >
                          MODERN
                        </span>
                      )}
                      <h4 style={{ margin: '8px 0 2px', fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>
                        {connector.name}
                      </h4>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#94a3b8' }}>
                        LDraw ID: {connector.partId}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '4px 8px',
                        background: '#090a0f',
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: '#38bdf8'
                      }}
                    >
                      {wX}x{wZ}x{hY}p
                    </div>
                  </div>

                  {/* Connectivity Details Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      fontSize: 11,
                      padding: 10,
                      backgroundColor: 'rgba(15, 23, 42, 0.6)',
                      borderRadius: 8,
                      color: '#cbd5e1'
                    }}
                  >
                    <div>
                      <span style={{ color: '#94a3b8' }}>Profile:</span> {connector.profile}
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Curvature:</span> {connector.curvatureClass}
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Top Studs:</span> {topStuds}
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Bottom Tubes:</span> {bottomTubes}
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Clutch Rating:</span> {connector.bondingCapacity}/10
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Slope Angle:</span> {connector.slopeAngle}°
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
