import * as ort from 'onnxruntime-web/webgl';
(window as any).ort = ort;
import { BoundingBox, Point2D } from './types';
import { PatchCandidate } from './segmenter';
import {
  YoloModel,
  YoloModelSpec,
  YOLO_MODEL_SPECS,
  getDefaultYoloSpec,
  isMobileClient,
  YoloResolution
} from './yolo_model';

export {
  YoloModel,
  YOLO_MODEL_SPECS,
  getDefaultYoloSpec,
  isMobileClient
};
export type { YoloModelSpec, YoloResolution };

export interface YoloDetection {
  box: BoundingBox;      // Original image pixel coordinates [x, y, w, h]
  normBox: BoundingBox;  // Normalized [0..1] coordinates
  score: number;
  classId: number;
  mask?: Float32Array;
  polygon?: Point2D[];
}

export interface SahiOptions {
  tileDim?: number;        // Default: matches active model resolution (e.g. 512 or 1024)
  overlapRatio?: number;   // Default: 0.25 (25% overlap)
  confThresh?: number;     // Default: 0.20
  iouThresh?: number;      // Default: 0.40
  seamMargin?: number;     // Default: 2px boundary discard
  includeOverview?: boolean; // Run global overview for massive pieces (default: true)
}

export interface SahiProgressEvent {
  stage: 'overview' | 'slicing' | 'fusion' | 'done';
  currentTile: number;
  totalTiles: number;
  percent: number;
  foundCount: number;
  logMessage: string;
  tileBox?: BoundingBox;
}

interface RawTileDetection {
  box: BoundingBox; // Global image coordinates
  score: number;
  classId: number;
  polygon?: Point2D[]; // Global image coordinates
  maskCoeffs?: Float32Array;
  out1Data?: Float32Array;
  protoDim?: number;
  isGlobal?: boolean;
  tx?: number;
  ty?: number;
  tileX?: number;
  tileY?: number;
  tileWBox?: number;
  tileHBox?: number;
  protoRatio?: number;
  r?: number;
  padX?: number;
  padY?: number;
  gProtoRatio?: number;
}

export class YoloSegmenter {
  public model: YoloModel;

  constructor(modelOrSpec?: YoloModel | YoloModelSpec | number | string) {
    if (modelOrSpec instanceof YoloModel) {
      this.model = modelOrSpec;
    } else if (typeof modelOrSpec === 'string') {
      const foundSpec = YOLO_MODEL_SPECS[modelOrSpec];
      if (foundSpec) {
        this.model = new YoloModel(foundSpec);
      } else {
        this.model = new YoloModel({
          id: 'custom',
          name: 'Custom YOLO',
          resolution: 512,
          modelUrl: modelOrSpec,
          description: 'Custom model URL',
          recommendedFor: 'mobile'
        });
      }
    } else {
      this.model = new YoloModel(modelOrSpec);
    }
  }

  public get targetDim(): number {
    return this.model.resolution;
  }

  public set targetDim(val: number) {
    this.model.resolution = val;
  }

  public get isLoaded(): boolean {
    return this.model.loaded;
  }

  public async init(onStatus?: (status: string) => void): Promise<void> {
    return this.model.init(onStatus);
  }

  /**
   * Warms up YOLO on GPU by executing a dummy inference pass at the model's native resolution.
   * Compiles WebGL shaders and caches FPN and Proto mask pipelines in GPU memory.
   */
  public async warmup(): Promise<void> {
    return this.model.warmup();
  }

  /**
   * Switch active model resolution dynamically (e.g. between 256p, 512p, 1024p).
   */
  public async switchResolution(resolution: number, onStatus?: (s: string) => void): Promise<void> {
    if (this.model.resolution === resolution && this.model.loaded) return;
    await this.model.dispose();
    this.model = new YoloModel(resolution);
    await this.model.init(onStatus);
    await this.model.warmup();
  }

  /**
   * Standard single-pass YOLO11-seg inference letterboxed to targetDim x targetDim
   */
  public async segment(
    image: HTMLImageElement | HTMLCanvasElement,
    confThresh = 0.20,
    iouThresh = 0.40,
    onStatus?: (status: string) => void,
    onProgress?: (evt: SahiProgressEvent) => void,
    applyMask = false
  ): Promise<PatchCandidate[]> {
    if (!this.model.loaded) {
      await this.init(onStatus);
    }
    if (!this.model.loaded) return [];

    const origW = (image as HTMLImageElement).naturalWidth || image.width;
    const origH = (image as HTMLImageElement).naturalHeight || image.height;

    if (onStatus) onStatus(`Running client-side YOLO11-seg inference (${this.targetDim}p)...`);
    if (onProgress) onProgress({ stage: 'overview', currentTile: 0, totalTiles: 1, percent: 15, foundCount: 0, logMessage: `Preparing ${this.targetDim}p letterbox image...`, tileBox: { x: 0, y: 0, w: origW, h: origH } });
    const t0 = performance.now();

    // 1. Preprocess: Letterbox to targetDim x targetDim
    const targetDim = this.targetDim;
    const r = Math.min(targetDim / origW, targetDim / origH);
    const newW = Math.round(origW * r);
    const newH = Math.round(origH * r);
    const padX = Math.floor((targetDim - newW) / 2);
    const padY = Math.floor((targetDim - newH) / 2);

    const letterboxCanvas = document.createElement('canvas');
    letterboxCanvas.width = targetDim;
    letterboxCanvas.height = targetDim;
    const ctx = letterboxCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    // Fill letterbox border with standard gray (114, 114, 114)
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, targetDim, targetDim);
    ctx.drawImage(image, padX, padY, newW, newH);

