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
const stageCompositorMethods = {
  redraw(forceComposite = false) {
    const start = perfNow();
    this._updateFadeState(start);
    const collectPerfSamples = this._shouldCollectPerfSamples();
    this._perfTrackingFrame = true;
    this._perfDrawMs = 0;
    this._perfClearMs = 0;
    this._frameDamageStats = {
      regionCount: 0,
      dirtyArea: 0,
      fullArea: 0,
      uploadCalls: 0,
      fullBlitCount: 0,
      tileUpdateCount: 0
    };
    const overlayVisible = this._gameOverlayVisible || (this.guiEnabled && this._guiOverlayVisible);
    if (this.gameOverlayImgProps.display || this.guiOverlayImgProps.display || overlayVisible) {
      this._syncOverlayLayout();
      this._syncOverlayDisplaySize(this.gameImgProps, this.gameOverlayImgProps);
      this._syncOverlayDisplaySize(this.guiImgProps, this.guiOverlayImgProps);
    }
    const gameDisplay = this.gameImgProps.display;
    const guiDisplay = this.guiImgProps.display;
    const gameOverlayDisplay = this.gameOverlayImgProps.display;
    const guiOverlayDisplay = this.guiOverlayImgProps.display;
    const gameSig = gameDisplay ? this._getDrawSignature(this.gameImgProps) : '';
    const guiSig = guiDisplay ? this._getDrawSignature(this.guiImgProps) : '';
    const gameOverlaySig = gameOverlayDisplay ? this._getDrawSignature(this.gameOverlayImgProps) : '';
    const guiOverlaySig = guiOverlayDisplay ? this._getDrawSignature(this.guiOverlayImgProps) : '';
    const gameDirty = !!gameDisplay &&
        (gameDisplay.hasPendingDirty?.() || gameSig !== this._lastGameDrawSignature);
    const guiDirty = !!guiDisplay &&
        (guiDisplay.hasPendingDirty?.() || guiSig !== this._lastGuiDrawSignature);
    const gameOverlayDirty = !!gameOverlayDisplay &&
        (gameOverlayDisplay.hasPendingDirty?.() || gameOverlaySig !== this._lastGameOverlayDrawSignature);
    const guiOverlayDirty = !!guiOverlayDisplay &&
        (guiOverlayDisplay.hasPendingDirty?.() || guiOverlaySig !== this._lastGuiOverlayDrawSignature);
    const overlayDirty = gameOverlayDirty || guiOverlayDirty;
    const overlayVisibilityChanged = this._overlayVisibilityVersion !== this._lastOverlayVisibilityVersion;
    const cursorVisibleChanged = this._lastCursorHasSprite !== !!this.cursorCanvas;
    const cursorStateChanged = this._cursorStateVersion !== this._lastCursorStateVersion || cursorVisibleChanged;
    const cursorMoved = !!this.cursorCanvas &&
        (this._lastCursorX !== this.cursorX || this._lastCursorY !== this.cursorY);
    const requiresFullComposite =
        forceComposite ||
        this.fadeAlpha !== 0 ||
        this.overlayAlpha > 0 ||
        this.perfOverlayEnabled ||
        cursorStateChanged ||
        cursorMoved ||
        overlayVisibilityChanged ||
        overlayDirty ||
        (overlayVisible && (gameDirty || guiDirty));

    if (!requiresFullComposite && !gameDirty && !guiDirty && !overlayDirty) {
      this._lastCursorX = this.cursorX;
      this._lastCursorY = this.cursorY;
      this._lastCursorHasSprite = !!this.cursorCanvas;
      this._lastCursorStateVersion = this._cursorStateVersion;
      this._lastOverlayVisibilityVersion = this._overlayVisibilityVersion;
      this._perfTrackingFrame = false;
      this._perfFrameCount += 1;
      this._perfFrameMs = perfNow() - start;
      if (this._perfFrameMs > this._perfFramePeakMs) {
        this._perfFramePeakMs = this._perfFrameMs;
      }
      if (collectPerfSamples) {
        const allocGame = this._collectDisplayAllocationStats(this.gameImgProps);
        const allocGui = this._collectDisplayAllocationStats(this.guiImgProps);
        const allocGameOverlay = this._collectDisplayAllocationStats(this.gameOverlayImgProps);
        const allocGuiOverlay = this._collectDisplayAllocationStats(this.guiOverlayImgProps);
        const allocations = {
          rectListCreated: allocGame.rectListCreated + allocGui.rectListCreated + allocGameOverlay.rectListCreated + allocGuiOverlay.rectListCreated,
          rectListReused: allocGame.rectListReused + allocGui.rectListReused + allocGameOverlay.rectListReused + allocGuiOverlay.rectListReused,
          tileListCreated: allocGame.tileListCreated + allocGui.tileListCreated + allocGameOverlay.tileListCreated + allocGuiOverlay.tileListCreated,
          tileListReused: allocGame.tileListReused + allocGui.tileListReused + allocGameOverlay.tileListReused + allocGuiOverlay.tileListReused
        };
        this._recordFramePerf(this._perfFrameMs, this._perfDrawMs, this._perfClearMs);
        this._recordDamagePerf({
          regionCount: 0,
          dirtyAreaRatio: 0,
          uploadCalls: 0,
          fullBlitCount: 0,
          tileUpdateCount: 0
        });
        this._recordAllocationPerf(allocations);
      }
      if (this.perfOverlayEnabled) {
        this.drawPerfOverlay();
      }
      this._lastCursorX = this.cursorX;
      this._lastCursorY = this.cursorY;
      this._lastCursorHasSprite = !!this.cursorCanvas;
      this._lastCursorStateVersion = this._cursorStateVersion;
      return;
    }

    if (requiresFullComposite) {
      this.clear();
      if (gameDisplay) {
        const gameImg = gameDisplay.getImageData();
        this.draw(this.gameImgProps, gameImg);
        this._lastGameDrawSignature = gameSig;
      }
      if (guiDisplay) {
        const guiImg = guiDisplay.getImageData();
        this.draw(this.guiImgProps, guiImg);
        this._lastGuiDrawSignature = guiSig;
      }
      if (gameOverlayDisplay && (this._gameOverlayVisible || gameOverlayDirty)) {
        const overlayImg = gameOverlayDisplay.getImageData();
        this.draw(this.gameOverlayImgProps, overlayImg, { applyStageEffects: false });
      }
      if (guiOverlayDisplay && (this._guiOverlayVisible || guiOverlayDirty)) {
        const overlayImg = guiOverlayDisplay.getImageData();
        this.draw(this.guiOverlayImgProps, overlayImg, { applyStageEffects: false });
      }
    } else {
      if (gameDisplay && gameDirty) {
        const gameImg = gameDisplay.getImageData();
        this.clear(this.gameImgProps);
        this.draw(this.gameImgProps, gameImg);
        this._lastGameDrawSignature = gameSig;
      }
      if (guiDisplay && guiDirty) {
        const guiImg = guiDisplay.getImageData();
        this.clear(this.guiImgProps);
        this.draw(this.guiImgProps, guiImg);
        this._lastGuiDrawSignature = guiSig;
      }
    }
    if (this.cursorCanvas) {
      this.drawCursor();
    }
    this._lastGameOverlayDrawSignature = gameOverlaySig;
    this._lastGuiOverlayDrawSignature = guiOverlaySig;
    this._perfTrackingFrame = false;
    this._perfFrameCount += 1;
    this._perfFrameMs = perfNow() - start;
    if (this._perfFrameMs > this._perfFramePeakMs) {
      this._perfFramePeakMs = this._perfFrameMs;
    }
    const fullArea = this._frameDamageStats.fullArea || 0;
    const dirtyAreaRatio = fullArea > 0
      ? Math.min(1, (this._frameDamageStats.dirtyArea || 0) / fullArea)
      : 0;
    if (collectPerfSamples) {
      const allocGame = this._collectDisplayAllocationStats(this.gameImgProps);
      const allocGui = this._collectDisplayAllocationStats(this.guiImgProps);
      const allocGameOverlay = this._collectDisplayAllocationStats(this.gameOverlayImgProps);
      const allocGuiOverlay = this._collectDisplayAllocationStats(this.guiOverlayImgProps);
      const allocations = {
        rectListCreated: allocGame.rectListCreated + allocGui.rectListCreated + allocGameOverlay.rectListCreated + allocGuiOverlay.rectListCreated,
        rectListReused: allocGame.rectListReused + allocGui.rectListReused + allocGameOverlay.rectListReused + allocGuiOverlay.rectListReused,
        tileListCreated: allocGame.tileListCreated + allocGui.tileListCreated + allocGameOverlay.tileListCreated + allocGuiOverlay.tileListCreated,
        tileListReused: allocGame.tileListReused + allocGui.tileListReused + allocGameOverlay.tileListReused + allocGuiOverlay.tileListReused
      };
      this._recordFramePerf(this._perfFrameMs, this._perfDrawMs, this._perfClearMs);
      this._recordDamagePerf({
        regionCount: this._frameDamageStats.regionCount || 0,
        dirtyAreaRatio,
        uploadCalls: this._frameDamageStats.uploadCalls || 0,
        fullBlitCount: this._frameDamageStats.fullBlitCount || 0,
        tileUpdateCount: this._frameDamageStats.tileUpdateCount || 0
      });
      this._recordAllocationPerf(allocations);
    }
    if (this.perfOverlayEnabled) {
      this.drawPerfOverlay();
    }
    this._lastCursorX = this.cursorX;
    this._lastCursorY = this.cursorY;
    this._lastCursorHasSprite = !!this.cursorCanvas;
    this._lastCursorStateVersion = this._cursorStateVersion;
    this._lastOverlayVisibilityVersion = this._overlayVisibilityVersion;
  },

  createImage(displayOwner, width, height) {
    if (displayOwner === this.gameImgProps.display) {
      return this.gameImgProps.createImage(width, height);
    }
    if (displayOwner === this.guiImgProps.display) {
      return this.guiImgProps.createImage(width, height);
    }
    if (displayOwner === this.gameOverlayImgProps.display) {
      return this.gameOverlayImgProps.createImage(width, height);
    }
    if (displayOwner === this.guiOverlayImgProps.display) {
      return this.guiOverlayImgProps.createImage(width, height);
    }
    return this.gameImgProps.createImage(width, height);
  },

  _computeDirtyUnion(dirtyRegions) {
    if (!Array.isArray(dirtyRegions) || dirtyRegions.length < 2) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (let i = 0; i < dirtyRegions.length; i += 1) {
      const rect = dirtyRegions[i];
      if (!rect) continue;
      x1 = Math.min(x1, rect.x);
      y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.width);
      y2 = Math.max(y2, rect.y + rect.height);
    }
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return null;
    }
    if (x2 <= x1 || y2 <= y1) return null;
    return {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1
    };
  },

  _shouldUseFullBlit(dirtyRegions, fullArea, cumulative = null) {
    let dirtyArea = 0;
    for (let i = 0; i < dirtyRegions.length; i += 1) {
      const rect = dirtyRegions[i];
      dirtyArea += rect.width * rect.height;
    }
    const localThreshold = fullArea * DIRTY_RECT_FULL_BLIT_AREA_RATIO;
    let useFull = dirtyRegions.length > DIRTY_RECT_FULL_BLIT_THRESHOLD || dirtyArea >= localThreshold;
    if (!useFull && cumulative) {
      const totalRegions = (cumulative.regionCount || 0) + dirtyRegions.length;
      const totalArea = (cumulative.dirtyArea || 0) + dirtyArea;
      const totalFullArea = (cumulative.fullArea || 0) + fullArea;
      if (
        totalRegions >= DAMAGE_FULL_REDRAW_REGION_THRESHOLD ||
          totalArea >= (totalFullArea * DAMAGE_FULL_REDRAW_AREA_RATIO)
      ) {
        useFull = true;
      }
    }
    return { useFull, dirtyArea };
  },

  _accumulateFrameDamage(stats) {
    if (!this._frameDamageStats || !stats) return;
    this._frameDamageStats.regionCount += stats.regionCount || 0;
    this._frameDamageStats.dirtyArea += stats.dirtyArea || 0;
    this._frameDamageStats.fullArea += stats.fullArea || 0;
    this._frameDamageStats.uploadCalls += stats.uploadCalls || 0;
    this._frameDamageStats.fullBlitCount += stats.fullBlit ? 1 : 0;
    this._frameDamageStats.tileUpdateCount += stats.usedTiles ? 1 : 0;
  },

  _ensureOverlayFallbackSurface(width, height) {
    const w = Math.max(1, Math.trunc(width));
    const h = Math.max(1, Math.trunc(height));
    if (!this._overlayFallbackCanvas) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return null;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!ctx) return null;
      this._overlayFallbackCanvas = canvas;
      this._overlayFallbackCtx = ctx;
    }
    if (
      !this._overlayFallbackImageData ||
        this._overlayFallbackImageData.width !== w ||
        this._overlayFallbackImageData.height !== h
    ) {
      this._overlayFallbackCanvas.width = w;
      this._overlayFallbackCanvas.height = h;
      this._overlayFallbackImageData = this._overlayFallbackCtx.createImageData(w, h);
      this._overlayFallbackBuffer32 = new Uint32Array(this._overlayFallbackImageData.data.buffer);
    }
    return {
      canvas: this._overlayFallbackCanvas,
      ctx: this._overlayFallbackCtx,
      imageData: this._overlayFallbackImageData,
      buffer32: this._overlayFallbackBuffer32
    };
  }
};
export { stageCompositorMethods };