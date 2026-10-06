// Studio: the layout and the look of the original app (full-screen dark stage, floating white card with collapsible sections,
// results card, step scrubber, instanced cell-shaded bricks, HUD) driven by the brickgen JS engine.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, App as AntApp, Select, Input, Button, Upload, Typography, Tag, Divider, Slider, Radio, Checkbox, Progress, Drawer, Modal, Table, Tooltip, Switch, Tabs, Collapse, Alert, Tree, Segmented, theme as antTheme } from 'antd';
import { UploadOutlined, SearchOutlined, ThunderboltOutlined, DownloadOutlined, EyeOutlined, CheckCircleOutlined, AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  DownOutlined, RightOutlined, CaretRightOutlined, PauseOutlined, StepBackwardOutlined, StepForwardOutlined, SoundOutlined, AudioMutedOutlined, AimOutlined,
  SettingOutlined, StopOutlined, CameraOutlined, SyncOutlined, ReloadOutlined, BulbOutlined, BulbFilled, DeleteOutlined, UndoOutlined, CloseOutlined, ScissorOutlined, ExperimentOutlined, ReadOutlined, SelectOutlined, ClearOutlined, SwapOutlined } from '@ant-design/icons';
import './studio.css';
import { StudioViewport } from './studio/viewport3d.js';
import { sfx } from './studio/sfx.js';
import { fixWinding, meshIslands, islandColors, islandPalette } from './studio/meshtools.js';
import { loadModel, reorient } from './loaders.js';
import { fetchModelList, fetchModelBuffer } from './modelSource.js';
import { runMethod, cancel, chooseStuds, rebuildRegion, poolSize } from './engine.js';
import { DEFAULTS, CATALOG, FULL_CATALOG, catalogFor } from './brickgen/pipeline.js';
import { buildMesh, toGLB, toLDR, KIND_COL } from './brickgen/export.js';
import { snapToPalette } from './brickgen/colors.js';
import { shootBooklet } from './studio/booklet.js';
import { boxOf } from './brickgen/region.js';
import { SCHEMA } from './schema.js';
import { FEATURES, FEATURE_GROUPS, featureState, featurePatch } from './presets.js';
import { Field } from './fields.jsx';

