// Studio: the layout and the look of the original app (full-screen dark stage, floating white card with collapsible sections,
// results card, step scrubber, instanced cell-shaded bricks, HUD) driven by the brickgen JS engine.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, App as AntApp, Select, Input, Button, Upload, Typography, Tag, Divider, Slider, Radio, Checkbox, Progress, Drawer, Modal, Table, Tooltip, Switch, Tabs, Collapse, Alert, Tree, theme as antTheme } from 'antd';
import { UploadOutlined, SearchOutlined, ThunderboltOutlined, DownloadOutlined, EyeOutlined, CheckCircleOutlined, AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  DownOutlined, RightOutlined, CaretRightOutlined, PauseOutlined, StepBackwardOutlined, StepForwardOutlined, SoundOutlined, AudioMutedOutlined, AimOutlined,
  SettingOutlined, StopOutlined, CameraOutlined, SyncOutlined, ReloadOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import './studio.css';
import { StudioViewport } from './studio/viewport3d.js';
import { sfx } from './studio/sfx.js';
import { loadModel, reorient } from './loaders.js';
import { runMethod, cancel, poolSize } from './engine.js';
import { DEFAULTS, CATALOG } from './brickgen/pipeline.js';
import { buildMesh, toGLB, toLDR, KIND_COL } from './brickgen/export.js';
import { SCHEMA } from './schema.js';
import { Field } from './fields.jsx';

const { Text, Title } = Typography;
const STORE = 'brickgen.studio.v1';
const loadOpts = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...DEFAULTS }; } };
const download = (data, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fmt = (v, d = 3) => (typeof v === 'number' ? +v.toFixed(d) : v);
const kindRgb = (k) => `rgb(${(KIND_COL[k] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255))})`;

function Section({ title, open, setOpen, color = 'var(--tx)', children }) {
  return (
    <div>
      <div className="sec-h" onClick={() => { sfx.click(); setOpen(!open); }}>
        <Text strong style={{ fontSize: 12, color }}>{title}</Text>
        {open ? <DownOutlined /> : <RightOutlined />}
      </div>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>{children}</div>}
    </div>
  );
}

// quick toggles shown in the card (everything else is in the "all parameters" drawer)
const QUICK = [
  ['rounds', 'Round parts / poles'], ['skin', 'Slopes, curves, cheese'], ['inverted', 'Inverted slopes'], ['technic', 'Technic bricks'],
  ['symmetry', 'Mirror symmetry', (o) => o.symmetry !== 'off', (o, v) => ({ symmetry: v ? 'auto' : 'off' })],
  ['crust', 'Hollow core (crust only)'],
  ['islands', 'Join islands (MST tubes)'], ['bracing', 'Bracing / thickening'], ['splice', 'Splice seams'], ['bridge', 'Bridge gaps'],
  ['supports', 'Support columns'], ['groundSupports', 'Allow ground contact'],
  ['finish', 'Flat tiles on top (finish)'],
  ['palette', 'Snap to LEGO colours', (o) => o.palette === 'lego', (o, v) => ({ palette: v ? 'lego' : 'cheat' })],
];

