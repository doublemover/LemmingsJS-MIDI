import { expect } from 'chai';
import { Stage } from '../../js/render/Stage.js';
import { setDependency, resetDependencies } from '../helpers/lemmings.js';

const makeContext = () => {
  const ctx = {
    canvas: null,
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: '',
    putCalls: [],
    drawCalls: [],
    fillCalls: [],
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
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalLemmings = globalThis.lemmings;

  let intervalCbs = [];

  beforeEach(function() {
    intervalCbs = [];
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
    globalThis.setInterval = (cb) => {
      intervalCbs.push(cb);
      return intervalCbs.length;
    };
    globalThis.clearInterval = () => {};
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.ImageData = originalImageData;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.lemmings = originalLemmings;
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

    stage.startFadeOut();
    for (let i = 0; i < 60; i++) intervalCbs[0]();
    expect(stage.fadeAlpha).to.equal(1);

    let antsCalled = 0;
    setDependency('drawMarchingAntRect', () => { antsCalled += 1; });

    stage.startOverlayFade('rgba(1,2,3,0.5)', { x: 0, y: 0, width: 4, height: 4 }, 2);
    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(antsCalled).to.equal(1);

    for (let i = 0; i < 60; i++) intervalCbs[1]();
    expect(stage.overlayAlpha).to.equal(0);
    expect(stage.overlayRect).to.equal(null);
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

    globalThis.lemmings = { scale: 3 };
    stage.applyViewport = originalApply;
    stage.setGameViewPointPosition(2, 3);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(stage.snapScale(3));

    globalThis.lemmings = { scale: 0 };
    stage.gameImgProps.display.worldDataSize = { width: 200, height: 100 };
    stage.gameImgProps.canvasViewportSize = { width: 100, height: 100 };
    stage.gameImgProps.viewPoint.scale = 2;
    stage.setGameViewPointPosition(7, 8);
    expect(stage.gameImgProps.viewPoint.x).to.equal(7);
    expect(stage.gameImgProps.viewPoint.y).to.equal(8);
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

    stage.updateStageSize = originalUpdate;
    stage.setGuiEnabled(false);
    expect(stage.guiImgProps.width).to.equal(0);
    expect(stage.guiImgProps.height).to.equal(0);
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

    stage.gameImgProps.viewPoint.scale = 2;
    stage.gameImgProps.viewPoint.x = 0;
    stage.gameImgProps.viewPoint.y = 0;
    stage.updateViewPoint(stage.gameImgProps, 10, -6, 0);
    expect(last.x).to.equal(5);
    expect(last.y).to.equal(-3);
  });
});
