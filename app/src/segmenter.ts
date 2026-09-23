import { BoundingBox, Point2D } from './types';
import { YoloSegmenter, SahiProgressEvent } from './yolo_segmenter';

export interface PatchCandidate {
  box: BoundingBox;
  normBox: BoundingBox;
  polygon?: Point2D[];
  tensorData: Float32Array; // Shape [1, 3, 224, 224] in NCHW
  patchCanvas: HTMLCanvasElement;
}

export type SegmentationMode = 'yolo11' | 'yolo11_sahi' | 'tiles_256';
export type { SahiProgressEvent };

let yoloSegmenterInstance: YoloSegmenter | null = null;
export function getYoloSegmenter(resolution?: number): YoloSegmenter {
  if (!yoloSegmenterInstance) {
    yoloSegmenterInstance = new YoloSegmenter(resolution);
  }
  return yoloSegmenterInstance;
}

export function resetYoloSegmenter(resolution?: number): YoloSegmenter {
  yoloSegmenterInstance = new YoloSegmenter(resolution);
  return yoloSegmenterInstance;
}

export class BrickSegmenter {
  /**
   * Main entry point: segments image entirely in-browser using YOLO11-seg neural network
   * (with automatic SAHI sliced tiling for large images),
   * with automatic fallback to in-browser 256x256 grid tiles if 0 instances detected.
   */
  public static async segmentImage(
    image: HTMLImageElement,
    preferredMode: SegmentationMode = 'yolo11',
    enableSahi: boolean = false,
    onStatus?: (status: string) => void,
    onProgress?: (evt: SahiProgressEvent) => void,
    applyMask = false
  ): Promise<PatchCandidate[]> {
    let candidates: PatchCandidate[] = [];

    if (preferredMode === 'yolo11' || preferredMode === 'yolo11_sahi') {
      try {
        const segmenter = getYoloSegmenter();
        const origW = image.naturalWidth || image.width;
        const origH = image.naturalHeight || image.height;
        // SAHI is only enabled if explicitly toggled on by user
        const useSahi = enableSahi || (preferredMode === 'yolo11_sahi');

        if (useSahi) {
          if (onStatus) onStatus(`Running YOLO11-seg SAHI (${segmenter.targetDim}p Pass 1 Global + Pass 2 Sliced Tiles)...`);
          candidates = await segmenter.segmentSahi(
            image,
            { tileDim: segmenter.targetDim, overlapRatio: 0.25, confThresh: 0.20, seamMargin: 2 },
            onStatus,
            onProgress,
            applyMask
          );
        } else {
          if (onStatus) onStatus(`Running YOLO11-seg (Pass 1: Direct ${segmenter.targetDim}p Global Overview)...`);
          candidates = await segmenter.segment(image, 0.20, 0.40, onStatus, onProgress, applyMask);
        }

        if (candidates.length > 0) {
          console.log(`✓ YOLO11-seg (${useSahi ? 'SAHI Multi-Tile' : `Single ${segmenter.targetDim}p Overview`}) detected ${candidates.length} brick instances in browser.`);
        }
      } catch (err) {
        console.warn('YOLO11-seg in-browser inference failed, falling back to in-browser tiles:', err);
      }
    }

    // In-browser fallback: If YOLO11 produced 0 candidates or mode is tiles_256
    if (candidates.length === 0) {
      if (onStatus) onStatus('Scanning 256x256 in-browser grid tiles...');
      candidates = this.segmentWith256Tiles(image, applyMask);
      console.log(`✓ In-browser grid generated ${candidates.length} candidate tiles.`);
    }

    const sorted = this.sortTopLeftToBottomRight(candidates);
    console.log(`✓ Sorted ${sorted.length} patches from top-left to bottom-right.`);
    return sorted;
  }

  /**
   * Sorts candidates in natural visual reading order: top-left to bottom-right.
   * Uses monotonic row-binning to partition patches into vertical row bands,
   * guaranteeing strict transitivity: rows are ordered top-to-bottom, and
   * elements within the same row are strictly ordered left-to-right.
   */
  public static sortTopLeftToBottomRight(candidates: PatchCandidate[]): PatchCandidate[] {
    if (candidates.length <= 1) return candidates;

    // Determine row band size based on average patch height
    const avgH = candidates.reduce((sum, c) => sum + c.box.h, 0) / candidates.length;
    const binSize = Math.max(30, avgH * 0.55);

    const minY = Math.min(...candidates.map(c => c.box.y));

    return [...candidates].sort((a, b) => {
      const rowA = Math.floor((a.box.y - minY) / binSize);
      const rowB = Math.floor((b.box.y - minY) / binSize);

      if (rowA !== rowB) {
        return rowA - rowB; // Top row before bottom row
      }
      // Same row: left to right
      return a.box.x - b.box.x;
    });
  }

