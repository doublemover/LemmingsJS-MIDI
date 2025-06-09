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
    fillStyle: '',
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

describe('Stage lifecycle helpers', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
  });

  it('createImage delegates based on display owner', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    let gameCalled = 0;
    let guiCalled = 0;
    stage.gameImgProps.createImage = () => { gameCalled++; return {}; };
    stage.guiImgProps.createImage = () => { guiCalled++; return {}; };

    stage.createImage(stage.getGameDisplay(), 4, 5);
    stage.createImage(stage.getGuiDisplay(), 6, 7);

    expect(gameCalled).to.equal(1);
    expect(guiCalled).to.equal(1);
  });

  it('redraw clears and draws both displays then draws cursor', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    const calls = [];
    stage.clear = img => { calls.push(['clear', img]); };
    stage.draw = img => { calls.push(['draw', img]); };
    stage.drawCursor = () => { calls.push(['cursor']); };

    stage.getGameDisplay().initSize(2, 2);
    stage.getGuiDisplay().initSize(2, 2);

    stage.redraw();

    expect(calls).to.deep.equal([
      ['clear', stage.gameImgProps],
      ['draw', stage.gameImgProps],
      ['clear', stage.guiImgProps],
      ['draw', stage.guiImgProps],
      ['cursor']
    ]);
  });

  it('clear fills entire canvas when stageImage is omitted', function() {
    const canvas = createStubCanvas(40, 30);
    const ctx = canvas.getContext();
    const rects = [];
    ctx.fillRect = (x, y, w, h) => { rects.push({ x, y, w, h }); };
    const stage = new Stage(canvas);
    stage.clear();

    const last = rects.pop();
    expect(last).to.deep.equal({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('clear fills provided stage region', function() {
    const canvas = createStubCanvas();
    const ctx = canvas.getContext();
    const rects = [];
    ctx.fillRect = (x, y, w, h) => { rects.push({ x, y, w, h }); };
    const stage = new Stage(canvas);
    Object.assign(stage.gameImgProps, { x: 5, y: 6, width: 10, height: 15 });
    stage.clear(stage.gameImgProps);

    const last = rects.pop();
    expect(last).to.deep.equal({ x: 5, y: 6, w: 10, h: 15 });
  });

  it('dispose tears down displays and controller', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    const gDisp = { disposeCalled: 0, dispose() { this.disposeCalled++; } };
    const guiDisp = { disposeCalled: 0, dispose() { this.disposeCalled++; } };
    const ctrl = { disposeCalled: 0, dispose() { this.disposeCalled++; } };
    stage.gameImgProps.display = gDisp;
    stage.guiImgProps.display = guiDisp;
    stage.controller = ctrl;
    stage.dispose();

    expect(gDisp.disposeCalled).to.equal(1);
    expect(guiDisp.disposeCalled).to.equal(1);
    expect(ctrl.disposeCalled).to.equal(1);
    expect(stage.gameImgProps).to.equal(null);
    expect(stage.guiImgProps).to.equal(null);
    expect(stage.controller).to.equal(null);
    expect(stage.stageCav).to.equal(null);
  });
});
