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
});
