// Studio viewport: the look of the original app (dark #1e222b stage, grid, soft shadows, ACES) with the LEGO model drawn as THREE.InstancedMesh
// (one per part x rotation, one for the visible studs) in a cell-shaded (toon) material plus ink outlines. Pieces pop in with a small spring when revealed.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { template, pieceOrigin, KIND_COL } from '../brickgen/export.js';
import { STUD, PLATE } from '../brickgen/constants.js';
import { smoothNormals } from './meshtools.js';
import { cycloDims, cycloGeometry, cycloMaterial } from './cyclo.js';

const S = 1 / STUD;                                     // LDU -> world units (1 unit = 1 stud pitch)
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function toonGradient(steps = 4) {
  const d = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) d[i] = Math.round(255 * (0.36 + 0.64 * i / (steps - 1)));
  const t = new THREE.DataTexture(d, steps, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
/** average the (flat) normals of coincident vertices: displacing along these inflates a hard-edged mesh without opening gaps at its edges */
function withSmoothNormals(g) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), acc = new Map(), key = (i) => `${Math.round(pos.getX(i) * 50)},${Math.round(pos.getY(i) * 50)},${Math.round(pos.getZ(i) * 50)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i); let a = acc.get(k); if (!a) acc.set(k, a = [0, 0, 0]); a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l; }
  const h = g.clone(); h.setAttribute('aSmooth', new THREE.BufferAttribute(out, 3)); return h;
}
const studGeometry = () => { const g = new THREE.CylinderGeometry(6, 6, 4, 14); g.translate(0, 2, 0); return g; };

export class StudioViewport {
  constructor(el) {
    this.el = el;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x1e222b);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000); this.camera.position.set(16, 14, 20);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.05; this.controls.minDistance = 2; this.controls.maxDistance = 80; this.controls.maxPolarAngle = Math.PI / 2 + 0.35;
    this.controls.target.set(0, 4, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222630, 0.85));
    this.key = new THREE.DirectionalLight(0xffffff, 1.4); this.key.position.set(20, 35, 25); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0001; this.key.shadow.normalBias = 0.02; this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x90b0e0, 0.5); fill.position.set(-20, 20, -15); this.scene.add(fill);
    this.cyclo = new THREE.Mesh(cycloGeometry(20), cycloMaterial(true)); this.cyclo.receiveShadow = true; this.cyclo.position.y = -0.01; this.scene.add(this.cyclo);
    this.cycloSize = 20; this.maxCam = 80;

    this.world = new THREE.Group(); this.world.scale.setScalar(S); this.scene.add(this.world);   // everything inside is in LDU
    this.buildGizmo();
    this.src = new THREE.Group(); this.lego = new THREE.Group(); this.world.add(this.src, this.lego);
    this.gradient = toonGradient(4);
    this.toon = new THREE.MeshToonMaterial({ gradientMap: this.gradient, color: 0xffffff, side: THREE.DoubleSide });
    this.studMat = new THREE.MeshToonMaterial({ gradientMap: this.gradient, color: 0xffffff, side: THREE.DoubleSide });
    this.hullThick = 1; this.hulls = [];
    this.hullMat = new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide });
    this.hullMat.onBeforeCompile = (sh) => {            // inverted hull: back faces, pushed out along the smoothed normal, drawn black behind the coloured front faces
      sh.uniforms.uThick = { value: this.hullThick }; this.hullShader = sh;
      sh.vertexShader = 'attribute vec3 aSmooth;\nuniform float uThick;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(aSmooth) * uThick;');
    };
    this.dark = true;
    this.smooth = true;
    this.mode = 'lego'; this.outline = true; this.colorMode = 'piece'; this.active = new Map(); this.pieces = null; this.revealed = 0; this.W = 20 * 16; this.D = 20 * 16; this.H = 0;
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    this.islandLabels = null; this.selectedIsland = null; this.onSelectIsland = null;
    this.hollow = null; this.hollowTimer = null;
    this.selectMode = false; this.sel = null; this.onSelectionChange = null;
    let downPos = null;
    const dom = this.renderer.domElement;
    const local = (e) => { const r = dom.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    dom.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
      const [px, py] = local(e);
      if (e.button === 0 && this.gizmoClick(px, py)) { downPos = null; return; }     // the corner gizmo takes the click first
      if (e.button === 0 && this.selectMode) { dom.setPointerCapture(e.pointerId); this.beginMarquee(px, py); }
    });
    dom.addEventListener('pointerup', (e) => {
      if (this._mq) {
        const mode = e.ctrlKey || e.metaKey || e.shiftKey ? 'add' : e.altKey ? 'sub' : 'set';
        const n = this.endMarquee(mode); this.onSelectionChange && this.onSelectionChange(n);
        downPos = null; return;
      }
      if (!downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y), dt = performance.now() - downPos.t;
      downPos = null;
      if (dist > 5 || dt > 450) return;
      this.handlePointerClick(e);
    });
    dom.addEventListener('dblclick', () => { if (this.selectMode) { const n = this.clearSelection(); this.onSelectionChange && this.onSelectionChange(n); } });
    dom.addEventListener('pointermove', (e) => { if (this._mq) { const [px, py] = local(e); this.moveMarquee(px, py); return; } this.handlePointerHover(e); });
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    this.frames = 0; this.t0 = performance.now(); this.fps = 0;
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }
  handlePointerHover(e) {
    if (!this.srcMesh || !this.src.visible || this.colorMode !== 'islands') {
      if (this.renderer.domElement.style.cursor === 'pointer') this.renderer.domElement.style.cursor = '';
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObject(this.srcMesh, false);
    this.renderer.domElement.style.cursor = hits.length > 0 && typeof hits[0].faceIndex === 'number' ? 'pointer' : '';
  }
  handlePointerClick(e) {
    if (!this.srcMesh || !this.src.visible) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObject(this.srcMesh, false);
    if (hits.length > 0 && typeof hits[0].faceIndex === 'number') {
      const faceIndex = hits[0].faceIndex;
      const islandId = this.islandLabels ? this.islandLabels[faceIndex] : null;
      this.onSelectIsland && this.onSelectIsland(islandId, faceIndex);
    } else {
      this.onSelectIsland && this.onSelectIsland(null);
    }
  }
  setHullThickness(t) { this.hullThick = t; if (this.hullShader) this.hullShader.uniforms.uThick.value = t; }
  setTheme(dark) {
    this.dark = dark; this.scene.background = new THREE.Color(dark ? 0x1e222b : 0xe9edf3);
    this.hullMat.color.set(dark ? 0x05070a : 0x10131a);
    this.cyclo.material.color.set(dark ? 0x2b303b : 0xd9dde5);
  }
  resize() { const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.clearLego(); this.clearGroup(this.src); this.clearVoxels(); this.clearHollowCubes(); this.renderer.dispose(); this.el.innerHTML = ''; this.studMat && this.studMat.dispose(); }
  clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); if (c.material && c.material !== this.toon && c.material !== this.studMat && c.material !== this.hullMat) c.material.dispose(); } }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.camera.position.y < 0.25) { this.camera.position.y = 0.25; }          // always above the ground
    this.stepAnimations(now); this.stepVoxels(now); this.stepHollowCubes(now);
    if (!this.paused) { this.renderer.render(this.scene, this.camera); this.renderGizmo(); }
  }

  // ------------------------------------------------------------- source mesh
  /** tris in LDU of the result frame (aligned with the LEGO model) or raw tris of a freshly opened file (fitted to ~24 studs) */
  setSource(tris, cols, { raw = false, keepScale = false } = {}) {
    this.clearGroup(this.src);
    let t = tris;
    if (raw) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < tris.length; k += 3) for (let a = 0; a < 3; a++) { const v = tris[k + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
      let k, baseLo;
      if (keepScale && this.rawScale) {
        baseLo = this.rawScale.lo;
        k = this.rawScale.k;
      } else {
        baseLo = lo;
        k = 24 * STUD / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
        this.rawScale = { lo: [...lo], k };
      }
      t = new Float32Array(tris.length);
      for (let i = 0; i < tris.length; i += 3) {
        t[i] = (tris[i] - baseLo[0]) * k;
        t[i + 1] = (tris[i + 1] - baseLo[1]) * k;
        t[i + 2] = (tris[i + 2] - baseLo[2]) * k;
      }
      this.W = (hi[0] - lo[0]) * k; this.D = (hi[2] - lo[2]) * k; this.H = (hi[1] - lo[1]) * k;
      this.clearLego(); this.lego.position.set(0, 0, 0);
    }
    this.srcPos = t; this.clearVoxels(); this.clearHollowCubes();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t, 3)); g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(cols), 3)); g.computeVertexNormals();
    this.srcCols = cols;
    this.srcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, this.srcMat); m.castShadow = true; m.receiveShadow = true; this.src.add(m); this.srcGeo = g; this.srcMesh = m;
    if (!raw) { g.computeBoundingBox(); }
    this.flatN = Float32Array.from(g.attributes.normal.array); this.smoothN = null;
    this.paintSource(); this.applySmooth();
    this.applyMode();
    if (raw && !keepScale) this.zoomToFit(false);
  }


  // ------------------------------------------------------------- voxel preview & hollow cubes (resolution feedback)
  computeGridCells(studs, ref = 'min3') {
    const t = this.srcPos; if (!t || !t.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < t.length; k += 3) for (let a = 0; a < 3; a++) { const v = t[k + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const base = ref === 'min3' ? Math.min(...ext) : Math.max(ext[0], ext[2]);
    const u = base / studs, uy = u * (3 * PLATE) / STUD;                                  // cell footprint = 1 stud, height = 1 brick
    const nx = Math.ceil(ext[0] / u) + 1, ny = Math.ceil(ext[1] / uy) + 1, nz = Math.ceil(ext[2] / u) + 1;
    const set = new Set(), mark = (x, y, z) => {
      const i = Math.min(nx - 1, Math.floor((x - lo[0]) / u)), j = Math.min(ny - 1, Math.floor((y - lo[1]) / uy)), k = Math.min(nz - 1, Math.floor((z - lo[2]) / u));
      set.add((i * ny + j) * nz + k);
    };
    for (let k = 0; k < t.length; k += 9) {                                               // dense barycentric sampling of every triangle
      const ax = t[k], ay = t[k + 1], az = t[k + 2], bx = t[k + 3], by = t[k + 4], bz = t[k + 5], cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
      const L = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
      const n = Math.min(60, Math.max(1, Math.ceil(L / (Math.min(u, uy) * 0.5))));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const a = i / n, b = j / n, c = 1 - a - b;
        mark(ax * c + bx * a + cx * b, ay * c + by * a + cy * b, az * c + bz * a + cz * b);
      }
      if (set.size > 60000) break;
    }
    return { set, lo, hi, u, uy, nx, ny, nz };
  }

  /** white blocks of one grid unit (1 stud x 1 brick x 1 stud) covering the source surface at `studs` resolution; they grow from the centre in a wave, hold, then shrink away in the same wave */
  voxelPreview(studs, ref = 'min3', repeat = false, immediate = false) {
    const t = this.srcPos; if (!t || !t.length) return Promise.resolve();
    clearTimeout(this.voxTimer);
    this.clearHollowCubes();
    if (this.vox && this.vox.resolve) { const cb = this.vox.resolve; this.vox.resolve = null; cb(); }
    return new Promise((resolve) => {
      if (immediate || repeat) {
        this.buildVoxels(studs, ref, repeat, resolve);
      } else {
        this.voxTimer = setTimeout(() => this.buildVoxels(studs, ref, false, resolve), 90);                 // debounce while the slider is dragged
      }
    });
  }
  clearVoxels() {
    clearTimeout(this.voxTimer);
    if (this.vox) {
      const cb = this.vox.resolve;
      this.vox.resolve = null;
      this.world.remove(this.vox.mesh);
      this.vox.mesh.geometry.dispose();
      this.vox = null;
      cb && cb();
    }
  }
  buildVoxels(studs, ref, repeat = false, onDone = null) {
    this.clearHollowCubes();
    const g = this.computeGridCells(studs, ref);
    if (!g || !g.set.size) { onDone && onDone(); return; }
    const { set, lo, hi, u, uy, nx, ny, nz } = g;
    this.clearVoxels();
    const N = set.size;
    const geo = new THREE.BoxGeometry(u, uy, u);
    const mat = new THREE.MeshToonMaterial({ gradientMap: this.gradient, color: 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, N); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const pos = new Float32Array(N * 3), dist = new Float32Array(N);
    const cen = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let q = 0, dmax = 1e-9;
    for (const key of set) {
      const k = key % nz, j = Math.floor(key / nz) % ny, i = Math.floor(key / (nz * ny));
      const x = lo[0] + (i + 0.5) * u, y = lo[1] + (j + 0.5) * uy, z = lo[2] + (k + 0.5) * u;
      pos[q * 3] = x; pos[q * 3 + 1] = y; pos[q * 3 + 2] = z;
      dist[q] = Math.hypot(x - cen[0], (y - cen[1]) * 0.8, z - cen[2]); if (dist[q] > dmax) dmax = dist[q]; q++;
    }
    for (let n = 0; n < N; n++) dist[n] /= dmax;
    this.world.add(mesh);
    this.vox = { mesh, pos, dist, N, t0: performance.now(), dummy: new THREE.Object3D(), repeat, resolve: onDone };
  }
  stepVoxels(now) {
    const v = this.vox; if (!v) return;
    // Two waves, both leaving the centre: cells grow in, then shrink away. The out wave starts at
    // OUT_AT of the fill time, so the centre is already fading while the rim is still arriving.
    const WAVE = 650, GROW = 380, FILL = WAVE + GROW, OUT_AT = 0.25;
    const T = now - v.t0, OUT0 = FILL * OUT_AT, END = OUT0 + FILL;
    if (T > END) {
      if (v.repeat) {
        v.t0 = now;
      } else {
        this.clearVoxels();
        return;
      }
    }
    const { dummy, mesh, pos, dist, N } = v;
    for (let n = 0; n < N; n++) {
      const d = dist[n] * WAVE;                                                           // this cell's place in the wave
      const gi = easeOutBack(Math.min(1, Math.max(0, (T - d) / GROW)));                   // growing in (slight overshoot)
      const go = Math.min(1, Math.max(0, (T - OUT0 - d) / GROW));                         // shrinking away
      const s = Math.max(0, Math.min(1.08, gi)) * (1 - go * go) * 0.94;
      dummy.position.set(pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]); dummy.scale.setScalar(s); dummy.updateMatrix(); mesh.setMatrixAt(n, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------- white hollow cubes (resolution setting change)
  hollowPreview(studs, ref = 'min3', immediate = false) {
    const t = this.srcPos; if (!t || !t.length) return;
    clearTimeout(this.hollowTimer);
    if (immediate) {
      this.buildHollowCubes(studs, ref);
    } else {
      this.hollowTimer = setTimeout(() => this.buildHollowCubes(studs, ref), 35);
    }
  }
  clearHollowCubes() {
    clearTimeout(this.hollowTimer);
    if (this.hollow) {
      this.world.remove(this.hollow.mesh);
      this.hollow.geo.dispose();
      this.hollow.mat.dispose();
      this.hollow = null;
    }
  }
  buildHollowCubes(studs, ref = 'min3') {
    this.clearVoxels();
    this.clearHollowCubes();
    const g = this.computeGridCells(studs, ref);
    if (!g || !g.set.size) return;
    const { set, lo, u, uy, nx, ny, nz } = g;

    const S_k = nz + 2;
    const S_j = (ny + 2) * S_k;
    const S_i = (nx + 2) * S_j;
    const edgesSet = new Set();

    for (const key of set) {
      const k = key % nz, j = Math.floor(key / nz) % ny, i = Math.floor(key / (nz * ny));
      // 4 edges along X (dir = 0)
      edgesSet.add(0 * S_i + i * S_j + j * S_k + k);
      edgesSet.add(0 * S_i + i * S_j + (j + 1) * S_k + k);
      edgesSet.add(0 * S_i + i * S_j + j * S_k + (k + 1));
      edgesSet.add(0 * S_i + i * S_j + (j + 1) * S_k + (k + 1));

      // 4 edges along Y (dir = 1)
      edgesSet.add(1 * S_i + i * S_j + j * S_k + k);
      edgesSet.add(1 * S_i + (i + 1) * S_j + j * S_k + k);
      edgesSet.add(1 * S_i + i * S_j + j * S_k + (k + 1));
      edgesSet.add(1 * S_i + (i + 1) * S_j + j * S_k + (k + 1));

      // 4 edges along Z (dir = 2)
      edgesSet.add(2 * S_i + i * S_j + j * S_k + k);
      edgesSet.add(2 * S_i + (i + 1) * S_j + j * S_k + k);
      edgesSet.add(2 * S_i + i * S_j + (j + 1) * S_k + k);
      edgesSet.add(2 * S_i + (i + 1) * S_j + (j + 1) * S_k + k);
    }

    const numEdges = edgesSet.size;
    const positions = new Float32Array(numEdges * 6);
    let ptr = 0;
    for (const edgeKey of edgesSet) {
      const gk = edgeKey % S_k;
      const gj = Math.floor(edgeKey / S_k) % (ny + 2);
      const gi = Math.floor(edgeKey / S_j) % (nx + 2);
      const dir = Math.floor(edgeKey / S_i);

      const x0 = lo[0] + gi * u;
      const y0 = lo[1] + gj * uy;
      const z0 = lo[2] + gk * u;

      positions[ptr++] = x0;
      positions[ptr++] = y0;
      positions[ptr++] = z0;
      positions[ptr++] = dir === 0 ? x0 + u : x0;
      positions[ptr++] = dir === 1 ? y0 + uy : y0;
      positions[ptr++] = dir === 2 ? z0 + u : z0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    this.world.add(mesh);
    this.hollow = { mesh, mat, geo, t0: performance.now(), hold: 1000, fade: 350 };
  }
  stepHollowCubes(now) {
    const h = this.hollow; if (!h) return;
    const dt = now - h.t0;
    if (dt < h.hold) {
      h.mat.opacity = 1.0;
    } else if (dt < h.hold + h.fade) {
      const f = (dt - h.hold) / h.fade;
      h.mat.opacity = Math.max(0, 1.0 - f);
    } else {
      this.clearHollowCubes();
    }
  }

  // ------------------------------------------------------------- LEGO (instanced)
  clearLego() { this.clearGroup(this.lego); this.groups = []; this.hulls = []; this.active.clear(); this.pieces = null; this.pe = null; this.revealed = 0; }

  setLego(pieces, cat, dims) {
    this.clearLego();
    this._lego = { pieces, cat, dims };
    const by = {}; for (const c of cat) by[c.id] = c;
    const P = pieces.map((p, n) => ({ p, n })).sort((a, b) => a.p.b - b.p.b || a.n - b.n).map((x) => x.p);
    this.pieces = P; this.levels = P.length ? Math.max(...P.map((p) => p.b + p.h)) : 0;
    this.W = dims[0] * STUD; this.D = dims[1] * STUD; this.H = dims[2] * PLATE;
    // Studs covered by the piece above are normally left out of the geometry. For the instruction booklet they must exist: a
    // plate whose studs are only covered LATER would otherwise be drawn bare in the early steps and read as a tile.
    // Keeping them costs nothing visually - a covered stud sits inside the brick above it.
    const occ = new Set();
    if (!this.allStuds) for (const p of P) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) occ.add(`${p.i + dx},${p.j + dz},${p.b + l}`);
    const buckets = new Map(), studs = [];
    P.forEach((p, n) => {
      const key = `${p.id}|${p.rot}`; let b = buckets.get(key);
      if (!b) { b = { t: template(by[p.id], p.rot), list: [] }; buckets.set(key, b); }
      b.list.push(n);
      const [ox, oy, oz] = pieceOrigin(p), top = p.b + p.h;
      for (const [x, y, z] of b.t.studs) if (!occ.has(`${Math.floor((x + ox) / STUD)},${Math.floor((z + oz) / STUD)},${top}`)) studs.push([n, ox + x, oy + y, oz + z]);
    });
    this.pe = new Array(P.length);                      // per piece: [{mesh, k}] parts that move with it
    const dummy = new THREE.Object3D();
    for (const [, b] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.t.pos, 3)); g.setIndex(new THREE.BufferAttribute(b.t.idx, 1));
      const ng = g.toNonIndexed(); g.dispose(); ng.computeVertexNormals();               // flat normals: crisp toon bands
      const mesh = new THREE.InstancedMesh(ng, this.toon, b.list.length); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.pieces = b.list;
      b.list.forEach((n, k) => { const o = pieceOrigin(P[n]); dummy.position.set(o[0], o[1], o[2]); dummy.scale.setScalar(1); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix); (this.pe[n] = this.pe[n] || []).push({ mesh, k, base: o }); });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.lego.add(mesh); this.groups.push(mesh); this.addHull(mesh);
    }
    if (studs.length) {
      const mesh = new THREE.InstancedMesh(studGeometry(), this.studMat, studs.length); mesh.castShadow = true; mesh.userData.pieces = studs.map((s) => s[0]);
      studs.forEach(([n, x, y, z], k) => { dummy.position.set(x, y, z); dummy.scale.setScalar(1); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix); (this.pe[n] = this.pe[n] || []).push({ mesh, k, base: [x, y, z] }); });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.lego.add(mesh); this.groups.push(mesh); this.addHull(mesh);
    }
    this.vis = new Uint8Array(P.length).fill(1); this.revealed = P.length;
    this.sel = new Uint8Array(P.length);
    this.setColorMode(this.colorMode);
    this.setOutline(this.outline);
    this.applyMode();
    this.zoomToFit(true);
  }

  /** black back-face shell sharing the instance matrices of `mesh` (so pop-in / hiding follows for free) */
  addHull(mesh) {
    const h = new THREE.InstancedMesh(withSmoothNormals(mesh.geometry), this.hullMat, mesh.count);
    h.instanceMatrix = mesh.instanceMatrix; h.frustumCulled = false; h.visible = this.outline; h.renderOrder = -1;
    this.lego.add(h); this.hulls.push(h);
  }
  /** smooth: welded geometry.computeVertexNormals() + smooth shading; off: per-face normals + flat shading */
  setSmooth(on) { this.smooth = !!on; this.applySmooth(); }
  applySmooth() {
    if (!this.srcGeo) return;
    const on = !!this.smooth;
    if (on && !this.smoothN) this.smoothN = smoothNormals(this.srcPos);
    const a = this.srcGeo.getAttribute('normal'), n = on ? this.smoothN : this.flatN;
    if (a.array.length === n.length) { a.array.set(n); a.needsUpdate = true; }
    this.srcMat.flatShading = !on; this.srcMat.needsUpdate = true;
  }
  /** per-corner colours of the source mesh (linear RGB) used by the 'islands' colour mode */
  setIslandColors(cols, labels = null) {
    this.islandCols = cols;
    if (labels) this.islandLabels = labels;
    this.paintSource();
  }
  setSelectedIsland(id) {
    this.selectedIsland = id;
    this.paintSource();
  }
  paintSource() {
    if (!this.srcGeo) return;
    const isl = this.colorMode === 'islands' && this.islandCols && this.islandCols.length === this.srcCols.length;
    const a = this.srcGeo.getAttribute('color');
    if (!a) return;
    if (isl) {
      if (this.selectedIsland != null && this.islandLabels && this.islandLabels.length * 9 === this.islandCols.length) {
        const sel = this.selectedIsland, labels = this.islandLabels, base = this.islandCols, arr = a.array;
        for (let t = 0; t < labels.length; t++) {
          const isSel = labels[t] === sel, o = t * 9;
          for (let k = 0; k < 9; k += 3) {
            if (isSel) {
              arr[o + k] = Math.min(1, base[o + k] * 1.35 + 0.05);
              arr[o + k + 1] = Math.min(1, base[o + k + 1] * 1.35 + 0.05);
              arr[o + k + 2] = Math.min(1, base[o + k + 2] * 1.35 + 0.05);
            } else {
              const lum = base[o + k] * 0.299 + base[o + k + 1] * 0.587 + base[o + k + 2] * 0.114;
              arr[o + k] = lum * 0.25 + 0.18;
              arr[o + k + 1] = lum * 0.25 + 0.18;
              arr[o + k + 2] = lum * 0.25 + 0.22;
            }
          }
        }
        a.needsUpdate = true;
        return;
      }
      if (a.array.length === this.islandCols.length) {
        a.array.set(this.islandCols);
        a.needsUpdate = true;
        return;
      }
    }
    const src = this.srcCols;
    if (a.array.length !== src.length) return;
    a.array.set(src); a.needsUpdate = true;
  }
  setColorMode(mode) {
    this.colorMode = mode; this.paintSource(); if (!this.pieces) return;
    const c = new THREE.Color();
    this.pieces.forEach((p, n) => {
      const rgb = mode === 'kind' ? (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => x * 255) : (p.rgb || [200, 200, 200]);
      c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      for (const { mesh, k } of this.pe[n] || []) mesh.setColorAt(k, c);
    });
    for (const m of this.groups) m.instanceColor && (m.instanceColor.needsUpdate = true);
  }
  setOutline(on) { this.outline = on; for (const h of this.hulls) h.visible = on; }

  // ------------------------------------------------------------- reveal / build animation
  /** show the pieces whose base level is below `level` (Infinity = all). animate = spring pop-in of the new ones; returns how many pieces appeared */
  setLevel(level, animate = true) {
    if (!this.pieces) return 0;
    const P = this.pieces; let shown = 0, appeared = 0; const now = performance.now();
    for (let n = 0; n < P.length; n++) {
      const v = P[n].b < level ? 1 : 0; if (v) shown++;
      if (v === this.vis[n]) continue;
      this.vis[n] = v;
      if (v) { appeared++; if (animate) this.active.set(n, now + (n % 9) * 14); else this.place(n, 1, 0); }
      else { this.active.delete(n); this.place(n, 0, 0); }
    }
    this.revealed = shown; return appeared;
  }
  place(n, s, lift) {
    const dummy = this._d || (this._d = new THREE.Object3D());
    for (const { mesh, k, base } of this.pe[n]) {
      dummy.position.set(base[0], base[1] + lift, base[2]);
      // scale about the piece origin so a stud grows with its brick: positions are scaled around the piece centre
      dummy.scale.setScalar(Math.max(s, 0.0001)); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix); mesh.instanceMatrix.needsUpdate = true;
    }
  }
  stepAnimations(now) {
    if (!this.active.size) return;
    for (const [n, t0] of this.active) {
      const t = (now - t0) / 260; if (t < 0) { this.place(n, 0, 0); continue; }
      if (t >= 1) { this.active.delete(n); this.place(n, 1, 0); continue; }
      const e = easeOutBack(t); this.place(n, Math.min(1.08, e), (1 - Math.min(1, t)) * 40);
    }
  }

  // ------------------------------------------------------------- layout / camera
  setMode(mode) { this.mode = mode; this.applyMode(); }
  resetView() { this.frame(); }
  applyMode() {
    const m = this.mode, hasL = !!this.pieces;
    this.src.visible = m === 'mesh' || m === 'both' || m === 'split' || (!hasL && m === 'lego');
    this.lego.visible = hasL && m !== 'mesh';
    this.lego.position.set(0, 0, 0); this.src.position.set(0, 0, 0);
    if (this.srcMat) { this.srcMat.transparent = m === 'both'; this.srcMat.opacity = m === 'both' ? 0.32 : 1; this.srcMat.depthWrite = m !== 'both'; this.srcMat.needsUpdate = true; }
    const span = m === 'split' && hasL ? this.W * 2.2 : this.W;
    this.world.position.set(-span / 2 * S, 0, -this.D / 2 * S);
    if (m === 'split' && hasL) this.lego.position.x = this.W * 1.2;
    const size = Math.max(span, this.D, this.H) * S;
    this.rebuildCyclo(size);
    const q = size * 0.75 + 4; Object.assign(this.key.shadow.camera, { left: -q, right: q, top: q, bottom: -q, near: 0.5, far: size * 6 + 80 }); this.key.shadow.camera.updateProjectionMatrix();
    this.key.position.set(size * 0.8, size * 1.3, size * 0.9); this.key.target.position.set(0, 0, 0);
  }
  rebuildCyclo(size) {
    if (Math.abs(size - this.cycloSize) < 1e-6) return;
    this.cycloSize = size; this.cyclo.geometry.dispose(); this.cyclo.geometry = cycloGeometry(size);
    const d = cycloDims(size); this.maxCam = d.maxCam; this.controls.maxDistance = d.maxCam;   // the camera stays inside the cylinder
    this.scene.fog = null;
  }
  zoomToFit(keepOrientation = true) {
    const w = (this.mode === 'split' && this.pieces ? this.W * 2.2 : this.W) * S, d = this.D * S, h = Math.max(this.H * S, 1);
    const r = Math.hypot(w, d, h) / 2, dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * 0.95;
    const target = new THREE.Vector3(0, h / 2, 0);
    let dir = new THREE.Vector3(0.45, 0.55, 1).normalize();
    if (keepOrientation) {
      const curDir = this.camera.position.clone().sub(this.controls.target);
      if (curDir.lengthSq() > 1e-4) {
        dir = curDir.normalize();
        if (dir.y < 0.1) dir.y = 0.1;
        dir.normalize();
      }
    }
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    if (this.camera.position.y < 0.25) this.camera.position.y = 0.25;
    this.camera.near = Math.max(0.05, dist / 200); this.camera.far = Math.max(dist * 20, this.maxCam * 5);
    this.camera.updateProjectionMatrix(); this.controls.update();
  }
  frame() {
    this.zoomToFit(false);
  }
  view(name) {
    const c = this.controls.target.clone(), d = this.camera.position.distanceTo(c);
    const dirs = { front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0, 1, 0.001], under: [0.3, -0.8, 0.5], iso: [0.45, 0.55, 1] };
    this.camera.position.copy(c).addScaledVector(new THREE.Vector3(...dirs[name]).normalize(), d); this.controls.update();
  }
  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.6; }

  visiblePieces() { return this.pieces ? this.pieces.filter((_, n) => this.vis[n]) : []; }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  // ------------------------------------------------------------- axis gizmo + marquee selection
  /**
   * The corner gizmo: three labelled axes in their own little scene, drawn over the top-right of the viewport after the model
   * and turning with the camera (Blender's navigation cube in its simplest useful form). Clicking an arm looks down that axis.
   */
  buildGizmo() {
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.01, 20);
    cam.position.set(0, 0, 6);
    const label = (txt, color) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = color; x.beginPath(); x.arc(32, 32, 29, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.font = 'bold 36px Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(txt, 32, 35);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.setScalar(0.72); return sp;
    };
    const ring = (color) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.strokeStyle = color; x.lineWidth = 7; x.beginPath(); x.arc(32, 32, 25, 0, 7); x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, opacity: 0.85 })); sp.scale.setScalar(0.56); return sp;
    };
    const arms = [];
    for (const [name, dir, color, hex] of [['x', [1, 0, 0], 0xe05a45, '#e05a45'], ['y', [0, 1, 0], 0x7cb342, '#7cb342'], ['z', [0, 0, 1], 0x3b82f6, '#3b82f6']]) {
      const v = new THREE.Vector3(...dir);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), v.clone()]),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      scene.add(line);
      const pos = label(name.toUpperCase(), hex); pos.position.copy(v); scene.add(pos);
      const neg = ring(hex); neg.position.copy(v).negate(); scene.add(neg);
      arms.push({ name, dir: v.clone(), sprite: pos }, { name: '-' + name, dir: v.clone().negate(), sprite: neg });
    }
    this.gizmo = { scene, cam, arms, size: 92, pad: 10 };
  }
  /** the gizmo's rectangle in CSS pixels, measured from the top-left of the canvas */
  gizmoRect() {
    const v = this.renderer.getSize(new THREE.Vector2()), g = this.gizmo;
    return { x: v.x - g.size - g.pad, y: g.pad, w: g.size, h: g.size };
  }
  /** called at the end of every frame: the gizmo shares the renderer through a scissored corner viewport */
  renderGizmo() {
    if (!this.gizmo || this.gizmoOff) return;
    const g = this.gizmo, v = this.renderer.getSize(new THREE.Vector2()), r = this.gizmoRect();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    g.cam.position.copy(dir).multiplyScalar(6); g.cam.up.copy(this.camera.up); g.cam.lookAt(0, 0, 0);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(r.x, v.y - r.y - r.h, r.w, r.h);       // WebGL counts y from the bottom
    this.renderer.setScissor(r.x, v.y - r.y - r.h, r.w, r.h);
    this.renderer.clearDepth();
    this.renderer.render(g.scene, g.cam);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, v.x, v.y); this.renderer.setScissor(0, 0, v.x, v.y);
  }
  /** a click inside the gizmo: look down the nearest arm. Returns true when it handled the event. */
  gizmoClick(px, py) {
    if (!this.gizmo || this.gizmoOff) return false;
    const r = this.gizmoRect();
    if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return false;
    const g = this.gizmo, cx = r.x + r.w / 2, cy = r.y + r.h / 2, sc = r.w / 3.4;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    g.cam.position.copy(dir).multiplyScalar(6); g.cam.up.copy(this.camera.up); g.cam.lookAt(0, 0, 0); g.cam.updateMatrixWorld();
    let best = null, bd = 18 * 18;
    for (const a of g.arms) {
      const q = a.dir.clone().project(g.cam);
      const sx = cx + q.x * sc, sy = cy - q.y * sc, d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return false;
    const views = { x: 'side', '-x': 'side', y: 'top', '-y': 'under', z: 'front', '-z': 'front' };
    const d = new THREE.Vector3().copy(best.dir), dist = this.camera.position.distanceTo(this.controls.target);
    if (d.y > 0.99) d.set(0.001, 1, 0.001); if (d.y < -0.99) d.set(0.001, -1, 0.001).setY(0.2).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(d.normalize(), dist);
    if (this.camera.position.y < 0.25) this.camera.position.y = 0.25;
    this.controls.update();
    return true;
  }

  // ------------------------------------------------------------- marquee selection of pieces
  /** select mode: the left button draws a rubber band instead of orbiting (middle / right still orbit and pan) */
  setSelectMode(on) {
    this.selectMode = !!on;
    this.controls.mouseButtons.LEFT = on ? null : THREE.MOUSE.ROTATE;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    if (!on) this.hideBand();
    if (on && !this.sel && this.pieces) this.sel = new Uint8Array(this.pieces.length);
    this.paintSelection();
  }
  band() {
    if (!this._band) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;border:1px solid #38bdf8;background:rgba(56,189,248,.16);pointer-events:none;display:none;z-index:4;border-radius:2px';
      this.el.appendChild(d); this._band = d;
    }
    return this._band;
  }
  hideBand() { if (this._band) this._band.style.display = 'none'; }
  /** pointer down / move / up while select mode is on; px, py are CSS pixels inside the canvas */
  beginMarquee(px, py) { this._mq = { x0: px, y0: py, x1: px, y1: py }; const b = this.band(); b.style.display = 'block'; this.moveMarquee(px, py); }
  moveMarquee(px, py) {
    if (!this._mq) return;
    this._mq.x1 = px; this._mq.y1 = py;
    const { x0, y0, x1, y1 } = this._mq, b = this.band();
    b.style.left = Math.min(x0, x1) + 'px'; b.style.top = Math.min(y0, y1) + 'px';
    b.style.width = Math.abs(x1 - x0) + 'px'; b.style.height = Math.abs(y1 - y0) + 'px';
  }
  /** finish the band. mode: 'set' | 'add' | 'sub'. A click with no drag clears the selection. Returns how many are selected. */
  endMarquee(mode = 'set') {
    const mq = this._mq; this._mq = null; this.hideBand();
    if (!mq || !this.pieces) return this.selCount();
    if (!this.sel || this.sel.length !== this.pieces.length) this.sel = new Uint8Array(this.pieces.length);
    const w = Math.abs(mq.x1 - mq.x0), h = Math.abs(mq.y1 - mq.y0);
    if (w < 3 && h < 3) { if (mode === 'set') this.sel.fill(0); this.paintSelection(); return this.selCount(); }
    const x0 = Math.min(mq.x0, mq.x1), x1 = Math.max(mq.x0, mq.x1), y0 = Math.min(mq.y0, mq.y1), y1 = Math.max(mq.y0, mq.y1);
    const v = this.renderer.getSize(new THREE.Vector2()), P = this.pieces, pt = new THREE.Vector3();
    if (mode === 'set') this.sel.fill(0);
    for (let n = 0; n < P.length; n++) {
      if (!this.vis[n]) continue;                                    // only what is on screen at this moment
      const p = P[n], o = pieceOrigin(p);
      pt.set(o[0], o[1] + p.h * PLATE / 2, o[2]);                    // the piece's centre, in LDU inside `world`
      this.world.localToWorld(pt); pt.project(this.camera);
      const sx = (pt.x * 0.5 + 0.5) * v.x, sy = (-pt.y * 0.5 + 0.5) * v.y;
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || pt.z > 1) continue;
      this.sel[n] = mode === 'sub' ? 0 : 1;
    }
    this.paintSelection(); return this.selCount();
  }
  selCount() { let n = 0; if (this.sel) for (const v of this.sel) if (v) n++; return n; }
  clearSelection() { if (this.sel) this.sel.fill(0); this.paintSelection(); return 0; }
  invertSelection() {
    if (!this.pieces) return 0;
    if (!this.sel || this.sel.length !== this.pieces.length) this.sel = new Uint8Array(this.pieces.length);
    for (let n = 0; n < this.sel.length; n++) this.sel[n] = this.vis[n] && !this.sel[n] ? 1 : 0;
    this.paintSelection(); return this.selCount();
  }
  /** the selected pieces themselves (objects, not indices) */
  selectedPieces() { return this.pieces && this.sel ? this.pieces.filter((_, n) => this.sel[n]) : []; }
  /** selected pieces glow; the rest keeps its colour, dimmed while anything is selected */
  paintSelection() {
    if (!this.pieces) return;
    const any = this.selCount() > 0, c = new THREE.Color();
    for (let n = 0; n < this.pieces.length; n++) {
      const p = this.pieces[n];
      let rgb = this.colorMode === 'kind' ? (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => x * 255) : (p.rgb || [200, 200, 200]);
      if (any) rgb = this.sel[n] ? [56, 189, 248] : rgb.map((x) => 60 + x * 0.35);
      c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      for (const { mesh, k } of this.pe[n] || []) mesh.setColorAt(k, c);
    }
    for (const m of this.groups) m.instanceColor && (m.instanceColor.needsUpdate = true);
  }

  // ------------------------------------------------------------- instruction booklet (brickgen/instructions.js)
  /** rebuild with (or without) the studs that end up covered - see setLego. Keeps the camera where it is. */
  setAllStuds(on) {
    if (!!this.allStuds === !!on || !this._lego) return;
    const { pieces, cat, dims } = this._lego, cam = this.camera.position.clone(), tgt = this.controls.target.clone();
    this.allStuds = !!on; this.setLego(pieces, cat, dims);
    this.camera.position.copy(cam); this.controls.target.copy(tgt); this.controls.update();
  }
  /**
   * Show exactly the pieces flagged in `shown` (a Uint8Array over this.pieces, which setLego sorted by level), painting those
   * flagged in `hot` in the highlight colour - what instruction booklets print in red. No animation: this is for capture.
   */
  showStep(shown, hot, hotRGB = [232, 64, 42]) {
    if (!this.pieces) return;
    const c = new THREE.Color(); let n_ = 0;
    for (let n = 0; n < this.pieces.length; n++) {
      const v = shown && shown[n] ? 1 : 0; if (v) n_++;
      if (v !== this.vis[n]) { this.vis[n] = v; this.active.delete(n); this.place(n, v, 0); }
      const p = this.pieces[n];
      const rgb = hot && hot[n] ? hotRGB : (this.colorMode === 'kind' ? (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => x * 255) : (p.rgb || [200, 200, 200]));
      c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      for (const { mesh, k } of this.pe[n] || []) mesh.setColorAt(k, c);
    }
    for (const m of this.groups) m.instanceColor && (m.instanceColor.needsUpdate = true);
    this.revealed = n_;
  }
  /**
   * The finished model's bounding box in canvas pixels, grown to the aspect `ar` and padded: every step capture is cropped to
   * this one rectangle, so the model keeps its position and scale from picture to picture (what instruction booklets do) while
   * none of the frame is wasted on empty background.
   */
  modelRect(ar = 4 / 3, pad = 0.07) {
    const dom = this.renderer.domElement, W = dom.width, H = dom.height;
    if (!this.pieces || !this.pieces.length) return { x: 0, y: 0, w: W, h: H };
    // the model is centred on x = z = 0 and rises from y = 0, in world units (LDU x the viewport scale) - as zoomToFit frames it
    const v = new THREE.Vector3(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const hw = this.W * S / 2, hd = this.D * S / 2, hh = Math.max(this.H * S, 1);
    for (const X of [-hw, hw]) for (const Y of [0, hh]) for (const Z of [-hd, hd]) {
      v.set(X, Y, Z).project(this.camera);
      const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let w = (x1 - x0) * (1 + 2 * pad), h = (y1 - y0) * (1 + 2 * pad);
    if (w / h < ar) w = h * ar; else h = w / ar;                                  // grow to the booklet's aspect, never crop the model
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  /** render once and return a data URI no wider than `maxW`, cropped to `rect` (canvas pixels) over an opaque background */
  capture(maxW = 760, { quality = 0.85, png = false, rect = null } = {}) {
    this.renderer.render(this.scene, this.camera);                               // no renderGizmo(): the corner gizmo is not part of a booklet picture
    const src = this.renderer.domElement;
    const r = rect || { x: 0, y: 0, w: src.width, h: src.height };
    const k = Math.min(1, maxW / r.w);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    const g = c.getContext('2d');
    g.fillStyle = '#' + this.scene.background.getHexString(); g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high'; g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
  }
}
