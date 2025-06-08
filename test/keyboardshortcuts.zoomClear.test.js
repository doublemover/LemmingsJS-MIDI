import { expect } from 'chai';
import fakeTimers from '@sinonjs/fake-timers';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

// minimal global setup
let prevLemmings = globalThis.lemmings;
globalThis.lemmings = { game: { showDebug: false } };

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

function createWindowStub() {
  let rafCb;
  const win = {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(cb) { rafCb = cb; return 1; },
    cancelAnimationFrame() {},
    get lastCallback() { return rafCb; }
  };
  return win;
}

describe('KeyboardShortcuts zoom redraw clearing', function() {
  let clock;
  let win;

  before(function() {
    global.document = createDocumentStub();
  });

  beforeEach(function() {
    win = createWindowStub();
    global.window = win;
    global.requestAnimationFrame = win.requestAnimationFrame;
    clock = fakeTimers.withGlobal(globalThis).install({
      now: 0,
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance'
      ]
    });
  });

  afterEach(function() {
    clock.uninstall();
    delete global.window;
    delete global.requestAnimationFrame;
  });

  after(function() {
    delete global.document;
    globalThis.lemmings = prevLemmings;
  });

  it('clears both layers when zooming with keyboard', function() {
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.getGameDisplay().initSize(100, 100);
    stage.getGuiDisplay().initSize(50, 20);

    const calls = [];
    stage.drawCursor = () => {};
    stage.clear = (img) => {
      calls.push('clear-' + (img === stage.gameImgProps ? 'game' : 'gui'));
    };
    stage.draw = (img) => {
      calls.push('draw-' + (img === stage.gameImgProps ? 'game' : 'gui'));
    };

    const timer = { speedFactor: 1, isRunning() { return true; } };
    const game = { gameGui: {}, getGameTimer() { return timer; } };
    const view = { stage, game };
    const ks = new KeyboardShortcuts(view);

    ks._onKeyDown({ code: 'KeyZ', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16);
    win.lastCallback(clock.now);

    expect(calls).to.deep.equal(['clear-game','draw-game','clear-gui','draw-gui']);
  });
});
