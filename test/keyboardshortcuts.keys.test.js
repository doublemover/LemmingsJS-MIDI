import { expect } from 'chai';
import fakeTimers from '@sinonjs/fake-timers';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

// minimal global setup
let prevLemmings = globalThis.lemmings;
globalThis.lemmings = { game: { showDebug: false } };

class StageStub {
  constructor() {
    this._rawScale = 1;
    this.redrawCount = 0;
    this.gameImgProps = {
      canvasViewportSize: { width: 100, height: 100 },
      display: { worldDataSize: { width: 200, height: 200 } },
      viewPoint: { x: 0, y: 0, scale: 1 }
    };
  }
  applyViewport(img, x, y, s) {
    img.viewPoint.x = x;
    img.viewPoint.y = y;
    img.viewPoint.scale = s;
  }
  clampViewPoint() {}
  redraw() { this.redrawCount++; }
  clear() {}
  snapScale(s) { return s; }
  limitValue(min, val, max) { return Math.min(Math.max(val, min), max); }
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

describe('KeyboardShortcuts key handling', function() {
  let clock;
  let win;
  let stage;
  let timer;
  let ks;

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
    stage = new StageStub();
    timer = { speedFactor: 1, isRunning() { return true; } };
    const game = { gameGui: { drawSpeedChange() {} }, getGameTimer() { return timer; } };
    const view = { stage, game };
    ks = new KeyboardShortcuts(view);
  });

  afterEach(function() {
    clock.uninstall();
    delete global.window;
    delete global.requestAnimationFrame;
  });

  after(function() {
    globalThis.lemmings = prevLemmings;
  });

  it('responds to arrow keys for panning', function() {
    const startX = stage.gameImgProps.viewPoint.x;
    ks._onKeyDown({ code: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    expect(ks.pan.right).to.be.true;
    clock.tick(16); win.lastCallback(clock.now);
    expect(stage.gameImgProps.viewPoint.x).to.be.greaterThan(startX);
    ks._onKeyUp({ code: 'ArrowRight' });
    expect(ks.pan.right).to.be.false;
  });

  it('handles zoom keys', function() {
    const startScale = stage.gameImgProps.viewPoint.scale;
    ks._onKeyDown({ code: 'KeyZ', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16); win.lastCallback(clock.now);
    expect(ks.zoom.dir).to.equal(1);
    expect(stage.gameImgProps.viewPoint.scale).to.be.greaterThan(startScale);
    ks._onKeyUp({ code: 'KeyZ' });
    expect(ks.zoom.dir).to.equal(0);

    const scaleAfterZ = stage.gameImgProps.viewPoint.scale;
    ks._onKeyDown({ code: 'KeyX', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    clock.tick(16); win.lastCallback(clock.now);
    expect(ks.zoom.dir).to.equal(-1);
    expect(stage.gameImgProps.viewPoint.scale).to.be.below(scaleAfterZ);
    ks._onKeyUp({ code: 'KeyX' });
    expect(ks.zoom.dir).to.equal(0);
  });

  it('adjusts speed with plus and minus keys', function() {
    ks._onKeyDown({ code: 'Equal', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    expect(timer.speedFactor).to.be.above(1);
    ks._onKeyDown({ code: 'Minus', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    expect(timer.speedFactor).to.be.at.least(1);
  });
});

