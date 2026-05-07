import { expect } from 'chai';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

describe('TimeTravelController reverse playback', function() {
  it('seeks forward using keyframes and deltas', function() {
    const timer = { tickIndex: 5, isRunning: () => false, suspend() {} };
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; },
      getDelta(tick) { return tick < 2 ? { tick } : null; },
      applyKeyframe(game, keyframe) { game._keyframe = keyframe; },
      applyDeltaForward(game, delta) { game._forward = (game._forward || 0) + 1; }
    };
    const game = {
      getGameTimer: () => timer,
      render() {},
      gameGui: { gameTimeChanged: false }
    };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(2);

    expect(game._keyframe.tickIndex).to.equal(0);
    expect(game._forward).to.equal(2);
    expect(timer.tickIndex).to.equal(2);
    expect(game.gameGui.gameTimeChanged).to.equal(true);
  });

  it('uses the target tick when keyframe tickIndex is missing', function() {
    const timer = { tickIndex: 3, isRunning: () => false, suspend() {} };
    const history = {
      getKeyframeAtOrBefore() { return {}; },
      applyKeyframe() {}
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(5);

    expect(timer.tickIndex).to.equal(5);
  });

  it('clamps keyframe tickIndex when keyframe is ahead of target', function() {
    const timer = { tickIndex: 0, isRunning: () => false, suspend() {} };
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 99 }; },
      applyKeyframe() {},
      getDelta() { return null; },
      applyDeltaForward() {}
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(5);

    expect(timer.tickIndex).to.equal(5);
  });

  it('breaks seek loops when deltas are missing', function() {
    const timer = { tickIndex: 0, isRunning: () => false, suspend() {} };
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; },
      getDelta() { return null; },
      applyKeyframe() {},
      applyDeltaForward() { throw new Error('should not apply'); }
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(2);

    expect(timer.tickIndex).to.equal(0);
  });

  it('suspends running timers and falls back to delta arrays', function() {
    let suspended = 0;
    const timer = { tickIndex: 0, isRunning: () => true, suspend() { suspended += 1; } };
    const applied = [];
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; },
      getDelta() { return undefined; },
      deltas: [{ tick: 0 }],
      applyKeyframe() {},
      applyDeltaForward(game, delta) { applied.push(delta); }
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(1);

    expect(suspended).to.equal(1);
    expect(applied).to.have.length(1);
  });

  it('skips seek when no keyframe is available', function() {
    const timer = { tickIndex: 3, isRunning: () => false, suspend() {} };
    const history = { getKeyframeAtOrBefore() { return null; } };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.seekToTick(2);

    expect(timer.tickIndex).to.equal(3);
  });

  it('toggles reverse playback and restores input state', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let suspended = 0;
    let continued = 0;
    let paused = 0;
    let resumed = 0;
    let truncated = 0;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    try {
      const timer = {
        frameTime: 60,
        TIME_PER_FRAME_MS: 60,
        isRunning: () => true,
        suspend() { suspended += 1; },
        continue() { continued += 1; }
      };
      const history = {
        pause() { paused += 1; },
        resume() { resumed += 1; },
        truncateAfter() { truncated += 1; }
      };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);

      controller.startReverse();
      expect(controller.isReversing).to.equal(true);
      expect(suspended).to.equal(1);
      expect(paused).to.equal(1);
      expect(game.inputEnabled).to.equal(false);

      controller.stopReverse();
      expect(controller.isReversing).to.equal(false);
      expect(resumed).to.equal(1);
      expect(truncated).to.equal(1);
      expect(continued).to.equal(1);
      expect(game.inputEnabled).to.equal(true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('uses a sane reverse frame time when timer frame time is invalid', function() {
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
        TIME_PER_FRAME_MS: 0,
        isRunning: () => false,
        suspend() {},
        tickIndex: 100
      };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const history = { pause() {}, resume() {} };
      const controller = new TimeTravelController(game, history);
      let steps = 0;
      controller.stepBackward = (count) => { steps += count; };

      controller.startReverse();
      expect(controller.isReversing).to.equal(true);
      expect(typeof rafCallback).to.equal('function');

      rafCallback(30);
      expect(steps).to.equal(0);
      rafCallback(61);
      expect(steps).to.equal(1);

      controller.stopReverse();
      expect(controller.isReversing).to.equal(false);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('stores prior input state when missing', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    try {
      const timer = { frameTime: 60, TIME_PER_FRAME_MS: 60, isRunning: () => false, suspend() {} };
      const history = { pause() {} };
      const game = { getGameTimer: () => timer };
      const controller = new TimeTravelController(game, history);

      controller.startReverse();
      expect(controller._prevInputEnabled).to.equal(true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('marks game gui on reverse toggle', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    try {
      const timer = { frameTime: 60, TIME_PER_FRAME_MS: 60, isRunning: () => false, suspend() {}, continue() {} };
      const history = { pause() {}, resume() {} };
      const game = { getGameTimer: () => timer, inputEnabled: true, gameGui: { gameTimeChanged: false } };
      const controller = new TimeTravelController(game, history);

      controller.toggleReverse();
      expect(controller.isReversing).to.equal(true);
      expect(game.gameGui.gameTimeChanged).to.equal(true);

      game.gameGui.gameTimeChanged = false;
      controller.toggleReverse();
      expect(controller.isReversing).to.equal(false);
      expect(game.gameGui.gameTimeChanged).to.equal(true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });
});
