import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';

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

describe('Stage utils', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
    delete globalThis.lemmings;
  });

  it('snapScale rounds to multiples of 1/gcd(width,height)', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(150, 100); // gcd=50 -> step=0.02

    const snapped = stage.snapScale(0.733);
    expect(snapped).to.equal(0.74);
  });

  it('limitValue clamps within bounds', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    expect(stage.limitValue(0, -5, 10)).to.equal(0);
    expect(stage.limitValue(0, 5, 10)).to.equal(5);

    expect(stage.limitValue(0, 15, 10)).to.equal(10);
  });

  it('clampViewPoint centers or clamps within world', function() {
    const canvas = createStubCanvas(100,100);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    const disp = stage.getGameDisplay();
    disp.initSize(50,40);
    stage.gameImgProps.canvasViewportSize = { width:100, height:100 };
    stage.gameImgProps.viewPoint.scale = 2;
    stage.gameImgProps.viewPoint.x = -10;
    stage.gameImgProps.viewPoint.y = -10;
    stage.clampViewPoint(stage.gameImgProps);
    expect(stage.gameImgProps.viewPoint.x).to.equal(0);
    expect(stage.gameImgProps.viewPoint.y).to.equal(0);

    disp.initSize(200,200);
    stage.gameImgProps.viewPoint.x = 160;
    stage.gameImgProps.viewPoint.y = 190;
    stage.clampViewPoint(stage.gameImgProps);
    expect(stage.gameImgProps.viewPoint.x).to.equal(150);
    expect(stage.gameImgProps.viewPoint.y).to.equal(150);
  });
});
