import FakeTimers from '@sinonjs/fake-timers';
import { patchGlobalValues } from './globals.js';

const DEFAULT_CLOCK_OPTIONS = {
  now: 0,
  toFake: ['setTimeout', 'clearTimeout', 'Date']
};

const installFakeClock = (options = {}) => (
  FakeTimers.install({ ...DEFAULT_CLOCK_OPTIONS, ...options })
);

const withFakeClock = (fn, options = {}) => {
  const clock = installFakeClock(options);
  try {
    return fn(clock);
  } finally {
    clock.uninstall();
  }
};

const withFakeClockAndPerformance = (fn, options = {}) => {
  const { performanceValue, ...clockOptions } = options;
  const clock = installFakeClock(clockOptions);
  const perf = typeof performanceValue === 'function'
    ? performanceValue(clock)
    : (performanceValue || { now: () => clock.now });
  const restore = patchGlobalValues({ performance: perf });
  try {
    return fn(clock);
  } finally {
    restore();
    clock.uninstall();
  }
};

export { installFakeClock, withFakeClock, withFakeClockAndPerformance };
