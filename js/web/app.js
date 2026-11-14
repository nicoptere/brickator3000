// BrickPack Browser Studio: WebGPU SDF/packing compute + interactive WebGL2 viewport
import { loadModelBuffer, buildBricksMesh, exportGLB, exportLDR } from '../src/mesh_io.js';
import { deserializeCatalog, buildVariants, PACK_KINDS } from '../src/dictionary.js';
import { encodeSdfVolume, frameFor, targetField, octaves } from '../src/target.js';
import { packModelAsync } from '../src/engine.js';
import { createGPU } from '../src/gpu/index.js';
import { thickenThin } from '../src/thin.js';
import { packIoU } from '../src/pack.js';
import { fidelity } from '../src/metrics.js';
import { POLICY } from '../src/policy.js';
import { train } from '../src/ga.js';

const $ = (id) => document.getElementById(id);
const logBox = $('logBox');
const log = (msg) => {
  logBox.textContent = `${msg}\n` + logBox.textContent.slice(0, 4000);
};

let catalog = [];
let officialColors = [];
let gpuBackend = null;
let activeInput = null;     // { kind: 'mesh', model, label } | { kind: 'sdf', header, data, label }
let lastEncodedSdf = null;
let lastResult = null;
let customPolicy = null;

// ---------------- WebGL2 Minimal Interactive 3D Brick Renderer ----------------
class BrickViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true });
    this.yaw = 0.65;
    this.pitch = 0.42;
    this.dist = 3.2;
    this.target = [0, 0.4, 0];
    this.showEdges = true;
    this.showGrid = true;
    this.mesh = null;
    this.gridVao = null;
    this.gridCount = 0;
    this.initShaders();
    this.initGrid();
    this.bindEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  compile(type, src) {
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  link(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  initShaders() {
    const triVs = `#version 300 es
      layout(location=0) in vec3 aPos;
      layout(location=1) in vec3 aCol;
      uniform mat4 uMVP;
      out vec3 vPos;
      out vec3 vCol;
      void main() {
        vPos = aPos;
        vCol = aCol;
        gl_Position = uMVP * vec4(aPos, 1.0);
      }`;
    const triFs = `#version 300 es
      precision highp float;
      in vec3 vPos;
      in vec3 vCol;
      out vec4 outColor;
      void main() {
        vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
        vec3 l1 = normalize(vec3(0.55, 0.85, 0.45));
        vec3 l2 = normalize(vec3(-0.6, 0.35, -0.5));
        float diff = max(dot(n, l1), 0.0) * 0.72 + max(dot(n, l2), 0.0) * 0.25 + 0.28;
        vec3 col = pow(clamp(vCol * diff, 0.0, 1.0), vec3(1.0 / 1.05));
        outColor = vec4(col, 1.0);
      }`;
    const lineVs = `#version 300 es
      layout(location=0) in vec3 aPos;
      uniform mat4 uMVP;
      void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;
    const lineFs = `#version 300 es
      precision highp float;
      uniform vec4 uColor;
      out vec4 outColor;
      void main() { outColor = uColor; }`;
    this.triProg = this.link(triVs, triFs);
    this.lineProg = this.link(lineVs, lineFs);
  }

  initGrid() {
    const gl = this.gl;
    const pts = [];
    const N = 20, step = 0.2;
    for (let i = -N; i <= N; i++) {
      const p = i * step, e = N * step;
      pts.push(-e, 0, p, e, 0, p, p, 0, -e, p, 0, e);
    }
    this.gridCount = pts.length / 3;
    this.gridVao = gl.createVertexArray();
    gl.bindVertexArray(this.gridVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  setGeometry(pos, colNorm, idx, edges = null, centerScale = true) {
    const gl = this.gl;
    if (this.mesh) {
      gl.deleteVertexArray(this.mesh.vao);
      if (this.mesh.edgeVao) gl.deleteVertexArray(this.mesh.edgeVao);
    }
    const nv = pos.length / 3;
    let cx = 0, yMin = Infinity, yMax = -Infinity, cz = 0;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < nv; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    cx = 0.5 * (x0 + x1); cz = 0.5 * (z0 + z1);
    const maxSpan = Math.max(1e-5, x1 - x0, yMax - yMin, z1 - z0);
    const sc = centerScale ? 1.8 / maxSpan : 1.0;

    const scaledPos = new Float32Array(pos.length);
    for (let i = 0; i < nv; i++) {
      scaledPos[3 * i] = (pos[3 * i] - cx) * sc;
      scaledPos[3 * i + 1] = (pos[3 * i + 1] - yMin) * sc;
      scaledPos[3 * i + 2] = (pos[3 * i + 2] - cz) * sc;
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, scaledPos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, colNorm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    let count = nv, indexed = false;
    if (idx && idx.length) {
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      count = idx.length;
      indexed = true;
    }
    gl.bindVertexArray(null);

    let edgeVao = null, edgeCount = 0;
    if (edges && edges.length) {
      const scEdges = new Float32Array(edges.length);
      for (let i = 0; i < edges.length; i += 3) {
        scEdges[i] = (edges[i] - cx) * sc;
        scEdges[i + 1] = (edges[i + 1] - yMin) * sc;
        scEdges[i + 2] = (edges[i + 2] - cz) * sc;
      }
      edgeCount = scEdges.length / 3;
      edgeVao = gl.createVertexArray();
      gl.bindVertexArray(edgeVao);
      const eb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, eb);
      gl.bufferData(gl.ARRAY_BUFFER, scEdges, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this.mesh = { vao, count, indexed, edgeVao, edgeCount };
    this.target = [0, 0.5 * (yMax - yMin) * sc, 0];
    this.dist = 3.0;
    this.draw();
  }

  setSourceModel(model) {
    const nv = model.tris.length / 3;
    const cols = new Float32Array(nv * 3);
    for (let i = 0; i < cols.length; i++) cols[i] = Math.pow(Math.max(0, Math.min(1, model.vcols[i])), 1 / 2.2);
    this.setGeometry(model.tris, cols, null, null, true);
  }

  setBricksMesh(mesh) {
    const colF = new Float32Array(mesh.col.length);
    for (let i = 0; i < mesh.col.length; i++) colF[i] = mesh.col[i] / 255;
    this.setGeometry(mesh.pos, colF, mesh.idx, mesh.edges, true);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  mvp() {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const f = 1 / Math.tan(0.38), near = 0.05, far = 50;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const ex = this.target[0] + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw);
    const ey = this.target[1] + this.dist * Math.sin(this.pitch);
    const ez = this.target[2] + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw);
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const zAxis = norm([ex - this.target[0], ey - this.target[1], ez - this.target[2]]);
    const xAxis = norm(cross([0, 1, 0], zAxis));
    const yAxis = cross(zAxis, xAxis);
    const view = [
      xAxis[0], yAxis[0], zAxis[0], 0,
      xAxis[1], yAxis[1], zAxis[1], 0,
      xAxis[2], yAxis[2], zAxis[2], 0,
      -dot(xAxis, [ex, ey, ez]), -dot(yAxis, [ex, ey, ez]), -dot(zAxis, [ex, ey, ez]), 1,
    ];
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = proj[r] * view[c * 4] + proj[4 + r] * view[c * 4 + 1] + proj[8 + r] * view[c * 4 + 2] + proj[12 + r] * view[c * 4 + 3];
      }
    }
    return out;
  }

  draw() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.118, 0.133, 0.169, 1); // #1e222b per GEMINI.md
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const mvp = this.mvp();

    if (this.showGrid) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uMVP'), false, mvp);
      gl.uniform4f(gl.getUniformLocation(this.lineProg, 'uColor'), 0.24, 0.28, 0.35, 1.0);
      gl.bindVertexArray(this.gridVao);
      gl.drawArrays(gl.LINES, 0, this.gridCount);
    }

    if (this.mesh) {
      gl.useProgram(this.triProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.triProg, 'uMVP'), false, mvp);
      gl.bindVertexArray(this.mesh.vao);
      if (this.mesh.indexed) gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, this.mesh.count);

      if (this.showEdges && this.mesh.edgeVao) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.useProgram(this.lineProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uMVP'), false, mvp);
        gl.uniform4f(gl.getUniformLocation(this.lineProg, 'uColor'), 0.08, 0.10, 0.14, 0.7);
        gl.bindVertexArray(this.mesh.edgeVao);
        gl.drawArrays(gl.LINES, 0, this.mesh.edgeCount);
      }
    }
  }

  bindEvents() {
    let dragging = false, btn = 0, lx = 0, ly = 0;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => { dragging = true; btn = e.button; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (btn === 2) {
        this.target[1] = Math.min(2, Math.max(-1, this.target[1] + dy * 0.004));
      } else {
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.008));
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(0.9, Math.min(12, this.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
  }
}

const viewer = new BrickViewer($('glCanvas'));
$('toggleEdges').onchange = (e) => { viewer.showEdges = e.target.checked; };
$('toggleGrid').onchange = (e) => { viewer.showGrid = e.target.checked; };
$('studsRange').oninput = (e) => { $('studsVal').textContent = e.target.value; };

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function loadSampleUrl(url) {
  document.querySelectorAll('[data-sample]').forEach((b) => b.classList.toggle('selected', b.dataset.sample === url));
  log(`Loading ${url}...`);
  const res = await fetch(url);
  const ab = await res.arrayBuffer();
  const model = await loadModelBuffer(url, ab);
  const label = url.split('/').pop();
  activeInput = { kind: 'mesh', model, label };
  lastEncodedSdf = null;
  lastResult = null;
  $('modelName').textContent = `${label} (${model.tris.length / 9} tris)`;
  $('btnDownloadSdf').disabled = true;
  $('btnDownloadGlb').disabled = true;
  $('btnDownloadLdr').disabled = true;
  viewer.setSourceModel(model);
  log(`Loaded ${label}: ${model.tris.length / 9} tris, hasColor=${model.hasColor}`);
}

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', () => loadSampleUrl(btn.dataset.sample));
});

const dropZone = $('dropZone');
dropZone.onclick = () => $('fileInput').click();
dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag'); };
dropZone.ondragleave = () => dropZone.classList.remove('drag');
dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('drag'); handleFiles(e.dataTransfer.files); };
$('fileInput').onchange = (e) => handleFiles(e.target.files);

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const jsonFile = files.find((f) => f.name.endsWith('.sdf.json'));
  const binFile = files.find((f) => f.name.endsWith('.bin'));
  if (jsonFile && binFile) {
    const header = JSON.parse(await jsonFile.text());
    const buf = await binFile.arrayBuffer();
    const data = new Float32Array(buf);
    activeInput = { kind: 'sdf', header, data, label: jsonFile.name };
    lastEncodedSdf = { header, data };
    $('modelName').textContent = `${jsonFile.name} (${header.nx}x${header.ny}x${header.nz})`;
    $('btnDownloadSdf').disabled = false;
    log(`Loaded pre-encoded SDF ${jsonFile.name}`);
    return;
  }
  const f = files[0];
  const ab = await f.arrayBuffer();
  const model = await loadModelBuffer(f.name, ab);
  activeInput = { kind: 'mesh', model, label: f.name };
  $('modelName').textContent = `${f.name} (${model.tris.length / 9} tris)`;
  viewer.setSourceModel(model);
  log(`Loaded local model ${f.name}`);
}

$('btnEncodeSdf').onclick = async () => {
  if (!activeInput || activeInput.kind !== 'mesh') return log('Load an OBJ/GLB/PLY mesh first.');
  $('progressFill').style.width = '20%';
  lastEncodedSdf = await encodeSdfVolume(activeInput.model, { res: 48, gpu: gpuBackend, log });
  $('progressFill').style.width = '100%';
  $('btnDownloadSdf').disabled = false;
};

$('btnDownloadSdf').onclick = () => {
  if (!lastEncodedSdf) return;
  const stem = (activeInput?.label || 'model').replace(/\.[^.]+$/, '');
  const hdr = { ...lastEncodedSdf.header, binFile: `${stem}.sdf.bin` };
  downloadBlob(new Blob([JSON.stringify(hdr, null, 2)], { type: 'application/json' }), `${stem}.sdf.json`);
  downloadBlob(new Blob([lastEncodedSdf.data], { type: 'application/octet-stream' }), `${stem}.sdf.bin`);
};

function renderPacked() {
  if (!lastResult) return;
  const colorMode = $('colorSelect').value;
  const mesh = buildBricksMesh(lastResult.pieces, catalog, { colorMode });
  viewer.setBricksMesh(mesh);
}

$('colorSelect').onchange = renderPacked;

$('btnPack').onclick = async () => {
  if (!activeInput || !catalog.length) return;
  $('btnPack').disabled = true;
  $('progressFill').style.width = '5%';
  try {
    const input = activeInput.kind === 'sdf' ? { header: activeInput.header, data: activeInput.data } : activeInput.model;
    lastResult = await packModelAsync(input, {
      studs: Number($('studsRange').value),
      effort: $('effortSelect').value,
      catalog,
      colors: officialColors,
      policy: customPolicy || undefined,
      gpu: gpuBackend,
      log,
      progress: (_st, f) => { $('progressFill').style.width = `${Math.round(f * 100)}%`; },
    });
    $('statPieces').textContent = lastResult.pack.pieces;
    $('statIoU').textContent = lastResult.pack.softIoU.toFixed(3);
    $('statComp').textContent = lastResult.pack.components;
    $('statTime').textContent = `${lastResult.pack.ms.total} ms`;
    $('btnDownloadGlb').disabled = false;
    $('btnDownloadLdr').disabled = false;
    renderPacked();
  } finally {
    $('btnPack').disabled = false;
  }
};

$('btnDownloadGlb').onclick = () => {
  if (!lastResult) return;
  const mesh = buildBricksMesh(lastResult.pieces, catalog, { colorMode: $('colorSelect').value });
  const stem = (activeInput?.label || 'model').replace(/\.[^.]+$/, '');
  downloadBlob(new Blob([exportGLB(mesh)], { type: 'model/gltf-binary' }), `${stem}_bricks.glb`);
};

$('btnDownloadLdr').onclick = () => {
  if (!lastResult) return;
  const stem = (activeInput?.label || 'model').replace(/\.[^.]+$/, '');
  downloadBlob(new Blob([exportLDR(lastResult.pieces, catalog, stem)], { type: 'text/plain' }), `${stem}_bricks.ldr`);
};

$('btnTuneGa').onclick = async () => {
  if (!activeInput || activeInput.kind !== 'mesh') return log('Load a mesh to tune GA policy.');
  $('btnTuneGa').disabled = true;
  log('Running browser GA policy tuning (pop=4, gens=2)...');
  try {
    const { byKey, list } = buildVariants(catalog, { kinds: PACK_KINDS });
    const frame = frameFor(activeInput.model, Math.min(12, Number($('studsRange').value)));
    const T = targetField(activeInput.model, frame);
    const thin = thickenThin(T);
    const TP = thin.added ? { ...T, t: thin.t } : T;
    const F = octaves(TP, [0, 1.5, 3, 6]);
    const state = await train({
      batch: [{ name: activeInput.label, studs: frame.studs }],
      pop: 4,
      gens: 2,
      seedGenomes: [POLICY],
      evaluate: async (genes) => {
        const pol = { ...POLICY, ...genes, lnsIters: 400, lnsPasses: 2 };
        const best = packIoU(TP, F, list, { policy: pol, objective: 'iou', thetaIters: 2, thetaLns: 100, phase: thin.added ? thin.phase : null, measure: (pcs, ph) => fidelity(pcs, byKey, TP, ph).softIoU });
        const m = fidelity(best.r.pieces, byKey, T, best.r.phase);
        return { softIoU: m.softIoU, components: m.components, pieces: m.pieces };
      },
      log,
    });
    customPolicy = state.best.genes;
    log(`GA finished! Best fitness=${state.best.fitness}, lambda=${customPolicy.lambda}`);
  } finally {
    $('btnTuneGa').disabled = false;
  }
};

async function init() {
  const [catRes, colRes, gpu] = await Promise.all([
    fetch('/dataset/catalog_99.json').then((r) => r.json()),
    fetch('/dataset/colors.json').then((r) => r.json()),
    createGPU().catch(() => null),
  ]);
  catalog = deserializeCatalog(catRes);
  officialColors = colRes.colors || colRes;
  gpuBackend = gpu;
  $('badgeCatalog').textContent = `Catalog: ${catalog.length} LDraw parts`;
  $('badgeCatalog').classList.add('active');
  $('badgeBackend').textContent = `Compute: ${gpu ? gpu.label : 'CPU Float64'}`;
  if (gpu) $('badgeBackend').classList.add('active');
  await loadSampleUrl('/dataset/models/stanford_bunny.glb');
  $('btnPack').click();
}

init().catch((e) => log(`Init error: ${e.message}`));
