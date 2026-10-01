import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { ViewportEngine, type ModelStats, type ViewportLayoutMode } from './viewportEngine';
import type { PlacedBrick, EvaluationStep } from '../core/types';
import type { PlateLattice3D } from '../core/PlateLattice3D';
import type { SolverResult } from '../solver/kernelSolver';
import type * as THREE from 'three';
import { Button, Tag, Typography, Tooltip, Space } from 'antd';
import {
  AppstoreOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  BuildOutlined,
  DeploymentUnitOutlined,
  EyeOutlined,
  AimOutlined
} from '@ant-design/icons';
import { StepScrubberBar } from '../components/StepScrubberBar';

const { Text } = Typography;

export interface Viewport3DProps {
  onModelLoaded?: (stats: ModelStats) => void;
  onLoadingProgress?: (progress: number) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
  discretizerResult?: SolverResult | null;
}

export interface Viewport3DHandle {
  loadModelFromUrl: (url: string, fileType: string, modelName: string) => Promise<void>;
  loadModelFromFile: (file: File) => Promise<void>;
  displayDiscretizedBricks: (bricks: PlacedBrick[], lattice: PlateLattice3D) => void;
  setViewMode: (mode: 'mesh' | 'lego' | 'both') => void;
  clearBricks: () => void;
  getActiveModel: () => THREE.Object3D | null;
  getEngine: () => ViewportEngine | null;
  updateMeshSnapping: (snap: boolean, targetStuds?: number, verticalUnit?: 'stud' | 'brick') => void;
  setLayoutMode: (mode: ViewportLayoutMode) => void;
  getLayoutMode: () => ViewportLayoutMode;
  setInspectionStep: (step: EvaluationStep | null) => void;
  displayVoxelSpace: (lattice: PlateLattice3D) => void;
}

