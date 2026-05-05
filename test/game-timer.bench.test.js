import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import { setGlobalLemmings, withGlobalLemmings, withMissingGlobalLemmings } from './helpers/lemmings.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import { getAppContext, setAppContext } from '../js/core/dependencies.js';

describe('GameTimer bench speed control', function() {
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

  it('omits bench overlay rects during bench sequences', function() {
    const overlayCalls = [];
    withGlobalLemmings({
      benchSequence: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color, rect, dashLen) {
          overlayCalls.push({ color, rect, dashLen });
        }
      }
    }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();
  
      now = 1200;
      globalThis.window._raf(now);
  
      expect(overlayCalls.length).to.equal(1);
      expect(overlayCalls[0].rect).to.equal(null);
    });
  });

  it('reduces slow bench speeds without drawing overlay rects', function() {
    const overlayCalls = [];
    withGlobalLemmings({
      benchSequence: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color, rect) {
          overlayCalls.push({ color, rect });
        }
      }
    }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 0.9;
      timer.continue();
  
      now = 1000;
      globalThis.window._raf(now);
  
      expect(timer.speedFactor).to.be.closeTo(0.8, 0.0001);
      expect(overlayCalls.length).to.equal(1);
      expect(overlayCalls[0].rect).to.equal(null);
    });
  });

  it('bails out of bench speed adjustments when app disappears', function() {
    const app = {
      get bench() {
        globalThis.lemmings = null;
        return true;
      },
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade() {}
      }
    };
    withGlobalLemmings(app, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();
  
      now = 120;
      globalThis.window._raf(now);
  
      expect(globalThis.lemmings).to.equal(null);
    });
  });

  it('slows down and restores speed in bench2 catchup mode', function() {  
    withGlobalLemmings({ bench2: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();
  
      now = 600;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.be.lessThan(1);
  
      now = 1200;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.be.closeTo(1, 0.0001);
    });
  });

  it('restores speed after a single catchup step', function() {
    withGlobalLemmings({ bench2: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();
  
      now = 120;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.be.lessThan(1);
  
      now = 240;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(1);
    });
  });

  it('restores catchup speed when steps return to normal', function() {
    withGlobalLemmings({ bench2: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.speedFactor = 2;
      timer.continue();
  
      now = 120;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.be.lessThan(2);
  
      now = 360;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(2);
    });
  });

  it('wraps tickIndex and converts time units', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    let warning = null;
    const restoreConsole = withConsoleStub({ warn: msg => { warning = msg; } });
    timer.tickIndex = COUNTER_LIMIT;
    restoreConsole();
  
    expect(timer.tickIndex).to.equal(0);
    expect(warning).to.match(/tickIndex wrapped/i);
  
    timer.tickIndex = 120;
    expect(timer.getGameTime()).to.be.closeTo(7.2, 0.001);
    expect(timer.secondsToTicks(2)).to.be.closeTo(33.333333333333336, 0.0001);
  
    withGlobalLemmings({ endless: true }, () => {
      expect(timer.ticksToSeconds(1)).to.be.closeTo(2524.14, 0.01);
    });
  });

  it('stops and disposes handlers', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    timer.onGameTick.on(() => {});
    timer.onBeforeGameTick.on(() => {});
    timer.eachGameSecond.on(() => {});
  
    timer.stop();
    expect(timer.onGameTick).to.equal(null);
    expect(timer.onBeforeGameTick).to.equal(null);
    expect(timer.eachGameSecond).to.equal(null);
    expect(this.listeners.size).to.equal(0);
  });

  it('toggles running state and emits each-second events', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    let seconds = 0;
    timer.eachGameSecond.on(() => { seconds += 1; });
  
    timer.toggle();
    expect(timer.isRunning()).to.equal(true);
    timer.tick(1);
    expect(timer.tickIndex).to.equal(0);
  
    now = timer.TIME_PER_FRAME_MS * 17;
    globalThis.window._raf(now);
  
    expect(seconds).to.equal(1);
    timer.toggle();
    expect(timer.isRunning()).to.equal(false);
  });

  it('emits eachGameSecond from simulated ticks during manual stepping', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const seconds = [];
    timer.eachGameSecond.on(second => { seconds.push(second); });
  
    timer.tick(16);
    expect(seconds).to.eql([]);
    timer.tick(1);
    expect(seconds).to.eql([1]);
    timer.tick(17);
    expect(seconds).to.eql([1, 2]);
  });

  it('does not speed up eachGameSecond cadence with speedFactor', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const seconds = [];
    timer.eachGameSecond.on(second => { seconds.push(second); });
    timer.speedFactor = 4;
    timer.continue();
  
    now = timer.frameTime * 17;
    globalThis.window._raf(now);
  
    expect(timer.tickIndex).to.equal(17);
    expect(seconds).to.eql([1]);
    timer.suspend();
  });
});
