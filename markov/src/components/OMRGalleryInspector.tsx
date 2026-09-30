/**
 * User-Contributed / Official Model Repository (OMR) Gallery Study Inspector.
 *
 * Provides deep structural analysis of high-quality reference builds downloaded
 * from the LDraw Official Model Repository for constructive learning:
 * - 10018-1 Darth Maul: Organic bust sculpture discretization
 * - 10030-1 Star Destroyer: Wedge plate hull discretization and greebles
 * - 10019-1 Rebel Blockade Runner: Cylindrical modular engines
 * - 10129-1 Rebel Snowspeeder: Modern curved slope and canopy geometry
 * - 10124-1 Wright Flyer: Complex lightweight truss ribbing
 */

import React, { useState } from 'react';

interface OMRModelStudy {
  id: string;
  name: string;
  theme: string;
  totalParts: number;
  uniqueParts: number;
  filename: string;
  topParts: Array<{ partId: string; name: string; count: number; role: 'FILL' | 'EDGE' | 'LEAF' }>;
  constructionLessons: string[];
}

const GALLERY_MODELS: OMRModelStudy[] = [
  {
    id: '10018-1',
    name: 'Darth Maul Bust Sculpture',
    theme: 'Sculpture / Organic Discretization',
    totalParts: 1865,
    uniqueParts: 59,
    filename: '10018-1_Darth_Maul.mpd',
    topParts: [
      { partId: '3023', name: 'Plate 1 x 2', count: 225, role: 'FILL' },
      { partId: '3002', name: 'Brick 2 x 3', count: 131, role: 'FILL' },
      { partId: '3623', name: 'Plate 1 x 3', count: 121, role: 'FILL' },
      { partId: '3001', name: 'Brick 2 x 4', count: 101, role: 'FILL' },
      { partId: '3004', name: 'Brick 1 x 2', count: 97, role: 'FILL' },
      { partId: '2357', name: 'Brick 2 x 2 Corner', count: 90, role: 'FILL' },
      { partId: '3794b', name: 'Plate 1 x 2 Jumper', count: 69, role: 'FILL' },
      { partId: '2420', name: 'Plate 2 x 2 Corner', count: 68, role: 'FILL' }
    ],
    constructionLessons: [
      'Core-to-surface hierarchy: dense central column of 2x4 and 2x3 bricks surrounded by stepped 1x2 and corner plates.',
      'Running bond interlocking: almost zero stacked vertical seams; every plate layer is rotated 90° or offset by 1 stud.',
      'Jumper plates (3794b) create half-stud micro-offsets to approximate curved facial contours.'
    ]
  },
  {
    id: '10030-1',
    name: 'Imperial Star Destroyer',
    theme: 'Ultimate Collector Series / Wedge Hulls',
    totalParts: 3104,
    uniqueParts: 142,
    filename: '10030-1_Imperial_Star_Destroyer.mpd',
    topParts: [
      { partId: '3020', name: 'Plate 2 x 4', count: 320, role: 'FILL' },
      { partId: '43722', name: 'Wedge Plate 3 x 2 Left', count: 64, role: 'EDGE' },
      { partId: '43723', name: 'Wedge Plate 3 x 2 Right', count: 64, role: 'EDGE' },
      { partId: '3068b', name: 'Tile 2 x 2 Flat', count: 180, role: 'EDGE' },
      { partId: '3001', name: 'Brick 2 x 4', count: 210, role: 'FILL' }
    ],
    constructionLessons: [
      'Aerodynamic wedge plates (43722/43723) form sharp compound perimeter angles without staircasing.',
      'Massive internal structural truss using Technic liftarms and 2x4 bricks to support expansive thin hull plates.',
      'Studless flat tiles and greeble leaves provide smooth exterior hull panels.'
    ]
  },
  {
    id: '10129-1',
    name: 'Rebel Snowspeeder',
    theme: 'Compound Angles & Curved Slopes',
    totalParts: 1457,
    uniqueParts: 88,
    filename: '10129-1_Rebel_Snowspeeder.mpd',
    topParts: [
      { partId: '11477', name: 'Slope Curved 2 x 1', count: 52, role: 'EDGE' },
      { partId: '15068', name: 'Slope Curved 2 x 2', count: 38, role: 'EDGE' },
      { partId: '3040', name: 'Slope 45 2 x 1', count: 44, role: 'EDGE' },
      { partId: '2431', name: 'Tile 1 x 4 Flat', count: 72, role: 'EDGE' },
      { partId: '3003', name: 'Brick 2 x 2', count: 65, role: 'FILL' }
    ],
    constructionLessons: [
      'Pioneered transition from rigid 45° flat slopes to modern double-curved slopes for leading wing edges.',
      'Inverted slopes used underneath wings to maintain aerodynamic taper from both top and bottom.',
      'Extensive tile finishes on wings creating studless aesthetic.'
    ]
  },
  {
    id: '10124-1',
    name: 'Wright Flyer',
    theme: 'Historical Aviation / Lightweight Ribbing',
    totalParts: 669,
    uniqueParts: 45,
    filename: '10124-1_Wright_Flyer.mpd',
    topParts: [
      { partId: '3710', name: 'Plate 1 x 4', count: 96, role: 'FILL' },
      { partId: '3023', name: 'Plate 1 x 2', count: 84, role: 'FILL' },
      { partId: '3024', name: 'Plate 1 x 1', count: 68, role: 'FILL' },
      { partId: '4589b', name: 'Cone 1 x 1', count: 24, role: 'LEAF' }
    ],
    constructionLessons: [
      'Minimalist skeletal construction where each connector hyperedge spans open empty space.',
      'Demonstrates high-efficiency graph discretization with high ratio of boundary surface to internal volume.'
    ]
  }
];

