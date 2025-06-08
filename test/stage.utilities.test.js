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

describe('Stage utilities', function() {
  let clock;
  let stage;

  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
  });

  beforeEach(function() {
    if (!globalThis.Date.isFake) {
      clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    }
  });

  afterEach(function() {
    if (stage) stage.resetFade();
    stage = null;
    if (clock && globalThis.Date.isFake) {
      clock.uninstall();
      clock = null;
    }
  });

  it('snapScale clamps and snaps to gcd step', function() {
    const canvas = createStubCanvas();
    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(20, 50);

    expect(stage.snapScale(1.37)).to.be.closeTo(1.4, 0.0001);
    expect(stage.snapScale(0.1)).to.be.closeTo(0.3, 0.0001);
    expect(stage.snapScale(10)).to.equal(8);
  });

  it('limitValue confines numbers to range', function() {
    const canvas = createStubCanvas();
    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    expect(stage.limitValue(0, 5, 10)).to.equal(5);
    expect(stage.limitValue(0, -5, 10)).to.equal(0);
    expect(stage.limitValue(0, 15, 10)).to.equal(10);
  });

  it('getGameViewRect reports world viewport', function() {
    const canvas = createStubCanvas();
    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    stage.gameImgProps.width = 400;
    stage.gameImgProps.height = 120;
    stage.gameImgProps.viewPoint.scale = 2;
    stage.gameImgProps.viewPoint.x = 7;
    stage.gameImgProps.viewPoint.y = 11;

    const rect = stage.getGameViewRect();
    expect(rect).to.deep.equal({ x: 7, y: 11, w: 200, h: 60 });
  });

  it('drawCursor centers sprite at cursor position', function() {
    const canvas = createStubCanvas();
    const ctx = canvas.getContext();
    let args = null;
    ctx.drawImage = (img, x, y) => { args = { img, x, y }; };

    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    stage.cursorCanvas = { width: 5, height: 7 };
    stage.cursorX = 10;
    stage.cursorY = 20;
    stage.drawCursor();

    expect(args.img).to.equal(stage.cursorCanvas);
    expect(args.x).to.equal(7);
    expect(args.y).to.equal(16);
  });

  it('startFadeOut schedules timer and fades to 1', function() {
    const canvas = createStubCanvas();
    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    stage.startFadeOut();
    expect(stage.fadeTimer).to.not.equal(0);
    expect(stage.fadeAlpha).to.equal(0);

    clock.tick(200);
    expect(stage.fadeAlpha).to.be.above(0);

    clock.tick(2000);
    expect(stage.fadeAlpha).to.equal(1);
    expect(stage.fadeTimer).to.equal(0);
  });

  it('startOverlayFade schedules timer and clears rect', function() {
    const canvas = createStubCanvas();
    stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const rect = { x: 1, y: 2, width: 3, height: 4 };
    stage.startOverlayFade('green', rect);
    expect(stage.overlayTimer).to.not.equal(0);
    expect(stage.overlayAlpha).to.equal(1);
    expect(stage.overlayColor).to.equal('green');
    expect(stage.overlayRect).to.equal(rect);

    clock.tick(200);
    expect(stage.overlayAlpha).to.be.below(1);

    clock.tick(2000);
    expect(stage.overlayAlpha).to.equal(0);
    expect(stage.overlayTimer).to.equal(0);
    expect(stage.overlayRect).to.equal(null);
  });
});
