import { expect } from 'chai';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

describe('TimeTravelController', function() {
  it('steps backward and emits reverse sound events', function() {
    const applied = [];
    const events = [];
    const timer = {
      tickIndex: 1,
      isRunning: () => false,
      suspend() {},
      frameTime: 60,
      TIME_PER_FRAME_MS: 60
    };
    const history = {
      deltas: [],
      getDelta(tick) { return this.deltas[tick]; },
      applyDeltaBackward(game, delta) {
        applied.push(delta);
      }
    };
    const delta = { soundEvents: [{ sfxId: 2, type: 'test' }] };
    history.deltas[0] = delta;
    const game = {
      getGameTimer: () => timer,
      soundEvents: { emit: event => events.push(event) },
      render() {},
      gameGui: { gameTimeChanged: false }
    };
    const controller = new TimeTravelController(game, history);

    controller.stepBackward(1);

    expect(timer.tickIndex).to.equal(0);
    expect(applied).to.have.length(1);
    expect(events[0].reverse).to.equal(true);
    expect(events[0].sfxId).to.equal(2);
    expect(game.gameGui.gameTimeChanged).to.equal(true);
  });

  it('configures bounded history retention on construction', function() {
    let received = null;
    const history = {
      configureRetention(policy) {
        received = policy;
        return { ...policy, preserveFutureHistory: false };
      }
    };
    const controller = new TimeTravelController({}, history);
    expect(received).to.eql({
      enableHistoryCap: true,
      historyCapTicks: 20000,
      historyWarnTicks: 15000
    });
    expect(controller.getHistoryRetention()).to.eql({
      enableHistoryCap: true,
      historyCapTicks: 20000,
      historyWarnTicks: 15000,
      preserveFutureHistory: false
    });
  });

  it('applies explicit history retention overrides', function() {
    const calls = [];
    const history = {
      configureRetention(policy) {
        calls.push(policy);
        return { ...policy };
      }
    };
    const controller = new TimeTravelController({}, history);
    const applied = controller.setHistoryRetention({
      historyCapTicks: 9000,
      historyWarnTicks: 7000,
      preserveFutureHistory: true
    });
    expect(calls).to.have.length(2);
    expect(calls[1]).to.eql({
      enableHistoryCap: true,
      historyCapTicks: 9000,
      historyWarnTicks: 7000,
      preserveFutureHistory: true
    });
    expect(applied).to.eql(calls[1]);
    expect(controller.getHistoryRetention()).to.eql(calls[1]);
  });

  it('preserves replay hash through seek and reverse playback operations', function() {
    const timer = { tickIndex: 2, isRunning: () => false, suspend() {} };
    const timeline = [{ tick: 0, x: 1 }, { tick: 1, x: 2 }];
    const hash = () => JSON.stringify(timeline);
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; },
      getDelta(tick) { return timeline[tick] || null; },
      applyKeyframe() {},
      applyDeltaForward() {},
      applyDeltaBackward() {},
      computeReplayHash() { return hash(); }
    };
    const game = {
      getGameTimer: () => timer,
      render() {},
      gameGui: { gameTimeChanged: false }
    };
    const controller = new TimeTravelController(game, history);
    const before = history.computeReplayHash();

    controller.seekToTick(1);
    controller.stepBackward(1);

    const after = history.computeReplayHash();
    expect(after).to.equal(before);
  });

  it('preserves replay hash through long seek and reverse cycles', function() {
    const timer = { tickIndex: 180, isRunning: () => false, suspend() {} };
    const timeline = Array.from({ length: 240 }, (_, tick) => ({
      tick,
      soundEvents: tick % 15 === 0 ? [{ sfxId: tick % 8 }] : []
    }));
    const hash = () => JSON.stringify(timeline);
    const history = {
      getKeyframeAtOrBefore() { return { tickIndex: 0 }; },
      getDelta(tick) { return timeline[tick] || null; },
      applyKeyframe() {},
      applyDeltaForward() {},
      applyDeltaBackward() {},
      computeReplayHash() { return hash(); }
    };
    const game = {
      getGameTimer: () => timer,
      render() {},
      gameGui: { gameTimeChanged: false }
    };
    const controller = new TimeTravelController(game, history);
    const before = history.computeReplayHash();

    for (let i = 0; i < 40; i += 1) {
      const seekTarget = (i * 13) % 180;
      controller.seekToTick(seekTarget);
      controller.stepBackward((i % 5) + 1);
    }
    controller.seekToTick(180);

    const after = history.computeReplayHash();
    expect(after).to.equal(before);
  });

  it('returns early when dependencies are missing', function() {
    const controller = new TimeTravelController(null, null);
    controller.stepBackward(1);
    controller.seekToTick(1);
    controller.startReverse();
    expect(controller.isReversing).to.equal(false);
  });

  it('does not enter reverse mode when RAF APIs are unavailable', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    let suspended = 0;
    let paused = 0;
    globalThis.performance = { now: () => 0 };
    globalThis.window = undefined;
    try {
      const timer = {
        frameTime: 60,
        TIME_PER_FRAME_MS: 60,
        isRunning: () => true,
        suspend() { suspended += 1; }
      };
      const history = { pause() { paused += 1; } };
      const game = { getGameTimer: () => timer, inputEnabled: true };
      const controller = new TimeTravelController(game, history);

      controller.startReverse();

      expect(controller.isReversing).to.equal(false);
      expect(suspended).to.equal(0);
      expect(paused).to.equal(0);
      expect(game.inputEnabled).to.equal(true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('suspends the timer when stepping backward while running', function() {
    let suspended = 0;
    const timer = {
      tickIndex: 1,
      isRunning: () => true,
      suspend() { suspended += 1; }
    };
    const history = {
      getDelta() { return { soundEvents: [] }; },
      applyDeltaBackward() {}
    };
    const game = { getGameTimer: () => timer, render() {}, gameGui: { gameTimeChanged: false } };
    const controller = new TimeTravelController(game, history);

    controller.stepBackward(1);

    expect(suspended).to.equal(1);
  });

  it('clamps backward steps at tick zero', function() {
    const timer = {
      tickIndex: 0,
      isRunning: () => false,
      suspend() {}
    };
    let applied = 0;
    const history = {
      applyDeltaBackward() { applied += 1; }
    };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);

    controller.stepBackward(3);

    expect(timer.tickIndex).to.equal(0);
    expect(applied).to.equal(0);
  });

  it('seeks backward when a delta is missing', function() {
    const timer = { tickIndex: 2, isRunning: () => false, suspend() {} };
    const history = { deltas: [], getDelta() { return null; } };
    const game = { getGameTimer: () => timer, render() {} };
    const controller = new TimeTravelController(game, history);
    const calls = [];
    controller.seekToTick = (tick) => calls.push(tick);

    controller.stepBackward(1);

    expect(calls).to.eql([1]);
    expect(timer.tickIndex).to.equal(2);
  });

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
