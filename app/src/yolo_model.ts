import * as ort from 'onnxruntime-web/webgl';
import { getAssetUrl } from './url';
import { loadModelBuffer } from './model_loader';

export type YoloResolution = 256 | 512 | 1024;

export interface YoloModelSpec {
  id: string;
  name: string;
  resolution: number;
  modelUrl: string;
  description: string;
  recommendedFor: 'mobile' | 'desktop' | 'ultra_low_memory';
}

export const YOLO_MODEL_SPECS: Record<string, YoloModelSpec> = {
  'yolo_256': {
    id: 'yolo_256',
    name: 'YOLO11n 256p (Ultra-Light)',
    resolution: 256,
    modelUrl: 'models/yolo11n_seg_256.onnx?v=20260921_256p_v2',
    description: '16x lower memory, fastest inference, ideal for older or memory-constrained phones',
    recommendedFor: 'ultra_low_memory'
  },
  'yolo_512': {
    id: 'yolo_512',
    name: 'YOLO11n 512p (Balanced Mobile)',
    resolution: 512,
    modelUrl: 'models/yolo11n_seg_512.onnx?v=20260921_512p_v2',
    description: '4x lower memory, stable on mobile WebGL, high segmentation accuracy',
    recommendedFor: 'mobile'
  },
  'yolo_1024': {
    id: 'yolo_1024',
    name: 'YOLO11n 1024p (High-Res Desktop)',
    resolution: 1024,
    modelUrl: 'models/yolo11n_seg_1024.onnx?v=20260921_1024p_v2',
    description: 'Maximum resolution, finest edge boundaries for dense piles on desktop',
    recommendedFor: 'desktop'
  }
};

export function isMobileClient(): boolean {
  if (typeof window === 'undefined') return false;
  const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const screenMobile = window.innerWidth <= 768;
  return userAgentMobile || screenMobile;
}

export function getDefaultYoloSpec(): YoloModelSpec {
  return isMobileClient() ? YOLO_MODEL_SPECS['yolo_512'] : YOLO_MODEL_SPECS['yolo_1024'];
}

export interface YoloRawBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
  maskCoeffs: Float32Array;
}

export interface YoloRawInferenceResult {
  boxes: YoloRawBox[];
  out1Data: Float32Array;
  protoDim: number;
  resolution: number;
}

/**
 * YoloModel: Encapsulates ONNX Runtime WebGL session management, dynamic input/output shape handling,
 * and forward inference for arbitrary YOLO resolutions (256, 512, 1024, etc.).
 */
export class YoloModel {
  public spec: YoloModelSpec;
  public resolution: number;
  private session: ort.InferenceSession | null = null;
  private isLoaded: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(specOrResolution?: YoloModelSpec | number) {
    if (typeof specOrResolution === 'number') {
      const found = Object.values(YOLO_MODEL_SPECS).find(s => s.resolution === specOrResolution);
      this.spec = found || {
        id: `yolo_${specOrResolution}`,
        name: `YOLO11n ${specOrResolution}p`,
        resolution: specOrResolution,
        modelUrl: `models/yolo11n_seg_${specOrResolution}.onnx`,
        description: `Custom ${specOrResolution}x${specOrResolution} model`,
        recommendedFor: 'mobile'
      };
      this.resolution = specOrResolution;
    } else if (specOrResolution) {
      this.spec = specOrResolution;
      this.resolution = specOrResolution.resolution;
    } else {
      this.spec = getDefaultYoloSpec();
      this.resolution = this.spec.resolution;
    }
  }

  public get loaded(): boolean {
    return this.isLoaded && this.session !== null;
  }

