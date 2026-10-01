import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Slider, Typography, Tag, Space, Tooltip } from 'antd';
import {
  CaretRightOutlined,
  PauseOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import type { EvaluationStep } from '../core/types';

const { Text } = Typography;

export interface StepScrubberBarProps {
  steps: EvaluationStep[];
  currentStepIndex: number;
  onStepChange: (index: number) => void;
}

export const StepScrubberBar: React.FC<StepScrubberBarProps> = ({
  steps,
  currentStepIndex,
  onStepChange
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
  const timerRef = useRef<number | null>(null);

  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex] || null;

  const currentIndexRef = useRef(currentStepIndex);
  currentIndexRef.current = currentStepIndex;

  // Auto-play interval
  useEffect(() => {
    if (!isPlaying || totalSteps === 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = Math.max(80, 500 / playSpeed);
    timerRef.current = window.setInterval(() => {
      const next = currentIndexRef.current + 1;
      if (next >= totalSteps) {
        setIsPlaying(false);
      } else {
        onStepChange(next);
      }
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playSpeed, totalSteps, onStepChange]);

  if (totalSteps === 0) {
    return null;
  }

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      onStepChange(currentStepIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentStepIndex < totalSteps - 1) {
      onStepChange(currentStepIndex + 1);
    }
  };

  const togglePlay = () => {
    if (!isPlaying && currentStepIndex >= totalSteps - 1) {
      onStepChange(0);
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        width: 680,
        maxWidth: 'calc(100vw - 32px)',
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)',
        padding: '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto'
      }}
    >
      {/* Current Step Summary Bar */}
      {currentStep && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag
              color={
                currentStep.status === 'ACCEPTED'
                  ? 'success'
                  : currentStep.status === 'REJECTED'
                  ? 'error'
                  : 'warning'
              }
              style={{ margin: 0, fontWeight: 600 }}
            >
              {currentStep.status === 'ACCEPTED' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleOutlined /> ACCEPTED
                </span>
              ) : currentStep.status === 'REJECTED' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CloseCircleOutlined /> REJECTED
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ExclamationCircleOutlined /> SUPERSEDED
                </span>
              )}
            </Tag>

            <Text strong style={{ color: '#0f172a' }}>
              Part #{currentStep.partId} ({currentStep.partName})
            </Text>
            <Text type="secondary" style={{ fontFamily: 'monospace' }}>
              [{currentStep.size[0]}x{currentStep.size[1]}x{currentStep.size[2]}] at [{currentStep.gridPos.join(', ')}]
            </Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <Text type="secondary">Overlap: </Text>
              <Text strong style={{ color: currentStep.overlapRatio >= 0.75 ? '#16a34a' : '#ea580c' }}>
                {Math.round(currentStep.overlapRatio * 100)}%
              </Text>
            </div>
            <div>
              <Text type="secondary">Loss: </Text>
              <Text strong style={{ fontFamily: 'monospace' }}>
                {Math.round(currentStep.loss * 10) / 10}
              </Text>
            </div>
            <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
              Step {currentStepIndex + 1}/{totalSteps}
            </Tag>
          </div>
        </div>
      )}

      {/* Scrub Slider */}
      <Slider
        min={0}
        max={totalSteps - 1}
        value={currentStepIndex}
        onChange={(val) => {
          setIsPlaying(false);
          onStepChange(val);
        }}
        tooltip={{
          formatter: (v) => `Step ${Number(v) + 1} of ${totalSteps}`
        }}
        style={{ margin: '4px 0' }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={6}>
          <Button
            size="small"
            icon={<StepBackwardOutlined />}
            onClick={handlePrev}
            disabled={currentStepIndex <= 0}
          />
          <Button
            size="small"
            type="primary"
            icon={isPlaying ? <PauseOutlined /> : <CaretRightOutlined />}
            onClick={togglePlay}
            style={{
              backgroundColor: '#2563eb',
              borderColor: '#2563eb'
            }}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <Button
            size="small"
            icon={<StepForwardOutlined />}
            onClick={handleNext}
            disabled={currentStepIndex >= totalSteps - 1}
          />
        </Space>

        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 11 }}>Speed:</Text>
          {[1, 2, 5].map((s) => (
            <Button
              key={s}
              size="small"
              type={playSpeed === s ? 'primary' : 'default'}
              onClick={() => setPlaySpeed(s)}
              style={{
                fontSize: 11,
                padding: '0 8px',
                height: 22,
                backgroundColor: playSpeed === s ? '#2563eb' : '#f8fafc',
                borderColor: playSpeed === s ? '#2563eb' : '#e2e8f0',
                color: playSpeed === s ? '#ffffff' : '#0f172a'
              }}
            >
              {s}x
            </Button>
          ))}
        </Space>
      </div>
    </div>
  );
};
