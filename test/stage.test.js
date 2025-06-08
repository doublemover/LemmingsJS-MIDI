import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import fakeTimers from '@sinonjs/fake-timers';

// Minimal canvas/context stubs
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

// Document stub for StageImageProperties
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

describe('Stage pointer events', function() {
  before(function() {
    global.document = createDocumentStub();
  });

  it('forwards user input to DisplayImage handlers', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    const events = [];
    display.onMouseDown.on(p => events.push(['down', p]));
    display.onMouseMove.on(p => events.push(['move', p]));
    display.onMouseUp.on(p => events.push(['up', p]));
    display.onMouseRightDown.on(p => events.push(['rd', p]));
    display.onMouseRightUp.on(p => events.push(['ru', p]));
    display.onDoubleClick.on(p => events.push(['dbl', p]));

    stage.controller.handleMouseMove(new Lemmings.Position2D(110, 110));
    stage.controller.handleMouseDown(new Lemmings.Position2D(100, 100));
    stage.controller.handleMouseUp(new Lemmings.Position2D(100, 100));
    stage.controller.handleMouseRightDown(new Lemmings.Position2D(120, 130));
    stage.controller.handleMouseRightUp(new Lemmings.Position2D(120, 130));
    stage.controller.handleMouseDoubleClick(new Lemmings.Position2D(140, 140));

    expect(events.map(e => e[0])).to.deep.equal([
      'move', 'down', 'up', 'rd', 'ru', 'dbl'
    ]);

    expect(events[1][1].x).to.equal(50);
    expect(events[1][1].y).to.equal(60);
    expect(events[0][1].x).to.equal(55);
    expect(events[0][1].y).to.equal(65);
  });

  it('forwards coordinates when zoomed', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    stage.gameImgProps.viewPoint.scale = 0.5;
    stage.gameImgProps.viewPoint.x = 10;
    stage.gameImgProps.viewPoint.y = 20;

    let pos = null;
    display.onMouseDown.on(p => { pos = p; });

    stage.controller.handleMouseDown(new Lemmings.Position2D(30, 40));

    expect(pos.x).to.equal(70);
    expect(pos.y).to.equal(140);
  });

  it('translates coordinates for multiple zoom levels', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGameDisplay();
    const scales = [0.5, 1, 2];
    const results = [];
    display.onMouseDown.on(p => results.push({ x: p.x, y: p.y }));

    for (const s of scales) {
      stage.gameImgProps.viewPoint.scale = s;
      stage.gameImgProps.viewPoint.x = 10;
      stage.gameImgProps.viewPoint.y = 20;
      stage.controller.handleMouseDown(new Lemmings.Position2D(30, 40));
    }

    expect(results).to.deep.equal([
      { x: 70, y: 100 },
      { x: 40, y: 60 },
      { x: 25, y: 40 }
    ]);
  });

  it('continues overlay fade after resizing', function() {
    const canvas = createStubCanvas(200, 150);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.getGameDisplay().initSize(100, 100);
    stage.getGuiDisplay().initSize(50, 10);

    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    const rect = { x: 5, y: 5, width: 10, height: 10 };
    stage.startOverlayFade('black', rect);
    const firstAlpha = stage.overlayAlpha;
    clock.tick(120);
    const alphaBeforeResize = stage.overlayAlpha;

    canvas.width = 300;
    canvas.height = 200;
    canvas.getContext().canvas.width = 300;
    canvas.getContext().canvas.height = 200;
    stage.updateStageSize();

    clock.tick(120);
    const alphaAfterResize = stage.overlayAlpha;
    clock.uninstall();

    expect(firstAlpha).to.equal(1);
    expect(alphaBeforeResize).to.be.below(1);
    expect(alphaAfterResize).to.be.below(alphaBeforeResize);
    expect(stage.overlayRect).to.deep.equal(rect);
  });
});
