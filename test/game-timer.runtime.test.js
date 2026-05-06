import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import { setGlobalLemmings, withGlobalLemmings, withMissingGlobalLemmings } from './helpers/lemmings.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import { getAppContext, setAppContext } from '../js/core/dependencies.js';

describe('GameTimer runtime integration', function() {
  let originalWindow;

  let originalDocument;

  let originalPerformance;

  let restoreLemmings;

  let now;

  beforeEach(function() {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalPerformance = globalThis.performance;
    now = 0;
    globalThis.performance = { now: () => now };
    restoreLemmings = setGlobalLemmings({ endless: false });

    const listeners = new Map();
    this.listeners = listeners;
    globalThis.document = {
      visibilityState: 'visible',
      hasFocus() { return true; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      }
    };
    globalThis.window = {
      requestAnimationFrame(cb) {
        globalThis.window._raf = cb;
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
      setTimeout(cb) {
        cb();
        return 1;
      }
    };
  });

  afterEach(function() {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.performance = originalPerformance;
    restoreLemmings();
  });

  it('uses injected runtime dependencies for browser integration', function() {
    const calls = [];
    const runtime = {
      performance: { now: () => 0 },
      document: {
        visibilityState: 'visible',
        hasFocus() { return true; },
        addEventListener(type, handler) { calls.push(['doc:add', type, handler]); },
        removeEventListener(type, handler) { calls.push(['doc:remove', type, handler]); }
      },
      window: {
        requestAnimationFrame(handler) {
          calls.push(['win:raf', handler]);
          return 9;
        },
        cancelAnimationFrame(id) { calls.push(['win:cancel', id]); },
        addEventListener(type, handler) { calls.push(['win:add', type, handler]); },
        removeEventListener(type, handler) { calls.push(['win:remove', type, handler]); }
      }
    };

    const timer = new GameTimer({ timeLimit: 1 }, runtime);
    timer.continue();
    timer.stop();

    expect(calls.map(call => call[0])).to.include.members([
      'doc:add',
      'win:add',
      'win:raf',
      'win:cancel',
      'doc:remove',
      'win:remove'
    ]);
  });

  it('returns early when continuing while already running', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const originalRaf = globalThis.window.requestAnimationFrame;
    let rafCalls = 0;
    globalThis.window.requestAnimationFrame = cb => {
      rafCalls += 1;
      globalThis.window._raf = cb;
      return rafCalls;
    };
    try {
      timer.continue();
      timer.continue();
      expect(rafCalls).to.equal(1);
    } finally {
      timer.suspend();
      globalThis.window.requestAnimationFrame = originalRaf;
    }
  });

  it('returns false and remains stopped when no RAF scheduler is available', function() {
    const timer = new GameTimer({ timeLimit: 1 }, {
      performance: { now: () => 0 },
      window: {
        addEventListener() {},
        removeEventListener() {},
        cancelAnimationFrame() {}
      },
      document: {
        addEventListener() {},
        removeEventListener() {}
      }
    });

    expect(timer.continue()).to.equal(false);
    expect(timer.isRunning()).to.equal(false);
    timer.stop();
  });

  it('does not advance when loop runs while suspended', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();
    timer.suspend();
    const prev = timer.tickIndex;
    globalThis.window._raf(120);
    expect(timer.tickIndex).to.equal(prev);
  });

  it('handles missing global app references', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    withGlobalLemmings(null, () => {
      expect(timer.ticksToSeconds(1)).to.be.closeTo(0.06, 0.0001);
    });
    withMissingGlobalLemmings(() => {
      expect(timer.ticksToSeconds(2)).to.be.closeTo(0.12, 0.0001);
    });
  });

  it('skips bench adjust when app context is missing mid-loop', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'lemmings');
    const prevApp = getAppContext();
    setAppContext(null);
    let access = 0;
    Object.defineProperty(globalThis, 'lemmings', {
      configurable: true,
      get() {
        access += 1;
        if (access <= 2) return { bench: true };
        return null;
      }
    });
    try {
      timer.continue();
      now = 120;
      globalThis.window._raf(now);
      expect(access).to.equal(0);
    } finally {
      if (prev) {
        Object.defineProperty(globalThis, 'lemmings', prev);
      } else {
        delete globalThis.lemmings;
      }
      setAppContext(prevApp);
      timer.suspend();
    }
  });

  it('slows down gradually during bench startup', function() {
    const overlayCalls = [];
    withGlobalLemmings({
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color, rect, dashLen) {
          overlayCalls.push({ color, rect, dashLen });
        }
      }
    }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 2;
      timer.benchStartupFrames = 5;
      timer.benchStableFactor = 2;
      timer.continue();

      now = timer.frameTime * 12;
      globalThis.window._raf(now);

      expect(timer.speedFactor).to.equal(1);
      expect(overlayCalls[0].color).to.match(/^rgba\(255,0,0/);
    });
  });

  it('reduces sub-1.0 bench speeds when overloaded', function() {
    withGlobalLemmings({ bench: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 0.5;
      timer.continue();

      now = timer.frameTime * 30;
      globalThis.window._raf(now);

      expect(timer.speedFactor).to.be.closeTo(0.4, 0.0001);
    });
  });

  it('recovers speed after extended stability', function() {
    const overlayCalls = [];
    withGlobalLemmings({
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color) {
          overlayCalls.push(color);
        }
      }
    }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 8;
      timer.continue();
      const frame = timer.frameTime;
      for (let i = 1; i <= 33; i++) {
        now = frame * i;
        globalThis.window._raf(now);
      }
      expect(timer.speedFactor).to.equal(9);
      expect(overlayCalls.some(color => color.startsWith('rgba(0,255,0'))).to.equal(true);
    });
  });

  it('nudges very slow bench speeds upward', function() {
    withGlobalLemmings({ bench: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 0.5;
      timer.continue();
      for (let i = 1; i <= 3; i++) {
        now = timer.frameTime * i;
        globalThis.window._raf(now);
      }
      expect(timer.speedFactor).to.be.closeTo(0.6, 0.0001);
    });
  });

  it('exposes game tick count', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    timer.tick(3);
    expect(timer.getGameTicks()).to.equal(3);
  });
});
