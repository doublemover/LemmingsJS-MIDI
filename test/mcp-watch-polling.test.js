import { expect } from 'chai';
import {
  WatchPollingController,
  parseJsonPointer,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState
} from '../mcp/watchPolling.js';

const createFakeClock = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  const flush = async () => {
    while (true) {
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      if (!due.length) break;
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  };

  return {
    nowFn: () => now,
    setTimerFn(fn, delayMs) {
      const id = nextId++;
      timers.set(id, { fn, at: now + delayMs });
      return id;
    },
    clearTimerFn(id) {
      timers.delete(id);
    },
    async flush() {
      await flush();
    },
    async advance(ms) {
      now += ms;
      await flush();
    },
    nextDueIn() {
      if (!timers.size) return null;
      const nextAt = Math.min(...Array.from(timers.values()).map((timer) => timer.at));
      return nextAt - now;
    }
  };
};

describe('WatchPollingController', function () {
  it('backs off when idle and resets to active cadence after a trigger', async function () {
    const clock = createFakeClock();
    const outcomes = [0, 0, 0, 2];
    let callCount = 0;
    const controller = new WatchPollingController({
      hasWatchesFn: () => true,
      pollFn: async () => ({ triggeredCount: outcomes[callCount++] || 0 }),
      setTimerFn: clock.setTimerFn,
      clearTimerFn: clock.clearTimerFn,
      nowFn: clock.nowFn,
      config: {
        minMs: 0,
        activeMs: 100,
        maxMs: 400,
        backoffFactor: 2,
        idleThreshold: 2,
        onDemandMinMs: 0
      }
    });

    controller.start();
    await clock.flush();
    expect(controller.getSnapshot().delayMs).to.equal(100);

    await clock.advance(100);
    expect(controller.getSnapshot().delayMs).to.equal(200);

    await clock.advance(200);
    expect(controller.getSnapshot().delayMs).to.equal(400);

    await clock.advance(400);
    expect(controller.getSnapshot().delayMs).to.equal(100);
    controller.stop();
  });

  it('reschedules long idle polls when immediate work is requested', async function () {
    const clock = createFakeClock();
    const controller = new WatchPollingController({
      hasWatchesFn: () => true,
      pollFn: async () => ({ triggeredCount: 0 }),
      setTimerFn: clock.setTimerFn,
      clearTimerFn: clock.clearTimerFn,
      nowFn: clock.nowFn,
      config: {
        minMs: 0,
        activeMs: 100,
        maxMs: 400,
        backoffFactor: 2,
        idleThreshold: 1,
        onDemandMinMs: 0
      }
    });

    controller.start();
    await clock.flush();
    await clock.advance(200);
    expect(controller.getSnapshot().delayMs).to.equal(400);
    expect(clock.nextDueIn()).to.equal(400);

    controller.request({ immediate: true });
    expect(clock.nextDueIn()).to.equal(0);
    await clock.flush();
    controller.stop();
  });

  it('throttles on-demand tickNow calls by onDemandMinMs', async function () {
    const clock = createFakeClock();
    let callCount = 0;
    const controller = new WatchPollingController({
      hasWatchesFn: () => true,
      pollFn: async () => ({ triggeredCount: (callCount += 1) }),
      setTimerFn: clock.setTimerFn,
      clearTimerFn: clock.clearTimerFn,
      nowFn: clock.nowFn,
      config: {
        minMs: 0,
        activeMs: 5000,
        maxMs: 5000,
        onDemandMinMs: 1000
      }
    });

    controller.start();
    await clock.flush();
    expect(callCount).to.equal(1);

    await controller.tickNow();
    expect(callCount).to.equal(1);

    await clock.advance(1000);
    await controller.tickNow();
    expect(callCount).to.equal(2);
    controller.stop();
  });

  it('clears scheduled timers when stopped', async function () {
    const clock = createFakeClock();
    const controller = new WatchPollingController({
      hasWatchesFn: () => true,
      pollFn: async () => ({ triggeredCount: 0 }),
      setTimerFn: clock.setTimerFn,
      clearTimerFn: clock.clearTimerFn,
      nowFn: clock.nowFn,
      config: {
        minMs: 0,
        activeMs: 100,
        maxMs: 400
      }
    });

    controller.start();
    await clock.flush();
    expect(clock.nextDueIn()).to.equal(100);
    controller.stop();
    expect(clock.nextDueIn()).to.equal(null);
  });

  it('backs off when pollFn throws and recovers after a triggered poll', async function () {
    const clock = createFakeClock();
    let attempts = 0;
    const controller = new WatchPollingController({
      hasWatchesFn: () => true,
      pollFn: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('boom');
        }
        return { triggeredCount: 1 };
      },
      setTimerFn: clock.setTimerFn,
      clearTimerFn: clock.clearTimerFn,
      nowFn: clock.nowFn,
      config: {
        minMs: 0,
        activeMs: 100,
        maxMs: 400,
        backoffFactor: 2,
        idleThreshold: 1,
        onDemandMinMs: 0
      }
    });

    controller.start();
    await clock.flush();
    expect(controller.getSnapshot().delayMs).to.equal(200);
    expect(controller.getSnapshot().idlePolls).to.equal(1);

    await clock.advance(200);
    expect(controller.getSnapshot().delayMs).to.equal(100);
    expect(controller.getSnapshot().idlePolls).to.equal(0);
    controller.stop();
  });
});

