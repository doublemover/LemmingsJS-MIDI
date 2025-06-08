import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import { UserInputManager } from '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';

// minimal element stub shared across tests
const element = {
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 480 };
  }
};

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

describe('UserInputManager', function() {
  it('emits zoom events with cursor position', function(done) {
    const uim = new UserInputManager(element);
    let count = 0;
    uim.onZoom.on(e => {
      try {
        expect(e.x).to.equal(100);
        expect(e.y).to.equal(50);
        expect(e.deltaZoom).to.equal(120);
        count += 1;
        if (count === 1) done();
        else done(new Error('zoom triggered more than once'));
      } catch (err) {
        done(err);
      }
    });
    const pos = new Lemmings.Position2D(100, 50);
    uim.handleWheel(pos, 120);
  });

  before(function() {
    global.document = createDocumentStub();
  });

  beforeEach(function() {
    global.winW = 1600;
    global.winH = 1200;
    global.worldW = 1600;
    global.worldH = 1200;
  });

  afterEach(function() {
    delete global.winW;
    delete global.winH;
    delete global.worldW;
    delete global.worldH;
  });

  after(function() {
    if (global.document) delete global.document;
    if (globalThis.lemmings) delete globalThis.lemmings.stage;
  });

  it('adjusts viewport when zooming', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.getGameDisplay().initSize(1600, 1200);
    globalThis.lemmings.stage = stage;

    stage.gameImgProps.viewPoint.scale = 2;
    stage._rawScale = 2;
    stage.gameImgProps.viewPoint.x = 10;
    stage.gameImgProps.viewPoint.y = 20;

    const uim = stage.controller;
    const cursor = new Lemmings.Position2D(100, 50);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    const beforeX = vp.getSceneX(cursor.x - img.x);
    const beforeY = vp.getSceneY(cursor.y - img.y);

    uim.handleWheel(cursor, 120);

    const afterX = vp.getSceneX(cursor.x - img.x);
    const afterY = vp.getSceneY(cursor.y - img.y);

    expect(Math.abs(afterX - beforeX)).to.be.at.most(1);
    expect(Math.abs(afterY - beforeY)).to.be.at.most(1);

    const worldW = stage.getGameDisplay().worldDataSize.width;
    const worldH = stage.getGameDisplay().worldDataSize.height;
    const viewW = img.width / vp.scale;
    const viewH = img.height / vp.scale;
    expect(vp.x).to.be.at.least(0);
    expect(vp.x).to.be.at.most(worldW - viewW);
    expect(vp.y).to.equal(worldH - viewH);
  });

  it('zooms when cursor is at the world origin', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.getGameDisplay().initSize(1600, 1200);
    globalThis.lemmings.stage = stage;

    stage.gameImgProps.viewPoint.scale = 1;
    stage._rawScale = 1;
    stage.gameImgProps.viewPoint.x = 0;
    stage.gameImgProps.viewPoint.y = 0;

    const uim = stage.controller;
    const cursor = new Lemmings.Position2D(0, 0);

    uim.handleWheel(cursor, 120);

    const vp = stage.gameImgProps.viewPoint;
    const worldH = stage.getGameDisplay().worldDataSize.height;
    const viewH = stage.gameImgProps.height / vp.scale;
    expect(vp.scale).to.be.greaterThan(1);
    expect(vp.y).to.equal(worldH - viewH);
  });

  it('emits zoom events with stage set', function(done) {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.getGameDisplay().initSize(1600, 1200);
    globalThis.lemmings.stage = stage;

    stage.gameImgProps.viewPoint.scale = 1;
    stage._rawScale = 1;
    stage.gameImgProps.viewPoint.x = 0;
    stage.gameImgProps.viewPoint.y = 0;

    const uim = stage.controller;
    const oldScale = stage.gameImgProps.viewPoint.scale;

    let count = 0;
    uim.onZoom.on((e) => {
      try {
        expect(e.x).to.equal(25);
        expect(e.y).to.equal(75);
        expect(e.deltaZoom).to.equal(20);
        expect(stage.gameImgProps.viewPoint.scale).to.be.greaterThan(oldScale);
        count += 1;
        if (count === 1) done();
        else done(new Error('zoom triggered more than once'));
      } catch (err) {
        done(err);
      }
    });

    uim.handleWheel(new Lemmings.Position2D(25, 75), 20);
  });

});

it('converts pointer position based on canvas size', function() {
  const scaledElement = {
    width: 400,
    height: 240,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 120 };
    }
  };

  const uim = new UserInputManager(scaledElement);
  const pos = uim.getRelativePosition(scaledElement, 100, 60);

  expect(pos.x).to.equal(200);
  expect(pos.y).to.equal(120);
});

it('accounts for offset rects', function() {
  const offsetElement = {
    width: 400,
    height: 240,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 50, top: 20, width: 200, height: 120 };
    }
  };
  const uim = new UserInputManager(offsetElement);
  const pos = uim.getRelativePosition(offsetElement, 150, 80);
  expect(pos.x).to.equal(200);
  expect(pos.y).to.equal(120);
});
