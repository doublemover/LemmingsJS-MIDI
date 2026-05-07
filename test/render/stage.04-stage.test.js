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

  it('recenters scale changes and skips no-op redraw unless forced', function() {
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
    expect(draws).to.equal(0);
    expect(clears).to.equal(0);
    expect(cursors).to.equal(0);

    stage.redraw(true);
    expect(draws).to.equal(2);
    expect(clears).to.equal(1);
    expect(cursors).to.equal(0);
  });

  it('avoids redundant pre-clear when setting game view point', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();
    let clears = 0;
    stage.clear = () => { clears += 1; };
    stage.redraw = () => {};

    stage.setGameViewPointPosition(10, 10);

    expect(clears).to.equal(0);
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

  it('disposes safely when window is unavailable', function() {
    const { canvas } = makeCanvas(120, 90);
    const stage = new Stage(canvas);
    stage._resizeRaf = 123;
    const originalWindow = globalThis.window;
    globalThis.window = undefined;
    try {
      expect(() => stage.dispose()).to.not.throw();
      expect(stage.stageCav).to.equal(null);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
