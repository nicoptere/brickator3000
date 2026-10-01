import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card,
  Select,
  Input,
  Button,
  Upload,
  Typography,
  Space,
  Tag,
  Divider,
  Spin,
  Alert,
  Tooltip
} from 'antd';
import {
  UploadOutlined,
  SearchOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  AppstoreOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { getAssetUrl } from '../url';
import type { ModelStats } from '../viewport/viewportEngine';

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

export interface ModelSelectorPanelProps {
  onSelectSampleModel: (model: SampleModelItem) => void;
  onSelectCleanModel: (model: CleanModelItem) => void;
  onUploadFile: (file: File) => void;
  modelStats: ModelStats | null;
  isLoading: boolean;
}

export const ModelSelectorPanel: React.FC<ModelSelectorPanelProps> = ({
  onSelectSampleModel,
  onSelectCleanModel,
  onUploadFile,
  modelStats,
  isLoading
}) => {
  const [activeSource, setActiveSource] = useState<'sample' | 'clean'>('sample');
  const [selectedSampleValue, setSelectedSampleValue] = useState<string>('duck');
  const [cleanManifest, setCleanManifest] = useState<CleanManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState<boolean>(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCleanModelId, setSelectedCleanModelId] = useState<string>('');

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

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        width: 360,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'auto'
      }}
    >
      <Card
        size="small"
        bordered
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
              Model Discretizer
            </Title>
            <Text type="secondary" style={{ fontSize: 12, color: '#64748b' }}>
              Input Mesh Inspection Stage
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Select Sample Model:
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    placeholder="Search models..."
                    prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    allowClear
                    style={{ flex: 1 }}
                  />
                </div>

                <Select
                  showSearch
                  placeholder="Select a clean model..."
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
            Upload 3D Mesh (GLB, OBJ, PLY, 3DS)
          </Button>
        </Upload>

        {/* Model Statistics Display */}
        {modelStats && (
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                {modelStats.name}
              </Text>
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                Loaded
              </Tag>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <div>
                <Text type="secondary">Triangles: </Text>
                <Text strong>{modelStats.triangleCount.toLocaleString()}</Text>
              </div>
              <div>
                <Text type="secondary">Vertices: </Text>
                <Text strong>{modelStats.vertexCount.toLocaleString()}</Text>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <Text type="secondary">Bounding Box: </Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {modelStats.dimensions.x} x {modelStats.dimensions.y} x {modelStats.dimensions.z}
                </Text>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