    if (onProgress) onProgress({ stage: 'overview', currentTile: 1, totalTiles: 1, percent: 45, foundCount: 0, logMessage: 'Running client-side YOLO11 GPU neural network inference...', tileBox: { x: 0, y: 0, w: origW, h: origH } });
    const rawDetections = await this.runYoloInference(letterboxCanvas, confThresh);

    // Unpad and scale back to original image space
    const decoded: Array<{
      box: BoundingBox;
      score: number;
      classId: number;
      maskCoeffs: Float32Array;
    }> = [];

    for (const det of rawDetections.boxes) {
      const origX = Math.max(0, (det.cx - det.w / 2 - padX) / r);
      const origY = Math.max(0, (det.cy - det.h / 2 - padY) / r);
      const origWBox = Math.min(origW - origX, det.w / r);
      const origHBox = Math.min(origH - origY, det.h / r);

      if (origWBox < 10 || origHBox < 10) continue;

      decoded.push({
        box: { x: Math.round(origX), y: Math.round(origY), w: Math.round(origWBox), h: Math.round(origHBox) },
        score: det.score,
        classId: 0,
        maskCoeffs: det.maskCoeffs
      });
    }

    // 2. Non-Maximum Suppression (NMS) with IoU & Containment (IoM) suppression
    decoded.sort((a, b) => b.score - a.score);
    const keptDetections: typeof decoded = [];

    for (const candidate of decoded) {
      let isSuppressed = false;
      for (const kept of keptDetections) {
        const metrics = this.computeOverlapMetrics(candidate.box, kept.box);
        if (metrics.iou > iouThresh || metrics.iom > 0.88) {
          isSuppressed = true;
          break;
        }
      }
      if (!isSuppressed) {
        keptDetections.push(candidate);
        if (keptDetections.length >= 120) break;
      }
    }

    const elapsed = (performance.now() - t0).toFixed(1);
    console.log(`✓ [YOLO Pass: Direct 1024p Overview] Found ${rawDetections.boxes.length} raw proposals -> ${keptDetections.length} pieces after NMS in ${elapsed}ms.`);
    if (onProgress) onProgress({ stage: 'fusion', currentTile: 1, totalTiles: 1, percent: 85, foundCount: keptDetections.length, logMessage: `Found ${keptDetections.length} pieces. Preparing neural patches...` });

