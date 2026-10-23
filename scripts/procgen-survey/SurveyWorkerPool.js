import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';

const integer = (value, fallback, minimum, maximum) => { const result = value ?? fallback; if (!Number.isInteger(result) || result < minimum || result > maximum) throw new RangeError('Invalid survey resource bound'); return result; };
const normalizeSurveyResources = (value = {}) => ({
  executionWorkers: integer(value.executionWorkers, 1, 1, 2), residentWorlds: integer(value.residentWorlds, 16, 1, 64),
  sliceTicks: integer(value.sliceTicks, 16, 1, 128), checkpointTicks: integer(value.checkpointTicks, 64, 1, 4096),
  maxTotalTicks: integer(value.maxTotalTicks, 100000, 1, 1000000), maxTotalMs: integer(value.maxTotalMs, 120000, 100, 900000),
  maxTrialMs: integer(value.maxTrialMs, 60000, 50, 300000), maxWorkerMB: integer(value.maxWorkerMB, 512, 64, 2048),
  maxPersistenceMs: integer(value.maxPersistenceMs, 30000, 50, 300000),
  maxPendingResultCount: integer(value.maxPendingResultCount, 32, 1, 1024),
  maxPendingResultBytes: integer(value.maxPendingResultBytes, 8 * 1048576, 4096, 128 * 1048576)
});
const runSurveyJobs = async (jobs, options = {}) => {
  const resources = normalizeSurveyResources(options), started = performance.now();
  if (!Array.isArray(jobs) || jobs.length > 1024 || new Set(jobs.map(job => job.trialId)).size !== jobs.length) throw new Error('Survey jobs require bounded unique identities');
  if (jobs.some(job => !Number.isInteger(job.scenario?.horizonTicks) || job.scenario.horizonTicks < 1) || jobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0) > resources.maxTotalTicks) throw new RangeError('Survey total simulation budget exceeded before admission');
  if (!jobs.length) return { results: [], resources, elapsedMs: 0, cancelled: false };
  const count = Math.min(resources.executionWorkers, resources.residentWorlds, jobs.length), workers = [], activeWorkers = new Set(), results = [], receipts = new Map(), finished = new Set(), presentationErrors = [], persistence = new Map(), deliveryConflicts = [];
  const assignedByTrial = new Map(jobs.map(job => [job.trialId, job]));
  let cancelled = !!options.signal?.aborted, reason = cancelled ? 'cancelled' : null, callbackError = null, callbackTail = Promise.resolve(), paused = !!options.paused, controlId = 0, stepBarrier = null, stepInFlight = null, workersReady = false, pendingResultCount = 0, pendingResultBytes = 0;
  const generations = new Map();
  const displayError = error => { if (presentationErrors.length < 16) presentationErrors.push(String(error?.message || error)); };
  const notify = (callback, ...args) => { try { const returned = callback?.(...args); returned?.catch?.(displayError); } catch (error) { displayError(error); } };
  const broadcast = message => { for (const worker of activeWorkers) worker.postMessage(message); };
  const state = () => ({ paused, cancelled, stepPending: !!stepBarrier || !!stepInFlight?.pending.size, executionWorkers: activeWorkers.size });
  const cancel = message => { if (!cancelled) { cancelled = true; reason = message; } stepBarrier = null; stepInFlight = null; broadcast({ type: 'cancel' }); notify(options.onControlState, state()); return state(); };
  const finishStepBarrier = () => {
    if (!workersReady || !stepBarrier || stepBarrier.pending.size) return;
    const targetTick = (Math.floor(stepBarrier.maxTick / resources.checkpointTicks) + 1) * resources.checkpointTicks;
    const id = stepBarrier.controlId;
    stepBarrier = null; stepInFlight = { controlId: id, targetTick, pending: new Set(activeWorkers) };
    for (const worker of activeWorkers) worker.postMessage({ type: 'step', controlId: id, targetTick, workerGeneration: generations.get(worker) });
    notify(options.onControlState, { ...state(), controlId: id, targetTick });
  };
  const controls = {
    pause: () => { paused = true; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'pause', controlId }); return state(); },
    resume: () => { paused = false; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'resume', controlId }); return state(); },
    step: () => { paused = true; controlId++; stepInFlight = null; stepBarrier = { controlId, pending: new Set(activeWorkers), maxTick: 0 };
      if (workersReady) broadcast({ type: 'step-prepare', controlId }); finishStepBarrier(); return state(); },
    cancel: () => cancel('cancelled')
  };
  const abort = () => cancel('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => cancel('wall-time-safety'), resources.maxTotalMs), supervised = [];
  const accept = message => {
    const result = message.result, job = assignedByTrial.get(result?.trialId);
    if (!job || message.attemptId !== job.attemptId || result.scenarioId !== job.scenario.id || result.candidateId !== job.candidate.id) {
      callbackError ||= new Error('Invalid worker result identity'); cancel('infrastructure-error'); return;
    }
    const encoded = JSON.stringify(result), digest = createHash('sha256').update(encoded).digest('hex'), bytes = Buffer.byteLength(encoded);
    if (finished.has(result.trialId)) {
      if (persistence.get(result.trialId)?.digest !== digest) { deliveryConflicts.push({ trialId: result.trialId, attemptId: message.attemptId, digest }); callbackError ||= new Error('Conflicting worker result'); cancel('infrastructure-error'); }
      return;
    }
    finished.add(result.trialId); results.push(result);
    persistence.set(result.trialId, { trialId: result.trialId, attemptId: message.attemptId, digest, status: 'persistence-pending', bytes });
    pendingResultCount++; pendingResultBytes += bytes;
    if (pendingResultCount > resources.maxPendingResultCount || pendingResultBytes > resources.maxPendingResultBytes) cancel('persistence-backpressure');
    callbackTail = callbackTail.then(async () => {
      try {
        await options.onResult?.(result, { id: message.attemptId, performance: message.performance });
        persistence.get(result.trialId).status = options.onResult ? 'committed' : 'computed-only';
      } catch (error) { persistence.get(result.trialId).status = 'failed-or-unknown'; callbackError ||= error; cancel('storage-or-callback'); }
      finally { pendingResultCount--; pendingResultBytes -= bytes; }
    });
  };
  try {
    notify(options.onControlReady, controls);
    for (let index = 0; index < count; index++) {
      const assigned = jobs.filter((job, slot) => slot % count === index), residentWorlds = Math.floor(resources.residentWorlds / count) + (index < resources.residentWorlds % count ? 1 : 0);
      const workerGeneration = randomUUID();
      const worker = new Worker(new URL('./survey-worker.js', import.meta.url), { workerData: { ...resources, residentWorlds, paused, jobs: assigned, workerGeneration }, resourceLimits: { maxOldGenerationSizeMb: resources.maxWorkerMB } });
      workers.push(worker); activeWorkers.add(worker); generations.set(worker, workerGeneration);
      supervised.push(new Promise(resolve => {
        let done = false;
        const hardLimit = setTimeout(() => { cancel('wall-time-safety'); worker.terminate(); }, resources.maxTotalMs + 2000);
        worker.on('message', message => {
          if (message.type === 'result') accept(message);
          else if (message.type === 'telemetry') { receipts.set(message.trialId, message.value); notify(options.onTelemetry, message.trialId, message.value); }
          else if (message.type === 'control-state') { if (stepInFlight && stepInFlight.controlId === message.value.controlId &&
              message.value.workerGeneration === workerGeneration && ['reached', 'empty', 'failed', 'terminal-before-target'].includes(message.value.stepStatus)) {
            stepInFlight.pending.delete(worker); if (!stepInFlight.pending.size) stepInFlight = null;
          } notify(options.onControlState, { ...state(), worker: index, ...message.value }); }
          else if (message.type === 'step-ready' && stepBarrier?.controlId === message.controlId && message.workerGeneration === workerGeneration && stepBarrier.pending.has(worker)) { stepBarrier.maxTick = Math.max(stepBarrier.maxTick, message.maxTick); stepBarrier.pending.delete(worker); finishStepBarrier(); }
          else if (message.type === 'done') done = true;
          else if (message.type === 'fatal') { callbackError ||= new Error(message.error); cancel('infrastructure-error'); }
        });
        worker.on('error', error => { callbackError ||= error; cancel('infrastructure-error'); });
        worker.on('exit', code => {
          clearTimeout(hardLimit); activeWorkers.delete(worker); stepInFlight?.pending.delete(worker);
          if (stepBarrier) { stepBarrier.pending.delete(worker); finishStepBarrier(); }
          if (!done || code !== 0) for (const job of assigned) if (!finished.has(job.trialId)) accept({ result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id,
            status: cancelled ? 'interrupted' : 'infrastructure-error', terminationReason: reason || 'worker-exit-' + code, lastTick: receipts.get(job.trialId)?.tick ?? 0, lastVerifiedReceipt: receipts.get(job.trialId) || null }, attemptId: job.attemptId });
          resolve();
        });
      }));
      if (cancelled) worker.postMessage({ type: 'cancel' });
    }
    workersReady = true;
    if (stepBarrier) { stepBarrier.pending = new Set(activeWorkers); broadcast({ type: 'step-prepare', controlId: stepBarrier.controlId }); finishStepBarrier(); }
    notify(options.onControlState, state());
    await Promise.all(supervised);
    let persistenceTimer;
    const settled = await Promise.race([callbackTail.then(() => true), new Promise(resolve => {
      persistenceTimer = setTimeout(() => resolve(false), resources.maxPersistenceMs);
    })]);
    clearTimeout(persistenceTimer);
    if (!settled) { callbackError ||= new Error('Survey result persistence deadline exceeded; commit outcome unknown'); cancel('persistence-timeout'); }
    return { results, resources, elapsedMs: performance.now() - started, cancelled, reason, error: callbackError?.message || null,
      persistence: [...persistence.values()].map(receipt => ({ ...receipt, status: !settled && receipt.status === 'persistence-pending' ? 'unknown-after-timeout' : receipt.status })),
      deliveryConflicts, presentationErrors };
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); stepBarrier = null; stepInFlight = null;
    await Promise.all(workers.map(worker => worker.terminate()));
  }
};
export { normalizeSurveyResources, runSurveyJobs };
