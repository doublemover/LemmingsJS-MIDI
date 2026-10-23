import { expect } from 'chai';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { normalizeSurveyScenario, createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { compareSurveyReplay } from '../js/app/procgen/survey/ProcgenSurveyReplay.js';

const scene = normalizeSurveyScenario({ id: 'worker-order-flat-eight', horizonTicks: 128, cohort: { size: 8, birthInterval: 4 }, goal: { x: 80, y: 64, width: 256, height: 16 } });
const jobs = () => Array.from({ length: 4 }, (_, index) => {
  const candidate = { id: 'baseline-copy-' + index, kind: 'baseline', configuration: {} };
  return { scenario: scene, candidate, trialId: createSurveyTrialId(scene, candidate), attemptId: 'attempt-' + index };
});
describe('real isolated procgen survey workers', function() {
  this.timeout(15000);
  it('matches across CPU worker counts, job order, residency and dashboard polling', async () => {
    const first = await runSurveyJobs(jobs(), { executionWorkers: 1, residentWorlds: 4, checkpointTicks: 32, maxTotalMs: 10000 });
    let reads = 0;
    const second = await runSurveyJobs(jobs().reverse(), { executionWorkers: 2, residentWorlds: 2, checkpointTicks: 64, maxTotalMs: 10000, onTelemetry: () => { reads++; } });
    expect(first.error).to.equal(null); expect(second.error).to.equal(null); expect(reads).to.be.greaterThan(0);
    expect(first.results).to.have.length(4); expect(second.results).to.have.length(4);
    for (const original of first.results) {
      const replay = second.results.find(result => result.trialId === original.trialId);
      expect(compareSurveyReplay(original, replay).matched).to.equal(true); expect(original.accounting).to.include({ designated: 8, admitted: 8, alive: 8, deaths: 0 });
    }
    expect(new Set(first.results.map(result => result.finalPhysicalStateHash)).size).to.equal(1);
  });
  it('cancels queued work explicitly and reproduces the same identities on restart', async () => {
    const controller = new AbortController(); controller.abort();
    const cancelled = await runSurveyJobs(jobs(), { signal: controller.signal, maxTotalMs: 10000 });
    expect(cancelled.results).to.have.length(4); expect(cancelled.results.every(result => ['cancelled', 'interrupted'].includes(result.status))).to.equal(true);
    expect(cancelled.results.every(result => !result.episodeComplete)).to.equal(true);
    const resumed = await runSurveyJobs(jobs(), { maxTotalMs: 10000 }); expect(resumed.results.every(result => result.status === 'completed')).to.equal(true);
    expect(resumed.results.map(result => result.trialId).sort()).to.deep.equal(cancelled.results.map(result => result.trialId).sort());
  });
  it('rejects total simulation over-budget before any worker admission', async () => {
    let updates = 0;
    try { await runSurveyJobs(jobs(), { maxTotalTicks: 127, onTelemetry: () => updates++ }); throw new Error('unexpected admission'); } catch (error) { expect(error.message).to.include('simulation budget'); }
    expect(updates).to.equal(0);
  });
  it('rejects missing or oversized assignment identities before starting a worker', async () => {
    let admitted = 0;
    for (const patch of [{ attemptId: '' }, { attemptId: undefined }, { trialId: undefined }, { trialId: 'x'.repeat(257) }, { candidate: {} }]) {
      let rejected;
      try { await runSurveyJobs([{ ...jobs()[0], ...patch }], { onControlReady: () => { admitted++; } }); } catch (error) { rejected = error; }
      expect(rejected?.message).to.include('unique trial, attempt, scenario and candidate identities');
    }
    expect(admitted).to.equal(0);
  });
  it('returns an unknown persistence receipt when the storage callback never settles', async () => {
    const started = Date.now();
    const report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, maxPersistenceMs: 100,
      onResult: () => new Promise(() => {}) });
    expect(Date.now() - started).to.be.lessThan(3000);
    expect(report.reason).to.equal('persistence-timeout');
    expect(report.persistence[0].status).to.equal('unknown-after-timeout');
    expect(report.results).to.have.length(1);
  });
  it('reserves transfer count and bytes while a slow write backpressures fast real workers', async () => {
    let release, entered;
    const firstStarted = new Promise(resolve => { entered = resolve; }); let calls = 0;
    const execution = runSurveyJobs(jobs(), { executionWorkers: 2, residentWorlds: 2, maxTotalMs: 10000,
      maxPersistenceMs: 4000, maxPendingResultCount: 1, maxPendingResultBytes: 1048576,
      onResult: async () => { calls++; if (calls === 1) { entered(); await new Promise(resolve => { release = resolve; }); } } });
    await firstStarted;
    await new Promise(resolve => setTimeout(resolve, 75)); expect(calls).to.equal(1); release();
    const report = await execution;
    expect(report.error).to.equal(null); expect(calls).to.equal(4);
    expect(report.storage).to.include({ pendingResultCount: 0, pendingResultBytes: 0, peakPendingResultCount: 1 });
    expect(report.storage.peakPendingResultBytes).to.be.at.most(1048576);
    expect(report.persistence.every(receipt => receipt.status === 'committed' && receipt.callbackLatencyMs >= 0 && receipt.runGeneration === report.runGeneration)).to.equal(true);
    expect(report.computations.every(receipt => receipt.status === 'received')).to.equal(true);
  });
  it('retires a timed-out delivery and never upgrades its receipt after late callback success', async () => {
    let release, signal;
    const report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, maxPersistenceMs: 75,
      onResult: (result, attempt, delivery) => { signal = delivery.signal; return new Promise(resolve => { release = resolve; }); } });
    expect(signal.aborted).to.equal(true); expect(report.persistence[0].status).to.equal('unknown-after-timeout');
    const before = JSON.stringify(report); release(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(JSON.stringify(report)).to.equal(before);
    const next = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000 });
    expect(next.runGeneration).not.to.equal(report.runGeneration); expect(next.persistence[0].status).to.equal('computed-only');
  });
  it('bounds the original eight-tick held-callback fixture including startup within its host deadline', async () => {
    const scenario = normalizeSurveyScenario({ id: 'held-eight', horizonTicks: 8, checkpointEvery: 4, cohort: { size: 1 } }), candidate = { id: 'baseline' };
    const job = { scenario, candidate, trialId: createSurveyTrialId(scenario, candidate), attemptId: 'held-eight-attempt' };
    let entered = false; const started = Date.now();
    const report = await runSurveyJobs([job], { maxTotalMs: 500, maxPersistenceMs: 5000, onResult: () => { entered = true; return new Promise(() => {}); } });
    expect(Date.now() - started).to.be.lessThan(3000); expect(report.cancelled).to.equal(true);
    if (entered) {
      expect(report.persistence[0]).to.include({ status: 'unknown-after-timeout', failureKind: 'persistence-deadline' });
      expect(report.errorKind).to.equal('persistence-deadline');
    } else {
      expect(report.reason).to.equal('wall-time-safety');
      expect(report.persistence.every(receipt => receipt.status === 'received-uncommitted')).to.equal(true);
      expect(report.persistence).to.have.length(1);
    }
  });
  it('retains a failed storage receipt and rejects an oversized result before transfer', async () => {
    const rejected = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, onResult: () => { const error = new Error('disk full fixture'); error.code = 'ENOSPC'; throw error; } });
    expect(rejected.reason).to.equal('storage-or-callback'); expect(rejected.error).to.equal('disk full fixture');
    expect(rejected.persistence[0].status).to.equal('failed-or-unknown');
    const oversized = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, maxPendingResultBytes: 4096 });
    expect(oversized.error).to.include('exceeds pending byte bound'); expect(oversized.computations[0].status).to.equal('transfer-rejected-byte-bound');
    expect(oversized.storage.peakPendingResultBytes).to.equal(0); expect(oversized.results[0].status).to.equal('interrupted');
  });
});
