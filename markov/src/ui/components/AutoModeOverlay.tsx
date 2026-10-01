import React from 'react';
import { PlayIcon, PauseIcon } from '../../components/common/Icons';

interface AutoModeOverlayProps {
  isAutoMode: boolean;
  onToggleAuto: () => void;
}

export const AutoModeOverlay: React.FC<AutoModeOverlayProps> = ({
  isAutoMode,
  onToggleAuto
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 25,
        pointerEvents: 'auto'
      }}
    >
      <button
        onClick={onToggleAuto}
        title={
          isAutoMode
            ? 'Turn Auto Mode OFF'
            : 'Turn Auto Mode ON (Turntable slideshow: build, 5s display, unbuild)'
        }
        style={{
          height: 32,
          padding: '0 12px',
          borderRadius: 6,
          backgroundColor: isAutoMode ? '#eff6ff' : 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(12px)',
          border: isAutoMode ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
          color: isAutoMode ? '#2563eb' : '#0f172a',
          fontWeight: 700,
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: isAutoMode
            ? '0 0 12px rgba(37, 99, 235, 0.35)'
            : '0 4px 14px rgba(0, 0, 0, 0.12)',
          transition: 'all 0.15s ease'
        }}
        onMouseEnter={(e) => {
          if (!isAutoMode) {
            e.currentTarget.style.backgroundColor = '#f8fafc';
            e.currentTarget.style.borderColor = '#2563eb';
          }
        }}
        onMouseLeave={(e) => {
          if (!isAutoMode) {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.94)';
            e.currentTarget.style.borderColor = '#e2e8f0';
          }
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: isAutoMode ? '#2563eb' : '#94a3b8',
            boxShadow: isAutoMode ? '0 0 6px #2563eb' : 'none'
          }}
        />
        <span>AUTO</span>
        {isAutoMode ? (
          <PauseIcon size={12} color="#2563eb" />
        ) : (
          <PlayIcon size={11} color="#64748b" />
        )}
      </button>
    </div>
  );
};
