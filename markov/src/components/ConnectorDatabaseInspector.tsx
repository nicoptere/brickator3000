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
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
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
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.2)',
          overflow: 'hidden',
          color: '#0f172a'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc'
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              LDraw Connector Database & Connectivity Dictionary
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Hyperedge classification: LEAF, EDGE, FILL and stud equivalence tables
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 6,
              transition: 'all 0.15s ease'
            }}
          >
            Close
          </button>
        </div>

        {/* Filters Bar */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            backgroundColor: '#ffffff'
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
              border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              color: '#0f172a',
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
                  border: selectedCategory === cat ? 'none' : '1px solid #e2e8f0',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: selectedCategory === cat ? '#2563eb' : '#f8fafc',
                  color: selectedCategory === cat ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease'
                }}
              >
                {cat} ({cat === 'ALL' ? allConnectors.length : CONNECTOR_DATABASE.getByCategory(cat as PieceCategory).length})
              </button>
            ))}
          </div>
        </div>

        {/* Table Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, backgroundColor: '#f8fafc' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16
            }}
          >
            {filtered.map(connector => {
              const [wX, wZ, hY] = connector.footprint;

              const topStuds = connector.fingerprint.variants.get(0)?.topStuds.length ?? 0;
              const bottomTubes = connector.fingerprint.variants.get(0)?.bottomTubes.length ?? 0;

              return (
                <div
                  key={connector.partId}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
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
                          backgroundColor: '#eff6ff',
                          color: '#2563eb',
                          border: '1px solid #bfdbfe',
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
                            backgroundColor: '#f1f5f9',
                            color: '#475569',
                            border: '1px solid #e2e8f0'
                          }}
                        >
                          MODERN
                        </span>
                      )}
                      <h4 style={{ margin: '8px 0 2px', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {connector.name}
                      </h4>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#64748b' }}>
                        LDraw ID: {connector.partId}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '4px 8px',
                        background: '#f1f5f9',
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        color: '#0f172a',
                        border: '1px solid #e2e8f0'
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
                      backgroundColor: '#f8fafc',
                      borderRadius: 8,
                      color: '#334155',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <div>
                      <span style={{ color: '#64748b' }}>Profile:</span> {connector.profile}
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Curvature:</span> {connector.curvatureClass}
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Top Studs:</span> {topStuds}
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Bottom Tubes:</span> {bottomTubes}
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Clutch Rating:</span> {connector.bondingCapacity}/10
                    </div>
                    <div>
                      <span style={{ color: '#64748b' }}>Slope Angle:</span> {connector.slopeAngle}°
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
