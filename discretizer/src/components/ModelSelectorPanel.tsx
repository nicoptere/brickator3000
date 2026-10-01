import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Select,
  Input,
  Button,
  Upload,
  Typography,
  Tag,
  Divider,
  Spin,
  Alert,
  Slider,
  Radio,
  Checkbox,
  Progress
} from 'antd';
import {
  UploadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { getAssetUrl } from '../url';
import type { ModelStats } from '../viewport/viewportEngine';
import type { SolverResult } from '../solver/kernelSolver';

const { Text, Title } = Typography;

export interface CleanModelItem {
  id: string;
  name: string;
  filename: string;
  category: string;
  path: string;
  sizeBytes: number;
  sizeFormatted: string;
}

export interface CleanCategoryItem {
  name: string;
  title: string;
  count: number;
  models: CleanModelItem[];
}

export interface CleanManifest {
  generatedAt: string;
  totalModels: number;
  categories: CleanCategoryItem[];
}

export interface SampleModelItem {
  label: string;
  value: string;
  path: string;
  type: string;
}

export const SAMPLE_MODELS: SampleModelItem[] = [
  { label: 'Classic Duck (GLB)', value: 'duck', path: 'sample_models/duck.glb', type: 'glb' },
  { label: 'Mahogany Table (Baked GLB)', value: 'table_baked', path: 'sample_models/table_baked.glb', type: 'glb' },
  { label: 'Bieder Chair (Baked GLB)', value: 'bieder_chair', path: 'sample_models/bieder_chair.glb', type: 'glb' },
  { label: 'Dolphin (Baked GLB)', value: 'dolphin', path: 'sample_models/dolphin.glb', type: 'glb' },
  { label: 'Classic Armchair (3DS)', value: 'armchair', path: 'sample_models/armchair.3ds', type: '3ds' },
  { label: 'Coffee Table (3DS)', value: 'coffeetable', path: 'sample_models/coffee_table.3ds', type: '3ds' },
  { label: 'Prison 0 (OBJ)', value: 'prison', path: 'sample_models/prison_0.obj', type: 'obj' },
  { label: 'Delacroix Sculpture (PLY)', value: 'delacroix', path: 'sample_models/delacroix_low_poly.ply', type: 'ply' },
  { label: 'Procedural Sphere', value: 'sphere', path: '', type: 'procedural_sphere' },
  { label: 'Procedural Torus Knot', value: 'torus', path: '', type: 'procedural_torus' }
];

export interface DiscretizeConfig {
  targetStuds: number;
  strategy: 'tiered' | 'size_descent';
  enableCurvedSlopes: boolean;
  enableMacaroni: boolean;
  enableCanisters: boolean;
  enableStudlessTiles: boolean;
}

export interface ModelSelectorPanelProps {
  onSelectSampleModel: (model: SampleModelItem) => void;
  onSelectCleanModel: (model: CleanModelItem) => void;
  onUploadFile: (file: File) => void;
  modelStats: ModelStats | null;
  isLoading: boolean;
  onDiscretize: (config: DiscretizeConfig) => void;
  isDiscretizing: boolean;
  discretizeProgress: { stage: string; percent: number } | null;
  discretizerResult: SolverResult | null;
  viewMode: 'mesh' | 'lego' | 'both';
  onViewModeChange: (mode: 'mesh' | 'lego' | 'both') => void;
  onExportLDraw: () => void;
}

export const ModelSelectorPanel: React.FC<ModelSelectorPanelProps> = ({
  onSelectSampleModel,
  onSelectCleanModel,
  onUploadFile,
  modelStats,
  isLoading,
  onDiscretize,
  isDiscretizing,
  discretizeProgress,
  discretizerResult,
  viewMode,
  onViewModeChange,
  onExportLDraw
}) => {
  const [activeSource, setActiveSource] = useState<'sample' | 'clean'>('sample');
  const [selectedSampleValue, setSelectedSampleValue] = useState<string>('duck');
  const [cleanManifest, setCleanManifest] = useState<CleanManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState<boolean>(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCleanModelId, setSelectedCleanModelId] = useState<string>('');

  // Discretizer Settings (Resolution 2 to 16, step 1)
  const [targetStuds, setTargetStuds] = useState<number>(10);
  const [strategy, setStrategy] = useState<'tiered' | 'size_descent'>('tiered');
  const [enableCurvedSlopes, setEnableCurvedSlopes] = useState<boolean>(true);
  const [enableMacaroni, setEnableMacaroni] = useState<boolean>(true);
  const [enableCanisters, setEnableCanisters] = useState<boolean>(true);
  const [enableStudlessTiles, setEnableStudlessTiles] = useState<boolean>(true);

  // Fetch clean models manifest
  useEffect(() => {
    let isMounted = true;
    const loadManifest = async () => {
      try {
        setLoadingManifest(true);
        const manifestUrl = getAssetUrl('models/clean_manifest.json');
        const res = await fetch(manifestUrl);
        if (!res.ok) {
          throw new Error(`Failed to load manifest: ${res.statusText}`);
        }
        const data = await res.json();
        if (isMounted) {
          setCleanManifest(data);
          setManifestError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          setManifestError(err.message || 'Error loading clean models manifest');
        }
      } finally {
        if (isMounted) {
          setLoadingManifest(false);
        }
      }
    };

    loadManifest();
    return () => {
      isMounted = false;
    };
  }, []);

  const categories = useMemo(() => {
    if (!cleanManifest?.categories) return [];
    return cleanManifest.categories;
  }, [cleanManifest]);

  const allCleanModels = useMemo(() => {
    if (!cleanManifest?.categories) return [];
    return cleanManifest.categories.flatMap(cat => cat.models);
  }, [cleanManifest]);

  const filteredCleanModels = useMemo(() => {
    return allCleanModels.filter(model => {
      const matchCat = selectedCategory === 'all' || model.category === selectedCategory;
      const matchQuery = !searchQuery || model.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [allCleanModels, selectedCategory, searchQuery]);

  const handleSampleChange = (value: string) => {
    setSelectedSampleValue(value);
    const found = SAMPLE_MODELS.find(m => m.value === value);
    if (found) {
      onSelectSampleModel(found);
    }
  };

  const handleCleanModelChange = (modelId: string) => {
    setSelectedCleanModelId(modelId);
    const found = allCleanModels.find(m => m.id === modelId);
    if (found) {
      onSelectCleanModel(found);
    }
  };

  const handleRunDiscretize = () => {
    onDiscretize({
      targetStuds,
      strategy,
      enableCurvedSlopes,
      enableMacaroni,
      enableCanisters,
      enableStudlessTiles
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'auto',
        overflowY: 'auto'
      }}
    >
      <Card
        size="small"
        variant="outlined"
        style={{
          backgroundColor: '#ffffff',
          borderColor: '#e2e8f0',
          boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
          borderRadius: 8
        }}
        styles={{
          body: {
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Title level={5} style={{ margin: 0, color: '#0f172a', fontWeight: 600 }}>
              Surface Discretizer V2
            </Title>
            <Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
              Multi-Scale Kernel Engine (LTRON Graph)
            </Text>
          </div>
          {isLoading && <Spin size="small" />}
        </div>

        <Divider style={{ margin: '4px 0', borderColor: '#e2e8f0' }} />

        {/* Source Toggle */}
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            size="small"
            type={activeSource === 'sample' ? 'primary' : 'default'}
            onClick={() => setActiveSource('sample')}
            style={{
              flex: 1,
              backgroundColor: activeSource === 'sample' ? '#2563eb' : '#f8fafc',
              borderColor: activeSource === 'sample' ? '#2563eb' : '#e2e8f0',
              color: activeSource === 'sample' ? '#ffffff' : '#0f172a'
            }}
          >
            Sample Meshes
          </Button>
          <Button
            size="small"
            type={activeSource === 'clean' ? 'primary' : 'default'}
            onClick={() => setActiveSource('clean')}
            style={{
              flex: 1,
              backgroundColor: activeSource === 'clean' ? '#2563eb' : '#f8fafc',
              borderColor: activeSource === 'clean' ? '#2563eb' : '#e2e8f0',
              color: activeSource === 'clean' ? '#ffffff' : '#0f172a'
            }}
          >
            Clean Library ({allCleanModels.length})
          </Button>
        </div>

        {/* Sample Models View */}
        {activeSource === 'sample' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Select Model:
            </Text>
            <Select
              value={selectedSampleValue}
              onChange={handleSampleChange}
              style={{ width: '100%' }}
              options={SAMPLE_MODELS.map(m => ({
                label: m.label,
                value: m.value
              }))}
            />
          </div>
        )}

        {/* Clean Models View */}
        {activeSource === 'clean' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loadingManifest ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Spin size="small" />
                <Text style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 8 }}>
                  Loading clean manifest...
                </Text>
              </div>
            ) : manifestError ? (
              <Alert message={manifestError} type="error" showIcon style={{ fontSize: 12 }} />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Select
                    size="small"
                    value={selectedCategory}
                    onChange={setSelectedCategory}
                    style={{ width: 140 }}
                    options={[
                      { label: 'All Categories', value: 'all' },
                      ...categories.map(c => ({
                        label: `${c.title} (${c.count})`,
                        value: c.name
                      }))
                    ]}
                  />
                  <Input
                    size="small"
                    placeholder="Search..."
                    prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    allowClear
                    style={{ flex: 1 }}
                  />
                </div>

                <Select
                  showSearch
                  placeholder="Select model..."
                  value={selectedCleanModelId || undefined}
                  onChange={handleCleanModelChange}
                  filterOption={false}
                  style={{ width: '100%' }}
                  options={filteredCleanModels.slice(0, 100).map(m => ({
                    label: `${m.name} (${m.sizeFormatted})`,
                    value: m.id
                  }))}
                />
              </>
            )}
          </div>
        )}

        {/* Upload Custom File */}
        <Upload
          beforeUpload={(file) => {
            onUploadFile(file);
            return false;
          }}
          showUploadList={false}
          accept=".glb,.gltf,.obj,.ply,.3ds"
        >
          <Button
            icon={<UploadOutlined />}
            size="small"
            style={{
              width: '100%',
              backgroundColor: '#f8fafc',
              borderColor: '#e2e8f0',
              color: '#0f172a'
            }}
          >
            Upload Mesh (GLB, OBJ, PLY, 3DS)
          </Button>
        </Upload>

        {/* Active Mesh Stats */}
        {modelStats && (
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 12, color: '#0f172a' }}>
                {modelStats.name}
              </Text>
              <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
                Mesh Ready
              </Tag>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
              <div>
                <Text type="secondary">Triangles: </Text>
                <Text strong>{modelStats.triangleCount.toLocaleString()}</Text>
              </div>
              <div>
                <Text type="secondary">Vertices: </Text>
                <Text strong>{modelStats.vertexCount.toLocaleString()}</Text>
              </div>
            </div>
          </div>
        )}

        <Divider style={{ margin: '4px 0', borderColor: '#e2e8f0' }} />

        {/* Discretizer Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: '#0f172a', fontWeight: 500 }}>
              Resolution (Max Studs): {targetStuds}
            </Text>
          </div>
          <Slider
            min={2}
            max={16}
            step={1}
            value={targetStuds}
            onChange={setTargetStuds}
            marks={{ 2: '2', 4: '4', 8: '8', 12: '12', 16: '16' }}
            style={{ margin: '4px 0 16px 0' }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Dispatch Strategy:
            </Text>
            <Radio.Group
              size="small"
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              style={{ display: 'flex', width: '100%' }}
            >
              <Radio.Button value="tiered" style={{ flex: 1, textAlign: 'center' }}>
                Tiered Multi-Pass
              </Radio.Button>
              <Radio.Button value="size_descent" style={{ flex: 1, textAlign: 'center' }}>
                Size-Descent
              </Radio.Button>
            </Radio.Group>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, marginTop: 4 }}>
            <Checkbox
              checked={enableCurvedSlopes}
              onChange={e => setEnableCurvedSlopes(e.target.checked)}
            >
              Curved Slopes
            </Checkbox>
            <Checkbox
              checked={enableMacaroni}
              onChange={e => setEnableMacaroni(e.target.checked)}
            >
              Macaroni Tiles
            </Checkbox>
            <Checkbox
              checked={enableCanisters}
              onChange={e => setEnableCanisters(e.target.checked)}
            >
              Round Canisters
            </Checkbox>
            <Checkbox
              checked={enableStudlessTiles}
              onChange={e => setEnableStudlessTiles(e.target.checked)}
            >
              Studless Top Tiles
            </Checkbox>
          </div>

          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={isDiscretizing}
            onClick={handleRunDiscretize}
            style={{
              marginTop: 6,
              backgroundColor: '#2563eb',
              borderColor: '#2563eb',
              height: 36,
              fontWeight: 500
            }}
          >
            {isDiscretizing ? 'Discretizing...' : 'Discretize Model'}
          </Button>

          {/* Progress Indicator */}
          {discretizeProgress && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
                <span>{discretizeProgress.stage}</span>
                <span>{discretizeProgress.percent}%</span>
              </div>
              <Progress percent={discretizeProgress.percent} showInfo={false} size="small" strokeColor="#2563eb" />
            </div>
          )}
        </div>

        {/* Results Card */}
        {discretizerResult && (
          <div
            style={{
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 4
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 12, color: '#1e40af' }}>
                Discretization Result
              </Text>
              {discretizerResult.stats.is100PercentGrounded ? (
                <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0, fontSize: 11 }}>
                  100% Grounded
                </Tag>
              ) : (
                <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>
                  {discretizerResult.stats.groundedBricks}/{discretizerResult.stats.totalBricks} Grounded
                </Tag>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <div>
                <Text type="secondary">Total Bricks: </Text>
                <Text strong>{discretizerResult.bricks.length}</Text>
              </div>
              <div>
                <Text type="secondary">Connections: </Text>
                <Text strong>{discretizerResult.stats.totalConnections}</Text>
              </div>
              <div>
                <Text type="secondary">Execution: </Text>
                <Text strong>{discretizerResult.executionTimeMs} ms</Text>
              </div>
              <div>
                <Text type="secondary">Parts Variety: </Text>
                <Text strong>
                  {new Set(discretizerResult.bricks.map(b => b.partId)).size} types
                </Text>
              </div>
            </div>

            {/* View Mode Radio Group */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: '#1e40af', fontWeight: 500 }}>
                Viewport Display Mode:
              </Text>
              <Radio.Group
                size="small"
                value={viewMode}
                onChange={e => onViewModeChange(e.target.value)}
                style={{ display: 'flex', width: '100%' }}
              >
                <Radio.Button value="mesh" style={{ flex: 1, textAlign: 'center' }}>
                  Mesh
                </Radio.Button>
                <Radio.Button value="lego" style={{ flex: 1, textAlign: 'center' }}>
                  LEGO
                </Radio.Button>
                <Radio.Button value="both" style={{ flex: 1, textAlign: 'center' }}>
                  Overlay
                </Radio.Button>
              </Radio.Group>
            </div>

            {/* Export LDraw Button */}
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={onExportLDraw}
              style={{
                marginTop: 4,
                backgroundColor: '#ffffff',
                borderColor: '#bfdbfe',
                color: '#1e40af',
                fontWeight: 500
              }}
            >
              Export LDraw (.ldr)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};
