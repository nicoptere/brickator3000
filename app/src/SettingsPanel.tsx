import React from 'react';
import {
  Drawer,
  Slider,
  Switch,
  Segmented,
  Typography,
  Space,
  Divider,
  Tooltip,
  Button,
  Progress,
  Steps,
  Statistic
} from 'antd';
import {
  SettingOutlined,
  CloseOutlined,
  SearchOutlined,
  CameraOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';

const { Text } = Typography;

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onAnalyzeImage?: () => void;
  onRetake?: () => void;
  isProcessing?: boolean;
  pipelineStage?: 'idle' | 'yolo' | 'bricknet' | 'measure' | 'done';
  pipelineMessage?: string;
  pipelinePercent?: number;
  patchProgress?: { current: number; total: number };
  patchCandidatesCount?: number;
  hasRegions?: boolean;
  yoloResolution: number;
  onResolutionChange: (res: number) => void;
  maskOpacity: number;
  onMaskOpacityChange: (opacity: number) => void;
  showVectorShapes: boolean;
  onToggleVectorShapes: (enabled: boolean) => void;
  showDashedBoxes: boolean;
  onToggleDashedBoxes: (enabled: boolean) => void;
  isSahiEnabled: boolean;
  onToggleSahi: (enabled: boolean) => void;
  isMaskPatchesEnabled: boolean;
  onToggleMaskPatches: (enabled: boolean) => void;
  isRefineScaleEnabled: boolean;
  onToggleRefineScale: (enabled: boolean) => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  scaleFeedback?: string | null;
  themeColors: {
    bgPanel: string;
    bgMain: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    accentPrimary: string;
    bgViewer?: string;
  };
}

/**
 * SettingsPanel — Right drawer panel managing AI model parameters,
 * segmentation inference pipeline, scale refinement, and graphic overlay rendering.
 */
export class SettingsPanel extends React.Component<SettingsPanelProps> {
  componentDidUpdate(prevProps: SettingsPanelProps) {
    if (prevProps.open && !this.props.open) {
      this.dismissTooltips();
    }
  }

  private dismissTooltips = () => {
    document.body.classList.add('hide-slider-tooltips');
    document.querySelectorAll('.ant-slider-tooltip, .ant-tooltip').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    setTimeout(() => {
      document.body.classList.remove('hide-slider-tooltips');
    }, 350);
  };

  private handleClose = () => {
    this.dismissTooltips();
    this.props.onClose();
  };

  render() {
    const {
      open,
      onRetake,
      isProcessing,
      pipelineStage,
      pipelineMessage,
      pipelinePercent,
      patchProgress,
      patchCandidatesCount,
      hasRegions,
      yoloResolution,
      onResolutionChange,
      maskOpacity,
      onMaskOpacityChange,
      showVectorShapes,
      onToggleVectorShapes,
      showDashedBoxes,
      onToggleDashedBoxes,
      isSahiEnabled,
      onToggleSahi,
      isMaskPatchesEnabled,
      onToggleMaskPatches,
      isRefineScaleEnabled,
      onToggleRefineScale,
      isDarkMode,
      onToggleTheme,
      scaleFeedback,
      themeColors
    } = this.props;

    return (
      <Drawer
        title={
          <Space>
            <SettingOutlined style={{ color: themeColors.accentPrimary, fontSize: 16 }} />
            <span style={{ color: themeColors.textPrimary, fontWeight: 700, fontSize: 15 }}>Model & Detection Settings</span>
          </Space>
        }
        placement="right"
        open={open}
        onClose={this.handleClose}
        closeIcon={<CloseOutlined style={{ fontSize: 14, color: themeColors.textPrimary }} />}
        mask={false}
        width={420}
        zIndex={1400}
        rootClassName="settings-drawer"
        styles={{
          body: {
            padding: '16px 16px',
            background: themeColors.bgPanel,
            overflowY: 'auto'
          },
          header: {
            background: themeColors.bgPanel,
            borderBottom: `1px solid ${themeColors.border}`
          }
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* SECTION 1: YOLO Segmentation Resolution */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 13, color: themeColors.textPrimary }}>
                  YOLO Neural Resolution
                </Text>
                <Text strong style={{ fontSize: 12, color: themeColors.accentPrimary }}>
                  {yoloResolution} × {yoloResolution} px
                </Text>
              </div>
              <Segmented
                block
                size="middle"
                value={yoloResolution}
                options={[
                  { label: '256p (Lite)', value: 256 },
                  { label: '512p (Mobile)', value: 512 },
                  { label: '1024p (HD)', value: 1024 }
                ]}
                onChange={(val) => onResolutionChange(val as number)}
                style={{ borderRadius: 0, marginBottom: 6 }}
              />
              <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary, display: 'block' }}>
                {yoloResolution === 512
                  ? '⚡ 512p Balanced Mobile (Default): 4x lower memory footprint, stable WebGL inference on iOS/Android.'
                  : yoloResolution === 256
                  ? '🚀 256p Ultra-Lightweight: 16x lower memory, fastest inference for older phones.'
                  : '🔬 1024p High-Resolution: Full detail for dense piles, recommended for desktop GPUs.'}
              </Text>
            </div>

