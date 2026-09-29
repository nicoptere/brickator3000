import React, { useState, useEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  ConfigProvider,
  theme,
  Layout,
  Button,
  Tag,
  Drawer,
  Slider,
  Switch,
  Card,
  Badge,
  Modal,
  Progress,
  Tabs,
  Statistic,
  Space,
  Typography,
  Segmented,
  Steps,
  Tooltip,
  Divider,
  Input,
  message
} from 'antd';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  ColumnWidthOutlined,
  EyeOutlined,
  BorderOutlined,
  CompressOutlined,
  CameraOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  CloseOutlined,
  AimOutlined,
  LeftOutlined,
  RightOutlined,
  DownOutlined,
  UpOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  BulbOutlined,
  InfoCircleOutlined,
  SunOutlined,
  MoonOutlined,
  HolderOutlined,
  ExportOutlined,
  SettingOutlined,
  CopyOutlined
} from '@ant-design/icons';

import { DetectedRegion, PartSummary, ClipboardInventoryItem, ClipboardPayload } from './types';
import { TouchViewport, ViewportTransform } from './touch_viewport';
import { MaskLayer } from './mask_layer';
import { VectorOverlay } from './vector_overlay';
import { Viewer3D } from './viewer3d';
import { InferenceEngine } from './inference';
import { BrickSegmenter, PatchCandidate, getYoloSegmenter } from './segmenter';
import { SahiProgressEvent } from './yolo_segmenter';
import { isMobileClient, YOLO_MODEL_SPECS } from './yolo_model';
import { SettingsPanel } from './SettingsPanel';
import { Measure } from './measure';
import { getAssetUrl } from './url';
import { loadRemixCatalog, matchDetectedInventory, getAllCatalogBuilds, RemixMatch } from './remixMatcher';
import { inferColorsForRegions } from './color_matcher';

const { Header, Content } = Layout;
const { Text, Title, Paragraph } = Typography;

interface RemixSetThumbnailProps {
  src: string;
  name: string;
  size?: number;
  themeColors: {
    bgViewer: string;
    border: string;
    textSecondary: string;
    accentPrimary: string;
  };
}

const RemixSetThumbnail: React.FC<RemixSetThumbnailProps> = ({
  src,
  name,
  size = 56,
  themeColors
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: themeColors.bgViewer,
          border: `1px solid ${themeColors.border}`,
          color: themeColors.textSecondary,
          fontSize: 9,
          textAlign: 'center',
          padding: 2,
          flexShrink: 0,
          userSelect: 'none'
        }}
      >
        <AppstoreOutlined style={{ fontSize: Math.max(16, size * 0.35), color: themeColors.accentPrimary, marginBottom: 2 }} />
        <span style={{ fontSize: 8, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
          LEGO
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: 0,
        background: themeColors.bgViewer,
        border: `1px solid ${themeColors.border}`,
        flexShrink: 0
      }}
      onError={() => setHasError(true)}
    />
  );
};

/**
 * Groups detected regions by partId into summary metrics and item lists.
 */
