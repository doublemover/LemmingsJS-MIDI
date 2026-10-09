import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const integer = (value, fallback, minimum, maximum) => { const result = value ?? fallback; if (!Number.isInteger(result) || result < minimum || result > maximum) throw new RangeError('Invalid survey resource bound'); return result; };
const normalizeSurveyResources = (value = {}) => ({
  executionWorkers: integer(value.executionWorkers, 1, 1, 2), residentWorlds: integer(value.residentWorlds, 16, 1, 64),
  sliceTicks: integer(value.sliceTicks, 16, 1, 128), checkpointTicks: integer(value.checkpointTicks, 64, 1, 4096),
  maxTotalTicks: integer(value.maxTotalTicks, 100000, 1, 1000000), maxTotalMs: integer(value.maxTotalMs, 120000, 100, 900000),
  maxTrialMs: integer(value.maxTrialMs, 60000, 50, 300000), maxWorkerMB: integer(value.maxWorkerMB, 512, 64, 2048)
});
const runSurveyJobs = async (jobs, options = {}) => {
  const resources = normalizeSurveyResources(options), started = performance.now();
  if (!Array.isArray(jobs) || jobs.length > 1024 || new Set(jobs.map(job => job.trialId)).size !== jobs.length) throw new Error('Survey jobs require bounded unique identities');
  if (jobs.some(job => !Number.isInteger(job.scenario?.horizonTicks) || job.scenario.horizonTicks < 1) || jobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0) > resources.maxTotalTicks) throw new RangeError('Survey total simulation budget exceeded before admission');
  if (!jobs.length) return { results: [], resources, elapsedMs: 0, cancelled: false };
  const count = Math.min(resources.executionWorkers, resources.residentWorlds, jobs.length), workers = [], activeWorkers = new Set(), results = [], receipts = new Map(), finished = new Set(), presentationErrors = [];
  let cancelled = !!options.signal?.aborted, reason = cancelled ? 'cancelled' : null, callbackError = null, callbackTail = Promise.resolve(), paused = !!options.paused, controlId = 0, stepBarrier = null, stepInFlight = null;
  const displayError = error => { if (presentationErrors.length < 16) presentationErrors.push(String(error?.message || error)); };
  const notify = (callback, ...args) => { try { const returned = callback?.(...args); returned?.catch?.(displayError); } catch (error) { displayError(error); } };
  const broadcast = message => { for (const worker of activeWorkers) worker.postMessage(message); };
  const state = () => ({ paused, cancelled, stepPending: !!stepBarrier || !!stepInFlight?.pending.size, executionWorkers: activeWorkers.size });
  const cancel = message => { if (!cancelled) { cancelled = true; reason = message; } stepBarrier = null; stepInFlight = null; broadcast({ type: 'cancel' }); notify(options.onControlState, state()); return state(); };
  const finishStepBarrier = () => {
    if (!stepBarrier || stepBarrier.pending.size) return;
    const targetTick = (Math.floor(stepBarrier.maxTick / resources.checkpointTicks) + 1) * resources.checkpointTicks;
    stepBarrier = null; stepInFlight = { targetTick, pending: new Set(activeWorkers) }; broadcast({ type: 'step', targetTick }); notify(options.onControlState, { ...state(), targetTick });
  };
  const controls = {
    pause: () => { paused = true; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'pause' }); return state(); },
    resume: () => { paused = false; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'resume' }); return state(); },
    step: () => { paused = true; controlId++; stepInFlight = null; stepBarrier = { controlId, pending: new Set(activeWorkers), maxTick: 0 }; broadcast({ type: 'step-prepare', controlId }); finishStepBarrier(); return state(); },
    cancel: () => cancel('cancelled')
  };
  const abort = () => cancel('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => cancel('wall-time-safety'), resources.maxTotalMs), supervised = [];
  const accept = message => {
    if (finished.has(message.result.trialId)) { callbackError ||= new Error('Duplicate worker result'); cancel('infrastructure-error'); return; }
    finished.add(message.result.trialId); results.push(message.result);
    callbackTail = callbackTail.then(() => options.onResult?.(message.result, { id: message.attemptId, performance: message.performance })).catch(error => { callbackError ||= error; cancel('storage-or-callback'); });
  };
  try {
    notify(options.onControlReady, controls);
    for (let index = 0; index < count; index++) {
      const assigned = jobs.filter((job, slot) => slot % count === index), residentWorlds = Math.floor(resources.residentWorlds / count) + (index < resources.residentWorlds % count ? 1 : 0);
      const worker = new Worker(new URL('./survey-worker.js', import.meta.url), { workerData: { ...resources, residentWorlds, paused, jobs: assigned }, resourceLimits: { maxOldGenerationSizeMb: resources.maxWorkerMB } });
      workers.push(worker); activeWorkers.add(worker);
      supervised.push(new Promise(resolve => {
        let done = false;
        const hardLimit = setTimeout(() => { cancel('wall-time-safety'); worker.terminate(); }, resources.maxTotalMs + 2000);
        worker.on('message', message => {
          if (message.type === 'result') accept(message);
          else if (message.type === 'telemetry') { receipts.set(message.trialId, message.value); notify(options.onTelemetry, message.trialId, message.value); }
          else if (message.type === 'control-state') { if (stepInFlight && stepInFlight.targetTick === message.value.reachedCheckpoint) { stepInFlight.pending.delete(worker); if (!stepInFlight.pending.size) stepInFlight = null; } notify(options.onControlState, { ...state(), worker: index, ...message.value }); }
          else if (message.type === 'step-ready' && stepBarrier?.controlId === message.controlId && stepBarrier.pending.has(worker)) { stepBarrier.maxTick = Math.max(stepBarrier.maxTick, message.maxTick); stepBarrier.pending.delete(worker); finishStepBarrier(); }
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
    notify(options.onControlState, state());
    await Promise.all(supervised); await callbackTail;
    return { results, resources, elapsedMs: performance.now() - started, cancelled, reason, error: callbackError?.message || null, presentationErrors };
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); stepBarrier = null; stepInFlight = null;
    await Promise.all(workers.map(worker => worker.terminate()));
  }
};
export { normalizeSurveyResources, runSurveyJobs };