            {/* AI Engine Toggles: SAHI, Masked BrickNet, Refine Scale below YOLO selector */}
            <div style={{
              background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              border: `1px solid ${themeColors.border}`,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text style={{ fontSize: 13, fontWeight: 600, color: themeColors.textPrimary, display: 'block' }}>
                    SAHI Multi-Tile Pass
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary }}>
                    Slices pile into high-resolution overlapping tiles
                  </Text>
                </div>
                <Switch checked={isSahiEnabled} onChange={onToggleSahi} size="small" />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text style={{ fontSize: 13, fontWeight: 600, color: themeColors.textPrimary, display: 'block' }}>
                    Masked BrickNet (Mask Patches)
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary }}>
                    Masks out background clutter around piece contour
                  </Text>
                </div>
                <Switch checked={isMaskPatchesEnabled} onChange={onToggleMaskPatches} size="small" />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text style={{ fontSize: 13, fontWeight: 600, color: themeColors.textPrimary, display: 'block' }}>
                    Refine Metric Scale
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary }}>
                    Calibrate pixel/stud consensus scale to penalize size mismatches
                  </Text>
                </div>
                <Switch checked={isRefineScaleEnabled} onChange={onToggleRefineScale} size="small" />
              </div>

              {/* Scale Consensus Indicator if available and refine scale enabled */}
              {isRefineScaleEnabled && scaleFeedback && (
                <div style={{
                  padding: '6px 10px',
                  background: isDarkMode ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  textAlign: 'center'
                }}>
                  <Text style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                    {scaleFeedback}
                  </Text>
                </div>
              )}
            </div>

            {/* Action 1: Retake Image Button (Above Analyze Image) */}
            <Button
              size="large"
              icon={<CameraOutlined />}
              onClick={() => {
                this.handleClose();
                onRetake?.();
              }}
              disabled={isProcessing}
              style={{
                borderRadius: 0,
                width: '100%',
                height: 44,
                fontWeight: 600,
                fontSize: 14,
                marginTop: 4,
                marginBottom: 4,
                background: themeColors.bgPanel,
                borderColor: themeColors.border,
                color: themeColors.textPrimary
              }}
            >
              Retake Image
            </Button>

            {/* Action 2: Analyze Image Button */}
            <Button
              type="primary"
              size="large"
              icon={<SearchOutlined />}
              loading={isProcessing}
              onClick={() => {
                this.props.onAnalyzeImage?.();
              }}
              style={{
                borderRadius: 0,
                width: '100%',
                height: 44,
                fontWeight: 700,
                fontSize: 14,
                marginBottom: isProcessing ? 8 : 4
              }}
            >
              {isProcessing ? 'Analyzing...' : (hasRegions ? 'Re-Analyze Image' : 'Analyze Image')}
            </Button>

            {/* Action 3: Progress window beneath the Analyze button (disappears when finished) */}
            {isProcessing && (
              <div
                style={{
                  background: themeColors.bgViewer || (isDarkMode ? '#070a10' : '#f8fafc'),
                  border: `1px solid ${themeColors.border}`,
                  borderRadius: 0,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginBottom: 6,
                  boxShadow: isDarkMode ? '0 4px 16px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.08)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space size={6}>
                    <ThunderboltOutlined style={{ color: '#0284c7', fontSize: 15 }} />
                    <Text strong style={{ fontSize: 13, color: themeColors.textPrimary }}>
                      AI Detection Pipeline
                    </Text>
                  </Space>
                  <Text strong style={{ color: '#0284c7', fontSize: 13 }}>
                    {pipelinePercent || 0}%
                  </Text>
                </div>

                {/* Stepper '1->2->3' */}
                <Steps
                  size="small"
                  current={pipelineStage === 'yolo' ? 0 : pipelineStage === 'bricknet' ? 1 : pipelineStage === 'measure' ? 2 : 3}
                  items={[
                    {
                      title: <span style={{ fontSize: 11, fontWeight: 700 }}>1. YOLO</span>,
                      description: <span style={{ fontSize: 9, color: themeColors.textSecondary }}>{yoloResolution}p</span>
                    },
                    {
                      title: <span style={{ fontSize: 11, fontWeight: 700 }}>2. BrickNet</span>,
                      description: <span style={{ fontSize: 9, color: themeColors.textSecondary }}>936 Class</span>
                    },
                    {
                      title: <span style={{ fontSize: 11, fontWeight: 700 }}>3. Scale</span>,
                      description: <span style={{ fontSize: 9, color: themeColors.textSecondary }}>{isRefineScaleEnabled ? 'Refine' : 'Bypass'}</span>
                    }
                  ]}
                  style={{
                    padding: '6px 8px',
                    background: themeColors.bgPanel,
                    border: `1px solid ${themeColors.border}`,
                    borderRadius: 0
                  }}
                />

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>{pipelineMessage || 'Processing...'}</Text>
                  </div>
                  <Progress
                    percent={pipelinePercent || 0}
                    status="active"
                    showInfo={false}
                    strokeColor="#0284c7"
                  />
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 6,
                  background: themeColors.bgPanel,
                  padding: '8px 10px',
                  borderRadius: 0,
                  border: `1px solid ${themeColors.border}`
                }}>
                  <Statistic
                    title={<span style={{ fontSize: 10, color: themeColors.textSecondary }}>Mode</span>}
                    value={isSahiEnabled ? 'SAHI' : 'Direct'}
                    styles={{ content: { fontSize: 12, color: '#0284c7', fontWeight: 600 } }}
                  />
                  <Statistic
                    title={<span style={{ fontSize: 10, color: themeColors.textSecondary }}>{pipelineStage === 'yolo' && isSahiEnabled ? 'Tile' : 'Piece'}</span>}
                    value={patchProgress && patchProgress.total > 0 ? `${patchProgress.current}/${patchProgress.total}` : (pipelineStage === 'yolo' ? '...' : 'Wait')}
                    styles={{ content: { fontSize: 12, color: themeColors.textPrimary, fontWeight: 600 } }}
                  />
                  <Statistic
                    title={<span style={{ fontSize: 10, color: themeColors.textSecondary }}>Candidates</span>}
                    value={patchCandidatesCount !== undefined ? patchCandidatesCount : (pipelineStage === 'yolo' ? '...' : 0)}
                    styles={{ content: { fontSize: 12, color: '#059669', fontWeight: 600 } }}
                  />
                </div>
              </div>
            )}

            {/* Graphics Separator */}
            <Divider
              titlePlacement="start"
              style={{
                margin: '12px 0 6px 0',
                borderColor: themeColors.border,
                color: themeColors.accentPrimary,
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1
              }}
            >
              Graphics
            </Divider>

            {/* SECTION 2: Graphics & Overlays */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: 13, color: themeColors.textPrimary }}>
                  Mask Opacity
                </Text>
                <Text strong style={{ fontSize: 12, color: themeColors.accentPrimary }}>
                  {maskOpacity}%
                </Text>
              </div>
              <Slider
                value={maskOpacity}
                onChange={onMaskOpacityChange}
                tooltip={{
                  formatter: (val) => `${val}%`,
                  getPopupContainer: (node) => node.parentElement || document.body
                }}
                style={{ margin: '6px 0 16px 0' }}
              />

              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text style={{ fontSize: 13, color: themeColors.textPrimary, display: 'block' }}>Bounding Boxes</Text>
                    <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary }}>
                      Render detection bounding boxes on canvas
                    </Text>
                  </div>
                  <Switch checked={showDashedBoxes} onChange={onToggleDashedBoxes} size="small" />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text style={{ fontSize: 13, color: themeColors.textPrimary, display: 'block' }}>Vector Silhouettes</Text>
                    <Text type="secondary" style={{ fontSize: 11, color: themeColors.textSecondary }}>
                      Draw smooth polygon perimeter boundaries
                    </Text>
                  </div>
                  <Switch checked={showVectorShapes} onChange={onToggleVectorShapes} size="small" />
                </div>
              </Space>
            </div>

            {/* Done Button — after the last item, same width as content */}
            <Button
              size="large"
              onClick={this.handleClose}
              style={{
                borderRadius: 0,
                width: '100%',
                height: 44,
                fontWeight: 600,
                fontSize: 14,
                marginTop: 12,
                marginBottom: 24,
                background: themeColors.bgPanel,
                borderColor: themeColors.border,
                color: themeColors.textPrimary
              }}
            >
              Done
            </Button>
          </Space>
      </Drawer>
    );
  }
}
