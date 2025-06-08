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
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    canvas.width = 800;
    canvas.getContext().canvas.width = 800;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const guiW = display.worldDataSize.width * scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.guiImgProps.viewPoint.scale).to.equal(4);
    expect(stage.guiImgProps.x).to.equal((canvas.width - stage.guiImgProps.width) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
    expect(stage.gameImgProps.height).to.equal(420);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.width).to.equal(guiW);
    const viewH = stage.gameImgProps.height / stage.gameImgProps.viewPoint.scale;
    const worldH = gameDisplay.worldDataSize.height;
    expect(stage.gameImgProps.viewPoint.y).to.equal(worldH - viewH);
  });

  it('keeps panel at bottom for different zoom levels', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    stage.guiImgProps.viewPoint.scale = 3;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.guiImgProps.viewPoint.scale).to.equal(4);
    expect(stage.guiImgProps.x).to.equal((canvas.width - stage.guiImgProps.width) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
    expect(stage.gameImgProps.height).to.equal(420);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.width).to.equal(display.worldDataSize.width * scale);
    const viewH = stage.gameImgProps.height / stage.gameImgProps.viewPoint.scale;
    const worldH = gameDisplay.worldDataSize.height;
    expect(stage.gameImgProps.viewPoint.y).to.equal(worldH - viewH);
  });

  it('updates dimensions when canvas size changes', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    canvas.width = 500;
    canvas.height = 700;
    const ctx = canvas.getContext();
    ctx.canvas.width = 500;
    ctx.canvas.height = 700;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const panelW = display.worldDataSize.width * scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.gameImgProps.width).to.equal(canvas.width);
    expect(stage.gameImgProps.height).to.equal(canvas.height - panelH - 20);
    expect(stage.guiImgProps.width).to.equal(panelW);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.x).to.equal((canvas.width - panelW) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
  });
});
