import { expect } from 'chai';
import {
  BENCH_PROFILES,
  buildUrl,
  createPerformanceBenchConfig,
  median,
  parseArgs,
  summarize,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-performance.js';

describe('bench-performance helpers', function () {
  it('parses args and primitive helpers safely', function () {
    const args = parseArgs(['--profile=stress', '--smoke', '--headless=false']);
    expect(args.get('profile')).to.equal('stress');
    expect(args.get('smoke')).to.equal('true');
    expect(toPositiveNumber('5', 1)).to.equal(5);
    expect(toPositiveNumber('-1', 1)).to.equal(1);
    expect(toBoolean('off', true)).to.equal(false);
    expect(toBoolean('on', false)).to.equal(true);
    expect(toBoolean('invalid', false)).to.equal(false);
    expect(toPositiveNumber(Symbol('duration'), 7)).to.equal(7);
  });

  it('builds config with smoke defaults, mode fallback, and boolean parsing', function () {
    const warnings = [];
    const config = createPerformanceBenchConfig({
      argv: ['--mode=wat', '--headless=0'],
      env: {},
      warn(message) {
        warnings.push(message);
      }
    });

    expect(config.requestedProfile).to.equal('smoke');
    expect(config.durationMs).to.equal(BENCH_PROFILES.smoke.durationMs);
    expect(config.mode).to.equal(BENCH_PROFILES.smoke.mode);
    expect(config.headless).to.equal(false);
    expect(warnings.some(message => String(message).includes('defaulting to smoke'))).to.equal(true);
    expect(warnings.some(message => String(message).includes('Unsupported mode'))).to.equal(true);
  });

  it('falls back to smoke profile when explicit profile is unknown', function () {
    const warnings = [];
    const config = createPerformanceBenchConfig({
      argv: ['--profile=unknown'],
      env: {},
      warn(message) {
        warnings.push(message);
      }
    });

    expect(config.requestedProfile).to.equal('unknown');
    expect(config.durationMs).to.equal(BENCH_PROFILES.smoke.durationMs);
    expect(warnings.some(message => String(message).includes('Unknown profile'))).to.equal(true);
  });

  it('normalizes malformed URLs while preserving existing query precedence', function () {
    const malformed = buildUrl('not-a-valid-url', { profile: 'perf', perfOverlay: 'true' });
    const malformedUrl = new URL(malformed);
    expect(malformedUrl.searchParams.get('e2e')).to.equal('1');
    expect(malformedUrl.searchParams.get('profile')).to.equal('perf');

    const explicit = buildUrl(
      'https://localhost:8080/?e2e=0&profile=custom',
      { profile: 'perf', performanceAPI: 'true' }
    );
    const explicitUrl = new URL(explicit);
    expect(explicitUrl.searchParams.get('e2e')).to.equal('1');
    expect(explicitUrl.searchParams.get('profile')).to.equal('custom');
    expect(explicitUrl.searchParams.get('performanceAPI')).to.equal('true');
  });

  it('summarizes numeric key series and ignores non-finite values', function () {
    const stats = summarize([
      { tps: 10 },
      { tps: 20 },
      { tps: Number.NaN },
      { tps: 30 }
    ], 'tps');
    expect(stats).to.deep.equal({
      min: 10,
      max: 30,
      p50: 20,
      p95: 20,
      avg: 20
    });
  });

  it('computes medians for odd, even, and empty input arrays', function () {
    expect(median([])).to.equal(0);
    expect(median([5])).to.equal(5);
    expect(median([3, 1, 2])).to.equal(2);
    expect(median([4, 1, 2, 3])).to.equal(2.5);
  });
});