export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(({
  onModelLoaded,
  onLoadingProgress,
  onError,
  onReady,
  discretizerResult
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViewportEngine | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [layoutMode, setLayoutModeState] = useState<ViewportLayoutMode>('lego');
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // Keep latest callbacks in ref to avoid re-instantiating ViewportEngine
  const callbacksRef = useRef({ onModelLoaded, onLoadingProgress, onError, onReady });
  callbacksRef.current = { onModelLoaded, onLoadingProgress, onError, onReady };

  const evaluationSteps = discretizerResult?.evaluationSteps ?? [];
  const currentStep = evaluationSteps[currentStepIndex] || null;

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new ViewportEngine(containerRef.current, {
      onModelLoaded: (stats) => callbacksRef.current.onModelLoaded?.(stats),
      onLoadingProgress: (pct) => callbacksRef.current.onLoadingProgress?.(pct)
    });
    engineRef.current = engine;

    const handleResize = () => {
      engine.resize();
    };
    window.addEventListener('resize', handleResize);

    if (callbacksRef.current.onReady) {
      callbacksRef.current.onReady();
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Sync inspection step to viewport engine
  const handleStepChange = (index: number) => {
    setCurrentStepIndex(index);
    if (engineRef.current && evaluationSteps.length > 0) {
      const step = evaluationSteps[index] || null;
      engineRef.current.setInspectionStep(step);
    }
  };

  // When discretization finishes with steps, switch to 4-split view by default and inspect step 0
  useEffect(() => {
    if (evaluationSteps.length > 0 && engineRef.current) {
      setLayoutModeState('split4');
      engineRef.current.setLayoutMode('split4');
      setCurrentStepIndex(0);
      engineRef.current.setInspectionStep(evaluationSteps[0]);
    }
  }, [evaluationSteps]);

  const changeLayoutMode = (mode: ViewportLayoutMode) => {
    setLayoutModeState(mode);
    if (engineRef.current) {
      engineRef.current.setLayoutMode(mode);
    }
  };

  useImperativeHandle(ref, () => ({
    loadModelFromUrl: async (url: string, fileType: string, modelName: string) => {
      if (!engineRef.current) {
        for (let i = 0; i < 10 && !engineRef.current; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      if (!engineRef.current) {
        throw new Error('Viewport engine not initialized.');
      }
      try {
        await engineRef.current.loadModelFromUrl(url, fileType, modelName);
      } catch (err: any) {
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(err.message || 'Failed to load model from URL');
        }
        throw err;
      }
    },
    loadModelFromFile: async (file: File) => {
      if (!engineRef.current) {
        for (let i = 0; i < 10 && !engineRef.current; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      if (!engineRef.current) {
        throw new Error('Viewport engine not initialized.');
      }
      try {
        await engineRef.current.loadModelFromFile(file);
      } catch (err: any) {
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(err.message || 'Failed to load model file');
        }
        throw err;
      }
    },
    displayDiscretizedBricks: (bricks: PlacedBrick[], lattice: PlateLattice3D) => {
      if (engineRef.current) {
        engineRef.current.displayDiscretizedBricks(bricks, lattice);
        setLayoutModeState('split4');
      }
    },
    setViewMode: (mode: 'mesh' | 'lego' | 'both') => {
      if (engineRef.current) {
        engineRef.current.setViewMode(mode);
      }
    },
    clearBricks: () => {
      if (engineRef.current) {
        engineRef.current.clearBricks();
      }
    },
    getActiveModel: () => {
      return engineRef.current ? engineRef.current.getActiveModel() : null;
    },
    getEngine: () => engineRef.current,
    updateMeshSnapping: (snap: boolean, targetStuds?: number, verticalUnit?: 'stud' | 'brick') => {
      if (engineRef.current) {
        engineRef.current.updateMeshSnapping(snap, targetStuds, verticalUnit);
      }
    },
    setLayoutMode: (mode: ViewportLayoutMode) => {
      changeLayoutMode(mode);
    },
    getLayoutMode: () => {
      return engineRef.current ? engineRef.current.getLayoutMode() : layoutMode;
    },
    setInspectionStep: (step: EvaluationStep | null) => {
      if (engineRef.current) {
        engineRef.current.setInspectionStep(step);
      }
    },
    displayVoxelSpace: (lattice: PlateLattice3D) => {
      if (engineRef.current) {
        engineRef.current.displayVoxelSpace(lattice);
      }
    }
  }));

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (engineRef.current) {
        try {
          await engineRef.current.loadModelFromFile(file);
        } catch (err: any) {
          if (onError) onError(err.message || 'Failed to load dropped file');
        }
      }
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#1e222b',
        outline: isDragOver ? '2px dashed #2563eb' : 'none',
        outlineOffset: '-4px'
      }}
    >
      {/* 3D Canvas Container */}
      <div
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ width: '100%', height: '100%' }}
      />

      {/* Top Center Viewport Mode Bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 15,
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
          padding: '4px 6px',
          display: 'flex',
          gap: 4
        }}
      >
        <Button
          size="small"
          type={layoutMode === 'split4' ? 'primary' : 'text'}
          icon={<AppstoreOutlined />}
          onClick={() => changeLayoutMode('split4')}
          style={{
            fontSize: 12,
            backgroundColor: layoutMode === 'split4' ? '#2563eb' : 'transparent',
            color: layoutMode === 'split4' ? '#ffffff' : '#0f172a'
          }}
        >
          4-Split View
        </Button>
        <Button
          size="small"
          type={layoutMode === 'mesh' ? 'primary' : 'text'}
          icon={<EyeOutlined />}
          onClick={() => changeLayoutMode('mesh')}
          style={{
            fontSize: 12,
            backgroundColor: layoutMode === 'mesh' ? '#2563eb' : 'transparent',
            color: layoutMode === 'mesh' ? '#ffffff' : '#0f172a'
          }}
        >
          Q1: Source Mesh
        </Button>
        <Button
          size="small"
          type={layoutMode === 'eval' ? 'primary' : 'text'}
          icon={<DeploymentUnitOutlined />}
          onClick={() => changeLayoutMode('eval')}
          style={{
            fontSize: 12,
            backgroundColor: layoutMode === 'eval' ? '#2563eb' : 'transparent',
            color: layoutMode === 'eval' ? '#ffffff' : '#0f172a'
          }}
        >
          Q2: Candidate Testing
        </Button>
        <Button
          size="small"
          type={layoutMode === 'lego' ? 'primary' : 'text'}
          icon={<BuildOutlined />}
          onClick={() => changeLayoutMode('lego')}
          style={{
            fontSize: 12,
            backgroundColor: layoutMode === 'lego' ? '#2563eb' : 'transparent',
            color: layoutMode === 'lego' ? '#ffffff' : '#0f172a'
          }}
        >
          Q3: LEGO Assembly
        </Button>
        <Button
          size="small"
          type={layoutMode === 'inspector' ? 'primary' : 'text'}
          icon={<FullscreenOutlined />}
          onClick={() => changeLayoutMode('inspector')}
          style={{
            fontSize: 12,
            backgroundColor: layoutMode === 'inspector' ? '#2563eb' : 'transparent',
            color: layoutMode === 'inspector' ? '#ffffff' : '#0f172a'
          }}
        >
          Q4: Step Inspector
        </Button>
      </div>

      {/* 4-Split Quadrant Header Badges */}
      {layoutMode === 'split4' && (
        <>
          {/* Quadrant 1 Badge (Top-Left) */}
          <div
            style={{
              position: 'absolute',
              top: 58,
              left: 410,
              zIndex: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <EyeOutlined style={{ color: '#2563eb' }} />
            <Text strong style={{ fontSize: 11, color: '#0f172a' }}>
              Q1: SOURCE MESH
            </Text>
            <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
              Curvature &amp; Strength Lines
            </Tag>
            <Tooltip title="Maximize Source Mesh View">
              <Button
                type="text"
                size="small"
                icon={<FullscreenOutlined style={{ fontSize: 11 }} />}
                onClick={() => changeLayoutMode('mesh')}
                style={{ padding: 0, width: 20, height: 20 }}
              />
            </Tooltip>
          </div>

          {/* Quadrant 2 Badge (Top-Right) */}
          <div
            style={{
              position: 'absolute',
              top: 58,
              right: 16,
              zIndex: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <EyeOutlined style={{ color: '#2563eb' }} />
            <Text strong style={{ fontSize: 11, color: '#0f172a' }}>
              Q2: CANDIDATE TESTING
            </Text>
            <Tag color="cyan" style={{ margin: 0, fontSize: 10 }}>
              Bounding Volumes
            </Tag>
            <Tooltip title="Maximize Candidate View">
              <Button
                type="text"
                size="small"
                icon={<FullscreenOutlined style={{ fontSize: 11 }} />}
                onClick={() => changeLayoutMode('eval')}
                style={{ padding: 0, width: 20, height: 20 }}
              />
            </Tooltip>
          </div>

          {/* Quadrant 3 Badge (Bottom-Left) */}
          <div
            style={{
              position: 'absolute',
              bottom: evaluationSteps.length > 0 ? 110 : 16,
              left: 410,
              zIndex: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <BuildOutlined style={{ color: '#2563eb' }} />
            <Text strong style={{ fontSize: 11, color: '#0f172a' }}>
              Q3: LEGO ASSEMBLY
            </Text>
            {discretizerResult && (
              <Tag color="success" style={{ margin: 0, fontSize: 10 }}>
                {discretizerResult.bricks.length} Bricks (100% Grounded)
              </Tag>
            )}
            <Tooltip title="Maximize Assembly View">
              <Button
                type="text"
                size="small"
                icon={<FullscreenOutlined style={{ fontSize: 11 }} />}
                onClick={() => changeLayoutMode('lego')}
                style={{ padding: 0, width: 20, height: 20 }}
              />
            </Tooltip>
          </div>

          {/* Quadrant 4 Badge (Bottom-Right) */}
          <div
            style={{
              position: 'absolute',
              bottom: evaluationSteps.length > 0 ? 110 : 16,
              right: 16,
              zIndex: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <AppstoreOutlined style={{ color: '#2563eb' }} />
            <Text strong style={{ fontSize: 11, color: '#0f172a' }}>
              Q4: STEP INSPECTOR
            </Text>
            {evaluationSteps.length > 0 && (
              <Tag color="geekblue" style={{ margin: 0, fontSize: 10 }}>
                3D Gizmo & Voxels
              </Tag>
            )}
            <Tooltip title="Maximize Step Inspector">
              <Button
                type="text"
                size="small"
                icon={<FullscreenOutlined style={{ fontSize: 11 }} />}
                onClick={() => changeLayoutMode('inspector')}
                style={{ padding: 0, width: 20, height: 20 }}
              />
            </Tooltip>
          </div>
        </>
      )}

      {/* Quadrant 4 Diagnostic Inspector Readout Panel */}
      {currentStep && (layoutMode === 'split4' || layoutMode === 'inspector') && (
        <div
          style={{
            position: 'absolute',
            top: layoutMode === 'split4' ? 'calc(50% + 12px)' : 68,
            right: 16,
            zIndex: 14,
            width: 320,
            backgroundColor: 'rgba(255, 255, 255, 0.96)',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.1)',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            pointerEvents: 'auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AimOutlined style={{ color: '#2563eb', fontSize: 13 }} />
              <Text strong style={{ fontSize: 12, color: '#0f172a' }}>
                Evaluation Step #{currentStepIndex + 1}
              </Text>
            </div>
            <Tag
              color={
                currentStep.status === 'ACCEPTED'
                  ? 'success'
                  : currentStep.status === 'REJECTED'
                  ? 'error'
                  : 'warning'
              }
              style={{ margin: 0, fontSize: 10, fontWeight: 600 }}
            >
              {currentStep.status}
            </Tag>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 11 }}>
            <Text strong style={{ color: '#2563eb', fontFamily: 'monospace' }}>
              #{currentStep.partId} {currentStep.partName}
            </Text>
            <Text type="secondary" style={{ fontFamily: 'monospace' }}>
              {currentStep.size[0]}x{currentStep.size[1]}x{currentStep.size[2]}
            </Text>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, backgroundColor: '#f8fafc', padding: '6px 8px', borderRadius: 4, border: '1px solid #f1f5f9' }}>
            <div>
              <Text type="secondary">Overlap: </Text>
              <Text strong style={{ color: currentStep.overlapRatio >= 0.70 ? '#16a34a' : '#ea580c' }}>
                {Math.round(currentStep.overlapRatio * 100)}%
              </Text>
            </div>
            <div>
              <Text type="secondary">Loss: </Text>
              <Text strong style={{ fontFamily: 'monospace' }}>
                {Math.round(currentStep.loss * 10) / 10}
              </Text>
            </div>
            <div>
              <Text type="secondary">Fit Score: </Text>
              <Text strong style={{ fontFamily: 'monospace', color: currentStep.score > 0 ? '#2563eb' : '#94a3b8' }}>
                {currentStep.score > 0 ? Math.round(currentStep.score * 10) / 10 : '-'}
              </Text>
            </div>
            <div>
              <Text type="secondary">Grid Anchor: </Text>
              <Text strong style={{ fontFamily: 'monospace' }}>
                [{currentStep.gridPos.join(',')}]
              </Text>
            </div>
          </div>

          {currentStep.rejectionReason && (
            <div style={{ fontSize: 11, color: '#dc2626', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: 4, border: '1px solid #fee2e2' }}>
              <Text type="danger" style={{ fontSize: 11 }}>
                Reason: {currentStep.rejectionReason}
              </Text>
            </div>
          )}

          {currentStep.targetVoxels && currentStep.targetVoxels.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#64748b', paddingTop: 2 }}>
              <span>Target Voxels: {currentStep.targetVoxels.length}</span>
              <Space size={6}>
                <span style={{ color: '#16a34a' }}>
                  {currentStep.targetVoxels.filter(v => v.status === 'MATCH').length} Match
                </span>
                <span style={{ color: '#ea580c' }}>
                  {currentStep.targetVoxels.filter(v => v.status === 'AIR').length} Air
                </span>
                {currentStep.targetVoxels.some(v => v.status === 'COLLISION') && (
                  <span style={{ color: '#dc2626' }}>
                    {currentStep.targetVoxels.filter(v => v.status === 'COLLISION').length} Collision
                  </span>
                )}
              </Space>
            </div>
          )}
        </div>
      )}

      {/* Interactive Step Scrubber Timeline Bar */}
      {evaluationSteps.length > 0 && (
        <StepScrubberBar
          steps={evaluationSteps}
          currentStepIndex={currentStepIndex}
          onStepChange={handleStepChange}
        />
      )}
    </div>
  );
});

Viewport3D.displayName = 'Viewport3D';
