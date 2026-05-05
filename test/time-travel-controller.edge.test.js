import { expect } from 'chai';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

describe('TimeTravelController edge cases', function() {
  it('uses TIME_PER_FRAME_MS and skips small reverse deltas', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let rafCallback = null;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame(cb) {
        rafCallback = cb;
        return 1;
      },
      cancelAnimationFrame() {}
    };
    try {
      const timer = {
        frameTime: 0,
        TIME_PER_FRAME_MS: 20,
        isRunning: () => false,
        suspend() {}
      };
      const history = { pause() {}, resume() {} };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);
      const steps = [];
      controller.stepBackward = (count) => steps.push(count);
  
      controller.startReverse();
      rafCallback?.(10);
      rafCallback?.(25);
  
      expect(steps).to.eql([1]);
      controller.stopReverse();
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('uses a default frame time and skips inactive reverse loops', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let rafCallback = null;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame(cb) {
        rafCallback = cb;
        return 1;
      },
      cancelAnimationFrame() {}
    };
    try {
      const timer = { frameTime: 0, TIME_PER_FRAME_MS: 0, isRunning: () => false, suspend() {} };
      const history = { pause() {}, resume() {} };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);
      controller.stepBackward = () => {};
  
      controller.startReverse();
      rafCallback?.(700);
      controller._reverseActive = false;
      rafCallback?.(800);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('skips reverse sound emission when sound bus is missing', function() {
    const timer = { tickIndex: 1 };
    const history = {};
    const game = { getGameTimer: () => timer };
    const controller = new TimeTravelController(game, history);
    controller._emitReverseEvents({ soundEvents: [{ sfxId: 1 }] });
  });

  it('stops reverse safely when RAF APIs disappear', function() {
    const originalWindow = globalThis.window;
    const timer = { tickIndex: 0, isRunning: () => false };
    const game = { getGameTimer: () => timer, inputEnabled: true };
    const controller = new TimeTravelController(game, { resume() {} });
    controller._reverseActive = true;
    controller._reverseRaf = 123;
    controller._resumeForward = false;
    globalThis.window = undefined;
    try {
      expect(() => controller.stopReverse()).to.not.throw();
      expect(controller.isReversing).to.equal(false);
      expect(controller._reverseRaf).to.equal(0);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('stops reverse without resuming when already paused', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let resumed = 0;
    let truncated = 0;
    let continued = 0;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    try {
      const timer = {
        frameTime: 60,
        TIME_PER_FRAME_MS: 60,
        isRunning: () => false,
        suspend() {},
        continue() { continued += 1; }
      };
      const history = {
        pause() {},
        resume() { resumed += 1; },
        truncateAfter() { truncated += 1; }
      };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);
  
      controller.startReverse();
      controller.stopReverse();
  
      expect(resumed).to.equal(1);
      expect(truncated).to.equal(0);
      expect(continued).to.equal(0);
      expect(game.inputEnabled).to.equal(true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('caps reverse steps per frame and carries remainder', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let rafCallback = null;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame(cb) {
        rafCallback = cb;
        return 1;
      },
      cancelAnimationFrame() {}
    };
    try {
      const timer = {
        frameTime: 10,
        TIME_PER_FRAME_MS: 10,
        isRunning: () => false,
        suspend() {}
      };
      const history = {
        pause() {},
        resume() {}
      };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);
      const steps = [];
      controller.stepBackward = (count) => steps.push(count);
      controller.maxReverseStepsPerFrame = 3;
  
      controller.startReverse();
      rafCallback?.(100);
      rafCallback?.(120);
  
      expect(steps).to.eql([3, 3]);
      expect(controller._reverseCarryMs).to.equal(60);
  
      controller.stopReverse();
      expect(controller._reverseCarryMs).to.equal(0);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('uses raw reverse steps when maxReverseStepsPerFrame is invalid', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let rafCallback = null;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame(cb) {
        rafCallback = cb;
        return 1;
      },
      cancelAnimationFrame() {}
    };
    try {
      const timer = {
        frameTime: 10,
        TIME_PER_FRAME_MS: 10,
        isRunning: () => false,
        suspend() {}
      };
      const history = { pause() {}, resume() {} };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);
      controller.maxReverseStepsPerFrame = Number.NaN;
      const steps = [];
      controller.stepBackward = (count) => steps.push(count);
  
      controller.startReverse();
      rafCallback?.(50);
      expect(steps[0]).to.equal(5);
      controller.stopReverse();
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('falls back to seek when backward delta applier is missing', function() {
    const timer = { tickIndex: 4, isRunning: () => false, suspend() {} };
    const history = {
      getDelta() { return { tick: 3 }; }
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);
    const seeks = [];
    controller.seekToTick = (tick) => seeks.push(tick);
  
    controller.stepBackward(1);
  
    expect(seeks).to.eql([3]);
  });

  it('skips seek application when applyKeyframe is missing', function() {
    const timer = { tickIndex: 2, isRunning: () => false, suspend() {} };
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; }
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);
  
    expect(() => controller.seekToTick(1)).to.not.throw();
    expect(timer.tickIndex).to.equal(2);
  });
});
