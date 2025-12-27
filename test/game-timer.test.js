import { expect } from 'chai';
import { GameTimer } from '../js/game/GameTimer.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';

describe('GameTimer', function() {
  let originalWindow;
  let originalDocument;
  let originalPerformance;
  let originalLemmings;
  let now;

  beforeEach(function() {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalPerformance = globalThis.performance;
    originalLemmings = globalThis.lemmings;

    now = 0;
    globalThis.performance = { now: () => now };
    globalThis.lemmings = { endless: false };

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
    globalThis.lemmings = originalLemmings;
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

  it('formats left time and honors endless mode', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    expect(timer.getGameLeftTimeString()).to.equal('1-00');

    timer.tickIndex = timer.ticksTimeLimit + 10;
    expect(timer.getGameLeftTimeString()).to.equal('0-00');

    globalThis.lemmings.endless = true;
    expect(timer.getGameLeftTimeString()).to.equal('4-20');
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
    globalThis.lemmings.bench = true;
    const timer = new GameTimer({ timeLimit: 1 });
    const handler = this.listeners.get('visibilitychange');
    timer.continue();

    globalThis.document.visibilityState = 'hidden';
    handler();
    expect(timer.isRunning()).to.equal(true);
    timer.suspend();
  });

  it('adjusts bench speed and triggers overlay feedback', function() {
    const overlayCalls = [];
    globalThis.lemmings = {
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color, rect, dashLen) {
          overlayCalls.push({ color, rect, dashLen });
        }
      }
    };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    now = 60 * 200;
    globalThis.window._raf(now);

    expect(globalThis.lemmings.steps).to.equal(200);
    expect(timer.speedFactor).to.equal(0.1);
    expect(overlayCalls.length).to.equal(1);
    expect(overlayCalls[0].color).to.match(/^rgba\(255,0,0/);
    expect(overlayCalls[0].rect).to.eql({ x: 160, y: 32, width: 16, height: 10 });
  });

  it('slows down and restores speed in bench2 catchup mode', function() {
    globalThis.lemmings.bench2 = true;
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    now = 600;
    globalThis.window._raf(now);
    expect(timer.speedFactor).to.be.lessThan(1);

    now = 1200;
    globalThis.window._raf(now);
    expect(timer.speedFactor).to.be.closeTo(1, 0.0001);
  });

  it('wraps tickIndex and converts time units', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const originalWarn = console.warn;
    let warning = null;
    console.warn = msg => { warning = msg; };
    timer.tickIndex = COUNTER_LIMIT;
    console.warn = originalWarn;

    expect(timer.tickIndex).to.equal(0);
    expect(warning).to.match(/tickIndex wrapped/i);

    timer.tickIndex = 120;
    expect(timer.getGameTime()).to.be.closeTo(7.2, 0.001);
    expect(timer.secondsToTicks(2)).to.be.closeTo(33.333333333333336, 0.0001);

    globalThis.lemmings.endless = true;
    expect(timer.ticksToSeconds(1)).to.be.closeTo(2524.14, 0.01);
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

    now = 120;
    globalThis.window._raf(now);
    now = 180;
    globalThis.window._raf(now);

    expect(seconds).to.equal(1);
    timer.toggle();
    expect(timer.isRunning()).to.equal(false);
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
    const prev = globalThis.lemmings;
    globalThis.lemmings = null;
    try {
      expect(timer.ticksToSeconds(1)).to.be.closeTo(0.06, 0.0001);
    } finally {
      globalThis.lemmings = prev;
    }
    const prevProp = globalThis.lemmings;
    delete globalThis.lemmings;
    try {
      expect(timer.ticksToSeconds(2)).to.be.closeTo(0.12, 0.0001);
    } finally {
      globalThis.lemmings = prevProp;
    }
  });

  it('skips bench adjust when app vanishes mid-loop', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'lemmings');
    let access = 0;
    Object.defineProperty(globalThis, 'lemmings', {
      configurable: true,
      get() {
        access += 1;
        if (access === 1) return { bench: true };
        return null;
      }
    });
    try {
      timer.continue();
      now = 120;
      globalThis.window._raf(now);
      expect(access).to.be.greaterThan(1);
    } finally {
      if (prev) {
        Object.defineProperty(globalThis, 'lemmings', prev);
      } else {
        delete globalThis.lemmings;
      }
      timer.suspend();
    }
  });

  it('slows down gradually during bench startup', function() {
    const overlayCalls = [];
    globalThis.lemmings = {
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color, rect, dashLen) {
          overlayCalls.push({ color, rect, dashLen });
        }
      }
    };
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

  it('recovers speed after extended stability', function() {
    const overlayCalls = [];
    globalThis.lemmings = {
      bench: true,
      stage: {
        guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
        startOverlayFade(color) {
          overlayCalls.push(color);
        }
      }
    };
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

  it('nudges very slow bench speeds upward', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    globalThis.lemmings = { bench: true };
    timer.speedFactor = 0.5;
    timer.continue();
    for (let i = 1; i <= 3; i++) {
      now = timer.frameTime * i;
      globalThis.window._raf(now);
    }
    expect(timer.speedFactor).to.be.closeTo(0.6, 0.0001);
  });

  it('exposes game tick count', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    timer.tick(3);
    expect(timer.getGameTicks()).to.equal(3);
  });
});
