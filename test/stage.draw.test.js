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
});
