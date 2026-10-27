import { expect } from 'chai';
import { evaluateSmokeResults, createSmokeRunPlan } from '../scripts/bench-smoke.js';
import { createHistoryBenchConfig } from '../scripts/bench-history-stress.js';
import { createBenchmarkReceipt, REQUIRED_SMOKE_HOTPATHS } from '../scripts/BenchmarkReceipt.js';

const thresholds = { perfP95FrameMsMax: 250, perfP50TpsMin: 15, historySpanRatioMin: 0.5,
  antsAvgMsMax: 250, tileCompositionAvgMsMax: 250, overlayPlaneAvgMsMax: 250, scaledBlitAvgMsMax: 250 };
const fixture = () => ({
  performance: { receipt: createBenchmarkReceipt('performance', 'smoke', ['bench:entrances:30']), sampleCount: 20,
    measurement: { kind: 'completed-work/v1', clock: 'browser-performance-now', frameDistribution: 'completed-raf-gap-ms' },
    samples: Array.from({ length: 20 }, (_, index) => ({ frameMs: 16, tps: 30, completedTicks: 15, measurementElapsedMs: 500,
      startTick: index * 15, tick: (index + 1) * 15, frameGapsMs: Array(31).fill(16), tickExecutionMs: Array(15).fill(1), renderExecutionMs: Array(15).fill(2),
      ready: true, running: true, reverse: false, continuousDirection: true, overflow: false, activeActors: 30, entrances: 30 })), frameStats: { p95: 16 }, tpsStats: { p50: 30 },
    filteredFrameStats: { p95: 16 }, filteredTpsStats: { p50: 30 } },
  history: { receipt: createBenchmarkReceipt('history', 'smoke', ['speed:30', 'speed:60']), failures: [],
    results: [30, 60].map(speedFactor => ({ speedFactor, maxSpanTicks: 6000, targetSpanTicks: 6000, sampleCount: 4,
      seekProbe: { status: 'complete', evidence: 'exact-forward-state-and-base64-terrain', deltaAvailable: true, hashMatch: true, startRestored: true, startTick: 6000, restoredTick: 6000,
        observations: ['first-touch-cold', 'return', 'warm-repeat', 'return'].map((phase, index) => ({ phase, targetTick: index % 2 ? 6000 : 1000, observedTick: index % 2 ? 6000 : 1000,
          accepted: true, exactStateMatch: true, durationMs: 1, coldDecodes: index === 0 ? 1 : 0, coldCacheHits: index === 0 ? 0 : 1, coldDecodedBytes: index === 0 ? 100 : 0 })) } })) },
  hotpaths: { receipt: createBenchmarkReceipt('hotpaths', 'smoke', REQUIRED_SMOKE_HOTPATHS),
    ...Object.fromEntries(REQUIRED_SMOKE_HOTPATHS.map(name => [name, { avgMs: 10, workIterations: 3000, sampleCount: 4, samplesMs: [10, 10, 10, 10] }])) }
});

