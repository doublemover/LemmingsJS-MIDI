// @ts-check
import { DisplayImage, drawMarchingAntRect } from './DisplayImage.js';
import { Position2D } from '../util/Position2D.js';
import { StageImageProperties } from './StageImageProperties.js';
import { UserInputManager } from '../input/UserInputManager.js';
import { ViewPoint } from './ViewPoint.js';
import { getDependency } from '../core/dependencies.js';
import { toFiniteNumber } from '../core/numberParsing.js';
import {
  detectRuntimeCapabilities,
  resolveRenderExperimentState
} from '../core/capabilityMatrix.js';

const COLOR_FN_RE = /^rgba?\(/i;
const COLOR_RE = /^rgba?\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*(?:,\s*([-+]?\d*\.?\d+)\s*)?\)$/i;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toChannel(value) {
  if (!Number.isFinite(value)) return 255;
  return clamp(Math.round(value), 0, 255);
}

function toAlpha(value) {
  if (!Number.isFinite(value)) return 1;
  return clamp(value, 0, 1);
}

function colorStringTo32(str) {
  if (typeof str !== 'string') return 0xffffffff;
  if (!COLOR_FN_RE.test(str)) return 0xffffffff;
  const m = COLOR_RE.exec(str.trim());
  if (!m) return 0xffffffff;
  const r = toChannel(toFiniteNumber(m[1], NaN));
  const g = toChannel(toFiniteNumber(m[2], NaN));
  const b = toChannel(toFiniteNumber(m[3], NaN));
  const a = toAlpha(toFiniteNumber(m[4], 1));
  return ((Math.round(a * 255) & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

const perfNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const DIRTY_RECT_FULL_BLIT_THRESHOLD = 24;
const DIRTY_RECT_FULL_BLIT_AREA_RATIO = 0.4;
const DAMAGE_FULL_REDRAW_REGION_THRESHOLD = 48;
const DAMAGE_FULL_REDRAW_AREA_RATIO = 0.55;
const DIRTY_UNION_BLIT_RATIO = 1.25;
const PERF_SAMPLE_WINDOW = 240;

const percentile = (samples, p) => {
  if (!Array.isArray(samples) || samples.length < 1) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * clamped)));
  return sorted[index] || 0;
};

const summarizeSamples = (samples) => {
  const clean = Array.isArray(samples)
    ? samples.filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (!clean.length) {
    return { p50: 0, p95: 0, p99: 0, worst: 0 };
  }
  return {
    p50: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    p99: percentile(clean, 0.99),
    worst: percentile(clean, 1)
  };
};

