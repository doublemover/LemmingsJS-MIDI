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
    const redrawFlags = [];
    const originalApply = stage.applyViewport;
    stage.applyViewport = (...args) => { applied = args; };
    stage.redraw = (forceComposite = false) => {
      redraws += 1;
      redrawFlags.push(forceComposite);
    };
    stage.setGameViewPointPosition(5, 6, { preserveScale: true });
    expect(applied[3]).to.equal(1.5);
    expect(redraws).to.equal(1);

    stage.applyViewport = originalApply;
    stage.setScaleProvider(() => 3);
    stage.setGameViewPointPosition(2, 3);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(stage.snapScale(3));

    stage._rawScale = NaN;
    stage.setGameViewPointPosition(4, 5, { preserveScale: true });
    expect(stage._rawScale).to.equal(stage.gameImgProps.viewPoint.scale);

    stage._rawScale = NaN;
    stage.gameImgProps.viewPoint.scale = 0;
    stage.setGameViewPointPosition(4, Number.NaN, { preserveScale: true });
    expect(stage._rawScale).to.equal(1);
    expect(Number.isFinite(stage.gameImgProps.viewPoint.x)).to.equal(true);
    expect(stage.gameImgProps.viewPoint.y).to.equal(0);

    stage.setGameViewPointPosition(Number.NaN, Number.NaN, { preserveScale: true });
    expect(Number.isFinite(stage.gameImgProps.viewPoint.x)).to.equal(true);
    expect(Number.isFinite(stage.gameImgProps.viewPoint.y)).to.equal(true);

    withGlobalLemmings({ scale: 4 }, () => {
      stage.setScaleProvider(null);
      stage.gameImgProps.display.worldDataSize = { width: 200, height: 100 };
      stage.gameImgProps.canvasViewportSize = { width: 100, height: 100 };
      stage.gameImgProps.viewPoint.scale = 2;
      stage.setGameViewPointPosition(7, 8);
      expect(stage.gameImgProps.viewPoint.scale).to.equal(2);
      expect(stage.gameImgProps.viewPoint.x).to.equal(7);
      expect(stage.gameImgProps.viewPoint.y).to.equal(8);
    });
    expect(redrawFlags.every((flag) => flag === true)).to.equal(true);

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

  it('skips resize redraw work when dimensions are unchanged and displays are clean', function() {
    const { canvas } = makeCanvas(320, 200);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();

    let clears = 0;
    let draws = 0;
    stage.clear = () => { clears += 1; };
    stage.draw = () => { draws += 1; };

    globalThis.window.requestAnimationFrame = (cb) => { cb(); return 1; };
    stage.scheduleUpdateStageSize();
    expect(clears).to.equal(0);
    expect(draws).to.equal(0);

    stage._resizeRaf = 0;
    stage.gameImgProps.display.markDirtyRect(0, 0, 1, 1);
    stage.scheduleUpdateStageSize();
    expect(clears).to.be.greaterThan(0);
    expect(draws).to.be.greaterThan(0);
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

  it('returns early when draw image payload is invalid', function() {
    const { canvas, ctx } = makeCanvas(100, 80);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(20, 10);
    stage.gameImgProps.canvasViewportSize = { width: 10, height: 10 };
    stage.gameImgProps.width = 10;
    stage.gameImgProps.height = 10;

    const drawCount = ctx.drawCalls.length;
    expect(() => stage.draw(stage.gameImgProps, null)).to.not.throw();
    expect(() => stage.draw(stage.gameImgProps, { width: 0, height: 10 })).to.not.throw();
    expect(ctx.drawCalls.length).to.equal(drawCount);
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

  it('updates view point safely when GUI display is disabled', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();
    const cleared = [];
    const drawn = [];
    stage.clear = (image) => {
      cleared.push(image === stage.guiImgProps ? 'gui' : 'game');
    };
    stage.draw = (image) => {
      drawn.push(image === stage.guiImgProps ? 'gui' : 'game');
    };
    let guiReads = 0;
    stage.guiImgProps.display.getImageData = () => {
      guiReads += 1;
      return null;
    };
    stage.setGuiEnabled(false);

    expect(() => stage.updateViewPoint(stage.gameImgProps, 10, 10, 50)).to.not.throw();
    expect(guiReads).to.equal(0);
    expect(cleared.length).to.be.at.least(1);
    expect(cleared.every((name) => name === 'game')).to.equal(true);
    expect(drawn.length).to.be.at.least(1);
    expect(drawn.every((name) => name === 'game')).to.equal(true);
  });

  it('keeps GUI display clean when panning the game viewport', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display.initSize(80, 20);
    stage.updateStageSize();
    const cleared = [];
    const drawn = [];
    stage.clear = (image) => {
      cleared.push(image === stage.guiImgProps ? 'gui' : 'game');
    };
    stage.draw = (image) => {
      drawn.push(image === stage.guiImgProps ? 'gui' : 'game');
    };
    let guiReads = 0;
    stage.guiImgProps.display.getImageData = () => {
      guiReads += 1;
      return null;
    };

    stage.updateViewPoint(stage.gameImgProps, 12, -8, 0);

    expect(cleared).to.deep.equal(['game']);
    expect(drawn).to.deep.equal(['game']);
    expect(guiReads).to.equal(0);
  });

  it('updates view point when GUI display lacks getImageData', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(100, 50);
    stage.guiImgProps.display = {};
    stage.clear = () => {};
    stage.draw = () => {};

    expect(() => stage.updateViewPoint(stage.gameImgProps, 12, 8, 0)).to.not.throw();
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
});