describe('admitted benchmark smoke gates', () => {
  it('covers every declared soak sampling window without shortening the workload to fit the parent deadline', () => {
    const plan = createSmokeRunPlan({ soakRequested: true, env: {} });
    const history = createHistoryBenchConfig({ argv: plan.historyArgs, env: {}, log: { warn() {} } });
    expect(history.durationMs).to.equal(180000); expect(history.speeds).to.deep.equal([30, 60, 120]);
    expect(history.maxRuntimeMs).to.be.at.least(history.durationMs * history.speeds.length + 60000);
    expect(plan.historyTimeoutMs).to.be.greaterThan(history.maxRuntimeMs);
    expect(plan.performanceTimeoutMs).to.be.greaterThan(300000);
  });
  it('honors explicit producer and parent deadlines instead of silently raising a user limit', () => {
    const plan = createSmokeRunPlan({ soakRequested: true, timeoutMs: 1234, env: {} });
    expect([plan.performanceTimeoutMs, plan.historyTimeoutMs, plan.hotpathsTimeoutMs]).to.deep.equal([1234, 1234, 1234]);
    const history = createHistoryBenchConfig({ argv: ['--profile=soak', '--maxRuntime=1234'], env: {}, log: { warn() {} } });
    expect(history.maxRuntimeMs).to.equal(1234);
  });
  it('scales the default history deadline for customized window and scenario counts', () => {
    const history = createHistoryBenchConfig({ argv: ['--profile=soak', '--duration=200000', '--speeds=30,60,120,240'], env: {}, log: { warn() {} } });
    expect(history.maxRuntimeMs).to.be.at.least(860000);
    const smoke = createSmokeRunPlan({ env: {} });
    expect(smoke.historyArgs).to.include('--duration=6000'); expect(smoke.historyTimeoutMs).to.equal(70000);
  });
  it('rejects invalid explicit supervision deadlines', () => {
    for (const timeoutMs of [0, NaN, Infinity]) expect(() => createSmokeRunPlan({ timeoutMs })).to.throw('positive and finite');
  });
  it('derives supervision from the environment actually inherited by the history producer', () => {
    const env = { HISTORY_DURATION_MS: '200000', HISTORY_SPEEDS: '30,60,120,240' };
    const plan = createSmokeRunPlan({ soakRequested: true, env });
    const history = createHistoryBenchConfig({ argv: plan.historyArgs, env, log: { warn() {} } });
    expect(history.maxRuntimeMs).to.be.at.least(860000);
    expect(plan.historyTimeoutMs).to.be.greaterThan(history.maxRuntimeMs);
  });
  it('passes complete finite observations for every required scenario', () => {
    const gate = evaluateSmokeResults(fixture(), thresholds);
    expect(gate).to.include({ ok: true, measurementValid: true }); expect(gate.failures).to.deep.equal([]);
  });
  it('fails missing hotpaths and all nonnumeric or nonfinite required metrics', () => {
    const missing = fixture(); missing.hotpaths = {};
    expect(evaluateSmokeResults(missing, thresholds).measurementValid).to.equal(false);
    const setters = [(data, value) => { data.performance.frameStats.p95 = value; },
      (data, value) => { data.performance.tpsStats.p50 = value; }, (data, value) => { data.history.results[1].maxSpanTicks = value; },
      (data, value) => { data.hotpaths.marchingAnts.avgMs = value; }];
    for (const invalid of [undefined, null, NaN, Infinity, 'not-measured', '16']) for (const set of setters) {
      const data = fixture(); set(data, invalid);
      expect(evaluateSmokeResults(data, thresholds)).to.include({ ok: false, measurementValid: false });
    }
  });
  it('retains raw tail failures even when filtered summaries report healthy values', () => {
    const data = fixture(); data.performance.frameStats.p95 = 500;
    data.performance.samples = data.performance.samples.map(sample => ({ ...sample, frameMs: 500, frameGapsMs: [500] }));
    const gate = evaluateSmokeResults(data, thresholds);
    expect(gate).to.include({ ok: false, measurementValid: true }); expect(gate.metrics.perfP95Frame).to.equal(500);
    expect(gate.diagnostics.some(item => item.kind === 'performance-regression')).to.equal(true);
    data.performance.filteredSampleCount = 0;
    expect(evaluateSmokeResults(data, thresholds).measurementValid).to.equal(false);
  });
  it('rejects target-rate substitutions, stalled or paused owners and a missing scene population', () => {
    for (const patch of [
      { completedTicks: 0, tps: 166.67, targetTps: 166.67 },
      { tps: 166.67, targetTps: 166.67 }, { running: false }, { ready: false },
      { activeActors: 0 }, { entrances: 1 }, { overflow: true }, { tickExecutionMs: [] }, { renderExecutionMs: [] }
    ]) {
      const data = fixture(); data.performance.samples[0] = { ...data.performance.samples[0], ...patch };
      expect(evaluateSmokeResults(data, thresholds)).to.include({ ok: false, measurementValid: false });
    }
    const slow = fixture();
    slow.performance.samples = slow.performance.samples.map((sample, index) => ({ ...sample,
      completedTicks: 5, startTick: index * 5, tick: (index + 1) * 5, tps: 10, targetTps: 10000 }));
    slow.performance.tpsStats.p50 = 10;
    expect(evaluateSmokeResults(slow, thresholds)).to.include({ ok: false, measurementValid: true });
  });
  it('gates each history scenario and rejects empty, missing and duplicate required sets', () => {
    const data = fixture(); data.history.results[1].maxSpanTicks = 0;
    const gate = evaluateSmokeResults(data, thresholds);
    expect(gate.ok).to.equal(false); expect(gate.metrics.historyRatio).to.equal(0);
    expect(gate.diagnostics.some(item => item.path === 'history.speed:60.spanRatio')).to.equal(true);
    for (const results of [[], [data.history.results[0]], [data.history.results[0], data.history.results[0]]]) {
      const invalid = fixture(); invalid.history.results = results;
      expect(evaluateSmokeResults(invalid, thresholds).measurementValid).to.equal(false);
    }
  });
  it('preserves producer failures and rejects wrong workload identity and observation counts', () => {
    const data = fixture(); data.history.failures = ['speed=60 replay diverged'];
    expect(evaluateSmokeResults(data, thresholds).ok).to.equal(false);
    for (const modify of [value => { value.performance.receipt.profile = 'soak'; }, value => { value.performance.sampleCount = 0; },
      value => { value.hotpaths.marchingAnts.workIterations = 1; }, value => { value.performance.samples[0].tps = NaN; }]) {
      const invalid = fixture(); modify(invalid);
      expect(evaluateSmokeResults(invalid, thresholds).measurementValid).to.equal(false);
    }
  });
});
