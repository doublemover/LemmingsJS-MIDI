import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';

function createStubCanvas(width = 50, height = 50) {
  const ctx = {
    canvas: { width, height },
    fillRect() {},
    drawImage() {},
    putImageData() {},
    getImageData() { return { width, height, data: new Uint8ClampedArray(width*height*4) }; }
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
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        getImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
      };
      return { width: 0, height: 0, getContext() { ctx.canvas = this; return ctx; } };
    }
  };
}

globalThis.lemmings = { game: { showDebug: false } };

describe('Stage draw routines', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
  });

  it('draw applies fade and default overlay rectangle', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};

    const ctx = canvas.getContext();
    const rectCalls = [];
    ctx.fillRect = (x, y, w, h) => { rectCalls.push({ x, y, w, h }); };

    const disp = stage.getGameDisplay();
    disp.initSize(4, 4);
    Object.assign(stage.gameImgProps, { width: 4, height: 4, x: 0, y: 0 });
    stage.gameImgProps.viewPoint.scale = 1;

    stage.fadeAlpha = 0.5;
    stage.overlayAlpha = 0.25;

    const img = disp.getImageData();
    stage.draw(stage.gameImgProps, img);

    expect(rectCalls).to.deep.equal([
      { x: 0, y: 0, w: 4, h: 4 },
      { x: 0, y: 0, w: 4, h: 4 }
    ]);
  });

  it('drawCursor does nothing without a sprite', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    let called = false;
    canvas.getContext().drawImage = () => { called = true; };
    stage.drawCursor();
    expect(called).to.equal(false);
  });
});
