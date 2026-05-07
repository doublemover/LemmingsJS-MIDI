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
const stagePerfMethods = {
  setPerfOverlay(enabled, provider = null) {
    this.perfOverlayEnabled = !!enabled;
    this.perfOverlayProvider = typeof provider === 'function' ? provider : null;
  },

  setScaleProvider(provider = null) {
    this._scaleProvider = typeof provider === 'function' ? provider : null;
  },

  _getRequestedScale() {
    if (!this._scaleProvider) return 0;
    try {
      const value = Number(this._scaleProvider());
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  },

  setRenderExperimentFlags(flags = {}) {
    const capabilities = detectRuntimeCapabilities();
    this._renderExperiments = resolveRenderExperimentState(flags, capabilities);
  },

  getRenderExperimentStatus() {
    return { ...this._renderExperiments };
  },

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
  },

  _pushPerfSample(samples, value) {
    if (!Number.isFinite(value) || value < 0) return;
    samples.push(value);
    if (samples.length > PERF_SAMPLE_WINDOW) {
      samples.splice(0, samples.length - PERF_SAMPLE_WINDOW);
    }
  },

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
  },

  _shouldCollectPerfSamples() {
    return this.perfOverlayEnabled === true;
  },

  _recordFramePerf(frameMs, drawMs, clearMs) {
    this._pushPerfSample(this._perfFrameSamples, frameMs);
    this._pushPerfSample(this._perfDrawSamples, drawMs);
    this._pushPerfSample(this._perfClearSamples, clearMs);
  },

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
  },

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
};
export { stagePerfMethods };