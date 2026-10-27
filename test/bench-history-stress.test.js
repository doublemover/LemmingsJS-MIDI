import { expect } from 'chai';
import {
  buildUrl,
  createHistoryBenchConfig,
  DEFAULT_BASE_URL,
  parseArgs,
  parseSpeedList,
  readHistoryAfterFrame,
  sampleHistoryWindow,
  summarizeTimings,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-history-stress.js';

describe('bench-history-stress helpers', function () {
  it('observes history after the scheduled game frame rather than its stale prior state', async function () {
    let frame, reads = 0, history = { spanTicks: 2997 };
    const observation = readHistoryAfterFrame({ requestAnimationFrame: callback => { frame = callback; },
      __E2E__: { getState: () => { reads++; return { game: { history } }; } } });
    expect(reads).to.equal(0);
    history = { spanTicks: 3004 };
    frame();
    expect(await observation).to.equal(history);
    expect(reads).to.equal(1);
  });
  it('includes the terminal history observation and clamps the last sampling interval', async function () {
    let time = 0;
    const reads = [], waits = [];
    const result = await sampleHistoryWindow({ durationMs: 1100, sampleMs: 500, targetSpan: 6000,
      now: () => time, wait: async ms => { waits.push(ms); time += ms; },
      readHistory: async () => { reads.push(time); return { spanTicks: time * 5 }; } });
    expect(reads).to.deep.equal([0, 500, 1000, 1100]);
    expect(waits).to.deep.equal([500, 500, 100]);
    expect(result).to.deep.equal({ maxSpan: 5500, lastHistory: { spanTicks: 5500 }, sampleCount: 4, elapsedMs: 1100 });
  });

  it('stops at the actual target and propagates a failed terminal observation', async function () {
    let time = 0;
    const options = { durationMs: 1000, sampleMs: 500, targetSpan: 10, now: () => time, wait: async ms => { time += ms; } };
    expect((await sampleHistoryWindow({ ...options, readHistory: async () => ({ spanTicks: time / 50 }) })).elapsedMs).to.equal(500);
    time = 0;
    let failure;
    try {
      await sampleHistoryWindow({ ...options, targetSpan: 6000, readHistory: async () => { if (time >= 1000) throw new Error('terminal unavailable'); return { spanTicks: 0 }; } });
    } catch (error) { failure = error; }
    expect(failure?.message).to.equal('terminal unavailable');
  });
  it('parses args and number helpers safely', function () {
    const args = parseArgs(['--profile=soak', '--smoke']);
    expect(args.get('profile')).to.equal('soak');
    expect(args.get('smoke')).to.equal('true');
    expect(toPositiveNumber('30', 5)).to.equal(30);
    expect(toPositiveNumber('-1', 5)).to.equal(5);
    expect(toPositiveNumber(Symbol('duration'), 5)).to.equal(5);
    expect(toBoolean('off', true)).to.equal(false);
    expect(toBoolean('unknown', true)).to.equal(true);
  });

  it('parses speed lists and filters invalid entries', function () {
    expect(parseSpeedList('30, 60, bad, -2, 0, 120')).to.deep.equal([30, 60, 120]);
    expect(parseSpeedList('')).to.deep.equal([]);
  });

  it('falls back to profile speeds when provided speed list is invalid', function () {
    const warnings = [];
    const config = createHistoryBenchConfig({
      argv: ['--speeds=,,', '--headless=no'],
      env: {},
      log: {
        warn(message) {
          warnings.push(message);
        }
      }
    });

    expect(config.speeds).to.deep.equal([30, 60]);
    expect(config.headless).to.equal(false);
    expect(warnings.some((message) => String(message).includes('Invalid speed list'))).to.equal(true);
  });

  it('normalizes malformed URLs to the default bench URL', function () {
    const malformed = buildUrl('not-a-valid-url');
    expect(malformed.startsWith(DEFAULT_BASE_URL)).to.equal(true);
    const parsed = new URL(malformed);
    expect(parsed.searchParams.get('e2e')).to.equal('1');
    expect(parsed.searchParams.get('ph')).to.equal('true');
    expect(parsed.searchParams.get('endless')).to.equal('true');
  });

  it('builds stable timing summaries for empty and populated lists', function () {
    expect(summarizeTimings([])).to.deep.equal({
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      samplesMs: []
    });
    const summary = summarizeTimings([20, 10, 30]);
    expect(summary.count).to.equal(3);
    expect(summary.samplesMs).to.deep.equal([10, 20, 30]);
    expect(summary.p50Ms).to.equal(20);
    expect(summary.p95Ms).to.equal(30);
  });

  it('applies environment overrides for profile, speeds, and boolean gates', function () {
    const config = createHistoryBenchConfig({
      argv: [],
      env: {
        HISTORY_PROFILE: 'default',
        HISTORY_SPEEDS: '45,90',
        HISTORY_HEADLESS: 'off',
        HISTORY_REQUIRE_REPLAY_PARITY: '0',
        HISTORY_REQUIRE_BOUNDED_RETENTION: 'no',
        HISTORY_REQUIRE_TARGET_SPAN: 'yes',
        HISTORY_REQUIRE_COLD_COMPACTION: 'yes'
      },
      log: { warn() {} }
    });

    expect(config.requestedProfile).to.equal('default');
    expect(config.speeds).to.deep.equal([45, 90]);
    expect(config.headless).to.equal(false);
    expect(config.requireReplayParity).to.equal(false);
    expect(config.requireBoundedRetention).to.equal(false);
    expect(config.requireTargetSpan).to.equal(true);
    expect(config.requireColdCompaction).to.equal(true);
  });

  it('treats target span as a long-profile gate by default', function () {
    const smoke = createHistoryBenchConfig({
      argv: ['--profile=smoke'],
      env: {},
      log: { warn() {} }
    });
    const soak = createHistoryBenchConfig({
      argv: ['--profile=soak'],
      env: {},
      log: { warn() {} }
    });
    const strictSmoke = createHistoryBenchConfig({
      argv: ['--profile=smoke', '--requireTargetSpan=true'],
      env: {},
      log: { warn() {} }
    });

    expect(smoke.targetSpan).to.equal(6000);
    expect(smoke.requireTargetSpan).to.equal(false);
    expect(soak.requireTargetSpan).to.equal(true);
    expect(strictSmoke.requireTargetSpan).to.equal(true);
  });
});