class Stage {
  constructor(canvasForOutput) {
    this.controller = null;
    this.fadeTimer = 0;
    this.fadeAlpha = 0;
    this.overlayColor = 'black';
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayTimer = 0;
    this.overlayDashLen = 0;
    this.overlayDashColor = 0;
    this.overlayDashOffset = 0;
    this._fadeClockMs = NaN;
    this._fadeDashAccumulator = 0;
    this._fadeOutActive = false;
    this._overlayFadeActive = false;
    this.perfOverlayEnabled = false;
    this.perfOverlayProvider = null;
    this._perfTrackingFrame = false;
    this._perfFrameMs = 0;
    this._perfDrawMs = 0;
    this._perfClearMs = 0;
    this._perfFramePeakMs = 0;
    this._perfFrameCount = 0;
    this._perfFrameSamples = [];
    this._perfDrawSamples = [];
    this._perfClearSamples = [];
    this._perfDirtyRegionsSamples = [];
    this._perfDirtyAreaRatioSamples = [];
    this._perfUploadCallsSamples = [];
    this._perfAllocationsSamples = [];
    this._perfLastDamage = {
      regionCount: 0,
      dirtyAreaRatio: 0,
      uploadCalls: 0,
      fullBlitCount: 0,
      tileUpdateCount: 0
    };
    this._perfLastAllocations = {
      rectListCreated: 0,
      rectListReused: 0,
      tileListCreated: 0,
      tileListReused: 0
    };
    this._frameDamageStats = null;
    this._renderExperiments = {
      offscreenPresentRequested: false,
      offscreenPresentActive: false,
      workerOffscreenRequested: false,
      workerOffscreenActive: false,
      rollbackReason: null
    };
    this._lastGameDrawSignature = '';
    this._lastGuiDrawSignature = '';
    this._lastGameOverlayDrawSignature = '';
    this._lastGuiOverlayDrawSignature = '';
    this._gameOverlayVisible = false;
    this._guiOverlayVisible = false;
    this._overlayVisibilityVersion = 0;
    this._lastOverlayVisibilityVersion = 0;
    this.panEnabled = true;
    this._resizeRaf = 0;
    this._lastStageWidth = NaN;
    this._lastStageHeight = NaN;
    this._overlayFallbackCanvas = null;
    this._overlayFallbackCtx = null;
    this._overlayFallbackImageData = null;
    this._overlayFallbackBuffer32 = null;
    this._overlayFallbackDisplay = { buffer32: null, imgData: null };

    this.cursorCanvas = null;
    this.cursorX = 0;
    this.cursorY = 0;
    this._lastCursorX = Number.NaN;
    this._lastCursorY = Number.NaN;
    this._lastCursorHasSprite = false;
    this._cursorStateVersion = 0;
    this._lastCursorStateVersion = 0;
    this.guiEnabled = true;
    this.hudMargin = 20;

    this.stageCav = canvasForOutput;
    this.stageCtx = canvasForOutput.getContext('2d', { alpha: true, willReadFrequently: true });
    this.stageCtx.imageSmoothingEnabled = false;
    this._ctxAlpha = 1;
    this._ctxFillStyle = '';
    this._ctxStrokeStyle = '';
    this.gameImgProps = new StageImageProperties();
    this.guiImgProps  = new StageImageProperties();
    this.gameOverlayImgProps = new StageImageProperties();
    this.guiOverlayImgProps = new StageImageProperties();

    // HUD always starts at scale = 4
    this.guiImgProps.viewPoint = new ViewPoint(0, 0, 4);
    this.gameOverlayImgProps.viewPoint = this.gameImgProps.viewPoint;
    this.guiOverlayImgProps.viewPoint = this.guiImgProps.viewPoint;
    this._rawScale = this.gameImgProps.viewPoint.scale || 1;

    // Initialize DisplayImage instances
    this.getGameDisplay();
    this.getGuiDisplay();

    this.controller = new UserInputManager(canvasForOutput, {
      passiveMouseMove: true
    });
    this.handleOnMouseUp();
    this.handleOnMouseDown();
    this.handleOnMouseRightUp();
    this.handleOnMouseRightDown();
    this.handleOnMouseMove();
    this.handleOnDoubleClick();
    this.handleOnZoom();

    this.updateStageSize();
    this.clear();
  }

  setPerfOverlay(enabled, provider = null) {
    this.perfOverlayEnabled = !!enabled;
    this.perfOverlayProvider = typeof provider === 'function' ? provider : null;
  }

  setRenderExperimentFlags(flags = {}) {
    const capabilities = detectRuntimeCapabilities();
    this._renderExperiments = resolveRenderExperimentState(flags, capabilities);
  }

  getRenderExperimentStatus() {
    return { ...this._renderExperiments };
  }

  getPerfSnapshot() {
    const frameQuantiles = summarizeSamples(this._perfFrameSamples);
    const drawQuantiles = summarizeSamples(this._perfDrawSamples);
    const clearQuantiles = summarizeSamples(this._perfClearSamples);
    const regionQuantiles = summarizeSamples(this._perfDirtyRegionsSamples);
    const areaQuantiles = summarizeSamples(this._perfDirtyAreaRatioSamples);
    const uploadQuantiles = summarizeSamples(this._perfUploadCallsSamples);
    const allocationQuantiles = summarizeSamples(this._perfAllocationsSamples);
    return {
      frameMs: this._perfFrameMs,
      drawMs: this._perfDrawMs,
      clearMs: this._perfClearMs,
      peakFrameMs: this._perfFramePeakMs,
      frameCount: this._perfFrameCount,
      frame: frameQuantiles,
      draw: drawQuantiles,
      clear: clearQuantiles,
      dirtyRegions: regionQuantiles,
      dirtyAreaRatio: areaQuantiles,
      uploadCalls: uploadQuantiles,
      allocations: allocationQuantiles,
      lastDamage: { ...this._perfLastDamage },
      lastAllocations: { ...this._perfLastAllocations },
      experiments: this.getRenderExperimentStatus()
    };
  }

