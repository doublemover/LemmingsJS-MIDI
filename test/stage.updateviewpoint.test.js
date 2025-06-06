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

  it('clamps the view when zoomed out', function() {
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

    expect(stage.gameImgProps.viewPoint.x).to.equal(0);
    expect(stage.gameImgProps.viewPoint.y).to.equal(20);
  });

  it('keeps cursor position stable while zooming', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 1200);

    stage.gameImgProps.viewPoint.scale = 1;
    stage.gameImgProps.viewPoint.x = 100;
    stage.gameImgProps.viewPoint.y = 50;

    const cursorX = 200;
    const cursorY = 100;
    const img = stage.gameImgProps;
    const vp = img.viewPoint;

    const beforeX = vp.getSceneX(cursorX - img.x);
    const beforeY = vp.getSceneY(cursorY - img.y);

    stage.updateViewPoint(img, cursorX, cursorY, 240);

    const afterX = vp.getSceneX(cursorX - img.x);
    const afterY = vp.getSceneY(cursorY - img.y);

    expect(Math.abs(afterX - beforeX)).to.be.at.most(1);
    expect(Math.abs(afterY - beforeY)).to.be.at.most(1);

    const worldW = display.getWidth();
    const worldH = display.getHeight();
    const viewW = img.width / vp.scale;
    const viewH = img.height / vp.scale;

    expect(vp.x).to.be.at.least(Math.min(0, worldW - viewW));
    expect(vp.x).to.be.at.most(Math.max(0, worldW - viewW));
    expect(vp.y).to.be.at.least(Math.min(0, worldH - viewH));
    expect(vp.y).to.be.at.most(Math.max(0, worldH - viewH));
  });
});
