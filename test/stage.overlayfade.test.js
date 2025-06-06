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
  const ctx = {
    canvas: { width, height },
    fillRect() {},
    drawImage() {},
    putImageData() {}
  };
  return {
    width,
    height,
    getContext() { return ctx; },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createDocumentStub() {
  return {
    createElement() {
      const ctx = {
        canvas: {},
        fillRect() {},
        drawImage() {},
        putImageData() {},
        createImageData(w, h) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        }
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

describe('Stage overlay fade', function() {
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

  it('fades overlayAlpha to 0', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    stage.overlayAlpha = 1;
    stage.startOverlayFade('black');
    clock.tick(2000);

    expect(stage.overlayAlpha).to.equal(0);
    expect(stage.overlayTimer).to.equal(0);
  });

  it('uses provided rectangle for overlay color', function() {
    const rectCalls = [];
    const canvas = createStubCanvas();
    canvas.getContext().fillRect = (x, y, w, h) => { rectCalls.push({ x, y, w, h }); };
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.guiImgProps.display.initSize(10, 10);

    const rect = { x: 5, y: 6, width: 7, height: 8 };
    stage.startOverlayFade('red', rect);
    stage.overlayAlpha = 1;
    stage.draw(stage.guiImgProps, stage.guiImgProps.display.getImageData());

    const match = rectCalls.some(r => r.x === rect.x && r.y === rect.y && r.w === rect.width && r.h === rect.height);
    expect(match).to.equal(true);
  });

  it('retains overlayRect until fade completes', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};

    const rect = { x: 1, y: 2, width: 3, height: 4 };
    stage.startOverlayFade('blue', rect);

    clock.tick(500);
    expect(stage.overlayRect).to.equal(rect);

    clock.tick(1500); // finish fade
    expect(stage.overlayTimer).to.equal(0);
    expect(stage.overlayRect).to.equal(null);
  });
});