  _pushPerfSample(samples, value) {
    if (!Number.isFinite(value) || value < 0) return;
    samples.push(value);
    if (samples.length > PERF_SAMPLE_WINDOW) {
      samples.splice(0, samples.length - PERF_SAMPLE_WINDOW);
    }
  }

  _collectDisplayAllocationStats(display) {
    const image = display?.display;
    if (!image?.consumeAllocationStats) {
      return {
        rectListCreated: 0,
        rectListReused: 0,
        tileListCreated: 0,
        tileListReused: 0
      };
    }
    return image.consumeAllocationStats(true);
  }

  _recordFramePerf(frameMs, drawMs, clearMs) {
    this._pushPerfSample(this._perfFrameSamples, frameMs);
    this._pushPerfSample(this._perfDrawSamples, drawMs);
    this._pushPerfSample(this._perfClearSamples, clearMs);
  }

  _recordDamagePerf(stats) {
    const regionCount = stats?.regionCount || 0;
    const dirtyAreaRatio = stats?.dirtyAreaRatio || 0;
    const uploadCalls = stats?.uploadCalls || 0;
    this._pushPerfSample(this._perfDirtyRegionsSamples, regionCount);
    this._pushPerfSample(this._perfDirtyAreaRatioSamples, dirtyAreaRatio);
    this._pushPerfSample(this._perfUploadCallsSamples, uploadCalls);
    this._perfLastDamage = {
      regionCount,
      dirtyAreaRatio,
      uploadCalls,
      fullBlitCount: stats?.fullBlitCount || 0,
      tileUpdateCount: stats?.tileUpdateCount || 0
    };
  }

  _recordAllocationPerf(stats) {
    const rectCreated = stats?.rectListCreated || 0;
    const rectReused = stats?.rectListReused || 0;
    const tileCreated = stats?.tileListCreated || 0;
    const tileReused = stats?.tileListReused || 0;
    this._pushPerfSample(
      this._perfAllocationsSamples,
      rectCreated + rectReused + tileCreated + tileReused
    );
    this._perfLastAllocations = {
      rectListCreated: rectCreated,
      rectListReused: rectReused,
      tileListCreated: tileCreated,
      tileListReused: tileReused
    };
  }

  setCursorSprite(frame) {
    if (!frame) {
      this.cursorCanvas = null;
      // Force redraw even if cursor position is unchanged.
      this._cursorStateVersion += 1;
      return;
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      this.cursorCanvas = null;
      this._cursorStateVersion += 1;
      return;
    }
    const c = document.createElement('canvas');
    c.width = frame.width;
    c.height = frame.height;
    const ictx = c.getContext('2d', { alpha: true, willReadFrequently: true});
    if (!ictx) {
      this.cursorCanvas = null;
      this._cursorStateVersion += 1;
      return;
    }
    ictx.putImageData(
      new ImageData(frame.getData(), frame.width, frame.height),
      0,
      0
    );
    this.cursorCanvas = c;
    // Sprite updates must invalidate the cursor plane for the next redraw.
    this._cursorStateVersion += 1;
  }

  setGuiEnabled(enabled) {
    this.guiEnabled = !!enabled;
    if (!this.guiEnabled) {
      this.guiImgProps.display = null;
      this.guiOverlayImgProps.display = null;
      this._guiOverlayVisible = false;
      this._lastGuiOverlayDrawSignature = '';
    }
    this.updateStageSize();
  }

  calcPosition2D(stageImage, e) {
    const localX = e.x - stageImage.x;
    const localY = e.y - stageImage.y;
    const worldX = stageImage.viewPoint.getSceneX(localX);
    const worldY = stageImage.viewPoint.getSceneY(localY);
    return new Position2D(worldX, worldY);
  }

