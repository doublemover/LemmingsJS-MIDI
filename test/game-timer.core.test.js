import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import { setGlobalLemmings, withGlobalLemmings, withMissingGlobalLemmings } from './helpers/lemmings.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import { getAppContext, setAppContext } from '../js/core/dependencies.js';

describe('GameTimer core loop', function() {
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

  it('ticks forward and backward and triggers handlers', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const before = [];
    const ticks = [];
    timer.onBeforeGameTick.on(v => before.push(v));
    timer.onGameTick.on(() => ticks.push(timer.tickIndex));

    timer.tick(2);
    expect(timer.tickIndex).to.equal(2);
    expect(before).to.eql([0, 1]);
    expect(ticks.length).to.equal(2);

    timer.tick(-1);
    expect(timer.tickIndex).to.equal(1);
    expect(before).to.eql([0, 1, 1]);
    expect(ticks.length).to.equal(3);

    timer.tick(-5);
    expect(timer.tickIndex).to.equal(0);
    expect(before).to.eql([0, 1, 1, 0]);
    expect(ticks.length).to.equal(4);
  });

  it('stores the time travel controller', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const controller = { stepBackward() {} };
    timer.setTimeTravelController(controller);
    expect(timer.getTimeTravelController()).to.equal(controller);
  });

  it('delegates backward ticks to the time travel controller', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const calls = [];
    const controller = { stepBackward(count) { calls.push(count); } };
    timer.setTimeTravelController(controller);
    timer.tick(-3);
    expect(calls).to.eql([3]);
  });

  it('formats left time and honors endless mode', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    expect(timer.getGameLeftTimeString()).to.equal('1-00');

    timer.tickIndex = timer.ticksTimeLimit + 10;
    expect(timer.getGameLeftTimeString()).to.equal('0-00');

    withGlobalLemmings({ endless: true }, () => {
      expect(timer.getGameLeftTimeString()).to.equal('4-20');
    });
  });

  it('runs the animation loop and advances ticks', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const ticks = [];
    timer.onGameTick.on(() => ticks.push(timer.tickIndex));

    timer.continue();
    expect(typeof globalThis.window._raf).to.equal('function');

    now = 120;
    globalThis.window._raf(120);

    expect(timer.tickIndex).to.equal(2);
    expect(ticks.length).to.equal(2);
    timer.suspend();
  });

  it('restarts when speedFactor changes while running', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    let suspendCalls = 0;
    let continueCalls = 0;
    const originalSuspend = timer.suspend.bind(timer);
    const originalContinue = timer.continue.bind(timer);
    timer.suspend = () => { suspendCalls++; originalSuspend(); };
    timer.continue = () => { continueCalls++; originalContinue(); };

    timer.continue();
    timer.speedFactor = 2;

    expect(timer.speedFactor).to.equal(2);
    expect(timer.frameTime).to.equal(30);
    expect(timer.tps).to.be.closeTo(1000 / 30, 0.0001);
    expect(suspendCalls).to.equal(1);
    expect(continueCalls).to.equal(2);

    timer.speedFactor = 2;
    timer.speedFactor = -1;
    expect(timer.speedFactor).to.equal(2);
  });

  it('auto-pauses and resumes on visibility changes', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const handler = this.listeners.get('visibilitychange');
    timer.continue();

    globalThis.document.visibilityState = 'hidden';
    handler();
    expect(timer.isRunning()).to.equal(false);

    globalThis.document.visibilityState = 'visible';
    handler();
    expect(timer.isRunning()).to.equal(true);
    timer.suspend();
  });

  it('skips visibility auto-pause during bench runs', function() {
    withGlobalLemmings({ bench: true }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      const handler = this.listeners.get('visibilitychange');
      timer.continue();

      globalThis.document.visibilityState = 'hidden';
      handler();
      expect(timer.isRunning()).to.equal(true);
      timer.suspend();
    });
  });

  it('adjusts bench speed and triggers overlay feedback', function() {
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
      timer.continue();

      now = 60 * 200;
      globalThis.window._raf(now);

      expect(globalThis.lemmings.steps).to.equal(200);
      expect(timer.speedFactor).to.equal(0.2);
      expect(overlayCalls.length).to.equal(1);
      expect(overlayCalls[0].color).to.match(/^rgba\(255,0,0/);
      expect(overlayCalls[0].rect).to.eql({ x: 160, y: 32, width: 16, height: 10 });
    });
  });

  it('reduces bench speeds across multiple thresholds', function() {
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
      timer.continue();

      timer.speedFactor = 70;
      now = 30;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(60);

      timer.speedFactor = 50;
      now = 60;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(40);

      timer.speedFactor = 20;
      now = 93;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(11);
      expect(overlayCalls.some(call => call.rect)).to.equal(true);
    });
  });

  it('reduces low bench speeds in smaller ranges', function() {
    withGlobalLemmings({
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade() {}
      }
    }, () => {
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();

      timer.speedFactor = 5;
      now = 144;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(4);

      timer.speedFactor = 0.5;
      now = 3000;
      globalThis.window._raf(now);
      expect(timer.speedFactor).to.equal(0.4);
    });
  });
});
