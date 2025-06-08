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

  beforeEach(function() {
    global.winW = 1000;
    global.winH = 1200;
    global.worldW = 1000;
    global.worldH = 1200;
  });

  afterEach(function() {
    delete global.winW;
    delete global.winH;
    delete global.worldW;
    delete global.worldH;
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

    expect(stage.gameImgProps.viewPoint.x).to.equal(-300);
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

    const worldW = display.worldDataSize.width;
    const worldH = display.worldDataSize.height;
    const viewW = img.width / vp.scale;
    const viewH = img.height / vp.scale;

    expect(vp.x).to.be.at.least(Math.min(0, worldW - viewW));
    expect(vp.x).to.be.at.most(Math.max(0, worldW - viewW));
    expect(vp.y).to.be.at.least(Math.min(0, worldH - viewH));
    expect(vp.y).to.be.at.most(Math.max(0, worldH - viewH));
  });

  it('keeps level bottom glued to the HUD when zooming', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 600);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    vp.scale = 1;
    vp.x = 0;
    vp.y = display.worldDataSize.height - img.height / vp.scale;

    stage.updateViewPoint(img, 100, 100, -10000);
    let viewH = img.height / vp.scale;
    expect(vp.y).to.equal(display.worldDataSize.height - viewH);

    stage.updateViewPoint(img, 100, 100, (1 - vp.scale) / 0.0001);
    viewH = img.height / vp.scale;
    expect(vp.y).to.equal(display.worldDataSize.height - viewH);
  });

  it('preserves world coords at multiple cursor positions', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 1200);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    vp.scale = 1;
    vp.x = 100;
    vp.y = 80;

    const positions = [
      [50, 40],
      [200, 100],
      [750, 550]
    ];

    for (const [cx, cy] of positions) {
      const preX = vp.getSceneX(cx - img.x);
      const preY = vp.getSceneY(cy - img.y);

      stage.updateViewPoint(img, cx, cy, 120);
      let postX = vp.getSceneX(cx - img.x);
      let postY = vp.getSceneY(cy - img.y);
      expect(Math.abs(postX - preX)).to.be.at.most(1);
      expect(Math.abs(postY - preY)).to.be.at.most(1);

      const worldW = display.worldDataSize.width;
      const worldH = display.worldDataSize.height;
      const viewW = img.width / vp.scale;
      const viewH = img.height / vp.scale;
      expect(vp.x).to.be.at.least(0);
      expect(vp.x).to.be.at.most(worldW - viewW);
      expect(vp.y).to.be.at.least(0);
      expect(vp.y).to.be.at.most(worldH - viewH);

      stage.updateViewPoint(img, cx, cy, -120);
      postX = vp.getSceneX(cx - img.x);
      postY = vp.getSceneY(cy - img.y);
      expect(Math.abs(postX - preX)).to.be.at.most(1);
      expect(Math.abs(postY - preY)).to.be.at.most(1);

      expect(vp.x).to.be.at.least(0);
      expect(vp.x).to.be.at.most(worldW - viewW);
      expect(vp.y).to.be.at.least(0);
      expect(vp.y).to.be.at.most(worldH - viewH);
    }
  });

  it('clamps viewpoint during repeated pan and zoom', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 1200);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    vp.scale = 2;

    const checkClamp = () => {
      const worldW = display.worldDataSize.width;
      const worldH = display.worldDataSize.height;
      const viewW = img.width / vp.scale;
      const viewH = img.height / vp.scale;
      expect(vp.x).to.be.at.least(0);
      expect(vp.x).to.be.at.most(worldW - viewW);
      expect(vp.y).to.be.at.least(0);
      expect(vp.y).to.be.at.most(worldH - viewH);
    };

    for (let i = 0; i < 5; i++) {
      stage.updateViewPoint(img, 100, 100, 120);
      checkClamp();
      stage.updateViewPoint(img, 100, 100, -120);
      checkClamp();
    }

    for (let i = 0; i < 20; i++) {
      stage.updateViewPoint(img, 30, 20, 0);
      checkClamp();
    }

    for (let i = 0; i < 20; i++) {
      stage.updateViewPoint(img, -30, -20, 0);
      checkClamp();
    }
  });

  it('glues bottom when view taller than world', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 200);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    vp.scale = 0.5;
    vp.x = 0;
    vp.y = 0;

    stage.updateViewPoint(img, 50, 50, 0);

    const viewH = img.height / vp.scale;
    expect(vp.y).to.equal(200 - viewH);
  });

  it('clamps bottom edge when zoomed in', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    display.initSize(1000, 1200);

    const img = stage.gameImgProps;
    const vp = img.viewPoint;
    vp.scale = 2;
    vp.x = 0;
    vp.y = 0;

    stage.updateViewPoint(img, 0, -10000, 0);

    const viewH = img.height / vp.scale;
    expect(vp.y).to.equal(1200 - viewH);
  });
});
