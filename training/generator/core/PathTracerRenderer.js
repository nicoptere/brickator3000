import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

/**
 * PathTracerRenderer: High-performance Monte Carlo path tracing wrapper
 * around Three.js WebGLRenderer and WebGLPathTracer.
 * Fully decoupled from DOM APIs to support both browser canvas and headless node-webgl.
 */
export class PathTracerRenderer {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement|object} options.canvas
   * @param {number} [options.width=512]
   * @param {number} [options.height=512]
   * @param {number} [options.bounces=4]
   * @param {[number, number]} [options.tiles=[2, 2]]
   * @param {number} [options.filterGlossyFactor=0.8]
   * @param {number} [options.exposure=1.0]
   */
  constructor(options) {
    this.canvas = options.canvas;
    this.context = options.context || null;
    this.width = options.width || 512;
    this.height = options.height || 512;
    this.bounces = options.bounces || 4;
    this.tiles = options.tiles || [2, 2];
    this.filterGlossyFactor = options.filterGlossyFactor ?? 0.8;
    this.exposure = options.exposure ?? 1.20; // Global brightness boost (+25%)

    this.samples = 0;
    this.isRendering = false;
    this.cancelRequested = false;

    this.init();
  }

  setExposure(exposure) {
    this.exposure = exposure;
    if (this.renderer) {
      this.renderer.toneMappingExposure = exposure;
    }
  }

  init() {
    const rendererParams = {
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    };
    if (this.context) {
      rendererParams.context = this.context;
    }

    this.renderer = new THREE.WebGLRenderer(rendererParams);

    this.renderer.setSize(this.width, this.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.exposure;

    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.filterGlossyFactor = this.filterGlossyFactor;
    this.pathTracer.minSamples = 1;
    this.pathTracer.renderScale = 1.0;
    this.pathTracer.bounces = this.bounces;
    this.pathTracer.tiles.set(this.tiles[0], this.tiles[1]);
  }

  /**
   * Binds Three.js scene and camera to the path tracer and generates BVH
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.pathTracer.setScene(scene, camera);
    this.reset();
  }

  /**
   * Resets sample accumulation
   */
  reset() {
    this.pathTracer.reset();
    this.samples = 0;
  }

  /**
   * Renders a single progressive Monte Carlo sample pass
   * @returns {number} Current sample count
   */
  renderSample() {
    this.pathTracer.renderSample();
    this.samples++;
    return this.samples;
  }

  /**
   * Progressively renders up to targetSamples while yielding to the event loop
   * @param {number} targetSamples
   * @param {(samples: number, total: number) => void} [onProgress]
   * @returns {Promise<number>}
   */
  async renderSamples(targetSamples = 36, onProgress = null) {
    this.isRendering = true;
    this.cancelRequested = false;

    return new Promise((resolve) => {
      const step = () => {
        if (this.cancelRequested || this.samples >= targetSamples) {
          this.isRendering = false;
          if (onProgress) onProgress(this.samples, targetSamples);
          resolve(this.samples);
          return;
        }

        // Render 1 or 2 sample passes per micro-tick
        this.renderSample();

        if (onProgress) {
          onProgress(this.samples, targetSamples);
        }

        // Use requestAnimationFrame if available (browser), else setImmediate/setTimeout
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(step);
        } else {
          setTimeout(step, 0);
        }
      };

      step();
    });
  }

  /**
   * Synchronous accumulation loop (for headless / batch CLI scripts)
   * @param {number} targetSamples
   * @returns {number}
   */
  renderSamplesSync(targetSamples = 36) {
    for (let s = this.samples; s < targetSamples; s++) {
      this.renderSample();
    }
    return this.samples;
  }

  cancel() {
    this.cancelRequested = true;
    this.isRendering = false;
  }

  /**
   * Directly extracts RGBA pixel buffer from WebGL context (fast path for node-webgl)
   * @param {Uint8Array} [buffer] Optional pre-allocated buffer
   * @returns {Uint8Array}
   */
  readPixels(buffer = null) {
    const gl = this.renderer.getContext();
    const w = this.width;
    const h = this.height;
    const buf = buffer || new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  /**
   * Exports canvas as PNG Data URL
   * @param {string} [mimeType='image/png']
   * @returns {string}
   */
  toDataURL(mimeType = 'image/png') {
    if (this.canvas && typeof this.canvas.toDataURL === 'function') {
      return this.canvas.toDataURL(mimeType);
    }
    return null;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.pathTracer.setSize(width, height);
    this.reset();
  }

  dispose() {
    this.cancel();
    if (this.pathTracer && typeof this.pathTracer.dispose === 'function') {
      this.pathTracer.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
