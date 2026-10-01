import React, { useState, useMemo } from 'react';
import { PlacedBrick, VoxelGrid } from '../../engine/types';
import { BuildabilityReport, HarmonizationResult } from '../../engine/polishHarmonizer';
import { MeshDistanceResult } from '../../engine/meshDistanceMetric';
import { ChevronDownIcon, ChevronRightIcon } from '../common/Icons';

interface ModelStatsOverlayProps {
  bricks: PlacedBrick[];
  grid: VoxelGrid | null;
  buildabilityReport: BuildabilityReport | null;
  harmonizationResult: HarmonizationResult | null;
  distanceMetric: MeshDistanceResult | null;
  phase: string;
  style?: React.CSSProperties;
}

export const ModelStatsOverlay: React.FC<ModelStatsOverlayProps> = ({
  bricks,
  grid,
  buildabilityReport,
  harmonizationResult,
  distanceMetric,
  phase,
  style
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const stats = useMemo(() => {
    let bricksCount = 0;
    let platesCount = 0;
    let slopesCount = 0;
    let canistersCount = 0;
    let tilesCount = 0;
    let macaroniCount = 0;
    const uniquePartsSet = new Set<string>();

    for (const b of bricks) {
      uniquePartsSet.add(b.partId);
      if (b.profile === 'tile_flat') {
        tilesCount++;
      } else if (
        b.profile === 'slope_curved' ||
        b.profile === 'slope_inverted' ||
        b.profile === 'slope_45' ||
        b.profile === 'slope_33' ||
        b.profile === 'cheese'
      ) {
        slopesCount++;
      } else if (
        b.profile === 'round_cylinder' ||
        b.profile === 'round_plate' ||
        ['3062b', '6141', '3941', '4032', '4032a', '6222', '60474'].includes(b.partId)
      ) {
        canistersCount++;
      } else if (b.profile === 'macaroni' || b.partId === '27925' || b.partId === '3063b') {
        macaroniCount++;
      } else if (b.size[2] === 1) {
        platesCount++;
      } else {
        bricksCount++;
      }
    }

    const studsX = grid ? grid.numStudsX : 0;
    const studsZ = grid ? grid.numStudsZ : 0;
    const platesY = grid ? grid.numPlatesY : 0;
    const bricksY = Math.ceil(platesY / 3);

    const dimWidthMm = studsX * 8;
    const dimDepthMm = studsZ * 8;
    const dimHeightMm = platesY * 3.2;

    return {
      total: bricks.length,
      uniqueParts: uniquePartsSet.size,
      bricksCount,
      platesCount,
      slopesCount,
      canistersCount,
      tilesCount,
      macaroniCount,
      studsX,
      studsZ,
      platesY,
      bricksY,
      dimWidthMm,
      dimDepthMm,
      dimHeightMm
    };
  }, [bricks, grid]);

  if (bricks.length === 0 && !grid) {
    return null;
  }

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 25,
        backgroundColor: 'rgba(255, 255, 255, 0.94)',
        backdropFilter: 'blur(12px)',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
        color: '#0f172a',
        fontSize: 11,
        width: isExpanded ? 280 : 'auto',
        overflow: 'hidden',
        transition: 'width 0.2s ease, max-height 0.2s ease',
        userSelect: 'none',
        ...style
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
          backgroundColor: isExpanded ? '#f8fafc' : 'transparent',
          borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, letterSpacing: 0.6, fontSize: 10, color: '#475569' }}>
            MODEL STATS
          </span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 4,
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#2563eb',
              fontSize: 10,
              fontWeight: 600
            }}
          >
            {stats.total} pcs
          </span>
        </div>

        <button
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
          aria-label={isExpanded ? 'Collapse stats' : 'Expand stats'}
        >
          {isExpanded ? <ChevronDownIcon size={14} color="#64748b" /> : <ChevronRightIcon size={14} color="#64748b" />}
        </button>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Dimensions */}
          <div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
              Dimensions
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Grid:</span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                {stats.studsX} x {stats.studsZ} studs ({stats.bricksY}B / {stats.platesY}P)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
              <span>Scale (mm):</span>
              <span>
                {stats.dimWidthMm.toFixed(0)} x {stats.dimDepthMm.toFixed(0)} x {stats.dimHeightMm.toFixed(0)} mm
              </span>
            </div>
          </div>

          <div style={{ height: 1, backgroundColor: '#e2e8f0' }} />

          {/* Element Breakdown */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Element Breakdown
              </span>
              <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>
                {stats.uniqueParts} unique types
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px 8px',
                fontSize: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Bricks:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.bricksCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Plates:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.platesCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Slopes:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.slopesCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Canisters:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.canistersCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Tiles:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.tilesCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Macaroni:</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{stats.macaroniCount}</span>
              </div>
            </div>
          </div>

          {/* Buildability & Interlocking Clutch */}
          <div style={{ height: 1, backgroundColor: '#e2e8f0' }} />

          <div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
              Structural Clutch
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: '#64748b' }}>Grounded:</span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                {buildabilityReport
                  ? buildabilityReport.is100PercentGrounded
                    ? '100% Grounded'
                    : `${buildabilityReport.groundedBricksCount}/${buildabilityReport.totalBricks}`
                  : 'Grounded'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: '#64748b' }}>Interlock:</span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                {buildabilityReport ? `${buildabilityReport.interlockRatio}% Clutch` : 'Running Bond'}
              </span>
            </div>
          </div>

          {/* Surface Fidelity (if distance evaluated) */}
          {distanceMetric && (
            <>
              <div style={{ height: 1, backgroundColor: '#e2e8f0' }} />
              <div>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                  Surface Fidelity
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: '#64748b' }}>Mean Chamfer:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>
                    {distanceMetric.meanDistanceMm.toFixed(2)} mm
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: '#64748b' }}>Score:</span>
                  <span style={{ fontWeight: 700, color: '#2563eb' }}>
                    {distanceMetric.surfaceFidelityScore}%
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Harmonization summary (if run) */}
          {harmonizationResult && harmonizationResult.totalModifications > 0 && (
            <>
              <div style={{ height: 1, backgroundColor: '#e2e8f0' }} />
              <div style={{ fontSize: 10, color: '#2563eb', display: 'flex', justifyContent: 'space-between' }}>
                <span>Polish pass:</span>
                <span style={{ fontWeight: 600 }}>{harmonizationResult.totalModifications} tuned</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
