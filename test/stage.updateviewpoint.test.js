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

describe('Stage updateViewPoint', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
  });

  it('centers horizontally and bottom aligns when zoomed out', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 1200);

    const scale = 0.5;
    stage.gameImgProps.viewPoint.scale = scale;
    stage.gameImgProps.viewPoint.x = 10;
    stage.gameImgProps.viewPoint.y = 20;

    stage.updateViewPoint(stage.gameImgProps, 0, 0, 0);

    const wDiff = stage.gameImgProps.width - display.getWidth() * scale;
    const expectedX = -wDiff / (2 * scale);
    const expectedY = stage.gameImgProps.height - display.getHeight() / scale;

    expect(stage.gameImgProps.viewPoint.x).to.equal(expectedX);
    expect(stage.gameImgProps.viewPoint.y).to.equal(expectedY);
  });
});
