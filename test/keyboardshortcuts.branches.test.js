import { expect } from 'chai';
import fakeTimers from '@sinonjs/fake-timers';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

// minimal global setup
let prevLemmings = globalThis.lemmings;
if (!prevLemmings) prevLemmings = { game: { showDebug: false } };
else prevLemmings = Object.assign({}, prevLemmings);

globalThis.lemmings = { game: { showDebug: false } };

function createWindowStub() {
  let rafCb;
  let cancelled;
  return {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(cb) { rafCb = cb; return 1; },
    cancelAnimationFrame(id) { cancelled = id; },
    get lastCallback() { return rafCb; },
    get cancelled() { return cancelled; }
  };
}

class StageStub {
  constructor() {
    this._rawScale = 1;
    this.redrawCount = 0;
    this.gameImgProps = {
      canvasViewportSize: { width: 200, height: 200 },
      viewPoint: { x: 0, y: 0, scale: 1 }
    };
  }
  applyViewport(img, x, y, s) {
    this.gameImgProps.viewPoint.x = x;
    this.gameImgProps.viewPoint.y = y;
    this.gameImgProps.viewPoint.scale = s;
  }
  redraw() { this.redrawCount++; }
  clear() {}
  snapScale(s) { return s; }
  limitValue(min, val, max) { return Math.min(Math.max(val, min), max); }
}

describe('KeyboardShortcuts start/stop branches', function() {
  let clock;
  let win;

  beforeEach(function() {
    win = createWindowStub();
    global.window = win;
    global.requestAnimationFrame = win.requestAnimationFrame;
    clock = fakeTimers.withGlobal(globalThis).install({
      now: 0,
      toFake: ['performance']
    });
  });

  afterEach(function() {
    clock.uninstall();
    delete global.window;
    delete global.requestAnimationFrame;
  });

  it('deactivates when step runs without stage', function() {
    const view = { stage: null, game: { gameGui: {}, getGameTimer() { return {}; } } };
    const ks = new KeyboardShortcuts(view);
    ks._startLoop();
    expect(ks._raf).to.equal(1);
    win.lastCallback(0);
    expect(ks._raf).to.equal(null);
  });

  it('continues loop when stage present', function() {
    const stage = new StageStub();
    const view = { stage, game: { gameGui: {}, getGameTimer() { return {}; } } };
    const ks = new KeyboardShortcuts(view);
    ks._startLoop();
    expect(stage.redrawCount).to.equal(0);
    win.lastCallback(0);
    expect(stage.redrawCount).to.be.greaterThan(0);
    expect(ks._raf).to.equal(1);
  });

  it('dispose without active frame skips cancel', function() {
    const view = { stage: null, game: { gameGui: {}, getGameTimer() { return {}; } } };
    const ks = new KeyboardShortcuts(view);
    ks.dispose();
    expect(win.cancelled).to.equal(undefined);
    expect(ks._raf).to.equal(null);
  });
});

after(function() { globalThis.lemmings = prevLemmings; });
