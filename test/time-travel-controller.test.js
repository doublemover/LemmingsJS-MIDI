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
});
