/**
 * MeshPreprocessModal - Modal Popin displaying real-time 3D Mesh Pre-processing.
 *
 * Visualizes:
 * - Overall progress percentage (0% to 100%) with animated progress bar
 * - Active pre-process stage and descriptive step details
 * - 4-stage processing checklist (Load Mesh, Half-Edge Islands, Voxelize, Markov Core)
 * - Live list of detected topological mesh islands (components) with color swatches & triangle counts
 * - Clean Gluestack/Tailwind-inspired light theme with single accent color #2563eb
 * - Strictly zero emojis across all labels and badges
 */

import React from 'react';
import { CubeIcon, LayersIcon, CheckCircleIcon, SpinnerIcon } from './Icons';

export interface PreprocessStage {
  id: string;
  name: string;
  description: string;
}

export interface IslandSummary {
  id: number;
  name: string;
  triangleCount: number;
  colorHex: string;
}

interface MeshPreprocessModalProps {
  isOpen: boolean;
  modelName: string;
  progressPercent: number; // 0..100
  stageTitle: string;
  stageDetail: string;
  currentStageIndex: number; // 0, 1, 2, 3
  detectedIslands?: IslandSummary[];
}

const PREPROCESS_STAGES: PreprocessStage[] = [
  {
    id: 'load',
    name: 'Load 3D Geometry & Textures',
    description: 'Fetch GLTF/GLB buffer, parse Three.js mesh hierarchy, sample textures'
  },
  {
    id: 'islands',
    name: 'Topological Island Extraction',
    description: 'Build half-edge adjacency graph, stitch UV seams, cluster components via DSU'
  },
  {
    id: 'voxelize',
    name: 'Surface & Envelope Voxelization',
    description: 'Discretize into 1x1x1 brick grid, sample barycentric RGB colors, compute depth'
  },
  {
    id: 'markov',
    name: 'Initialize Markov Core Engine',
    description: 'Synthesize multi-head growth frontiers and query OMR domain knowledge tensor'
  }
];

export const MeshPreprocessModal: React.FC<MeshPreprocessModalProps> = ({
  isOpen,
  modelName,
  progressPercent,
  stageTitle,
  stageDetail,
  currentStageIndex,
  detectedIslands = []
}) => {
  if (!isOpen) return null;

  const clampedProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: '94vw',
          backgroundColor: '#ffffff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <CubeIcon size={20} color="#2563eb" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              Mesh Pre-Processing
            </div>
            <div
              style={{
                fontSize: 12,
                color: '#64748b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              Preparing 3D model: <span style={{ fontWeight: 600, color: '#2563eb' }}>{modelName}</span>
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 6,
              backgroundColor: '#eff6ff',
              color: '#2563eb',
              border: '1px solid #bfdbfe',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              letterSpacing: '0.02em'
            }}
          >
            <SpinnerIcon size={12} color="#2563eb" />
            <span>PROCESSING</span>
          </div>
        </div>

        {/* Progress & Current Activity */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              {stageTitle}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                fontFamily: 'monospace',
                color: '#2563eb'
              }}
            >
              {clampedProgress}%
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: '#64748b',
              minHeight: 16,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {stageDetail}
          </div>

          {/* Progress Bar Track */}
          <div
            style={{
              width: '100%',
              height: 8,
              borderRadius: 4,
              backgroundColor: '#e2e8f0',
              overflow: 'hidden',
              marginTop: 2
            }}
          >
            <div
              style={{
                width: `${clampedProgress}%`,
                height: '100%',
                backgroundColor: '#2563eb',
                borderRadius: 4,
                transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            />
          </div>
        </div>

        {/* Pipeline Stages Checklist */}
        <div
          style={{
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {PREPROCESS_STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIndex;
            const isCurrent = idx === currentStageIndex;
            const isPending = idx > currentStageIndex;

            return (
              <div
                key={stage.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  borderRadius: 6,
                  backgroundColor: isCurrent ? '#eff6ff' : 'transparent',
                  border: isCurrent ? '1px solid #bfdbfe' : '1px solid transparent',
                  transition: 'background-color 0.2s ease'
                }}
              >
                {/* Status Dot / Icon */}
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {isCompleted && (
                    <div style={{ color: '#2563eb' }}>
                      <CheckCircleIcon size={16} color="#2563eb" />
                    </div>
                  )}
                  {isCurrent && (
                    <SpinnerIcon size={16} color="#2563eb" />
                  )}
                  {isPending && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: '#cbd5e1'
                      }}
                    />
                  )}
                </div>

                {/* Stage Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: isCurrent ? 700 : isCompleted ? 600 : 400,
                      color: isCurrent ? '#2563eb' : isCompleted ? '#0f172a' : '#94a3b8'
                    }}
                  >
                    {stage.name}
                  </div>
                </div>

                {/* Stage Status Badge */}
                <div style={{ fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                  {isCompleted && (
                    <span style={{ color: '#2563eb' }}>Done</span>
                  )}
                  {isCurrent && (
                    <span style={{ color: '#2563eb' }}>Processing</span>
                  )}
                  {isPending && (
                    <span style={{ color: '#94a3b8' }}>Waiting</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Detected Topological Islands Section */}
        {detectedIslands.length > 0 && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LayersIcon size={14} color="#2563eb" />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Topological Islands Identified
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: '#2563eb'
                }}
              >
                {detectedIslands.length} Components
              </span>
            </div>

            <div
              style={{
                maxHeight: 110,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                paddingRight: 4
              }}
            >
              {detectedIslands.map((island) => (
                <div
                  key={island.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 8px',
                    borderRadius: 4,
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: 11
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor: island.colorHex,
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        flexShrink: 0
                      }}
                    />
                    <span
                      style={{
                        color: '#0f172a',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {island.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: '#64748b',
                      marginLeft: 8,
                      flexShrink: 0
                    }}
                  >
                    {island.triangleCount.toLocaleString()} tris
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