function StudioInner() {
  const { message } = AntApp.useApp();
  const vEl = useRef(null), vp = useRef(null);
  const [opts, setOpts] = useState(loadOpts);
  const [models, setModels] = useState([]);
  const [cat, setCat] = useState(null), [query, setQuery] = useState(''), [modelPath, setModelPath] = useState(null);
  const [model, setModel] = useState(null), [up, setUp] = useState('y');
  const [busy, setBusy] = useState(false), [stage, setStage] = useState(['', 0]);
  const [res, setRes] = useState(null);
  const [viewMode, setViewMode] = useState('mesh'), [colorMode, setColorMode] = useState('piece'), [outline, setOutline] = useState(true);
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [autoBuild, setAutoBuild] = useState(true);
  const [sound, setSound] = useState(sfx.on), [rotate, setRotate] = useState(false);
  const [hover, setHover] = useState(null);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('brickgen.theme') !== 'light'; } catch { return true; } });
  const [thick, setThick] = useState(2.5), [expanded, setExpanded] = useState([]);
  const [workers, setWorkers] = useState(poolSize);
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true);
  const [openSrc, setOpenSrc] = useState(true), [openCfg, setOpenCfg] = useState(true), [openRes, setOpenRes] = useState(true), [openRender, setOpenRender] = useState(true), [openReplay, setOpenReplay] = useState(true), [openExport, setOpenExport] = useState(true);
  const [advanced, setAdvanced] = useState(false), [partsOpen, setPartsOpen] = useState(false);
  useEffect(() => { vp.current && vp.current.setTheme(dark); }, [dark]);
  const stepRef = useRef(0); stepRef.current = step;

  const setOpt = (k, v) => setOpts((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch {} return n; });
  const patchOpts = (p) => setOpts((o) => { const n = { ...o, ...p }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch {} return n; });

  useEffect(() => {
    vp.current = new StudioViewport(vEl.current, { onHover: (p, e) => setHover(p ? { p, x: e.clientX, y: e.clientY } : null) });
    vp.current.setTheme(dark);
    fetch('/api/models').then((r) => r.json()).then((d) => setModels((d.models || []).sort((a, b) => a.path.localeCompare(b.path)))).catch(() => setModels([]));
    return () => vp.current && vp.current.dispose();
  }, []);

  const cats = useMemo(() => {
    const g = new Map();
    for (const m of models) { const dir = m.path.includes('/') ? m.path.split('/').slice(0, -1).join('/') : '.'; if (!g.has(dir)) g.set(dir, []); g.get(dir).push(m); }
    return g;
  }, [models]);
  const catOptions = useMemo(() => [...cats].map(([k, v]) => ({ value: k, label: `${k.replace(/^clean\//, '')} (${v.length})` })), [cats]);
  const modelOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cat ? cats.get(cat) || [] : models).filter((m) => !q || m.path.toLowerCase().includes(q))
      .map((m) => ({ value: m.path, label: `${m.path.split('/').pop()}  ·  ${(m.size / 1e6).toFixed(1)} MB` }));
  }, [cats, cat, models, query]);

  const showModel = (mm) => {
    setRes(null); setPlaying(false); setStep(0); setViewMode('mesh'); sfx.click();
    vp.current.setSource(mm.tris, mm.vcols, { raw: true }); vp.current.setMode('mesh');
  };
  const openPath = useCallback(async (p, upAxis = up) => {
    setModelPath(p);
    try {
      const buf = await (await fetch('/models/' + p)).arrayBuffer();
      const m = await loadModel(p, buf), mm = { name: p.split('/').pop(), ...reorient(m, upAxis) };
      setModel(mm); showModel(mm);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); }
  }, [up]); // eslint-disable-line
  async function openFile(file) {
    try {
      const m = await loadModel(file.name, await file.arrayBuffer()), mm = { name: file.name, ...reorient(m, up) };
      setModelPath(null); setModel(mm); showModel(mm); message.success(`Loaded ${file.name}`);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); }
    return false;
  }
  const urlq = useMemo(() => new URLSearchParams((location.hash.split('?')[1]) || ''), []);   // #/?model=clean/airplanes/bf110g2.glb&studs=24&run=1&opt=finish:true,technic:true
  useEffect(() => {                                    // default model once the list is there
    if (!models.length || model) return;
    const q = urlq.get('model'), pick = (q && models.find((m) => m.path.includes(q))) || models.find((m) => /duck/i.test(m.path)) || models.find((m) => /tlamp1|rosewood/.test(m.path)) || models[0];
    setCat(pick.path.split('/').slice(0, -1).join('/') || null); openPath(pick.path);
    if (urlq.get('studs')) setOpt('studs', +urlq.get('studs'));
    for (const kv of (urlq.get('opt') || '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); setOpt(k, v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v); }
  }, [models]); // eslint-disable-line
  useEffect(() => { if (model && urlq.get('run') && !res && !busy && !window.__ran) { window.__ran = true; setTimeout(generate, 300); } }, [model]); // eslint-disable-line

  const maxLevel = res ? Math.max(...res.pieces.map((p) => p.b + p.h)) : 0;
  const goStep = useCallback((v, animate = true) => {
    const t = Math.max(0, Math.min(maxLevelRef.current, v)); setStep(t);
    const n = vp.current.setLevel(t >= maxLevelRef.current ? Infinity : t, animate);
    if (animate && n) sfx.place(t, maxLevelRef.current);
  }, []);
  const maxLevelRef = useRef(0); maxLevelRef.current = maxLevel;

  // build animation / playback
  useEffect(() => {
    if (!playing || !res) return;
    const ms = Math.max(40, Math.min(240, 3600 / Math.max(1, maxLevel))) / speed;
    const id = setInterval(() => {
      const next = stepRef.current + 1;
      if (next >= maxLevelRef.current) { goStep(maxLevelRef.current); setPlaying(false); sfx.done(); clearInterval(id); return; }
      goStep(next);
    }, ms);
    return () => clearInterval(id);
  }, [playing, speed, res, maxLevel, goStep]);

  async function generate() {
    if (!model) return message.info('Load a model first');
    sfx.start(); setBusy(true); setPlaying(false); setStage(['Preparing', 0]);
    try {
      const r = await runMethod({ tris: model.tris, vcols: model.vcols }, opts, { workersWanted: workers, onStage: (s, f) => setStage([s, f]) });
      setRes(r);
      vp.current.setSource(r.srcTris, r.srcCols); vp.current.setLego(r.pieces, CATALOG, r.dims); vp.current.setColorMode(colorMode); vp.current.setOutline(outline);
      setViewMode('lego'); vp.current.setMode('lego');
      const lv = Math.max(...r.pieces.map((p) => p.b + p.h)); maxLevelRef.current = lv;
      const g = r.metrics.grounded >= 0.9995;
      message.success(`${r.metrics.pieces} pieces in ${(r.timing.total / 1000).toFixed(1)} s${g ? ', one grounded piece of work' : ''}`);
      if (autoBuild) { vp.current.setLevel(0, false); setStep(0); setTimeout(() => setPlaying(true), 250); } else { setStep(lv); sfx.done(); }
    } catch (e) { if (!/terminated|cancel/i.test(String(e))) { sfx.error(); message.error(String(e.message || e)); } console.error(e); }
    setBusy(false);
  }
  const stop = () => { cancel(); setBusy(false); setStage(['', 0]); sfx.click(); };

  const base = model ? model.name.replace(/\.[^.]+$/, '') + '_' + opts.studs : 'model';
  const exportLDR = () => download(toLDR(res.pieces, CATALOG, base), base + '.ldr', 'text/plain');
  const exportGLB = (mode) => { const m = buildMesh(res.pieces, CATALOG, mode); download(toGLB(m), base + (mode === 'kind' ? '_kinds' : '') + '.glb', 'model/gltf-binary'); };
  const exportJSON = () => download(JSON.stringify({ model: model.name, options: res.options, metrics: res.metrics, post: res.post, islands: res.islands, symmetry: res.symmetry, timing: res.timing, dims: res.dims, pieces: res.pieces }, null, 1), base + '_report.json', 'application/json');
  const png = () => { const a = document.createElement('a'); a.href = vp.current.snapshot(); a.download = base + '.png'; a.click(); };

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
  const levelInfo = useMemo(() => {
    if (!res || step <= 0) return null;
    const lv = Math.min(step, maxLevel) - 1, k = {}; let n = 0;
    for (const p of res.pieces) if (p.b === lv) { n++; k[p.kind] = (k[p.kind] || 0) + 1; }
    return { n, k };
  }, [res, step, maxLevel]);
  const bbox = useMemo(() => {
    if (!model) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], t = model.tris;
    for (let k = 0; k < t.length; k += 3) for (let a = 0; a < 3; a++) { if (t[k + a] < lo[a]) lo[a] = t[k + a]; if (t[k + a] > hi[a]) hi[a] = t[k + a]; }
    return [0, 1, 2].map((a) => hi[a] - lo[a]);
  }, [model]);
  const mt = res && res.metrics;

  const LW = 360, RW = 330;
  const toggleTheme = () => { const v = !dark; setDark(v); try { localStorage.setItem('brickgen.theme', v ? 'dark' : 'light'); } catch {} window.dispatchEvent(new Event('brickgen-theme')); sfx.click(); };

  const modelTree = useMemo(() => {
    const q = query.trim().toLowerCase(), root = { children: new Map() };
    for (const m of models) {
      if (q && !m.path.toLowerCase().includes(q)) continue;
      const parts = m.path.split('/'); let n = root;
      parts.forEach((part, i) => {
        if (!n.children.has(part)) n.children.set(part, { key: parts.slice(0, i + 1).join('/'), part, leaf: i === parts.length - 1, size: m.size, children: new Map() });
        n = n.children.get(part);
      });
    }
    const conv = (n) => [...n.children.values()].sort((a, b) => (a.leaf - b.leaf) || a.part.localeCompare(b.part)).map((c) => (c.leaf
      ? { key: c.key, isLeaf: true, title: <span className="tl">{c.part.replace(/\.[^.]+$/, '')}<i>{(c.size / 1e6).toFixed(1)} MB</i></span> }
      : { key: c.key, title: c.part, children: conv(c) }));
    const t = conv(root); return t.length === 1 && !t[0].isLeaf && t[0].key === 'clean' ? t[0].children : t;   // the "clean" wrapper adds nothing
  }, [models, query]);
  const allDirs = useMemo(() => { const s = new Set(); for (const m of models) { const p = m.path.split('/'); for (let i = 1; i < p.length; i++) s.add(p.slice(0, i).join('/')); } return [...s]; }, [models]);

  const replay = res && (
    <div className="replay">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <Tag color={step >= maxLevel ? 'success' : 'processing'} style={{ margin: 0, fontWeight: 600 }}>{step >= maxLevel ? 'COMPLETE' : 'BUILDING'}</Tag>
        <Tag color="blue" style={{ margin: 0 }}>Level {step}/{maxLevel}</Tag>
      </div>
      <Slider tooltip={{ open: false }} min={0} max={maxLevel} value={step} onChange={(v) => { setPlaying(false); goStep(v, Math.abs(v - stepRef.current) <= 2); }} style={{ margin: '4px 6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Button size="small" icon={<StepBackwardOutlined />} onClick={() => { setPlaying(false); goStep(step - 1); }} />
        <Button size="small" type="primary" style={{ minWidth: 74 }} icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
          onClick={() => { sfx.click(); if (!playing && step >= maxLevel) { vp.current.setLevel(0, false); setStep(0); } setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</Button>
        <Button size="small" icon={<StepForwardOutlined />} onClick={() => { setPlaying(false); goStep(step + 1); }} />
        <Select size="small" value={speed} onChange={setSpeed} style={{ width: 74 }} options={[0.5, 1, 2, 4].map((v) => ({ value: v, label: v + 'x' }))} />
      </div>
      <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
        {levelInfo ? `layer ${Math.min(step, maxLevel)}: ${levelInfo.n ? `${levelInfo.n} new (${Object.entries(levelInfo.k).map(([k, c]) => `${k} ${c}`).join(', ')})` : 'pieces from lower layers only'}` : 'empty baseplate'}
      </Text>
    </div>
  );

  return (
    <div className={'studio ' + (dark ? 'dark' : 'light')}>
      <div className="vp" ref={vEl} style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }} onPointerLeave={() => setHover(null)} />

      {/* ---------------------------------------------------------------- left drawer */}
      <aside className={'dock left' + (leftOpen ? '' : ' closed')} style={{ width: LW }}>
        <Tooltip title={leftOpen ? 'Hide panel' : 'Show panel'} placement="right"><Button className="handle" size="small" icon={leftOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={() => { sfx.click(); setLeftOpen(!leftOpen); }} /></Tooltip>
        <div className="dock-h">
          <Title level={4} style={{ margin: 0, fontWeight: 700, letterSpacing: 1.5 }}>BRICKAGEN 3000</Title>
          <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={() => { sfx.click(); setPartsOpen(true); }}>Parts</Button>
        </div>
        <div className="dock-b">
          <Section title="1. Model source" open={openSrc} setOpen={setOpenSrc}>
            <Input size="small" allowClear placeholder="search models" prefix={<SearchOutlined style={{ color: '#94a3b8' }} />} value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="tree">
              <Tree blockNode showLine={false} treeData={modelTree} selectedKeys={modelPath ? [modelPath] : []} expandedKeys={expanded.length || query ? (query ? allDirs : expanded) : []}
                onExpand={setExpanded} onSelect={(k, { node }) => { if (node.isLeaf) { sfx.click(); openPath(node.key); } }}
                switcherIcon={<DownOutlined />} />
              {!models.length && <Text type="secondary" style={{ fontSize: 12 }}>no model list: open a file</Text>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Upload beforeUpload={openFile} showUploadList={false} accept=".glb,.gltf,.obj,.ply,.stl" style={{ flex: 1 }}>
                <Button size="small" icon={<UploadOutlined />}>Open file (glb, obj, ply, stl)</Button>
              </Upload>
              <Tooltip title="which axis of the file points up"><Select size="small" value={up} onChange={(u) => { setUp(u); if (modelPath) openPath(modelPath, u); }} style={{ width: 86 }}
                options={[['y', 'Y up'], ['z', 'Z up'], ['-z', '-Z up'], ['x', 'X up']].map(([value, label]) => ({ value, label }))} /></Tooltip>
            </div>
            {model && (
              <div className="card-soft">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <Text strong style={{ fontSize: 12 }} ellipsis>{model.name}</Text>
                  <span>{model.hasColor && <Tag color="magenta" style={{ margin: 0, fontSize: 10 }}>vertex colours</Tag>}</span>
                </div>
                <div className="grid2">
                  <div><Text type="secondary">Triangles: </Text><Text strong>{(model.tris.length / 9).toLocaleString()}</Text></div>
                  {bbox && <div><Text type="secondary">Size: </Text><Text strong>{bbox.map((v) => +v.toPrecision(3)).join(' x ')}</Text></div>}
                </div>
              </div>
            )}
          </Section>
          <Divider style={{ margin: '4px 0' }} />

          <Section title="2. Discretization" open={openCfg} setOpen={setOpenCfg}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: 500 }}>Resolution: {opts.studs} studs</Text>
              <Select size="small" value={opts.ref} onChange={(v) => setOpt('ref', v)} style={{ width: 150 }}
                options={[{ value: 'min3', label: 'on the smallest side' }, { value: 'maxh', label: 'on the longest side' }]} />
            </div>
            <Slider min={4} max={96} step={1} value={opts.studs} onChange={(v) => setOpt('studs', v)} marks={{ 8: '8', 16: '16', 32: '32', 64: '64' }} style={{ margin: '0 6px 14px 6px' }} />
            <div className="grid2">
              {QUICK.map(([k, label, get, set]) => (
                <Checkbox key={k} checked={get ? get(opts) : !!opts[k]} onChange={(e) => (set ? patchOpts(set(opts, e.target.checked)) : setOpt(k, e.target.checked))}>{label}</Checkbox>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setAdvanced(true)} style={{ padding: 0, fontSize: 12 }}>All parameters…</Button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--tx2)' }}>
                workers <Input size="small" type="number" min={1} max={16} value={workers} onChange={(e) => e.target.value && setWorkers(+e.target.value)} style={{ width: 52 }} />
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => { localStorage.removeItem(STORE); setOpts({ ...DEFAULTS }); }}>defaults</Button>
              </div>
            </div>
            {!busy ? (
              <Button type="primary" icon={<ThunderboltOutlined />} disabled={!model} onClick={generate} style={{ width: '100%', height: 36, fontWeight: 600 }}>Discretize</Button>
            ) : (
              <Button danger icon={<StopOutlined />} onClick={stop} style={{ width: '100%', height: 36 }}>Cancel</Button>
            )}
            {busy && (
              <div style={{ marginTop: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tx2)' }}><span>{stage[0]}</span><span>{Math.round(stage[1] * 100)}%</span></div>
                <Progress percent={Math.round(stage[1] * 100)} showInfo={false} size="small" />
              </div>
            )}
          </Section>

          {res && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <Section title="Results" open={openRes} setOpen={setOpenRes}>
                <div className="result">
                  <div>
                    {mt.grounded >= 0.9995 && mt.components === 1
                      ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0, fontSize: 11 }}>1 piece of work, 100% grounded</Tag>
                      : <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>{Math.round(mt.grounded * 100)}% grounded · {mt.components} parts</Tag>}
                  </div>
                  <div className="grid2" style={{ fontSize: 12 }}>
                    <div className="kv"><span>Pieces:</span><b>{mt.pieces.toLocaleString()}</b></div>
                    <div className="kv"><span>Part types:</span><b>{distinct}</b></div>
                    <div className="kv"><span>Volume IoU:</span><b>{fmt(mt.iou, 3)}</b></div>
                    <div className="kv"><span>Recall:</span><b>{fmt(mt.recall, 3)}</b></div>
                    <div className="kv"><span>Overfill:</span><b>{fmt(mt.overfill, 3)}</b></div>
                    <div className="kv"><span>Execution:</span><b>{(res.timing.total / 1000).toFixed(1)} s</b></div>
                    <div className="kv" style={{ gridColumn: '1 / 3' }}><span>Grid:</span><b>{res.dims[0]} x {res.dims[1]} studs, {res.dims[2]} plates</b></div>
                  </div>
                  <div>
                    {Object.entries(mt.kinds).map(([k, c]) => <Tag key={k} style={{ background: kindRgb(k), color: '#111', border: 0, fontSize: 10 }}>{k} {c}</Tag>)}
                    {res.symmetry && <Tag style={{ fontSize: 10 }}>{res.symmetry.used ? `mirror ${res.symmetry.axis} · ${res.symmetry.parity} · ${Math.round(100 * (res.symmetry.mirrored || 0))}%` : 'no symmetry'}</Tag>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--tx2)' }}>
                    Connectivity: {res.islands ? <>islands {res.islands.islands} (dropped {res.islands.dropped}, tubes {res.islands.tubes}) · </> : null}
                    braces {res.post.brace ?? 0} · splices {res.post.splice ?? 0} · bridges {res.post.bridge ?? 0} · columns {res.post.supports ?? 0}{res.post.finish ? ` · tiles ${res.post.finish.platesToTiles + res.post.finish.bricksCapped}` : ''}
                    {res.crust ? ` · crust ${Math.round(100 * res.crust.frac)}% hollowed` : ''}
                  </div>
                </div>
              </Section>
            </>
          )}
          <div style={{ fontSize: 10, color: 'var(--tx2)', textAlign: 'right' }}><a href="#/dev">dev UI</a></div>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- right drawer: rendering, replay, export */}
      <aside className={'dock right' + (rightOpen ? '' : ' closed')} style={{ width: RW }}>
        <Tooltip title={rightOpen ? 'Hide panel' : 'Show panel'} placement="left"><Button className="handle" size="small" icon={rightOpen ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { sfx.click(); setRightOpen(!rightOpen); }} /></Tooltip>
        <div className="dock-h"><Title level={5} style={{ margin: 0, fontWeight: 600 }}>Render &amp; export</Title></div>
        <div className="dock-b">
          <Section title="Rendering" open={openRender} setOpen={setOpenRender}>
            <Text style={{ fontSize: 11, color: 'var(--tx2)' }}>Display</Text>
            <Radio.Group size="small" value={viewMode} onChange={(e) => { sfx.click(); setViewMode(e.target.value); vp.current.setMode(e.target.value); }} style={{ display: 'flex', width: '100%' }}>
              {[['mesh', 'Mesh'], ['lego', 'LEGO'], ['both', 'Overlay'], ['split', 'Split']].map(([v, l]) => <Radio.Button key={v} value={v} style={{ flex: 1, textAlign: 'center' }}>{l}</Radio.Button>)}
            </Radio.Group>
            <Text style={{ fontSize: 11, color: 'var(--tx2)' }}>Colours</Text>
            <Radio.Group size="small" value={colorMode} onChange={(e) => { sfx.click(); setColorMode(e.target.value); vp.current.setColorMode(e.target.value); }} style={{ display: 'flex', width: '100%' }}>
              <Radio.Button value="piece" style={{ flex: 1, textAlign: 'center' }}>Model colours</Radio.Button>
              <Radio.Button value="kind" style={{ flex: 1, textAlign: 'center' }}>Part kinds</Radio.Button>
            </Radio.Group>
            <div className="row"><span>Ink outline</span><Switch size="small" checked={outline} onChange={(v) => { setOutline(v); vp.current.setOutline(v); }} /></div>
            <div className="row"><span>Outline thickness</span><Slider min={0.5} max={4} step={0.25} value={thick} onChange={(v) => { setThick(v); vp.current.setHullThickness(v); }} style={{ width: 120, margin: 0 }} /></div>
            <div className="row"><span>Animate the build</span><Switch size="small" checked={autoBuild} onChange={setAutoBuild} /></div>
          </Section>
          {res && (<><Divider style={{ margin: '4px 0' }} />
            <Section title="Replay" open={openReplay} setOpen={setOpenReplay}>{replay}</Section></>)}
          <Divider style={{ margin: '4px 0' }} />
          <Section title="Export" open={openExport} setOpen={setOpenExport}>
            {!res && <Text type="secondary" style={{ fontSize: 12 }}>Discretize a model to export it.</Text>}
            <div className="exports">
              <Button size="small" type="primary" icon={<DownloadOutlined />} disabled={!res} onClick={exportLDR}>.ldr (LDraw)</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={() => exportGLB('piece')}>.glb</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={() => exportGLB('kind')}>.glb by kind</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={exportJSON}>report .json</Button>
              <Button size="small" icon={<CameraOutlined />} disabled={!model} onClick={png}>snapshot .png</Button>
              <Button size="small" icon={<AppstoreOutlined />} onClick={() => { sfx.click(); setPartsOpen(true); }}>Parts list</Button>
            </div>
          </Section>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- toolbar */}
      <div className="toolbar" style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }}>
        <div className="tools">
          <Tooltip title={sound ? 'Sound on' : 'Sound off'}><Button size="small" type="text" icon={sound ? <SoundOutlined /> : <AudioMutedOutlined />} onClick={() => { const v = !sound; setSound(v); sfx.setOn(v); }} /></Tooltip>
          <Tooltip title="Auto-rotate"><Button size="small" type={rotate ? 'primary' : 'text'} icon={<SyncOutlined />} onClick={() => { setRotate(!rotate); vp.current.setAutoRotate(!rotate); }} /></Tooltip>
          <Tooltip title="Centre view"><Button size="small" type="text" icon={<AimOutlined />} onClick={() => vp.current.frame()} /></Tooltip>
          <Tooltip title="Snapshot"><Button size="small" type="text" icon={<CameraOutlined />} onClick={png} disabled={!model} /></Tooltip>
          <Tooltip title={dark ? 'Light theme' : 'Dark theme'}><Button size="small" type="text" icon={dark ? <BulbOutlined /> : <BulbFilled />} onClick={toggleTheme} /></Tooltip>
        </div>
      </div>

      {busy && <div className="busy" style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }}><div className="chip"><div className="spinner" /><span>{stage[0]}</span><div className="pulse" /></div></div>}

      {res && colorMode === 'kind' && <div className="legend" style={{ left: (leftOpen ? LW : 0) + 16 }}>{Object.entries(mt.kinds).map(([k, c]) => <span key={k}><i style={{ background: kindRgb(k) }} />{k} {c}</span>)}</div>}

      {hover && <div className="hover" style={{ left: hover.x + 14, top: hover.y + 10 }}><b>{hover.p.id}</b> {hover.p.name}<br />{hover.p.kind} · level {hover.p.b} · {hover.p.phase}{hover.p.colorName ? ' · ' + hover.p.colorName : ''}</div>}

      <Drawer title="All parameters" open={advanced} onClose={() => setAdvanced(false)} size={440} className="adv">
        <Collapse size="small" defaultActiveKey={['Scale & volume']} items={SCHEMA.map((g) => ({ key: g.panel, label: g.panel, children: g.items.map((it) => <Field key={it.key} it={it} opts={opts} setOpt={setOpt} />) }))} />
      </Drawer>

      <Modal title="Parts" open={partsOpen} onCancel={() => setPartsOpen(false)} footer={null} width={760}>
        <Tabs items={[
          { key: 'bom', label: `Bill of materials${res ? ` (${mt.pieces})` : ''}`, children: res ? (
            <Table size="small" pagination={{ pageSize: 10, size: 'small' }} dataSource={bom} columns={[
              { title: 'part', dataIndex: 'id', width: 80 }, { title: 'name', dataIndex: 'name' }, { title: 'kind', dataIndex: 'kind', width: 80 },
              { title: 'colour', dataIndex: 'color', width: 160, render: (c, r) => <span><i className="sw" style={{ background: `rgb(${r.rgb})` }} />{c}</span> },
              { title: 'qty', dataIndex: 'count', width: 70, sorter: (a, b) => a.count - b.count, defaultSortOrder: 'descend' }]} />
          ) : <Alert message="Discretize a model first" type="info" /> },
          { key: 'cat', label: `Catalogue (${CATALOG.length} parts)`, children: (
            <Table size="small" pagination={{ pageSize: 10, size: 'small' }} dataSource={CATALOG.map((c) => ({ key: c.id, id: c.id, name: c.name, kind: c.kind, size: `${c.w} x ${c.d} x ${c.h}`, studs: (c.stud_cells || []).length }))} columns={[
              { title: 'part', dataIndex: 'id', width: 90 }, { title: 'name', dataIndex: 'name' },
              { title: 'kind', dataIndex: 'kind', width: 90, filters: [...new Set(CATALOG.map((c) => c.kind))].map((k) => ({ text: k, value: k })), onFilter: (v, r) => r.kind === v },
              { title: 'size (studs x studs x plates)', dataIndex: 'size', width: 190 }, { title: 'studs', dataIndex: 'studs', width: 70 }]} />
          ) },
        ]} />
      </Modal>
    </div>
  );
}

export default function StudioApp() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('brickgen.theme') !== 'light'; } catch { return true; } });
  useEffect(() => { const f = () => { try { setDark(localStorage.getItem('brickgen.theme') !== 'light'); } catch {} }; window.addEventListener('brickgen-theme', f); return () => window.removeEventListener('brickgen-theme', f); }, []);
  return (
    <ConfigProvider theme={{ algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm, token: { colorPrimary: '#2563eb', borderRadius: 6 } }}>
      <AntApp><StudioInner /></AntApp>
    </ConfigProvider>
  );
}
