import { expect } from 'chai';
import { Worker } from 'node:worker_threads';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { normalizeSurveyScenario, createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { compareSurveyReplay } from '../js/app/procgen/survey/ProcgenSurveyReplay.js';

const scene = normalizeSurveyScenario({ id: 'worker-order-flat-eight', horizonTicks: 128, cohort: { size: 8, birthInterval: 4 }, goal: { x: 80, y: 64, width: 256, height: 16 } });
const jobs = () => Array.from({ length: 4 }, (_, index) => {
  const candidate = { id: 'baseline-copy-' + index, kind: 'baseline', configuration: {} };
  return { scenario: scene, candidate, trialId: createSurveyTrialId(scene, candidate), attemptId: 'attempt-' + index };
});
const instrumentWorker = (mode, retained = []) => (entry, configuration) => {
  const source = `import { parentPort } from 'node:worker_threads';
    ${mode === 'delayed-start' ? 'await new Promise(resolve => setTimeout(resolve, 1000));' : ''}
    const send = parentPort.postMessage.bind(parentPort); let changed = false;
    parentPort.postMessage = message => {
      if (${JSON.stringify(mode)} === 'missing-outcome-ack' && message.type === 'result-outcome-ack') return;
      if (${JSON.stringify(mode)} === 'wrong-outcome-ack' && message.type === 'result-outcome-ack') { send({ ...message, digest: 'f'.repeat(64) }); return; }
      if (${JSON.stringify(mode)} === 'duplicate-outcome-ack' && message.type === 'result-outcome-ack') { send(message); send(message); return; }
      if (${JSON.stringify(mode)} === 'wrong-admission' && message.type === 'started') { send({ ...message, attemptId: 'unassigned' }); return; }
      send(message);
      if (${JSON.stringify(mode)} === 'delayed-preparation' && message.type === 'preparing') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      if (${JSON.stringify(mode)} === 'blocked-compute' && message.type === 'started') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      if (message.type === 'result' && !changed) {
        changed = true;
        if (${JSON.stringify(mode)} === 'duplicate') send(message);
        if (${JSON.stringify(mode)} === 'conflict') send({ ...message, result: { ...message.result, eventHash: 'f'.repeat(16) } });
        if (${JSON.stringify(mode)} === 'crash-after-result') process.exit(23);
      }
    };
    await import(${JSON.stringify(entry.href)});`;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), configuration); retained.push(worker); return worker;
};
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
  it('supervises a real worker startup deadline without admitting or acknowledging nonexistent progress', async () => {
    const workers = [], states = [];
    const started = Date.now(), report = await runSurveyJobs(jobs().slice(0, 1), { paused: true, maxStartupMs: 50, maxTotalMs: 5000,
      workerFactory: instrumentWorker('delayed-start', workers), onControlReady: controls => controls.step(), onControlState: value => states.push(value) });
    expect(Date.now() - started).to.be.lessThan(2000); expect(report.reason).to.equal('startup-timeout');
    expect(report.admissions[0]).to.include({ status: 'not-admitted', failureKind: 'startup-deadline', lastVerifiedTick: 0 });
    expect(report.admissions[0].workerGeneration).to.be.a('string'); expect(states.some(value => value.reachedCheckpoint != null)).to.equal(false);
    expect(workers.every(worker => worker.threadId === -1)).to.equal(true);
  });
  it('rejects an admission belonging to another attempt and terminates its real worker', async () => {
    const workers = [], report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, workerFactory: instrumentWorker('wrong-admission', workers) });
    expect(report.error).to.equal('Invalid worker admission identity'); expect(report.admissions[0].status).to.equal('preparing');
    expect(report.admissions[0].admittedMs).to.equal(undefined);
    expect(report.results[0].episodeComplete).not.to.equal(true); expect(workers.every(worker => worker.threadId === -1)).to.equal(true);
  });
  it('bounds per-world preparation after a worker has already loaded its shared masks', async () => {
    const workers = [], report = await runSurveyJobs(jobs().slice(0, 1), { maxTrialMs: 50, maxTotalMs: 5000,
      workerFactory: instrumentWorker('delayed-preparation', workers) });
    expect(report.reason).to.equal('trial-preparation-timeout');
    expect(report.admissions[0]).to.include({ status: 'preparing', failureKind: 'trial-preparation-deadline', trialLimitMs: 50, lastVerifiedTick: 0 });
    expect(report.admissions[0].workerReadyMs).to.be.at.least(0); expect(report.admissions[0].admittedMs).to.equal(undefined);
    expect(workers.every(worker => worker.threadId === -1)).to.equal(true);
  });
  it('supervises an admitted worker whose physical slice stops cooperating', async () => {
    const workers = [], report = await runSurveyJobs(jobs().slice(0, 1), { maxTrialMs: 50, maxTotalMs: 5000,
      workerFactory: instrumentWorker('blocked-compute', workers) });
    expect(report.reason).to.equal('trial-wall-time-safety');
    expect(report.admissions[0]).to.include({ status: 'admitted', failureKind: 'trial-wall-time-deadline', trialLimitMs: 50, lastVerifiedTick: 0 });
    expect(report.results[0].episodeComplete).not.to.equal(true); expect(workers.every(worker => worker.threadId === -1)).to.equal(true);
  });
  it('accepts identical repeated delivery once and preserves conflicting delivery as infrastructure evidence', async () => {
    let committed = 0;
    const duplicate = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, workerFactory: instrumentWorker('duplicate'), onResult: () => { committed++; } });
    expect(duplicate.error).to.equal(null); expect(duplicate.results).to.have.length(1); expect(committed).to.equal(1);
    expect(duplicate.persistence[0].status).to.equal('committed'); expect(duplicate.admissions[0]).to.include({ status: 'admitted', lastVerifiedTick: 128 });
    const conflict = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, workerFactory: instrumentWorker('conflict') });
    expect(conflict.error).to.equal('Conflicting worker result'); expect(conflict.deliveryConflicts).to.have.length(1);
    expect(conflict.results).to.have.length(1); expect(conflict.results[0].eventHash).not.to.equal('f'.repeat(16));
  });
  it('retains a committed original when the real worker crashes immediately after sending it', async () => {
    const workers = [], report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000,
      workerFactory: instrumentWorker('crash-after-result', workers), onResult: () => {} });
    expect(report.error).to.equal('Worker exited unexpectedly: 23'); expect(report.reason).to.equal('infrastructure-error');
    expect(report.results).to.have.length(1); expect(report.results[0].episodeComplete).to.equal(true);
    expect(report.persistence[0].status).to.equal('committed'); expect(workers.every(worker => worker.threadId === -1)).to.equal(true);
    expect(report.persistence[0].workerReceiptStatus).not.to.equal('acknowledged');
  });
  it('binds the actual storage outcome acknowledgement to its attempt, digest and publication receipt', async () => {
    let attempt;
    const publication = { schemaVersion: 1, status: 'original-and-attempt-published', originalReference: 'results/test.json', originalChecksum: 'a'.repeat(64), durability: 'atomic-namespace-publication; no power-loss flush guarantee' };
    const report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, workerFactory: instrumentWorker('duplicate-outcome-ack'),
      onResult: (result, retained) => { attempt = retained; return { publication }; } });
    expect(report.error).to.equal(null); const receipt = report.persistence[0];
    expect(receipt).to.include({ status: 'committed', workerReceiptStatus: 'acknowledged', publicationStatus: 'callback-reported' });
    expect(receipt.publication).to.deep.equal(publication); expect(receipt.publicationDigest).to.match(/^[a-f0-9]{64}$/);
    expect(attempt).to.include({ id: receipt.attemptId, runGeneration: receipt.runGeneration, workerGeneration: receipt.workerGeneration, outcomeDigest: receipt.digest });
    expect(receipt.workerAcknowledgedMs).to.be.at.least(receipt.callbackStartedMs);
  });
  it('preserves the computed original when a worker omits or forges its persistence outcome acknowledgement', async () => {
    for (const mode of ['missing-outcome-ack', 'wrong-outcome-ack']) {
      const report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, workerFactory: instrumentWorker(mode), onResult: () => {} });
      expect(report.error).to.equal(mode === 'missing-outcome-ack' ? 'Worker completed without acknowledging persistence outcome' : 'Invalid worker persistence outcome acknowledgement');
      expect(report.results).to.have.length(1); expect(report.persistence[0]).to.include({ status: 'committed', workerReceiptStatus: 'sent-unacknowledged' });
    }
  });
  it('returns an unknown persistence receipt when the storage callback never settles', async () => {
    const started = Date.now();
    const report = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, maxPersistenceMs: 100,
      onResult: () => new Promise(() => {}) });
    expect(Date.now() - started).to.be.lessThan(3000);
    expect(report.reason).to.equal('persistence-timeout');
    expect(report.persistence[0].status).to.equal('unknown-after-timeout');
    expect(report.persistence[0].workerReceiptStatus).to.equal('acknowledged');
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
    expect(rejected.persistence[0].workerReceiptStatus).to.equal('acknowledged');
    const oversized = await runSurveyJobs(jobs().slice(0, 1), { maxTotalMs: 5000, maxPendingResultBytes: 4096 });
    expect(oversized.error).to.include('exceeds pending byte bound'); expect(oversized.computations[0].status).to.equal('transfer-rejected-byte-bound');
    expect(oversized.storage.peakPendingResultBytes).to.equal(0); expect(oversized.results[0].status).to.equal('interrupted');
  });
});