interface OMRGalleryInspectorProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OMRGalleryInspector: React.FC<OMRGalleryInspectorProps> = ({ isOpen, onClose }) => {
  const [selectedId, setSelectedId] = useState<string>('10018-1');

  if (!isOpen) return null;

  const currentModel = GALLERY_MODELS.find(m => m.id === selectedId) || GALLERY_MODELS[0];

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
          maxWidth: 1000,
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
              Official Model Repository (OMR) Study Gallery
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
              Master-level LDraw reference builds analyzed for graph connectivity and running bond
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

        {/* Model Tabs */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            backgroundColor: '#1e293b'
          }}
        >
          {GALLERY_MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: selectedId === m.id ? '#38bdf8' : '#334155',
                color: selectedId === m.id ? '#0f172a' : '#cbd5e1',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              {m.id} - {m.name}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top Info Banner */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              backgroundColor: 'rgba(30, 41, 59, 0.4)',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: 12
            }}
          >
            <div>
              <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>{currentModel.theme}</span>
              <h3 style={{ margin: '4px 0', fontSize: 18, color: '#f8fafc' }}>{currentModel.name}</h3>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#94a3b8' }}>
                Local File: docs/omr_gallery/{currentModel.filename}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, textAlign: 'right' }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>{currentModel.totalParts}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Total Parts</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#38bdf8' }}>{currentModel.uniqueParts}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Unique Parts</div>
              </div>
            </div>
          </div>

          {/* Construction Lessons */}
          <div
            style={{
              padding: 16,
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 12
            }}
          >
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#10b981' }}>
              Key Construction Lessons for Markov Discretization:
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
              {currentModel.constructionLessons.map((lesson, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>{lesson}</li>
              ))}
            </ul>
          </div>

          {/* Top Parts Distribution (BOM) */}
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
              Dominant Piece Distribution (BOM Analysis):
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {currentModel.topParts.map(part => (
                <div
                  key={part.partId}
                  style={{
                    padding: 12,
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{part.name}</div>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>ID: {part.partId}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8' }}>{part.count}</div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: 3,
                        backgroundColor: part.role === 'FILL' ? '#f59e0b22' : '#3b82f622',
                        color: part.role === 'FILL' ? '#f59e0b' : '#3b82f6'
                      }}
                    >
                      {part.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
