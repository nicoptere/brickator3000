// three.js viewport: source mesh and LEGO build side by side (or overlaid), layer-by-layer cut, hover info.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildMesh } from './brickgen/export.js';
import { srgb2lin } from './brickgen/mesh.js';
import { PLATE } from './brickgen/constants.js';

export class Viewer {
  constructor(el, { onHover } = {}) {
    this.el = el; this.onHover = onHover;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x1e222b);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 1e6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 2.2); d1.position.set(1, 2, 1.4); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.7); d2.position.set(-1.5, 0.6, -1); this.scene.add(d2);
    this.src = new THREE.Group(); this.lego = new THREE.Group(); this.scene.add(this.src, this.lego);
    this.ground = null; this.layout = 'side'; this.level = Infinity; this.showEdges = true; this.colorMode = 'piece';
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    new ResizeObserver(() => this.resize()).observe(el); this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }
  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); this.el.innerHTML = ''; }
  clear(g) { for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); } }

  setSource(tris, colsLinear) {
    this.clear(this.src);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colsLinear, 3));
    g.computeVertexNormals();
    this.srcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: false, opacity: 1 });
    this.src.add(new THREE.Mesh(g, this.srcMat));
    g.computeBoundingBox(); this.srcBox = g.boundingBox.clone();
    this.applyLayout();
  }

  setLego(pieces, cat) {
    this.pieces = pieces.map((p, n) => ({ p, n })).sort((a, b) => a.p.b - b.p.b || a.n - b.n).map((x) => x.p);
    this.cat = cat; this.rebuildLego(); this.applyLayout();
    this.zoomToFit(true);
  }
  rebuildLego() {
    this.clear(this.lego); if (!this.pieces) return;
    const m = buildMesh(this.pieces, this.cat, this.colorMode === 'kind' ? 'kind' : 'piece');
    const lut = new Float32Array(256); for (let x = 0; x < 256; x++) lut[x] = srgb2lin(x / 255);
    const lin = new Float32Array(m.col.length); for (let k = 0; k < lin.length; k++) lin[k] = lut[m.col[k]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(lin, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    this.legoMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    this.legoMesh.userData.pieceOfTri = m.triPiece;
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(m.edges, 3));
    this.edgeMesh = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    this.edgeMesh.visible = this.showEdges;
    this.lego.add(this.legoMesh, this.edgeMesh);
    // prefix counts per level for the layer cut (pieces are sorted by level)
    this.triEnd = []; this.edgeEnd = []; let tcount = 0, ecount = 0, pi = 0;
    const tri = m.triPiece; let k = 0;
    const perPieceT = new Uint32Array(this.pieces.length); for (k = 0; k < tri.length; k++) perPieceT[tri[k]]++;
    const levels = this.pieces.length ? this.pieces[this.pieces.length - 1].b + 1 : 0;
    this.maxLevel = 0; for (const p of this.pieces) this.maxLevel = Math.max(this.maxLevel, p.b + p.h);
    this.edgeCount = m.edges.length / 3; this.triTotal = tri.length;
    for (let L = 0; L <= levels; L++) {
      while (pi < this.pieces.length && this.pieces[pi].b < L) { tcount += perPieceT[pi]; pi++; }
      this.triEnd[L] = tcount;
    }
    const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position')); this.legoBox = box;
    this.setLevel(this.level);
  }
  setLevel(L) {
    this.level = L; if (!this.legoMesh) return;
    const lv = Math.min(L, this.triEnd.length - 1), t = L === Infinity || lv < 0 ? this.triTotal : this.triEnd[lv];
    this.legoMesh.geometry.setDrawRange(0, t * 3);
    this.edgeMesh.visible = this.showEdges && (L === Infinity || L >= this.triEnd.length - 1);
  }
  setEdges(on) { this.showEdges = on; this.setLevel(this.level); }
  setColorMode(mode) { this.colorMode = mode; this.rebuildLego(); }
  setLayout(mode) { this.layout = mode; this.applyLayout(); }
  resetView() { this.frame(); }
  applyLayout() {
    const sb = this.srcBox, lb = this.legoBox;
    const w = Math.max(sb ? sb.max.x - sb.min.x : 0, lb ? lb.max.x - lb.min.x : 0);
    this.src.visible = this.layout !== 'lego'; this.lego.visible = this.layout !== 'source';
    this.src.position.set(0, 0, 0); this.lego.position.set(0, 0, 0);
    if (this.srcMat) { this.srcMat.transparent = this.layout === 'overlay'; this.srcMat.opacity = this.layout === 'overlay' ? 0.35 : 1; this.srcMat.depthWrite = this.layout !== 'overlay'; this.srcMat.needsUpdate = true; }
    if (this.layout === 'side') this.lego.position.x = w * 1.15 + 40;
  }
  zoomToFit(keepOrientation = true) {
    const box = new THREE.Box3();
    for (const g of [this.src, this.lego]) if (g.visible && g.children.length) box.expandByObject(g);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = (r / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.8;
    let dir = new THREE.Vector3(0.18, 0.55, 1).normalize();
    if (keepOrientation) {
      const curDir = this.camera.position.clone().sub(this.controls.target);
      if (curDir.lengthSq() > 1e-4) {
        dir = curDir.normalize();
        if (dir.y < 0.1) dir.y = 0.1;
        dir.normalize();
      }
    }
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
  }
  frame() {
    this.zoomToFit(false);
  }
  view(name) {
    const c = this.controls.target.clone(), d = this.camera.position.distanceTo(c);
    const dirs = { front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0, 1, 0.001], under: [0.3, -0.8, 0.5], iso: [0.18, 0.55, 1] };
    this.camera.position.copy(c).addScaledVector(new THREE.Vector3(...dirs[name]).normalize(), d); this.controls.update();
  }
  hover(e) {
    if (!this.legoMesh || !this.onHover || !this.lego.visible) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObject(this.legoMesh, false).find((h) => {
      const dr = this.legoMesh.geometry.drawRange; return h.faceIndex * 3 < dr.start + dr.count;
    });
    this.onHover(hit ? this.pieces[this.legoMesh.userData.pieceOfTri[hit.faceIndex]] : null, e);
  }
  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
export const LEVEL_LDU = PLATE;