  /**
   * Option B: 256x256 Overlapping Tiles (50% Overlap / 128px Stride)
   */
  public static segmentWith256Tiles(image: HTMLImageElement, applyMask = false, tileSize = 256, overlap = 0.5): PatchCandidate[] {
    const origW = image.naturalWidth || image.width;
    const origH = image.naturalHeight || image.height;

    const canvas = document.createElement('canvas');
    canvas.width = origW;
    canvas.height = origH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(image, 0, 0);

    const stride = Math.round(tileSize * (1.0 - overlap)); // 128px stride for 50% overlap

    // Calculate tile grid steps
    const xSteps: number[] = [];
    for (let x = 0; x <= origW - tileSize; x += stride) {
      xSteps.push(x);
    }
    if (xSteps.length === 0 || xSteps[xSteps.length - 1] !== Math.max(0, origW - tileSize)) {
      xSteps.push(Math.max(0, origW - tileSize));
    }

    const ySteps: number[] = [];
    for (let y = 0; y <= origH - tileSize; y += stride) {
      ySteps.push(y);
    }
    if (ySteps.length === 0 || ySteps[ySteps.length - 1] !== Math.max(0, origH - tileSize)) {
      ySteps.push(Math.max(0, origH - tileSize));
    }

    // Estimate background color from corners
    const cornerData = ctx.getImageData(0, 0, origW, origH).data;
    const bgSamples = [
      [2, 2], [origW - 3, 2], [2, origH - 3], [origW - 3, origH - 3]
    ];
    let bgR = 0, bgG = 0, bgB = 0;
    for (const [cx, cy] of bgSamples) {
      const idx = (cy * origW + cx) * 4;
      bgR += cornerData[idx];
      bgG += cornerData[idx + 1];
      bgB += cornerData[idx + 2];
    }
    bgR /= 4; bgG /= 4; bgB /= 4;

    const candidates: PatchCandidate[] = [];

    for (const ty of ySteps) {
      for (const tx of xSteps) {
        const actualW = Math.min(tileSize, origW - tx);
        const actualH = Math.min(tileSize, origH - ty);

        // Content check: sample 16 points in tile to see if variance/distance from background exists
        const tileImgData = ctx.getImageData(tx, ty, actualW, actualH).data;
        let nonBgCount = 0;
        const totalSampled = 36;
        for (let s = 0; s < totalSampled; s++) {
          const sx = Math.floor((s % 6) * (actualW / 6));
          const sy = Math.floor(Math.floor(s / 6) * (actualH / 6));
          const sIdx = (sy * actualW + sx) * 4;
          const r = tileImgData[sIdx];
          const g = tileImgData[sIdx + 1];
          const b = tileImgData[sIdx + 2];
          const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
          if (dist > 35) nonBgCount++;
        }

        // Only process tiles that contain visible LEGO content (>12% non-background)
        if (nonBgCount / totalSampled < 0.12) {
          continue;
        }

        // Crop & letterbox tile to 224x224 for MobileNetV3 (preserving 1:1 isotropic aspect ratio)
        const patch = YoloSegmenter.extractLetterboxPatch(image, origW, origH, {
          x: tx,
          y: ty,
          w: actualW,
          h: actualH
        }, undefined, applyMask);
        if (!patch) continue;

        candidates.push({
          box: { x: tx, y: ty, w: actualW, h: actualH },
          normBox: {
            x: tx / origW,
            y: ty / origH,
            w: actualW / origW,
            h: actualH / origH
          },
          tensorData: patch.tensorData,
          patchCanvas: patch.patchCanvas
        });
      }
    }

    // Fallback if all tiles were filtered out
    if (candidates.length === 0) {
      const patch = YoloSegmenter.extractLetterboxPatch(image, origW, origH, {
        x: 0,
        y: 0,
        w: origW,
        h: origH
      }, undefined, applyMask);
      if (patch) {
        candidates.push({
          box: { x: 0, y: 0, w: origW, h: origH },
          normBox: { x: 0, y: 0, w: 1, h: 1 },
          tensorData: patch.tensorData,
          patchCanvas: patch.patchCanvas
        });
      }
    }

    return candidates;
  }

  /**
   * Converts 224x224 canvas to ImageNet-normalized NCHW Float32Array
   */
  private static canvasToTensor(ctx: CanvasRenderingContext2D): Float32Array {
    const patchData = ctx.getImageData(0, 0, 224, 224).data;
    const tensorData = new Float32Array(1 * 3 * 224 * 224);

    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < 224 * 224; i++) {
      const r = patchData[i * 4] / 255.0;
      const g = patchData[i * 4 + 1] / 255.0;
      const b = patchData[i * 4 + 2] / 255.0;

      tensorData[0 * 224 * 224 + i] = (r - mean[0]) / std[0];
      tensorData[1 * 224 * 224 + i] = (g - mean[1]) / std[1];
      tensorData[2 * 224 * 224 + i] = (b - mean[2]) / std[2];
    }

    return tensorData;
  }
}
