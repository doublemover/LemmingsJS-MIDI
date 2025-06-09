import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import fakeTimers from '@sinonjs/fake-timers';

function createStubCanvas(width = 800, height = 600) {
  const fillCalls = [];
  const drawCalls = [];
  const putCalls = [];
  const getCalls = [];
  const ctx = {
    canvas: { width, height },
    fillStyle: '',
    drawImage: (...args) => { drawCalls.push(args); },
    fillRect: (...args) => { fillCalls.push(args); },
    putImageData: (...args) => { putCalls.push(args); },
    getImageData: (x, y, w, h) => {
      getCalls.push([x, y, w, h]);
      return { width: w, height: h, data: new Uint8ClampedArray((w + 1) * (h + 1) * 4) };
    }
  };
  const canvas = {
    width,
    height,
    getContext() { return ctx; },
    addEventListener() {},
    removeEventListener() {}
  };
  canvas.calls = { fillCalls, drawCalls, putCalls, getCalls };
  return canvas;
}

function createDocumentStub() {
  return {
    createElement() {
      const ctx = {
        canvas: {},
        fillRect() {},
        drawImage() {},
        putImageData() {},
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
      };
      return {
        width: 0,
        height: 0,
        getContext() { ctx.canvas = this; return ctx; }
      };
    }
  };
}

globalThis.lemmings = { game: { showDebug: false } };

describe('Stage.draw', function() {
  let clock;
  before(function() {
    global.document = createDocumentStub();
  });
  beforeEach(function() {
    clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
  });
  afterEach(function() {
    clock.uninstall();
  });

  it('draws fade overlay when fadeAlpha is set', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    stage.fadeAlpha = 0.5;
    stage.overlayAlpha = 0;
    stage.draw(stage.guiImgProps, display.getImageData());

    expect(canvas.calls.fillCalls.length).to.equal(1);
    expect(canvas.calls.getCalls.length).to.equal(0);
  });

  it('draws overlay without dashes', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    stage.overlayAlpha = 0.5;
    stage.overlayColor = 'red';
    stage.overlayRect = { x: 1, y: 2, width: 3, height: 4 };
    stage.overlayDashLen = 0;
    stage.draw(stage.guiImgProps, display.getImageData());

    expect(canvas.calls.fillCalls.length).to.equal(1);
    expect(canvas.calls.getCalls.length).to.equal(0);
  });

  it('draws dashed overlay when overlayDashLen > 0', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    let dashCalls = 0;
    const original = Lemmings.drawMarchingAntRect;
    Lemmings.drawMarchingAntRect = () => { dashCalls++; };

    stage.overlayAlpha = 1;
    stage.overlayColor = 'green';
    stage.overlayRect = { x: 2, y: 3, width: 5, height: 6 };
    stage.overlayDashLen = 2;
    stage.overlayDashOffset = 0;
    stage.overlayDashColor = 0xFFFFFFFF;
    stage.draw(stage.guiImgProps, display.getImageData());

    Lemmings.drawMarchingAntRect = original;

    expect(canvas.calls.fillCalls.length).to.equal(1);
    expect(canvas.calls.getCalls.length).to.equal(1);
    expect(canvas.calls.putCalls.length).to.equal(1);
    expect(dashCalls).to.equal(1);
  });

  it('crops view when viewpoint is negative', function() {
    const canvas = createStubCanvas(10, 10);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    Object.assign(stage.guiImgProps, { width: 10, height: 10, x: 0, y: 0 });
    Object.assign(stage.guiImgProps.viewPoint, { x: -4, y: -3, scale: 1 });

    stage.draw(stage.guiImgProps, display.getImageData());

    const args = canvas.calls.drawCalls[0];
    expect(args[1]).to.equal(0); // sx
    expect(args[2]).to.equal(0); // sy
    expect(args[3]).to.equal(10); // sw
    expect(args[4]).to.equal(10); // sh
    expect(args[5]).to.equal(4);  // dx
    expect(args[6]).to.equal(3);  // dy
    expect(args[7]).to.equal(10); // dw
    expect(args[8]).to.equal(10); // dh
  });

  it('limits destination size when scale exceeds viewport', function() {
    const canvas = createStubCanvas(10, 10);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    Object.assign(stage.guiImgProps, { width: 10, height: 10, x: 0, y: 0 });
    Object.assign(stage.guiImgProps.viewPoint, { x: 0, y: 0, scale: 2 });

    stage.draw(stage.guiImgProps, display.getImageData());

    const args = canvas.calls.drawCalls[0];
    expect(args[1]).to.equal(0);
    expect(args[2]).to.equal(0);
    expect(args[3]).to.equal(5); // sw truncated
    expect(args[4]).to.equal(5); // sh truncated
    expect(args[7]).to.equal(10); // dw clamped
    expect(args[8]).to.equal(10); // dh clamped
  });

  it('fills default overlay rectangle when none provided', function() {
    const canvas = createStubCanvas(10, 10);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    const display = stage.getGuiDisplay();
    display.initSize(10, 10);

    Object.assign(stage.guiImgProps, { width: 10, height: 10, x: 0, y: 0 });

    stage.overlayAlpha = 0.5;
    stage.overlayColor = 'blue';
    stage.overlayRect = null;
    stage.overlayDashLen = 0;

    stage.draw(stage.guiImgProps, display.getImageData());

    const rect = canvas.calls.fillCalls[0];
    expect(rect).to.deep.equal([0, 0, 10, 10]);
  });
});
