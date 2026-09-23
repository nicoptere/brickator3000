/**
 * mask_layer.ts — 50% Alpha Black Backdrop Canvas with Punched Bounding Boxes
 *
 * Renders a semi-transparent 50% alpha black mask canvas above the background image.
 * Uses 2D canvas clipping/destination-out composite operations to punch out clean,
 * transparent windows for bounding boxes so the underlying LEGO bricks shine through.
 *
 * - Normal mode: Punches all detected bounding boxes (dimming empty space/tabletop).
 * - Isolation mode ('find siblings' or spotlight): Only punches the selected matching
 *   boxes, leaving all other non-matching pieces dimmed by the 50% black mask.
 */

import { DetectedRegion } from './types';
import { ViewportTransform } from './touch_viewport';

export class MaskLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private regions: DetectedRegion[] = [];
  private transform: ViewportTransform = { scale: 1, x: 0, y: 0 };
  private active: boolean = false;

  // Isolation mode properties ('find siblings' or spotlight)
  private isolationPartId: string | null = null;
  private isolationRegionIds: Set<number> | null = null;

  // Confidence thresholds (mirrors UI filter slider)
  private minConfidenceThresh: number = 0;
  private maxConfidenceThresh: number = 100;

  // Mask opacity (0.0 to 1.0, default 0.65)
  private opacity: number = 0.65;
  private maskColor: string = 'rgba(0, 0, 0, 0.65)';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;

    window.addEventListener('resize', () => {
      this.resize();
      this.render();
    });

    this.resize();
  }

  public resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  public setRegions(regions: DetectedRegion[]) {
    this.regions = regions;
    this.active = regions.length > 0;
    this.render();
  }

  public setTransform(transform: ViewportTransform) {
    this.transform = transform;
    this.render();
  }

  public setConfidenceFilter(minConf: number, maxConf: number) {
    this.minConfidenceThresh = minConf;
    this.maxConfidenceThresh = maxConf;
    this.render();
  }

  public setOpacity(opacity: number) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.maskColor = `rgba(0, 0, 0, ${this.opacity.toFixed(2)})`;
    this.render();
  }

  public getOpacity(): number {
    return this.opacity;
  }

  /**
   * Enter isolation mode for 'find siblings'.
   * When partId is specified, only bounding boxes matching partId are punched out.
   */
  public setIsolationPartId(partId: string | null) {
    this.isolationPartId = partId;
    this.render();
  }

  /**
   * Enter isolation mode for a custom set of region IDs (e.g. remix build spotlight).
   */
  public setIsolationRegionIds(regionIds: Set<number> | null) {
    this.isolationRegionIds = regionIds;
    this.render();
  }

  public clearIsolation() {
    this.isolationPartId = null;
    this.isolationRegionIds = null;
    this.render();
  }

  public isIsolationActive(): boolean {
    return this.isolationPartId !== null || this.isolationRegionIds !== null;
  }

  public setActive(active: boolean) {
    this.active = active;
    this.render();
  }

  public clear() {
    this.regions = [];
    this.isolationPartId = null;
    this.isolationRegionIds = null;
    this.active = false;
    this.clearCanvas();
  }

  private clearCanvas() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Main render method:
   * 1. Fills entire canvas with 50% alpha black.
   * 2. Sets transform matrix to map image coordinates to screen pixels.
   * 3. Uses destination-out composite mode to punch transparent holes for bounding boxes.
   */
  public render() {
    this.clearCanvas();
    if (!this.active || this.regions.length === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const { scale, x, y } = this.transform;
    const ctx = this.ctx;

    // 1. Fill entire screen with 50% alpha black
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.maskColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. Set viewport transform for image coordinates
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, x * dpr, y * dpr);

    // 3. Punch bounding boxes through the 50% alpha black canvas
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
    ctx.beginPath();

    const isIsolation = this.isIsolationActive();

    for (const reg of this.regions) {
      const confPct = Math.round(reg.confidence * 100);
      if (confPct < this.minConfidenceThresh || confPct > this.maxConfidenceThresh) {
        continue;
      }

      if (isIsolation) {
        const isSelected =
          (this.isolationPartId !== null && reg.partId === this.isolationPartId) ||
          (this.isolationRegionIds !== null && this.isolationRegionIds.has(reg.id));
        if (!isSelected) {
          // In isolation mode, non-selected boxes remain unpunched (covered by 50% black)
          continue;
        }
      }

      const b = reg.box;
      if (b.w <= 0 || b.h <= 0) continue;
      ctx.rect(b.x, b.y, b.w, b.h);
    }

    ctx.fill();
    ctx.restore();
  }
}
