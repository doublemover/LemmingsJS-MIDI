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

describe('Stage.updateStageSize', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  it('centers GUI panel after canvas resize', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);

    canvas.width = 800;
    canvas.getContext().canvas.width = 800;
    stage.updateStageSize();

    const guiW = display.getWidth();
    const panelH = display.getHeight();
    expect(stage.guiImgProps.x).to.equal(200);
    expect(stage.guiImgProps.y).to.equal(540);
    expect(stage.gameImgProps.height).to.equal(560);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.width).to.equal(guiW);
  });

  it('keeps panel at bottom for different zoom levels', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);

    stage.guiImgProps.viewPoint.scale = 3;
    stage.updateStageSize();

    const panelH = display.getHeight();
    expect(stage.guiImgProps.y).to.equal(540);
    expect(stage.gameImgProps.height).to.equal(560);
  });
});
