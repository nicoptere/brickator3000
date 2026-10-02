// Snapshot with the GPU path tracer (three-gpu-pathtracer, as in the original app's pathTracerEngine): an offscreen renderer, the pieces as ONE merged
// indexed mesh (export.buildMesh, per-vertex colours) in glossy ABS plastic, a gradient environment, a key light and a floor, accumulated to `spp` samples.
import * as THREE from 'three';
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { buildMesh } from '../brickgen/export.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** returns a PNG data URL. `vp` = the StudioViewport (camera, lego group transform), opts: { pieces, cat, colorMode, dark, spp, maxSide, onProgress(n, spp), signal } */
export async function pathTracedSnapshot(vp, { pieces, cat, colorMode = 'piece', dark = true, spp = 512, maxSide = 1600, onProgress, signal } = {}) {
  const cw = vp.el.clientWidth || 1000, ch = vp.el.clientHeight || 700, k = Math.min(2, maxSide / Math.max(cw, ch));
  const W = Math.max(2, Math.round(cw * k)), H = Math.max(2, Math.round(ch * k));
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  let pt = null;
  try {
    const m = buildMesh(pieces, cat, colorMode);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    const lin = new Float32Array(m.col.length), lut = new Float32Array(256); for (let x = 0; x < 256; x++) lut[x] = s2l(x / 255);
    for (let i = 0; i < lin.length; i++) lin[i] = lut[m.col[i]];
    const flat = g.toNonIndexed(); g.dispose();
    { // RGBA like every other mesh in the scene (the path tracer merges them attribute by attribute); colours follow the indexing
      const out = new Float32Array(flat.getAttribute('position').count * 4), idx = m.idx;
      for (let i = 0; i < idx.length; i++) { out[i * 4] = lin[idx[i] * 3]; out[i * 4 + 1] = lin[idx[i] * 3 + 1]; out[i * 4 + 2] = lin[idx[i] * 3 + 2]; out[i * 4 + 3] = 1; }
      flat.setAttribute('color', new THREE.BufferAttribute(out, 4));
    }
    flat.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.1 });
    const mesh = new THREE.Mesh(flat, mat);
    vp.lego.updateMatrixWorld(true); mesh.applyMatrix4(vp.lego.matrixWorld); mesh.updateMatrixWorld(true);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(dark ? 0x1e222b : 0xe9edf3);
    scene.add(mesh);
    const fg = new THREE.PlaneGeometry(400, 400); fg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16).fill(1), 4));
    const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: dark ? 0x232834 : 0xdfe4ec, roughness: 0.45, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; scene.add(floor);
    const sz = Math.max(vp.W, vp.D, vp.H) / 20 || 20;
    const key = new THREE.DirectionalLight(0xfff6e8, 3); key.position.set(sz * 0.9, sz * 1.6, sz * 1.1); scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbeafe, 1); fill.position.set(-sz, sz * 0.8, sz * 0.5); scene.add(fill);
    const env = new GradientEquirectTexture(); env.topColor.set(dark ? 0x3a4660 : 0xffffff); env.bottomColor.set(dark ? 0x10131a : 0xaab3c2); env.update(); scene.environment = env;

    const cam = vp.camera.clone(); cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    pt = new WebGLPathTracer(renderer);
    pt.bounces = 4; pt.filterGlossyFactor = 0.5; pt.tiles.set(2, 2); pt.renderScale = 1;
    pt.setScene(scene, cam);
    while (pt.samples < spp) {
      if (signal && signal.aborted) throw new Error('cancelled');
      pt.renderSample();
      onProgress && onProgress(Math.floor(pt.samples), spp);
      await new Promise((r) => requestAnimationFrame(r));            // keep the page responsive
    }
    return renderer.domElement.toDataURL('image/png');
  } finally {
    try { if (pt) { if (!pt._renderQuad && pt._quad) pt._renderQuad = pt._quad; pt.dispose(); } } catch {}
    renderer.dispose();
  }
}