    // 3. Convert to PatchCandidates (224x224 square crops for Bricknet)
    const patches = await this.buildPatchCandidatesFromDetections(
      image,
      origW,
      origH,
      keptDetections,
      rawDetections.out1Data,
      rawDetections.protoDim,
      r,
      padX,
      padY,
      applyMask
    );
    if (onProgress) onProgress({ stage: 'done', currentTile: 1, totalTiles: 1, percent: 100, foundCount: patches.length, logMessage: `YOLO pass complete (${patches.length} patches ready).` });
    return patches;
  }

  /**
   * Slicing Aided Hyper Inference (SAHI) with pure client-side TypeScript:
   * Step 1: Coordinate Translation (tile -> global image)
   * Step 2: Seam-Trim Discard Filter (prune seam-straddling detections)
   * Step 3: Global NMS Deduplication (IoU + containment IoM suppression)
   */
  public async segmentSahi(
    image: HTMLImageElement | HTMLCanvasElement,
    options?: SahiOptions,
    onStatus?: (status: string) => void,
    onProgress?: (evt: SahiProgressEvent) => void,
    applyMask = false
  ): Promise<PatchCandidate[]> {
    if (!this.model.loaded) {
      await this.init(onStatus);
    }
    if (!this.model.loaded) return [];

    const tileDim = options?.tileDim || this.targetDim;
    const overlapRatio = options?.overlapRatio !== undefined ? options?.overlapRatio : 0.25;
    const confThresh = options?.confThresh !== undefined ? options?.confThresh : 0.20;
    const iouThresh = options?.iouThresh !== undefined ? options?.iouThresh : 0.40;
    const seamMargin = options?.seamMargin !== undefined ? options?.seamMargin : 2;
    const includeOverview = options?.includeOverview !== false;

    const origW = (image as HTMLImageElement).naturalWidth || image.width;
    const origH = (image as HTMLImageElement).naturalHeight || image.height;

    // If image fits inside a single tile without downscaling, run standard pass
    if (origW <= tileDim && origH <= tileDim) {
      return this.segment(image, confThresh, iouThresh, onStatus);
    }

    if (onStatus) onStatus(`[SAHI Pass 1/3] Running global 1024p overview...`);
    if (onProgress) {
      onProgress({
        stage: 'overview',
        currentTile: 0,
        totalTiles: 1,
        percent: 10,
        foundCount: 0,
        logMessage: `[SAHI Pass 1/3: Global Overview] Scanning full image at 1024p overview...`,
        tileBox: { x: 0, y: 0, w: origW, h: origH }
      });
    }
    const t0 = performance.now();

    const allDetections: RawTileDetection[] = [];

    // ------------------------------------------------------------------------
    // PASS 1: Single global 1024x1024 YOLO pass across full image
    // Captures macroscopic bricks, long antennas/beams, and overall layout seamlessly
    // ------------------------------------------------------------------------
    const targetDim = this.targetDim;
    const r = Math.min(targetDim / origW, targetDim / origH);
    const newW = Math.round(origW * r);
    const newH = Math.round(origH * r);
    const padX = Math.floor((targetDim - newW) / 2);
    const padY = Math.floor((targetDim - newH) / 2);

    const letterboxCanvas = document.createElement('canvas');
    letterboxCanvas.width = targetDim;
    letterboxCanvas.height = targetDim;
    const lCtx = letterboxCanvas.getContext('2d', { willReadFrequently: true });
    if (!lCtx) return [];

    lCtx.fillStyle = '#727272';
    lCtx.fillRect(0, 0, targetDim, targetDim);
    lCtx.drawImage(image, padX, padY, newW, newH);

    const globalResult = await this.runYoloInference(letterboxCanvas, confThresh);
    const gProtoDim = globalResult.protoDim;
    const gProtoRatio = targetDim / gProtoDim;

    for (const det of globalResult.boxes) {
      const origX = Math.max(0, (det.cx - det.w / 2 - padX) / r);
      const origY = Math.max(0, (det.cy - det.h / 2 - padY) / r);
      const origWBox = Math.min(origW - origX, det.w / r);
      const origHBox = Math.min(origH - origY, det.h / r);

      if (origWBox < 10 || origHBox < 10) continue;

      allDetections.push({
        box: {
          x: Math.round(origX),
          y: Math.round(origY),
          w: Math.round(origWBox),
          h: Math.round(origHBox)
        },
        score: det.score,
        classId: 0,
        maskCoeffs: det.maskCoeffs,
        out1Data: globalResult.out1Data,
        protoDim: gProtoDim,
        isGlobal: true,
        r,
        padX,
        padY,
        gProtoRatio
      });
    }

    const pass1Count = allDetections.length;
    const dtPass1 = Math.round(performance.now() - t0);
    console.log(`✓ [YOLO Pass 1/3: Global Overview] Captured ${pass1Count} baseline pieces in ${dtPass1}ms.`);

    if (onProgress) {
      onProgress({
        stage: 'overview',
        currentTile: 1,
        totalTiles: 1,
        percent: 20,
        foundCount: pass1Count,
        logMessage: `✓ [SAHI Pass 1/3: Global Overview] Found ${pass1Count} baseline pieces in ${dtPass1}ms.`
      });
      await new Promise(r => setTimeout(r, 20));
    }

    // ------------------------------------------------------------------------
    // PASS 2: Sliced 1024p SAHI tiles to complement & detect fine-grained / occluded pieces
    // ------------------------------------------------------------------------
    const stride = Math.round(tileDim * (1.0 - overlapRatio)); // e.g. 768px
    const xSteps: number[] = [];
    for (let x = 0; x <= origW - tileDim; x += stride) {
      xSteps.push(x);
    }
    if (xSteps.length === 0 || xSteps[xSteps.length - 1] !== Math.max(0, origW - tileDim)) {
      xSteps.push(Math.max(0, origW - tileDim));
    }

    const ySteps: number[] = [];
    for (let y = 0; y <= origH - tileDim; y += stride) {
      ySteps.push(y);
    }
    if (ySteps.length === 0 || ySteps[ySteps.length - 1] !== Math.max(0, origH - tileDim)) {
      ySteps.push(Math.max(0, origH - tileDim));
    }

    const totalTiles = xSteps.length * ySteps.length;
    const slicingMsg = `[YOLO Pass 2/3: High-Res Slicing] Slicing ${origW}x${origH} into ${totalTiles} tiles (${xSteps.length}x${ySteps.length} grid, ${tileDim}px, stride ${stride}px)...`;
    console.log(slicingMsg);

    if (onProgress) {
      onProgress({
        stage: 'slicing',
        currentTile: 0,
        totalTiles,
        percent: 25,
        foundCount: pass1Count,
        logMessage: slicingMsg
      });
      await new Promise(r => setTimeout(r, 20));
    }

    // Prepare helper canvas for full image
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = origW;
    fullCanvas.height = origH;
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
    if (!fullCtx) return [];
    fullCtx.drawImage(image, 0, 0);

    let tileIdx = 0;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileDim;
    tileCanvas.height = tileDim;
    const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
    if (!tileCtx) return [];

    for (const ty of ySteps) {
      for (const tx of xSteps) {
        tileIdx++;
        const actualW = Math.min(tileDim, origW - tx);
        const actualH = Math.min(tileDim, origH - ty);

        if (onStatus) onStatus(`Pass 2/2: Scanning high-res tile ${tileIdx}/${totalTiles}...`);
        if (onProgress) {
          onProgress({
            stage: 'slicing',
            currentTile: tileIdx,
            totalTiles,
            percent: 25 + Math.round((tileIdx / totalTiles) * 55),
            foundCount: allDetections.length,
            logMessage: `[YOLO Pass 2/3] Scanning high-res tile ${tileIdx}/${totalTiles}...`,
            tileBox: { x: tx, y: ty, w: actualW, h: actualH }
          });
        }

        tileCtx.fillStyle = '#727272';
        tileCtx.fillRect(0, 0, tileDim, tileDim);
        tileCtx.drawImage(fullCanvas, tx, ty, actualW, actualH, 0, 0, actualW, actualH);

        // Yield to main thread so browser renders punched-out frame before tile inference
        await new Promise(r => setTimeout(r, 20));

        const tileResult = await this.runYoloInference(tileCanvas, confThresh);
        const protoDim = tileResult.protoDim;
        const protoRatio = tileDim / protoDim;

        for (const det of tileResult.boxes) {
          const tileX = Math.round(det.cx - det.w / 2);
          const tileY = Math.round(det.cy - det.h / 2);
          const tileWBox = Math.round(det.w);
          const tileHBox = Math.round(det.h);

          if (tileWBox < 10 || tileHBox < 10) continue;

          // Seam-trim: only drop if genuinely truncated at tile border
          const touchesLeftSeam = tx > 0 && tileX <= seamMargin;
          const touchesTopSeam = ty > 0 && tileY <= seamMargin;
          const touchesRightSeam = (tx + tileDim < origW) && (tileX + tileWBox >= tileDim - seamMargin);
          const touchesBottomSeam = (ty + tileDim < origH) && (tileY + tileHBox >= tileDim - seamMargin);

          if (touchesLeftSeam || touchesTopSeam || touchesRightSeam || touchesBottomSeam) {
            continue;
          }

          allDetections.push({
            box: {
              x: Math.min(origW - 10, Math.max(0, tileX + tx)),
              y: Math.min(origH - 10, Math.max(0, tileY + ty)),
              w: Math.min(origW - (tileX + tx), tileWBox),
              h: Math.min(origH - (tileY + ty), tileHBox)
            },
            score: det.score,
            classId: 0,
            maskCoeffs: det.maskCoeffs,
            out1Data: tileResult.out1Data,
            protoDim,
            protoRatio,
            tileX,
            tileY,
            tx,
            ty,
            tileWBox,
            tileHBox
          });
        }

        const tileMsg = `└ [Tile ${tileIdx}/${totalTiles}] at (${tx}, ${ty}) -> +${tileResult.boxes.length} raw candidates`;
        console.log(`  ${tileMsg}`);

        if (onProgress) {
          const tilePct = Math.round(25 + (tileIdx / totalTiles) * 65);
          onProgress({
            stage: 'slicing',
            currentTile: tileIdx,
            totalTiles,
            percent: tilePct,
            foundCount: allDetections.length,
            logMessage: tileMsg
          });
          // CRITICAL: Yield to browser rendering engine so React paints progress bar & log lines
          await new Promise(r => setTimeout(r, 25));
        }
      }
    }

    // ------------------------------------------------------------------------
    // PASS 3: Global NMS Deduplication & Fusion (merge Pass 1 & Pass 2)
    // ------------------------------------------------------------------------
    const pass2Count = allDetections.length - pass1Count;

    if (onProgress) {
      onProgress({
        stage: 'slicing',
        currentTile: totalTiles,
        totalTiles,
        percent: 90,
        foundCount: allDetections.length,
        logMessage: `✓ [YOLO Pass 2/3: Slicing Complete] Scanned ${totalTiles} tiles -> +${pass2Count} slice pieces (${allDetections.length} total pre-NMS).`
      });
      await new Promise(r => setTimeout(r, 20));
    }

    if (onProgress) {
      onProgress({
        stage: 'fusion',
        currentTile: totalTiles,
        totalTiles,
        percent: 94,
        foundCount: allDetections.length,
        logMessage: `[YOLO Pass 3/3: Global Fusion] Running NMS deduplication across ${allDetections.length} candidate pieces...`
      });
      await new Promise(r => setTimeout(r, 20));
    }

    allDetections.sort((a, b) => b.score - a.score);
    const keptDetections: RawTileDetection[] = [];

    for (const candidate of allDetections) {
      let isSuppressed = false;
      for (const kept of keptDetections) {
        const metrics = this.computeOverlapMetrics(candidate.box, kept.box);
        if (metrics.iou > iouThresh || metrics.iom > 0.82) {
          isSuppressed = true;
          break;
        }
      }
      if (!isSuppressed) {
        keptDetections.push(candidate);
        if (keptDetections.length >= 350) break;
      }
    }

    // Extract smooth sub-pixel polygons ONLY for kept detections after NMS deduplication (eliminates 1.5B wasted ops!)
    for (const det of keptDetections) {
      if (det.polygon) continue;
      if (!det.maskCoeffs || !det.out1Data) continue;

      if (det.isGlobal) {
        det.polygon = YoloSegmenter.extractSmoothPolygon(
          det.out1Data,
          det.protoDim!,
          det.maskCoeffs,
          det.box.x,
          det.box.y,
          det.box.w,
          det.box.h,
          (gx, gy, G) => {
            const py_img = det.box.y + ((gy + 0.5) / G) * det.box.h;
            const px_img = det.box.x + ((gx + 0.5) / G) * det.box.w;
            const ly = py_img * det.r! + det.padY!;
            const lx = px_img * det.r! + det.padX!;
            return {
              x: lx / det.gProtoRatio!,
              y: ly / det.gProtoRatio!
            };
          }
        );
      } else {
        const { tileX, tileY, tx, ty, tileWBox, tileHBox, protoRatio } = det;
        det.polygon = YoloSegmenter.extractSmoothPolygon(
          det.out1Data,
          det.protoDim!,
          det.maskCoeffs,
          tileX! + tx!,
          tileY! + ty!,
          tileWBox!,
          tileHBox!,
          (gx, gy, G) => {
            const py_tile = tileY! + ((gy + 0.5) / G) * tileHBox!;
            const px_tile = tileX! + ((gx + 0.5) / G) * tileWBox!;
            return {
              x: px_tile / protoRatio!,
              y: py_tile / protoRatio!
            };
          }
        );
      }
    }

    const elapsed = (performance.now() - t0).toFixed(1);
    const duplicatesRemoved = allDetections.length - keptDetections.length;
    console.log(`✓ [YOLO Pass 3/3: Global Fusion & NMS] Merged ${pass1Count} overview + ${pass2Count} sliced pieces -> ${keptDetections.length} deduplicated pieces (${duplicatesRemoved} overlaps removed) in ${elapsed}ms.`);

    if (onProgress) {
      onProgress({
        stage: 'done',
        currentTile: totalTiles,
        totalTiles,
        percent: 100,
        foundCount: keptDetections.length,
        logMessage: `✓ [SAHI Complete] ${keptDetections.length} verified pieces found (${duplicatesRemoved} duplicates removed) in ${elapsed}ms.`
      });
      await new Promise(r => setTimeout(r, 20));
    }

    // Convert kept detections directly to PatchCandidates with isotropic letterboxed padding
    const candidates: PatchCandidate[] = [];

    for (const det of keptDetections) {
      const patch = YoloSegmenter.extractLetterboxPatch(image, origW, origH, det.box, det.polygon, applyMask);
      if (!patch) continue;

      candidates.push({
        box: det.box,
        normBox: {
          x: det.box.x / origW,
          y: det.box.y / origH,
          w: det.box.w / origW,
          h: det.box.h / origH
        },
        polygon: det.polygon,
        tensorData: patch.tensorData,
        patchCanvas: patch.patchCanvas
      });
    }

    return candidates;
  }

  /**
   * Internal forward pass helper: delegates directly to this.model.predict
   */
  private async runYoloInference(
    canvas: HTMLCanvasElement,
    confThresh: number
  ): Promise<{
    boxes: Array<{ cx: number; cy: number; w: number; h: number; score: number; maskCoeffs: Float32Array }>;
    out1Data: Float32Array;
    protoDim: number;
  }> {
    return this.model.predict(canvas, confThresh);
  }

  /**
   * High-precision smooth polygon boundary extraction from prototype masks.
   * Evaluates a 112x112 sub-grid, traces the outer perimeter,
   * applies 5-tap Gaussian smoothing to eliminate discrete integer staircase artifacts,
   * and simplifies collinear segments with RDP.
   */
  public static extractSmoothPolygon(
    out1Data: Float32Array,
    protoDim: number,
    maskCoeffs: Float32Array,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    coordTransform: (gx: number, gy: number, G: number) => { x: number; y: number }
  ): Point2D[] {
    const G = 112;
    const maskGrid = new Uint8Array(G * G);
    const protoPlane = protoDim * protoDim;

    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const { x: px, y: py } = coordTransform(gx, gy, G);
        const protoX = Math.min(protoDim - 1, Math.max(0, Math.floor(px)));
        const protoY = Math.min(protoDim - 1, Math.max(0, Math.floor(py)));
        const protoRowOffset = protoY * protoDim;

        let dot = 0.0;
        for (let k = 0; k < 32; k++) {
          dot += maskCoeffs[k] * out1Data[k * protoPlane + protoRowOffset + protoX];
        }
        if (dot > 0.0) {
          maskGrid[gy * G + gx] = 1;
        }
      }
    }

    const rawPoints = YoloSegmenter.traceContour(maskGrid, G, G);
    if (rawPoints.length < 3) {
      return [
        { x: boxX, y: boxY },
        { x: boxX + boxW, y: boxY },
        { x: boxX + boxW, y: boxY + boxH },
        { x: boxX, y: boxY + boxH }
      ];
    }

    // 5-tap Gaussian smoothing on discrete raster contour
    const N = rawPoints.length;
    const smoothedPoints: Point2D[] = [];
    for (let i = 0; i < N; i++) {
      const p_2 = rawPoints[(i - 2 + N) % N];
      const p_1 = rawPoints[(i - 1 + N) % N];
      const p_0 = rawPoints[i];
      const p_p1 = rawPoints[(i + 1) % N];
      const p_p2 = rawPoints[(i + 2) % N];

      const smX = p_2.x * 0.0625 + p_1.x * 0.25 + p_0.x * 0.375 + p_p1.x * 0.25 + p_p2.x * 0.0625;
      const smY = p_2.y * 0.0625 + p_1.y * 0.25 + p_0.y * 0.375 + p_p1.y * 0.25 + p_p2.y * 0.0625;

      const imgX = boxX + (smX + 0.5) / G * boxW;
      const imgY = boxY + (smY + 0.5) / G * boxH;
      smoothedPoints.push({ x: imgX, y: imgY });
    }

    // Ramer-Douglas-Peucker simplification with 1.5px image tolerance
    const simplified = YoloSegmenter.simplifyClosedPolygon(smoothedPoints, 1.5);
    return YoloSegmenter.cleanCollinearPoints(simplified);
  }

  private buildPatchCandidatesFromDetections(
    image: HTMLImageElement | HTMLCanvasElement,
    origW: number,
    origH: number,
    keptDetections: Array<{ box: BoundingBox; score: number; classId: number; maskCoeffs: Float32Array }>,
    out1Data: Float32Array,
    protoDim: number,
    r: number,
    padX: number,
    padY: number,
    applyMask = false
  ): PatchCandidate[] {
    const candidates: PatchCandidate[] = [];
    const protoRatio = this.targetDim / protoDim;

    for (const det of keptDetections) {
      const { x, y, w, h } = det.box;

      const polygon = YoloSegmenter.extractSmoothPolygon(
        out1Data,
        protoDim,
        det.maskCoeffs,
        x,
        y,
        w,
        h,
        (gx, gy, G) => {
          const py_img = y + ((gy + 0.5) / G) * h;
          const px_img = x + ((gx + 0.5) / G) * w;
          const ly = py_img * r + padY;
          const lx = px_img * r + padX;
          return {
            x: lx / protoRatio,
            y: ly / protoRatio
          };
        }
      );

      const patch = YoloSegmenter.extractLetterboxPatch(image, origW, origH, det.box, polygon, applyMask);
      if (!patch) continue;

      candidates.push({
        box: det.box,
        normBox: {
          x: det.box.x / origW,
          y: det.box.y / origH,
          w: det.box.w / origW,
          h: det.box.h / origH
        },
        polygon,
        tensorData: patch.tensorData,
        patchCanvas: patch.patchCanvas
      });
    }

    return candidates;
  }

  /**
   * Traces the outer perimeter boundary of a binary mask grid using Moore-Neighbor tracing.
   */
  private static traceContour(grid: Uint8Array, w: number, h: number): Point2D[] {
    let startX = -1, startY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (grid[row + x] === 1) {
          startX = x;
          startY = y;
          break;
        }
      }
      if (startX !== -1) break;
    }
    if (startX === -1) return [];

    // Directions: N, NE, E, SE, S, SW, W, NW
    const dx = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

    const points: Point2D[] = [];
    let currX = startX, currY = startY;
    let dir = 7; // backtrack dir
    const maxSteps = w * h;
    let steps = 0;

    do {
      points.push({ x: currX, y: currY });
      let foundNext = false;
      for (let i = 0; i < 8; i++) {
        const d = (dir + 1 + i) % 8;
        const nx = currX + dx[d];
        const ny = currY + dy[d];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny * w + nx] === 1) {
          currX = nx;
          currY = ny;
          dir = (d + 4) % 8;
          foundNext = true;
          break;
        }
      }
      if (!foundNext) break;
      steps++;
    } while ((currX !== startX || currY !== startY) && steps < maxSteps);

    return points;
  }

  /**
   * Ramer-Douglas-Peucker polyline simplification.
   */
  private static simplifyPolyline(pts: Point2D[], tolerance: number = 0.6): Point2D[] {
    if (pts.length <= 4) return pts;

    const sqTol = tolerance * tolerance;
    const len = pts.length;
    let maxSqDist = 0;
    let index = -1;

    const p0 = pts[0];
    const pEnd = pts[len - 1];
    const dx = pEnd.x - p0.x;
    const dy = pEnd.y - p0.y;
    const lineSqLen = dx * dx + dy * dy;

    for (let i = 1; i < len - 1; i++) {
      const p = pts[i];
      let sqDist: number;
      if (lineSqLen === 0) {
        sqDist = (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / lineSqLen));
        const projX = p0.x + t * dx;
        const projY = p0.y + t * dy;
        sqDist = (p.x - projX) ** 2 + (p.y - projY) ** 2;
      }
      if (sqDist > maxSqDist) {
        maxSqDist = sqDist;
        index = i;
      }
    }

    if (maxSqDist > sqTol && index !== -1) {
      const rec1 = this.simplifyPolyline(pts.slice(0, index + 1), tolerance);
      const rec2 = this.simplifyPolyline(pts.slice(index), tolerance);
      return rec1.slice(0, -1).concat(rec2);
    }
    return [p0, pEnd];
  }

  /**
   * Closed-ring polygon simplification.
   * Splits the closed perimeter into two stable arcs before applying RDP,
   * preserving true geometric corners without degenerate zero-length vectors.
   */
  public static simplifyClosedPolygon(pts: Point2D[], tolerance: number): Point2D[] {
    if (pts.length <= 4) return pts;

    // Find point furthest from pts[0] to partition closed ring
    const p0 = pts[0];
    let maxDistSq = 0;
    let splitIdx = Math.floor(pts.length / 2);
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i].x - p0.x) ** 2 + (pts[i].y - p0.y) ** 2;
      if (d > maxDistSq) {
        maxDistSq = d;
        splitIdx = i;
      }
    }

    const arc1 = this.simplifyPolyline(pts.slice(0, splitIdx + 1), tolerance);
    const arc2 = this.simplifyPolyline(pts.slice(splitIdx), tolerance);
    const merged = arc1.slice(0, -1).concat(arc2);

    // Prune adjacent near-duplicate points (< 3px)
    const cleaned: Point2D[] = [];
    for (let i = 0; i < merged.length; i++) {
      const curr = merged[i];
      const next = merged[(i + 1) % merged.length];
      const dist = Math.hypot(curr.x - next.x, curr.y - next.y);
      if (dist >= 3) {
        cleaned.push(curr);
      }
    }
    return cleaned.length >= 3 ? cleaned : pts;
  }

  /**
   * Removes strictly collinear points (< 1.5px deviation) along flat edges
   * to eliminate sub-pixel raster jitter without capping vertex count or altering real shape contours.
  /**
   * Removes strictly collinear points (< 1.2px deviation) along flat edges
   * to eliminate raster staircases without altering real shape contours.
   */
  public static cleanCollinearPoints(pts: Point2D[]): Point2D[] {
    if (pts.length <= 4) return pts;

    let poly = [...pts];
    let changed = true;
    let passes = 0;

    while (changed && poly.length > 4 && passes < 6) {
      changed = false;
      passes++;
      const nextPoly: Point2D[] = [];
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        if (poly.length <= 4) {
          nextPoly.push(...poly.slice(i));
          break;
        }
        const prev = poly[(i - 1 + n) % n];
        const curr = poly[i];
        const next = poly[(i + 1) % n];

        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const lineLen = Math.hypot(dx, dy);
        let distToLine = 0;
        if (lineLen > 0) {
          distToLine = Math.abs(dx * (prev.y - curr.y) - (prev.x - curr.x) * dy) / lineLen;
        }

        if (distToLine < 1.2) {
          changed = true;
        } else {
          nextPoly.push(curr);
        }
      }
      if (nextPoly.length >= 4) {
        poly = nextPoly;
      }
    }

    return poly;
  }

  private computeOverlapMetrics(b1: BoundingBox, b2: BoundingBox): { iou: number; iom: number } {
    const x1 = Math.max(b1.x, b2.x);
    const y1 = Math.max(b1.y, b2.y);
    const x2 = Math.min(b1.x + b1.w, b2.x + b2.w);
    const y2 = Math.min(b1.y + b1.h, b2.y + b2.h);

    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const interArea = interW * interH;
    if (interArea === 0) return { iou: 0, iom: 0 };

    const area1 = b1.w * b1.h;
    const area2 = b2.w * b2.h;
    const unionArea = area1 + area2 - interArea;
    const minArea = Math.min(area1, area2);

    return {
      iou: unionArea > 0 ? interArea / unionArea : 0,
      iom: minArea > 0 ? interArea / minArea : 0
    };
  }

  /**
   * Extracts an aspect-ratio-preserving square patch letterboxed to 224x224.
   * Guarantees strictly isotropic scaling (scaleX === scaleY) so the brick geometry is NEVER distorted or stretched.
   * By default (applyMask === false), extracts the clean, unmasked natural image context.
   * If applyMask === true and a polygon is provided, masks out pixels outside the piece boundary.
   */
  public static extractLetterboxPatch(
    image: CanvasImageSource,
    origW: number,
    origH: number,
    box: { x: number; y: number; w: number; h: number },
    polygon?: Point2D[],
    applyMask: boolean = false
  ): { patchCanvas: HTMLCanvasElement; tensorData: Float32Array } | null {
    const { x, y, w, h } = box;
    const maxDim = Math.max(w, h);
    // 25% isotropic margin around max dimension (minimum 40px) matching benchmark
    const side = Math.max(maxDim * 1.25, 40);
    const cx = x + w / 2;
    const cy = y + h / 2;

    const x1 = Math.max(0, Math.floor(cx - side / 2));
    const y1 = Math.max(0, Math.floor(cy - side / 2));
    const x2 = Math.min(origW, Math.ceil(cx + side / 2));
    const y2 = Math.min(origH, Math.ceil(cy + side / 2));

    const sw = x2 - x1;
    const sh = y2 - y1;
    if (sw <= 0 || sh <= 0) return null;

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = 224;
    patchCanvas.height = 224;
    const pCtx = patchCanvas.getContext('2d', { willReadFrequently: true });
    if (!pCtx) return null;

    // Enable high-quality resampling to prevent aliasing or distortion artifacts
    pCtx.imageSmoothingEnabled = true;
    pCtx.imageSmoothingQuality = 'high';

    // Fill with neutral white background (letterboxing padding)
    pCtx.fillStyle = '#ffffff';
    pCtx.fillRect(0, 0, 224, 224);

    // Isotropic scaling factor: MUST be strictly identical on both X and Y axes
    // scale = 224.0 / side guarantees dw/sw === dh/sh
    const scale = 224.0 / side;

    // Destination placement centered within 224x224
    const dx = (x1 - (cx - side / 2)) * scale;
    const dy = (y1 - (cy - side / 2)) * scale;
    const dw = sw * scale;
    const dh = sh * scale;

    if (applyMask && polygon && polygon.length >= 3) {
      // Mask mode: Clip drawing to the piece polygon contour
      pCtx.save();
      pCtx.beginPath();
      for (let i = 0; i < polygon.length; i++) {
        const ptX = (polygon[i].x - (cx - side / 2)) * scale;
        const ptY = (polygon[i].y - (cy - side / 2)) * scale;
        if (i === 0) pCtx.moveTo(ptX, ptY);
        else pCtx.lineTo(ptX, ptY);
      }
      pCtx.closePath();
      pCtx.clip();
      pCtx.drawImage(image, x1, y1, sw, sh, dx, dy, dw, dh);
      pCtx.restore();
    } else {
      // Default: Clean unmasked natural image context (no polygon cutout)
      pCtx.drawImage(image, x1, y1, sw, sh, dx, dy, dw, dh);
    }

    const pImgData = pCtx.getImageData(0, 0, 224, 224).data;
    const tensorData = new Float32Array(3 * 224 * 224);
    const pSize = 224 * 224;
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < pSize; i++) {
      const idx = i * 4;
      tensorData[i] = (pImgData[idx] / 255.0 - mean[0]) / std[0];
      tensorData[pSize + i] = (pImgData[idx + 1] / 255.0 - mean[1]) / std[1];
      tensorData[pSize * 2 + i] = (pImgData[idx + 2] / 255.0 - mean[2]) / std[2];
    }

    return { patchCanvas, tensorData };
  }
}
