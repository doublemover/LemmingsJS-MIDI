import { expect } from 'chai';
import {
  buildUrl,
  createHistoryBenchConfig,
  DEFAULT_BASE_URL,
  parseArgs,
  parseSpeedList,
  prepareHistoryBenchmarkRetention,
  readHistoryAfterFrame,
  sampleHistoryWindow,
  summarizeTimings,
  toBoolean,
  toPositiveNumber
} from '../scripts/bench-history-stress.js';
import { setHistoryRetention } from '../js/app/e2e/E2EGameControls.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';
import { createHistoryFixture } from './support/history-fixtures.js';

const retentionFixture = () => {
  const f = createHistoryFixture(); let running = true, requests = 0;
  f.timer.isRunning = () => running; f.game.timeTravel = new TimeTravelController(f.game, f.history);
  const view = { game: f.game }, scope = { __E2E__: {
    pause() { running = false; return true; },
    getState: () => ({ game: { timer: { running }, history: f.history.getHistoryStats() } }),
    setHistoryRetention(policy) { requests++; return setHistoryRetention(view, policy); }
  } };
  return { ...f, view, scope, requests: () => requests, running: () => running };
};

describe('bench-history-stress helpers', function () {
  it('prepares an actually applied bounded cap for the declared target through the paused history owner', () => {
    const f = retentionFixture(), result = prepareHistoryBenchmarkRetention({ targetSpan: 60000 }, f.scope);
    expect(result).to.include({ changed: true, targetSpan: 60000 });
    expect(result.before.historyCapTicks).to.equal(20000); expect(result.applied.historyCapTicks).to.equal(60000);
    expect(f.history.options.enableHistoryCap).to.equal(true); expect(f.history.options.historyCapTicks).to.equal(60000);
    expect(f.game.timeTravel.getHistoryRetention().historyCapTicks).to.equal(60000);
    expect(f.running()).to.equal(false); expect(f.requests()).to.equal(1); f.history.detach();
  });
  it('keeps an adequate bounded smoke policy without requesting a larger owner reservation', () => {
    const f = retentionFixture(), result = prepareHistoryBenchmarkRetention({ targetSpan: 6000, requireTargetSpan: false }, f.scope);
    expect(result.changed).to.equal(false); expect(result.applied.historyCapTicks).to.equal(20000);
    expect(f.requests()).to.equal(0); f.history.detach();
  });
  it('rejects a claimed retention change that the actual history owner did not apply', () => {
    const f = retentionFixture(); f.scope.__E2E__.setHistoryRetention = policy => ({ ...policy });
    expect(() => prepareHistoryBenchmarkRetention({ targetSpan: 60000 }, f.scope)).to.throw('not applied');
    expect(f.history.options.historyCapTicks).to.equal(20000); f.history.detach();
  });
  it('refuses unsupported targets before pausing or changing the active owner', () => {
    const f = retentionFixture();
    for (const targetSpan of [0, 1.5, 100001, Infinity]) expect(() => prepareHistoryBenchmarkRetention({ targetSpan }, f.scope)).to.throw('target');
    expect(f.running()).to.equal(true); expect(f.requests()).to.equal(0); f.history.detach();
  });
  it('keeps the E2E setter bounded, paused and limited to retention fields', () => {
    const f = retentionFixture(), policy = { enableHistoryCap: true, historyCapTicks: 60000, historyWarnTicks: 54000 };
    expect(setHistoryRetention(f.view, policy)).to.equal(false); f.scope.__E2E__.pause();
    for (const patch of [{ enableHistoryCap: false }, { historyCapTicks: 100001 }, { historyWarnTicks: 60001 }, { preserveFutureHistory: false }]) {
      expect(setHistoryRetention(f.view, { ...policy, ...patch })).to.equal(false);
    }
    f.game.timeTravel._reverseActive = true; expect(setHistoryRetention(f.view, policy)).to.equal(false);
    expect(f.history.options.historyCapTicks).to.equal(20000); f.history.detach();
  });
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
