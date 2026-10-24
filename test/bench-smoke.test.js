import { expect } from 'chai';
import { evaluateSmokeResults } from '../scripts/bench-smoke.js';
import { createBenchmarkReceipt, REQUIRED_SMOKE_HOTPATHS } from '../scripts/BenchmarkReceipt.js';

const thresholds = { perfP95FrameMsMax: 250, perfP50TpsMin: 15, historySpanRatioMin: 0.5,
  antsAvgMsMax: 250, tileCompositionAvgMsMax: 250, overlayPlaneAvgMsMax: 250, scaledBlitAvgMsMax: 250 };
const fixture = () => ({
  performance: { receipt: createBenchmarkReceipt('performance', 'smoke', ['bench:entrances:30']), sampleCount: 20,
    samples: Array.from({ length: 20 }, () => ({ frameMs: 16, tps: 30 })), frameStats: { p95: 16 }, tpsStats: { p50: 30 },
    filteredFrameStats: { p95: 16 }, filteredTpsStats: { p50: 30 } },
  history: { receipt: createBenchmarkReceipt('history', 'smoke', ['speed:30', 'speed:60']), failures: [],
    results: [30, 60].map(speedFactor => ({ speedFactor, maxSpanTicks: 6000, targetSpanTicks: 6000, sampleCount: 4 })) },
  hotpaths: { receipt: createBenchmarkReceipt('hotpaths', 'smoke', REQUIRED_SMOKE_HOTPATHS),
    ...Object.fromEntries(REQUIRED_SMOKE_HOTPATHS.map(name => [name, { avgMs: 10, workIterations: 3000, sampleCount: 4, samplesMs: [10, 10, 10, 10] }])) }
});

describe('admitted benchmark smoke gates', () => {
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
    data.performance.samples = data.performance.samples.map(sample => ({ ...sample, frameMs: 500 }));
    const gate = evaluateSmokeResults(data, thresholds);
    expect(gate).to.include({ ok: false, measurementValid: true }); expect(gate.metrics.perfP95Frame).to.equal(500);
    expect(gate.diagnostics.some(item => item.kind === 'performance-regression')).to.equal(true);
    data.performance.filteredSampleCount = 0;
    expect(evaluateSmokeResults(data, thresholds).measurementValid).to.equal(false);
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
