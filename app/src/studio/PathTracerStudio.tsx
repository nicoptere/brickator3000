import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  Button,
  Select,
  Radio,
  Progress,
  Tag,
  Space,
  Typography,
  Tooltip,
  Switch,
  Divider,
  message,
  Card,
  Spin
} from 'antd';
import {
  DownloadOutlined,
  CopyOutlined,
  CloseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  AppstoreOutlined,
  EyeOutlined,
  InboxOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PathTracerStudioEngine } from './pathTracerEngine';
import { SplatLoader } from './splatLoader';
import { LegoDiscretizer } from '../discretizer/discretizer';
import type { DiscretizerResult, ResolutionPreset } from '../discretizer/types';
import { getAssetUrl } from '../url';

const { Text, Title } = Typography;

interface PathTracerStudioProps {
  onClose: () => void;
  isDarkMode?: boolean;
}

const SAMPLE_MODELS = [
  { label: '🦆 Classic Duck (GLB)', value: 'duck', path: 'sample_models/duck.glb', type: 'glb' },
  { label: '🏛️ Prison 0 (OBJ)', value: 'prison', path: 'sample_models/prison_0.obj', type: 'obj' },
  { label: '🗿 Delacroix Sculpture (PLY)', value: 'delacroix', path: 'sample_models/delacroix_low_poly.ply', type: 'ply' },
  { label: '🔮 Colorful Sphere (Procedural)', value: 'sphere', path: '', type: 'procedural_sphere' },
  { label: '🍩 Torus Knot (Procedural)', value: 'torus', path: '', type: 'procedural_torus' }
];

