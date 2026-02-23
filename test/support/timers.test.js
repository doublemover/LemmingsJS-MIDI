import { expect } from 'chai';
import { withFakeClock, withFakeClockAndPerformance } from './timers.js';

describe('test support timers helpers', function () {
  it('keeps fake Date active for async callbacks', async function () {
    const result = await withFakeClock(async (clock) => {
      clock.tick(42);
      await Promise.resolve();
      return Date.now();
    });

    expect(result).to.equal(42);
    expect(Date.now()).to.not.equal(42);
  });

  it('keeps fake performance active for async callbacks', async function () {
    const originalPerformance = globalThis.performance;
    const value = await withFakeClockAndPerformance(async (clock) => {
      clock.tick(15);
      await Promise.resolve();
      return globalThis.performance.now();
    });

    expect(value).to.equal(15);
    expect(globalThis.performance).to.equal(originalPerformance);
  });
});
