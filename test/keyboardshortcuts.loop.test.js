import { expect } from 'chai';
import fakeTimers from '@sinonjs/fake-timers';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

// minimal global setup
globalThis.lemmings = Lemmings;
lemmings.game = { showDebug: false };

class StageStub {
  constructor() {
    this._rawScale = 1;
    this.redrawCount = 0;
    this.updateCalls = [];
    this.clears = [];
    this.gameImgProps = {
      width: 100,
      height: 100,
      display: {
        getWidth() { return 200; },
        getHeight() { return 200; },
        get worldDataSize() { return { width: 200, height: 200 }; }
      },
      viewPoint: { x: 0, y: 0, scale: 1 }
    };
  }
  updateViewPoint(img, dx, dy) {
    this.updateCalls.push({ dx, dy });
    this.gameImgProps.viewPoint.x += dx;
    this.gameImgProps.viewPoint.y += dy;
  }
  clampViewPoint() {}
  redraw() { this.redrawCount++; }
  clear(img) { this.clears.push(img); }
  snapScale(s) { return s; }
  limitValue(min, val, max) { return Math.min(Math.max(val, min), max); }
}

function createWindowStub() {
  let rafCb;
  let cancelId;
  const win = {
    addEventListener() {},
    removeEventListener() { win.removeCount++; },
    requestAnimationFrame(cb) { rafCb = cb; return 1; },
    cancelAnimationFrame(id) { cancelId = id; },
    removeCount: 0,
    get lastCallback() { return rafCb; },
    get cancelled() { return cancelId; }
  };
  return win;
}

describe('KeyboardShortcuts _step loop', function() {
  let clock;
  let windowStub;
  let stage;
  let ks;

  beforeEach(function() {
    windowStub = createWindowStub();
    global.window = windowStub;
    global.requestAnimationFrame = windowStub.requestAnimationFrame;
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
    stage = new StageStub();
    const timer = { speedFactor: 1 };
    const game = { gameGui: { drawSpeedChange() {} }, getGameTimer() { return timer; } };
    const view = { stage, game };
    ks = new KeyboardShortcuts(view);
  });

  afterEach(function() {
    clock.uninstall();
    delete global.window;
    delete global.requestAnimationFrame;
  });

  it('updates view when panning', function() {
    ks._onKeyDown({ code: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16);
    window.lastCallback(clock.now);
    expect(stage.updateCalls.length).to.be.greaterThan(0);
    expect(stage.gameImgProps.viewPoint.x).to.be.greaterThan(0);
    expect(stage.redrawCount).to.equal(1);
  });

  it('updates view when zooming', function() {
    ks._onKeyDown({ code: 'KeyZ', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16);
    window.lastCallback(clock.now);
    expect(stage.gameImgProps.viewPoint.scale).to.be.greaterThan(1);
    expect(stage.redrawCount).to.equal(1);
  });

  it('clears frames when zooming via keyboard', function() {
    ks._onKeyDown({ code: 'KeyZ', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16);
    window.lastCallback(clock.now);
    expect(stage.clears.length).to.be.at.least(1);
  });

  it('changeSpeed adjusts speedFactor without shift', function() {
    const timer = ks.view.game.getGameTimer();
    timer.speedFactor = 5;
    ks._changeSpeed(1, false);
    expect(timer.speedFactor).to.equal(6);
    ks._changeSpeed(-1, false);
    expect(timer.speedFactor).to.equal(5);
  });

  it('changeSpeed adjusts speedFactor with shift', function() {
    const timer = ks.view.game.getGameTimer();
    timer.speedFactor = 1;
    ks._changeSpeed(1, true);
    expect(timer.speedFactor).to.equal(6);
    timer.speedFactor = 1;
    ks._changeSpeed(-1, true);
    expect(timer.speedFactor).to.equal(0.5);
  });

  it('cancels animation frame on dispose', function() {
    ks._startLoop();
    ks.dispose();
    expect(windowStub.cancelled).to.equal(1);
    expect(ks._raf).to.equal(null);
    expect(windowStub.removeCount).to.be.at.least(2);
  });
});