export const PathTracerStudio: React.FC<PathTracerStudioProps> = ({ onClose, isDarkMode = true }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PathTracerStudioEngine | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>('duck');
  const [resolution, setResolution] = useState<ResolutionPreset>('medium');
  const [enableSlopes, setEnableSlopes] = useState<boolean>(true);
  const [enableInterlocking, setEnableInterlocking] = useState<boolean>(true);
  const [removeFloating, setRemoveFloating] = useState<boolean>(true);

  const [renderMode, setRenderMode] = useState<'pathtracer' | 'rasterizer'>('pathtracer');
  const [viewMode, setViewMode] = useState<'lego' | 'mesh'>('lego');

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentSPP, setCurrentSPP] = useState<number>(0);
  const [maxSPP, setMaxSPP] = useState<number>(512);

  const [discretizerResult, setDiscretizerResult] = useState<DiscretizerResult | null>(null);
  const currentGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Initialize 3D Engine
  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new PathTracerStudioEngine(containerRef.current, {
      maxSamples: 512,
      usePathTracing: renderMode === 'pathtracer',
      onSampleProgress: (cur, max) => {
        setCurrentSPP(cur);
        setMaxSPP(max);
      }
    });
    engineRef.current = engine;

    // Load initial model
    loadModelById('duck');

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Update engine path tracing mode
  useEffect(() => {
    engineRef.current?.setUsePathTracing(renderMode === 'pathtracer');
  }, [renderMode]);

  /**
   * Generates procedural test geometries
   */
  const createProceduralGeometry = (type: string): THREE.BufferGeometry => {
    if (type === 'procedural_sphere') {
      const geo = new THREE.SphereGeometry(30, 32, 24);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 30;
        // Rainbow latitude gradient
        const col = new THREE.Color().setHSL(0.5 + y * 0.45, 0.9, 0.5);
        colors[i * 3 + 0] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    } else {
      const geo = new THREE.TorusKnotGeometry(22, 6, 80, 16);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const col = new THREE.Color().setHSL((i / pos.count) * 2 % 1, 0.85, 0.55);
        colors[i * 3 + 0] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    }
  };

  /**
   * Loads and discretizes a model by sample ID
   */
  const loadModelById = async (id: string) => {
    setSelectedModel(id);
    const sample = SAMPLE_MODELS.find(m => m.value === id);
    if (!sample) return;

    setIsProcessing(true);
    setCurrentSPP(0);

    try {
      let geometry: THREE.BufferGeometry;

      if (sample.type === 'procedural_sphere' || sample.type === 'procedural_torus') {
        geometry = createProceduralGeometry(sample.type);
      } else if (sample.type === 'glb') {
        const gltf = await new Promise<any>((resolve, reject) => {
          new GLTFLoader().load(getAssetUrl(sample.path), resolve, undefined, reject);
        });
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((c: any) => {
          if (c.isMesh) meshes.push(c);
        });
        if (meshes.length === 0) throw new Error('No mesh found in GLTF model');
        geometry = meshes[0].geometry.clone();
      } else if (sample.type === 'obj') {
        const obj = await new Promise<THREE.Group>((resolve, reject) => {
          new OBJLoader().load(getAssetUrl(sample.path), resolve, undefined, reject);
        });
        const meshes: THREE.Mesh[] = [];
        obj.traverse((c: any) => {
          if (c.isMesh) meshes.push(c);
        });
        if (meshes.length === 0) throw new Error('No mesh found in OBJ model');
        geometry = meshes[0].geometry.clone();
      } else if (sample.type === 'ply') {
        geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          new PLYLoader().load(getAssetUrl(sample.path), resolve, undefined, reject);
        });
      } else {
        throw new Error('Unsupported sample type');
      }

      currentGeometryRef.current = geometry;
      await processGeometry(geometry);
    } catch (err: any) {
      console.error('Error loading sample model:', err);
      message.error(`Failed to load model: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Discretizes the active geometry and updates the 3D scene
   */
  const processGeometry = async (geometry: THREE.BufferGeometry) => {
    setIsProcessing(true);
    try {
      const result = await LegoDiscretizer.discretize(geometry, {
        resolution,
        enableSlopes,
        enableInterlocking,
        removeFloating
      });

      setDiscretizerResult(result);

      if (viewMode === 'lego') {
        await engineRef.current?.loadLdrContent(result.ldrContent);
      } else {
        engineRef.current?.loadGeometryPreview(geometry);
      }
    } catch (err: any) {
      console.error('Discretization failed:', err);
      message.error(`Discretization error: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle Resolution or Option changes
   */
  const handleOptionChange = useCallback(() => {
    if (currentGeometryRef.current) {
      processGeometry(currentGeometryRef.current);
    }
  }, [resolution, enableSlopes, enableInterlocking, removeFloating, viewMode]);

  useEffect(() => {
    if (currentGeometryRef.current) {
      handleOptionChange();
    }
  }, [resolution, enableSlopes, enableInterlocking, removeFloating]);

  /**
   * Handle View Mode Toggle (LEGO vs Original Mesh)
   */
  const handleViewModeToggle = (mode: 'lego' | 'mesh') => {
    setViewMode(mode);
    if (!engineRef.current || !currentGeometryRef.current) return;

    if (mode === 'lego' && discretizerResult) {
      engineRef.current.loadLdrContent(discretizerResult.ldrContent);
    } else {
      engineRef.current.loadGeometryPreview(currentGeometryRef.current);
    }
  };

  /**
   * Drag & Drop File Handler (GLB, OBJ, PLY, SPLAT)
   */
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileName = file.name.toLowerCase();
    message.loading({ content: `Reading ${file.name}...`, key: 'drop-msg' });

    try {
      const buffer = await file.arrayBuffer();
      let geometry: THREE.BufferGeometry;

      if (fileName.endsWith('.splat')) {
        geometry = SplatLoader.parseSplat(buffer);
      } else if (fileName.endsWith('.ply')) {
        try {
          geometry = SplatLoader.parseGaussianPly(buffer);
        } catch (_) {
          geometry = new PLYLoader().parse(buffer);
        }
      } else if (fileName.endsWith('.glb') || fileName.endsWith('.gltf')) {
        const gltf = await new Promise<any>((resolve, reject) => {
          new GLTFLoader().parse(buffer, '', resolve, reject);
        });
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((c: any) => {
          if (c.isMesh) meshes.push(c);
        });
        if (meshes.length === 0) throw new Error('No 3D mesh found in GLTF file');
        geometry = meshes[0].geometry.clone();
      } else if (fileName.endsWith('.obj')) {
        const text = new TextDecoder().decode(buffer);
        const obj = new OBJLoader().parse(text);
        const meshes: THREE.Mesh[] = [];
        obj.traverse((c: any) => {
          if (c.isMesh) meshes.push(c);
        });
        if (meshes.length === 0) throw new Error('No 3D mesh found in OBJ file');
        geometry = meshes[0].geometry.clone();
      } else {
        throw new Error('Unsupported format. Please drop a .glb, .obj, .ply, or .splat file.');
      }

      currentGeometryRef.current = geometry;
      setSelectedModel('custom');
      message.success({ content: `Loaded ${file.name}`, key: 'drop-msg' });
      await processGeometry(geometry);
    } catch (err: any) {
      console.error('File load failed:', err);
      message.error({ content: `Failed to load file: ${err.message}`, key: 'drop-msg' });
    }
  };

  /**
   * Export & Download LDraw (.ldr)
   */
  const handleDownloadLdr = () => {
    if (!discretizerResult) return;
    const blob = new Blob([discretizerResult.ldrContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lego_model_${resolution}_${Date.now()}.ldr`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Downloaded LDraw model (.ldr)');
  };

  /**
   * Copy LDraw text to clipboard
   */
  const handleCopyLdr = () => {
    if (!discretizerResult) return;
    navigator.clipboard.writeText(discretizerResult.ldrContent);
    message.success('Copied LDraw text to clipboard');
  };

  const sppPercent = Math.min(100, Math.round((currentSPP / maxSPP) * 100));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: '#090d16',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      {/* Top Navbar */}
      <div
        style={{
          height: 48,
          background: '#0f172a',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          userSelect: 'none'
        }}
      >
        <Space size="middle">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🧱</span>
            <Text strong style={{ color: '#ffffff', fontSize: 15 }}>
              LEGO Discretizer Studio
            </Text>
            <Tag color="cyan" style={{ borderRadius: 2, fontSize: 11 }}>
              512 SPP Path Tracer
            </Tag>
          </div>

          <Divider type="vertical" style={{ borderColor: 'rgba(255,255,255,0.15)' }} />

          {/* Model Selector Dropdown */}
          <Select
            value={selectedModel}
            onChange={(val) => loadModelById(val)}
            style={{ width: 230 }}
            options={SAMPLE_MODELS}
            dropdownStyle={{ background: '#1e293b' }}
          />

          {/* Resolution Selector */}
          <Radio.Group
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="minimal">Minimal (8x8)</Radio.Button>
            <Radio.Button value="medium">Medium (16x16)</Radio.Button>
            <Radio.Button value="large">Large (32x32)</Radio.Button>
            <Radio.Button value="full">Full (48x48)</Radio.Button>
          </Radio.Group>
        </Space>

        <Space orientation="horizontal" size="middle">
          {/* View Toggle */}
          <Radio.Group
            value={viewMode}
            onChange={(e) => handleViewModeToggle(e.target.value)}
            size="small"
          >
            <Radio.Button value="lego">🧱 LEGO View</Radio.Button>
            <Radio.Button value="mesh">📐 3D Mesh</Radio.Button>
          </Radio.Group>

          {/* Render Mode */}
          <Radio.Group
            value={renderMode}
            onChange={(e) => setRenderMode(e.target.value)}
            size="small"
          >
            <Radio.Button value="pathtracer">✨ Path Tracer</Radio.Button>
            <Radio.Button value="rasterizer">⚡ Real-time</Radio.Button>
          </Radio.Group>

          <Button
            type="text"
            icon={<CloseOutlined style={{ fontSize: 16, color: '#94a3b8' }} />}
            onClick={onClose}
          />
        </Space>
      </div>

      {/* Main Workspace: 3D Canvas + Right Panel */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* 3D WebGL Canvas Container */}
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

          {/* Drag & Drop Overlay */}
          {isDraggingOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(2, 132, 199, 0.45)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '3px dashed #38bdf8',
                zIndex: 10
              }}
            >
              <InboxOutlined style={{ fontSize: 64, color: '#ffffff' }} />
              <Title level={3} style={{ color: '#ffffff', marginTop: 12 }}>
                Drop 3D Model Here (.glb, .obj, .ply, .splat)
              </Title>
            </div>
          )}

          {/* Processing Spinner */}
          {isProcessing && (
            <div
              style={{
                position: 'absolute',
                top: 20,
                left: 20,
                background: 'rgba(15, 23, 42, 0.85)',
                padding: '8px 16px',
                borderRadius: 4,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                zIndex: 5
              }}
            >
              <Spin size="small" />
              <Text style={{ color: '#e2e8f0', fontSize: 12 }}>
                Discretizing 3D voxels & mapping LEGO parts...
              </Text>
            </div>
          )}

          {/* Progressive SPP Accumulation Banner */}
          {renderMode === 'pathtracer' && (
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                padding: '10px 16px',
                borderRadius: 6,
                minWidth: 260,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                zIndex: 5
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>
                  PATH TRACING ACCUMULATION
                </Text>
                <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: 'monospace' }}>
                  {currentSPP} / {maxSPP} SPP ({sppPercent}%)
                </Text>
              </div>
              <Progress
                percent={sppPercent}
                size="small"
                status={currentSPP >= maxSPP ? 'success' : 'active'}
                strokeColor="#0284c7"
                showInfo={false}
              />
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                {currentSPP >= maxSPP
                  ? '✓ 512 SPP studio convergence reached'
                  : 'Orbiting camera resets accumulation'}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Bill of Materials & Physical Analytics */}
        <div
          style={{
            width: 340,
            background: '#0f172a',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <Text strong style={{ color: '#ffffff', fontSize: 13 }}>
              Assembly Diagnostics & BOM
            </Text>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {discretizerResult ? (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                {/* Statistics Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: 10,
                    borderRadius: 4
                  }}
                >
                  <div>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>TOTAL PIECES</Text>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
                      {discretizerResult.stats.totalPieces}
                    </div>
                  </div>
                  <div>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>DISTINCT PARTS</Text>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#38bdf8' }}>
                      {discretizerResult.stats.distinctParts}
                    </div>
                  </div>
                  <div>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>BRICKS / PLATES</Text>
                    <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                      {discretizerResult.stats.brickCount} / {discretizerResult.stats.plateCount}
                    </div>
                  </div>
                  <div>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>SLOPES & WEDGES</Text>
                    <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                      {discretizerResult.stats.slopeCount}
                    </div>
                  </div>
                </div>

                {/* Physical Stability Badge */}
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: discretizerResult.stats.isStable
                      ? 'rgba(22, 163, 74, 0.15)'
                      : 'rgba(234, 179, 8, 0.15)',
                    border: `1px solid ${discretizerResult.stats.isStable ? '#16a34a' : '#eab308'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  {discretizerResult.stats.isStable ? (
                    <CheckCircleOutlined style={{ color: '#22c55e', fontSize: 16 }} />
                  ) : (
                    <WarningOutlined style={{ color: '#eab308', fontSize: 16 }} />
                  )}
                  <div>
                    <Text strong style={{ color: '#ffffff', fontSize: 12 }}>
                      {discretizerResult.stats.isStable ? 'Physically Stable' : 'Overhang Warning'}
                    </Text>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      {discretizerResult.stats.isStable
                        ? 'Center of mass rests safely within base polygon'
                        : 'Center of mass near base perimeter'}
                    </div>
                  </div>
                </div>

                {/* Algorithmic Toggles */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 4 }}>
                  <Text strong style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
                    CONSTRUCTION RULES
                  </Text>
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: '#e2e8f0' }}>Staggered Running Bond</Text>
                      <Switch size="small" checked={enableInterlocking} onChange={setEnableInterlocking} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: '#e2e8f0' }}>Slope & Wedge Snapping</Text>
                      <Switch size="small" checked={enableSlopes} onChange={setEnableSlopes} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: '#e2e8f0' }}>Eliminate Floating Bricks</Text>
                      <Switch size="small" checked={removeFloating} onChange={setRemoveFloating} />
                    </div>
                  </Space>
                </div>

                {/* Color Breakdown Chips */}
                <div>
                  <Text strong style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                    OFFICIAL LEGO PALETTE
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {discretizerResult.stats.colorBreakdown.slice(0, 10).map((c) => (
                      <Tooltip key={c.code} title={`${c.name} (#${c.code}): ${c.count} pcs`}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'rgba(255, 255, 255, 0.06)',
                            padding: '2px 6px',
                            borderRadius: 3,
                            fontSize: 10
                          }}
                        >
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              backgroundColor: c.hex,
                              border: '1px solid rgba(255,255,255,0.2)'
                            }}
                          />
                          <span style={{ color: '#cbd5e1' }}>{c.count}</span>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </div>

                {/* Bill of Materials (BOM) */}
                <div>
                  <Text strong style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                    BILL OF MATERIALS
                  </Text>
                  <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {discretizerResult.stats.partBreakdown.map((p) => (
                      <div
                        key={p.partId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: 3,
                          fontSize: 11
                        }}
                      >
                        <span style={{ color: '#e2e8f0' }}>{p.name}</span>
                        <Tag style={{ margin: 0, borderRadius: 2, fontSize: 10 }}>
                          ×{p.count}
                        </Tag>
                      </div>
                    ))}
                  </div>
                </div>
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>
                <Spin />
                <div style={{ marginTop: 8, fontSize: 11 }}>Analyzing 3D geometry...</div>
              </div>
            )}
          </div>

          {/* Bottom Export Bar */}
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: '#090d16',
              display: 'flex',
              gap: 8
            }}
          >
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownloadLdr}
              disabled={!discretizerResult}
              block
              style={{ borderRadius: 2 }}
            >
              Export .ldr
            </Button>
            <Tooltip title="Copy LDraw code">
              <Button
                icon={<CopyOutlined />}
                onClick={handleCopyLdr}
                disabled={!discretizerResult}
                style={{ borderRadius: 2 }}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};