const { Text, Title } = Typography;
const STORE = 'brickgen.studio.v6';
const loadOpts = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...DEFAULTS }; } };
const download = (data, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const fmt = (v, d = 3) => (typeof v === 'number' ? +v.toFixed(d) : v);
const kindRgb = (k) => `rgb(${(KIND_COL[k] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255))})`;

function EraserIcon() {
  return (
    <span className="anticon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
        <path d="M22 21H7" />
        <path d="m5 11 9 9" />
      </svg>
    </span>
  );
}

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
// the panel-2 switches: the high-level feature groups (presets.js) a model's look actually depends on. Everything else -
// every individual option behind them - is in the "All parameters" drawer, which shows the same groups at the top.
const SOURCE_FEATURES = ['symmetry'].map((k) => FEATURES.find((f) => f.key === k));   // a property of the mesh, so it sits with the model
const PANEL_FEATURES = ['discs', 'curves', 'weld', 'motifs', 'snot', 'crust', 'connect', 'supports', 'finish'];
const STUDIO_FEATURES = PANEL_FEATURES.map((k) => FEATURES.find((f) => f.key === k)).filter(Boolean);
// the kinds of the measured LDraw shapes (catalog_shapes.js) that `shapeSolo` can let compete as single parts
const SHAPE_KINDS = [['round', 'round plates, discs, cones'], ['curved', 'curved tops'], ['shaped', 'arches, panels, wedges'],
  ['tile', 'corner and round tiles'], ['inverted', 'inverted slopes'], ['brick', 'shaped bricks']];

/** one high-level feature: a switch that writes the handful of options it owns, and says so when they have been changed by hand */
function FeatureRow({ f, opts, patch }) {
  const st = featureState(opts, f);
  return (
    <Tooltip title={f.help} placement="left">
      <div className={'feat' + (st === 'custom' ? ' custom' : '')}>
        <span>{f.label}{st === 'custom' && <i title="some of its parameters were changed by hand">edited</i>}</span>
        <Switch size="small" checked={st !== 'off'} onChange={(v) => patch(featurePatch(f, v))} />
      </div>
    </Tooltip>
  );
}

function StudioInner() {
  const { notification } = AntApp.useApp();
  const message = useMemo(() => {                                    // toasts: antd notifications, anchored bottom-centre
    const t = (type) => (content) => notification[type]({ title: content, placement: 'bottom', duration: type === 'error' ? 6 : 3, showProgress: false });
    return { info: t('info'), success: t('success'), error: t('error'), warning: t('warning') };
  }, [notification]);
  const vEl = useRef(null), vp = useRef(null);
  const [opts, setOpts] = useState(loadOpts);
  const [models, setModels] = useState([]);
  const [cat, setCat] = useState(null), [query, setQuery] = useState(''), [modelPath, setModelPath] = useState(null);
  const [model, setModel] = useState(null), [up, setUp] = useState('y');
  const [isl, setIsl] = useState(null), [smooth, setSmooth] = useState(true), [busy, setBusy] = useState(false), [stage, setStage] = useState(['', 0]);
  const [res, setRes] = useState(null);
  const [officialColors, setOfficialColors] = useState(true);
  const [viewMode, setViewMode] = useState('mesh'), [colorMode, setColorMode] = useState('piece'), [outline, setOutline] = useState(true);
  const [selectedIsland, setSelectedIsland] = useState(null);
  const [history, setHistory] = useState([]);
  const [detectIslands, setDetectIslands] = useState(false);
  const detectIslandsRef = useRef(false);
  detectIslandsRef.current = detectIslands;
  const [eraserMode, setEraserMode] = useState(false);
  const [pieceHistory, setPieceHistory] = useState([]);
  const onDeletePieceRef = useRef(null);
  const cancellingRef = useRef(false);
  const onSelectIslandRef = useRef(null);
  onSelectIslandRef.current = (id) => {
    setSelectedIsland(id);
    if (vp.current) vp.current.setSelectedIsland(id);
    if (id != null && colorMode !== 'islands') {
      setColorMode('islands');
      if (vp.current) vp.current.setColorMode('islands');
    }
  };

  const applyOfficialPalette = (pieces, official) => {
    for (const p of pieces) {
      if (official) {
        if (!p.origRgb) p.origRgb = p.rgb ? [...p.rgb] : [200, 200, 200];
        if (p.origColorName === undefined) p.origColorName = p.colorName;
        if (p.origCode === undefined) p.origCode = p.code;
        const c = snapToPalette(p.origRgb);
        p.rgb = c.rgb;
        p.colorName = c.name;
        p.code = c.code;
      } else if (p.origRgb) {
        p.rgb = [...p.origRgb];
        p.colorName = p.origColorName;
        p.code = p.origCode;
      }
    }
  };

  const toggleOfficialColors = (on) => {
    sfx.click();
    setOfficialColors(on);
    if (!res || !res.pieces) return;
    applyOfficialPalette(res.pieces, on);
    if (vp.current) vp.current.setColorMode(colorMode);
    setRes((r) => r && { ...r, pieces: [...r.pieces] });
  };
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [autoBuild, setAutoBuild] = useState(true);
  const [sound, setSound] = useState(sfx.on), [rotate, setRotate] = useState(false), [hasRot, setHasRot] = useState(false);
    const [dark, setDark] = useState(() => { try { return localStorage.getItem('brickgen.theme') !== 'light'; } catch { return true; } });
  const [snapSpp, setSnapSpp] = useState(128), [thick, setThick] = useState(1), [expanded, setExpanded] = useState([]);
  const [workers, setWorkers] = useState(poolSize);
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true);
  const [openSrc, setOpenSrc] = useState(true), [openCfg, setOpenCfg] = useState(true), [openRes, setOpenRes] = useState(true), [openRender, setOpenRender] = useState(true), [openReplay, setOpenReplay] = useState(true), [openExport, setOpenExport] = useState(true);
  const [advanced, setAdvanced] = useState(false), [partsOpen, setPartsOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false), [autoRes, setAutoRes] = useState(null);
  const [bookBusy, setBookBusy] = useState(false);
  const [selMode, setSelMode] = useState(false), [selCount, setSelCount] = useState(0);
  const [rebuild, setRebuild] = useState(null), [rebuildPick, setRebuildPick] = useState(0);   // the region alternatives and which one is previewed
  useEffect(() => { vp.current && vp.current.setTheme(dark); }, [dark]);
  const prevRes = useRef(null);
  /** white hollow cubes over the source mesh (shown on resolution change) */
  const previewResolution = (studs = opts.studs, ref = opts.ref, immediate = false) => {
    if (!vp.current || !model) return;
    setViewMode('mesh'); vp.current.setMode('mesh'); setColorMode('piece'); vp.current.setColorMode('piece');
    vp.current.hollowPreview(studs, ref, immediate);
  };
  const wave = previewResolution;
  useEffect(() => {                                           // hollow cubes preview of the grid unit whenever the resolution changes
    const k = `${opts.studs}|${opts.ref}`, first = prevRes.current === null; prevRes.current = k;
    if (!first) previewResolution(opts.studs, opts.ref);
  }, [opts.studs, opts.ref]); // eslint-disable-line
  const stepRef = useRef(0); stepRef.current = step;
  // Progress goes through a throttle: a worker, the region rebuild or the path tracer can report many times a second, and
  // every report is a render of this whole component - enough of them back to back and React gives up with "Maximum update
  // depth exceeded" (seen on a fast GPU with the booklet's path-traced cover reporting every sample). At most one state
  // update per 120 ms; the last report always lands; `stageDone` clears it.
  const stageRef = useRef({ t: 0, timer: null, next: null });
  const pushStage = useCallback((label, f) => {
    const st = stageRef.current, now = performance.now(); st.next = [label, f];
    if (now - st.t >= 120 && !st.timer) { st.t = now; setStage(st.next); }
    else if (!st.timer) st.timer = setTimeout(() => { st.timer = null; st.t = performance.now(); setStage(st.next); }, Math.max(0, 120 - (now - st.t)));
  }, []);
  const stageDone = useCallback(() => { const st = stageRef.current; if (st.timer) { clearTimeout(st.timer); st.timer = null; } st.next = null; setStage(['', 0]); }, []);

  const setOpt = (k, v) => setOpts((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch {} return n; });
  const patchOpts = (p) => setOpts((o) => { const n = { ...o, ...p }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch {} return n; });

  const setStuds = (v) => { setOpt('studs', v); if (autoRes) setAutoRes(null); };   // a hand-set resolution drops the Auto result
  // the grid phases the solver will score: one per offset pair, both parities. A detected mirror plane leaves offsets on the free axis only
  const nPhases = (opts.offsets || [0]).length ** 2;
  // the parts control: core / extended catalogue, plus whether the measured shapes may be placed on their own (pipeline.shapesFor)
  const partsMode = opts.shapeParts ? 'all' : (opts.partSet || 'limited');
  const setPartsMode = (v) => { sfx.click(); patchOpts(v === 'all' ? { partSet: 'extended', shapeParts: true } : { partSet: v, shapeParts: false }); };
  const nParts = useMemo(() => { const c = catalogFor(opts); return { all: c.length, solo: c.filter((x) => !x.noSolo).length }; }, [opts.partSet, opts.shapeParts, (opts.shapeSolo || []).join(','), (opts.shapeSoloIds || []).join(',')]); // eslint-disable-line
  // "Auto": the stud count worked out from the mesh itself (engine.chooseStuds -> pipeline.autoStuds, docs/CURVES.md round 8)
  const findStuds = async () => {
    if (!model || autoBusy) return;
    sfx.click(); setAutoBusy(true);
    try {
      const a = await chooseStuds({ tris: model.tris, vcols: model.vcols }, opts);
      setAutoRes(a); setOpt('studs', a.studs); previewResolution(a.studs, opts.ref, true);
      message.success(`${a.studs} studs: ${{ lattice: 'the best fit to the lattice nearby', budget: 'as far as the piece budget reaches', detail: 'as fine as the curvature asks for' }[a.chosen] || a.chosen}`);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); }
    setAutoBusy(false);
  };

  useEffect(() => {
    vp.current = new StudioViewport(vEl.current);
    vp.current.setTheme(dark);
    vp.current.onSelectIsland = (id, faceIdx) => onSelectIslandRef.current && onSelectIslandRef.current(id, faceIdx);
    vp.current.onModelRotated = (has) => setHasRot(has);
    vp.current.onDeletePiece = (idx, p) => onDeletePieceRef.current && onDeletePieceRef.current(idx, p);
    fetchModelList().then((list) => setModels(list.sort((a, b) => a.path.localeCompare(b.path)))).catch(() => setModels([]));
    return () => vp.current && vp.current.dispose();
  }, []);

  const islandStats = useMemo(() => {
    if (!isl || !isl.labels || !isl.count) return [];
    const counts = new Int32Array(isl.count);
    const nt = isl.labels.length;
    for (let t = 0; t < nt; t++) {
      const l = isl.labels[t];
      if (l >= 0 && l < isl.count) counts[l]++;
    }
    const pal = islandPalette(isl.count);
    const res = [];
    for (let i = 0; i < isl.count; i++) {
      const triangles = counts[i];
      const pct = nt > 0 ? (triangles / nt) * 100 : 0;
      const color = pal[i] ? '#' + pal[i].getHexString() : '#888888';
      res.push({ id: i, triangles, pct, color });
    }
    return res;
  }, [isl]);

  const deleteIsland = useCallback((id) => {
    if (id == null || !model || !isl || !isl.labels) return;
    if (isl.count <= 1) {
      message.warning('Cannot delete the only remaining island');
      return;
    }
    const nt = isl.labels.length;
    let keep = 0;
    for (let t = 0; t < nt; t++) {
      if (isl.labels[t] !== id) keep++;
    }
    if (keep === 0) {
      message.warning('Cannot delete all triangles');
      return;
    }
    setHistory((prev) => [...prev, { tris: model.tris, vcols: model.vcols }]);
    const newTris = new Float32Array(keep * 9);
    const newVcols = new Float32Array(keep * 9);
    let q = 0;
    for (let t = 0; t < nt; t++) {
      if (isl.labels[t] !== id) {
        for (let k = 0; k < 9; k++) {
          newTris[q * 9 + k] = model.tris[t * 9 + k];
          newVcols[q * 9 + k] = model.vcols[t * 9 + k];
        }
        q++;
      }
    }
    const origTris = model.origTris || model.tris;
    const origVcols = model.origVcols || model.vcols;
    const deletedIslands = (model.deletedIslands || 0) + 1;
    const updated = { ...model, tris: newTris, vcols: newVcols, origTris, origVcols, deletedIslands };
    setModel(updated);
    setSelectedIsland(null);
    if (vp.current) {
      vp.current.setSelectedIsland(null);
      vp.current.setSource(newTris, newVcols, { raw: true, keepScale: true });
    }
    const newIl = meshIslands(newTris);
    setIsl({ count: newIl.count, labels: newIl.labels });
    if (vp.current) {
      vp.current.islandLabels = newIl.labels;
      vp.current.setIslandColors(islandColors(newIl.labels, newIl.count), newIl.labels);
    }
    if (res) setRes(null);
    message.success(`Removed island (${nt - keep} triangles). ${newIl.count} island${newIl.count === 1 ? '' : 's'} remaining.`);
    sfx.click();
  }, [model, isl, res, message]);

  const undoDelete = useCallback(() => {
    if (!history.length || !model) return;
    const prevMesh = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    const deletedIslands = Math.max(0, (model.deletedIslands || 1) - 1);
    const updated = { ...model, tris: prevMesh.tris, vcols: prevMesh.vcols, deletedIslands };
    setModel(updated);
    setSelectedIsland(null);
    if (vp.current) {
      vp.current.setSelectedIsland(null);
      vp.current.setSource(prevMesh.tris, prevMesh.vcols, { raw: true, keepScale: true });
    }
    const newIl = meshIslands(prevMesh.tris);
    setIsl({ count: newIl.count, labels: newIl.labels });
    if (vp.current) {
      vp.current.islandLabels = newIl.labels;
      vp.current.setIslandColors(islandColors(newIl.labels, newIl.count), newIl.labels);
    }
    if (res) setRes(null);
    message.info('Restored previous island');
    sfx.click();
  }, [history, model, res, message]);

  const restoreModel = useCallback(() => {
    if (!model || !model.origTris) return;
    setHistory([]);
    const updated = { ...model, tris: model.origTris, vcols: model.origVcols, deletedIslands: 0 };
    setModel(updated);
    setSelectedIsland(null);
    if (vp.current) {
      vp.current.setSelectedIsland(null);
      vp.current.setSource(model.origTris, model.origVcols, { raw: true, keepScale: true });
    }
    const newIl = meshIslands(model.origTris);
    setIsl({ count: newIl.count, labels: newIl.labels });
    if (vp.current) {
      vp.current.islandLabels = newIl.labels;
      vp.current.setIslandColors(islandColors(newIl.labels, newIl.count), newIl.labels);
    }
    if (res) setRes(null);
    message.info('Restored full original mesh');
    sfx.click();
  }, [model, res, message]);

  useEffect(() => {
    const handleKey = (e) => {
      if (selectedIsland != null && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        deleteIsland(selectedIsland);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedIsland, deleteIsland]);

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

  const toggleDetectIslands = useCallback((on) => {
    sfx.click();
    setDetectIslands(on);
    if (on) {
      if (model) {
        const il = meshIslands(model.tris);
        setIsl({ count: il.count, labels: il.labels });
        if (vp.current) {
          vp.current.islandLabels = il.labels;
          vp.current.setIslandColors(islandColors(il.labels, il.count), il.labels);
          vp.current.paintSource();
        }
        message.info(`Detected ${il.count} island${il.count === 1 ? '' : 's'}`);
      }
    } else {
      setIsl(null);
      setSelectedIsland(null);
      if (vp.current) {
        vp.current.islandLabels = null;
        vp.current.setSelectedIsland(null);
        vp.current.setIslandColors(null);
        if (colorMode === 'islands') {
          setColorMode('piece');
          vp.current.setColorMode('piece');
        }
        vp.current.paintSource();
      }
    }
  }, [model, colorMode, message]);

  const showModel = (mm, computeIsl = detectIslandsRef.current) => {
    setRes(null); setPlaying(false); setStep(0); setViewMode('mesh'); sfx.click();
    setSelectedIsland(null); setHistory([]); setEraserMode(false); setPieceHistory([]);
    if (vp.current) { vp.current.setSelectedIsland(null); vp.current.resetRotation(); vp.current.setEraserMode(false); }
    setHasRot(false);
    vp.current.setSource(mm.tris, mm.vcols, { raw: true });
    if (computeIsl) {
      const il = meshIslands(mm.tris); setIsl({ count: il.count, labels: il.labels });
      if (vp.current) {
        vp.current.islandLabels = il.labels;
        vp.current.setIslandColors(islandColors(il.labels, il.count), il.labels);
      }
    } else {
      setIsl(null);
      if (vp.current) {
        vp.current.islandLabels = null;
        vp.current.setIslandColors(null);
      }
    }
    if (vp.current) {
      vp.current.setMode('mesh');
      vp.current.zoomToFit(false);
    }
  };
  const openPath = useCallback(async (p, upAxis = up) => {
    setModelPath(p);
    { const d = p.replace(/^clean\//, '').split('/').slice(0, -1); setExpanded((e) => [...new Set([...e, ...d.map((_, i) => d.slice(0, i + 1).join('/'))])]); }
    try {
      const buf = await fetchModelBuffer(p);
      const m = await loadModel(p, buf), mm = { name: p.split('/').pop(), ...reorient(m, upAxis) };
      mm.origTris = mm.tris; mm.origVcols = mm.vcols; mm.deletedIslands = 0;
      setModel(mm); showModel(mm);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); }
  }, [up]); // eslint-disable-line
  async function openFile(file) {
    try {
      const m = await loadModel(file.name, await file.arrayBuffer()), mm = { name: file.name, ...reorient(m, up) };
      mm.origTris = mm.tris; mm.origVcols = mm.vcols; mm.deletedIslands = 0;
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
    cancellingRef.current = false;
    setEraserMode(false); setPieceHistory([]);
    if (vp.current) vp.current.setEraserMode(false);
    sfx.start(); setBusy(true); setPlaying(false); setStage(['Preparing', 0]);
    setViewMode('mesh'); vp.current.setMode('mesh');
    setStage(['Previewing grid', 0]);
    await vp.current.voxelPreview(opts.studs, opts.ref, false, true);
    if (cancellingRef.current) return;
    try {
      let src = { tris: model.tris, vcols: model.vcols };
      if (opts.vertexNormals) {
        setStage(['Recomputing vertex normals', 0]); await new Promise((r) => setTimeout(r, 30));
        const f = fixWinding(src.tris, src.vcols); src = f;
        message.info(f.flipped ? `vertex normals: ${f.flipped} flipped triangle${f.flipped === 1 ? '' : 's'} corrected` : 'vertex normals: no flipped triangle found');
      }
      const r = await runMethod(src, opts, { workersWanted: workers, onStage: pushStage });
      vp.current.clearVoxels();
      if (officialColors) applyOfficialPalette(r.pieces, true);
      setRes(r);
      vp.current.setSource(r.srcTris, r.srcCols); vp.current.setLego(r.pieces, FULL_CATALOG, r.dims); vp.current.setColorMode(colorMode); vp.current.setOutline(outline);
      if (colorMode !== 'islands') { setViewMode('lego'); vp.current.setMode('lego'); }
      vp.current.zoomToFit();
      const lv = Math.max(...r.pieces.map((p) => p.b + p.h)); maxLevelRef.current = lv;
      const g = r.metrics.grounded >= 0.9995;
      message.success(`${r.metrics.pieces} pieces in ${(r.timing.total / 1000).toFixed(1)} s${g ? ', one grounded piece of work' : ''}`);
      if (autoBuild) { vp.current.setLevel(0, false); setStep(0); setTimeout(() => setPlaying(true), 250); } else { setStep(lv); sfx.done(); }
    } catch (e) {
      vp.current.clearVoxels();
      if (!/terminated|cancel/i.test(String(e))) { sfx.error(); message.error(String(e.message || e)); }
      console.error(e);
    }
    setBusy(false);
  }
  const stop = () => { cancellingRef.current = true; cancel(); vp.current && (vp.current.clearVoxels(), vp.current.clearHollowCubes()); setBusy(false); stageDone(); sfx.click(); };

  const base = model ? model.name.replace(/\.[^.]+$/, '') + '_' + opts.studs : 'model';
  const exportLDR = () => download(toLDR(res.pieces, FULL_CATALOG, base), base + '.ldr', 'text/plain');
  const exportGLB = (mode) => {
    const m = buildMesh(res.pieces, FULL_CATALOG, mode);
    if (vp.current && vp.current.hasRotation() && res?.dims) {
      const q = vp.current.modelPivot.quaternion;
      const P = m.pos;
      const v = new THREE.Vector3();
      const cx = (res.dims[0] * 20) / 2, cy = (res.dims[2] * 8) / 2, cz = (res.dims[1] * 20) / 2;
      for (let k = 0; k < P.length; k += 3) {
        v.set(P[k] - cx, P[k + 1] - cy, P[k + 2] - cz);
        v.applyQuaternion(q);
        P[k] = v.x + cx;
        P[k + 1] = v.y + cy;
        P[k + 2] = v.z + cz;
      }
    }
    download(toGLB(m), base + (mode === 'kind' ? '_kinds' : '') + '.glb', 'model/gltf-binary');
  };
  /**
   * The building booklet (brickgen/instructions.js): the steps are planned on the viewport's own piece list - which setLego
   * sorted by level, so the order is already the build order - and each one is captured from the viewport with its new pieces
   * highlighted, the camera fixed. Light theme and outlines on while capturing, since the booklet is for paper.
   */
  /**
   * Rebuild the selected area several ways (engine.rebuildRegion -> pipeline.regionAttempts) and let the user pick. It does
   * not choose for them: measured on the duck, no local attempt beats the IoU the global solve reached there, so the point is
   * a different character for the area - more shaped parts, no learned assemblies, a looser skin - not a better number.
   */
  const rebuildSelection = async () => {
    const vpc = vp.current; if (!vpc || !res) return;
    const sel = vpc.selectedPieces(); if (!sel.length) return message.info('Select some bricks first');
    sfx.click(); setBusy(true); setStage(['Rebuilding the selection', 0]);
    try {
      const box = boxOf(sel);
      const r = await rebuildRegion(box, res, { onStage: pushStage });
      if (!r) throw new Error('the model has to be computed again before an area can be rebuilt');
      setRebuild(r); setRebuildPick(0);
      message.success(`${r.replaced} bricks, ${r.attempts.length - 1} alternatives`);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); console.error(e); }
    setBusy(false); stageDone();
  };
  /** show one alternative in the viewport without committing to it (0 = what is there now) */
  const previewRebuild = (k) => {
    const vpc = vp.current, r = rebuild; if (!vpc || !r) return;
    setRebuildPick(k);
    const a = r.attempts[k], pieces = k === 0 ? res.pieces : a.result.pieces;
    if (officialColors) applyOfficialPalette(pieces, true);
    vpc.setLego(pieces, FULL_CATALOG, (k === 0 ? res : a.result).dims || res.dims);
    vpc.setColorMode(colorMode); vpc.setOutline(outline);
  };
  /** keep the previewed alternative: it becomes the model */
  const applyRebuild = () => {
    const r = rebuild, k = rebuildPick; if (!r) return;
    // the attempt carries the solve's own fields; everything about the SOURCE and the run stays as it was (the worker strips
    // srcTris / srcCols from the message, and an attempt has no options / job / scores of its own)
    if (k > 0) {
      const a = r.attempts[k].result;
      setRes({ ...res, pieces: a.pieces, metrics: a.metrics, post: a.post, islands: a.islands, crust: a.crust,
        dims: a.dims || res.dims, offset: a.offset || res.offset, scale: a.scale || res.scale, timing: { ...res.timing, ...(a.timing || {}) } });
      sfx.done();
    }
    setRebuild(null); setSelCount(vp.current.clearSelection());
    message.success(k > 0 ? `kept: ${r.attempts[k].name}` : 'left as it was');
  };
  const cancelRebuild = () => { previewRebuild(0); setRebuild(null); };

  /** select mode: the left button draws a marquee over the bricks instead of orbiting (viewport3d.setSelectMode) */
  const toggleSelect = (on) => {
    const vpc = vp.current; if (!vpc) return;
    sfx.click();
    if (on && eraserMode) {
      setEraserMode(false);
      vpc.setEraserMode(false);
    }
    setSelMode(on); vpc.onSelectionChange = setSelCount; vpc.setSelectMode(on);
    if (!on) setSelCount(vpc.clearSelection());
  };
  useEffect(() => {                                                   // Ctrl+I inverts while select mode is on
    if (!selMode) return;
    const f = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); setSelCount(vp.current.invertSelection()); } };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [selMode]);

  /** eraser mode: clicking on any LEGO piece deletes it and updates model configuration, metrics, and BOM */
  const deletePiece = useCallback((pieceIndex, pieceObj) => {
    if (!res || !res.pieces || !res.pieces.length) return;
    const p = pieceObj || (vp.current?.pieces ? vp.current.pieces[pieceIndex] : res.pieces[pieceIndex]);
    if (!p) return;

    let targetIdx = res.pieces.indexOf(p);
    if (targetIdx === -1 && pieceIndex >= 0 && pieceIndex < res.pieces.length) {
      targetIdx = pieceIndex;
    }
    if (targetIdx === -1) return;
    const deletedPiece = res.pieces[targetIdx];

    setPieceHistory((prev) => [...prev, { piece: deletedPiece, res }]);

    const newPieces = res.pieces.filter((_, i) => i !== targetIdx);

    const oldMetrics = res.metrics || {};
    const oldKinds = { ...(oldMetrics.kinds || {}) };
    if (oldKinds[deletedPiece.kind]) {
      oldKinds[deletedPiece.kind]--;
      if (oldKinds[deletedPiece.kind] <= 0) delete oldKinds[deletedPiece.kind];
    }
    const oldIds = { ...(oldMetrics.ids || {}) };
    if (oldIds[deletedPiece.id]) {
      oldIds[deletedPiece.id]--;
      if (oldIds[deletedPiece.id] <= 0) delete oldIds[deletedPiece.id];
    }

    const newMetrics = {
      ...oldMetrics,
      pieces: newPieces.length,
      kinds: oldKinds,
      ids: oldIds,
    };

    const newRes = {
      ...res,
      pieces: newPieces,
      metrics: newMetrics,
    };

    const newMax = newPieces.length ? Math.max(...newPieces.map((x) => x.b + x.h)) : 0;
    maxLevelRef.current = newMax;
    setRes(newRes);

    if (vp.current) {
      vp.current.clearHoverPiece();
      vp.current.setLego(newPieces, FULL_CATALOG, res.dims, true);
      vp.current.setColorMode(colorMode);
      vp.current.setOutline(outline);
      if (step < newMax) {
        vp.current.setLevel(step, false);
      }
    }

    sfx.click();
    message.info(`Deleted ${deletedPiece.name || deletedPiece.id} (${deletedPiece.kind})`);
  }, [res, colorMode, outline, step, message]);

  onDeletePieceRef.current = deletePiece;

  const undoDeletePiece = useCallback(() => {
    if (!pieceHistory.length) return;
    const last = pieceHistory[pieceHistory.length - 1];
    setPieceHistory((prev) => prev.slice(0, -1));

    const restoredRes = last.res;
    const newMax = restoredRes.pieces.length ? Math.max(...restoredRes.pieces.map((x) => x.b + x.h)) : 0;
    maxLevelRef.current = newMax;
    setRes(restoredRes);

    if (vp.current) {
      vp.current.clearHoverPiece();
      vp.current.setLego(restoredRes.pieces, FULL_CATALOG, restoredRes.dims, true);
      vp.current.setColorMode(colorMode);
      vp.current.setOutline(outline);
      if (step < newMax) {
        vp.current.setLevel(step, false);
      }
    }

    sfx.click();
    message.info(`Restored ${last.piece.name || last.piece.id}`);
  }, [pieceHistory, colorMode, outline, step, message]);

  const toggleEraser = useCallback((on) => {
    sfx.click();
    setEraserMode(on);
    if (on) {
      if (selMode) {
        setSelMode(false);
        if (vp.current) {
          vp.current.setSelectMode(false);
          setSelCount(vp.current.clearSelection());
        }
      }
      if (rotate) {
        setRotate(false);
        if (vp.current) vp.current.setRotateGizmo(false);
      }
      if (viewMode === 'mesh') {
        setViewMode('lego');
        if (vp.current) vp.current.setMode('lego');
      }
    }
    if (vp.current) vp.current.setEraserMode(on);
  }, [selMode, rotate, viewMode]);

  useEffect(() => {
    const handleUndoKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        if (pieceHistory.length > 0) {
          e.preventDefault();
          undoDeletePiece();
        }
      }
    };
    window.addEventListener('keydown', handleUndoKey);
    return () => window.removeEventListener('keydown', handleUndoKey);
  }, [pieceHistory, undoDeletePiece]);

  const bookStageRef = useRef('Drawing the instructions');
  const exportBooklet = async () => {
    const vpc = vp.current; if (!res || !vpc || !vpc.pieces) return;
    sfx.click(); setBookBusy(true); bookStageRef.current = 'Drawing the instructions'; pushStage('Drawing the instructions', 0);
    const wasDark = dark, wasMode = viewMode, wasOutline = outline, wasLevel = step;
    try {
      const { html, steps, pages } = await shootBooklet(vpc, FULL_CATALOG, { title: base, opts,
        meta: { studs: res.options.studs, weld: !!(res.post && res.post.weld && res.post.weld.added) },
        cover: { spp: window.__spp || snapSpp, ...(window.__coverH ? { outHeight: window.__coverH } : {}) },   // the snapshot's spp: one path-traced cover view
        onStage: (name) => { bookStageRef.current = name; pushStage(name, 0); }, onProgress: (f) => pushStage(bookStageRef.current, f) });
      download(html, base + '_instructions.html', 'text/html');
      message.success(`${steps} steps on ${pages} pages - open it and print to PDF`);
    } catch (e) { sfx.error(); message.error(String(e.message || e)); console.error(e); }
    vpc.setAllStuds(false);
    vpc.paused = false; vpc.setTheme(wasDark); vpc.setOutline(wasOutline); vpc.setColorMode(colorMode); vpc.setMode(wasMode); vpc.setLevel(wasLevel >= maxLevelRef.current ? Infinity : wasLevel, false);
    setBookBusy(false); stageDone();
  };

  const exportJSON = () => download(JSON.stringify({ model: model.name, options: res.options, metrics: res.metrics, post: res.post, islands: res.islands, symmetry: res.symmetry, timing: res.timing, dims: res.dims, pieces: res.pieces }, null, 1), base + '_report.json', 'application/json');
  const save = (url) => { const a = document.createElement('a'); a.href = url; a.download = base + '.png'; a.click(); };
  const ptJob = useRef(null), ptHost = useRef(null);
  const dragRef = useRef(null), [ptView, setPtView] = useState({ z: 1, x: 0, y: 0 });
  const [dof, setDof] = useState({ on: true, px: 16, focus: 0, sharp: 0, span: null });        // depth of field on the finished still
  const [pt, setPt] = useState(null);                              // { n, spp, status: 'running' | 'done' | 'error', err }
  const closePt = () => { if (ptJob.current) { ptJob.current.dispose(); ptJob.current = null; } setPt(null); };
  useEffect(() => { if (!pt) return; const f = (e) => e.key === 'Escape' && closePt(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [!!pt]); // eslint-disable-line
  const png = async () => {
    if (!model) return;
    sfx.click(); const spp = snapSpp; setPtView({ z: 1, x: 0, y: 0 }); setPt({ n: 0, spp, status: 'running' });
    try {
      const { createPathTrace } = await import('./studio/pathtrace.js');
      const pieces = res ? (vp.current?.visiblePieces() || res.pieces) : [];
      const job = await createPathTrace(vp.current, { pieces, cat: FULL_CATALOG, colorMode, dark, spp, viewMode }); ptJob.current = job;
      for (let i = 0; i < 50 && !ptHost.current; i++) await new Promise((r) => setTimeout(r, 20));
      setPt((o) => o && { ...o, ar: job.canvas.width / job.canvas.height });
      for (let i = 0; i < 50 && !ptHost.current; i++) await new Promise((r) => setTimeout(r, 20));
      if (ptHost.current) { ptHost.current.innerHTML = ''; job.canvas.style.cssText = 'width:100%;height:100%;display:block'; ptHost.current.appendChild(job.el); }
      let lastUi = 0;                                                              // progress is repainted at ~5 Hz, off the sample loop: one React commit per frame can pile up into 'maximum update depth'
      const ok = await job.run((n, m) => { const t = performance.now(); if (n < m && t - lastUi < 200) return; lastUi = t; setTimeout(() => setPt((o) => (o && o.status === 'running' ? { ...o, n, spp: m } : o)), 0); });
      if (ok) {
        setPt((o) => o && { ...o, n: spp, status: 'done' }); sfx.done();
        try {                                                                        // depth pass + first blur, focused mid-range
          const span = job.prepareDof();
          const focus = span ? (span.near + span.far) / 2 : 0;
          setDof((d) => { const n = { ...d, focus, span }; job.applyDof({ on: n.on, focus, maxPx: n.px }); return n; });
        } catch (e) { console.warn('depth of field unavailable', e); }
      }
    } catch (e) { console.error(e); setPt((o) => o && { ...o, status: 'error', err: String(e.message || e) }); }
  };

  /** pick the focus distance from the depth map under the cursor (image coords, allowing for zoom / pan) */
  const focusFromEvent = (e, frameEl) => {
    const job = ptJob.current; if (!job || !job.depthAt) return;
    const r = frameEl.getBoundingClientRect();
    const u = (e.clientX - r.left - ptView.x) / (r.width * ptView.z), v = (e.clientY - r.top - ptView.y) / (r.height * ptView.z);
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const z = job.depthAt(u, v); if (!z) return;
    setDof((d) => { job.applyDof({ on: true, focus: z, maxPx: d.px }); return { ...d, on: true, focus: z }; });
  };

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

  const countLeafs = (node) => {
    if (node.leaf) return 1;
    let sum = 0;
    for (const child of node.children.values()) sum += countLeafs(child);
    return sum;
  };

  const modelTree = useMemo(() => {
    const q = query.trim().toLowerCase(), root = { children: new Map() };
    for (const m of models) {
      if (q && !m.path.toLowerCase().includes(q)) continue;
      if (/^spearman\./i.test(m.path)) continue;                      // retired root-level model
      const parts = m.path.split('/'); if (parts.length > 1 && parts[0] === 'clean') parts.shift();     // categories are the top level
      let n = root;
      parts.forEach((part, i) => {
        if (!n.children.has(part)) n.children.set(part, { key: i === parts.length - 1 ? m.path : parts.slice(0, i + 1).join('/'), part, leaf: i === parts.length - 1, size: m.size, children: new Map() });
        n = n.children.get(part);
      });
    }
    const conv = (n) => [...n.children.values()].sort((a, b) => (a.leaf - b.leaf) || a.part.localeCompare(b.part)).map((c) => (c.leaf
      ? { key: c.key, isLeaf: true, title: <span className="tl">{c.part.replace(/\.[^.]+$/, '')}<i>{(c.size / 1e6).toFixed(1)} MB</i></span> }
      : { key: c.key, title: <span className="tl cat-label"><span>{c.part}</span><i>{countLeafs(c)}</i></span>, children: conv(c) }));
    return conv(root);
  }, [models, query]);
  const allDirs = useMemo(() => { const s = new Set(); for (const m of models) { const p = m.path.split('/'); if (p[0] === 'clean' && p.length > 1) p.shift(); for (let i = 1; i < p.length; i++) s.add(p.slice(0, i).join('/')); } return [...s]; }, [models]);

  const toggleExpandNode = (key) => {
    sfx.click();
    setExpanded((prev) => {
      const cur = prev.length || query ? (query ? allDirs : prev) : [];
      const isExp = cur.includes(key);
      return isExp ? cur.filter((k) => k !== key) : [...cur, key];
    });
  };

  const resultsBlock = res && (
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
                        <div className="kv" style={{ gridColumn: '1 / 3' }}><span>Grid:</span><b>{(res.dims || [0, 0, 0])[0]} x {(res.dims || [0, 0, 0])[1]} studs, {(res.dims || [0, 0, 0])[2]} plates</b></div>
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
  );

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
      <div className="vp" ref={vEl} style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }} />
      {selectedIsland != null && islandStats[selectedIsland] && (
        <div className="island-overlay">
          <span className="island-swatch" style={{ background: islandStats[selectedIsland].color }} />
          <span style={{ fontWeight: 600 }}>Island #{selectedIsland + 1}</span>
          <span style={{ color: 'var(--tx2)' }}>{islandStats[selectedIsland].triangles.toLocaleString()} triangles ({islandStats[selectedIsland].pct.toFixed(1)}%)</span>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteIsland(selectedIsland)}>Delete</Button>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { setSelectedIsland(null); vp.current && vp.current.setSelectedIsland(null); }} />
        </div>
      )}

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
                onExpand={setExpanded} onSelect={(k, { node }) => { if (node.isLeaf) { sfx.click(); openPath(node.key); } else { toggleExpandNode(node.key); } }}
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
            <div className="grid2">
              <Tooltip title="welds the mesh, lets three.js compute vertex normals and flips reversed triangles before the LEGO computation"><Checkbox checked={!!opts.vertexNormals} onChange={(e) => setOpt('vertexNormals', e.target.checked)}>Fix flipped faces</Checkbox></Tooltip>
              <Tooltip title="on: geometry.computeVertexNormals() on the welded mesh, smooth shading. off: flat shading"><Checkbox checked={smooth} onChange={(e) => { setSmooth(e.target.checked); vp.current.setSmooth(e.target.checked); }}>Smooth normals</Checkbox></Tooltip>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <Tooltip title="Optional: analyze mesh connectivity to detect, inspect, and delete separate 3D islands before computation">
                <span>Detect mesh islands</span>
              </Tooltip>
              <Switch size="small" checked={detectIslands} onChange={toggleDetectIslands} />
            </div>
            <div className="feats flush">
              {SOURCE_FEATURES.map((f) => <FeatureRow key={f.key} f={f} opts={opts} patch={patchOpts} />)}
            </div>
            {detectIslands && isl && isl.count > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, background: 'var(--soft)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px' }}>
                <span><b>{isl.count}</b> islands detected</span>
                <Button size="small" type="link" icon={<ScissorOutlined />} style={{ padding: 0, fontSize: 11, height: 'auto' }}
                  onClick={() => { setViewMode('mesh'); vp.current && vp.current.setMode('mesh'); setColorMode('islands'); vp.current && vp.current.setColorMode('islands'); }}>
                  Inspect &amp; delete
                </Button>
              </div>
            )}
          </Section>
          <Divider style={{ margin: '4px 0' }} />

          <Section title="2. Discretization" open={openCfg} setOpen={setOpenCfg}>
            {!busy ? (
              <Button type="primary" icon={<ThunderboltOutlined />} disabled={!model} onClick={generate} style={{ width: '100%', height: 36, fontWeight: 600 }}>Compute</Button>
            ) : (
              <Button danger icon={<StopOutlined />} onClick={stop} style={{ width: '100%', height: 36 }}>Cancel</Button>
            )}
            <div className="ctl">
              <div className="ctl-h"><span>Resolution</span><b>{opts.studs} studs</b>
                <Tooltip title="Work out a good stud count for this mesh: a piece budget from two quick pilot solves, the curvature ceiling of its surface, then the best fit to the lattice within 15 % of the two. A few seconds.">
                  <Button size="small" type="dashed" icon={<ExperimentOutlined />} loading={autoBusy} disabled={!model || busy}
                    onClick={findStuds} style={{ marginLeft: 'auto' }}>Auto</Button>
                </Tooltip></div>
              <Slider min={4} max={64} step={1} value={Math.min(64, opts.studs)} onChange={setStuds} onChangeComplete={(v) => previewResolution(v, opts.ref, true)} marks={{ 4: '4', 16: '16', 32: '32', 48: '48', 64: '64' }} />
              <div className="presets">
                {[8, 12, 16, 24, 32, 48, 64].map((v) => <Button key={v} size="small" type={opts.studs === v ? 'primary' : 'default'} onClick={() => { sfx.click(); setStuds(v); previewResolution(v, opts.ref, true); }}>{v}</Button>)}
              </div>
              <div className="refrow"><span>studs along the</span>
                <Select size="small" value={opts.ref} onChange={(v) => { setOpt('ref', v); previewResolution(opts.studs, v, true); }} style={{ flex: 1 }}
                  options={[{ value: 'min3', label: 'smallest side of the box' }, { value: 'maxh', label: 'longest side of the box' }]} /></div>
              {autoRes && (
                <Tooltip title={`piece budget ${autoRes.budget.studs} studs (pieces grow as N^${autoRes.budget.exp} on this mesh)` +
                  (autoRes.detail ? `, curvature ceiling ${autoRes.detail} studs` : ', no curved surface to speak of') +
                  `. Candidates by how faithfully their voxel grid matches the mesh: ` + autoRes.candidates.map((c) => `${c.studs}: ${c.iou.toFixed(3)}`).join(', ')}>
                  <div className="auto-hint">
                    <b>{autoRes.studs} studs</b> — {{ lattice: 'best fit to the lattice', budget: 'the piece budget', detail: 'the curvature ceiling' }[autoRes.chosen] || autoRes.chosen}
                    <span>{(autoRes.ms / 1000).toFixed(1)} s</span>
                  </div>
                </Tooltip>
              )}
            </div>
            <div className="ctl">
              <div className="ctl-h"><span>Phases</span><b>{opts.precision}</b><i>{nPhases === 1 ? 'one grid position' : `${nPhases} grid positions`}{{ 0: ', draft', 4: ', balanced', 8: ', fine', 12: ', thorough', 16: ', exhaustive' }[opts.precision] || ''}</i></div>
              <Slider min={0} max={16} step={null} value={opts.precision} tooltip={{ open: false }}
                onChange={(v) => patchOpts({ precision: v, offsets: [0, 4, 8, 12, 16].filter((x) => x <= v) })} marks={{ 0: '0', 4: '4', 8: '8', 12: '12', 16: '16' }} />
            </div>
            <div className="ctl">
              <div className="ctl-h"><span>Parts</span><b>{nParts.all}</b><i>{nParts.solo} usable alone</i></div>
              <Segmented block size="small" value={partsMode} onChange={setPartsMode}
                options={[{ value: 'limited', label: 'Core' }, { value: 'extended', label: 'Extended' }, { value: 'all', label: 'Every shape' }]} style={{ margin: '8px 0 6px' }} />
              {partsMode !== 'all' && (
                <Tooltip title="The measured LDraw shapes (quarter discs, cones, curved tops, corner tiles, arches, panels) are always available to the learned assemblies. These kinds may also be placed on their own; letting them all in floods the surface with fragments, which is why only the round family is on by default.">
                  <Select size="small" mode="multiple" allowClear placeholder="measured shapes usable alone" style={{ width: '100%' }}
                    value={opts.shapeSolo || []} onChange={(v) => setOpt('shapeSolo', v)}
                    options={SHAPE_KINDS.map(([value, label]) => ({ value, label }))} maxTagCount="responsive" />
                </Tooltip>
              )}
            </div>
            <div className="feats">
              {STUDIO_FEATURES.map((f) => <FeatureRow key={f.key} f={f} opts={opts} patch={patchOpts} />)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => setAdvanced(true)} style={{ padding: 0, fontSize: 12 }}>All parameters…</Button>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => { localStorage.removeItem(STORE); setOpts({ ...DEFAULTS }); }}>defaults</Button>
            </div>
          </Section>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- right drawer: rendering, replay, export */}
      <aside className={'dock right' + (rightOpen ? '' : ' closed')} style={{ width: RW }}>
        <Tooltip title={rightOpen ? 'Hide panel' : 'Show panel'} placement="left"><Button className="handle" size="small" icon={rightOpen ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { sfx.click(); setRightOpen(!rightOpen); }} /></Tooltip>
        <div className="dock-h"><Title level={5} style={{ margin: 0, fontWeight: 600 }}>Render &amp; export</Title></div>
        <div className="dock-b">
          <Section title="Rendering" open={openRender} setOpen={setOpenRender}>
            <Text style={{ fontSize: 11, color: 'var(--tx2)' }}>Display</Text>
            <Radio.Group size="small" value={viewMode} onChange={(e) => {
              sfx.click();
              const v = e.target.value;
              if (v === 'mesh' && eraserMode) {
                setEraserMode(false);
                vp.current && vp.current.setEraserMode(false);
              }
              setViewMode(v);
              vp.current.setMode(v);
            }} style={{ display: 'flex', width: '100%' }}>
              {[['mesh', 'Mesh'], ['lego', 'LEGO'], ['both', 'Overlay'], ['split', 'Split']].map(([v, l]) => <Radio.Button key={v} value={v} style={{ flex: 1, textAlign: 'center' }}>{l}</Radio.Button>)}
            </Radio.Group>
            <Text style={{ fontSize: 11, color: 'var(--tx2)' }}>Colours</Text>
            <Radio.Group size="small" value={colorMode} onChange={(e) => { sfx.click(); const v = e.target.value; setColorMode(v); vp.current.setColorMode(v); if (v === 'islands') { setViewMode('mesh'); vp.current.setMode('mesh'); if (!detectIslands) toggleDetectIslands(true); } }} style={{ display: 'flex', width: '100%' }}>
              <Radio.Button value="piece" style={{ flex: 1, textAlign: 'center' }}>Model</Radio.Button>
              <Radio.Button value="islands" style={{ flex: 1, textAlign: 'center' }}>Islands</Radio.Button>
              <Radio.Button value="kind" style={{ flex: 1, textAlign: 'center' }}>Part kinds</Radio.Button>
            </Radio.Group>
            {colorMode === 'islands' && (
              isl ? (
                <div className="island-box">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span><b>{isl.count}</b> island{isl.count === 1 ? '' : 's'}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {history.length > 0 && <Button size="small" type="text" icon={<UndoOutlined />} onClick={undoDelete} style={{ fontSize: 11, height: 22, padding: '0 4px' }}>Undo</Button>}
                    {model && model.deletedIslands > 0 && <Button size="small" type="link" icon={<ReloadOutlined />} onClick={restoreModel} style={{ fontSize: 11, height: 22, padding: '0 4px' }}>Restore all</Button>}
                  </div>
                </div>
                <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>Click an island in the 3D viewport or below to select and remove from computation.</Text>
                {selectedIsland != null && islandStats[selectedIsland] && (
                  <div className="island-selected-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="island-swatch" style={{ background: islandStats[selectedIsland].color }} />
                      <span style={{ fontWeight: 600, fontSize: 11 }}>Island #{selectedIsland + 1}</span>
                      <span style={{ fontSize: 10, color: 'var(--tx2)', marginLeft: 'auto' }}>{islandStats[selectedIsland].triangles.toLocaleString()} tris ({islandStats[selectedIsland].pct.toFixed(1)}%)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteIsland(selectedIsland)} style={{ flex: 1, fontSize: 11, height: 24 }}>Delete from model</Button>
                      <Button size="small" onClick={() => { setSelectedIsland(null); vp.current && vp.current.setSelectedIsland(null); }} style={{ fontSize: 11, height: 24 }}>Deselect</Button>
                    </div>
                  </div>
                )}
                <div className="island-list">
                  {islandStats.map((st) => (
                    <div key={st.id} className={'island-item' + (selectedIsland === st.id ? ' selected' : '')}
                      onClick={() => { setSelectedIsland(st.id); vp.current && vp.current.setSelectedIsland(st.id); }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span className="island-swatch" style={{ background: st.color }} />
                        <span style={{ fontWeight: selectedIsland === st.id ? 600 : 400 }}>Island #{st.id + 1}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: 'var(--tx2)', fontSize: 10 }}>{st.triangles.toLocaleString()} tris ({st.pct.toFixed(0)}%)</span>
                        <Tooltip title="Delete island from computation">
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); deleteIsland(st.id); }} style={{ width: 20, height: 20, padding: 0 }} />
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="island-box" style={{ alignItems: 'center', padding: '10px 8px', textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11, marginBottom: 6, display: 'block' }}>Mesh islands have not been computed.</Text>
                <Button size="small" type="primary" onClick={() => toggleDetectIslands(true)}>Detect mesh islands</Button>
              </div>
            ))}
            {colorMode === 'kind' && resultsBlock}
            <div className="row"><span>Official LEGO colors</span><Switch size="small" checked={officialColors} disabled={!res} onChange={toggleOfficialColors} /></div>
            <div className="row"><span>Ink outline</span><Switch size="small" checked={outline} onChange={(v) => { setOutline(v); vp.current.setOutline(v); }} /></div>
            <div className="row"><span>Outline thickness</span><Slider min={0.5} max={4} step={0.25} value={thick} onChange={(v) => { setThick(v); vp.current.setHullThickness(v); }} style={{ width: 120, margin: 0 }} /></div>
            <div className="row"><span>Animate the build</span><Switch size="small" checked={autoBuild} onChange={setAutoBuild} /></div>
          </Section>
          {res && (<><Divider style={{ margin: '4px 0' }} />
            <Section title="Replay" open={openReplay} setOpen={setOpenReplay}>{replay}</Section></>)}
          <Divider style={{ margin: '4px 0' }} />
          <Section title="Export" open={openExport} setOpen={setOpenExport}>
            {!res && <Text type="secondary" style={{ fontSize: 12 }}>Compute a model to export it.</Text>}
            <div className="exports">
              <Tooltip title="A printable building booklet: a perspective cover, then one picture per step with the pieces it adds drawn in red and listed under it, and the full parts list at the end. Opens as an HTML file; print it to PDF from the browser.">
                <Button
                  size="small"
                  type="primary"
                  icon={<ReadOutlined />}
                  disabled={!res}
                  loading={bookBusy}
                  onClick={exportBooklet}
                  style={{ gridColumn: '1 / -1', background: '#2563eb', borderColor: '#2563eb', color: '#fff', fontWeight: 600, justifyContent: 'center' }}
                >
                  Instructions
                </Button>
              </Tooltip>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={exportLDR}>.ldr (LDraw)</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={() => exportGLB('piece')}>.glb</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={() => exportGLB('kind')}>.glb by kind</Button>
              <Button size="small" icon={<DownloadOutlined />} disabled={!res} onClick={exportJSON}>report .json</Button>
              <Button size="small" icon={<CameraOutlined />} disabled={!model} onClick={png}>snapshot .png</Button>
              <Select size="small" value={snapSpp} onChange={setSnapSpp} options={[64, 128, 256, 512, 1024].map((v) => ({ value: v, label: `${v} spp` }))} />
              <Button size="small" icon={<AppstoreOutlined />} onClick={() => { sfx.click(); setPartsOpen(true); }}>Parts list</Button>
            </div>
          </Section>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- toolbar */}
      <div className="toolbar" style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }}>
        <div className="tools">
          <Tooltip title={sound ? 'Sound on' : 'Sound off'}><Button size="small" type="text" icon={sound ? <SoundOutlined /> : <AudioMutedOutlined />} onClick={() => { const v = !sound; setSound(v); sfx.setOn(v); }} /></Tooltip>
          <Tooltip title={rotate ? 'Hide rotation gizmo' : 'Rotation gizmo'}><Button size="small" type={rotate ? 'primary' : 'text'} icon={<SyncOutlined />} onClick={() => {
            const v = !rotate;
            if (v && eraserMode) {
              setEraserMode(false);
              vp.current && vp.current.setEraserMode(false);
            }
            setRotate(v);
            vp.current.setRotateGizmo(v);
          }} /></Tooltip>
          {hasRot && (
            <Tooltip title="Reset rotation"><Button size="small" type="text" icon={<UndoOutlined />} onClick={() => { if (vp.current) { vp.current.resetRotation(); setHasRot(false); } }} /></Tooltip>
          )}
          {res && (
            <>
              {viewMode !== 'mesh' && (
                <>
                  <Tooltip title={selMode ? 'Leave select mode' : 'Select bricks: drag a box. Ctrl / Shift-drag adds, Alt-drag removes, Ctrl+I inverts, double-click clears.'}>
                    <Button size="small" type={selMode ? 'primary' : 'text'} icon={<SelectOutlined />} onClick={() => toggleSelect(!selMode)} />
                  </Tooltip>
                  {selMode && <span className="selinfo">{selCount ? `${selCount} selected` : 'drag to select'}</span>}
                  {selMode && selCount > 0 && <Tooltip title="Invert (Ctrl+I)"><Button size="small" type="text" icon={<SwapOutlined />} onClick={() => setSelCount(vp.current.invertSelection())} /></Tooltip>}
                  {selMode && selCount > 0 && <Tooltip title="Clear (double-click)"><Button size="small" type="text" icon={<ClearOutlined />} onClick={() => setSelCount(vp.current.clearSelection())} /></Tooltip>}
                  {selMode && selCount > 0 && !rebuild && <Tooltip title="Build this area again, several ways, and choose"><Button size="small" type="text" icon={<SyncOutlined />} onClick={rebuildSelection} disabled={busy}>rebuild</Button></Tooltip>}
                </>
              )}
              <Tooltip title={eraserMode ? 'Leave eraser mode' : 'Erase piece: click any LEGO part to delete it'}>
                <Button size="small" type={eraserMode ? 'primary' : 'text'} icon={<EraserIcon />} onClick={() => toggleEraser(!eraserMode)} />
              </Tooltip>
              {eraserMode && <span className="selinfo" style={{ color: '#ef4444' }}>click brick to delete</span>}
              {pieceHistory.length > 0 && (
                <Tooltip title="Undo deleted piece (Ctrl+Z)">
                  <Button size="small" type="text" icon={<UndoOutlined />} onClick={undoDeletePiece} />
                </Tooltip>
              )}
            </>
          )}
          <Tooltip title="Reset view"><Button size="small" type="text" icon={<AimOutlined />} onClick={() => vp.current.frame()} /></Tooltip>
          <Tooltip title="Snapshot"><Button size="small" type="text" icon={<CameraOutlined />} onClick={png} disabled={!model} /></Tooltip>
          <Tooltip title={dark ? 'Light theme' : 'Dark theme'}><Button size="small" type="text" icon={dark ? <BulbOutlined /> : <BulbFilled />} onClick={toggleTheme} /></Tooltip>
        </div>
      </div>

      {(busy || bookBusy) && <div className="busy" style={{ left: leftOpen ? LW : 0, right: rightOpen ? RW : 0 }}><div className="chip"><div className="chip-row"><div className="spinner" /><span>{stage[0]}</span><div className="pulse" /></div>
        <div className="chip-bar"><Progress percent={Math.round(stage[1] * 100)} showInfo={false} size="small" /><span>{Math.round(stage[1] * 100)}%</span></div></div></div>}

      {rebuild && (
        <div className="rebuild" style={{ left: leftOpen ? LW + 16 : 16 }}>
          <div className="rb-h"><b>Rebuild this area</b><span>{rebuild.replaced} bricks re-solved, {rebuild.kept} kept</span></div>
          <div className="rb-list">
            {rebuild.attempts.map((a, k) => (
              <button key={k} className={'rb-item' + (k === rebuildPick ? ' on' : '')} onClick={() => previewRebuild(k)}>
                <span className="rb-n">{a.name}</span>
                <span className="rb-m">{a.pieces} pieces<i>IoU {a.iou.toFixed(3)}</i></span>
              </button>
            ))}
          </div>
          <div className="rb-f">
            <span>None of these is "better": the whole-model solve already found the best fit here. Pick the look you want.</span>
            <div><Button size="small" onClick={cancelRebuild}>Cancel</Button><Button size="small" type="primary" onClick={applyRebuild}>Keep</Button></div>
          </div>
        </div>
      )}

      <Drawer title="All parameters" open={advanced} onClose={() => setAdvanced(false)} size={440} className="adv"
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--tx2)' }}>
            <span>workers</span>
            <Input size="small" type="number" min={1} max={16} value={workers} onChange={(e) => e.target.value && setWorkers(+e.target.value)} style={{ width: 52 }} />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { localStorage.removeItem(STORE); setOpts({ ...DEFAULTS }); setAutoRes(null); }}>defaults</Button>
          </div>
        }>
        <div className="advtop">
          <div className="advtop-h">What the method does<i>each switch writes the handful of parameters below that it is made of</i></div>
          {FEATURE_GROUPS.map((g) => (
            <div className="featgroup" key={g}>
              <h4>{g}</h4>
              {FEATURES.filter((f) => f.group === g).map((f) => <FeatureRow key={f.key} f={f} opts={opts} patch={patchOpts} />)}
            </div>
          ))}
        </div>
        <Divider style={{ margin: '14px 0 8px' }}><span style={{ fontSize: 11, color: 'var(--tx2)' }}>every parameter</span></Divider>
        <Collapse size="small" items={SCHEMA.map((g) => ({ key: g.panel, label: g.panel, children: g.items.map((it) => <Field key={it.key} it={it} opts={opts} setOpt={setOpt} />) }))} />
      </Drawer>

      {pt && (
        <div className="ptwin" onPointerDown={(e) => { if (e.target === e.currentTarget) closePt(); }}>
          <div className="ptframe" style={{ '--ar': pt.ar || 1.2, height: 'min(100vh, calc(100vw / var(--ar)))', aspectRatio: pt.ar || 1.2 }}
            onWheel={(e) => {                                              // zoom 1-4x about the cursor
              const r = e.currentTarget.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
              setPtView((v) => { const z2 = Math.max(1, Math.min(4, v.z * Math.exp(-e.deltaY * 0.0015))), k = z2 / v.z;
                return { z: z2, x: Math.min(0, Math.max(r.width * (1 - z2), cx - (cx - v.x) * k)), y: Math.min(0, Math.max(r.height * (1 - z2), cy - (cy - v.y) * k)) }; });
            }}
            onPointerDown={(e) => {
              if (e.target.closest('.ptui')) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX, y: e.clientY, v: ptView, moved: 0, focus: ptView.z === 1 || e.altKey };
              if (dragRef.current.focus && pt.status === 'done') focusFromEvent(e, e.currentTarget);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current; if (!d) return;
              d.moved = Math.max(d.moved, Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y));
              if (d.focus) { if (pt.status === 'done') focusFromEvent(e, e.currentTarget); return; }   // drag scrubs the focus
              const r = e.currentTarget.getBoundingClientRect(), z = d.v.z;
              setPtView({ z, x: Math.min(0, Math.max(r.width * (1 - z), d.v.x + e.clientX - d.x)), y: Math.min(0, Math.max(r.height * (1 - z), d.v.y + e.clientY - d.y)) });
            }}
            onPointerUp={(e) => {
              const d = dragRef.current; dragRef.current = null;
              if (d && !d.focus && d.moved < 4 && pt.status === 'done') focusFromEvent(e, e.currentTarget);   // a click focuses even when zoomed in
            }}
            onDoubleClick={() => setPtView({ z: 1, x: 0, y: 0 })}>
            {pt.status === 'error'
              ? <Alert type="error" showIcon message="The path tracer could not start" description={pt.err} style={{ margin: 16 }} />
              : <div ref={ptHost} className="ptpan" style={{ transform: `translate(${ptView.x}px, ${ptView.y}px) scale(${ptView.z})`, cursor: pt.status === 'done' && ptView.z === 1 ? 'crosshair' : ptView.z > 1 ? 'grab' : 'default' }} />}
            <div className="ptui top">
              {pt.status === 'error' && <Button size="small" onClick={() => { save(vp.current.snapshot()); closePt(); }}>Save plain capture</Button>}
              <Button size="small" type="primary" icon={<DownloadOutlined />} disabled={pt.status === 'error'} onClick={() => save(ptJob.current.url())}>PNG{pt.status === 'running' ? ` · ${pt.n} spp` : ''}</Button>
              <Button size="small" icon={<StopOutlined />} onClick={closePt}>{pt.status === 'done' ? 'Close' : 'Cancel'}</Button>
            </div>
            <div className="ptui bottom">
              <Progress percent={Math.round((100 * pt.n) / pt.spp)} size="small" showInfo={false} />
              {pt.status === 'done' && dof.span && (
                <>
                <div className="ptdof">
                  <span>Focus distance</span>
                  <Slider min={dof.span.near} max={dof.span.far} step={(dof.span.far - dof.span.near) / 400} value={Math.min(dof.span.far, Math.max(dof.span.near, dof.focus))} style={{ flex: 1, minWidth: 90 }} tooltip={{ open: false }}
                    onChange={(f) => setDof((d) => { ptJob.current.applyDof({ on: true, focus: f, maxPx: d.px }); return { ...d, on: true, focus: f }; })} />
                  <b>{Math.round(100 * (Math.min(dof.span.far, Math.max(dof.span.near, dof.focus)) - dof.span.near) / Math.max(1e-9, dof.span.far - dof.span.near))}%</b>
                </div>
                <div className="ptdof">
                  <span>Focal depth</span>
                  <Slider min={0} max={0.6} step={0.005} value={dof.sharp} style={{ flex: 1, minWidth: 90 }} tooltip={{ open: false }}
                    onChange={(sharp) => setDof((d) => { ptJob.current.applyDof({ on: true, focus: d.focus, maxPx: d.px, sharp }); return { ...d, on: true, sharp }; })} />
                  <b>{Math.round(dof.sharp * 100)}%</b>
                </div>
                <div className="ptdof">
                  <Switch size="small" checked={dof.on} onChange={(on) => setDof((d) => { ptJob.current.applyDof({ on, focus: d.focus, maxPx: d.px }); return { ...d, on }; })} />
                  <span>Depth of field</span>
                  <Slider min={0} max={256} step={1} value={dof.px} style={{ flex: 1, minWidth: 90 }} tooltip={{ open: false }}
                    onChange={(px) => setDof((d) => { ptJob.current.applyDof({ on: true, focus: d.focus, maxPx: px }); return { ...d, on: true, px }; })} />
                  <b>{dof.px}px</b>
                </div>
                </>
              )}
              <span>{pt.n} / {pt.spp} spp · {ptView.z.toFixed(1)}x · wheel to zoom{pt.status === 'done' ? ', click the image to focus there' : ''}{ptView.z > 1 ? ', drag to pan' : ''}, double-click to reset</span>
            </div>
          </div>
        </div>
      )}

      <Modal title="Parts" open={partsOpen} onCancel={() => setPartsOpen(false)} footer={null} width={760}>
        <Tabs items={[
          { key: 'bom', label: `Bill of materials${res ? ` (${mt.pieces})` : ''}`, children: res ? (
            <Table size="small" pagination={{ pageSize: 10, size: 'small' }} dataSource={bom} columns={[
              { title: 'part', dataIndex: 'id', width: 80 }, { title: 'name', dataIndex: 'name' }, { title: 'kind', dataIndex: 'kind', width: 80 },
              { title: 'colour', dataIndex: 'color', width: 160, render: (c, r) => <span><i className="sw" style={{ background: `rgb(${r.rgb})` }} />{c}</span> },
              { title: 'qty', dataIndex: 'count', width: 70, sorter: (a, b) => a.count - b.count, defaultSortOrder: 'descend' }]} />
          ) : <Alert message="Compute a model first" type="info" /> },
          { key: 'cat', label: `Catalogue (${catalogFor(opts).length} parts)`, children: (
            <Table size="small" pagination={{ pageSize: 10, size: 'small' }} dataSource={catalogFor(opts).map((c) => ({ key: c.id, id: c.id, name: c.name, kind: c.kind, size: `${c.w} x ${c.d} x ${c.h}`, studs: (c.stud_cells || []).length }))} columns={[
              { title: 'part', dataIndex: 'id', width: 90 }, { title: 'name', dataIndex: 'name' },
              { title: 'kind', dataIndex: 'kind', width: 90, filters: [...new Set(catalogFor(opts).map((c) => c.kind))].map((k) => ({ text: k, value: k })), onFilter: (v, r) => r.kind === v },
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
