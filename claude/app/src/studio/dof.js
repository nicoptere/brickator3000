// Depth of field for the path-traced still: a linear-depth pass of the same scene / camera / crop, kept both as a
// texture (for the blur) and as a CPU array (so a click can pick the focus distance), plus a disc-bokeh blur that
// composites the finished image. It runs after the samples have accumulated, so focus can be changed interactively
// without re-tracing anything.
import * as THREE from 'three';

const DEPTH_VERT = `
  varying float vZ;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const DEPTH_FRAG = `
  varying float vZ;
  void main() { gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }`;

const BLUR_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Gather bokeh: each pixel collects over a disc the size of its own circle of confusion.
// Bilateral depth-aware weighting allows out-of-focus background and foreground to smoothly blur
// without hard staircase aliasing at the subject silhouette.
const BLUR_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse, tDepth;
  uniform vec2 uTexel;
  uniform float uFocus, uMaxPx, uRange, uSharp;
  const int TAPS = 160;
  float cocAt(float z) { return z <= 0.0 ? uMaxPx : uMaxPx * clamp(max(abs(z - uFocus) - uSharp, 0.0) / max(uRange, 1e-4), 0.0, 1.0); }
  void main() {
    float z = texture2D(tDepth, vUv).r;
    float coc = cocAt(z);
    vec4 here = texture2D(tDiffuse, vUv);
    if (coc < 0.75) { gl_FragColor = here; return; }
    vec3 sum = here.rgb; float wsum = 1.0;
    float taps = clamp(coc * 1.6, 32.0, float(TAPS));                 // big blur radii need more taps to stay smooth
    for (int i = 0; i < TAPS; i++) {
      if (float(i) >= taps) break;
      float t = (float(i) + 0.5) / taps;
      float r = sqrt(t) * coc;                                  // sqrt => uniform density over the disc
      float a = float(i) * 2.39996323;                          // golden angle spiral
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
      float zs = texture2D(tDepth, uv).r;
      float coc_s = cocAt(zs);
      float w = 1.0;
      if (z <= 0.0) {
        if (zs > 0.0) {
          w = clamp((coc_s - r * 0.75) / max(coc_s * 0.35, 1.0), 0.0, 1.0);
        } else {
          w = 1.0;
        }
      } else {
        if (zs <= 0.0) {
          w = clamp((coc - r * 0.75) / max(coc * 0.35, 1.0), 0.0, 1.0);
        } else {
          float maxC = max(coc, coc_s);
          w = clamp((maxC - r * 0.75) / max(maxC * 0.35, 1.0), 0.0, 1.0);
        }
      }
      sum += texture2D(tDiffuse, uv).rgb * w; wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, here.a);
  }`;

export function createDof(renderer) {
  const depthMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide });
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    tDiffuse: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
    uFocus: { value: 1 }, uMaxPx: { value: 16 }, uRange: { value: 1 }, uSharp: { value: 0 },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, uniforms, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false; quadScene.add(quad);
  let rt = null, cpu = null, w = 0, h = 0, baseTex = null, baseCanvas = null;

  return {
    /** render the depth of `scene` from `cam` at the renderer's current size, and read it back for picking */
    capture(scene, cam) {
      const sz = renderer.getSize(new THREE.Vector2());
      w = Math.max(1, Math.round(sz.x)); h = Math.max(1, Math.round(sz.y));
      if (!rt || rt.width !== w || rt.height !== h) {
        rt && rt.dispose();
        rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        cpu = new Float32Array(w * h * 4);
      }
      const bg = scene.background, prevTarget = renderer.getRenderTarget();
      const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      scene.background = null; scene.overrideMaterial = depthMat;
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, cpu);
      scene.overrideMaterial = null; scene.background = bg;
      renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha);
      uniforms.tDepth.value = rt.texture; uniforms.uTexel.value.set(1 / w, 1 / h);
      return this.range();
    },
    /** keep a copy of the accumulated image: the blur reads from it, so focus can be changed over and over */
    grab(canvas) {
      baseCanvas = document.createElement('canvas'); baseCanvas.width = canvas.width; baseCanvas.height = canvas.height;
      baseCanvas.getContext('2d').drawImage(canvas, 0, 0);
      baseTex && baseTex.dispose();
      baseTex = new THREE.CanvasTexture(baseCanvas);
      baseTex.colorSpace = THREE.NoColorSpace; baseTex.minFilter = baseTex.magFilter = THREE.LinearFilter;
      baseTex.wrapS = baseTex.wrapT = THREE.ClampToEdgeWrapping;
      uniforms.tDiffuse.value = baseTex;
    },
    hasBase: () => !!baseTex,
    /** view-space depth under a normalised image point (0,0 = top left); null where nothing was hit */
    depthAt(u, v) {
      if (!cpu) return null;
      const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1))));
      const y = Math.min(h - 1, Math.max(0, Math.round((1 - v) * (h - 1))));     // readPixels is bottom-up
      const z = cpu[(y * w + x) * 4];
      return z > 0 ? z : null;
    },
    /** near / far of what was actually hit, used to scale the focus falloff and the slider */
    range() {
      if (!cpu) return null;
      let lo = Infinity, hi = 0;
      for (let i = 0; i < cpu.length; i += 4) { const z = cpu[i]; if (z > 0) { if (z < lo) lo = z; if (z > hi) hi = z; } }
      return lo < hi ? { near: lo, far: hi } : null;
    },
    /** draw the blurred image onto the renderer's canvas. focus = view-space distance, maxPx = blur radius in pixels */
    compose({ focus, maxPx = 16, range = null, sharp = 0 }) {
      if (!baseTex || !rt) return false;
      baseTex.needsUpdate = true;
      uniforms.uFocus.value = focus; uniforms.uMaxPx.value = maxPx; uniforms.uSharp.value = sharp;
      uniforms.uRange.value = range || Math.max(1e-3, focus * 0.35);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(null); renderer.render(quadScene, quadCam); renderer.setRenderTarget(prevTarget);
      return true;
    },
    baseCanvas: () => baseCanvas,
    dispose() {
      rt && rt.dispose(); baseTex && baseTex.dispose(); depthMat.dispose();
      quad.geometry.dispose(); quad.material.dispose(); rt = null; cpu = null; baseTex = null; baseCanvas = null;
    },
  };
}
