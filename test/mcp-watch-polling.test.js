import { expect } from 'chai';
import { WatchPollingController } from '../mcp/watchPolling.js';

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
});
