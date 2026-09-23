/**
 * vector_overlay.ts — High-Performance Vector Overlay Engine
 *
 * Replaces hundreds of individual DOM elements with a single 2D vector canvas.
 * Renders mask boundary polylines, dashed boxes, badges, and sibling pulsing
 * in <1ms without DOM reflows.
 */

import { DetectedRegion, Point2D } from './types';
import { ViewportTransform } from './touch_viewport';

export interface PunchedOutFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  stage?: 'yolo' | 'bricknet';
}

export class VectorOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private regions: DetectedRegion[] = [];
  private transform: ViewportTransform = { scale: 1, x: 0, y: 0 };
  private selectedRegion: DetectedRegion | null = null;
  private pulsingPartId: string | null = null;

  private minConfidenceThresh: number = 0;
  private maxConfidenceThresh: number = 100;

  private pulseAnimId: number | null = null;
  private pulseStartTime: number = 0;

  private spotlightRegionIds: Set<number> | null = null;
  private spotlightLabels: Map<number, string> = new Map();
  private spotlightAnimId: number | null = null;

  // Punched-out frame targeting (YOLO area & BrickNet progression)
  private punchedOutFrame: PunchedOutFrame | null = null;
  private imageWidth: number = 0;
  private imageHeight: number = 0;

  // Layer visibility toggles
  private showVectorShapes: boolean = false;
  private showDashedBoxes: boolean = true;

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
    this.render();
  }

  public clear() {
    this.regions = [];
    this.selectedRegion = null;
    this.stopSiblingPulse();
    this.clearSpotlight();
    this.clearPunchedOutFrame();
    this.clearCanvas();
  }

  public setImageDimensions(w: number, h: number) {
    this.imageWidth = w;
    this.imageHeight = h;
  }

  public setPunchedOutFrame(frame: PunchedOutFrame | null) {
    this.punchedOutFrame = frame;
    this.render();
  }

  public clearPunchedOutFrame() {
    this.punchedOutFrame = null;
    this.render();
  }

  public setSpotlight(regions: DetectedRegion[] | null, labelMap?: Map<number, string>) {
    if (!regions || regions.length === 0) {
      this.clearSpotlight();
      return;
    }
    this.spotlightRegionIds = new Set(regions.map(r => r.id));
    this.spotlightLabels = labelMap || new Map();
    this.pulseStartTime = performance.now();

    if (this.spotlightAnimId !== null) {
      cancelAnimationFrame(this.spotlightAnimId);
    }

    const animate = () => {
      this.render();
      if (this.spotlightRegionIds !== null) {
        this.spotlightAnimId = requestAnimationFrame(animate);
      }
    };
    this.spotlightAnimId = requestAnimationFrame(animate);
  }

  public clearSpotlight() {
    if (this.spotlightAnimId !== null) {
      cancelAnimationFrame(this.spotlightAnimId);
      this.spotlightAnimId = null;
    }
    this.spotlightRegionIds = null;
    this.spotlightLabels.clear();
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

  public setSelectedRegion(region: DetectedRegion | null) {
    this.selectedRegion = region;
    this.render();
  }

  public setShowVectorShapes(show: boolean) {
    this.showVectorShapes = show;
    this.render();
  }

  public getShowVectorShapes(): boolean {
    return this.showVectorShapes;
  }

  public setShowDashedBoxes(show: boolean) {
    this.showDashedBoxes = show;
    this.render();
  }

  public getShowDashedBoxes(): boolean {
    return this.showDashedBoxes;
  }

  public startSiblingPulse(partId: string) {
    this.pulsingPartId = partId;
    this.pulseStartTime = performance.now();

    if (this.pulseAnimId !== null) {
      cancelAnimationFrame(this.pulseAnimId);
    }

    const animate = (now: number) => {
      this.render();
      if (this.pulsingPartId) {
        this.pulseAnimId = requestAnimationFrame(animate);
      }
    };
    this.pulseAnimId = requestAnimationFrame(animate);
  }

  public stopSiblingPulse() {
    if (this.pulseAnimId !== null) {
      cancelAnimationFrame(this.pulseAnimId);
      this.pulseAnimId = null;
    }
    this.pulsingPartId = null;
    this.render();
  }

  /**
   * Fast point-in-polygon ray casting and bounding box hit test.
   */
  public hitTest(clientX: number, clientY: number): DetectedRegion | null {
    if (this.regions.length === 0) return null;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    // Map screen coordinates to image coordinates
    const imgX = (screenX - this.transform.x) / this.transform.scale;
    const imgY = (screenY - this.transform.y) / this.transform.scale;

    // Tolerance in image space equivalent to 8 screen pixels
    const edgeTolerance = 8 / this.transform.scale;

    // Pass 1: Prioritize precise polygon interior, edge proximity, or confidence badge pill
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const reg = this.regions[i];
      const confPct = Math.round(reg.confidence * 100);
      if (confPct < this.minConfidenceThresh || confPct > this.maxConfidenceThresh) {
        continue;
      }

      if (reg.polygon && reg.polygon.length >= 3) {
        if (VectorOverlay.pointInPolygon(imgX, imgY, reg.polygon) ||
            VectorOverlay.pointNearPolygonEdge(imgX, imgY, reg.polygon, edgeTolerance) ||
            VectorOverlay.hitTestBadge(imgX, imgY, reg, this.transform.scale)) {
          return reg;
        }
      }
    }

    // Pass 2: Fallback to bounding box or badge for all regions
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const reg = this.regions[i];
      const confPct = Math.round(reg.confidence * 100);
      if (confPct < this.minConfidenceThresh || confPct > this.maxConfidenceThresh) {
        continue;
      }

      const b = reg.box;
      if (imgX >= b.x && imgX <= b.x + b.w &&
          imgY >= b.y && imgY <= b.y + b.h) {
        return reg;
      }
      if (VectorOverlay.hitTestBadge(imgX, imgY, reg, this.transform.scale)) {
        return reg;
      }
    }

    return null;
  }

  private clearCanvas() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Main render loop: draws all vector polylines, boxes, and badges in a single pass.
   */
  public render() {
    this.clearCanvas();
    if (this.regions.length === 0 && !this.punchedOutFrame) return;

    const dpr = window.devicePixelRatio || 1;
    const { scale, x, y } = this.transform;

    const ctx = this.ctx;
    ctx.save();
    // Affine transformation maps image coordinates directly to device screen pixels
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, x * dpr, y * dpr);

    // ------------------------------------------------------------------------
    // Punched-Out Frame Spotlight Overlay (YOLO Tile & BrickNet Progression)
    // ------------------------------------------------------------------------
    if (this.punchedOutFrame) {
      const frame = this.punchedOutFrame;
      const imgW = this.imageWidth > 0 ? this.imageWidth : 2048;
      const imgH = this.imageHeight > 0 ? this.imageHeight : 2048;

      ctx.save();
      // 1. Punched-out shroud using evenodd rule:
      // Outer rectangle covers entire canvas/image, inner rectangle is the cutout window
      ctx.beginPath();
      ctx.rect(-1000, -1000, imgW + 2000, imgH + 2000);
      ctx.rect(frame.x, frame.y, frame.w, frame.h);
      ctx.fillStyle = 'rgba(5, 8, 16, 0.15)';
      ctx.fill('evenodd');

      const isYolo = frame.stage === 'yolo';
      const strokeColor = isYolo ? '#38bdf8' : '#10b981';
      const shadowColor = isYolo ? 'rgba(56, 189, 248, 0.65)' : 'rgba(16, 185, 129, 0.65)';

      // 2. Viewfinder Target Frame
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 8 / scale;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.0 / scale;
      ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);

      // Corner reticle brackets
      const bracketLen = Math.min(22 / scale, Math.min(frame.w, frame.h) * 0.35);
      ctx.lineWidth = 3.5 / scale;
      ctx.strokeStyle = strokeColor;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(frame.x, frame.y + bracketLen);
      ctx.lineTo(frame.x, frame.y);
      ctx.lineTo(frame.x + bracketLen, frame.y);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(frame.x + frame.w - bracketLen, frame.y);
      ctx.lineTo(frame.x + frame.w, frame.y);
      ctx.lineTo(frame.x + frame.w, frame.y + bracketLen);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(frame.x, frame.y + frame.h - bracketLen);
      ctx.lineTo(frame.x, frame.y + frame.h);
      ctx.lineTo(frame.x + bracketLen, frame.y + frame.h);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(frame.x + frame.w - bracketLen, frame.y + frame.h);
      ctx.lineTo(frame.x + frame.w, frame.y + frame.h);
      ctx.lineTo(frame.x + frame.w, frame.y + frame.h - bracketLen);
      ctx.stroke();

      // 3. Floating HUD Badge
      if (frame.label) {
        ctx.shadowBlur = 0;
        const fontSize = Math.max(11, Math.min(18, 13 / scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(frame.label);
        const padHoriz = 6 / scale;
        const padVert = 3 / scale;
        const pillH = fontSize + padVert * 2;
        const pillW = textMetrics.width + padHoriz * 2;
        const pillX = frame.x;
        const pillY = frame.y >= pillH + 4 / scale ? frame.y - pillH - 4 / scale : frame.y + 4 / scale;

        ctx.fillStyle = strokeColor;
        ctx.fillRect(pillX, pillY, pillW, pillH);

        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(frame.label, pillX + padHoriz, pillY + pillH / 2);
      }
      ctx.restore();
    }

    const now = performance.now();
    const isSpotlightActive = this.spotlightRegionIds !== null;
    const isAnyPulsing = this.pulsingPartId !== null || isSpotlightActive;

    // Pulse phase: oscillates between 0.0 and 1.0 (frequency ~1.5 Hz)
    const pulsePhase = isAnyPulsing
      ? (Math.sin((now - this.pulseStartTime) * 0.008) + 1) / 2
      : 0;

    for (const region of this.regions) {
      const confPct = Math.round(region.confidence * 100);
      if (confPct < this.minConfidenceThresh || confPct > this.maxConfidenceThresh) {
        continue;
      }

      const isSpotlighted = isSpotlightActive && this.spotlightRegionIds!.has(region.id);
      const isPulsing = (this.pulsingPartId !== null && region.partId === this.pulsingPartId) || isSpotlighted;
      const isSelected = this.selectedRegion !== null && region.id === this.selectedRegion.id;

      // When spotlighting or sibling pulsing, dim non-matching pieces
      let alpha = 1.0;
      if (isSpotlightActive) {
        alpha = isSpotlighted ? 1.0 : 0.12;
      } else if (this.pulsingPartId !== null) {
        alpha = isPulsing ? 1.0 : 0.22;
      }
      ctx.globalAlpha = alpha;

      const rgb = VectorOverlay.getConfidenceRGB(region.confidence);
      const hexColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

      // 1. Draw Vector Polyline / Mask Silhouette (if toggled on or if piece is highlighted)
      const shouldDrawPolygon = (this.showVectorShapes || isSelected || isSpotlighted || isPulsing) &&
        region.polygon && region.polygon.length >= 3;
      if (shouldDrawPolygon) {
        ctx.beginPath();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.moveTo(region.polygon![0].x, region.polygon![0].y);
        for (let p = 1; p < region.polygon!.length; p++) {
          ctx.lineTo(region.polygon![p].x, region.polygon![p].y);
        }
        ctx.closePath();

        if (isSpotlighted) {
          // Spotlight: vibrant glowing emerald fill & pulsing outline
          const pulseFillAlpha = 0.25 + 0.35 * pulsePhase;
          ctx.fillStyle = `rgba(16, 185, 129, ${pulseFillAlpha})`;
          ctx.fill();

          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = (3.0 + 2.0 * pulsePhase) / scale;
          ctx.stroke();
        } else if (isPulsing) {
          // Vibrant pulsing fill and glowing white stroke
          const pulseFillAlpha = 0.25 + 0.45 * pulsePhase;
          ctx.fillStyle = `rgba(255, 255, 255, ${pulseFillAlpha})`;
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = (2.5 + 2.0 * pulsePhase) / scale;
          ctx.stroke();
        } else if (isSelected) {
          // Selected piece: cyan/electric blue accent
          ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.fill();

          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3.0 / scale;
          ctx.stroke();
        } else {
          // Standard piece: translucent confidence color fill + solid outline
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`;
          ctx.fill();

          ctx.strokeStyle = hexColor;
          ctx.lineWidth = 1.6 / scale;
          ctx.stroke();
        }
      }

      // 2. Draw dashed bounding box around piece (if toggled on or if piece is highlighted)
      const shouldDrawBox = this.showDashedBoxes || isSelected || isSpotlighted || isPulsing;
      if (shouldDrawBox) {
        ctx.save();
        ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.strokeStyle = isSpotlighted ? '#10b981' : (isPulsing ? '#ffffff' : (isSelected ? '#38bdf8' : hexColor));
        ctx.lineWidth = 1.0 / scale;
        ctx.strokeRect(region.box.x, region.box.y, region.box.w, region.box.h);
        ctx.restore();
      }

      // 3. Position Badge above topmost and leftmost vector of box / outline
      let anchorX = region.box.x;
      let anchorY = region.box.y;
      if (region.polygon && region.polygon.length >= 3) {
        let minY = Infinity;
        for (const pt of region.polygon) {
          if (pt.y < minY) minY = pt.y;
        }
        let bestPt = region.polygon[0];
        let bestX = Infinity;
        for (const pt of region.polygon) {
          if (pt.y <= minY + 4) {
            if (pt.x < bestX) {
              bestX = pt.x;
              bestPt = pt;
            }
          }
        }
        anchorX = Math.min(region.box.x, bestPt.x);
        anchorY = Math.min(region.box.y, bestPt.y);
      }

      // 4. Draw Compact Confidence / Spotlight Badge with Eye Icon
      const customLabel = this.spotlightLabels.get(region.id);
      const badgeText = customLabel ? customLabel : `👁 ${confPct}%`;
      const fontSize = Math.max(10, Math.min(14, 11 / scale));
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

      const textMetrics = ctx.measureText(badgeText);
      const textW = textMetrics.width;
      const padX = 5 / scale;
      const badgeW = textW + padX * 2;
      const badgeH = fontSize * 1.35;
      const badgeX = anchorX;
      const badgeY = anchorY - badgeH - 3 / scale;

      // Badge background pill
      ctx.fillStyle = isSpotlighted ? '#10b981' : (isPulsing ? '#ffffff' : (isSelected ? '#38bdf8' : hexColor));
      VectorOverlay.drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 3 / scale);
      ctx.fill();

      // Badge text
      ctx.fillStyle = (isPulsing && !isSpotlighted) ? '#090d16' : '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + padX, badgeY + badgeH / 2);
    }

    ctx.restore();
  }

  /**
   * Ray-casting point in polygon test.
   */
  public static pointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Tests whether a point is within tolerance distance of any edge of the polygon.
   */
  public static pointNearPolygonEdge(px: number, py: number, poly: Point2D[], tolerance: number): boolean {
    const sqTol = tolerance * tolerance;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lineLenSq = dx * dx + dy * dy;
      let sqDist = 0;
      if (lineLenSq === 0) {
        sqDist = (px - p1.x) ** 2 + (py - p1.y) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - p1.x) * dx + (py - p1.y) * dy) / lineLenSq));
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        sqDist = (px - projX) ** 2 + (py - projY) ** 2;
      }
      if (sqDist <= sqTol) return true;
    }
    return false;
  }

  /**
   * Tests whether a point falls within the confidence badge pill above the polygon.
   */
  public static hitTestBadge(imgX: number, imgY: number, reg: DetectedRegion, scale: number): boolean {
    let anchorX = reg.box.x;
    let anchorY = reg.box.y;
    if (reg.polygon && reg.polygon.length >= 3) {
      let minY = Infinity;
      for (const pt of reg.polygon) {
        if (pt.y < minY) minY = pt.y;
      }
      let bestPt = reg.polygon[0];
      let bestX = Infinity;
      for (const pt of reg.polygon) {
        if (pt.y <= minY + 4) {
          if (pt.x < bestX) {
            bestX = pt.x;
            bestPt = pt;
          }
        }
      }
      anchorX = Math.min(reg.box.x, bestPt.x);
      anchorY = Math.min(reg.box.y, bestPt.y);
    }
    const fontSize = Math.max(10, Math.min(14, 11 / scale));
    const badgeH = fontSize * 1.35;
    const badgeW = (fontSize * 4.0) + (12 / scale);
    const badgeX = anchorX;
    const badgeY = anchorY - badgeH - 3 / scale;
    const pad = 5 / scale;

    return (imgX >= badgeX - pad && imgX <= badgeX + badgeW + pad &&
            imgY >= badgeY - pad && imgY <= badgeY + badgeH + pad);
  }

  /**
   * Continuous Red -> Amber -> Green gradient.
   */
  public static getConfidenceRGB(conf: number): { r: number; g: number; b: number } {
    const c = Math.max(0, Math.min(1, conf));
    let r: number, g: number, b: number;
    if (c < 0.45) {
      const t = c / 0.45;
      r = Math.round(239 + (245 - 239) * t);
      g = Math.round(68 + (158 - 68) * t);
      b = Math.round(68 + (11 - 68) * t);
    } else {
      const t = (c - 0.45) / 0.55;
      r = Math.round(245 + (16 - 245) * t);
      g = Math.round(158 + (185 - 158) * t);
      b = Math.round(11 + (129 - 11) * t);
    }
    return { r, g, b };
  }

  private static drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