export function groupRegionsIntoSummaries(
  targetRegions: DetectedRegion[]
): Array<{ summary: PartSummary; instances: DetectedRegion[] }> {
  const map = new Map<string, { summary: PartSummary; instances: DetectedRegion[] }>();
  for (const r of targetRegions) {
    const existing = map.get(r.partId);
    if (existing) {
      existing.summary.count++;
      existing.summary.maxConfidence = Math.max(existing.summary.maxConfidence, r.confidence);
      existing.instances.push(r);
      if (r.colorInfo && !existing.summary.colors?.some(c => c.code === r.colorInfo!.code)) {
        if (!existing.summary.colors) existing.summary.colors = [];
        existing.summary.colors.push(r.colorInfo);
      }
    } else {
      map.set(r.partId, {
        summary: {
          partId: r.partId,
          name: r.partName,
          count: 1,
          thumbnail: r.thumbnailUrl,
          aliases: r.aliases,
          maxConfidence: r.confidence,
          colors: r.colorInfo ? [r.colorInfo] : []
        },
        instances: [r]
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.summary.count - a.summary.count);
}

/**
 * Serializes detected LEGO parts into structured inventory payload grouped by compound key [part_id, color] (Option A).
 */
export function getInventoryPayload(
  instancesOrSummaries: DetectedRegion[] | Array<{ summary: PartSummary; instances: DetectedRegion[] }>,
  range: [number, number]
): ClipboardPayload {
  // Flatten to individual instances if summaries were passed
  const allInstances: DetectedRegion[] =
    instancesOrSummaries.length > 0 && 'summary' in instancesOrSummaries[0]
      ? (instancesOrSummaries as Array<{ summary: PartSummary; instances: DetectedRegion[] }>).flatMap(s => s.instances)
      : (instancesOrSummaries as DetectedRegion[]);

  const matching = allInstances.filter(r => {
    const confPct = Math.round(r.confidence * 100);
    return confPct >= range[0] && confPct <= range[1];
  });

  const compoundMap = new Map<string, {
    partId: string;
    partName: string;
    color: number;
    colorName: string;
    colorHex: string;
    sampleHex?: string;
    instances: DetectedRegion[];
  }>();

  for (const inst of matching) {
    const colorCode = inst.colorInfo?.code ?? 0;
    const colorName = inst.colorInfo?.name ?? 'Black';
    const colorHex = inst.colorInfo?.hex ?? '#05131D';
    const key = `${inst.partId}_${colorCode}`;

    const existing = compoundMap.get(key);
    if (existing) {
      existing.instances.push(inst);
    } else {
      compoundMap.set(key, {
        partId: inst.partId,
        partName: inst.partName,
        color: colorCode,
        colorName,
        colorHex,
        sampleHex: inst.colorInfo?.sampleHex,
        instances: [inst]
      });
    }
  }

  const inventory: ClipboardInventoryItem[] = Array.from(compoundMap.values()).map(entry => {
    const sumConf = entry.instances.reduce((acc, inst) => acc + inst.confidence, 0);
    const maxConf = Math.max(...entry.instances.map(inst => inst.confidence));
    const avgConf = sumConf / entry.instances.length;

    return {
      part_id: entry.partId,
      name: entry.partName,
      count: entry.instances.length,
      max_confidence: Math.round(maxConf * 100) / 100,
      avg_confidence: Math.round(avgConf * 100) / 100,
      color: entry.color,
      color_name: entry.colorName,
      color_hex: entry.colorHex,
      sample_hex: entry.sampleHex
    };
  });

  inventory.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    confidence_range: range,
    total_pieces: matching.length,
    unique_parts: inventory.length,
    inventory
  };
}

/**
 * Formats filtered inventory into a clean JSON string for clipboard export.
 */
export function formatInventoryForClipboard(
  instancesOrSummaries: DetectedRegion[] | Array<{ summary: PartSummary; instances: DetectedRegion[] }>,
  range: [number, number]
): string {
  return JSON.stringify(getInventoryPayload(instancesOrSummaries, range), null, 2);
}

export const App: React.FC = () => {
  // Engine & Core Refs
  const viewportRef = useRef<TouchViewport | null>(null);
  const maskLayerRef = useRef<MaskLayer | null>(null);
  const vectorOverlayRef = useRef<VectorOverlay | null>(null);
  const viewer3DRef = useRef<Viewer3D | null>(null);
  const inferenceEngineRef = useRef<InferenceEngine>(new InferenceEngine());
  const measureRef = useRef<Measure>(new Measure());

  // DOM Refs
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const mainImageRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vectorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Application State
  const [isReady, setIsReady] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusText, setStatusText] = useState('Initializing AI...');
  const [currentImageLoaded, setCurrentImageLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  // Detection Regions & Selection
  const [regions, setRegions] = useState<DetectedRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<DetectedRegion | null>(null);
  const [activeSiblingPartId, setActiveSiblingPartId] = useState<string | null>(null);

  // Expose automation test hooks in window
  useEffect(() => {
    (window as any).__SET_TEST_REGIONS__ = (mockRegions: DetectedRegion[]) => {
      setRegions(mockRegions);
    };
    (window as any).__CLOSE_STARTUP_MODAL__ = () => {
      setIsStartupModalOpen(false);
    };
  }, []);

  // Filter & Display Controls
  const [confRange, setConfRange] = useState<[number, number]>([25, 100]);
  const [maskOpacity, setMaskOpacity] = useState<number>(70);
  const [showVectorShapes, setShowVectorShapes] = useState(false);
  const [showDashedBoxes, setShowDashedBoxes] = useState(true);
  const [isSahiEnabled, setIsSahiEnabled] = useState(true);
  const [isMaskPatchesEnabled, setIsMaskPatchesEnabled] = useState(false);
  const [isRefineScaleEnabled, setIsRefineScaleEnabled] = useState(false);
  const rawRegionsRef = useRef<DetectedRegion[]>([]);
  const [yoloResolution, setYoloResolution] = useState<number>(() => isMobileClient() ? 512 : 1024);

  // UI Panels
  const [partsDrawerOpen, setPartsDrawerOpen] = useState(false);
  const [remixDrawerOpen, setRemixDrawerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  // Pipeline Progress State (YOLO + BrickNet + Measure)
  const [pipelineStage, setPipelineStage] = useState<'yolo' | 'bricknet' | 'measure' | 'done'>('yolo');
  const [pipelinePercent, setPipelinePercent] = useState<number>(0);
  const [pipelineMessage, setPipelineMessage] = useState<string>('Initializing YOLO11-seg...');
  const [patchProgress, setPatchProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [sahiFoundCount, setSahiFoundCount] = useState<number>(0);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Startup Warmup State
  const [startupProgress, setStartupProgress] = useState(10);
  const [startupLogs, setStartupLogs] = useState<string[]>(['Initializing WebGL 2.0 runtime...']);
  const [isStartupModalOpen, setIsStartupModalOpen] = useState(false);

  // Scale Refinement Feedback
  const [scaleFeedback, setScaleFeedback] = useState<string | null>(null);

  // Remix State
  const [remixSets, setRemixSets] = useState<RemixMatch[]>([]);
  const [isRemixLoading, setIsRemixLoading] = useState(false);
  const [selectedRemixSet, setSelectedRemixSet] = useState<RemixMatch | null>(null);
  const [showIframePreview, setShowIframePreview] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState<number>(2675);
  const [isBrowsingAllCatalog, setIsBrowsingAllCatalog] = useState(false);
  const [remixFilter, setRemixFilter] = useState<'all' | 'exact' | 'near'>('all');
  const [remixSearchQuery, setRemixSearchQuery] = useState('');

  const filteredRemixSets = useMemo(() => {
    let list = remixSets;
    if (remixFilter === 'exact') {
      list = list.filter(item => item.is_exact);
    } else if (remixFilter === 'near') {
      list = list.filter(item => !item.is_exact && (item.match_pct >= 70 || item.missing_count <= 3));
    }

    if (remixSearchQuery.trim()) {
      const q = remixSearchQuery.trim().toLowerCase();
      list = list.filter(item =>
        item.set.name.toLowerCase().includes(q) ||
        item.set.theme.toLowerCase().includes(q) ||
        item.set.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [remixSets, remixFilter, remixSearchQuery]);

  const exactMatchesCount = useMemo(() => remixSets.filter(s => s.is_exact).length, [remixSets]);
  const nearMatchesCount = useMemo(() => remixSets.filter(s => !s.is_exact && (s.match_pct >= 70 || s.missing_count <= 3)).length, [remixSets]);

  // Mobile Viewport State
  const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      viewer3DRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 3D WebGL Modal Viewer State
  const [viewerModalPart, setViewerModalPart] = useState<{ partId: string; name: string } | null>(null);
  const modalViewer3DRef = useRef<Viewer3D | null>(null);

  const handleOpen3DViewer = (partId: string, name: string, instance?: DetectedRegion) => {
    if (instance) {
      setSelectedRegion(instance);
      setIsInspectorCollapsed(false);
      if (instance.box) {
        viewportRef.current?.centerOnBox(instance.box);
      }
    }
    setViewerModalPart({ partId, name });
    if (isMobile) {
      setPartsDrawerOpen(false);
    }
  };

  // Theme State (Default Light Mode)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-theme');
      document.body.removeAttribute('data-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.setAttribute('data-theme', 'light');
    }
  }, [isDarkMode]);

  const themeColors = useMemo(() => ({
    bgMain: isDarkMode ? '#080c14' : '#f8fafc',
    bgCard: isDarkMode ? '#111827' : '#ffffff',
    bgPanel: isDarkMode ? '#0b0f19' : '#ffffff',
    bgHeader: isDarkMode ? 'rgba(11, 15, 25, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    bgViewer: isDarkMode ? '#070a10' : '#f1f5f9',
    border: isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
    textPrimary: isDarkMode ? '#f8fafc' : '#0f172a',
    textSecondary: isDarkMode ? '#94a3b8' : '#64748b',
    accentPrimary: '#0284c7',
    accentPurple: '#7c3aed',
    cardActiveBg: isDarkMode ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.12)',
    cardDefaultBg: isDarkMode ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
  }), [isDarkMode]);

  // Floating Draggable Inspector State
  const [inspectorPos, setInspectorPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const handleInspectorPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) {
      return;
    }
    e.preventDefault();
    isDraggingRef.current = true;
    const currentX = inspectorPos?.x ?? 24;
    const currentY = inspectorPos?.y ?? (window.innerHeight - 380);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.startX;
      const dy = moveEvent.clientY - dragStartRef.current.startY;
      const newX = Math.max(10, Math.min(window.innerWidth - 350, dragStartRef.current.initialX + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, dragStartRef.current.initialY + dy));
      setInspectorPos({ x: newX, y: newY });
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // --------------------------------------------------------------------------
  // 1. Initialize Engines on Mount
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!viewportContainerRef.current || !imageContainerRef.current) return;

    // Viewport & Overlays
    const vp = new TouchViewport(viewportContainerRef.current, imageContainerRef.current);
    viewportRef.current = vp;

    if (maskCanvasRef.current) {
      maskLayerRef.current = new MaskLayer(maskCanvasRef.current);
      maskLayerRef.current.setOpacity(maskOpacity / 100);
    }
    if (vectorCanvasRef.current) {
      vectorOverlayRef.current = new VectorOverlay(vectorCanvasRef.current);
      vectorOverlayRef.current.setShowVectorShapes(showVectorShapes);
      vectorOverlayRef.current.setShowDashedBoxes(showDashedBoxes);
    }

    // Viewport Transform Sync
    vp.onTransformChange = (transform) => {
      maskLayerRef.current?.setTransform(transform);
      vectorOverlayRef.current?.setTransform(transform);
    };

    // Hit Testing Interactions
    vp.onSingleTap = (e) => {
      const hit = vectorOverlayRef.current?.hitTest(e.clientX, e.clientY);
      if (hit) {
        setSelectedRegion(hit);
        setActiveSiblingPartId(null);
        maskLayerRef.current?.clearIsolation();
        vectorOverlayRef.current?.stopSiblingPulse();
        const leftOffset = isMobile ? 0 : 380;
        if (hit.box) {
          viewportRef.current?.zoomToSinglePiece(hit.box, leftOffset);
        }
        setPartsDrawerOpen(true);
        setTimeout(() => viewer3DRef.current?.resize(), 50);
      } else {
        setSelectedRegion(null);
        setActiveSiblingPartId(null);
        maskLayerRef.current?.clearIsolation();
        vectorOverlayRef.current?.stopSiblingPulse();
      }
    };

    vp.onDoubleTap = (e) => {
      const hit = vectorOverlayRef.current?.hitTest(e.clientX, e.clientY);
      if (hit?.box) {
        vp.centerOnBox(hit.box);
      }
    };

    // Resize handling
    const ro = new ResizeObserver(() => {
      vp.handleContainerResize();
      maskLayerRef.current?.resize();
      maskLayerRef.current?.render();
      vectorOverlayRef.current?.resize();
      vectorOverlayRef.current?.render();
    });
    ro.observe(viewportContainerRef.current);

    // Initialize 3D Viewer inside inspector container
    if (viewerContainerRef.current && !viewer3DRef.current) {
      viewer3DRef.current = new Viewer3D(viewerContainerRef.current);
    }

    // Initialize Neural Models with GPU Warmup
    initModels();

    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pipelineLogs]);

  // --------------------------------------------------------------------------
  // 2. Neural Models Preloading & WebGL Shader Compilation
  // --------------------------------------------------------------------------
  const initModels = async () => {
    const addStartupLog = (msg: string) => {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
      setStartupLogs(prev => [...prev, `[${timeStr}] ${msg}`]);
    };

    try {
      message.destroy('model-status');
      setStartupProgress(25);
      addStartupLog('Loading BrickNet V6 Multi-Scale taxonomy & FP32 weights...');
      await inferenceEngineRef.current.init((s) => {
        addStartupLog(s);
      });

      const atlas = inferenceEngineRef.current.getAtlasData();
      if (atlas) {
        measureRef.current.initFromAtlas(atlas);
      }

      setStartupProgress(50);
      addStartupLog('Warming up BrickNet V6 WebGL shaders (dummy 224x224 pass)...');
      const t0 = performance.now();
      await inferenceEngineRef.current.warmup();
      addStartupLog(`✓ BrickNet V6 warm (${Math.round(performance.now() - t0)}ms)`);

      setStartupProgress(70);
      addStartupLog(`Loading YOLO11-seg (${yoloResolution}p WebGL)...`);
      const yolo = getYoloSegmenter(yoloResolution);
      await yolo.init((s: string) => addStartupLog(s));

      setStartupProgress(85);
      addStartupLog(`Warming up YOLO11-seg FPN & Proto shaders (dummy ${yoloResolution}x${yoloResolution} pass)...`);
      const t1 = performance.now();
      await yolo.warmup();
      addStartupLog(`✓ YOLO11-seg warm (${Math.round(performance.now() - t1)}ms)`);

      setStartupProgress(100);
      addStartupLog('✓ All neural models preloaded & ready.');
      setEngineStatus('ready');
      setStatusText(`● AI Ready (V6 + YOLO ${yoloResolution}p)`);
      setIsReady(true);
      message.destroy('model-status');
      message.success({ content: `AI Models Ready (BrickNet V6 + YOLO11-seg ${yoloResolution}p)`, duration: 2.5 });

      setTimeout(() => {
        setIsStartupModalOpen(false);
      }, 500);

    } catch (err: any) {
      console.error('Model init error:', err);
      setEngineStatus('error');
      setStatusText('● AI Fallback / Offline');
      message.destroy('model-status');
      message.error({ content: `Model load notice: ${err.message || 'using offline fallback'}`, duration: 4 });
      addStartupLog(`Notice: ${err.message || err}`);
      setTimeout(() => setIsStartupModalOpen(false), 1200);
    }
  };

  // --------------------------------------------------------------------------
  // 3. Filter Regions by Confidence Slider
  // --------------------------------------------------------------------------
  const filteredRegions = useMemo(() => {
    return regions.filter(r => {
      const confPct = Math.round(r.confidence * 100);
      return confPct >= confRange[0] && confPct <= confRange[1];
    });
  }, [regions, confRange]);

  // Sync filtered regions to canvas overlays
  useEffect(() => {
    maskLayerRef.current?.setRegions(filteredRegions);
    vectorOverlayRef.current?.setRegions(filteredRegions);
  }, [filteredRegions]);

  // Sync display toggles to overlay
  useEffect(() => {
    maskLayerRef.current?.setOpacity(maskOpacity / 100);
  }, [maskOpacity]);

  useEffect(() => {
    vectorOverlayRef.current?.setShowVectorShapes(showVectorShapes);
  }, [showVectorShapes]);

  useEffect(() => {
    vectorOverlayRef.current?.setShowDashedBoxes(showDashedBoxes);
  }, [showDashedBoxes]);

  // Load 3D model when selected region changes
  useEffect(() => {
    if (selectedRegion && viewer3DRef.current) {
      viewer3DRef.current.loadModel(selectedRegion.partId);
    }
  }, [selectedRegion]);

  // Group detected pieces for summary cards
  const groupedSummaries = useMemo(() => {
    return groupRegionsIntoSummaries(filteredRegions);
  }, [filteredRegions]);

  // Copy filtered inventory to clipboard with non-intrusive feedback
  const handleCopyInventory = async (range: [number, number]) => {
    if (regions.length === 0) return;

    const matching = regions.filter(r => {
      const confPct = Math.round(r.confidence * 100);
      return confPct >= range[0] && confPct <= range[1];
    });
    let targetRegions = matching;
    if (mainImageRef.current && matching.some(r => !r.colorInfo)) {
      targetRegions = inferColorsForRegions(mainImageRef.current, matching);
    }
    const payload = getInventoryPayload(targetRegions, range);
    const jsonString = JSON.stringify(payload, null, 2);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(jsonString);
        message.success({
          content: payload.total_pieces === 0
            ? 'Copied 0 pieces to clipboard'
            : `Copied ${payload.total_pieces} pieces (${range[0]}%–${range[1]}% conf) to clipboard`,
          key: 'clipboard_copy',
          duration: 1.5
        });
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = jsonString;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (success) {
          message.success({
            content: payload.total_pieces === 0
              ? 'Copied 0 pieces to clipboard'
              : `Copied ${payload.total_pieces} pieces (${range[0]}%–${range[1]}% conf) to clipboard`,
            key: 'clipboard_copy',
            duration: 1.5
          });
        }
      }
    } catch (err) {
      console.warn('Clipboard write was blocked or failed:', err);
    }
  };

  // --------------------------------------------------------------------------
  // 4. Image Loading & Downscaling (Max 2048px in width or height)
  // --------------------------------------------------------------------------
  const loadImageSource = (src: string) => {
    clearDetections();
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    tempImg.onload = () => {
      const w = tempImg.naturalWidth;
      const h = tempImg.naturalHeight;
      const maxDim = 2048;

      if (w > maxDim || h > maxDim) {
        let dw: number;
        let dh: number;
        if (w >= h) {
          dw = maxDim;
          dh = Math.max(1, Math.round((h * maxDim) / w));
        } else {
          dh = maxDim;
          dw = Math.max(1, Math.round((w * maxDim) / h));
        }

        const canvas = document.createElement('canvas');
        canvas.width = dw;
        canvas.height = dh;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Fill white background to prevent transparent PNGs from turning into pitch black background in JPEG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dw, dh);
        ctx.drawImage(tempImg, 0, 0, dw, dh);

        console.log(`[ImageLoader] Downscaling image from ${w}x${h} to ${dw}x${dh} (enforcing max ${maxDim}px limit)`);

        if (mainImageRef.current) {
          mainImageRef.current.onload = () => {
            setCurrentImageLoaded(true);
            viewportRef.current?.setImageDimensions(dw, dh);
            vectorOverlayRef.current?.setImageDimensions(dw, dh);
            setIsSettingsOpen(true);
          };
          mainImageRef.current.src = canvas.toDataURL('image/jpeg', 0.92);
        }
      } else {
        console.log(`[ImageLoader] Image dimensions (${w}x${h}) within ${maxDim}px limit. No downscaling needed.`);
        if (mainImageRef.current) {
          mainImageRef.current.onload = () => {
            setCurrentImageLoaded(true);
            viewportRef.current?.setImageDimensions(w, h);
            vectorOverlayRef.current?.setImageDimensions(w, h);
            setIsSettingsOpen(true);
          };
          mainImageRef.current.src = src;
        }
      }
    };
    tempImg.onerror = () => {
      message.error('Failed to load image file. Please try another image.');
    };
    tempImg.src = src;
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      activeBlobUrlRef.current = objectUrl;
      loadImageSource(objectUrl);
    }
  };

  const clearDetections = () => {
    setRegions([]);
    setSelectedRegion(null);
    setActiveSiblingPartId(null);
    maskLayerRef.current?.clear();
    vectorOverlayRef.current?.clear();
    setScaleFeedback(null);
    viewer3DRef.current?.detach();
    setRemixSets([]);
    setSelectedRemixSet(null);
  };

  const handleRetake = () => {
    clearDetections();
    setCurrentImageLoaded(false);
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    if (mainImageRef.current) mainImageRef.current.src = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 5. Submit & Pipeline Execution (YOLO -> BrickNet -> Measure Re-Rank)
  // --------------------------------------------------------------------------
  const handleResolutionChange = async (res: number) => {
    setYoloResolution(res);
    const yolo = getYoloSegmenter();
    try {
      message.destroy('yolo-res');
      message.loading({ content: `Switching to YOLO ${res}p WebGL...`, duration: 1.5 });
      await yolo.switchResolution(res, (s: string) => setStatusText(s));
      setStatusText(`● AI Ready (V6 + YOLO ${res}p)`);
      message.destroy();
      message.success({ content: `YOLO ${res}p Active (${res}x${res})`, duration: 2.5 });
    } catch (e: any) {
      console.error('Failed to switch YOLO resolution:', e);
      message.destroy();
      message.error({ content: `Failed to load YOLO ${res}p: ${e?.message || 'Error'}`, duration: 3 });
    }
  };

  const handleSubmit = async () => {
    if (!mainImageRef.current || !currentImageLoaded) return;

    // Immediately clear previous detections and active piece selection
    clearDetections();

    // Leave detected pieces panel visible during detection (do not close it)
    if (!isMobile) {
      setPartsDrawerOpen(true);
    }

    // Before analyzing, zoom out to have the whole picture fully in frame
    viewportRef.current?.fitToScreen(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const useSahi = isSahiEnabled;
    const initialMsg = useSahi
      ? `Starting YOLO11-seg SAHI Multi-Tile pass (${yoloResolution}p)...`
      : `Segmenting pieces with YOLO11-seg (${yoloResolution}p)...`;
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

    // Synchronously flush state updates so React mounts and displays the progress modal immediately
    flushSync(() => {
      setIsProcessing(true);
      setSahiFoundCount(0);
      setPipelineStage('yolo');
      setPipelinePercent(5);
      setPipelineMessage(initialMsg);
      setPipelineLogs([`[${timeStr}] ${initialMsg}`]);
      setPatchProgress({ current: 0, total: useSahi ? 0 : 1 });
    });

    const addPipelineLog = (msg: string) => {
      const logTime = new Date().toLocaleTimeString('en-US', { hour12: false });
      const formatted = msg.startsWith('└') || msg.startsWith('  └') ? `  ${msg.trim()}` : `[${logTime}] ${msg}`;
      setPipelineLogs(prev => [...prev.slice(-120), formatted]);
    };

    // Yield control to the browser paint cycle so the user visually sees the modal pop up immediately
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      viewer3DRef.current?.pause();
      addPipelineLog(useSahi ? 'Starting SAHI Multi-Tile high-res slicing...' : 'Executing YOLO11-seg 1024p direct overview...');

      const candidates: PatchCandidate[] = await BrickSegmenter.segmentImage(
        mainImageRef.current,
        'yolo11',
        useSahi,
        (status) => {
          setPipelineMessage(status);
        },
        (evt) => {
          setPipelinePercent(Math.round(evt.percent * 0.45)); // YOLO is 0-45%
          if (evt.logMessage) {
            setPipelineMessage(evt.logMessage);
            addPipelineLog(evt.logMessage);
          }
          if (evt.foundCount !== undefined) {
            setSahiFoundCount(evt.foundCount);
          }
          if (evt.totalTiles) {
            setPatchProgress({ current: evt.currentTile, total: evt.totalTiles });
          }
          if (evt.tileBox) {
            vectorOverlayRef.current?.setPunchedOutFrame({
              x: evt.tileBox.x,
              y: evt.tileBox.y,
              w: evt.tileBox.w,
              h: evt.tileBox.h,
              label: evt.stage === 'overview'
                ? 'YOLO Overview'
                : `YOLO Tile ${evt.currentTile}/${evt.totalTiles}`,
              stage: 'yolo'
            });
          }
        },
        isMaskPatchesEnabled
      );

      if (candidates.length === 0) {
        vectorOverlayRef.current?.clearPunchedOutFrame();
        message.warning('No candidate bricks found. Please adjust angle or lighting.');
        setIsProcessing(false);
        return;
      }

      // Stage 2: BrickNet Classification
      setPipelineStage('bricknet');
      setPipelinePercent(45);
      setPatchProgress({ current: 0, total: candidates.length });
      setPipelineMessage(`Classifying ${candidates.length} pieces with BrickNet V6...`);
      addPipelineLog(`✓ Found ${candidates.length} candidate pieces. Running BrickNet V6 neural classification...`);

      let rawRegions = await inferenceEngineRef.current.runInferenceOnPatches(
        candidates,
        (idx, total, candidate) => {
          const pct = Math.round(45 + ((idx + 1) / total) * 45); // BrickNet is 45-90%
          setPipelinePercent(pct);
          setPatchProgress({ current: idx + 1, total });
          setPipelineMessage(`BrickNet V6: Analyzing piece ${idx + 1} of ${total}...`);
          if (candidate?.box) {
            vectorOverlayRef.current?.setPunchedOutFrame({
              x: candidate.box.x,
              y: candidate.box.y,
              w: candidate.box.w,
              h: candidate.box.h,
              label: `BrickNet ${idx + 1}/${total}`,
              stage: 'bricknet'
            });
          }
        }
      );

      // Dismiss punched-out targeting frame once BrickNet piece-by-piece scan completes
      vectorOverlayRef.current?.clearPunchedOutFrame();

      // Infer official LEGO plastic colors using CIEDE2000
      if (mainImageRef.current) {
        addPipelineLog('Extracting diffuse plastic reflectance and matching official LEGO colors...');
        rawRegions = inferColorsForRegions(mainImageRef.current, rawRegions);
      }

      // Cache raw detection regions before any scale re-ranking
      rawRegionsRef.current = rawRegions;

      let finalRegions = rawRegions;
      if (isRefineScaleEnabled) {
        // Stage 3: Measure Scale Consensus & Re-Ranking (when enabled)
        setPipelineStage('measure');
        setPipelinePercent(92);
        setPipelineMessage('Inferring metric scale consensus & re-ranking candidates...');
        addPipelineLog('Analyzing anchor dimensions to eliminate 1x1 / 2x1 false positives...');

        const { regions: rankedRegions, scale, correctedCount } = measureRef.current.reRankWithScale(rawRegions);
        finalRegions = rankedRegions;

        setPipelineMessage(`✓ Analysis complete! Inferred ${scale.scalePxPerStud} px/stud, corrected ${correctedCount} pieces.`);
        addPipelineLog(`✓ Consensus scale: ${scale.scalePxPerStud} px/stud (${scale.scalePxPerMm} px/mm). Re-ranked ${rankedRegions.length} pieces.`);

        if (correctedCount > 0) {
          setScaleFeedback(`✓ Scale: ${scale.scalePxPerStud} px/stud (${correctedCount} fixed)`);
        } else {
          setScaleFeedback(`✓ Scale: ${scale.scalePxPerStud} px/stud (verified)`);
        }
      } else {
        setScaleFeedback(null);
        setPipelineMessage(`✓ Analysis complete! Processed ${rawRegions.length} pieces.`);
        addPipelineLog(`✓ Metric scale refinement bypassed (toggle disabled). Direct candidate predictions preserved.`);
      }

      setRegions(finalRegions);
      setPipelineStage('done');
      setPipelinePercent(100);

      setTimeout(() => {
        setIsProcessing(false);
        setIsSettingsOpen(false);
        setPartsDrawerOpen(true);
        message.success(`Detected ${finalRegions.length} pieces successfully!`);
      }, 400);

    } catch (err: any) {
      console.error('Inference error:', err);
      vectorOverlayRef.current?.clearPunchedOutFrame();
      message.error(`Detection error: ${err.message || err}`);
      setIsProcessing(false);
    } finally {
      viewer3DRef.current?.resume();
    }
  };

  // --------------------------------------------------------------------------
  // 6. Metric Scale Refinement Toggle & Manual Re-Rank
  // --------------------------------------------------------------------------
  const handleToggleRefineScale = (enabled: boolean) => {
    setIsRefineScaleEnabled(enabled);
    if (rawRegionsRef.current && rawRegionsRef.current.length > 0) {
      if (enabled) {
        const { regions: ranked, scale, correctedCount } = measureRef.current.reRankWithScale(rawRegionsRef.current);
        setRegions(ranked);
        const msg = `Scale: ${scale.scalePxPerStud} px/stud (${correctedCount} re-ranked)`;
        setScaleFeedback(`✓ ${msg}`);
        message.success({ content: `Refine Scale active: ${msg}`, duration: 2 });
      } else {
        setRegions(rawRegionsRef.current);
        setScaleFeedback(null);
        message.info({ content: 'Refine Scale disabled. Restored raw candidate scores.', duration: 2 });
      }
    }
  };

  const handleRefineScale = () => {
    if (regions.length === 0) {
      message.info('Please scan an image first to calculate physical scale.');
      return;
    }

    const { regions: reranked, scale, correctedCount } = measureRef.current.reRankWithScale(regions);
    setRegions([...reranked]);

    const msg = `Scale: ${scale.scalePxPerStud} px/stud (${correctedCount} re-ranked)`;
    setScaleFeedback(`✓ ${msg}`);
    message.success(msg);
  };

  // Sibling Isolation / Pulse & 3D Model Focus & Framing
  const handlePartCardClick = (partId: string) => {
    const matchingInstances = filteredRegions.filter(r => r.partId === partId);
    const instancesToUse = matchingInstances.length > 0 ? matchingInstances : regions.filter(r => r.partId === partId);
    const instance = instancesToUse[0];

    if (activeSiblingPartId === partId && selectedRegion?.partId === partId) {
      setActiveSiblingPartId(null);
      maskLayerRef.current?.clearIsolation();
      vectorOverlayRef.current?.stopSiblingPulse();
    } else {
      setActiveSiblingPartId(partId);
      maskLayerRef.current?.setIsolationPartId(partId);
      vectorOverlayRef.current?.startSiblingPulse(partId);

      if (instance) {
        setSelectedRegion(instance);
        viewer3DRef.current?.loadModel(instance.partId);

        const leftOffset = isMobile ? 0 : (partsDrawerOpen ? 380 : 0);

        if (instancesToUse.length === 1 && instance.box) {
          // If only 1 instance: zoom in to the piece
          viewportRef.current?.zoomToSinglePiece(instance.box, leftOffset);
        } else if (instancesToUse.length > 1) {
          // If multiple instances: zoom out so that we see all the instances
          const boxes = instancesToUse.map(inst => inst.box).filter(Boolean);
          viewportRef.current?.zoomToMultipleInstances(boxes, leftOffset);
        }
      }
    }
  };

  // Inspector Navigation
  const navigatePiece = (dir: number) => {
    if (filteredRegions.length === 0) return;
    const currentIndex = selectedRegion ? filteredRegions.findIndex(r => r.id === selectedRegion.id) : 0;
    let nextIndex = (currentIndex + dir) % filteredRegions.length;
    if (nextIndex < 0) nextIndex = filteredRegions.length - 1;
    setSelectedRegion(filteredRegions[nextIndex]);
  };

  // --------------------------------------------------------------------------
  // 7. Remix Search Integration (100% In-Browser Client-Side Matching)
  // --------------------------------------------------------------------------
  const handleOpenRemix = async (forceRefresh: boolean = false, browseAllOverride?: boolean) => {
    setRemixDrawerOpen(true);
    const shouldBrowseAll = browseAllOverride !== undefined ? browseAllOverride : (regions.length === 0);

    if (remixSets.length > 0 && !forceRefresh && isBrowsingAllCatalog === shouldBrowseAll) {
      return;
    }

    setIsRemixLoading(true);
    try {
      const catalog = await loadRemixCatalog();
      const count = catalog.total_sets || catalog.sets.length;
      setCatalogTotal(count);

      if (regions.length > 0 && !shouldBrowseAll) {
        setIsBrowsingAllCatalog(false);
        const result = matchDetectedInventory(regions, catalog, {
          minConfidence: 0.20,
          minMatchPct: 20.0,
          maxResults: 5000
        });
        setRemixSets(result.all_matches);
      } else {
        setIsBrowsingAllCatalog(true);
        setRemixSets(getAllCatalogBuilds(catalog));
      }
    } catch (err) {
      console.warn('Remix search error:', err);
      message.error('Failed to load Remix build catalog');
    } finally {
      setIsRemixLoading(false);
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#0284c7',
          colorBgBase: isDarkMode ? '#080c14' : '#ffffff',
          colorTextBase: isDarkMode ? '#f8fafc' : '#0f172a',
          colorBorder: isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
          borderRadius: 0,
          borderRadiusLG: 0,
          borderRadiusSM: 0,
          borderRadiusXS: 0,
        },
      }}
    >
      <Layout className="app-root-layout" style={{ height: '100vh', overflow: 'hidden', background: themeColors.bgMain }}>
        {/* Top Header with Panel and Remix Icon Buttons */}
        <Header style={{
          height: 44,
          lineHeight: '44px',
          padding: '0 12px',
          background: themeColors.bgPanel,
          borderBottom: `1px solid ${themeColors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 1000,
          userSelect: 'none'
        }}>
          {/* Left: App Title */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 14, color: themeColors.textPrimary, letterSpacing: '0.5px' }}>
              🧱 Brickator 3000
            </Text>
          </div>

          {/* Right: Action Icon Buttons (Settings, Pieces Panel & Remix Assistant) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={isSettingsOpen ? "Close Settings" : "Model & Detection Settings"}>
              <Button
                type={isSettingsOpen ? 'primary' : 'text'}
                icon={<SettingOutlined />}
                onClick={() => setIsSettingsOpen(prev => !prev)}
                style={{
                  borderRadius: 0,
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isSettingsOpen ? '#ffffff' : themeColors.textPrimary
                }}
              />
            </Tooltip>
            <Tooltip title={partsDrawerOpen ? "Close Pieces Panel" : "Open Pieces Panel"}>
              <Button
                type={partsDrawerOpen ? 'primary' : 'text'}
                icon={<AppstoreOutlined />}
                onClick={() => setPartsDrawerOpen(prev => !prev)}
                style={{
                  borderRadius: 0,
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: partsDrawerOpen ? '#ffffff' : themeColors.textPrimary
                }}
              />
            </Tooltip>
            <Tooltip title={remixDrawerOpen ? "Close Remix" : "Open Remix"}>
              <Badge count={exactMatchesCount > 0 ? `★${exactMatchesCount}` : remixSets.length > 0 ? remixSets.length : 0} size="small" offset={[-2, 4]} color={exactMatchesCount > 0 ? '#16a34a' : themeColors.accentPrimary} overflowCount={9999}>
                <Button
                  type={remixDrawerOpen ? 'primary' : 'text'}
                  icon={<ThunderboltOutlined />}
                  onClick={() => handleOpenRemix(false)}
                  style={{
                    borderRadius: 0,
                    height: 32,
                    width: 32,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: remixDrawerOpen ? '#ffffff' : exactMatchesCount > 0 ? '#16a34a' : themeColors.textPrimary
                  }}
                />
              </Badge>
            </Tooltip>
            <Tooltip title={isDarkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}>
              <Button
                type="text"
                icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
                onClick={() => setIsDarkMode(prev => !prev)}
                style={{
                  borderRadius: 0,
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: themeColors.textPrimary
                }}
              />
            </Tooltip>
          </div>
        </Header>

        {/* Central Viewport & Canvases */}
        <Content style={{ position: 'relative', width: '100%', height: 'calc(100vh - 44px)', overflow: 'hidden' }}>
          <div
            id="viewportContainer"
            ref={viewportContainerRef}
            className={`viewport-main ${partsDrawerOpen ? 'parts-open' : ''} ${(remixDrawerOpen || isSettingsOpen) ? 'remix-open' : ''}`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              cursor: 'default'
            }}
          >
            <div id="imageContainer" ref={imageContainerRef} style={{ position: 'absolute', transformOrigin: '0 0' }}>
              <img id="mainImage" ref={mainImageRef} alt="Source" draggable={false} style={{ display: 'block', maxWidth: 'none' }} />
            </div>

            <canvas id="maskCanvas" ref={maskCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
            <canvas id="vectorOverlayCanvas" ref={vectorCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />

            {/* Empty State Prompt */}
            {!currentImageLoaded && (
              <div className="empty-prompt-overlay" style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: themeColors.bgPanel,
                border: `1px solid ${themeColors.border}`,
                padding: '24px',
                borderRadius: 0,
                textAlign: 'left',
                maxWidth: 420,
                width: '90%',
                boxShadow: isDarkMode ? '0 12px 40px rgba(0, 0, 0, 0.6)' : '0 12px 30px rgba(0, 0, 0, 0.1)'
              }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <div style={{ textAlign: 'left', marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 14, color: themeColors.textPrimary, display: 'block', lineHeight: 1.45, marginBottom: 8 }}>
                      This app will try to detect and identify LEGO pieces from a picture.
                    </Text>
                    <Text style={{ fontSize: 14, color: themeColors.textSecondary, display: 'block', lineHeight: 1.45, marginBottom: 6 }}>
                      For better results:
                    </Text>
                    <ul style={{ margin: 0, paddingLeft: 20, color: themeColors.textSecondary, fontSize: 14, lineHeight: 1.55 }}>
                      <li style={{ marginBottom: 4 }}>Remove large objects</li>
                      <li style={{ marginBottom: 4 }}>Disconnect the parts</li>
                      <li style={{ marginBottom: 4 }}>Avoid cluttered piles</li>
                      <li>Use a neutral background</li>
                    </ul>
                  </div>
                  <Button
                    type="primary"
                    size="large"
                    icon={<CameraOutlined />}
                    block
                    onClick={() => cameraInputRef.current?.click()}
                    style={{ height: 44, borderRadius: 0 }}
                  >
                    Take Photo
                  </Button>
                  <Button
                    size="large"
                    icon={<FolderOpenOutlined />}
                    block
                    onClick={() => fileInputRef.current?.click()}
                    style={{ height: 44, borderRadius: 0 }}
                  >
                    Choose from Gallery
                  </Button>
                </Space>
              </div>
            )}
          </div>



          {/* Left Panel: Detected Pieces List & Fixed Bottom 3D Viewer */}
          <Drawer
            title={
              <Space>
                <span>📦</span>
                <span style={{ color: themeColors.textPrimary }}>Detected Pieces ({filteredRegions.length})</span>
              </Space>
            }
            placement="left"
            open={partsDrawerOpen}
            onClose={() => setPartsDrawerOpen(false)}
            afterOpenChange={(open) => {
              if (open) {
                setTimeout(() => viewer3DRef.current?.resize(), 50);
              }
            }}
            mask={false}
            size={380}
            zIndex={1300}
            styles={{
              body: { padding: 0, background: themeColors.bgPanel, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
              header: { background: themeColors.bgPanel, borderBottom: `1px solid ${themeColors.border}` }
            }}
          >
            {/* Filter Controls: Confidence threshold & Presets */}
            <div style={{
              padding: '12px 16px 10px',
              borderBottom: `1px solid ${themeColors.border}`,
              background: themeColors.bgPanel,
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text strong style={{ fontSize: 12, color: themeColors.textPrimary }}>Confidence Threshold</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text strong style={{ fontSize: 12, color: themeColors.accentPrimary }}>{confRange[0]}% – {confRange[1]}%</Text>
                  <Tooltip title="Copy filtered inventory JSON to clipboard">
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => handleCopyInventory(confRange)}
                      style={{
                        height: 20,
                        width: 20,
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: themeColors.textSecondary
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
              <Slider
                range
                value={confRange}
                onChange={(val) => setConfRange(val as [number, number])}
                onChangeComplete={(val) => handleCopyInventory(val as [number, number])}
                tooltip={{
                  formatter: (val) => `${val}%`,
                  getPopupContainer: (node) => node.parentElement || document.body
                }}
                style={{ margin: '6px 0 10px 0' }}
              />
              <Segmented
                block
                size="small"
                options={[
                  { label: 'All', value: '0-100' },
                  { label: '≥ 25%', value: '25-100' },
                  { label: '≥ 50%', value: '50-100' },
                  { label: '≥ 70%', value: '70-100' }
                ]}
                value={`${confRange[0]}-${confRange[1]}`}
                onChange={(val) => {
                  const range = (val as string).split('-').map(Number) as [number, number];
                  setConfRange(range);
                  handleCopyInventory(range);
                }}
                style={{ borderRadius: 0 }}
              />
            </div>

            {/* Scrollable Pieces List (Fits cleanly between confidence settings and 3D viewer) */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {groupedSummaries.map(({ summary, instances }) => {
                  const isSelected = selectedRegion?.partId === summary.partId || activeSiblingPartId === summary.partId;
                  return (
                    <Card
                      key={summary.partId}
                      hoverable
                      size="small"
                      styles={{ body: { padding: '8px 10px' } }}
                      onClick={() => handlePartCardClick(summary.partId)}
                      style={{
                        background: isSelected ? themeColors.cardActiveBg : themeColors.cardDefaultBg,
                        borderColor: isSelected ? themeColors.accentPrimary : themeColors.border,
                        borderRadius: 0,
                        overflow: 'hidden',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ position: 'relative', textAlign: 'center', padding: '4px 0 2px 0' }}>
                        <img
                          src={summary.thumbnail}
                          alt={summary.name}
                          loading="lazy"
                          style={{ width: 50, height: 50, objectFit: 'contain' }}
                        />
                        <Badge
                          count={`${summary.count}x`}
                          style={{
                            position: 'absolute',
                            top: -2,
                            right: -2,
                            backgroundColor: themeColors.accentPrimary,
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: 10,
                            borderRadius: 0,
                            boxShadow: 'none'
                          }}
                        />
                      </div>
                      <Text
                        ellipsis={{ tooltip: summary.name }}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: themeColors.textPrimary,
                          display: 'block',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: 4
                        }}
                      >
                        {summary.name}
                      </Text>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                          <Text type="secondary" style={{ fontSize: 10, color: themeColors.textSecondary }}>#{summary.partId}</Text>
                          {summary.colors && summary.colors.length > 0 && (
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                              {summary.colors.slice(0, 3).map(c => (
                                <Tooltip key={c.code} title={`${c.name} (#${c.code})`}>
                                  <div
                                    style={{
                                      width: 8,
                                      height: 8,
                                      backgroundColor: c.hex,
                                      border: '1px solid rgba(0,0,0,0.3)',
                                      borderRadius: 0,
                                      flexShrink: 0
                                    }}
                                  />
                                </Tooltip>
                              ))}
                              {summary.colors.length > 3 && (
                                <span style={{ fontSize: 8, color: themeColors.textSecondary }}>+{summary.colors.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Tag color="cyan" style={{ margin: 0, fontSize: 10, padding: '0 4px', lineHeight: '18px', borderRadius: 0 }}>
                            {Math.round(summary.maxConfidence * 100)}%
                          </Tag>
                          <Tooltip title="Inspect in 3D">
                            <Button
                              type="text"
                              size="small"
                              icon={<EyeOutlined style={{ color: themeColors.accentPrimary, fontSize: 12 }} />}
                              style={{ width: 20, height: 20, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePartCardClick(summary.partId);
                              }}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* 3D WebGL View: Fixed at bottom of panel, full width, max 256 height */}
            <div
              style={{
                flexShrink: 0,
                width: '100%',
                height: 256,
                maxHeight: 256,
                background: themeColors.bgPanel,
                borderTop: `1px solid ${themeColors.border}`,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Part title bar */}
              <div
                style={{
                  height: 26,
                  minHeight: 26,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `1px solid ${themeColors.border}`,
                  background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  fontSize: 11,
                  userSelect: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                  <EyeOutlined style={{ fontSize: 12, color: themeColors.accentPrimary }} />
                  <span style={{ fontWeight: 600, color: themeColors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedRegion ? (selectedRegion.partName || `Part #${selectedRegion.partId}`) : '3D View'}
                  </span>
                </div>
                {selectedRegion && (
                  <span style={{ fontSize: 10, color: themeColors.textSecondary, fontFamily: 'monospace' }}>
                    #{selectedRegion.partId}
                  </span>
                )}
              </div>

              {/* WebGL Canvas Container */}
              <div
                className="webgl-piece-inspector"
                style={{
                  width: '100%',
                  flex: 1,
                  position: 'relative',
                  background: isDarkMode ? '#070a10' : '#ffffff',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'none'
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              >
                <div
                  ref={(el) => {
                    viewerContainerRef.current = el;
                    if (el) {
                      if (!viewer3DRef.current) {
                        viewer3DRef.current = new Viewer3D(el);
                      } else {
                        viewer3DRef.current.attachTo(el);
                      }
                      requestAnimationFrame(() => viewer3DRef.current?.resize());
                      if (selectedRegion) {
                        viewer3DRef.current.loadModel(selectedRegion.partId);
                      }
                    } else {
                      viewer3DRef.current?.detach();
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    background: isDarkMode ? '#070a10' : '#ffffff',
                    overflow: 'hidden',
                    touchAction: 'none'
                  }}
                />

                {/* When NO piece is selected: guide hint */}
                {!selectedRegion && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isDarkMode ? '#070a10' : '#ffffff',
                      color: themeColors.textSecondary,
                      fontSize: 11,
                      textAlign: 'center',
                      padding: 8,
                      pointerEvents: 'none',
                      userSelect: 'none',
                      zIndex: 2
                    }}
                  >
                    <EyeOutlined style={{ fontSize: 20, marginBottom: 4, opacity: 0.6 }} />
                    <span style={{ fontWeight: 600 }}>3D View</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>Click a card or piece to inspect</span>
                  </div>
                )}
              </div>
            </div>
          </Drawer>

          {/* Right Panel: Remix Catalog */}
          <Drawer
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
                <span>remix</span>
                <Tag color="blue" style={{ borderRadius: 0, margin: 0, fontSize: 10 }}>
                  {catalogTotal} Builds
                </Tag>
              </div>
            }
            placement="right"
            open={remixDrawerOpen}
            onClose={() => setRemixDrawerOpen(false)}
            mask={false}
            size={420}
            zIndex={1300}
            styles={{
              body: { padding: '16px 16px', background: themeColors.bgPanel },
              header: { background: themeColors.bgPanel, borderBottom: `1px solid ${themeColors.border}` }
            }}
          >
            <Tabs
              defaultActiveKey="catalog"
              items={[
                {
                  key: 'catalog',
                  label: isBrowsingAllCatalog
                    ? `Catalog (${filteredRemixSets.length} / ${catalogTotal})`
                    : `Official Builds (${filteredRemixSets.length} / ${catalogTotal})`,
                  children: (
                    <div>
                      {/* Top Filters & Search */}
                      <div style={{ marginBottom: 14 }}>
                        {regions.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            <Button
                              size="small"
                              type={!isBrowsingAllCatalog ? 'primary' : 'default'}
                              style={{ borderRadius: 0, flex: 1, fontSize: 11 }}
                              onClick={() => handleOpenRemix(true, false)}
                            >
                              My Pile ({exactMatchesCount > 0 ? `★${exactMatchesCount} / ` : ''}{remixSets.length})
                            </Button>
                            <Button
                              size="small"
                              type={isBrowsingAllCatalog ? 'primary' : 'default'}
                              style={{ borderRadius: 0, flex: 1, fontSize: 11 }}
                              onClick={() => handleOpenRemix(true, true)}
                            >
                              All Catalog ({catalogTotal})
                            </Button>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <Input
                            placeholder="Search builds or themes..."
                            prefix={<SearchOutlined style={{ color: themeColors.textSecondary }} />}
                            value={remixSearchQuery}
                            onChange={(e) => setRemixSearchQuery(e.target.value)}
                            allowClear
                            size="small"
                            style={{
                              background: themeColors.cardDefaultBg,
                              borderColor: themeColors.border,
                              color: themeColors.textPrimary
                            }}
                          />
                          <Tooltip title={isBrowsingAllCatalog ? "Reload catalog" : "Re-match against current pile"}>
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={() => handleOpenRemix(true, isBrowsingAllCatalog)}
                              disabled={isRemixLoading}
                            />
                          </Tooltip>
                        </div>

                        {!isBrowsingAllCatalog ? (
                          <Segmented
                            block
                            size="small"
                            value={remixFilter}
                            onChange={(val) => setRemixFilter(val as 'all' | 'exact' | 'near')}
                            options={[
                              { label: `All (${remixSets.length})`, value: 'all' },
                              {
                                label: (
                                  <span style={{ color: exactMatchesCount > 0 ? '#22c55e' : undefined, fontWeight: exactMatchesCount > 0 ? 'bold' : 'normal' }}>
                                    ★ 100% ({exactMatchesCount})
                                  </span>
                                ),
                                value: 'exact'
                              },
                              { label: `≤3 Missing (${nearMatchesCount})`, value: 'near' }
                            ]}
                          />
                        ) : regions.length === 0 ? (
                          <div style={{
                            background: isDarkMode ? '#1e293b' : '#f8fafc',
                            padding: '6px 10px',
                            border: `1px solid ${themeColors.border}`,
                            fontSize: 11,
                            color: themeColors.textSecondary
                          }}>
                            <span>📚 Browsing full catalog of <b>{catalogTotal}</b> micro-builds. Scan a pile to calculate piece compatibility!</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Content List */}
                      {isRemixLoading ? (
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                          <SyncOutlined spin style={{ fontSize: 28, color: '#0284c7', marginBottom: 12 }} />
                          <Paragraph type="secondary">Matching detected pieces against {catalogTotal}+ official LEGO models...</Paragraph>
                        </div>
                      ) : remixSets.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: themeColors.textSecondary }}>
                          <BulbOutlined style={{ fontSize: 32, marginBottom: 12 }} />
                          <Paragraph>No sets matched your detected pieces with ≥ 20% compatibility.</Paragraph>
                        </div>
                      ) : filteredRemixSets.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: themeColors.textSecondary }}>
                          <Paragraph>No builds found matching the current filter.</Paragraph>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {filteredRemixSets.map((item) => (
                            <div
                              key={item.set.id}
                              onClick={() => setSelectedRemixSet(item)}
                              style={{
                                background: themeColors.cardDefaultBg,
                                borderRadius: 0,
                                padding: '10px 12px',
                                border: item.is_exact
                                  ? '1px solid #22c55e'
                                  : `1px solid ${themeColors.border}`,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12
                              }}
                            >
                              <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                                <RemixSetThumbnail
                                  src={item.set.img}
                                  name={item.set.name}
                                  size={56}
                                  themeColors={themeColors}
                                />
                                {item.is_exact && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: -4,
                                      right: -4,
                                      background: '#22c55e',
                                      color: '#ffffff',
                                      fontSize: 9,
                                      fontWeight: 'bold',
                                      padding: '1px 4px',
                                      borderRadius: 0
                                    }}
                                  >
                                    100%
                                  </span>
                                )}
                              </div>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                  <Text strong style={{ color: themeColors.textPrimary, fontSize: 12, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.set.name}
                                  </Text>
                                  {item.is_exact ? (
                                    <Tag color="success" style={{ margin: 0, fontSize: 9, padding: '0 4px', height: 18, lineHeight: '18px', borderRadius: 0, flexShrink: 0 }}>
                                      BUILDABLE
                                    </Tag>
                                  ) : !isBrowsingAllCatalog && item.missing_count <= 3 ? (
                                    <Tag color="warning" style={{ margin: 0, fontSize: 9, padding: '0 4px', height: 18, lineHeight: '18px', borderRadius: 0, flexShrink: 0 }}>
                                      -{item.missing_count} pcs
                                    </Tag>
                                  ) : null}
                                </div>

                                <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 2 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: themeColors.textSecondary }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.set.theme} ({item.set.year})</span>
                                    <span style={{ flexShrink: 0, marginLeft: 4 }}>
                                      {!isBrowsingAllCatalog ? `${item.matched_pieces}/${item.total_pieces} pcs` : `${item.total_pieces} pcs`}
                                    </span>
                                  </div>
                                  {!isBrowsingAllCatalog && (
                                    <Progress
                                      percent={Math.round(item.match_pct)}
                                      size="small"
                                      strokeColor={item.is_exact ? '#22c55e' : item.match_pct >= 70 ? '#0284c7' : '#f59e0b'}
                                      format={(pct) => `${pct}%`}
                                    />
                                  )}
                                </Space>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
              ]}
            />
          </Drawer>

          {/* Left Panel Handle (Detected Pieces) */}
          <div
            onClick={() => setPartsDrawerOpen(!partsDrawerOpen)}
            style={{
              position: 'fixed',
              left: partsDrawerOpen ? 'min(380px, calc(100vw - 28px))' : 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1400,
              width: 28,
              height: 72,
              background: themeColors.bgPanel,
              border: `1px solid ${themeColors.border}`,
              borderLeft: partsDrawerOpen ? `1px solid ${themeColors.border}` : 'none',
              borderRadius: 0,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              boxShadow: isDarkMode ? '0 4px 16px rgba(0, 0, 0, 0.5)' : '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'left 0.3s cubic-bezier(0.23, 1, 0.32, 1), background 0.2s ease',
              userSelect: 'none'
            }}
            title={partsDrawerOpen ? 'Close Detected Pieces Panel' : 'Open Detected Pieces Panel'}
          >
            {/* Total Piece Counter Badge above handle */}
            {filteredRegions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1401,
                  pointerEvents: 'none'
                }}
              >
                <Badge
                  count={filteredRegions.length}
                  overflowCount={9999}
                  style={{
                    backgroundColor: themeColors.accentPrimary,
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: 11,
                    borderRadius: 0,
                    boxShadow: isDarkMode ? '0 2px 8px rgba(0,0,0,0.7)' : '0 2px 6px rgba(0,0,0,0.25)',
                    padding: '0 6px',
                    height: 20,
                    lineHeight: '20px'
                  }}
                />
              </div>
            )}
            <AppstoreOutlined style={{ fontSize: 13, color: partsDrawerOpen ? themeColors.accentPrimary : themeColors.textSecondary }} />
            {partsDrawerOpen ? (
              <LeftOutlined style={{ fontSize: 11, color: themeColors.textPrimary }} />
            ) : (
              <RightOutlined style={{ fontSize: 11, color: themeColors.textPrimary }} />
            )}
          </div>


          {/* Selected Remix Build Detail Modal */}
          {selectedRemixSet && (
            <Modal
              open={!!selectedRemixSet}
              wrapClassName="remix-detail-modal-wrap"
              rootClassName="remix-detail-modal-root"
              onCancel={() => {
                setSelectedRemixSet(null);
                setShowIframePreview(false);
              }}
              footer={[
                <Button
                  key="close"
                  style={{ borderRadius: 0 }}
                  onClick={() => {
                    setSelectedRemixSet(null);
                    setShowIframePreview(false);
                  }}
                >
                  Close
                </Button>,
                <Button
                  key="toggle-iframe"
                  style={{ borderRadius: 0 }}
                  onClick={() => setShowIframePreview(prev => !prev)}
                >
                  {showIframePreview ? 'Hide Frame' : 'Preview (iFrame)'}
                </Button>,
                <Button
                  key="popup"
                  style={{ borderRadius: 0 }}
                  icon={<ExportOutlined />}
                  onClick={() => {
                    window.open(
                      `https://rebrickable.com/sets/${selectedRemixSet.set.id}/`,
                      'rebrickable_popup',
                      'width=1100,height=850,resizable=yes,scrollbars=yes'
                    );
                  }}
                >
                  Popout
                </Button>,
                <Button
                  key="rebrickable"
                  type="primary"
                  icon={<ExportOutlined />}
                  href={`https://rebrickable.com/sets/${selectedRemixSet.set.id}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#0284c7', borderRadius: 0 }}
                >
                  Open Tab
                </Button>
              ]}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingRight: 24 }}>
                  <span style={{ color: themeColors.textPrimary, fontWeight: 600, fontSize: 16 }}>{selectedRemixSet.set.name}</span>
                  {selectedRemixSet.is_exact ? (
                    <Tag color="success" style={{ borderRadius: 2, margin: 0 }}>100% BUILDABLE</Tag>
                  ) : !isBrowsingAllCatalog ? (
                    <Tag color="warning" style={{ borderRadius: 2, margin: 0 }}>Missing {selectedRemixSet.missing_count} pcs</Tag>
                  ) : (
                    <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>{selectedRemixSet.total_pieces} pcs</Tag>
                  )}
                </div>
              }
              width={620}
              styles={{
                body: { background: themeColors.bgPanel, borderRadius: 0 },
                header: { background: themeColors.bgPanel, borderBottom: `1px solid ${themeColors.border}` }
              }}
            >
              <div style={{ textAlign: 'center', margin: '8px 0 14px' }}>
                <div style={{ display: 'inline-flex', justifyContent: 'center' }}>
                  <RemixSetThumbnail
                    src={selectedRemixSet.set.img}
                    name={selectedRemixSet.set.name}
                    size={160}
                    themeColors={themeColors}
                  />
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Tag color="blue" style={{ borderRadius: 0 }}>{selectedRemixSet.set.theme}</Tag>
                  <Tag style={{ borderRadius: 0 }}>Set #{selectedRemixSet.set.id}</Tag>
                  <Tag style={{ borderRadius: 0 }}>Year {selectedRemixSet.set.year}</Tag>
                  <Tag color={selectedRemixSet.is_exact ? 'green' : !isBrowsingAllCatalog ? 'orange' : 'default'} style={{ borderRadius: 0 }}>
                    {!isBrowsingAllCatalog ? `${selectedRemixSet.matched_pieces} / ${selectedRemixSet.total_pieces} pieces (${Math.round(selectedRemixSet.match_pct)}%)` : `${selectedRemixSet.total_pieces} pieces`}
                  </Tag>
                </div>
              </div>

              {showIframePreview && (
                <div style={{ margin: '14px 0', border: `1px solid ${themeColors.border}` }}>
                  <div style={{
                    background: isDarkMode ? '#1e293b' : '#f8fafc',
                    padding: '6px 10px',
                    fontSize: 11,
                    color: themeColors.textSecondary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: `1px solid ${themeColors.border}`
                  }}>
                    <span>ℹ️ Rebrickable sets <code>X-Frame-Options: SAMEORIGIN</code>. If blocked by your browser, click <b>Popout</b> or <b>Open Tab</b>.</span>
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: '0 4px', height: 'auto', fontSize: 11 }}
                      onClick={() => window.open(`https://rebrickable.com/sets/${selectedRemixSet.set.id}/`, '_blank')}
                    >
                      Open New Tab
                    </Button>
                  </div>
                  <iframe
                    src={`https://rebrickable.com/sets/${selectedRemixSet.set.id}/`}
                    title={`Rebrickable Set ${selectedRemixSet.set.id}`}
                    style={{
                      width: '100%',
                      height: 380,
                      border: 'none',
                      background: '#ffffff'
                    }}
                  />
                </div>
              )}

              <Divider style={{ margin: '12px 0', borderColor: themeColors.border }}>
                <span style={{ fontSize: 12, color: themeColors.textSecondary }}>Required Pieces Breakdown</span>
              </Divider>

              <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
                {Object.entries(selectedRemixSet.set.parts).map(([partId, needed]) => {
                  const info = inferenceEngineRef.current.getPartInfo(partId);
                  const missingInfo = selectedRemixSet.missing_parts.find(m => m.partId === partId);
                  const have = isBrowsingAllCatalog ? 0 : (missingInfo ? missingInfo.have : needed);
                  const isComplete = have >= needed;

                  return (
                    <div
                      key={partId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        marginBottom: 4,
                        borderRadius: 0,
                        background: themeColors.cardDefaultBg,
                        border: `1px solid ${themeColors.border}`
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                        {info.thumbnailUrl ? (
                          <img
                            src={info.thumbnailUrl}
                            alt={info.name}
                            style={{ width: 28, height: 28, objectFit: 'contain', background: themeColors.bgViewer, borderRadius: 0 }}
                          />
                        ) : (
                          <div style={{ width: 28, height: 28, background: themeColors.bgViewer, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: themeColors.textSecondary }}>
                            #
                          </div>
                        )}
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: themeColors.textPrimary, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            {info.name}
                          </div>
                          <div style={{ fontSize: 10, color: themeColors.textSecondary }}>
                            Part #{partId}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: themeColors.textPrimary }}>
                          {have} / {needed}
                        </span>
                        {isComplete ? (
                          <Tag color="success" style={{ margin: 0, fontSize: 10, borderRadius: 0 }}>✓ Complete</Tag>
                        ) : (
                          <Tag color="error" style={{ margin: 0, fontSize: 10, borderRadius: 0 }}>Missing {needed - have}</Tag>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Modal>
          )}



          {/* Dedicated 3D WebGL Model Modal */}
          <Modal
            open={!!viewerModalPart}
            onCancel={() => {
              if (modalViewer3DRef.current) {
                modalViewer3DRef.current.destroy();
                modalViewer3DRef.current = null;
              }
              setViewerModalPart(null);
            }}
            title={
              <Space>
                <EyeOutlined style={{ color: '#0284c7' }} />
                <span>3D LDraw Model: {viewerModalPart?.name}</span>
                <Tag color="geekblue" style={{ borderRadius: 0 }}>#{viewerModalPart?.partId}</Tag>
              </Space>
            }
            footer={null}
            centered
            width={580}
            styles={{
              body: { background: themeColors.bgPanel, padding: '16px 20px', textAlign: 'center', borderRadius: 0 }
            }}
            destroyOnHidden
          >
            <div
              ref={(el) => {
                if (el && viewerModalPart) {
                  if (!modalViewer3DRef.current) {
                    modalViewer3DRef.current = new Viewer3D(el);
                  } else {
                    modalViewer3DRef.current.attachTo(el);
                  }
                  modalViewer3DRef.current.loadModel(viewerModalPart.partId);
                } else if (!el) {
                  modalViewer3DRef.current?.detach();
                }
              }}
              style={{
                width: '100%',
                height: 380,
                background: themeColors.bgViewer,
                borderRadius: 0,
                overflow: 'hidden',
                border: `1px solid ${themeColors.border}`
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Rotate: Drag with mouse/touch | Zoom: Scroll / Pinch | Pan: Right-click drag
              </Text>
              <Button
                size="small"
                style={{ borderRadius: 0 }}
                onClick={() => {
                  if (modalViewer3DRef.current && viewerModalPart) {
                    modalViewer3DRef.current.loadModel(viewerModalPart.partId);
                  }
                }}
                icon={<ReloadOutlined />}
              >
                Reset Camera
              </Button>
            </div>
          </Modal>

          {/* Startup Preload & GPU Warmup Modal */}
          <Modal
            open={isStartupModalOpen}
            title={
              <Space>
                <div style={{ width: 8, height: 8, background: '#0284c7', animation: 'pulse 1.5s infinite' }} />
                <span>Initializing Bricknet V6 AI Engines</span>
              </Space>
            }
            footer={null}
            closable={false}
            centered
            width={460}
            styles={{
              body: { background: themeColors.bgPanel, borderRadius: 0 }
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Preloading ONNX models & compiling WebGL shaders...</Text>
                  <Text strong style={{ color: '#0284c7' }}>{startupProgress}%</Text>
                </div>
                <Progress
                  percent={startupProgress}
                  status="active"
                  showInfo={false}
                  strokeColor="#0284c7"
                />
              </div>

              <div style={{
                background: themeColors.bgViewer,
                border: `1px solid ${themeColors.border}`,
                borderRadius: 0,
                padding: 10,
                maxHeight: 110,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: 11,
                color: themeColors.textSecondary,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}>
                {startupLogs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </div>
          </Modal>

          {/* Model & Detection Settings Panel */}
          <SettingsPanel
            open={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onAnalyzeImage={handleSubmit}
            onRetake={handleRetake}
            isProcessing={isProcessing}
            pipelineStage={pipelineStage}
            pipelineMessage={pipelineMessage}
            pipelinePercent={pipelinePercent}
            patchProgress={patchProgress}
            patchCandidatesCount={pipelineStage === 'yolo' && isSahiEnabled ? sahiFoundCount : patchProgress.total}
            hasRegions={regions.length > 0}
            yoloResolution={yoloResolution}
            onResolutionChange={handleResolutionChange}
            maskOpacity={maskOpacity}
            onMaskOpacityChange={setMaskOpacity}
            showVectorShapes={showVectorShapes}
            onToggleVectorShapes={setShowVectorShapes}
            showDashedBoxes={showDashedBoxes}
            onToggleDashedBoxes={setShowDashedBoxes}
            isSahiEnabled={isSahiEnabled}
            onToggleSahi={setIsSahiEnabled}
            isMaskPatchesEnabled={isMaskPatchesEnabled}
            onToggleMaskPatches={setIsMaskPatchesEnabled}
            isRefineScaleEnabled={isRefineScaleEnabled}
            onToggleRefineScale={handleToggleRefineScale}
            isDarkMode={isDarkMode}
            scaleFeedback={scaleFeedback}
            themeColors={themeColors}
          />

          {/* Hidden File Inputs */}
          <input
            type="file"
            ref={cameraInputRef}
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </Content>
      </Layout>
    </ConfigProvider>
  );
};
