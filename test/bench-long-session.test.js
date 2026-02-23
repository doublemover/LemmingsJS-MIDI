import { expect } from 'chai';
import { evaluateLongSessionGates, PROFILE_PRESETS } from '../scripts/bench-long-session.js';

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
});
