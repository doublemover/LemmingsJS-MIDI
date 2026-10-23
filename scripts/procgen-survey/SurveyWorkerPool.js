import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { freezeSurveyData } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';

class SurveyPersistenceDeadlineError extends Error {
  constructor() { super('Survey result persistence deadline exceeded; commit outcome unknown'); this.name = 'SurveyPersistenceDeadlineError'; this.kind = 'persistence-deadline'; }
}

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
  const resources = normalizeSurveyResources(options), started = performance.now(), runGeneration = randomUUID();
  if (!Array.isArray(jobs) || jobs.length > 1024 || jobs.some(job => !job ||
      ![job.trialId, job.attemptId, job.scenario?.id, job.candidate?.id].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) ||
      new Set(jobs.map(job => job.trialId)).size !== jobs.length) throw new Error('Survey jobs require bounded unique trial, attempt, scenario and candidate identities');
  if (jobs.some(job => !Number.isInteger(job.scenario?.horizonTicks) || job.scenario.horizonTicks < 1) || jobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0) > resources.maxTotalTicks) throw new RangeError('Survey total simulation budget exceeded before admission');
  if (!jobs.length) {
    const presentationErrors = [], state = freezeSurveyData({ runGeneration, paused: true, retired: true, executionWorkers: 0,
      cancelled: !!options.signal?.aborted, stepPending: false, stepStatus: 'empty', selected: [], reachedCheckpoint: null });
    const notify = callback => { try { const result = callback?.(); result?.catch?.(error => presentationErrors.push(String(error?.message || error))); } catch (error) { presentationErrors.push(String(error?.message || error)); } };
    const empty = () => { notify(() => options.onControlState?.(state)); return state; };
    notify(() => options.onControlReady?.({ pause: empty, resume: empty, step: empty, cancel: empty }));
    return { results: [], resources, runGeneration, elapsedMs: 0, cancelled: state.cancelled, reason: state.cancelled ? 'cancelled' : null,
      error: null, persistence: [], computations: [], controlState: state, presentationErrors };
  }
  const count = Math.min(resources.executionWorkers, resources.residentWorlds, jobs.length), workers = [], activeWorkers = new Set(), results = [], receipts = new Map(), finished = new Set(), presentationErrors = [], persistence = new Map(), deliveryConflicts = [];
  const assignedByTrial = new Map(jobs.map(job => [job.trialId, job]));
  let cancelled = !!options.signal?.aborted, reason = cancelled ? 'cancelled' : null, callbackError = null, callbackTail = Promise.resolve(), paused = !!options.paused, controlId = 0, stepBarrier = null, stepInFlight = null, workersReady = false, pendingResultCount = 0, pendingResultBytes = 0;
  const generations = new Map(), assignments = new Map(), reservations = new Map(), transferRequests = [], persistenceControllers = new Set(), computations = new Map();
  let peakPendingResultCount = 0, peakPendingResultBytes = 0, closed = false;
  const displayError = error => { if (presentationErrors.length < 16) presentationErrors.push(String(error?.message || error)); };
  const notify = (callback, ...args) => { try { const returned = callback?.(...args); returned?.catch?.(displayError); } catch (error) { displayError(error); } };
  const send = (worker, message) => { if (activeWorkers.has(worker)) worker.postMessage({ ...message, runGeneration, workerGeneration: generations.get(worker) }); };
  const broadcast = message => { for (const worker of activeWorkers) send(worker, message); };
  const state = () => ({ runGeneration, paused, cancelled, stepPending: !!stepBarrier || !!stepInFlight?.pending.size, executionWorkers: activeWorkers.size,
    computation: { computedResults: computations.size, receivedResults: results.length }, storage: { pendingResultCount, pendingResultBytes, peakPendingResultCount, peakPendingResultBytes } });
  const cancel = message => { if (!cancelled) { cancelled = true; reason = message; } stepBarrier = null; stepInFlight = null; broadcast({ type: 'cancel' });
    if (['wall-time-safety', 'persistence-timeout'].includes(message)) for (const controller of persistenceControllers) controller.abort(new Error(message));
    notify(options.onControlState, state()); return state(); };
  const infrastructure = message => { callbackError ||= new Error(message); cancel('infrastructure-error'); };
  const admitTransfers = () => {
    while (!closed && transferRequests.length && pendingResultCount < resources.maxPendingResultCount) {
      const request = transferRequests[0];
      if (pendingResultBytes + request.bytes > resources.maxPendingResultBytes) break;
      transferRequests.shift(); reservations.set(request.trialId, request); pendingResultCount++; pendingResultBytes += request.bytes;
      peakPendingResultCount = Math.max(peakPendingResultCount, pendingResultCount); peakPendingResultBytes = Math.max(peakPendingResultBytes, pendingResultBytes);
      send(request.worker, { type: 'result-permit', trialId: request.trialId, attemptId: request.attemptId });
    }
  };
  const releaseTransfer = trialId => {
    const reservation = reservations.get(trialId); if (!reservation) return;
    reservations.delete(trialId); pendingResultCount--; pendingResultBytes -= reservation.bytes;
    send(reservation.worker, { type: 'result-ack', trialId, attemptId: reservation.attemptId }); admitTransfers();
  };
  const finishStepBarrier = () => {
    if (!workersReady || !stepBarrier || stepBarrier.pending.size) return;
    const targetTick = (Math.floor(stepBarrier.maxTick / resources.checkpointTicks) + 1) * resources.checkpointTicks;
    const id = stepBarrier.controlId;
    stepBarrier = null; stepInFlight = { controlId: id, targetTick, pending: new Set(activeWorkers) };
    for (const worker of activeWorkers) send(worker, { type: 'step', controlId: id, targetTick });
    notify(options.onControlState, { ...state(), controlId: id, targetTick });
  };
  const controls = {
    pause: () => { if (closed) return { ...state(), retired: true }; paused = true; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'pause', controlId }); return state(); },
    resume: () => { if (closed) return { ...state(), retired: true }; paused = false; controlId++; stepBarrier = null; stepInFlight = null; broadcast({ type: 'resume', controlId }); return state(); },
    step: () => { if (closed) return { ...state(), retired: true }; paused = true; controlId++; stepInFlight = null; stepBarrier = { controlId, pending: new Set(activeWorkers), maxTick: 0 };
      if (workersReady) broadcast({ type: 'step-prepare', controlId }); finishStepBarrier(); return state(); },
    cancel: () => closed ? { ...state(), retired: true } : cancel('cancelled')
  };
  const abort = () => cancel('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => cancel('wall-time-safety'), resources.maxTotalMs), supervised = [];
  const accept = (message, worker, synthetic = false) => {
    const result = message.result, job = assignedByTrial.get(result?.trialId);
    if (!job || !assignments.get(worker)?.has(result.trialId) || message.attemptId !== job.attemptId || result.scenarioId !== job.scenario.id || result.candidateId !== job.candidate.id) {
      callbackError ||= new Error('Invalid worker result identity'); cancel('infrastructure-error'); return;
    }
    const encoded = JSON.stringify(result), digest = createHash('sha256').update(encoded).digest('hex'), bytes = Buffer.byteLength(encoded);
    if (finished.has(result.trialId)) {
      if (persistence.get(result.trialId)?.digest !== digest) { deliveryConflicts.push({ trialId: result.trialId, attemptId: message.attemptId, digest }); callbackError ||= new Error('Conflicting worker result'); cancel('infrastructure-error'); }
      else if (!reservations.has(result.trialId)) send(worker, { type: 'result-ack', trialId: result.trialId, attemptId: message.attemptId });
      return;
    }
    const reservation = reservations.get(result.trialId);
    if (!synthetic && (!reservation || reservation.worker !== worker || reservation.bytes !== bytes || reservation.digest !== digest)) { infrastructure('Unreserved or conflicting worker result transfer'); return; }
    freezeSurveyData(result); finished.add(result.trialId); results.push(result);
    const receipt = { trialId: result.trialId, attemptId: message.attemptId, digest, runGeneration, workerGeneration: generations.get(worker),
      sourceIdentity: result.provenance?.sourceHash || null, status: 'received', bytes, receivedMs: performance.now() - started };
    persistence.set(result.trialId, receipt);
    if (!synthetic && computations.has(result.trialId)) computations.get(result.trialId).status = 'received';
    callbackTail = callbackTail.then(async () => {
      const remaining = resources.maxTotalMs - (performance.now() - started);
      if (closed || remaining <= 0) { receipt.status = 'received-uncommitted'; releaseTransfer(result.trialId); return; }
      const controller = new AbortController(); persistenceControllers.add(controller);
      receipt.status = 'persistence-pending'; receipt.callbackStartedMs = performance.now() - started;
      let timer, onAbort;
      const deadline = new Promise(resolve => { onAbort = () => resolve({ expired: true }); controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(new SurveyPersistenceDeadlineError()), Math.min(resources.maxPersistenceMs, remaining)); });
      const callback = Promise.resolve().then(() => options.onResult?.(result, { id: message.attemptId, performance: message.performance },
        { signal: controller.signal, runGeneration, deadline: Date.now() + Math.min(resources.maxPersistenceMs, remaining), receipt: { ...receipt } })).then(() => ({ committed: true }), error => ({ error }));
      try {
        const outcome = await Promise.race([callback, deadline]); receipt.callbackLatencyMs = performance.now() - started - receipt.callbackStartedMs;
        if (outcome.expired) { receipt.status = 'unknown-after-timeout'; receipt.failureKind = 'persistence-deadline'; callbackError ||= new SurveyPersistenceDeadlineError(); cancel('persistence-timeout'); }
        else if (outcome.error) { receipt.status = 'failed-or-unknown'; receipt.failureKind = outcome.error.code || outcome.error.name || 'callback-error'; callbackError ||= outcome.error; cancel('storage-or-callback'); }
        else receipt.status = options.onResult ? 'committed' : 'computed-only';
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); persistenceControllers.delete(controller); releaseTransfer(result.trialId); notify(options.onControlState, state()); }
    });
  };
  try {
    notify(options.onControlReady, controls);
    for (let index = 0; index < count; index++) {
      const assigned = jobs.filter((job, slot) => slot % count === index), residentWorlds = Math.floor(resources.residentWorlds / count) + (index < resources.residentWorlds % count ? 1 : 0);
      const workerGeneration = randomUUID();
      const worker = new Worker(new URL('./survey-worker.js', import.meta.url), { workerData: { ...resources, residentWorlds, paused, jobs: assigned, workerGeneration, runGeneration }, resourceLimits: { maxOldGenerationSizeMb: resources.maxWorkerMB } });
      workers.push(worker); activeWorkers.add(worker); generations.set(worker, workerGeneration); assignments.set(worker, new Set(assigned.map(job => job.trialId)));
      supervised.push(new Promise(resolve => {
        let done = false;
        const hardLimit = setTimeout(() => { cancel('wall-time-safety'); worker.terminate(); }, resources.maxTotalMs + 2000);
        worker.on('message', message => {
          if (closed) return;
          if (message.runGeneration !== runGeneration || message.workerGeneration !== workerGeneration) { infrastructure('Invalid worker generation'); return; }
          if (message.type === 'result-ready') {
            const job = assignedByTrial.get(message.trialId);
            if (!assignments.get(worker).has(message.trialId) || message.attemptId !== job?.attemptId || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || !/^[0-9a-f]{64}$/.test(message.digest || '')) { infrastructure('Invalid worker transfer identity'); return; }
            const duplicate = reservations.get(message.trialId) || transferRequests.find(request => request.trialId === message.trialId) || computations.get(message.trialId);
            if (duplicate) {
              if (duplicate.digest !== message.digest || duplicate.bytes !== message.bytes || duplicate.attemptId !== message.attemptId) { deliveryConflicts.push({ trialId: message.trialId, attemptId: message.attemptId, digest: message.digest, originalDigest: duplicate.digest }); infrastructure('Conflicting worker transfer request'); }
              else if (reservations.has(message.trialId) || persistence.has(message.trialId)) send(worker, { type: 'result-permit', trialId: message.trialId, attemptId: message.attemptId });
              return;
            }
            computations.set(message.trialId, { trialId: message.trialId, attemptId: message.attemptId, digest: message.digest, bytes: message.bytes,
              runGeneration, workerGeneration, status: 'computed-waiting-transfer' });
            if (message.bytes > resources.maxPendingResultBytes) { computations.get(message.trialId).status = 'transfer-rejected-byte-bound'; send(worker, { type: 'result-reject', trialId: message.trialId, attemptId: message.attemptId }); infrastructure('Worker result exceeds pending byte bound'); return; }
            transferRequests.push({ ...message, worker }); admitTransfers();
          } else if (message.type === 'result') accept(message, worker);
          else if (message.type === 'telemetry') { if (!assignments.get(worker).has(message.trialId)) { infrastructure('Invalid worker telemetry identity'); return; } receipts.set(message.trialId, message.value); notify(options.onTelemetry, message.trialId, message.value); }
          else if (message.type === 'control-state') { if (stepInFlight && stepInFlight.controlId === message.value.controlId &&
              message.value.workerGeneration === workerGeneration && ['reached', 'empty', 'failed', 'terminal-before-target'].includes(message.value.stepStatus)) {
            stepInFlight.pending.delete(worker); if (!stepInFlight.pending.size) stepInFlight = null;
          } if (message.value.controlId == null || message.value.controlId === controlId) notify(options.onControlState, { ...state(), worker: index, ...message.value }); }
          else if (message.type === 'step-ready' && stepBarrier?.controlId === message.controlId && message.workerGeneration === workerGeneration && stepBarrier.pending.has(worker)) { stepBarrier.maxTick = Math.max(stepBarrier.maxTick, message.maxTick); stepBarrier.pending.delete(worker); finishStepBarrier(); }
          else if (message.type === 'done') done = true;
          else if (message.type === 'fatal') { callbackError ||= new Error(message.error); cancel('infrastructure-error'); }
          else if (!['started', 'step-ready'].includes(message.type)) infrastructure('Unknown worker message type');
        });
        worker.on('error', error => { callbackError ||= error; cancel('infrastructure-error'); });
        worker.on('exit', code => {
          clearTimeout(hardLimit); activeWorkers.delete(worker); stepInFlight?.pending.delete(worker);
          if (stepBarrier) { stepBarrier.pending.delete(worker); finishStepBarrier(); }
          for (let index = transferRequests.length - 1; index >= 0; index--) if (transferRequests[index].worker === worker) transferRequests.splice(index, 1);
          for (const job of assigned) if (!finished.has(job.trialId)) {
            releaseTransfer(job.trialId);
            accept({ result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id,
              status: cancelled ? 'interrupted' : 'infrastructure-error', terminationReason: reason || (done ? 'missing-worker-result' : 'worker-exit-' + code), lastTick: receipts.get(job.trialId)?.tick ?? 0, lastVerifiedReceipt: receipts.get(job.trialId) || null }, attemptId: job.attemptId }, worker, true);
          }
          resolve();
        });
      }));
      if (cancelled) send(worker, { type: 'cancel' });
    }
    workersReady = true;
    if (stepBarrier) { stepBarrier.pending = new Set(activeWorkers); broadcast({ type: 'step-prepare', controlId: stepBarrier.controlId }); finishStepBarrier(); }
    notify(options.onControlState, state());
    await Promise.all(supervised);
    await callbackTail;
    return { results, resources, runGeneration, elapsedMs: performance.now() - started, cancelled, reason, error: callbackError?.message || null,
      errorKind: callbackError?.kind || callbackError?.code || callbackError?.name || null,
      persistence: [...persistence.values()].map(receipt => ({ ...receipt })), deliveryConflicts, presentationErrors,
      computations: [...computations.values()].map(receipt => ({ ...receipt })),
      storage: { pendingResultCount, pendingResultBytes, peakPendingResultCount, peakPendingResultBytes },
      cancellationPolicy: 'stop-admission; drain received evidence within persistence and total deadlines',
      deadlineScope: 'total includes startup, pause, compute, transfer and persistence; trial includes admitted pause and transfer waits' };
  } finally {
    closed = true; for (const controller of persistenceControllers) controller.abort(new Error('run-closed'));
    clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); stepBarrier = null; stepInFlight = null;
    await Promise.all(workers.map(worker => worker.terminate()));
  }
};
export { normalizeSurveyResources, runSurveyJobs, SurveyPersistenceDeadlineError };
