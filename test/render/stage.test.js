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

  it('routes pointer events and handles zoom', function() {
    const { canvas } = makeCanvas(320, 200);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();

    let lastDown = null;
    stage.gameImgProps.display.onMouseDown.on(pos => { lastDown = pos; });

    stage.controller.onMouseDown.trigger({ x: 10, y: 10 });
    expect(lastDown).to.not.equal(null);
    stage.controller.onMouseDown.trigger({ x: 1000, y: 1000 });

    let updateArgs = null;
    stage.updateViewPoint = (...args) => { updateArgs = args; };
    stage.controller.onMouseMove.trigger({
      x: 12,
      y: 12,
      mouseDownX: 10,
      mouseDownY: 10,
      deltaX: 3,
      deltaY: -2,
      button: true
    });
    expect(updateArgs).to.not.equal(null);

    updateArgs = null;
    stage.controller.onZoom.trigger({ x: 20, y: 10, deltaZoom: 5, velocity: 1 });
    expect(updateArgs).to.not.equal(null);

    updateArgs = null;
    stage.gameImgProps.display = null;
    stage.controller.onZoom.trigger({ x: 20, y: 10, deltaZoom: 5, velocity: 1 });
    expect(updateArgs).to.equal(null);
  });

  it('routes right clicks and hover events', function() {
    const { canvas } = makeCanvas(320, 200);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();

    let up = 0;
    let rightDown = 0;
    let rightUp = 0;
    let dbl = 0;
    let move = 0;
    stage.gameImgProps.display.onMouseUp.on(() => { up += 1; });
    stage.gameImgProps.display.onMouseRightDown.on(() => { rightDown += 1; });
    stage.gameImgProps.display.onMouseRightUp.on(() => { rightUp += 1; });
    stage.gameImgProps.display.onDoubleClick.on(() => { dbl += 1; });
    stage.gameImgProps.display.onMouseMove.on(() => { move += 1; });

    stage.controller.onMouseUp.trigger({ x: 1, y: 1 });
    stage.controller.onMouseUp.trigger({ x: 1000, y: 1000 });
    stage.controller.onMouseRightDown.trigger({ x: 1, y: 1 });
    stage.controller.onMouseRightDown.trigger({ x: 1000, y: 1000 });
    stage.controller.onMouseRightUp.trigger({ x: 1, y: 1 });
    stage.controller.onMouseRightUp.trigger({ x: 1000, y: 1000 });
    stage.controller.onDoubleClick.trigger({ x: 1, y: 1 });
    stage.controller.onDoubleClick.trigger({ x: 1000, y: 1000 });
    stage.controller.onMouseMove.trigger({ x: 2, y: 2, button: false });
    stage.controller.onMouseMove.trigger({ x: 1000, y: 1000, button: false });
    stage.controller.onMouseMove.trigger({
      x: 2,
      y: 2,
      mouseDownX: 1000,
      mouseDownY: 1000,
      deltaX: 0,
      deltaY: 0,
      button: true
    });
    stage.panEnabled = false;
    stage.controller.onMouseMove.trigger({
      x: 2,
      y: 2,
      mouseDownX: 2,
      mouseDownY: 2,
      deltaX: 0,
      deltaY: 0,
      button: true
    });

    expect(up).to.equal(1);
    expect(rightDown).to.equal(1);
    expect(rightUp).to.equal(1);
    expect(dbl).to.equal(1);
    expect(move).to.equal(2);
  });

  it('draws cursor, fades, and overlays', function() {
    const { canvas, ctx } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.guiImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const drawCountBefore = ctx.drawCalls.length;
    stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    });
    stage.cursorX = 5;
    stage.cursorY = 5;
    stage.drawCursor();
    expect(ctx.drawCalls.length).to.equal(drawCountBefore + 1);

    stage.setCursorSprite(null);
    expect(stage.cursorCanvas).to.equal(null);
    const drawCountAfter = ctx.drawCalls.length;
    stage.drawCursor();
    expect(ctx.drawCalls.length).to.equal(drawCountAfter);

    stage.startFadeOut();
    now += 2400;
    stage._updateFadeState(now);
    expect(stage.fadeAlpha).to.equal(1);

    let antsCalled = 0;
    setDependency('drawMarchingAntRect', () => { antsCalled += 1; });

    stage.startOverlayFade('rgba(1,2,3,0.5)', { x: 0, y: 0, width: 4, height: 4 }, 2);
    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(antsCalled).to.equal(1);

    stage.overlayTimer = 1;
    stage.startOverlayFade('rgba(1,2,3,0.5)', { x: 0, y: 0, width: 4, height: 4 }, 2);
    now += 2400;
    stage._updateFadeState(now);
    expect(stage.overlayAlpha).to.equal(0);
    expect(stage.overlayRect).to.equal(null);

    stage.fadeTimer = 1;
    stage.overlayTimer = 1;
    stage.resetFade();
    expect(stage.fadeTimer).to.equal(0);
    expect(stage.overlayTimer).to.equal(0);
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
    expect(ctx.textCalls.some(call => call.text.includes('frame'))).to.equal(true);
    expect(ctx.textCalls.some(call => call.text.includes('custom metric'))).to.equal(true);
  });

  it('clamps viewports and snaps scales', function() {
    const { canvas } = makeCanvas(320, 200);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();

    stage.gameImgProps.display.worldDataSize = { width: 50, height: 50 };
    stage.gameImgProps.canvasViewportSize = { width: 100, height: 100 };
    stage.gameImgProps.viewPoint.scale = 1;
    stage.gameImgProps.viewPoint.x = 10;
    stage.gameImgProps.viewPoint.y = -5;
    stage.clampViewPoint(stage.gameImgProps);
    expect(stage.gameImgProps.viewPoint.x).to.equal(-25);
    expect(stage.gameImgProps.viewPoint.y).to.equal(0);

    stage._rawScale = 1.5;
    let applied = null;
    let redraws = 0;
    const originalApply = stage.applyViewport;
    stage.applyViewport = (...args) => { applied = args; };
    stage.redraw = () => { redraws += 1; };
    stage.setGameViewPointPosition(5, 6, { preserveScale: true });
    expect(applied[3]).to.equal(1.5);
    expect(redraws).to.equal(1);

    withGlobalLemmings({ scale: 3 }, () => {
      stage.applyViewport = originalApply;
      stage.setGameViewPointPosition(2, 3);
      expect(stage.gameImgProps.viewPoint.scale).to.equal(stage.snapScale(3));
    });

    stage._rawScale = NaN;
    stage.setGameViewPointPosition(4, 5, { preserveScale: true });
    expect(stage._rawScale).to.equal(stage.gameImgProps.viewPoint.scale);

    stage._rawScale = NaN;
    stage.gameImgProps.viewPoint.scale = 0;
    stage.setGameViewPointPosition(4, Number.NaN, { preserveScale: true });
    expect(stage._rawScale).to.equal(1);

    withGlobalLemmings({ scale: 0 }, () => {
      stage.gameImgProps.display.worldDataSize = { width: 200, height: 100 };
      stage.gameImgProps.canvasViewportSize = { width: 100, height: 100 };
      stage.gameImgProps.viewPoint.scale = 2;
      stage.setGameViewPointPosition(7, 8);
      expect(stage.gameImgProps.viewPoint.x).to.equal(7);
      expect(stage.gameImgProps.viewPoint.y).to.equal(8);
    });

    stage.clampViewPoint(null);
    stage.clampViewPoint({ display: null });
  });

  it('updates stage size with and without RAF', function() {
    const { canvas } = makeCanvas(320, 200);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);

    let updates = 0;
    const originalUpdate = stage.updateStageSize.bind(stage);
    stage.updateStageSize = () => { updates += 1; };

    globalThis.window.requestAnimationFrame = null;
    stage.scheduleUpdateStageSize();
    expect(updates).to.equal(1);

    globalThis.window.requestAnimationFrame = (cb) => { cb(); return 1; };
    stage.scheduleUpdateStageSize();
    expect(updates).to.equal(2);

    stage._resizeRaf = 123;
    stage.scheduleUpdateStageSize();
    expect(updates).to.equal(2);
    stage._resizeRaf = 0;

    stage.updateStageSize = originalUpdate;
    stage.setGuiEnabled(false);
    expect(stage.guiImgProps.width).to.equal(0);
    expect(stage.guiImgProps.height).to.equal(0);
  });

  it('normalizes invalid HUD scale and view offsets', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);

    stage.stageCav.width = 0;
    stage.stageCav.height = 0;
    stage.gameImgProps.viewPoint.scale = 0;
    stage.gameImgProps.viewPoint.x = Number.NaN;
    stage.gameImgProps.viewPoint.y = Number.NaN;

    stage.updateStageSize();
    expect(stage.guiImgProps.viewPoint.scale).to.equal(1);
  });

  it('draws with negative view offsets', function() {
    const { canvas, ctx } = makeCanvas(100, 80);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(20, 10);
    stage.gameImgProps.viewPoint.x = -2;
    stage.gameImgProps.viewPoint.y = -1;
    stage.gameImgProps.viewPoint.scale = 1;
    stage.gameImgProps.canvasViewportSize = { width: 10, height: 10 };
    stage.gameImgProps.width = 10;
    stage.gameImgProps.height = 10;

    const drawCount = ctx.drawCalls.length;
    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(ctx.drawCalls.length).to.equal(drawCount + 1);
  });

  it('updates the view point for pan and zoom', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);

    let last = null;
    stage.applyViewport = (stageImage, x, y, scale) => {
      last = { x, y, scale };
    };
    stage.clear = () => {};
    stage.draw = () => {};

    stage.gameImgProps.viewPoint.scale = 1;
    stage.gameImgProps.viewPoint.x = 2;
    stage.gameImgProps.viewPoint.y = 3;
    stage.updateViewPoint(stage.gameImgProps, 10, 10, 100, true);
    expect(last.x).to.equal(2);
    expect(last.y).to.equal(3);

    const expectedScale = stage.snapScale(1 + 100 * 0.001125);
    expect(last.scale).to.equal(expectedScale);

    last = null;
    stage.updateViewPoint(stage.gameImgProps, 10, 10, 100);
    expect(last.x).to.not.equal(2);
    expect(last.y).to.not.equal(3);

    stage.gameImgProps.viewPoint.scale = 2;
    stage.gameImgProps.viewPoint.x = 0;
    stage.gameImgProps.viewPoint.y = 0;
    stage.updateViewPoint(stage.gameImgProps, 10, -6, 0);
    expect(last.x).to.equal(5);
    expect(last.y).to.equal(-3);
  });

  it('covers updateViewPoint defaults and snapScale clamps', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);

    stage.updateViewPoint(null, 0, 0, 0);
    stage.applyViewport(null, 0, 0, 1);

    stage.clear = () => {};
    stage.draw = () => {};

    stage.gameImgProps.viewPoint.scale = 0;
    stage.updateViewPoint(stage.gameImgProps, 0, 0, 0);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(stage.snapScale(1));

    expect(stage.snapScale(0.1)).to.be.at.least(0.25);
    expect(stage.snapScale(20)).to.be.at.most(8);
  });

  it('falls back to default raw scale when viewPoint is falsy', function() {
    const originalDescriptor = Object.getOwnPropertyDescriptor(ViewPoint.prototype, 'scale');
    const originalUpdate = Stage.prototype.updateStageSize;
    const originalClear = Stage.prototype.clear;
    Object.defineProperty(ViewPoint.prototype, 'scale', {
      configurable: true,
      get() { return this._scale ?? 0; },
      set() { this._scale = 0; }
    });
    Stage.prototype.updateStageSize = () => {};
    Stage.prototype.clear = () => {};
    try {
      const { canvas } = makeCanvas(200, 100);
      const stage = new Stage(canvas);
      expect(stage._rawScale).to.equal(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(ViewPoint.prototype, 'scale', originalDescriptor);
      } else {
        delete ViewPoint.prototype.scale;
      }
      Stage.prototype.updateStageSize = originalUpdate;
      Stage.prototype.clear = originalClear;
    }
  });

  it('recenters scale changes and redraws both layers', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();
    stage.gameImgProps.viewPoint.scale = 1;

    let draws = 0;
    let clears = 0;
    let cursors = 0;
    stage.draw = () => { draws += 1; };
    stage.clear = () => { clears += 1; };
    stage.drawCursor = () => { cursors += 1; };

    stage.setGameViewPointPosition(10, 10);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(stage.snapScale(2));

    draws = 0;
    clears = 0;
    cursors = 0;
    stage.redraw();
    expect(draws).to.equal(2);
    expect(clears).to.equal(1);
    expect(cursors).to.equal(1);
  });

  it('returns gui image hits and null misses', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();

    const guiX = stage.guiImgProps.x + 1;
    const guiY = stage.guiImgProps.y + 1;
    expect(stage.getStageImageAt(guiX, guiY)).to.equal(stage.guiImgProps);
    expect(stage.getStageImageAt(1000, 1000)).to.equal(null);
  });

  it('returns cached displays when available', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    const gameDisplay = stage.getGameDisplay();
    const guiDisplay = stage.getGuiDisplay();
    expect(stage.getGameDisplay()).to.equal(gameDisplay);
    expect(stage.getGuiDisplay()).to.equal(guiDisplay);
  });

  it('uses default overlay rect and reports game view rect', function() {
    const { canvas, ctx } = makeCanvas(120, 90);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(60, 30);
    stage.guiImgProps.display.initSize(60, 10);
    stage.updateStageSize();

    stage.overlayAlpha = 0.5;
    stage.overlayColor = 'rgba(10,20,30,0.5)';
    stage.overlayRect = null;
    stage.overlayDashLen = 0;
    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(ctx.fillCalls.length).to.be.greaterThan(0);

    stage.gameImgProps.viewPoint.scale = 2;
    stage.gameImgProps.canvasViewportSize = { width: 40, height: 20 };
    const rect = stage.getGameViewRect();
    expect(rect.w).to.equal(20);
    expect(rect.h).to.equal(10);
  });

  it('resets overlays and disposes stage resources', function() {
    const { canvas } = makeCanvas(120, 90);
    const stage = new Stage(canvas);

    stage.overlayAlpha = 1;
    stage.overlayRect = { x: 1, y: 2, width: 3, height: 4 };
    stage.overlayDashLen = 2;
    stage.overlayTimer = 1;
    stage.resetOverlayFade();
    expect(stage.overlayAlpha).to.equal(0);
    expect(stage.overlayRect).to.equal(null);
    expect(stage.overlayDashLen).to.equal(0);
    expect(stage.overlayTimer).to.equal(0);

    let cancelled = 0;
    globalThis.window.cancelAnimationFrame = () => { cancelled += 1; };
    const gameDisplay = { called: 0, dispose() { this.called += 1; } };
    const guiDisplay = { called: 0, dispose() { this.called += 1; } };
    const controller = { called: 0, dispose() { this.called += 1; } };
    stage.gameImgProps.display = gameDisplay;
    stage.guiImgProps.display = guiDisplay;
    stage.controller = controller;
    stage._resizeRaf = 123;

    stage.dispose();

    expect(cancelled).to.equal(1);
    expect(gameDisplay.called).to.equal(1);
    expect(guiDisplay.called).to.equal(1);
    expect(controller.called).to.equal(1);
    expect(stage.gameImgProps).to.equal(null);
    expect(stage.guiImgProps).to.equal(null);
    expect(stage.stageCav).to.equal(null);
  });
});
