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
const loadEnv = () => envPromise || (envPromise = new EXRLoader().loadAsync(new URL('./env/studio.exr', location.href).href).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; t.minFilter = t.magFilter = THREE.LinearFilter; return t; }));

/**
 * Extra options for pictures that are not the viewport's own: `camera` (a THREE camera to shoot from instead of the viewport's),
 * `transparent` (no background at all - the PNG keeps its alpha, for the booklet cover), `floor` (false = no cyclo, so nothing
 * but the model is in the picture), `outHeight` (pixels; the width follows the model's projected box), `margin` (air around the projected box, x1.25).
 */
export async function createPathTrace(vp, { pieces, cat, colorMode = 'piece', dark = true, spp = 512, maxSide = 1600, source = undefined, viewMode = undefined, live = false, camera = null, transparent = false, floor = true, outHeight = 1080, margin = 1.25 } = {}) {
  const cw = vp.el.clientWidth || 1000, ch = vp.el.clientHeight || 700, k = Math.min(2, maxSide / Math.max(cw, ch));
  const W = Math.max(2, Math.round(cw * k)), H = Math.max(2, Math.round(ch * k));
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: transparent, premultipliedAlpha: false });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  // three r170 + the path tracer re-define the material every sample: the async compile polls a program that was already replaced ("program is undefined"); compile synchronously instead
  renderer.compileAsync = (sc, cam) => { renderer.compile(sc, cam); return Promise.resolve(sc); };
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  let pt = null, stop = false;
  try {
    const scene = new THREE.Scene(); scene.background = transparent ? null : new THREE.Color(dark ? 0x1e222b : 0xe9edf3);   // null = the path tracer writes alpha 0 where nothing is hit
    const activeMeshes = [];

    const hasSrcMesh = !!(vp.src && vp.src.children.some((c) => c.isMesh));
    const curPieces = pieces && pieces.length > 0 ? pieces : (vp.visiblePieces ? vp.visiblePieces() : (vp.pieces || []));
    const hasLegoMesh = !!(curPieces && curPieces.length > 0);

    const effMode = viewMode || vp.mode || (source === true ? 'mesh' : (source === false ? 'lego' : 'both'));

    let showSource = false;
    let showLego = false;

    if (source !== undefined && viewMode === undefined) {
      showSource = !!source && hasSrcMesh;
      showLego = !source && hasLegoMesh;
    } else if (effMode === 'mesh') {
      showSource = hasSrcMesh;
    } else if (effMode === 'lego') {
      showLego = hasLegoMesh;
      if (!hasLegoMesh && hasSrcMesh) showSource = true;
    } else if (effMode === 'both' || effMode === 'split') {
      showSource = hasSrcMesh;
      showLego = hasLegoMesh;
    } else {
      showSource = hasSrcMesh && (vp.src ? vp.src.visible : true);
      showLego = hasLegoMesh && (vp.lego ? vp.lego.visible : true);
    }

    if (!showSource && !showLego) {
      if (hasLegoMesh) showLego = true;
      else if (hasSrcMesh) showSource = true;
    }

    if (showSource) {
      const sm = vp.src.children.find((c) => c.isMesh);
      if (sm) {
        const pos = sm.geometry.getAttribute('position'), col = sm.geometry.getAttribute('color'), norm = sm.geometry.getAttribute('normal');
        const n = pos.count, c4 = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          c4[i * 4] = col ? col.getX(i) : 0.7;
          c4[i * 4 + 1] = col ? col.getY(i) : 0.7;
          c4[i * 4 + 2] = col ? col.getZ(i) : 0.7;
          c4[i * 4 + 3] = 1;
        }
        const flatSrc = new THREE.BufferGeometry();
        flatSrc.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array), 3));
        flatSrc.setAttribute('color', new THREE.BufferAttribute(c4, 4));
        if (norm) {
          flatSrc.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm.array), 3));
        } else {
          flatSrc.computeVertexNormals();
        }

        const isBoth = showLego && (effMode === 'both' || vp.mode === 'both');
        const srcMat = isBoth
          ? new THREE.MeshPhysicalMaterial({
              vertexColors: true,
              roughness: 0.25,
              metalness: 0,
              transmission: 0.6,
              opacity: 0.5,
              transparent: true,
              ior: 1.3,
              side: THREE.DoubleSide,
            })
          : new THREE.MeshPhysicalMaterial({
              vertexColors: true,
              roughness: 0.25,
              metalness: 0,
              clearcoat: 0.2,
              clearcoatRoughness: 0.1,
              side: THREE.DoubleSide,
            });

        const srcMesh = new THREE.Mesh(flatSrc, srcMat);
        vp.src.updateMatrixWorld(true);
        srcMesh.applyMatrix4(vp.src.matrixWorld);
        srcMesh.updateMatrixWorld(true);
        scene.add(srcMesh);
        activeMeshes.push(srcMesh);
      }
    }

    if (showLego) {
      const m = buildMesh(curPieces, cat, colorMode);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      const lin = new Float32Array(m.col.length), lut = new Float32Array(256);
      for (let x = 0; x < 256; x++) lut[x] = s2l(x / 255);
      for (let i = 0; i < lin.length; i++) lin[i] = lut[m.col[i]];
      const flatLego = g.toNonIndexed();
      g.dispose();
      const out = new Float32Array(flatLego.getAttribute('position').count * 4), idx = m.idx;
      for (let i = 0; i < idx.length; i++) {
        out[i * 4] = lin[idx[i] * 3];
        out[i * 4 + 1] = lin[idx[i] * 3 + 1];
        out[i * 4 + 2] = lin[idx[i] * 3 + 2];
        out[i * 4 + 3] = 1;
      }
      flatLego.setAttribute('color', new THREE.BufferAttribute(out, 4));
      flatLego.computeVertexNormals();

      const legoMat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.2,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide,
      });

      const legoMesh = new THREE.Mesh(flatLego, legoMat);
      vp.lego.updateMatrixWorld(true);
      legoMesh.applyMatrix4(vp.lego.matrixWorld);
      legoMesh.updateMatrixWorld(true);
      scene.add(legoMesh);
      activeMeshes.push(legoMesh);
    }

    if (!activeMeshes.length) throw new Error('No mesh to render');

    // Union of the bounding boxes across all present models
    const unionBox = new THREE.Box3();
    for (const mesh of activeMeshes) {
      const b = new THREE.Box3().setFromObject(mesh);
      unionBox.union(b);
    }

    const unionSize = new THREE.Vector3();
    unionBox.getSize(unionSize);
    const unionCenter = new THREE.Vector3();
    unionBox.getCenter(unionCenter);

    // Photo-studio cyclo & area lights scaled and centered on the union bounding box
    const maxDim = Math.max(unionSize.x, unionSize.y, unionSize.z, 20);
    const size = maxDim * 1.2;
    const floorY = Math.min(0, unionBox.min.y) - 0.002;

    let cy = null;
    if (floor) { cy = new THREE.Mesh(cycloGeometry(size), cycloMaterial(dark)); cy.position.set(unionCenter.x, floorY, unionCenter.z); scene.add(cy); }

    const al = areaLights(size);
    al.group.position.set(unionCenter.x, floorY, unionCenter.z);
    scene.add(al.group);

    const env = await loadEnv(); scene.environment = env; scene.environmentIntensity = dark ? 0.3 : 0.45;
    const srcCam = camera || vp.camera, cam = srcCam.clone(); // own camera (live mode re-syncs it with the viewport camera on every move)

    const tv = new THREE.Vector3();
    const outH = live ? Math.min(outHeight, Math.round(ch * (window.devicePixelRatio || 1))) : outHeight;
    const corners = [
      new THREE.Vector3(unionBox.min.x, unionBox.min.y, unionBox.min.z),
      new THREE.Vector3(unionBox.max.x, unionBox.min.y, unionBox.min.z),
      new THREE.Vector3(unionBox.min.x, unionBox.max.y, unionBox.min.z),
      new THREE.Vector3(unionBox.max.x, unionBox.max.y, unionBox.min.z),
      new THREE.Vector3(unionBox.min.x, unionBox.min.y, unionBox.max.z),
      new THREE.Vector3(unionBox.max.x, unionBox.min.y, unionBox.max.z),
      new THREE.Vector3(unionBox.min.x, unionBox.max.y, unionBox.max.z),
      new THREE.Vector3(unionBox.max.x, unionBox.max.y, unionBox.max.z),
    ];

    /**
     * Frame the camera:
     * - In render 'pathtracer' mode (!camera): move the camera much closer to the subject, targeting unionCenter,
     *   snugly fitting the model's bounds with a clean 4% margin, adapting the output aspect ratio.
     * - When an explicit camera is provided (e.g. booklet cover): frame the picture on the projected bounding box with view offset.
     */
    const frame = () => {
      if (!camera) {
        // Render 'pathtracer' mode: move camera much closer to the subject to snugly fit the model
        const target = vp.controls ? vp.controls.target : unionCenter;
        let dir = vp.camera.position.clone().sub(target);
        if (dir.lengthSq() < 1e-4) dir = vp.camera.position.clone().sub(unionCenter);
        if (dir.lengthSq() < 1e-4) dir.set(0.45, 0.55, 1);
        dir.normalize();
        if (dir.y < 0.08) { dir.y = 0.08; dir.normalize(); }

        const camUp = (vp.camera.up || new THREE.Vector3(0, 1, 0)).clone().normalize();
        const fwd = dir.clone().negate(); // camera looks towards unionCenter
        let right = new THREE.Vector3().crossVectors(fwd, camUp);
        if (right.lengthSq() < 1e-4) right.crossVectors(fwd, new THREE.Vector3(0, 0, 1));
        if (right.lengthSq() < 1e-4) right.crossVectors(fwd, new THREE.Vector3(1, 0, 0));
        right.normalize();
        const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

        const fov = vp.camera.fov || 45;
        cam.fov = fov;
        const tanHalfFovY = Math.tan(((fov / 2) * Math.PI) / 180);
        const fitMargin = margin !== 1.25 ? margin : 1.04;

        let maxDistY = 0;
        let maxZ = -Infinity;

        const checkPtY = (pt) => {
          const rx = pt.x - unionCenter.x, ry = pt.y - unionCenter.y, rz = pt.z - unionCenter.z;
          const y = rx * up.x + ry * up.y + rz * up.z;
          const z = rx * dir.x + ry * dir.y + rz * dir.z;
          if (z > maxZ) maxZ = z;
          const dY = (Math.abs(y) * fitMargin) / tanHalfFovY + z;
          if (dY > maxDistY) maxDistY = dY;
        };

        for (const pt of corners) checkPtY(pt);
        for (const m of activeMeshes) {
          const P = m.geometry.getAttribute('position');
          const step = Math.max(1, Math.floor(P.count / 20000));
          for (let i = 0; i < P.count; i += step) {
            tv.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
            checkPtY(tv);
          }
        }

        let dist = Math.max(maxDistY, maxZ + 0.2);

        // Find required aspect ratio to fit width at this distance
        let maxXAngle = 0;
        const checkPtX = (pt) => {
          const rx = pt.x - unionCenter.x, ry = pt.y - unionCenter.y, rz = pt.z - unionCenter.z;
          const x = rx * right.x + ry * right.y + rz * right.z;
          const z = rx * dir.x + ry * dir.y + rz * dir.z;
          const depth = Math.max(0.01, dist - z);
          const angleX = (Math.abs(x) * fitMargin) / depth;
          if (angleX > maxXAngle) maxXAngle = angleX;
        };

        for (const pt of corners) checkPtX(pt);
        for (const m of activeMeshes) {
          const P = m.geometry.getAttribute('position');
          const step = Math.max(1, Math.floor(P.count / 20000));
          for (let i = 0; i < P.count; i += step) {
            tv.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
            checkPtX(tv);
          }
        }

        const rawAspect = maxXAngle / tanHalfFovY;
        const aspect = Math.min(2.4, Math.max(0.65, rawAspect));

        // If aspect was clamped below rawAspect, adjust distance so width fits within clamped aspect
        const tanHalfFovX = tanHalfFovY * aspect;
        let maxDistX = 0;
        const checkDistX = (pt) => {
          const rx = pt.x - unionCenter.x, ry = pt.y - unionCenter.y, rz = pt.z - unionCenter.z;
          const x = rx * right.x + ry * right.y + rz * right.z;
          const z = rx * dir.x + ry * dir.y + rz * dir.z;
          const dX = (Math.abs(x) * fitMargin) / tanHalfFovX + z;
          if (dX > maxDistX) maxDistX = dX;
        };
        for (const pt of corners) checkDistX(pt);

        dist = Math.max(dist, maxDistX, maxZ + 0.2);

        cam.position.copy(unionCenter).addScaledVector(dir, dist);
        if (cam.position.y < floorY + 0.1) cam.position.y = floorY + 0.1;
        cam.up.copy(up);
        cam.lookAt(unionCenter);
        cam.aspect = aspect;
        cam.near = Math.max(0.05, (dist - maxZ) * 0.4);
        cam.far = Math.max(dist * 6, dist + unionSize.length() * 4);
        cam.clearViewOffset();
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        const outW = Math.min(4096, Math.max(64, Math.round(outH * aspect)));
        renderer.setSize(outW, outH, false);
      } else {
        cam.copy(srcCam); cam.clearViewOffset(); cam.aspect = cw / ch; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const m of activeMeshes) {
          const P = m.geometry.getAttribute('position');
          const step = Math.max(1, Math.floor(P.count / 100000));
          for (let i = 0; i < P.count; i += step) {
            tv.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
            if (tv.z > -1e-3) continue; // behind the camera
            tv.applyMatrix4(cam.projectionMatrix);
            if (tv.x < x0) x0 = tv.x; if (tv.x > x1) x1 = tv.x; if (tv.y < y0) y0 = tv.y; if (tv.y > y1) y1 = tv.y;
          }
        }
        for (const pt of corners) {
          tv.copy(pt).applyMatrix4(cam.matrixWorldInverse);
          if (tv.z > -1e-3) continue;
          tv.applyMatrix4(cam.projectionMatrix);
          if (tv.x < x0) x0 = tv.x; if (tv.x > x1) x1 = tv.x; if (tv.y < y0) y0 = tv.y; if (tv.y > y1) y1 = tv.y;
        }
        if (x1 > x0 && y1 > y0) {
          const m = margin, wpx = ((x1 - x0) / 2) * cw * m, hpx = ((y1 - y0) / 2) * ch * m;
          const cx = ((x0 + x1) / 4 + 0.5) * cw, cy = (0.5 - (y0 + y1) / 4) * ch;
          cam.setViewOffset(cw, ch, cx - wpx / 2, cy - hpx / 2, wpx, hpx);
          renderer.setSize(Math.min(4096, Math.max(64, Math.round(outH * wpx / hpx))), outH, false);
        }
        cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      }
    };
    frame();
    pt = new WebGLPathTracer(renderer);
    pt.bounces = 4; pt.filterGlossyFactor = 0.5; pt.tiles.set(2, 2); pt.renderScale = 1;
    pt.setScene(scene, cam);
    const cv = renderer.domElement; let host = cv;
    if (live) { // a backdrop in the stage colour hides the paused viewport; the framed picture sits centred on it
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
        const cyVis = cy ? cy.visible : true;
        if (cy) cy.visible = false;
        const r = dof.capture(scene, cam);
        if (cy) cy.visible = cyVis;
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
      dispose() {
        stop = true;
        if (dof) { dof.dispose(); dof = null; }
        try { if (pt) { if (!pt._renderQuad && pt._quad) pt._renderQuad = pt._quad; pt.dispose(); } } catch {}
        renderer.dispose();
        if (cy) { cy.geometry.dispose(); if (cy.material) cy.material.dispose(); }
        for (const m of activeMeshes) {
          if (m.geometry) m.geometry.dispose();
          if (m.material) m.material.dispose();
        }
        if (host.parentNode) host.parentNode.removeChild(host);
      },
    };
    return job;
  } catch (e) { renderer.dispose(); throw e; }
}
