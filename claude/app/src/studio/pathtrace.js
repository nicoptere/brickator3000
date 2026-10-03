// Snapshot with the GPU path tracer (three-gpu-pathtracer, as in the original app's pathTracerEngine): an offscreen renderer, the pieces as ONE merged
// indexed mesh (export.buildMesh, per-vertex colours) in glossy ABS plastic, an EXR studio environment, three soft area lights and a closed cyclo, accumulated to `spp` samples.
import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { cycloGeometry, cycloMaterial, areaLights } from './cyclo.js';
import { createDof } from './dof.js';
import { buildMesh } from '../brickgen/export.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** builds the offscreen scene and returns { el (the canvas, show it while it converges), run(onProgress) , url(), dispose() }. `vp` = the StudioViewport (camera, lego group transform) */
let envPromise = null;
const loadEnv = () => envPromise || (envPromise = new EXRLoader().loadAsync(new URL('/env/studio.exr', location.href).href).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; t.minFilter = t.magFilter = THREE.LinearFilter; return t; }));

export async function createPathTrace(vp, { pieces, cat, colorMode = 'piece', dark = true, spp = 512, maxSide = 1600, source = false, live = false } = {}) {
  const cw = vp.el.clientWidth || 1000, ch = vp.el.clientHeight || 700, k = Math.min(2, maxSide / Math.max(cw, ch));
  const W = Math.max(2, Math.round(cw * k)), H = Math.max(2, Math.round(ch * k));
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  // three r170 + the path tracer re-define the material every sample: the async compile polls a program that was already replaced ("program is undefined"); compile synchronously instead
  renderer.compileAsync = (sc, cam) => { renderer.compile(sc, cam); return Promise.resolve(sc); };
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  let pt = null, stop = false;
  try {
    let flat, root;
    if (source) {                                       // the source mesh as shown (per-corner linear colours already in its colour attribute)
      const sm = vp.src.children.find((c) => c.isMesh); if (!sm) throw new Error('no mesh to render');
      const pos = sm.geometry.getAttribute('position'), col = sm.geometry.getAttribute('color'), n = pos.count, c4 = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { c4[i * 4] = col ? col.getX(i) : 0.7; c4[i * 4 + 1] = col ? col.getY(i) : 0.7; c4[i * 4 + 2] = col ? col.getZ(i) : 0.7; c4[i * 4 + 3] = 1; }
      flat = new THREE.BufferGeometry(); flat.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array), 3)); flat.setAttribute('color', new THREE.BufferAttribute(c4, 4));
      root = vp.src;
    } else {
      const m = buildMesh(pieces, cat, colorMode);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      const lin = new Float32Array(m.col.length), lut = new Float32Array(256); for (let x = 0; x < 256; x++) lut[x] = s2l(x / 255);
      for (let i = 0; i < lin.length; i++) lin[i] = lut[m.col[i]];
      flat = g.toNonIndexed(); g.dispose();
      const out = new Float32Array(flat.getAttribute('position').count * 4), idx = m.idx;     // RGBA like every other mesh in the scene; colours follow the indexing
      for (let i = 0; i < idx.length; i++) { out[i * 4] = lin[idx[i] * 3]; out[i * 4 + 1] = lin[idx[i] * 3 + 1]; out[i * 4 + 2] = lin[idx[i] * 3 + 2]; out[i * 4 + 3] = 1; }
      flat.setAttribute('color', new THREE.BufferAttribute(out, 4));
      root = vp.lego;
    }
    flat.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.1 });
    const mesh = new THREE.Mesh(flat, mat);
    root.updateMatrixWorld(true); mesh.applyMatrix4(root.matrixWorld); mesh.updateMatrixWorld(true);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(dark ? 0x1e222b : 0xe9edf3);
    scene.add(mesh);
    // photo-studio cyclo: floor + wall of a filleted cylinder wider than the lights, three soft area lights, EXR studio environment
    const size = Math.max(vp.W, vp.D, vp.H) / 20 || 20;
    const cy = new THREE.Mesh(cycloGeometry(size), cycloMaterial(dark)); cy.position.y = -0.002; scene.add(cy);
    const al = areaLights(size); scene.add(al.group);
    const env = await loadEnv(); scene.environment = env; scene.environmentIntensity = dark ? 0.3 : 0.45;
    const cam = vp.camera.clone();                                  // own camera (live mode re-syncs it with the viewport camera on every move)
    const P = flat.getAttribute('position'), step = Math.max(1, Math.floor(P.count / 200000)), tv = new THREE.Vector3();
    const outH = live ? Math.min(1080, Math.round(ch * (window.devicePixelRatio || 1))) : 1080;
    /** frame the picture on the projected bounding box of the model (x 1.25 for air): same camera, cropped with a view offset; output is `outH` px tall, width follows the box */
    const frame = () => {
      cam.copy(vp.camera); cam.clearViewOffset(); cam.aspect = cw / ch; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < P.count; i += step) {
        tv.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        if (tv.z > -1e-3) continue;                                              // behind the camera
        tv.applyMatrix4(cam.projectionMatrix);
        if (tv.x < x0) x0 = tv.x; if (tv.x > x1) x1 = tv.x; if (tv.y < y0) y0 = tv.y; if (tv.y > y1) y1 = tv.y;
      }
      if (x1 > x0 && y1 > y0) {
        const m = 1.25, wpx = ((x1 - x0) / 2) * cw * m, hpx = ((y1 - y0) / 2) * ch * m;
        const cx = ((x0 + x1) / 4 + 0.5) * cw, cy = (0.5 - (y0 + y1) / 4) * ch;
        cam.setViewOffset(cw, ch, cx - wpx / 2, cy - hpx / 2, wpx, hpx);
        renderer.setSize(Math.min(4096, Math.max(64, Math.round(outH * wpx / hpx))), outH, false);
      }
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    };
    frame();
    pt = new WebGLPathTracer(renderer);
    pt.bounces = 4; pt.filterGlossyFactor = 0.5; pt.tiles.set(2, 2); pt.renderScale = 1;
    pt.setScene(scene, cam);
    const cv = renderer.domElement; let host = cv;
    if (live) {                                                    // a backdrop in the stage colour hides the paused viewport; the framed picture sits centred on it
      host = document.createElement('div'); host.style.cssText = `position:absolute;inset:0;z-index:2;pointer-events:none;display:flex;align-items:center;justify-content:center;background:${dark ? '#1e222b' : '#e9edf3'}`;
      cv.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain'; host.appendChild(cv);
    } else cv.style.cssText = 'max-width:100%;max-height:72vh;display:block;margin:0 auto;border-radius:6px';
    let dof = null, dofState = { on: false, focus: 0, maxPx: 16, sharp: 0, span: null };
    const job = {
      el: host, canvas: cv, pt,
      /** after the samples are in: keep the image, render the depth pass, and report what depths are in frame */
      prepareDof() {
        if (!dof) dof = createDof(renderer);
        dof.grab(cv);
        const r = dof.capture(scene, cam);
        dofState.span = r;
        if (r && !dofState.focus) dofState.focus = (r.near + r.far) / 2;
        return r;
      },
      /** view-space depth under a normalised image point (0,0 = top left) */
      depthAt: (u, v) => (dof ? dof.depthAt(u, v) : null),
      dofState: () => ({ ...dofState }),
      /** redraw the canvas: blurred when `on`, the untouched accumulation when not */
      applyDof(next = {}) {
        Object.assign(dofState, next);
        if (!dof || !dof.hasBase()) return false;
        const { on, focus, maxPx, span, sharp } = dofState;
        return dof.compose({ focus, maxPx: on ? maxPx : 0, sharp: span ? (sharp || 0) * (span.far - span.near) : 0, range: span ? Math.max(1e-3, (span.far - span.near) * 0.28) : null });
      },
      async run(onProgress) {
        while (!stop) {
          if (pt.samples < spp) { pt.renderSample(); onProgress && onProgress(Math.floor(pt.samples), spp); await new Promise((r) => requestAnimationFrame(r)); }
          else if (live) { onProgress && onProgress(spp, spp); await new Promise((r) => setTimeout(r, 120)); }
          else break;
        }
        return !stop;
      },
      reset() { if (dof) { dof.dispose(); dof = null; } try { frame(); pt.updateCamera ? pt.updateCamera() : pt.reset(); } catch { pt.reset(); } },
      url: () => cv.toDataURL('image/png'),
      stop() { stop = true; },
      dispose() { stop = true; if (dof) { dof.dispose(); dof = null; } try { if (pt) { if (!pt._renderQuad && pt._quad) pt._renderQuad = pt._quad; pt.dispose(); } } catch {} renderer.dispose(); if (host.parentNode) host.parentNode.removeChild(host); },
    };
    return job;
  } catch (e) { renderer.dispose(); throw e; }
}
