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
    getImageData(w, h, a, b) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
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

describe('Stage overlay marching ants', function() {
  before(function() {
    global.document = createDocumentStub();
    globalThis.lemmings = { game: { showDebug: false } };
  });

  after(function() {
    delete global.document;
    delete globalThis.lemmings;
  });

  it('startOverlayFade stores dash settings', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(4,4);
    const rect = { x: 1, y: 1, width: 2, height: 2 };
    stage.startOverlayFade('rgba(255,0,0,0.5)', rect, 5);
    expect(stage.overlayDashLen).to.equal(5);
    expect(stage.overlayRect).to.deep.equal(rect);
    expect(stage.overlayDashColor).to.be.a('number');
    stage.resetOverlayFade();
  });

  it('draw calls drawMarchingAntRect when active', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.gameImgProps.display.initSize(4,4);
    stage.guiImgProps.display.initSize(4,4);
    let called = 0;
    const orig = Lemmings.drawMarchingAntRect;
    Lemmings.drawMarchingAntRect = function() { called++; };
    stage.startOverlayFade('rgba(255,0,0,1)', { x: 0, y: 0, width: 2, height: 2 }, 3);
    stage.redraw();
    Lemmings.drawMarchingAntRect = orig;
    expect(called).to.be.greaterThan(0);
    stage.resetOverlayFade();
  });
});