describe('watch pointer helpers', function () {
  it('parses and resolves JSON pointers with escaped segments', function () {
    const state = {
      game: {
        skills: {
          '~foo/bar': 7
        }
      }
    };
    const path = parseJsonPointer('/game/skills/~0foo~1bar');
    const slashPath = parseJsonPointer('/');
    expect(path).to.deep.equal(['game', 'skills', '~foo/bar']);
    expect(slashPath).to.deep.equal(['']);
    expect(readPointerValue(state, path)).to.equal(7);
    expect(readPointerValue(state, '/game/skills/~0foo~1bar')).to.equal(7);
    expect(readPointerValue({ '': 42 }, '/')).to.equal(42);
    expect(readPointerValue(state, '')).to.equal(state);
  });

  it('treats invalid JSON pointers as undefined lookups', function () {
    const invalidPath = parseJsonPointer('game/timer/tickIndex');
    expect(invalidPath).to.equal(null);
    expect(readPointerValue({ game: { timer: { tickIndex: 7 } } }, invalidPath)).to.equal(undefined);

    const tracker = createPointerWatchState('game/timer/tickIndex', {
      game: { timer: { tickIndex: 7 } }
    });
    expect(tracker.path).to.equal(null);
    expect(updatePointerWatchState(tracker, {
      game: { timer: { tickIndex: 8 } }
    })).to.equal(false);
  });

  it('tracks primitive pointer changes without stringify comparisons', function () {
    const tracker = createPointerWatchState('/game/timer/tickIndex', {
      game: { timer: { tickIndex: 10 } }
    });
    expect(updatePointerWatchState(tracker, { game: { timer: { tickIndex: 10 } } })).to.equal(false);
    expect(updatePointerWatchState(tracker, { game: { timer: { tickIndex: 11 } } })).to.equal(true);
    expect(updatePointerWatchState(tracker, { game: { timer: { tickIndex: 11 } } })).to.equal(false);
  });

  it('detects structural object changes while ignoring referential churn', function () {
    const tracker = createPointerWatchState('/game/skills', {
      game: {
        skills: {
          selected: 1,
          counts: [5, 4, 3]
        }
      }
    });
    expect(updatePointerWatchState(tracker, {
      game: {
        skills: {
          selected: 1,
          counts: [5, 4, 3]
        }
      }
    })).to.equal(false);
    expect(updatePointerWatchState(tracker, {
      game: {
        skills: {
          selected: 2,
          counts: [5, 4, 3]
        }
      }
    })).to.equal(true);
  });

  it('treats object key insertion order as stable for pointer fingerprints', function () {
    const tracker = createPointerWatchState('/payload', {
      payload: { a: 1, b: 2 }
    });
    expect(updatePointerWatchState(tracker, {
      payload: { b: 2, a: 1 }
    })).to.equal(false);
  });

  it('detects ArrayBuffer payload changes by content', function () {
    const initial = new Uint8Array([1, 2, 3]).buffer;
    const tracker = createPointerWatchState('/payload', { payload: initial });
    const same = new Uint8Array([1, 2, 3]).buffer;
    const changed = new Uint8Array([1, 2, 4]).buffer;
    expect(updatePointerWatchState(tracker, { payload: same })).to.equal(false);
    expect(updatePointerWatchState(tracker, { payload: changed })).to.equal(true);
  });

  it('tracks Set payload changes while ignoring insertion order', function () {
    const tracker = createPointerWatchState('/payload', {
      payload: new Set([1, 2, 3])
    });
    expect(updatePointerWatchState(tracker, {
      payload: new Set([3, 2, 1])
    })).to.equal(false);
    expect(updatePointerWatchState(tracker, {
      payload: new Set([1, 2, 4])
    })).to.equal(true);
  });

  it('tracks Map payload changes while ignoring insertion order', function () {
    const tracker = createPointerWatchState('/payload', {
      payload: new Map([['a', 1], ['b', 2]])
    });
    expect(updatePointerWatchState(tracker, {
      payload: new Map([['b', 2], ['a', 1]])
    })).to.equal(false);
    expect(updatePointerWatchState(tracker, {
      payload: new Map([['a', 1], ['b', 3]])
    })).to.equal(true);
  });
});
