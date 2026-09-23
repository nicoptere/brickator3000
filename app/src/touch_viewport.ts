/**
 * touch_viewport.ts — High-performance mobile touch gestures
 * Supports pinch-to-zoom, pan-to-drag, mouse wheel, and double-tap detection.
 */

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export class TouchViewport {
  private container: HTMLElement;
  private target: HTMLElement;
  private pointers: Map<number, { x: number; y: number }> = new Map();
  
  private initialPinchDist: number = 0;
  private initialPinchScale: number = 1;
  private pinchCenter: { x: number; y: number } = { x: 0, y: 0 };
  private lastPanPoint: { x: number; y: number } = { x: 0, y: 0 };

  private scale: number = 1;
  private minScale: number = 0.5;
  private maxScale: number = 6.0;
  private panX: number = 0;
  private panY: number = 0;

  private imageWidth: number = 0;
  private imageHeight: number = 0;

  // Double tap detection
  private lastTapTime: number = 0;
  private lastTapPos: { x: number; y: number } = { x: 0, y: 0 };

  public onTransformChange?: (transform: ViewportTransform) => void;
  public onDoubleTap?: (e: PointerEvent) => void;
  public onSingleTap?: (e: PointerEvent) => void;

  constructor(container: HTMLElement, target: HTMLElement) {
    this.container = container;
    this.target = target;
    this.initEventListeners();
  }

  private initEventListeners() {
    this.container.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.container.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.container.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.container.addEventListener('pointercancel', this.handlePointerUp.bind(this));
    this.container.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    window.addEventListener('resize', () => {
      this.handleContainerResize();
    });
  }

  public setImageDimensions(width: number, height: number) {
    this.imageWidth = width;
    this.imageHeight = height;
    this.fitToScreen();
  }

  public fitToScreen(animate: boolean = false) {
    const cWidth = this.container.clientWidth;
    const cHeight = this.container.clientHeight;

    if (this.imageWidth <= 0 || this.imageHeight <= 0 || cWidth <= 0 || cHeight <= 0) return;

    // Calculate scale so entire image fits zoomed out
    const scaleX = cWidth / this.imageWidth;
    const scaleY = cHeight / this.imageHeight;
    const targetScale = Math.min(scaleX, scaleY) * 0.95; // 5% border margin

    this.minScale = targetScale * 0.6;
    this.maxScale = Math.max(targetScale * 8.0, 4.0);

    const targetPanX = (cWidth - this.imageWidth * targetScale) / 2;
    const targetPanY = (cHeight - this.imageHeight * targetScale) / 2;

    if (!animate) {
      this.scale = targetScale;
      this.panX = targetPanX;
      this.panY = targetPanY;
      this.applyTransform();
      return;
    }

    const startX = this.panX;
    const startY = this.panY;
    const startScale = this.scale;
    const startTime = performance.now();
    const duration = 280;

    const anim = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);

      this.scale = startScale + (targetScale - startScale) * ease;
      this.panX = startX + (targetPanX - startX) * ease;
      this.panY = startY + (targetPanY - startY) * ease;

      this.clampBounds();
      this.applyTransform();

      if (progress < 1) {
        requestAnimationFrame(anim);
      }
    };
    requestAnimationFrame(anim);
  }

  public handleContainerResize() {
    if (this.imageWidth > 0 && this.imageHeight > 0) {
      this.clampBounds();
      this.applyTransform();
    }
  }

  private handlePointerDown(e: PointerEvent) {
    const targetEl = e.target as HTMLElement;
    if (targetEl && (
      targetEl.tagName === 'BUTTON' ||
      targetEl.closest('button') ||
      targetEl.closest('#emptyPrompt') ||
      targetEl.closest('.action-bar') ||
      targetEl.closest('.bottom-action-panel') ||
      targetEl.closest('.webgl-piece-inspector') ||
      targetEl.closest('.ant-drawer')
    )) {
      return;
    }

    try {
      this.container.setPointerCapture(e.pointerId);
    } catch (_) {}
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const now = Date.now();
    const dt = now - this.lastTapTime;
    const dx = Math.abs(e.clientX - this.lastTapPos.x);
    const dy = Math.abs(e.clientY - this.lastTapPos.y);

    if (this.pointers.size === 1) {
      if (dt < 320 && dx < 30 && dy < 30) {
        // Double tap
        if (this.onDoubleTap) this.onDoubleTap(e);
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        this.lastTapPos = { x: e.clientX, y: e.clientY };
        this.lastPanPoint = { x: e.clientX, y: e.clientY };
      }
    } else if (this.pointers.size === 2) {
      // Start pinch
      const pts = Array.from(this.pointers.values());
      this.initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.initialPinchScale = this.scale;
      this.pinchCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2
      };
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      // 1-finger pan / drag
      const dx = e.clientX - this.lastPanPoint.x;
      const dy = e.clientY - this.lastPanPoint.y;
      this.panX += dx;
      this.panY += dy;
      this.lastPanPoint = { x: e.clientX, y: e.clientY };

      this.clampBounds();
      this.applyTransform();
    } else if (this.pointers.size === 2) {
      // Pinch to zoom
      const pts = Array.from(this.pointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.initialPinchDist > 10) {
        const factor = currentDist / this.initialPinchDist;
        const newScale = Math.min(Math.max(this.initialPinchScale * factor, this.minScale), this.maxScale);

        const rect = this.container.getBoundingClientRect();
        // Zoom relative to pinch center in container coordinates
        const currentCenter = {
          x: (pts[0].x + pts[1].x) / 2 - rect.left,
          y: (pts[0].y + pts[1].y) / 2 - rect.top
        };

        const scaleRatio = newScale / this.scale;
        this.panX = currentCenter.x - (currentCenter.x - this.panX) * scaleRatio;
        this.panY = currentCenter.y - (currentCenter.y - this.panY) * scaleRatio;
        this.scale = newScale;

        this.clampBounds();
        this.applyTransform();
      }
    }
  }

  private handlePointerUp(e: PointerEvent) {
    const wasTracking = this.pointers.has(e.pointerId);
    if (wasTracking) {
      this.pointers.delete(e.pointerId);
      try {
        this.container.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    if (this.pointers.size === 1) {
      // Remaining pointer resumes pan
      const pt = this.pointers.values().next().value;
      if (pt) {
        this.lastPanPoint = { x: pt.x, y: pt.y };
      }
    } else if (this.pointers.size === 0 && wasTracking) {
      // Single tap / click detection: short duration and minimal displacement
      const upNow = Date.now();
      const upDt = upNow - this.lastTapTime;
      const upDist = Math.hypot(e.clientX - this.lastTapPos.x, e.clientY - this.lastTapPos.y);
      if (upDt < 450 && upDist < 16) {
        if (this.onSingleTap) {
          this.onSingleTap(e);
        }
      }
    }
  }

  private handleWheel(e: WheelEvent) {
    e.preventDefault();

    // Exponential factor for smooth wheel and trackpad response
    const delta = -e.deltaY;
    const factor = Math.min(Math.max(Math.exp(delta * 0.0018), 0.7), 1.4);
    const newScale = Math.min(Math.max(this.scale * factor, this.minScale), this.maxScale);

    if (Math.abs(newScale - this.scale) < 1e-6) return;

    // Mouse coordinates strictly relative to the container element
    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleRatio = newScale / this.scale;
    this.panX = mouseX - (mouseX - this.panX) * scaleRatio;
    this.panY = mouseY - (mouseY - this.panY) * scaleRatio;
    this.scale = newScale;

    this.clampBounds();
    this.applyTransform();
  }

  private clampBounds() {
    const cWidth = this.container.clientWidth;
    const cHeight = this.container.clientHeight;
    const renderedW = this.imageWidth * this.scale;
    const renderedH = this.imageHeight * this.scale;

    // Allow panning with generous margin
    const margin = 380;

    // Horizontal bounds
    if (renderedW >= cWidth) {
      const minX = cWidth - renderedW - margin;
      const maxX = margin;
      this.panX = Math.min(Math.max(this.panX, minX), maxX);
    } else {
      // Image narrower than container: allow free zooming to mouse position without
      // forcing to center, while keeping image within view
      const minX = -margin;
      const maxX = (cWidth - renderedW) + margin;
      this.panX = Math.min(Math.max(this.panX, minX), maxX);
    }

    // Vertical bounds
    if (renderedH >= cHeight) {
      const minY = cHeight - renderedH - margin;
      const maxY = margin;
      this.panY = Math.min(Math.max(this.panY, minY), maxY);
    } else {
      // Image shorter than container: allow free zooming to mouse position without
      // forcing to center, while keeping image within view
      const minY = -margin;
      const maxY = (cHeight - renderedH) + margin;
      this.panY = Math.min(Math.max(this.panY, minY), maxY);
    }

    // If fully zoomed out below initial fit scale, keep centered
    if (this.scale <= this.minScale * 1.05) {
      if (renderedW < cWidth) this.panX = (cWidth - renderedW) / 2;
      if (renderedH < cHeight) this.panY = (cHeight - renderedH) / 2;
    }
  }

  private applyTransform() {
    this.target.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0px) scale(${this.scale})`;
    this.target.style.transformOrigin = '0 0';

    if (this.onTransformChange) {
      this.onTransformChange({
        scale: this.scale,
        x: this.panX,
        y: this.panY
      });
    }
  }

  public getTransform(): ViewportTransform {
    return {
      scale: this.scale,
      x: this.panX,
      y: this.panY
    };
  }

  public imageToScreen(imgX: number, imgY: number): { x: number; y: number } {
    return {
      x: this.panX + imgX * this.scale,
      y: this.panY + imgY * this.scale
    };
  }

  public screenToImage(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  private animateTo(targetScale: number, targetPanX: number, targetPanY: number, duration = 320) {
    const startX = this.panX;
    const startY = this.panY;
    const startScale = this.scale;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);

      this.scale = startScale + (targetScale - startScale) * ease;
      this.panX = startX + (targetPanX - startX) * ease;
      this.panY = startY + (targetPanY - startY) * ease;

      this.clampBounds();
      this.applyTransform();

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  public zoomToSinglePiece(box: { x: number; y: number; w: number; h: number }, leftDrawerOffset = 0) {
    const cWidth = this.container.clientWidth;
    const cHeight = this.container.clientHeight;
    if (cWidth <= 0 || cHeight <= 0 || this.imageWidth <= 0) return;

    const availWidth = Math.max(cWidth - leftDrawerOffset, 200);
    const visibleCenterX = leftDrawerOffset + availWidth / 2;
    const visibleCenterY = cHeight / 2;

    const boxMaxDim = Math.max(box.w, box.h, 30);
    const targetScale = Math.min(this.maxScale, Math.max(this.minScale * 1.6, (availWidth / boxMaxDim) * 0.30));

    const boxCenterX = box.x + box.w / 2;
    const boxCenterY = box.y + box.h / 2;

    const targetPanX = visibleCenterX - boxCenterX * targetScale;
    const targetPanY = visibleCenterY - boxCenterY * targetScale;

    this.animateTo(targetScale, targetPanX, targetPanY, 320);
  }

  public zoomToMultipleInstances(boxes: Array<{ x: number; y: number; w: number; h: number }>, leftDrawerOffset = 0) {
    if (!boxes || boxes.length === 0) return;
    if (boxes.length === 1) {
      this.zoomToSinglePiece(boxes[0], leftDrawerOffset);
      return;
    }

    const cWidth = this.container.clientWidth;
    const cHeight = this.container.clientHeight;
    if (cWidth <= 0 || cHeight <= 0 || this.imageWidth <= 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }

    const spanW = Math.max(maxX - minX, 40);
    const spanH = Math.max(maxY - minY, 40);

    const padX = Math.max(spanW * 0.16, 40);
    const padY = Math.max(spanH * 0.16, 40);

    const groupW = spanW + padX * 2;
    const groupH = spanH + padY * 2;
    const groupCenterX = minX - padX + groupW / 2;
    const groupCenterY = minY - padY + groupH / 2;

    const availWidth = Math.max(cWidth - leftDrawerOffset, 200);
    const visibleCenterX = leftDrawerOffset + availWidth / 2;
    const visibleCenterY = cHeight / 2;

    const scaleX = availWidth / groupW;
    const scaleY = cHeight / groupH;
    let targetScale = Math.min(scaleX, scaleY) * 0.90;

    targetScale = Math.min(this.maxScale, Math.max(this.minScale, targetScale));

    const targetPanX = visibleCenterX - groupCenterX * targetScale;
    const targetPanY = visibleCenterY - groupCenterY * targetScale;

    this.animateTo(targetScale, targetPanX, targetPanY, 350);
  }

  public centerOnBox(box: { x: number; y: number; w: number; h: number }, targetScaleMultiplier = 1.0) {
    this.zoomToSinglePiece(box, 0);
  }
}