  handleOnDoubleClick() {
    this.controller.onDoubleClick.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onDoubleClick.trigger(pos);
    });
  }

  handleOnMouseDown() {
    this.controller.onMouseDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseDown.trigger(pos);
    });
  }

  handleOnMouseUp() {
    this.controller.onMouseUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseUp.trigger(pos);
    });
  }

  handleOnMouseRightDown() {
    this.controller.onMouseRightDown.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightDown.trigger(pos);
    });
  }

  handleOnMouseRightUp() {
    this.controller.onMouseRightUp.on((e) => {
      const stageImage = this.getStageImageAt(e.x, e.y);
      if (!stageImage || !stageImage.display) return;
      const pos = this.calcPosition2D(stageImage, e);
      stageImage.display.onMouseRightUp.trigger(pos);
    });
  }

  handleOnMouseMove() {
    this.controller.onMouseMove.on((e) => {
      this.cursorX = e.x;
      this.cursorY = e.y;

      if (e.button) {
        const stageImage = this.getStageImageAt(e.mouseDownX, e.mouseDownY);
        if (!stageImage || !stageImage.display) return;
        if (this.panEnabled && stageImage === this.gameImgProps) {
          this.updateViewPoint(stageImage, e.deltaX, e.deltaY, 0);
        }
        const pos = this.calcPosition2D(stageImage, e);
        stageImage.display.onMouseMove.trigger(pos);
      } else {
        const stageImage = this.getStageImageAt(e.x, e.y);
        if (!stageImage || !stageImage.display) return;
        const localX = e.x - stageImage.x;
        const localY = e.y - stageImage.y;
        const worldX = stageImage.viewPoint.getSceneX(localX);
        const worldY = stageImage.viewPoint.getSceneY(localY);
        stageImage.display.onMouseMove.trigger(
          new Position2D(worldX, worldY)
        );

      }
    });
  }

  handleOnZoom() {
    this.controller.onZoom.on((e) => {
      const stageImage = this.gameImgProps;
      if (!stageImage || !stageImage.display) return;

      // Always zoom around the cursor position e.x,e.y
      this.updateViewPoint(stageImage, e.x, e.y, e.deltaZoom, e.velocity);
    });
  }

  /**
   * updateViewPoint(stageImage, argX, argY, deltaZoom)
   *
   * Pan/zoom logic:
   * • If deltaZoom !== 0: treat argX,argY as cursor pixel coordinates.
   *   1) Compute relX = screenX − stageImage.x
   *   2) Compute relY = screenY − stageImage.y
   *   3) sceneX_pre = viewPoint.getSceneX(relX)
   *      sceneY_pre = viewPoint.getSceneY(relY)
   *   4) newScale = oldScale + deltaZoom × zoomSensitivity
   *   5) Clamp then snap newScale
   *   6) viewPoint.scale = newScale
   *   7) viewPoint.x = sceneX_pre − (relX / newScale)
   *      viewPoint.y = sceneY_pre − (relY / newScale)
   * • Else: treat argX,argY as drag distances (deltaX,deltaY) in screen pixels
   *   1) worldDX = deltaX / scale
   *      worldDY = deltaY / scale
   *   2) viewPoint.x −= worldDX
   *      viewPoint.y −= worldDY
   */
  updateViewPoint(stageImage, argX, argY, deltaZoom, veloUpdate = false) {
    if (!stageImage || !stageImage.display) return;

    let targetScale = stageImage.viewPoint.scale || 1;
    let targetX = stageImage.viewPoint.x;
    let targetY = stageImage.viewPoint.y;

    if (deltaZoom !== 0) {
      const screenX_rel = argX - stageImage.x;
      const screenY_rel = argY - stageImage.y;

      const sceneX_pre = stageImage.viewPoint.getSceneX(screenX_rel);
      const sceneY_pre = stageImage.viewPoint.getSceneY(screenY_rel);

      const zoomSensitivity = 0.001125;
      const desiredScale = targetScale + deltaZoom * zoomSensitivity;
      const snappedScale = this.snapScale(desiredScale);
      targetScale = snappedScale;

      if (!veloUpdate && snappedScale !== stageImage.viewPoint.scale) {
        targetX = sceneX_pre - screenX_rel / targetScale;
        targetY = sceneY_pre - screenY_rel / targetScale;
      }
    } else {
      targetX += argX / targetScale;
      targetY += argY / targetScale;
    }
    const imgData = stageImage.display.getImageData();
    const shouldRedrawGui = !!(
      this.guiEnabled &&
      stageImage === this.guiImgProps &&
      this.guiImgProps.display?.getImageData
    );
    const guiImgData = shouldRedrawGui ? this.guiImgProps.display.getImageData() : null;
    this.applyViewport(stageImage, targetX, targetY, targetScale);
    this.clear(stageImage);
    if (shouldRedrawGui) {
      this.clear(this.guiImgProps);
    }
    this.draw(stageImage, imgData);
    if (shouldRedrawGui) {
      this.draw(this.guiImgProps, guiImgData);
    }
  }

  /**
   * Snap a raw scale so that (displayWidth × scale) and (displayHeight × scale)
   * are both integers (no sub‐pixel artifact). Based on DisplayImage’s dimensions.
   */
  snapScale(rawScale) {
    const { width: dispW, height: dispH } = this.gameImgProps.display.worldDataSize;
    if (dispW === 0 || dispH === 0) return rawScale;

    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(dispW, dispH);
    const step = 1 / g;

    const minScale = 0.25;
    const maxScale = 8;
    let clamped = rawScale;
    if (clamped < minScale) clamped = minScale;
    if (clamped > maxScale) clamped = maxScale;

    return Math.round(clamped / step) * step;
  }

  applyViewport(stageImage, targetX, targetY, targetScale) {
    if (!stageImage || !stageImage.display) return;

    this._rawScale = targetScale;
    stageImage.viewPoint.scale = this.snapScale(targetScale);
    stageImage.viewPoint.setX(targetX);
    stageImage.viewPoint.setY(targetY);

    this.clampViewPoint(stageImage);
  }

  scheduleUpdateStageSize() {
    if (this._resizeRaf) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.updateStageSize();
      return;
    }
    this._resizeRaf = window.requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.updateStageSize(true);
    });
  }

  updateStageSize(fromResize = false) {
    const stageH = this.stageCav.height;
    const stageW = this.stageCav.width;
    if (fromResize && stageW === this._lastStageWidth && stageH === this._lastStageHeight) {
      const gameDirty = this.gameImgProps.display?.hasPendingDirty?.() === true;
      const guiDirty = this.guiEnabled && this.guiImgProps.display?.hasPendingDirty?.() === true;
      if (!gameDirty && !guiDirty) return;
    }
    this._lastStageWidth = stageW;
    this._lastStageHeight = stageH;
    const guiActive = this.guiEnabled && !!this.guiImgProps.display;
    // this margin is for the level <select> elements in the html
    const margin = guiActive ? this.hudMargin : 0;

    // HUD scale adapts to available space
    const rawHUDH = guiActive ? (this.guiImgProps.display?.worldDataSize.height || 80) : 0;
    const rawHUDW = guiActive ? (this.guiImgProps.display?.worldDataSize.width || 720) : 0;

    const maxScaleW = guiActive && rawHUDW ? stageW / rawHUDW : 1;
    const maxScaleH = guiActive && rawHUDH ? (stageH - margin) / rawHUDH : 1;
    let hudScale = guiActive ? Math.min(4, maxScaleW, maxScaleH) : 1;
    if (!isFinite(hudScale) || hudScale <= 0) hudScale = 1;
    this.guiImgProps.viewPoint.scale = hudScale;

    const hudH = guiActive ? rawHUDH * hudScale : 0;
    const hudW = guiActive ? rawHUDW * hudScale : 0;

    const gameH = Math.max(0, stageH - hudH - margin);

    Object.assign(this.gameImgProps, { x: 0, y: 0 });
    this.gameImgProps.canvasViewportSize = { width: stageW, height: gameH };
    Object.assign(this.guiImgProps, {
      x: guiActive ? (stageW - hudW) / 2 : 0,
      y: guiActive ? (stageH - hudH - margin) : 0
    });
    this.guiImgProps.canvasViewportSize = { width: hudW, height: hudH };
    this._syncOverlayLayout();

    if (this.gameImgProps.display) {
      const { width: worldW, height: worldH } = this.gameImgProps.display.worldDataSize;

      const scale = this.gameImgProps.viewPoint.scale || 2;
      const viewH_world = gameH / scale;
      const viewW_world = stageW / scale;

      let x = this.gameImgProps.viewPoint.x;
      let y = this.gameImgProps.viewPoint.y;
      if (!isFinite(x)) x = 0;
      if (!isFinite(y)) y = 0;

      if (worldW * scale <= stageW) {
        x = (worldW - viewW_world) / 2;
      }

      this.applyViewport(this.gameImgProps, x, y, scale);

      // Redraw at initial position
      this.clear(this.gameImgProps);
      const gameImg = this.gameImgProps.display.getImageData();
      this.draw(this.gameImgProps, gameImg);
    }

    if (guiActive && this.guiImgProps.display) {
      const guiImg = this.guiImgProps.display.getImageData();
      this.draw(this.guiImgProps, guiImg);
    }

    this._syncOverlayDisplaySize(this.gameImgProps, this.gameOverlayImgProps);
    this._syncOverlayDisplaySize(this.guiImgProps, this.guiOverlayImgProps);
  }
  getStageImageAt(x, y) {
    const { width: gameW, height: gameH } =
      this.gameImgProps.canvasViewportSize;
    if (
      x >= this.gameImgProps.x &&
      x <  this.gameImgProps.x + gameW &&
      y >= this.gameImgProps.y &&
      y <  this.gameImgProps.y + gameH
    ) {
      return this.gameImgProps;
    }
    const { width: guiW, height: guiH } =
      this.guiImgProps.canvasViewportSize;
    if (
      x >= this.guiImgProps.x &&
      x <  this.guiImgProps.x + guiW &&
      y >= this.guiImgProps.y &&
      y <  this.guiImgProps.y + guiH
    ) {
      return this.guiImgProps;
    }
    return null;
  }

  getGameDisplay() {
    if (this.gameImgProps.display) return this.gameImgProps.display;
    this.gameImgProps.display = new DisplayImage(this);
    return this.gameImgProps.display;
  }

  getGuiDisplay() {
    if (this.guiImgProps.display) return this.guiImgProps.display;
    this.guiImgProps.display = new DisplayImage(this);
    return this.guiImgProps.display;
  }

  getGameOverlayDisplay() {
    if (this.gameOverlayImgProps.display) return this.gameOverlayImgProps.display;
    this.gameOverlayImgProps.display = new DisplayImage(this);
    this._syncOverlayDisplaySize(this.gameImgProps, this.gameOverlayImgProps);
    this.gameOverlayImgProps.display.clear(0x00000000);
    return this.gameOverlayImgProps.display;
  }

  getGuiOverlayDisplay() {
    if (this.guiOverlayImgProps.display) return this.guiOverlayImgProps.display;
    this.guiOverlayImgProps.display = new DisplayImage(this);
    this._syncOverlayDisplaySize(this.guiImgProps, this.guiOverlayImgProps);
    this.guiOverlayImgProps.display.clear(0x00000000);
    return this.guiOverlayImgProps.display;
  }

  setGameOverlayVisible(visible) {
    const nextVisible = !!visible;
    if (this._gameOverlayVisible === nextVisible) return;
    this._gameOverlayVisible = nextVisible;
    this._overlayVisibilityVersion += 1;
  }

  setGuiOverlayVisible(visible) {
    const nextVisible = !!visible;
    if (this._guiOverlayVisible === nextVisible) return;
    this._guiOverlayVisible = nextVisible;
    this._overlayVisibilityVersion += 1;
  }

  setGameViewPointPosition(x, y, options = {}) {
    const targetX = isFinite(x) ? x : 0;
    const targetY = isFinite(y) ? y : 0;
    const preserveScale = options.preserveScale === true;
    if (preserveScale) {
      const rawScale = Number.isFinite(this._rawScale)
        ? this._rawScale
        : (this.gameImgProps.viewPoint.scale || 1);
      this._rawScale = rawScale;
      this.applyViewport(this.gameImgProps, targetX, targetY, rawScale);
      this.redraw(true);
      return;
    }

    const app = globalThis?.lemmings;
    if (app?.scale > 0) {
      this._rawScale = app.scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(targetX);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);

      this.redraw(true);
      return;
    }

    let scale = this.gameImgProps.viewPoint.scale;
    if (scale === 2) {
      this._rawScale = scale;
      this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
      this.gameImgProps.viewPoint.setX(targetX);
      this.gameImgProps.viewPoint.setY(targetY);
      this.clampViewPoint(this.gameImgProps);

      this.redraw(true);
      return;
    }

    const sceneX = this.gameImgProps.viewPoint.getSceneX(targetX - this.gameImgProps.x);
    const sceneY = this.gameImgProps.viewPoint.getSceneY(targetY - this.gameImgProps.y);
    this._rawScale = 2;
    this.gameImgProps.viewPoint.scale = this.snapScale(this._rawScale);
    this.gameImgProps.viewPoint.setX(
      sceneX - (targetX - this.gameImgProps.x) / this.gameImgProps.viewPoint.scale
    );
    this.gameImgProps.viewPoint.setY(
      sceneY - (targetY - this.gameImgProps.y) / this.gameImgProps.viewPoint.scale
    );
    this.clampViewPoint(this.gameImgProps);

    this.redraw(true);
  }

  /**
   * Composite the stage canvas from game/gui layers.
   * @param {boolean} forceComposite - When true, always repaint both layers
   * (used by call-sites that clear stage regions before requesting redraw).
   */
  redraw(forceComposite = false) {
    const start = perfNow();
    this._updateFadeState(start);
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
    const fullArea = this._frameDamageStats.fullArea || 0;
    const dirtyAreaRatio = fullArea > 0
      ? Math.min(1, (this._frameDamageStats.dirtyArea || 0) / fullArea)
      : 0;
    this._recordFramePerf(this._perfFrameMs, this._perfDrawMs, this._perfClearMs);
    this._recordDamagePerf({
      regionCount: this._frameDamageStats.regionCount || 0,
      dirtyAreaRatio,
      uploadCalls: this._frameDamageStats.uploadCalls || 0,
      fullBlitCount: this._frameDamageStats.fullBlitCount || 0,
      tileUpdateCount: this._frameDamageStats.tileUpdateCount || 0
    });
    this._recordAllocationPerf(allocations);
    if (this.perfOverlayEnabled) {
      this.drawPerfOverlay();
    }
    this._lastCursorX = this.cursorX;
    this._lastCursorY = this.cursorY;
    this._lastCursorHasSprite = !!this.cursorCanvas;
    this._lastCursorStateVersion = this._cursorStateVersion;
    this._lastOverlayVisibilityVersion = this._overlayVisibilityVersion;
  }

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
  }

  clear(stageImage) {
    const start = this._perfTrackingFrame ? perfNow() : 0;
    const ctx = this.stageCtx;
    this._setFillStyle('#000900');
    if (!stageImage) {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.fillRect(stageImage.x, stageImage.y, stageImage.width, stageImage.height);
    }
    if (this._perfTrackingFrame) {
      this._perfClearMs += perfNow() - start;
    }
  }

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
  }

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
  }

  _accumulateFrameDamage(stats) {
    if (!this._frameDamageStats || !stats) return;
    this._frameDamageStats.regionCount += stats.regionCount || 0;
    this._frameDamageStats.dirtyArea += stats.dirtyArea || 0;
    this._frameDamageStats.fullArea += stats.fullArea || 0;
    this._frameDamageStats.uploadCalls += stats.uploadCalls || 0;
    this._frameDamageStats.fullBlitCount += stats.fullBlit ? 1 : 0;
    this._frameDamageStats.tileUpdateCount += stats.usedTiles ? 1 : 0;
  }

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

  resetFade() {
    this.fadeAlpha = 0;
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.fadeTimer = this.overlayTimer = 0;
    this._fadeOutActive = false;
    this._overlayFadeActive = false;
    this._fadeClockMs = NaN;
    this._fadeDashAccumulator = 0;
  }

  startFadeOut() {
    this.fadeAlpha = 0;
    this.fadeTimer = 1;
    this._fadeOutActive = true;
    this._fadeClockMs = perfNow();
  }

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
  }

  resetOverlayFade() {
    this.overlayAlpha = 0;
    this.overlayRect = null;
    this.overlayDashLen = 0;
    this.overlayTimer = 0;
    this._overlayFadeActive = false;
    this._fadeDashAccumulator = 0;
    if (!this._fadeOutActive) this._fadeClockMs = NaN;
  }

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
  }

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
  }

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
  }

  drawPerfOverlay() {
    const ctx = this.stageCtx;
    const snap = this.getPerfSnapshot();
    const lines = [
      `frame ${this._perfFrameMs.toFixed(2)}ms`,
      `draw ${this._perfDrawMs.toFixed(2)}ms clear ${this._perfClearMs.toFixed(2)}ms`,
      `peak ${this._perfFramePeakMs.toFixed(2)}ms`,
      `p95 ${snap.frame.p95.toFixed(2)} p99 ${snap.frame.p99.toFixed(2)} worst ${snap.frame.worst.toFixed(2)}`,
      `damage r${snap.lastDamage.regionCount} a${(snap.lastDamage.dirtyAreaRatio * 100).toFixed(1)}% u${snap.lastDamage.uploadCalls}`,
      `alloc rc${snap.lastAllocations.rectListCreated} tc${snap.lastAllocations.tileListCreated}`
    ];
    if (this.perfOverlayProvider) {
      const data = this.perfOverlayProvider() || {};
      if (Array.isArray(data.lines)) {
        for (const line of data.lines) {
          if (line) lines.push(String(line));
        }
      }
    }
    const x = 8;
    const y = 8;
    const lineH = 12;
    const width = 280;
    const height = (lines.length * lineH) + 8;
    this._setGlobalAlpha(0.6);
    this._setFillStyle('#000');
    ctx.fillRect(x - 4, y - 4, width, height);
    this._setGlobalAlpha(1);
    this._setFillStyle('#8cf');
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + (i * lineH));
    }
  }

  drawCursor() {
    if (!this.cursorCanvas) return;
    const ctx = this.stageCtx;
    const cx = Math.trunc(this.cursorX - this.cursorCanvas.width / 2);
    const cy = Math.trunc(this.cursorY - this.cursorCanvas.height / 2);
    ctx.drawImage(this.cursorCanvas, cx, cy);
  }

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
  }

  getGameViewRect() {
    return {
      x: this.gameImgProps.viewPoint.x,
      y: this.gameImgProps.viewPoint.y,
      w: this.gameImgProps.canvasViewportSize.width  / this.gameImgProps.viewPoint.scale,
      h: this.gameImgProps.canvasViewportSize.height / this.gameImgProps.viewPoint.scale

    };
  }

  limitValue(minLimit, value, maxLimit) {
    return Math.min(Math.max(minLimit, value), maxLimit);
  }

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
  }

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
  }

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
  }

  _setGlobalAlpha(value) {
    if (this._ctxAlpha === value) return;
    this.stageCtx.globalAlpha = value;
    this._ctxAlpha = value;
  }

  _setFillStyle(value) {
    if (this._ctxFillStyle === value) return;
    this.stageCtx.fillStyle = value;
    this._ctxFillStyle = value;
  }

  _setStrokeStyle(value) {
    if (this._ctxStrokeStyle === value) return;
    this.stageCtx.strokeStyle = value;
    this._ctxStrokeStyle = value;
  }
}

export { Stage };
