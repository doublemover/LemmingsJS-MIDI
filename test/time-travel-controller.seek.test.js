import { expect } from 'chai';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

describe('TimeTravelController seek and retention', function() {
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
});
