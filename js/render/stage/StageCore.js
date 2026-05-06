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
import { stagePerfMethods } from './StagePerf.js';
import { stageInputMethods } from './StageInput.js';
import { stageCompositorMethods } from './StageCompositor.js';
import { stageOverlaysMethods } from './StageOverlays.js';
class Stage {
  constructor(canvasForOutput, options = {}) {
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
    this._scaleProvider = typeof options.getScale === 'function' ? options.getScale : null;

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
}
for (const methods of [
  stagePerfMethods,
  stageInputMethods,
  stageCompositorMethods,
  stageOverlaysMethods
]) {
  Object.defineProperties(Stage.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { Stage };