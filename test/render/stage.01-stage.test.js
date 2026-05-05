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

  it('handles missing cursor canvas APIs safely', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    const originalDocument = globalThis.document;
    globalThis.document = undefined;
    expect(() => stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    })).to.not.throw();
    expect(stage.cursorCanvas).to.equal(null);
    globalThis.document = originalDocument;
  });

  it('keeps cursor rendered when static and redraws when it moves', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    let clearCalls = 0;
    let drawCalls = 0;
    let cursorCalls = 0;
    const originalClear = stage.clear;
    const originalDraw = stage.draw;
    const originalDrawCursor = stage.drawCursor;
    stage.clear = (...args) => {
      clearCalls += 1;
      return originalClear.call(stage, ...args);
    };
    stage.draw = (...args) => {
      drawCalls += 1;
      return originalDraw.call(stage, ...args);
    };
    stage.drawCursor = () => {
      cursorCalls += 1;
      return originalDrawCursor.call(stage);
    };

    stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    });
    stage.cursorX = 5;
    stage.cursorY = 5;
    stage.redraw();
    expect(clearCalls).to.be.greaterThan(0);
    expect(cursorCalls).to.equal(1);

    const fullClearCalls = clearCalls;
    stage.redraw();
    expect(cursorCalls).to.equal(1);
    expect(clearCalls).to.equal(fullClearCalls);

    stage.cursorX = 8;
    stage.cursorY = 8;
    stage.redraw();
    expect(cursorCalls).to.equal(2);
    expect(clearCalls).to.be.greaterThan(fullClearCalls);
    expect(drawCalls).to.be.at.least(0);
  });

  it('forces redraw when cursor sprite changes at a fixed position', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    let clearCalls = 0;
    const originalClear = stage.clear;
    stage.clear = (...args) => {
      clearCalls += 1;
      return originalClear.call(stage, ...args);
    };

    stage.cursorX = 5;
    stage.cursorY = 5;
    stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    });
    stage.redraw();
    const baselineClearCalls = clearCalls;

    stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    });
    stage.redraw();
    expect(clearCalls).to.be.greaterThan(baselineClearCalls);
  });

  it('forces a redraw when cursor visibility toggles without setter', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    let clearCalls = 0;
    const originalClear = stage.clear;
    stage.clear = (...args) => {
      clearCalls += 1;
      return originalClear.call(stage, ...args);
    };

    stage.setCursorSprite({
      width: 4,
      height: 4,
      getData() { return new Uint8ClampedArray(4 * 4 * 4); }
    });
    stage.redraw();
    const baselineClearCalls = clearCalls;

    stage.cursorCanvas = null;
    stage.redraw();
    expect(clearCalls).to.be.greaterThan(baselineClearCalls);
  });

  it('forces a redraw when overlay visibility toggles without dirtying overlay planes', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    let clearCalls = 0;
    const originalClear = stage.clear;
    stage.clear = (...args) => {
      clearCalls += 1;
      return originalClear.call(stage, ...args);
    };

    const overlayDisplay = stage.getGameOverlayDisplay();
    overlayDisplay.clear(0x00000000);
    overlayDisplay.drawMarchingAntRect(1, 1, 6, 6, 2, 0);
    stage.setGameOverlayVisible(true);
    stage.redraw();
    const baselineClearCalls = clearCalls;

    stage.setGameOverlayVisible(false);
    stage.redraw();

    expect(stage.gameOverlayImgProps.display).to.equal(overlayDisplay);
    expect(clearCalls).to.be.greaterThan(baselineClearCalls);
  });

  it('recycles consumed dirty-rect buffers after drawing', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const consumed = [{ x: 1, y: 2, width: 3, height: 4 }];
    let released = null;
    stage.gameImgProps.display.consumeDirtyRects = () => consumed;
    stage.gameImgProps.display.releaseConsumedDirtyRects = (rects) => { released = rects; };

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());
    expect(released).to.equal(consumed);
  });

  it('keeps dirty-rect descriptors stable during draw blits', function() {
    const { canvas } = makeCanvas(200, 100);
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(40, 20);
    stage.updateStageSize();

    const consumed = [
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 8, y: 6, width: 5, height: 2 }
    ];
    const references = consumed.slice();
    const before = consumed.map((rect) => ({ ...rect }));
    stage.gameImgProps.display.consumeDirtyTiles = () => undefined;
    stage.gameImgProps.display.consumeDirtyRects = () => consumed;
    stage.gameImgProps.display.releaseConsumedDirtyRects = () => {};

    stage.draw(stage.gameImgProps, stage.gameImgProps.display.getImageData());

    expect(consumed).to.deep.equal(before);
    expect(consumed[0]).to.equal(references[0]);
    expect(consumed[1]).to.equal(references[1]);
  });
});
