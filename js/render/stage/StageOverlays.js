import {
  COLOR_FN_RE,
  COLOR_RE,
  DAMAGE_FULL_REDRAW_AREA_RATIO,
  DAMAGE_FULL_REDRAW_REGION_THRESHOLD,
  DIRTY_RECT_FULL_BLIT_AREA_RATIO,
  DIRTY_RECT_FULL_BLIT_THRESHOLD,
  DIRTY_UNION_BLIT_RATIO,
  DisplayImage,
  PERF_SAMPLE_WINDOW,
  Position2D,
  StageImageProperties,
  UserInputManager,
  ViewPoint,
  clamp,
  colorStringTo32,
  detectRuntimeCapabilities,
  drawMarchingAntRect,
  getDependency,
  percentile,
  perfNow,
  resolveRenderExperimentState,
  summarizeSamples,
  toAlpha,
  toChannel,
  toFiniteNumber
} from './StageShared.js';
const stageOverlaysMethods = {
  resetFade() {
    this.fadeAlpha = 0;
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.fadeTimer = this.overlayTimer = 0;
    this._fadeOutActive = false;
    this._overlayFadeActive = false;
    this._fadeClockMs = NaN;
    this._fadeDashAccumulator = 0;
  },

  startFadeOut() {
    this.fadeAlpha = 0;
    this.fadeTimer = 1;
    this._fadeOutActive = true;
    this._fadeClockMs = perfNow();
  },

  startOverlayFade(color, rect = null, dashLen = 0) {
    this.overlayColor = color;
    this.overlayRect = rect;
    this.overlayDashLen = dashLen;
    this.overlayDashColor = colorStringTo32(color);
    this.overlayDashOffset = 0;
    this.overlayAlpha = 1;
    this.overlayTimer = 1;
    this._overlayFadeActive = true;
    this._fadeDashAccumulator = 0;
    if (!this._fadeClockMs) this._fadeClockMs = perfNow();
  },

  resetOverlayFade() {
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayDashLen = 0;
    this.overlayTimer = 0;
    this._overlayFadeActive = false;
    this._fadeDashAccumulator = 0;
    if (!this._fadeOutActive) this._fadeClockMs = NaN;
  },

  _updateFadeState(nowMs) {
    if (!this._fadeOutActive && !this._overlayFadeActive) return;
    const now = Number.isFinite(nowMs) ? nowMs : perfNow();
    if (!Number.isFinite(this._fadeClockMs)) {
      this._fadeClockMs = now;
      return;
    }
    const deltaMs = Math.max(0, now - this._fadeClockMs);
    if (deltaMs <= 0) return;
    this._fadeClockMs = now;
  
    const alphaStep = deltaMs * (0.02 / 40);
    if (this._fadeOutActive) {
      this.fadeAlpha = Math.min(this.fadeAlpha + alphaStep, 1);
      if (this.fadeAlpha >= 1) {
        this._fadeOutActive = false;
        this.fadeTimer = 0;
      }
    }
  
    if (this._overlayFadeActive) {
      this.overlayAlpha = Math.max(this.overlayAlpha - alphaStep, 0);
      const dashLen = this.overlayDashLen || 0;
      if (dashLen > 0) {
        this._fadeDashAccumulator += deltaMs * (1 / 40);
        const steps = Math.trunc(this._fadeDashAccumulator);
        if (steps > 0) {
          const pattern = Math.max(1, dashLen * 2);
          this.overlayDashOffset = (this.overlayDashOffset + steps) % pattern;
          this._fadeDashAccumulator -= steps;
        }
      }
      if (this.overlayAlpha <= 0) {
        this.overlayAlpha = 0;
        this.overlayRect = null;
        this.overlayDashLen = 0;
        this.overlayTimer = 0;
        this._overlayFadeActive = false;
        this._fadeDashAccumulator = 0;
      }
    }
  
    if (!this._fadeOutActive && !this._overlayFadeActive) {
      this._fadeClockMs = NaN;
    }
  },

  dispose() {
    this.resetFade();
    if (this._resizeRaf) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this._resizeRaf);
      }
      this._resizeRaf = 0;
    }
    if (this.gameImgProps.display?.dispose) this.gameImgProps.display.dispose();
    if (this.guiImgProps.display?.dispose)  this.guiImgProps.display.dispose();
    if (this.gameOverlayImgProps.display?.dispose) this.gameOverlayImgProps.display.dispose();
    if (this.guiOverlayImgProps.display?.dispose)  this.guiOverlayImgProps.display.dispose();
    if (this.controller?.dispose)            this.controller.dispose();
    this.controller = null;
    this.gameImgProps = null;
    this.guiImgProps  = null;
    this.gameOverlayImgProps = null;
    this.guiOverlayImgProps = null;
    this.stageCtx = null;
    this.stageCav     = null;
    this._overlayFallbackCanvas = null;
    this._overlayFallbackCtx = null;
    this._overlayFallbackImageData = null;
    this._overlayFallbackBuffer32 = null;
    this._overlayFallbackDisplay = null;
  },

  draw(display, img, options = {}) {
    const applyStageEffects = options.applyStageEffects !== false;
    const start = this._perfTrackingFrame ? perfNow() : 0;
    if (!display.ctx) return;
    if (!img || !Number.isFinite(img.width) || !Number.isFinite(img.height) || img.width < 1 || img.height < 1) {
      return;
    }
  
    const displayImage = display.display;
    const dirtyTiles = displayImage?.consumeDirtyTiles?.();
    const dirtyRects = displayImage?.consumeDirtyRects?.();
    const hasTileSupport = dirtyTiles !== undefined;
    const hasRectUpdates = dirtyRects === null || (Array.isArray(dirtyRects) && dirtyRects.length > 0);
    const useTileUpdates = hasTileSupport && (
      dirtyTiles === null ||
        (Array.isArray(dirtyTiles) && dirtyTiles.length > 0) ||
        !hasRectUpdates
    );
    const dirtyRegions = useTileUpdates ? dirtyTiles : dirtyRects;
    const damageStats = {
      regionCount: 0,
      dirtyArea: 0,
      fullArea: img.width * img.height,
      uploadCalls: 0,
      fullBlit: false,
      usedTiles: useTileUpdates
    };
    try {
      if (dirtyRegions === null) {
        display.ctx.putImageData(img, 0, 0);
        damageStats.regionCount = 1;
        damageStats.dirtyArea = damageStats.fullArea;
        damageStats.uploadCalls = 1;
        damageStats.fullBlit = true;
      } else if (dirtyRegions.length) {
        damageStats.regionCount = dirtyRegions.length;
        const decision = this._shouldUseFullBlit(
          dirtyRegions,
          damageStats.fullArea,
          this._frameDamageStats
        );
        let useFullBlit = decision.useFull;
        damageStats.dirtyArea = decision.dirtyArea;
        if (useFullBlit) {
          display.ctx.putImageData(img, 0, 0);
          damageStats.uploadCalls = 1;
          damageStats.fullBlit = true;
          damageStats.dirtyArea = damageStats.fullArea;
        } else {
          const union = this._renderExperiments.offscreenPresentActive
            ? this._computeDirtyUnion(dirtyRegions)
            : null;
          const unionArea = union ? (union.width * union.height) : 0;
          const useUnion = !!union && unionArea <= (damageStats.dirtyArea * DIRTY_UNION_BLIT_RATIO);
          if (useUnion) {
            try {
              display.ctx.putImageData(
                img,
                0,
                0,
                union.x,
                union.y,
                union.width,
                union.height
              );
              damageStats.uploadCalls = 1;
              damageStats.regionCount = 1;
              damageStats.dirtyArea = unionArea;
            } catch {
              this._renderExperiments.offscreenPresentActive = false;
              this._renderExperiments.rollbackReason = 'offscreen_present_runtime_error';
              for (let i = 0; i < dirtyRegions.length; i += 1) {
                const rect = dirtyRegions[i];
                display.ctx.putImageData(
                  img,
                  0,
                  0,
                  rect.x,
                  rect.y,
                  rect.width,
                  rect.height
                );
              }
              damageStats.uploadCalls = dirtyRegions.length;
            }
          } else {
            for (let i = 0; i < dirtyRegions.length; i += 1) {
              const rect = dirtyRegions[i];
              display.ctx.putImageData(
                img,
                0,
                0,
                rect.x,
                rect.y,
                rect.width,
                rect.height
              );
            }
            damageStats.uploadCalls = dirtyRegions.length;
          }
        }
      }
    } finally {
      if (useTileUpdates) {
        displayImage?.releaseConsumedDirtyTiles?.(dirtyTiles);
      }
      displayImage?.releaseConsumedDirtyRects?.(dirtyRects);
      this._accumulateFrameDamage(damageStats);
    }
  
    const ctx = this.stageCtx;
    this._setGlobalAlpha(1);
  
    let sx = display.viewPoint.x;
    let sy = display.viewPoint.y;
    let sw = img.width - sx;
    let sh = img.height - sy;
    if (sx < 0) {
      sw += sx;
      sx = 0;
    }
    if (sy < 0) {
      sh += sy;
      sy = 0;
    }
    sw = Math.min(sw, img.width - sx);
    sh = Math.min(sh, img.height - sy);
  
    const dx = display.x + Math.max(-display.viewPoint.x, 0) * display.viewPoint.scale;
    const dy = display.y + Math.max(-display.viewPoint.y, 0) * display.viewPoint.scale;
    let dw = sw * display.viewPoint.scale;
    let dh = sh * display.viewPoint.scale;
  
    if (dw > display.width) {
      sw = display.width / display.viewPoint.scale;
      dw = display.width;
    }
    if (dh > display.height) {
      sh = display.height / display.viewPoint.scale;
      dh = display.height;
    }
  
    ctx.drawImage(
      display.cav,
      sx,
      sy,
      sw,
      sh,
      dx,
      dy,
      Math.trunc(dw),
      Math.trunc(dh)
    );
  
    if (applyStageEffects && this.fadeAlpha !== 0) {
      this._setGlobalAlpha(this.fadeAlpha);
      this._setFillStyle('black');
      ctx.fillRect(display.x, display.y, Math.trunc(dw), Math.trunc(dh));
      this._setGlobalAlpha(1);
    }
  
    if (applyStageEffects && this.overlayAlpha > 0) {
      this._setGlobalAlpha(this.overlayAlpha);
      this._setFillStyle(this.overlayColor);
      const r = this.overlayRect || {
        x: display.x,
        y: display.y,
        width: Math.trunc(dw),
        height: Math.trunc(dh),
      };
      ctx.fillRect(r.x, r.y, r.width, r.height);
      this._setGlobalAlpha(1);
      if (this.overlayDashLen > 0) {
        const octx = this.stageCtx;
        if (typeof octx.setLineDash === 'function' && typeof octx.strokeRect === 'function') {
          this._setGlobalAlpha(this.overlayAlpha);
          this._setStrokeStyle(this.overlayColor);
          octx.lineWidth = 1;
          octx.setLineDash([this.overlayDashLen, this.overlayDashLen]);
          octx.lineDashOffset = -this.overlayDashOffset;
          octx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.width - 1), Math.max(0, r.height - 1));
          octx.setLineDash([]);
          octx.lineDashOffset = 0;
          this._setGlobalAlpha(1);
        } else {
          const fallbackSurface = this._ensureOverlayFallbackSurface(r.width + 1, r.height + 1);
          const drawAnts = getDependency('drawMarchingAntRect', drawMarchingAntRect);
          if (fallbackSurface) {
            fallbackSurface.buffer32.fill(0);
            this._overlayFallbackDisplay.buffer32 = fallbackSurface.buffer32;
            this._overlayFallbackDisplay.imgData = fallbackSurface.imageData;
            drawAnts(
              this._overlayFallbackDisplay,
              0,
              0,
              r.width,
              r.height,
              this.overlayDashLen,
              this.overlayDashOffset,
              this.overlayDashColor,
              0x00000000
            );
            fallbackSurface.ctx.putImageData(fallbackSurface.imageData, 0, 0);
            this._setGlobalAlpha(this.overlayAlpha);
            octx.drawImage(fallbackSurface.canvas, r.x, r.y);
            this._setGlobalAlpha(1);
          } else {
            const img = octx.getImageData(r.x, r.y, r.width + 1, r.height + 1);
            const disp = { buffer32: new Uint32Array(img.data.buffer), imgData: img };
            drawAnts(
              disp,
              0,
              0,
              r.width,
              r.height,
              this.overlayDashLen,
              this.overlayDashOffset,
              this.overlayDashColor,
              0x00000000
            );
            octx.putImageData(img, r.x, r.y);
          }
        }
      }
    }
    if (this._perfTrackingFrame) {
      this._perfDrawMs += perfNow() - start;
    }
  },

  drawCursor() {
    if (!this.cursorCanvas) return;
    const ctx = this.stageCtx;
    const cx = Math.trunc(this.cursorX - this.cursorCanvas.width / 2);
    const cy = Math.trunc(this.cursorY - this.cursorCanvas.height / 2);
    ctx.drawImage(this.cursorCanvas, cx, cy);
  },

  clampViewPoint(stageImage) {
    if (!stageImage || !stageImage.display) return;
    const { width: worldW, height: worldH } = stageImage.display.worldDataSize;
    const scale = stageImage.viewPoint.scale;
    const { width: vpW, height: vpH } = stageImage.canvasViewportSize;
    const viewW = vpW / scale;
    const viewH = vpH / scale;
  
    const maxY = Math.max(worldH - viewH, 0);
    stageImage.viewPoint.y = this.limitValue(
      0,
      stageImage.viewPoint.y,
      maxY
    );
  
    if (worldW <= viewW) {
      stageImage.viewPoint.x = (worldW - viewW) / 2;
    } else {
      stageImage.viewPoint.x = this.limitValue(
        0,
        stageImage.viewPoint.x,
        worldW - viewW
      );
    }
  },

  getGameViewRect() {
    return {
      x: this.gameImgProps.viewPoint.x,
      y: this.gameImgProps.viewPoint.y,
      w: this.gameImgProps.canvasViewportSize.width  / this.gameImgProps.viewPoint.scale,
      h: this.gameImgProps.canvasViewportSize.height / this.gameImgProps.viewPoint.scale
  
    };
  },

  limitValue(minLimit, value, maxLimit) {
    return Math.min(Math.max(minLimit, value), maxLimit);
  },

  _getDrawSignature(display) {
    const vp = display.viewPoint;
    return [
      display.x,
      display.y,
      display.width,
      display.height,
      vp?.x ?? 0,
      vp?.y ?? 0,
      vp?.scale ?? 1
    ].join('|');
  },

  _syncOverlayLayout() {
    this.gameOverlayImgProps.x = this.gameImgProps.x;
    this.gameOverlayImgProps.y = this.gameImgProps.y;
    this.gameOverlayImgProps.canvasViewportSize = {
      width: this.gameImgProps.width,
      height: this.gameImgProps.height
    };
    this.gameOverlayImgProps.viewPoint = this.gameImgProps.viewPoint;
    this.guiOverlayImgProps.x = this.guiImgProps.x;
    this.guiOverlayImgProps.y = this.guiImgProps.y;
    this.guiOverlayImgProps.canvasViewportSize = {
      width: this.guiImgProps.width,
      height: this.guiImgProps.height
    };
    this.guiOverlayImgProps.viewPoint = this.guiImgProps.viewPoint;
  },

  _syncOverlayDisplaySize(baseProps, overlayProps) {
    const baseDisplay = baseProps?.display;
    const overlayDisplay = overlayProps?.display;
    if (!baseDisplay || !overlayDisplay) return;
    const { width, height } = baseDisplay.worldDataSize;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return;
    }
    const needsResize = overlayDisplay.getWidth() !== width || overlayDisplay.getHeight() !== height;
    if (!needsResize) return;
    overlayDisplay.initSize(width, height);
    overlayDisplay.clear(0x00000000);
  },

  _setGlobalAlpha(value) {
    if (this._ctxAlpha === value) return;
    this.stageCtx.globalAlpha = value;
    this._ctxAlpha = value;
  },

  _setFillStyle(value) {
    if (this._ctxFillStyle === value) return;
    this.stageCtx.fillStyle = value;
    this._ctxFillStyle = value;
  },

  _setStrokeStyle(value) {
    if (this._ctxStrokeStyle === value) return;
    this.stageCtx.strokeStyle = value;
    this._ctxStrokeStyle = value;
  }
};
export { stageOverlaysMethods };