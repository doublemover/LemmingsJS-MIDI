import { expect } from 'chai';
import {
  buildBenchUrl,
  DEFAULT_BASE_URL,
  evaluateLongSessionGates,
  normalizeLongSessionSample,
  PROFILE_PRESETS,
  toBoolean,
  toNonNegativeNumber,
  toPositiveNumber
} from '../scripts/bench-long-session.js';

describe('bench long-session gates', function () {
  it('passes when replay and runtime metrics stay within thresholds', function () {
    const thresholds = {
      ...PROFILE_PRESETS.smoke,
      maxHeapGrowthBytes: 64,
      maxHeapChurnBytes: 128,
      maxSoundQueueRatio: 0.75,
      maxSoundQueueGrowth: 4,
      minHistorySpanTicks: 100,
      maxTriggerDrift: 0
    };

    const result = evaluateLongSessionGates({
      samples: [
        {
          tickIndex: 100,
          heapUsedBytes: 1024,
          soundQueued: 1,
          soundQueueLimit: 8,
          historySpanTicks: 120,
          triggerCount: 7
        },
        {
          tickIndex: 160,
          heapUsedBytes: 1040,
          soundQueued: 2,
          soundQueueLimit: 8,
          historySpanTicks: 180,
          triggerCount: 7
        },
        {
          tickIndex: 220,
          heapUsedBytes: 1060,
          soundQueued: 3,
          soundQueueLimit: 8,
          historySpanTicks: 240,
          triggerCount: 7
        }
      ],
      replayChecks: [{ checked: true, hashMatch: true }],
      thresholds
    });

    expect(result.failures).to.deep.equal([]);
    expect(result.metrics.heapChurnBytes).to.equal(36);
    expect(result.metrics.soundQueueGrowth).to.equal(2);
    expect(result.metrics.tickProgress).to.equal(120);
  });

  it('fails on churn, queue growth, drift, and replay mismatches', function () {
    const thresholds = {
      ...PROFILE_PRESETS.smoke,
      maxHeapGrowthBytes: 8,
      maxHeapChurnBytes: 32,
      maxSoundQueueRatio: 0.5,
      maxSoundQueueGrowth: 2,
      minHistorySpanTicks: 500,
      maxTriggerDrift: 0
    };

    const result = evaluateLongSessionGates({
      samples: [
        {
          tickIndex: 200,
          heapUsedBytes: 1000,
          soundQueued: 1,
          soundQueueLimit: 4,
          historySpanTicks: 50,
          triggerCount: 9
        },
        {
          tickIndex: 200,
          heapUsedBytes: 1050,
          soundQueued: 4,
          soundQueueLimit: 4,
          historySpanTicks: 100,
          triggerCount: 10
        },
        {
          tickIndex: 200,
          heapUsedBytes: 1120,
          soundQueued: 4,
          soundQueueLimit: 4,
          historySpanTicks: 120,
          triggerCount: 10
        }
      ],
      replayChecks: [{ checked: true, hashMatch: false }],
      thresholds
    });

    expect(result.failures).to.include.members([
      'tick_progress_stalled',
      'heap_growth_exceeded',
      'heap_churn_exceeded',
      'sound_queue_ratio_exceeded',
      'sound_queue_growth_exceeded',
      'history_span_below_minimum',
      'trigger_count_drift_detected',
      'replay_hash_mismatch'
    ]);
  });

  it('normalizes sample payloads to finite numeric defaults', function () {
    const sample = normalizeLongSessionSample({
      elapsedMs: '10',
      tickIndex: '42',
      historySpanTicks: null,
      coldBlockCount: undefined,
      soundQueued: '3',
      soundQueueLimit: '12',
      triggerCount: Number.NaN,
      heapUsedBytes: '2048'
    });
    expect(sample).to.deep.equal({
      elapsedMs: 10,
      tickIndex: 42,
      historySpanTicks: 0,
      coldBlockCount: 0,
      soundQueued: 3,
      soundQueueLimit: 12,
      triggerCount: 0,
      heapUsedBytes: 2048
    });

    const symbolSample = normalizeLongSessionSample({
      elapsedMs: Symbol('elapsed'),
      tickIndex: Symbol('tick'),
      historySpanTicks: Symbol('history'),
      coldBlockCount: Symbol('cold'),
      soundQueued: Symbol('queued'),
      soundQueueLimit: Symbol('limit'),
      triggerCount: Symbol('trigger'),
      heapUsedBytes: Symbol('heap')
    });
    expect(symbolSample).to.deep.equal({
      elapsedMs: 0,
      tickIndex: 0,
      historySpanTicks: 0,
      coldBlockCount: 0,
      soundQueued: 0,
      soundQueueLimit: 0,
      triggerCount: 0,
      heapUsedBytes: 0
    });
  });

  it('clamps invalid normalized sample values to safe numeric defaults', function () {
    const sample = normalizeLongSessionSample({
      elapsedMs: Infinity,
      tickIndex: Infinity,
      historySpanTicks: -3,
      coldBlockCount: Number.NaN,
      soundQueued: -1,
      soundQueueLimit: -1,
      triggerCount: -10,
      heapUsedBytes: Infinity
    });
    expect(sample).to.deep.equal({
      elapsedMs: 0,
      tickIndex: 0,
      historySpanTicks: 0,
      coldBlockCount: 0,
      soundQueued: 0,
      soundQueueLimit: 0,
      triggerCount: 0,
      heapUsedBytes: 0
    });
  });

  it('parses positive and non-negative threshold helpers safely', function () {
    expect(toPositiveNumber(undefined, 7)).to.equal(7);
    expect(toPositiveNumber('-5', 7)).to.equal(7);
    expect(toPositiveNumber('abc', 7)).to.equal(7);
    expect(toPositiveNumber('4', 7)).to.equal(4);
    expect(toPositiveNumber(Symbol('positive'), 7)).to.equal(7);

    expect(toNonNegativeNumber(undefined, 3)).to.equal(3);
    expect(toNonNegativeNumber(-1, 3)).to.equal(3);
    expect(toNonNegativeNumber('NaN', 3)).to.equal(3);
    expect(toNonNegativeNumber(0, 3)).to.equal(0);
    expect(toNonNegativeNumber('5', 3)).to.equal(5);
    expect(toNonNegativeNumber(Symbol('non-negative'), 3)).to.equal(3);
    expect(toBoolean('false', true)).to.equal(false);
    expect(toBoolean('1', false)).to.equal(true);
    expect(toBoolean('unknown', false)).to.equal(false);
  });

  it('handles empty and partial replay samples without throwing', function () {
    const result = evaluateLongSessionGates({
      samples: [],
      replayChecks: [{ checked: true }, { checked: true, hashMatch: false }],
      thresholds: PROFILE_PRESETS.smoke
    });
    expect(result.metrics.sampleCount).to.equal(0);
    expect(result.metrics.replayMismatchCount).to.equal(1);
    expect(result.failures).to.include('tick_progress_stalled');
    expect(result.failures).to.include('replay_hash_mismatch');
  });

  it('normalizes malformed bench URLs and injects perf profile', function () {
    const malformed = buildBenchUrl('bad-url');
    expect(malformed.startsWith(DEFAULT_BASE_URL)).to.equal(true);
    const parsed = new URL(malformed);
    expect(parsed.searchParams.get('e2e')).to.equal('1');
    expect(parsed.searchParams.get('profile')).to.equal('perf');

    const explicit = new URL(buildBenchUrl('https://localhost:8080/?profile=custom'));
    expect(explicit.searchParams.get('profile')).to.equal('custom');
  });
});
