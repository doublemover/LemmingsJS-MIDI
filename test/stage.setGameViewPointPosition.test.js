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

globalThis.lemmings = { game: { showDebug: false }, scale: 0 };

describe('Stage.setGameViewPointPosition', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
  });

  it('snaps scale and clamps to bottom when level is tall', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.redraw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(20, 1000);

    lemmings.scale = 1.37;
    stage.setGameViewPointPosition(42, 0);

    const expectedScale = stage.snapScale(1.37);
    const expectedY = Math.max(
      0,
      display.getHeight() - stage.gameImgProps.height / expectedScale
    );

    expect(stage.gameImgProps.viewPoint.scale).to.equal(expectedScale);
    expect(stage.gameImgProps.viewPoint.x).to.equal(42);
    expect(stage.gameImgProps.viewPoint.y).to.be.closeTo(expectedY, 0.0001);
  });

  it('clamps Y to 0 when the level is shorter than the viewport', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.redraw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(20, 100);

    lemmings.scale = 1;
    stage.setGameViewPointPosition(10, 0);

    const expectedScale = stage.snapScale(1);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(expectedScale);
    expect(stage.gameImgProps.viewPoint.y).to.equal(0);
  });

  it('defaults to scale 2 when global scale is not set', function() {
    const canvas = createStubCanvas(800, 800);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.redraw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(800, 1200);

    lemmings.scale = 0;
    stage.gameImgProps.viewPoint.scale = 2;
    stage.setGameViewPointPosition(5, 0);

    const expectedScale = stage.snapScale(2);
    expect(stage.gameImgProps.viewPoint.scale).to.equal(expectedScale);
    expect(stage.gameImgProps.viewPoint.y).to.equal(0);
    expect(stage.gameImgProps.viewPoint.x).to.equal(5);
  });
});
