import React from 'react';
import { PanelLeftIcon, PanelRightIcon } from '../../components/common/Icons';

interface StudioHudProps {
  isLeftDrawerOpen: boolean;
  onOpenLeftDrawer: () => void;
  isRightDrawerOpen: boolean;
  onOpenRightDrawer: () => void;
  currentPhaseTitle: string;
  stats: {
    totalPlaced: number;
    leafCount: number;
    edgeCount: number;
    fillCount: number;
    uniqueParts: number;
    coverage: number;
  };
}

export const StudioHud: React.FC<StudioHudProps> = ({
  isLeftDrawerOpen,
  onOpenLeftDrawer,
  isRightDrawerOpen,
  onOpenRightDrawer,
  currentPhaseTitle,
  stats
}) => {
  return (
    <>
      {/* Floating Drawer Toggle Buttons */}
      <div style={{ position: 'absolute', top: 14, left: 16, zIndex: 30, display: 'flex', gap: 8 }}>
        {!isLeftDrawerOpen && (
          <button
            onClick={onOpenLeftDrawer}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(8px)',
              color: '#0f172a',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
            }}
          >
            <PanelLeftIcon size={14} color="#2563eb" />
            <span>Show Models</span>
          </button>
        )}
      </div>

      <div style={{ position: 'absolute', top: 14, right: 16, zIndex: 30, display: 'flex', gap: 8 }}>
        {!isRightDrawerOpen && (
          <button
            onClick={onOpenRightDrawer}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(8px)',
              color: '#0f172a',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
            }}
          >
            <PanelRightIcon size={14} color="#2563eb" />
            <span>Show Settings</span>
          </button>
        )}
      </div>

      {/* Top Floating HUD: Real-time BOM & Pipeline Analytics */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: isLeftDrawerOpen ? 16 : 140,
          right: isRightDrawerOpen ? 16 : 140,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 10
        }}
      >
        <div
          style={{
            padding: '6px 16px',
            backgroundColor: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
            color: '#0f172a',
            fontSize: 11,
            pointerEvents: 'auto'
          }}
        >
          <div>
            <span style={{ color: '#64748b' }}>Phase:</span>{' '}
            <span style={{ fontWeight: 700, color: '#2563eb' }}>{currentPhaseTitle}</span>
          </div>

          <div style={{ width: 1, height: 14, backgroundColor: '#e2e8f0' }} />

          <div>
            <span style={{ color: '#64748b' }}>Bricks:</span>{' '}
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{stats.totalPlaced}</span>
          </div>

          <div>
            <span style={{ color: '#64748b' }}>FILL:</span>{' '}
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{stats.fillCount}</span>
          </div>

          <div>
            <span style={{ color: '#64748b' }}>EDGE:</span>{' '}
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{stats.edgeCount}</span>
          </div>

          <div>
            <span style={{ color: '#64748b' }}>LEAF:</span>{' '}
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{stats.leafCount}</span>
          </div>

          <div style={{ width: 1, height: 14, backgroundColor: '#e2e8f0' }} />

          <div>
            <span style={{ color: '#64748b' }}>Parts:</span>{' '}
            <span style={{ fontWeight: 700, color: '#2563eb' }}>{stats.uniqueParts}</span>
          </div>

          <div>
            <span style={{ color: '#64748b' }}>Coverage:</span>{' '}
            <span style={{ fontWeight: 700, color: '#2563eb' }}>{stats.coverage}%</span>
          </div>

          <div style={{ width: 1, height: 14, backgroundColor: '#e2e8f0' }} />

          <div style={{ fontSize: 10, color: '#64748b' }}>
            Authentic LDraw System (20x20x24 LDU)
          </div>
        </div>
      </div>
    </>
  );
};
