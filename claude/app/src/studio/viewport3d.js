// Studio viewport: the look of the original app (dark #1e222b stage, grid, soft shadows, ACES) with the LEGO model drawn as THREE.InstancedMesh
// (one per part x rotation, one for the visible studs) in a cell-shaded (toon) material plus ink outlines. Pieces pop in with a small spring when revealed.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { template, pieceOrigin, KIND_COL } from '../brickgen/export.js';
import { STUD, PLATE } from '../brickgen/constants.js';

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
  constructor(el, { onHover, onStats } = {}) {
    this.el = el; this.onHover = onHover; this.onStats = onStats;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x1e222b);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000); this.camera.position.set(16, 14, 20);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.05; this.controls.maxPolarAngle = Math.PI / 2 + 0.05; this.controls.minDistance = 2; this.controls.maxDistance = 400;
    this.controls.target.set(0, 4, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222630, 0.85));
    this.key = new THREE.DirectionalLight(0xffffff, 1.4); this.key.position.set(20, 35, 25); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0001; this.key.shadow.normalBias = 0.02; this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x90b0e0, 0.5); fill.position.set(-20, 20, -15); this.scene.add(fill);
    this.grid = new THREE.GridHelper(40, 40, 0x3b4252, 0x2e3440); this.scene.add(this.grid);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -0.01; this.floor.receiveShadow = true; this.scene.add(this.floor);

    this.world = new THREE.Group(); this.world.scale.setScalar(S); this.scene.add(this.world);   // everything inside is in LDU
    this.src = new THREE.Group(); this.lego = new THREE.Group(); this.world.add(this.src, this.lego);
    this.gradient = toonGradient(4);
    this.toon = new THREE.MeshToonMaterial({ gradientMap: this.gradient, color: 0xffffff, side: THREE.DoubleSide });
    this.hullThick = 2.5; this.hulls = [];
    this.hullMat = new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide });
    this.hullMat.onBeforeCompile = (sh) => {            // inverted hull: back faces, pushed out along the smoothed normal, drawn black behind the coloured front faces
      sh.uniforms.uThick = { value: this.hullThick }; this.hullShader = sh;
      sh.vertexShader = 'attribute vec3 aSmooth;\nuniform float uThick;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(aSmooth) * uThick;');
    };
    this.dark = true;
    this.mode = 'lego'; this.outline = true; this.colorMode = 'piece'; this.active = new Map(); this.pieces = null; this.revealed = 0; this.W = 20 * 16; this.D = 20 * 16; this.H = 0;
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    this.frames = 0; this.t0 = performance.now(); this.fps = 0;
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }
  setHullThickness(t) { this.hullThick = t; if (this.hullShader) this.hullShader.uniforms.uThick.value = t; }
  setTheme(dark) {
    this.dark = dark; this.scene.background = new THREE.Color(dark ? 0x1e222b : 0xe9edf3);
    this.hullMat.color.set(dark ? 0x05070a : 0x10131a);
    const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    mats[0].color.set(dark ? 0x3b4252 : 0xb4bccb); (mats[1] || mats[0]).color.set(dark ? 0x2e3440 : 0xcfd5e0);
    this.floor.material.opacity = dark ? 0.35 : 0.2;
  }
  resize() { const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.clearLego(); this.clearGroup(this.src); this.renderer.dispose(); this.el.innerHTML = ''; }
  clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); if (c.material && c.material !== this.toon && c.material !== this.hullMat) c.material.dispose(); } }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update(); this.stepAnimations(now);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------- source mesh
  /** tris in LDU of the result frame (aligned with the LEGO model) or raw tris of a freshly opened file (fitted to ~24 studs) */
  setSource(tris, cols, { raw = false } = {}) {
    this.clearGroup(this.src);
    let t = tris;
    if (raw) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < tris.length; k += 3) for (let a = 0; a < 3; a++) { const v = tris[k + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
      const k = 24 * STUD / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
      t = new Float32Array(tris.length);
      for (let i = 0; i < tris.length; i += 3) { t[i] = (tris[i] - lo[0]) * k; t[i + 1] = (tris[i + 1] - lo[1]) * k; t[i + 2] = (tris[i + 2] - lo[2]) * k; }
      this.W = (hi[0] - lo[0]) * k; this.D = (hi[2] - lo[2]) * k; this.H = (hi[1] - lo[1]) * k;
      this.clearLego(); this.lego.position.set(0, 0, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t, 3)); g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
    this.srcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, this.srcMat); m.castShadow = true; m.receiveShadow = true; this.src.add(m);
    if (!raw) { g.computeBoundingBox(); }
    this.applyMode(); this.frame();
  }

  // ------------------------------------------------------------- LEGO (instanced)
  clearLego() { this.clearGroup(this.lego); this.groups = []; this.hulls = []; this.active.clear(); this.pieces = null; this.pe = null; this.revealed = 0; }

  setLego(pieces, cat, dims) {
    this.clearLego();
    const by = {}; for (const c of cat) by[c.id] = c;
    const P = pieces.map((p, n) => ({ p, n })).sort((a, b) => a.p.b - b.p.b || a.n - b.n).map((x) => x.p);
    this.pieces = P; this.levels = P.length ? Math.max(...P.map((p) => p.b + p.h)) : 0;
    this.W = dims[0] * STUD; this.D = dims[1] * STUD; this.H = dims[2] * PLATE;
    const occ = new Set();
    for (const p of P) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) occ.add(`${p.i + dx},${p.j + dz},${p.b + l}`);
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
      const mesh = new THREE.InstancedMesh(studGeometry(), this.toon, studs.length); mesh.castShadow = true; mesh.userData.pieces = studs.map((s) => s[0]);
      studs.forEach(([n, x, y, z], k) => { dummy.position.set(x, y, z); dummy.scale.setScalar(1); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix); (this.pe[n] = this.pe[n] || []).push({ mesh, k, base: [x, y, z] }); });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.lego.add(mesh); this.groups.push(mesh); this.addHull(mesh);
    }
    this.vis = new Uint8Array(P.length).fill(1); this.revealed = P.length;
    this.setColorMode(this.colorMode);
    this.setOutline(this.outline);
    this.applyMode(); this.frame();
  }

  /** black back-face shell sharing the instance matrices of `mesh` (so pop-in / hiding follows for free) */
  addHull(mesh) {
    const h = new THREE.InstancedMesh(withSmoothNormals(mesh.geometry), this.hullMat, mesh.count);
    h.instanceMatrix = mesh.instanceMatrix; h.frustumCulled = false; h.visible = this.outline; h.renderOrder = -1;
    this.lego.add(h); this.hulls.push(h);
  }
  setColorMode(mode) {
    this.colorMode = mode; if (!this.pieces) return;
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
  setMode(mode) { this.mode = mode; this.applyMode(); this.frame(); }
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
    this.grid.scale.setScalar(Math.max(1, size / 30)); this.floor.scale.setScalar(Math.max(1, size / 40));
    const q = size * 0.75 + 4; Object.assign(this.key.shadow.camera, { left: -q, right: q, top: q, bottom: -q, near: 0.5, far: size * 6 + 80 }); this.key.shadow.camera.updateProjectionMatrix();
    this.key.position.set(size * 0.8, size * 1.3, size * 0.9); this.key.target.position.set(0, 0, 0);
  }
  frame() {
    const w = (this.mode === 'split' && this.pieces ? this.W * 2.2 : this.W) * S, d = this.D * S, h = Math.max(this.H * S, 1);
    const r = Math.hypot(w, d, h) / 2, dist = r / Math.sin(this.camera.fov * Math.PI / 360) * 0.95;
    this.controls.target.set(0, h / 2, 0);
    this.camera.position.set(0, h / 2, 0).add(new THREE.Vector3(0.45, 0.55, 1).normalize().multiplyScalar(dist));
    this.camera.near = Math.max(0.05, dist / 200); this.camera.far = dist * 20; this.camera.updateProjectionMatrix(); this.controls.update();
  }
  view(name) {
    const c = this.controls.target.clone(), d = this.camera.position.distanceTo(c);
    const dirs = { front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0, 1, 0.001], under: [0.3, -0.8, 0.5], iso: [0.45, 0.55, 1] };
    this.camera.position.copy(c).addScaledVector(new THREE.Vector3(...dirs[name]).normalize(), d); this.controls.update();
  }
  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.6; }

  hover(e) {
    if (!this.pieces || !this.onHover || !this.lego.visible) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.groups, false); const h = hits[0];
    this.onHover(h && h.instanceId !== undefined ? this.pieces[h.object.userData.pieces[h.instanceId]] : null, e);
  }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}
