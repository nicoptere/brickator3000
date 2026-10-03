import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, theme, Layout, Button, Select, Upload, InputNumber, Switch, Slider, Collapse, Space, Tag, Table, Statistic, Segmented, Tooltip, Progress, Typography, message, Checkbox, Divider } from 'antd';
import { UploadOutlined, ThunderboltOutlined, StopOutlined, DownloadOutlined, ReloadOutlined, AimOutlined } from '@ant-design/icons';
import { Viewer } from './viewer.js';
import { loadModel, reorient } from './loaders.js';
import { runMethod, cancel, poolSize } from './engine.js';
import { DEFAULTS, CATALOG } from './brickgen/pipeline.js';
import { buildMesh, toGLB, toLDR, KIND_COL } from './brickgen/export.js';
import { SCHEMA } from './schema.js';
import { Field } from './fields.jsx';
import './style.css';

const { Sider, Content } = Layout;
const { Text } = Typography;
const STORE = 'brickgen.options.v2';
const loadOpts = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...DEFAULTS }; } };
const download = (data, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fmt = (v, d = 3) => (typeof v === 'number' ? +v.toFixed(d) : v);

export default function DevApp() {
  const vEl = useRef(null), viewer = useRef(null);
  const [opts, setOpts] = useState(loadOpts);
  const [models, setModels] = useState([]);
  const [modelPath, setModelPath] = useState(null);
  const [model, setModel] = useState(null);       // { name, tris, vcols }
  const [up, setUp] = useState('y');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(['', 0]);
  const [res, setRes] = useState(null);
  const [layout, setLayout] = useState('side');
  const [colorMode, setColorMode] = useState('piece');
  const [edges, setEdges] = useState(true);
  const [level, setLevel] = useState(null);
  const [hover, setHover] = useState(null);
  const [workers, setWorkers] = useState(poolSize);

  const setOpt = (k, v) => setOpts((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch {} return n; });

  useEffect(() => {
    viewer.current = new Viewer(vEl.current, { onHover: (p, e) => setHover(p ? { p, x: e.clientX, y: e.clientY } : null) });
    fetch('/api/models').then((r) => r.json()).then((d) => setModels(d.models || [])).catch(() => setModels([]));
    return () => viewer.current && viewer.current.dispose();
  }, []);

  const modelOptions = useMemo(() => {
    const g = {};
    for (const m of models) { const dir = m.path.includes('/') ? m.path.split('/').slice(0, -1).join('/') : '.'; (g[dir] = g[dir] || []).push(m); }
    return Object.keys(g).sort().map((dir) => ({ label: dir, options: g[dir].map((m) => ({ value: m.path, label: `${m.path.split('/').pop()}  (${(m.size / 1e6).toFixed(1)} MB)` })) }));
  }, [models]);

  const showSource = (m) => { setRes(null); viewer.current.clear(viewer.current.lego); viewer.current.pieces = null; viewer.current.legoBox = null;
    // preview in a normalised frame: same scale as the result (studs * 20 LDU on the reference side)
    viewer.current.setSource(m.tris, m.vcols); };

  async function openPath(p) {
    setModelPath(p);
    try {
      const buf = await (await fetch('/models/' + p)).arrayBuffer();
      const m = await loadModel(p, buf); const mm = { name: p.split('/').pop(), ...reorient(m, up) };
      setModel(mm); showSource(mm); message.success(`${mm.name}: ${(mm.tris.length / 9).toLocaleString()} triangles`);
    } catch (e) { message.error(String(e.message || e)); }
  }
  async function openFile(file) {
    try {
      const m = await loadModel(file.name, await file.arrayBuffer()); const mm = { name: file.name, ...reorient(m, up) };
      setModelPath(null); setModel(mm); showSource(mm); message.success(`${mm.name}: ${(mm.tris.length / 9).toLocaleString()} triangles`);
    } catch (e) { message.error(String(e.message || e)); }
    return false;
  }
  async function generate() {
    if (!model) return message.info('load a model first');
    setBusy(true); setStage(['starting', 0]);
    try {
      const r = await runMethod({ tris: model.tris, vcols: model.vcols }, opts, { workersWanted: workers, onStage: (s, f) => setStage([s, f]) });
      setRes(r); setLevel(null);
      viewer.current.setSource(r.srcTris, r.srcCols);
      viewer.current.colorMode = colorMode; viewer.current.showEdges = edges; viewer.current.level = Infinity;
      viewer.current.setLego(r.pieces, CATALOG); viewer.current.setLayout(layout);
      viewer.current.zoomToFit();
    } catch (e) { if (busy !== 'cancelled') message.error(String(e.message || e)); console.error(e); }
    setBusy(false);
  }
  const stop = () => { cancel(); setBusy(false); setStage(['cancelled', 0]); };

  const base = model ? model.name.replace(/\.[^.]+$/, '') + '_' + opts.studs : 'model';
  const exportLDR = () => download(toLDR(res.pieces, CATALOG, base), base + '.ldr', 'text/plain');
  const exportGLB = (mode) => { const m = buildMesh(res.pieces, CATALOG, mode); download(toGLB(m), base + (mode === 'kind' ? '_kinds' : '') + '.glb', 'model/gltf-binary'); };
  const exportJSON = () => download(JSON.stringify({ model: model.name, options: res.options, metrics: res.metrics, post: res.post, symmetry: res.symmetry, timing: res.timing, dims: res.dims, pieces: res.pieces }, null, 1), base + '_report.json', 'application/json');

  const bom = useMemo(() => {
    if (!res) return [];
    const m = new Map();
    for (const p of res.pieces) {
      const col = p.colorName || '#' + (p.rgb || [200, 200, 200]).map((v) => v.toString(16).padStart(2, '0')).join('');
      const k = p.id + '|' + col; const e = m.get(k) || { key: k, id: p.id, name: p.name, kind: p.kind, color: col, rgb: p.rgb, count: 0 }; e.count++; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [res]);
  const distinct = useMemo(() => new Set(bom.map((b) => b.id)).size, [bom]);

  const maxLevel = res ? Math.max(...res.pieces.map((p) => p.b + p.h)) : 0;
  const mt = res && res.metrics;

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#e3a83b', borderRadius: 4, fontSize: 13 } }}>
      <Layout style={{ height: '100vh' }}>
        <Sider width={380} className="side">
          <div className="brand">BRICKAGEN <b>3000</b></div>
          <div className="block">
            <Select showSearch allowClear placeholder={models.length ? `pick one of ${models.length} models` : 'no model list (upload a file)'} value={modelPath} onChange={(p) => p && openPath(p)}
              options={modelOptions} style={{ width: '100%' }} optionFilterProp="label" />
            <Space style={{ marginTop: 8 }} wrap>
              <Upload beforeUpload={openFile} showUploadList={false} accept=".glb,.gltf,.obj,.ply,.stl"><Button size="small" icon={<UploadOutlined />}>Open file</Button></Upload>
              <Tooltip title="which axis of the file points up"><Select size="small" value={up} onChange={(u) => { setUp(u); if (modelPath) setTimeout(() => openPath(modelPath)); }} style={{ width: 90 }}
                options={[['y', 'Y up'], ['z', 'Z up'], ['-z', '-Z up'], ['x', 'X up']].map(([value, label]) => ({ value, label }))} /></Tooltip>
              <Tooltip title="parallel workers for the grid-phase search"><span className="tb">workers <InputNumber size="small" min={1} max={16} value={workers} onChange={(v) => v && setWorkers(v)} style={{ width: 60 }} /></span></Tooltip>
            </Space>
            {model && <div className="meta">{model.name} · {(model.tris.length / 9).toLocaleString()} triangles</div>}
            <Space style={{ marginTop: 10, width: '100%' }}>
              {!busy ? <Button type="primary" icon={<ThunderboltOutlined />} onClick={generate} disabled={!model}>Generate</Button>
                : <Button danger icon={<StopOutlined />} onClick={stop}>Cancel</Button>}
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { localStorage.removeItem(STORE); setOpts({ ...DEFAULTS }); }}>defaults</Button>
            </Space>
            {busy && <div style={{ marginTop: 8 }}><Text type="secondary">{stage[0]}</Text><Progress percent={Math.round(stage[1] * 100)} size="small" /></div>}
          </div>
          <Collapse size="small" defaultActiveKey={['Scale & volume']} items={SCHEMA.map((g) => ({ key: g.panel, label: g.panel,
            children: g.items.map((it) => <Field key={it.key} it={it} opts={opts} setOpt={setOpt} />) }))} />
          {res && <div className="block">
            <Divider plain style={{ margin: '6px 0' }}>Export</Divider>
            <Space wrap>
              <Button size="small" icon={<DownloadOutlined />} onClick={exportLDR}>.ldr</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => exportGLB('piece')}>.glb</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => exportGLB('kind')}>.glb (kinds)</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={exportJSON}>report.json</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => { const a = document.createElement('a'); a.href = viewer.current.snapshot(); a.download = base + '.png'; a.click(); }}>.png</Button>
            </Space>
          </div>}
        </Sider>
        <Content className="main">
          <div className="viewport" ref={vEl} onPointerLeave={() => setHover(null)} />
          <div className="toolbar">
            <Segmented size="small" value={layout} onChange={(v) => { setLayout(v); viewer.current.setLayout(v); }} options={[{ value: 'side', label: 'side by side' }, { value: 'lego', label: 'LEGO' }, { value: 'source', label: 'mesh' }, { value: 'overlay', label: 'overlay' }]} />
            <Segmented size="small" value={colorMode} onChange={(v) => { setColorMode(v); viewer.current.setColorMode(v); }} options={[{ value: 'piece', label: 'colours' }, { value: 'kind', label: 'part kinds' }]} />
            <span className="tb"><Switch size="small" checked={edges} onChange={(v) => { setEdges(v); viewer.current.setEdges(v); }} /> edges</span>
            <Segmented size="small" onChange={(v) => viewer.current.view(v)} options={['iso', 'front', 'side', 'top', 'under']} value={null} />
            <Button size="small" icon={<AimOutlined />} onClick={() => viewer.current.frame()} />
            {res && <span className="tb levels">levels <Slider min={0} max={maxLevel} value={level ?? maxLevel} onChange={(v) => { setLevel(v); viewer.current.setLevel(v >= maxLevel ? Infinity : v); }} style={{ width: 220 }} /> {level ?? maxLevel}/{maxLevel}</span>}
          </div>
          {colorMode === 'kind' && res && <div className="legend">{Object.entries(mt.kinds).map(([k, c]) => <div key={k}><i style={{ background: `rgb(${KIND_COL[k].map((x) => Math.round(x * 255))})` }} />{k} {c}</div>)}</div>}
          {hover && <div className="hover" style={{ left: hover.x + 14, top: hover.y + 10 }}>
            <b>{hover.p.id}</b> {hover.p.name}<br />{hover.p.kind} · level {hover.p.b} · {hover.p.phase}{hover.p.colorName ? ' · ' + hover.p.colorName : ''}
          </div>}
          {res && <div className="stats">
            <div className="row">
              <Statistic title="pieces" value={mt.pieces} /><Statistic title="distinct parts" value={distinct} />
              <Statistic title="volume IoU" value={fmt(mt.iou)} /><Statistic title="recall" value={fmt(mt.recall)} /><Statistic title="overfill" value={fmt(mt.overfill)} />
              <Statistic title="grounded" value={fmt(mt.grounded)} /><Statistic title="components" value={mt.components} />
              <Statistic title="grid (studs x studs x plates)" value={res.dims.join(' x ')} />
              <Statistic title="time" value={(res.timing.total / 1000).toFixed(1) + ' s'} />
            </div>
            <div className="tags">
              {Object.entries(mt.kinds).map(([k, c]) => <Tag key={k} style={{ background: `rgb(${KIND_COL[k].map((x) => Math.round(x * 255))})`, color: '#111', border: 0 }}>{k} {c}</Tag>)}
              {res.symmetry && <Tag>{res.symmetry.used ? `mirror ${res.symmetry.axis}, ${res.symmetry.parity} width, ${Math.round(100 * (res.symmetry.mirrored || 0))}% mirrored` : `not symmetric (${res.symmetry.err.toFixed(4)})`}</Tag>}
              <Tag>braces {res.post.brace ?? 0}</Tag><Tag>support columns {res.post.supports ?? 0}</Tag><Tag>merged {res.post.merged}</Tag>
              <Tag>phase job {res.job.join(' / ')}</Tag><Tag>{res.workers} workers</Tag>
            </div>
            <Table size="small" pagination={{ pageSize: 8, size: 'small' }} dataSource={bom} columns={[
              { title: 'part', dataIndex: 'id', width: 70 }, { title: 'name', dataIndex: 'name' }, { title: 'kind', dataIndex: 'kind', width: 70 },
              { title: 'colour', dataIndex: 'color', width: 150, render: (c, r) => <span><i className="sw" style={{ background: `rgb(${r.rgb})` }} />{c}</span> },
              { title: 'qty', dataIndex: 'count', width: 60, sorter: (a, b) => a.count - b.count, defaultSortOrder: 'descend' }]} />
          </div>}
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
