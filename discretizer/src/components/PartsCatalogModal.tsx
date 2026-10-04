import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Modal, Input, Select, Table, Tag, Typography, Button, Space, Row, Col, Card } from 'antd';
import { SearchOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import rawPartsData from '../kernels/parts18kData.json';
import type { BaseKernelDefinition } from '../kernels/types';
import { get18kKernelCatalog } from '../kernels/parts18kLoader';

const { Text, Title } = Typography;

export interface PartsCatalogModalProps {
  visible: boolean;
  onClose: () => void;
}

interface CatalogPartItem {
  partId: string;
  name: string;
  system: string;
  category: string;
  baseSize: [number, number, number];
  targetNormal: [number, number, number];
  tier: number;
  weightBonus: number;
  omrFrequency: number;
}

export const PartsCatalogModal: React.FC<PartsCatalogModalProps> = ({ visible, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSystem, setSelectedSystem] = useState<string>('all');
  const [selectedPart, setSelectedPart] = useState<CatalogPartItem | null>(null);

  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const threeStateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    partGroup: THREE.Group;
    animId: number;
  } | null>(null);

  // Lazy load data list
  const allParts = useMemo(() => {
    return (rawPartsData as unknown) as CatalogPartItem[];
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of allParts) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  }, [allParts]);

  const filteredParts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allParts.filter(p => {
      const matchQuery = !q || p.partId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
      const matchSys = selectedSystem === 'all' || p.system === selectedSystem;
      return matchQuery && matchCat && matchSys;
    });
  }, [allParts, searchQuery, selectedCategory, selectedSystem]);

  // Set default selected part on open
  useEffect(() => {
    if (visible && !selectedPart && allParts.length > 0) {
      const def = allParts.find(p => p.partId === '3001') || allParts[0];
      setSelectedPart(def);
    }
  }, [visible, selectedPart, allParts]);

  // Setup 3D preview scene for the selected part
  useEffect(() => {
    if (!visible || !previewCanvasRef.current) return;
    const container = previewCanvasRef.current;

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 280;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e222b);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(6, 5, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);

    // Studio lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222630, 0.9);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 15, 10);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x90b0e0, 0.5);
    fillLight.position.set(-10, 8, -8);
    scene.add(fillLight);

    // Subtle grid
    const grid = new THREE.GridHelper(10, 10, 0x3b4252, 0x2e3440);
    grid.position.y = -1.2;
    scene.add(grid);

    const partGroup = new THREE.Group();
    scene.add(partGroup);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    threeStateRef.current = { renderer, scene, camera, controls, partGroup, animId };

    return () => {
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      threeStateRef.current = null;
    };
  }, [visible]);

  // Update 3D preview geometry when selectedPart changes
  useEffect(() => {
    if (!threeStateRef.current || !selectedPart) return;
    const { partGroup, controls, camera } = threeStateRef.current;

    // Clear previous objects
    while (partGroup.children.length > 0) {
      const child = partGroup.children[0];
      partGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const m = (child as any).material;
        if (Array.isArray(m)) m.forEach(x => x.dispose());
        else m.dispose();
      }
    }

    const [w, d, h] = selectedPart.baseSize;
    // Normalize display dimensions
    const studScale = 0.8;
    const plateScale = 0.32;
    const sx = w * studScale;
    const sz = d * studScale;
    const sy = h * plateScale;

    // ABS plastic material in royal blue
    const plasticMat = new THREE.MeshPhysicalMaterial({
      color: 0x2563eb,
      roughness: 0.18,
      metalness: 0.02,
      clearcoat: 0.35,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide
    });

    let meshGeo: THREE.BufferGeometry;
    if (selectedPart.category === 'ROUND_CANISTER' || selectedPart.category === 'ORGANIC_DOME') {
      meshGeo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32);
    } else if (selectedPart.category === 'SLOPE_45') {
      const shape = new THREE.Shape();
      shape.moveTo(-0.5, -0.5);
      shape.lineTo(0.5, -0.5);
      shape.lineTo(-0.5, 0.5);
      shape.lineTo(-0.5, -0.5);
      meshGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
      meshGeo.rotateY(-Math.PI / 2);
      meshGeo.scale(sx, sy, sz);
      meshGeo.center();
    } else {
      meshGeo = new THREE.BoxGeometry(sx, sy, sz);
    }

    const partMesh = new THREE.Mesh(meshGeo, plasticMat);
    partGroup.add(partMesh);

    // 3D Bounding Box Gizmo with crisp lines
    const boxHelper = new THREE.BoxHelper(partMesh, 0x60a5fa);
    partGroup.add(boxHelper);

    // Add male studs on top if applicable
    if (selectedPart.category !== 'TILE_FLAT') {
      const studR = studScale * 0.24;
      const studH = studScale * 0.18;
      const studGeo = new THREE.CylinderGeometry(studR, studR, studH, 16);
      for (let ix = 0; ix < w; ix++) {
        for (let iz = 0; iz < d; iz++) {
          const sm = new THREE.Mesh(studGeo, plasticMat);
          const px = -sx / 2 + (ix + 0.5) * studScale;
          const pz = -sz / 2 + (iz + 0.5) * studScale;
          const py = sy / 2 + studH / 2;
          sm.position.set(px, py, pz);
          partGroup.add(sm);
        }
      }
    }

    // Normal vector arrow gizmo
    const [nx, ny, nz] = selectedPart.targetNormal;
    if (Math.hypot(nx, ny, nz) > 0.1) {
      const dir = new THREE.Vector3(nx, ny, nz).normalize();
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, sy / 2, 0), 1.2, 0xf59e0b, 0.3, 0.15);
      partGroup.add(arrow);
    }

    // Frame camera on part
    const maxDim = Math.max(sx, sy, sz, 1.5);
    camera.position.set(maxDim * 1.8, maxDim * 1.4, maxDim * 2.0);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [selectedPart]);

  const columns = [
    {
      title: 'Part ID',
      dataIndex: 'partId',
      key: 'partId',
      width: 90,
      render: (id: string) => (
        <Text strong style={{ color: '#2563eb', fontFamily: 'monospace' }}>
          {id}
        </Text>
      )
    },
    {
      title: 'Part Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (cat: string) => {
        let color = 'default';
        if (cat.includes('SLOPE')) color = 'blue';
        else if (cat.includes('BRICK')) color = 'geekblue';
        else if (cat.includes('TILE')) color = 'cyan';
        else if (cat.includes('ROUND')) color = 'purple';
        else if (cat.includes('BIONICLE')) color = 'magenta';
        return <Tag color={color} style={{ fontSize: 11, margin: 0 }}>{cat.replace(/_/g, ' ')}</Tag>;
      }
    },
    {
      title: 'Size [W, D, H]',
      key: 'baseSize',
      width: 110,
      render: (_: any, r: CatalogPartItem) => (
        <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {r.baseSize[0]}x{r.baseSize[1]}x{r.baseSize[2]}
        </Text>
      )
    }
  ];

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={980}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0, color: '#0f172a' }}>
            18K LDraw Parts Catalog
          </Title>
          <Tag color="blue" style={{ fontSize: 12 }}>
            {allParts.length.toLocaleString()} Parts Loaded
          </Tag>
        </div>
      }
      styles={{
        body: {
          padding: '16px 20px',
          maxHeight: 'calc(85vh - 60px)',
          overflowY: 'auto'
        }
      }}
    >
      {/* Search and Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Input
          placeholder="Search by part ID or name (e.g. 3001, slope curved, 2x4)..."
          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          allowClear
          style={{ flex: 2 }}
        />
        <Select
          value={selectedCategory}
          onChange={setSelectedCategory}
          style={{ width: 180 }}
          options={[
            { label: 'All Categories', value: 'all' },
            ...categories.map(c => ({ label: c.replace(/_/g, ' '), value: c }))
          ]}
        />
        <Select
          value={selectedSystem}
          onChange={setSelectedSystem}
          style={{ width: 140 }}
          options={[
            { label: 'All Systems', value: 'all' },
            { label: 'System', value: 'SYSTEM' },
            { label: 'Technic', value: 'TECHNIC' }
          ]}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setSearchQuery('');
            setSelectedCategory('all');
            setSelectedSystem('all');
          }}
        >
          Reset
        </Button>
      </div>

      <Row gutter={16}>
        {/* Parts Table */}
        <Col span={14}>
          <Table<CatalogPartItem>
            size="small"
            columns={columns}
            dataSource={filteredParts}
            rowKey="partId"
            pagination={{
              pageSize: 15,
              showSizeChanger: false,
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`
            }}
            onRow={(record) => ({
              onClick: () => setSelectedPart(record),
              style: {
                cursor: 'pointer',
                backgroundColor: selectedPart?.partId === record.partId ? '#eff6ff' : undefined
              }
            })}
            scroll={{ y: 380 }}
          />
        </Col>

        {/* Selected Part 3D Preview & Inspector */}
        <Col span={10}>
          {selectedPart ? (
            <Card
              size="small"
              variant="outlined"
              style={{
                backgroundColor: '#ffffff',
                borderColor: '#e2e8f0',
                borderRadius: 8
              }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text strong style={{ fontSize: 13, color: '#0f172a' }}>
                    Part #{selectedPart.partId}
                  </Text>
                  <Tag color="blue" style={{ margin: 0 }}>
                    {selectedPart.system}
                  </Tag>
                </div>
              }
            >
              {/* 3D Mini Viewport */}
              <div
                ref={previewCanvasRef}
                style={{
                  width: '100%',
                  height: 240,
                  backgroundColor: '#1e222b',
                  borderRadius: 6,
                  overflow: 'hidden',
                  marginBottom: 12
                }}
              />

              {/* Part Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div>
                  <Text type="secondary">Name: </Text>
                  <Text strong style={{ color: '#0f172a' }}>{selectedPart.name}</Text>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <Text type="secondary">Category: </Text>
                    <Text strong>{selectedPart.category}</Text>
                  </div>
                  <div>
                    <Text type="secondary">Bounding Size: </Text>
                    <Text strong style={{ fontFamily: 'monospace' }}>
                      {selectedPart.baseSize[0]} x {selectedPart.baseSize[1]} x {selectedPart.baseSize[2]}
                    </Text>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <Text type="secondary">LDU Dimensions: </Text>
                    <Text strong style={{ fontFamily: 'monospace' }}>
                      {selectedPart.baseSize[0] * 20} x {selectedPart.baseSize[1] * 20} x {selectedPart.baseSize[2] * 8} LDU
                    </Text>
                  </div>
                  <div>
                    <Text type="secondary">Normal Vector: </Text>
                    <Text strong style={{ fontFamily: 'monospace' }}>
                      [{selectedPart.targetNormal.map(n => Math.round(n * 100) / 100).join(', ')}]
                    </Text>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <Text type="secondary">Tier: </Text>
                    <Text strong>Tier {selectedPart.tier}</Text>
                  </div>
                  <div>
                    <Text type="secondary">Weight Bonus: </Text>
                    <Text strong>{selectedPart.weightBonus}</Text>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
              Select a part from the catalog to inspect in 3D
            </div>
          )}
        </Col>
      </Row>
    </Modal>
  );
};