  /**
   * Initializes and loads the ONNX session into WebGL shader memory.
   */
  public async init(onStatus?: (status: string) => void): Promise<void> {
    if (this.isLoaded && this.session) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const fullUrl = getAssetUrl(this.spec.modelUrl);
        if (onStatus) onStatus(`Loading WebGL ${this.spec.name} (${this.resolution}p)...`);
        const buffer = await loadModelBuffer(fullUrl, onStatus);

        if (onStatus) onStatus(`Compiling WebGL ${this.spec.name} shaders...`);
        const sessionOptions: ort.InferenceSession.SessionOptions = {
          executionProviders: ['webgl'],
          graphOptimizationLevel: 'all'
        };

        this.session = await ort.InferenceSession.create(new Uint8Array(buffer), sessionOptions);
        this.isLoaded = true;
        console.log(`✓ [YoloModel] ${this.spec.name} initialized successfully (Resolution: ${this.resolution}x${this.resolution}).`);
      } catch (err: any) {
        this.session = null;
        this.isLoaded = false;
        console.warn(`[YoloModel] Initialization failed for ${this.spec.name}:`, err);
        throw err;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Warms up the WebGL shaders with a dummy input tensor of shape [1, 3, resolution, resolution].
   */
  public async warmup(): Promise<void> {
    if (!this.session) return;
    try {
      const dim = this.resolution;
      const dummyData = new Float32Array(1 * 3 * dim * dim);
      const inputTensor = new ort.Tensor('float32', dummyData, [1, 3, dim, dim]);
      const inputName = this.session.inputNames[0] || 'images';
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const results = await this.session.run(feeds);
      for (const name of this.session.outputNames) {
        const tensor = results[name];
        if (tensor && (tensor as any).getData) {
          await (tensor as any).getData();
        }
      }
      console.log(`✓ [YoloModel] Warmed up ${this.spec.name} (${dim}x${dim}).`);
    } catch (err) {
      console.warn(`[YoloModel] Warmup warning for ${this.spec.name}:`, err);
    }
  }

  /**
   * Runs forward pass on a letterbox canvas of size [resolution x resolution].
   * Dynamically inspects output tensor dimensions:
   *   output0: [1, 37, numAnchors]
   *   output1: [1, 32, protoDim, protoDim]
   */
  public async predict(
    letterboxCanvas: HTMLCanvasElement,
    confThresh: number
  ): Promise<YoloRawInferenceResult> {
    if (!this.session) {
      throw new Error(`YOLO session is not initialized for ${this.spec.name}`);
    }

    const dim = this.resolution;
    const ctx = letterboxCanvas.getContext('2d', { willReadFrequently: true })!;
    const imgData = ctx.getImageData(0, 0, dim, dim).data;
    const floatData = new Float32Array(3 * dim * dim);
    const planeSize = dim * dim;

    for (let i = 0; i < planeSize; i++) {
      floatData[i] = imgData[i * 4] / 255.0;                     // R
      floatData[planeSize + i] = imgData[i * 4 + 1] / 255.0;     // G
      floatData[planeSize * 2 + i] = imgData[i * 4 + 2] / 255.0; // B
    }

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, dim, dim]);
    const inputName = this.session.inputNames[0] || 'images';
    const feeds: Record<string, ort.Tensor> = {};
    feeds[inputName] = inputTensor;

    const results = await this.session.run(feeds);
    const out0Name = this.session.outputNames[0]; // e.g. [1, 37, numAnchors]
    const out1Name = this.session.outputNames[1]; // e.g. [1, 32, protoDim, protoDim]

    const out0 = results[out0Name];
    const out0Data = (out0.getData ? await out0.getData() : out0.data) as Float32Array;
    const out1 = results[out1Name];
    const out1Data = (out1.getData ? await out1.getData() : out1.data) as Float32Array;

    const numAnchors = out0.dims[2];
    const protoDim = out1.dims[2] || out1.dims[3] || Math.round(dim / 4);

    const boxes: YoloRawBox[] = [];

    for (let j = 0; j < numAnchors; j++) {
      const score = out0Data[4 * numAnchors + j];
      if (score < confThresh) continue;

      const cx = out0Data[0 * numAnchors + j];
      const cy = out0Data[1 * numAnchors + j];
      const w = out0Data[2 * numAnchors + j];
      const h = out0Data[3 * numAnchors + j];

      const maskCoeffs = new Float32Array(32);
      for (let k = 0; k < 32; k++) {
        maskCoeffs[k] = out0Data[(5 + k) * numAnchors + j];
      }

      boxes.push({ cx, cy, w, h, score, maskCoeffs });
    }

    return {
      boxes,
      out1Data,
      protoDim,
      resolution: dim
    };
  }

  /**
   * Safely release WebGL resources when switching models.
   */
  public async dispose(): Promise<void> {
    if (this.session) {
      try {
        if ((this.session as any).release) {
          await (this.session as any).release();
        }
      } catch (e) {
        console.warn('Error releasing YOLO session:', e);
      }
      this.session = null;
      this.isLoaded = false;
    }
  }
}
