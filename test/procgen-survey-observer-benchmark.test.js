import { expect } from 'chai';
import { normalizeObserverBenchmark, runSurveyObserverBenchmark, renderObserverBenchmarkSvg, summarizeObserverRegression } from '../scripts/procgen-survey/SurveyObserverBenchmark.js';

describe('bounded production survey observer benchmark', function() {
  this.timeout(15000);
  it('measures real physics and compact terminal observation separately from telemetry and checkpoint serialization', async () => {
    const report = await runSurveyObserverBenchmark({ name: 'survey', ticks: 512, windowTicks: 64, liveActors: 2, maxActorAge: 32, checkpointEvery: 256, telemetryEvery: 64, maxWallMs: 10000 });
    expect(report.status).to.equal('completed'); expect(report.measuredTicks).to.equal(512); expect(report.windows).to.have.length(8);
    expect(report.observationWork.retainedRecords).to.be.greaterThan(2); expect(report.observationWork.finalizedActors).to.be.greaterThan(0);
    expect(report.windows.every(window => window.actorVisits > 0 && window.births > 0)).to.equal(true);
    expect(report.workload.actorSteps).to.be.greaterThan(512); expect(report.workload.groundQueries).to.be.greaterThan(0);
    expect(report.totals.physicsMs).to.be.greaterThan(0); expect(report.totals.observationMs).to.be.greaterThan(0);
    expect(report.totals.telemetryMs).to.be.greaterThan(0); expect(report.totals.checkpointCaptureMs).to.be.greaterThan(0); expect(report.totals.checkpointEncodeMs).to.be.greaterThan(0);
    expect(report.checkpoints.map(checkpoint => checkpoint.tick)).to.deep.equal([256, 512]);
    expect(report.checkpoints.every(checkpoint => checkpoint.bytes > 0 && checkpoint.stateHash && checkpoint.physicalStateHash)).to.equal(true);
    expect(report.environment).to.include.keys('node', 'v8', 'cpuModel', 'harnessBefore', 'harnessAfter', 'sourceUnchanged');
    expect(report.environment.executionIdentity.status).to.equal('unbound'); expect(report.memory.allocationCounts).to.equal('not-instrumented');
    expect(report.qualification).to.include('does not issue a replay qualification');
    const svg = renderObserverBenchmarkSvg(report); expect(svg).to.include('<svg'); expect(svg).to.include('retained births'); expect(svg).not.to.include('NaN');
    expect(report.regression.status).to.equal('inconclusive');
  });
  it('preserves an explicit cancellation and retained-record cap instead of fabricating an eight-hour completion', async () => {
    const controller = new AbortController(); controller.abort();
    const cancelled = await runSurveyObserverBenchmark({ ticks: 64, maxWallMs: 5000 }, { signal: controller.signal });
    expect(cancelled.status).to.equal('cancelled'); expect(cancelled.measuredTicks).to.equal(0); expect(cancelled.regression.status).to.equal('inconclusive');
    const capped = await runSurveyObserverBenchmark({ ticks: 4096, liveActors: 8, maxActorAge: 16, maxRetainedActors: 64, maxWallMs: 10000 });
    expect(capped.status).to.equal('retained-record-limit'); expect(capped.observationWork.retainedRecords).to.equal(64); expect(capped.measuredTicks).to.be.lessThan(4096);
  });
  it('rejects unbounded inputs and uses a declared diagnostic threshold without claiming release qualification', () => {
    for (const options of [{ ticks: Infinity }, { ticks: 1000001 }, { liveActors: 65 }, { maxWallMs: 0 }, { maxRetainedActors: 65537 }, { profile: 'unknown' }]) expect(() => normalizeObserverBenchmark(options)).to.throw();
    expect(normalizeObserverBenchmark({ profile: 'eight-hour' }).ticks).to.equal(480000);
    const windows = Array.from({ length: 12 }, (_, index) => ({ ticks: 1000, actorVisits: 8000, observationMs: index < 6 ? 1 : 4, retainedActors: index * 100 }));
    const regression = summarizeObserverRegression(windows); expect(regression.status).to.equal('investigate-observer-regression'); expect(regression.ratio).to.equal(4);
    expect(summarizeObserverRegression([]).status).to.equal('inconclusive');
  });
});
