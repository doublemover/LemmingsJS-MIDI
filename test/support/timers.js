import FakeTimers from '@sinonjs/fake-timers';
import { patchGlobalValues } from './globals.js';

const DEFAULT_CLOCK_OPTIONS = {
  now: 0,
  toFake: ['setTimeout', 'clearTimeout', 'Date']
};

const installFakeClock = (options = {}) => (
  FakeTimers.install({ ...DEFAULT_CLOCK_OPTIONS, ...options })
);

const isPromiseLike = (value) => (
  !!value && typeof value.then === 'function'
);

const runWithCleanup = (fn, cleanup) => {
  let result;
  try {
    result = fn();
  } catch (error) {
    cleanup();
    throw error;
  }
  if (isPromiseLike(result)) {
    return result.finally(cleanup);
  }
  cleanup();
  return result;
};

const withFakeClock = (fn, options = {}) => {
  const clock = installFakeClock(options);
  return runWithCleanup(() => fn(clock), () => {
    clock.uninstall();
  });
};

const withFakeClockAndPerformance = (fn, options = {}) => {
  const { performanceValue, ...clockOptions } = options;
  const clock = installFakeClock(clockOptions);
  const perf = typeof performanceValue === 'function'
    ? performanceValue(clock)
    : (performanceValue || { now: () => clock.now });
  const restore = patchGlobalValues({ performance: perf });
  return runWithCleanup(() => fn(clock), () => {
    restore();
    clock.uninstall();
  });
};

export { installFakeClock, withFakeClock, withFakeClockAndPerformance };
