import { expect } from 'chai';
import { Stage } from '../../js/render/Stage.js';
import { ViewPoint } from '../../js/render/ViewPoint.js';
import { setDependency, resetDependencies, useGlobalLemmings, withGlobalLemmings } from '../helpers/lemmings.js';

const makeContext = () => {
  const ctx = {
    canvas: null,
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: '',
    putCalls: [],
    drawCalls: [],
    fillCalls: [],
    textCalls: [],
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(img, x, y) {
      this.putCalls.push({ img, x, y });
    },
    getImageData(x, y, width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    fillRect(x, y, width, height) {
      this.fillCalls.push({ x, y, width, height });
    },
    fillText(text, x, y) {
      this.textCalls.push({ text, x, y });
    },
    drawImage(...args) {
      this.drawCalls.push(args);
    }
  };
  return ctx;
};

const makeCanvas = (width = 320, height = 200) => {
  const ctx = makeContext();
  const canvas = {
    width,
    height,
    style: {},
    getContext() { return ctx; },
    addEventListener() {},
    removeEventListener() {}
  };
  ctx.canvas = canvas;
  return { canvas, ctx };
};

describe('Stage', function() {
  const originalWindow = globalThis.window;

  const originalDocument = globalThis.document;

  const originalImageData = globalThis.ImageData;

  const originalPerformance = globalThis.performance;

  useGlobalLemmings({});

  let now = 0;

  beforeEach(function() {
    now = 0;
    globalThis.document = {
      createElement() {
        return makeCanvas(10, 10).canvas;
      }
    };
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    globalThis.ImageData = class {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
    globalThis.performance = {
      now: () => {
        now += 1;
        return now;
      }
    };
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.ImageData = originalImageData;
    globalThis.performance = originalPerformance;
  });

  it('recycles consumed dirty-tile buffers after drawing', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const consumedTiles = [{ x: 0, y: 0, width: 4, height: 4 }];
    let releasedTiles = null;
    stage.gameImgProps.display.consumeDirtyTiles = () => consumedTiles;
    stage.gameImgProps.display.releaseConsumedDirtyTiles = (tiles) => { releasedTiles = tiles; };
    stage.gameImgProps.display.consumeDirtyRects = () => [];

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(releasedTiles).to.equal(consumedTiles);
  });

  it('falls back to dirty-rect blits when tile updates are empty', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const consumedRects = [{ x: 2, y: 3, width: 4, height: 5 }];
    stage.gameImgProps.display.consumeDirtyTiles = () => [];
    stage.gameImgProps.display.consumeDirtyRects = () => consumedRects;
    stage.gameImgProps.display.releaseConsumedDirtyRects = () => {};

    const displayCtx = stage.gameImgProps.ctx;
    let putCount = 0;
    const originalPut = displayCtx.putImageData.bind(displayCtx);
    displayCtx.putImageData = (...args) => {
      putCount += 1;
      return originalPut(...args);
    };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(putCount).to.equal(1);
  });

  it('forces full blits when cumulative frame damage crosses the region threshold', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const consumedRects = [
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 5, y: 5, width: 2, height: 2 }
    ];
    stage.gameImgProps.display.consumeDirtyTiles = () => undefined;
    stage.gameImgProps.display.consumeDirtyRects = () => consumedRects;
    stage.gameImgProps.display.releaseConsumedDirtyRects = () => {};
    stage._frameDamageStats = {
      regionCount: 47,
      dirtyArea: 0,
      fullArea: 40 * 20,
      uploadCalls: 0,
      fullBlitCount: 0,
      tileUpdateCount: 0
    };

    const putArgs = [];
    stage.gameImgProps.ctx.putImageData = (...args) => {
      putArgs.push(args);
    };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(putArgs).to.have.length(1);
    expect(putArgs[0]).to.have.length(3);
    expect(stage._frameDamageStats.fullBlitCount).to.equal(1);
  });

  it('uses a single union blit when offscreen-present mode is active', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();
    stage._renderExperiments.offscreenPresentActive = true;

    const consumedRects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 }
    ];
    stage.gameImgProps.display.consumeDirtyTiles = () => undefined;
    stage.gameImgProps.display.consumeDirtyRects = () => consumedRects;
    stage.gameImgProps.display.releaseConsumedDirtyRects = () => {};
    stage._frameDamageStats = {
      regionCount: 0,
      dirtyArea: 0,
      fullArea: 40 * 20,
      uploadCalls: 0,
      fullBlitCount: 0,
      tileUpdateCount: 0
    };

    const putArgs = [];
    stage.gameImgProps.ctx.putImageData = (...args) => {
      putArgs.push(args);
    };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(putArgs).to.have.length(1);
    expect(putArgs[0]).to.have.length(7);
    expect(stage._frameDamageStats.uploadCalls).to.equal(1);
  });

  it('rolls back offscreen-present mode when union blits fail at runtime', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();
    stage._renderExperiments.offscreenPresentActive = true;

    const consumedRects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 }
    ];
    stage.gameImgProps.display.consumeDirtyTiles = () => undefined;
    stage.gameImgProps.display.consumeDirtyRects = () => consumedRects;
    stage.gameImgProps.display.releaseConsumedDirtyRects = () => {};
    stage._frameDamageStats = {
      regionCount: 0,
      dirtyArea: 0,
      fullArea: 40 * 20,
      uploadCalls: 0,
      fullBlitCount: 0,
      tileUpdateCount: 0
    };

    let calls = 0;
    stage.gameImgProps.ctx.putImageData = () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('present failed');
      }
    };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(calls).to.equal(consumedRects.length + 1);
    expect(stage._renderExperiments.offscreenPresentActive).to.equal(false);
    expect(stage._renderExperiments.rollbackReason).to.equal('offscreen_present_runtime_error');
    expect(stage._frameDamageStats.uploadCalls).to.equal(consumedRects.length);
  });

  it('keeps updates visible when tile tracking is enabled after pending rect dirties', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const display = stage.gameImgProps.display;
    display.markDirtyRect(1, 1, 4, 4);
    display.setDirtyTileSize(8);

    const displayCtx = stage.gameImgProps.ctx;
    let putCount = 0;
    const originalPut = displayCtx.putImageData.bind(displayCtx);
    displayCtx.putImageData = (...args) => {
      putCount += 1;
      return originalPut(...args);
    };

    stage.draw(stage.gameImgProps, display.getImageData());
    expect(putCount).to.be.greaterThan(0);
  });

  it('composites dedicated overlay planes without mutating base display dirty state', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.guiImgProps.display.initSize(40, 20);
    stage.updateStageSize();
    stage.redraw(true);
    expect(stage.gameImgProps.display.hasPendingDirty()).to.equal(false);

    const gameOverlay = stage.getGameOverlayDisplay();
    gameOverlay.clear(0x00000000);
    gameOverlay.drawMarchingAntRect(1, 1, 6, 6, 2, 0);
    stage.setGameOverlayVisible(true);
    stage.redraw();

    expect(stage.gameImgProps.display.hasPendingDirty()).to.equal(false);
    expect(stage.gameOverlayImgProps.display).to.equal(gameOverlay);
  });

  it('parses overlay colors with and without alpha', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.startOverlayFade('rgb(1, 2, 3)', null, 1);
    expect(stage.overlayDashColor >>> 0).to.equal(0xFF030201);
    stage.startOverlayFade('rgba(300, -10, 7.4, 1.5)', null, 1);
    expect(stage.overlayDashColor >>> 0).to.equal(0xFF0700FF);
    stage.startOverlayFade('rgba(1,2,3,0.5)', null, 1);
    expect(stage.overlayDashColor >>> 0).to.equal(0x80030201);
    stage.startOverlayFade('invalid', null, 1);
    expect(stage.overlayDashColor >>> 0).to.equal(0xFFFFFFFF);
  });

  it('reuses fallback overlay surfaces without getImageData churn', function() {
    const { canvas, ctx } = makeCanvas(200, 100);
    let getImageCalls = 0;
    ctx.getImageData = (x, y, width, height) => {
      getImageCalls += 1;
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    };

    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.guiImgProps.display.initSize(40, 20);
    stage.updateStageSize();
    stage.overlayAlpha = 1;
    stage.overlayColor = 'rgba(10,20,30,0.5)';
    stage.overlayDashColor = 0xFF030201;
    stage.overlayDashLen = 2;
    stage.overlayDashOffset = 1;
    stage.overlayRect = { x: 4, y: 5, width: 10, height: 6 };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    const firstFallback = stage._overlayFallbackImageData;
    stage.overlayDashOffset = 2;
    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());

    expect(getImageCalls).to.equal(0);
    expect(stage._overlayFallbackImageData).to.equal(firstFallback);
  });

  it('renders an opt-in perf overlay and reports stage perf snapshots', function() {
    const { canvas, ctx } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.guiImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    stage.setPerfOverlay(true, () => ({ lines: ['custom metric'] }));
    stage.redraw();

    const perf = stage.getPerfSnapshot();
    expect(perf.frameCount).to.be.greaterThan(0);
    expect(perf.frameMs).to.be.greaterThan(0);
    expect(perf.frame.p95).to.be.greaterThan(0);
    expect(perf.lastDamage.uploadCalls).to.be.at.least(0);
    expect(perf.lastAllocations.rectListCreated).to.be.at.least(0);
    expect(ctx.textCalls.some(call => call.text.includes('frame'))).to.equal(true);
    expect(ctx.textCalls.some(call => call.text.includes('custom metric'))).to.equal(true);
  });

  it('tracks render experiment flags and rollback status', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.setRenderExperimentFlags({
      offscreenPresent: true,
      workerOffscreen: true
    });
    const status = stage.getRenderExperimentStatus();
    expect(status.offscreenPresentRequested).to.equal(true);
    expect(status.workerOffscreenRequested).to.equal(true);
    expect(typeof status.offscreenPresentActive).to.equal('boolean');
    expect(typeof status.workerOffscreenActive).to.equal('boolean');
  });

  it('skips overlay layout sync when overlay planes are unused', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.guiImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    let layoutSyncCalls = 0;
    let sizeSyncCalls = 0;
    const originalLayoutSync = stage._syncOverlayLayout.bind(stage);
    const originalSizeSync = stage._syncOverlayDisplaySize.bind(stage);
    stage._syncOverlayLayout = () => {
      layoutSyncCalls += 1;
      return originalLayoutSync();
    };
    stage._syncOverlayDisplaySize = (...args) => {
      sizeSyncCalls += 1;
      return originalSizeSync(...args);
    };

    stage.redraw();
    expect(layoutSyncCalls).to.equal(0);
    expect(sizeSyncCalls).to.equal(0);

    stage.getGameOverlayDisplay();
    layoutSyncCalls = 0;
    sizeSyncCalls = 0;
    stage.redraw();
    expect(layoutSyncCalls).to.be.greaterThan(0);
    expect(sizeSyncCalls).to.be.greaterThan(0);
  });
});
