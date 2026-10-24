import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { freezeSurveyData } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { validateSurveyWorkerEnvelope, encodeSurveyWorkerJson } from './SurveyWorkerIngress.js';

class SurveyPersistenceDeadlineError extends Error {
  constructor() { super('Survey result persistence deadline exceeded; commit outcome unknown'); this.name = 'SurveyPersistenceDeadlineError'; this.kind = 'persistence-deadline'; }
}

const integer = (value, fallback, minimum, maximum) => { const result = value ?? fallback; if (!Number.isInteger(result) || result < minimum || result > maximum) throw new RangeError('Invalid survey resource bound'); return result; };
const normalizeSurveyResources = (value = {}) => ({
  executionWorkers: integer(value.executionWorkers, 1, 1, 2), residentWorlds: integer(value.residentWorlds, 16, 1, 64),
  sliceTicks: integer(value.sliceTicks, 16, 1, 128), checkpointTicks: integer(value.checkpointTicks, 64, 1, 4096),
  maxTotalTicks: integer(value.maxTotalTicks, 100000, 1, 1000000), maxTotalMs: integer(value.maxTotalMs, 120000, 100, 900000),
  maxTrialMs: integer(value.maxTrialMs, 60000, 50, 300000), maxWorkerMB: integer(value.maxWorkerMB, 512, 64, 2048),
  maxStartupMs: integer(value.maxStartupMs, 15000, 50, 60000), maxControlMs: integer(value.maxControlMs, 10000, 50, 60000),
  maxPersistenceMs: integer(value.maxPersistenceMs, 30000, 50, 300000),
  maxPendingResultCount: integer(value.maxPendingResultCount, 32, 1, 1024),
  maxPendingResultBytes: integer(value.maxPendingResultBytes, 8 * 1048576, 4096, 128 * 1048576)
});
const runSurveyJobs = async (jobs, options = {}) => {
  const resources = normalizeSurveyResources(options), started = performance.now(), runGeneration = randomUUID();
  if (options.workerFactory !== undefined && typeof options.workerFactory !== 'function') throw new TypeError('Survey workerFactory must create a worker');
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
      error: null, persistence: [], computations: [], admissions: [], controlState: state, presentationErrors };
  }
  const count = Math.min(resources.executionWorkers, resources.residentWorlds, jobs.length), workers = [], activeWorkers = new Set(), results = [], receipts = new Map(), finished = new Set(), presentationErrors = [], persistence = new Map(), deliveryConflicts = [];
  const assignedByTrial = new Map(jobs.map(job => [job.trialId, job]));
  const workerFailures = new Map();
  let cancelled = !!options.signal?.aborted, reason = cancelled ? 'cancelled' : null, callbackError = null, callbackTail = Promise.resolve(), paused = !!options.paused, controlId = 0, stepBarrier = null, stepInFlight = null, workersReady = false, pendingResultCount = 0, pendingResultBytes = 0;
  const generations = new Map(), assignments = new Map(), workerSlots = new Map(), reservations = new Map(), transferRequests = [], persistenceControllers = new Set(), computations = new Map(), readyWorkers = new Set(), trialTimers = new Map(), controlReceipts = [], awaitingOutcomeAcks = new Map();
  const admissions = new Map(jobs.map(job => [job.trialId, { trialId: job.trialId, attemptId: job.attemptId, scenarioId: job.scenario.id,
    candidateId: job.candidate.id, runGeneration, status: 'not-admitted', lastVerifiedTick: 0 }]));
  let peakPendingResultCount = 0, peakPendingResultBytes = 0, closed = false, latestStepReceipt = null, discardedControlReceipts = 0;
  const displayError = error => { if (presentationErrors.length < 16) presentationErrors.push(String(error?.message || error)); };
  const notify = (callback, ...args) => { try { const returned = callback?.(...args); returned?.catch?.(displayError); } catch (error) { displayError(error); } };
  const terminate = worker => {
    try { Promise.resolve(worker.terminate()).catch(error => { callbackError ||= error; }); }
    catch (error) { callbackError ||= error; }
  };
  const send = (worker, message) => {
    if (!activeWorkers.has(worker)) return false;
    try { worker.postMessage({ ...message, schemaVersion: 1, runGeneration, workerGeneration: generations.get(worker) }); return true; }
    catch (error) { activeWorkers.delete(worker); infrastructure('Host worker send failed: ' + error.message, worker, error); return false; }
  };
  const broadcast = message => { for (const worker of activeWorkers) send(worker, message); };
  const state = () => ({ runGeneration, controlId, paused, cancelled, stepPending: !!stepBarrier || !!stepInFlight?.pending.size, executionWorkers: activeWorkers.size,
    stepReceipt: stepBarrier || stepInFlight ? projectStep(stepBarrier || stepInFlight, 'pending') : latestStepReceipt,
    readyWorkers: readyWorkers.size, preparingWorkers: [...activeWorkers].filter(worker => !readyWorkers.has(worker)).length,
    computation: { computedResults: computations.size, receivedResults: results.length,
      preparingTrials: [...admissions.values()].filter(receipt => receipt.status === 'preparing' && !receipt.outcomeStatus).length,
      admittedTrials: [...admissions.values()].filter(receipt => receipt.status === 'admitted' && !receipt.outcomeStatus).length },
    storage: { pendingResultCount, pendingResultBytes, peakPendingResultCount, peakPendingResultBytes } });
  const projectStep = (request, status, terminationReason = null) => {
    const workers = [...request.workers.values()].map(receipt => ({ worker: receipt.worker, workerGeneration: receipt.workerGeneration,
      status: receipt.status, selectionKnown: receipt.selected !== null, acknowledged: !!receipt.acknowledged,
      selected: (receipt.selected || []).map(selected => receipt.acknowledged ? { ...selected } : {
        trialId: selected.trialId, attemptId: selected.attemptId, status: 'unknown-progress', lastVerifiedTick: Math.max(selected.tick, admissions.get(selected.trialId).lastVerifiedTick) }) }));
    const selected = workers.flatMap(receipt => receipt.selected.map(value => ({ ...value, worker: receipt.worker, workerGeneration: receipt.workerGeneration })));
    return freezeSurveyData({ schemaVersion: 1, runGeneration, controlId: request.controlId, status,
      phase: status === 'pending' ? request.phase : 'complete', targetTick: request.targetTick ?? null,
      requestedMs: request.requestedMs, prepareLatencyMs: request.preparedMs === undefined ? null : request.preparedMs - request.requestedMs,
      barrierLatencyMs: performance.now() - started - request.requestedMs,
      reachedCheckpoint: status === 'reached' ? request.targetTick : null, terminationReason,
      selected, selectedCount: selected.length, selectionComplete: workers.length === request.expectedWorkers && workers.every(receipt => receipt.selectionKnown), workers,
      expectedWorkers: request.expectedWorkers, acknowledgedWorkers: workers.filter(receipt => receipt.acknowledged).length,
      unacknowledgedWorkerCount: request.expectedWorkers - workers.filter(receipt => receipt.acknowledged).length,
      unacknowledgedWorkers: workers.filter(receipt => !receipt.acknowledged).map(receipt => ({ worker: receipt.worker, workerGeneration: receipt.workerGeneration })) });
  };
  const finishStep = (status, terminationReason = null) => {
    const request = stepBarrier || stepInFlight; if (!request) return;
    clearTimeout(request.timer); latestStepReceipt = projectStep(request, status, terminationReason);
    controlReceipts.push(latestStepReceipt); if (controlReceipts.length > 128) { controlReceipts.shift(); discardedControlReceipts++; }
    stepBarrier = null; stepInFlight = null;
  };
  const includeStepWorkers = request => {
    for (const worker of activeWorkers) if (!request.workers.has(worker)) request.workers.set(worker, { worker: workerSlots.get(worker), workerGeneration: generations.get(worker), status: 'preparing', selected: null, acknowledged: false });
  };
  const cancel = message => { if (!cancelled) { cancelled = true; reason = message; } finishStep('cancelled', message); broadcast({ type: 'cancel' });
    if (['wall-time-safety', 'persistence-timeout'].includes(message)) for (const controller of persistenceControllers) controller.abort(new Error(message));
    notify(options.onControlState, state()); return state(); };
  const infrastructure = (message, worker, error = null) => {
    callbackError ||= error || new Error(message);
    if (!workerFailures.has(worker || 'host')) workerFailures.set(worker || 'host', Object.freeze({ schemaVersion: 1,
      worker: worker ? workerSlots.get(worker) : null, workerGeneration: worker ? generations.get(worker) : null,
      kind: error?.kind || 'worker-infrastructure', message: String(message).slice(0, 1024), observedMs: performance.now() - started }));
    if (worker) { activeWorkers.delete(worker); readyWorkers.delete(worker); terminate(worker); }
    try { cancel('infrastructure-error'); } catch (failure) { callbackError ||= failure; }
  };
  const admitTransfers = () => {
    while (!closed && transferRequests.length && pendingResultCount < resources.maxPendingResultCount) {
      const request = transferRequests[0];
      if (pendingResultBytes + request.bytes > resources.maxPendingResultBytes) break;
      transferRequests.shift(); reservations.set(request.trialId, request); pendingResultCount++; pendingResultBytes += request.bytes;
      peakPendingResultCount = Math.max(peakPendingResultCount, pendingResultCount); peakPendingResultBytes = Math.max(peakPendingResultBytes, pendingResultBytes);
      send(request.worker, { type: 'result-permit', trialId: request.trialId, attemptId: request.attemptId, digest: request.digest });
    }
  };
  const acknowledgePersistence = (worker, receipt) => {
    if (!receipt) return;
    if (receipt.workerReceiptStatus !== 'acknowledged') {
      receipt.workerReceiptStatus = activeWorkers.has(worker) ? 'sent-unacknowledged' : 'worker-unavailable';
      if (activeWorkers.has(worker)) awaitingOutcomeAcks.set(worker, receipt.trialId);
    }
    send(worker, { type: 'result-ack', trialId: receipt.trialId, attemptId: receipt.attemptId, digest: receipt.digest, status: receipt.status,
      publication: receipt.publication || null, publicationDigest: receipt.publicationDigest || null });
  };
  const releaseTransfer = trialId => {
    const reservation = reservations.get(trialId); if (!reservation) return;
    reservations.delete(trialId); pendingResultCount--; pendingResultBytes -= reservation.bytes;
    acknowledgePersistence(reservation.worker, persistence.get(trialId)); admitTransfers();
  };
  const finishStepBarrier = () => {
    if (!workersReady || !stepBarrier || stepBarrier.pending.size) return;
    const targetTick = (Math.floor(stepBarrier.maxTick / resources.checkpointTicks) + 1) * resources.checkpointTicks;
    const id = stepBarrier.controlId;
    stepInFlight = stepBarrier; stepBarrier = null;
    Object.assign(stepInFlight, { targetTick, phase: 'stepping', preparedMs: performance.now() - started, pending: new Set(activeWorkers) });
    for (const worker of activeWorkers) send(worker, { type: 'step', controlId: id, targetTick });
    if (!stepInFlight.pending.size) finishStep('empty');
    notify(options.onControlState, { ...state(), controlId: id, targetTick });
  };
  const controls = {
    pause: () => { if (closed) return { ...state(), retired: true }; finishStep('superseded', 'pause'); paused = true; controlId++; broadcast({ type: 'pause', controlId }); notify(options.onControlState, state()); return state(); },
    resume: () => { if (closed) return { ...state(), retired: true }; finishStep('superseded', 'resume'); paused = false; controlId++; broadcast({ type: 'resume', controlId }); notify(options.onControlState, state()); return state(); },
    step: () => {
      if (closed) return { ...state(), retired: true }; finishStep('superseded', 'new-step'); paused = true; controlId++;
      const request = { controlId, requestedMs: performance.now() - started, phase: 'preparing', expectedWorkers: workersReady ? activeWorkers.size : count, pending: new Set(activeWorkers), workers: new Map(), maxTick: 0 };
      stepBarrier = request; includeStepWorkers(request);
      request.timer = setTimeout(() => {
        if (stepBarrier !== request && stepInFlight !== request) return;
        finishStep('timed-out', 'control-deadline'); paused = true; controlId++; broadcast({ type: 'pause', controlId }); notify(options.onControlState, state());
      }, resources.maxControlMs);
      if (workersReady) broadcast({ type: 'step-prepare', controlId }); finishStepBarrier(); notify(options.onControlState, state()); return state();
    },
    cancel: () => closed ? { ...state(), retired: true } : cancel('cancelled')
  };
  const abort = () => cancel('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => cancel('wall-time-safety'), resources.maxTotalMs), supervised = [];
  const accept = (message, worker, synthetic = false) => {
    const result = message.result, job = assignedByTrial.get(result?.trialId);
    if (!job || !assignments.get(worker)?.has(result.trialId) || message.attemptId !== job.attemptId || result.scenarioId !== job.scenario.id || result.candidateId !== job.candidate.id) {
      infrastructure('Invalid worker result identity', worker); return;
    }
    const reservation = reservations.get(result.trialId), previous = persistence.get(result.trialId);
    if (!synthetic && (!reservation || reservation.worker !== worker) &&
        !(finished.has(result.trialId) && previous?.workerGeneration === generations.get(worker))) {
      infrastructure('Unreserved or conflicting worker result transfer', worker); return;
    }
    if (!synthetic && (!Number.isSafeInteger(result.lastTick) || result.lastTick < 0 || result.lastTick > job.scenario.horizonTicks ||
        !['completed', 'failed', 'timeout', 'cancelled', 'interrupted', 'unsupported', 'infrastructure-error'].includes(result.status) ||
        ['completed', 'failed', 'timeout'].includes(result.status) !== (result.episodeComplete === true) ||
        result.episodeComplete !== undefined && typeof result.episodeComplete !== 'boolean' ||
        result.episodeComplete && (result.lastTick !== job.scenario.horizonTicks || admissions.get(result.trialId).status !== 'admitted'))) { infrastructure('Invalid worker result completion receipt', worker); return; }
    const { encoded, bytes } = encodeSurveyWorkerJson(result, { maxBytes: synthetic ? 131072 : reservation?.bytes ?? previous.bytes });
    if (message.performance != null) encodeSurveyWorkerJson(message.performance, { maxBytes: 65536, maxNodes: 8192 });
    const digest = createHash('sha256').update(encoded).digest('hex');
    if (finished.has(result.trialId)) {
      if (persistence.get(result.trialId)?.digest !== digest) { deliveryConflicts.push({ trialId: result.trialId, attemptId: message.attemptId, digest }); callbackError ||= new Error('Conflicting worker result'); cancel('infrastructure-error'); }
      else if (!reservations.has(result.trialId)) acknowledgePersistence(worker, persistence.get(result.trialId));
      return;
    }
    if (!synthetic && (!reservation || reservation.worker !== worker || reservation.bytes !== bytes || reservation.digest !== digest)) { infrastructure('Unreserved or conflicting worker result transfer', worker); return; }
    freezeSurveyData(result); finished.add(result.trialId); results.push(result);
    const receipt = { trialId: result.trialId, attemptId: message.attemptId, digest, runGeneration, workerGeneration: generations.get(worker),
      sourceIdentity: result.provenance?.sourceHash || null, status: 'received', bytes, receivedMs: performance.now() - started,
      workerReceiptStatus: synthetic ? 'not-applicable-synthetic' : 'awaiting-storage-outcome' };
    persistence.set(result.trialId, receipt);
    admissions.get(result.trialId).outcomeStatus = result.status;
    if (!synthetic && computations.has(result.trialId)) computations.get(result.trialId).status = 'received';
    callbackTail = callbackTail.then(async () => {
      const remaining = resources.maxTotalMs - (performance.now() - started);
      if (closed || remaining <= 0) { receipt.status = 'received-uncommitted'; releaseTransfer(result.trialId); return; }
      const controller = new AbortController(); persistenceControllers.add(controller);
      receipt.status = 'persistence-pending'; receipt.callbackStartedMs = performance.now() - started;
      let timer, onAbort;
      const deadline = new Promise(resolve => { onAbort = () => resolve({ expired: true }); controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(new SurveyPersistenceDeadlineError()), Math.min(resources.maxPersistenceMs, remaining)); });
      const callback = Promise.resolve().then(() => options.onResult?.(result, { id: message.attemptId, performance: message.performance,
        runGeneration, workerGeneration: generations.get(worker), outcomeDigest: digest, sourceIdentity: receipt.sourceIdentity },
      { signal: controller.signal, runGeneration, deadline: Date.now() + Math.min(resources.maxPersistenceMs, remaining), receipt: { ...receipt } })).then(value => ({ committed: true, publication: value?.publication })).catch(error => ({ error }));
      try {
        const outcome = await Promise.race([callback, deadline]); receipt.callbackLatencyMs = performance.now() - started - receipt.callbackStartedMs;
        if (outcome.expired) { receipt.status = 'unknown-after-timeout'; receipt.failureKind = 'persistence-deadline'; callbackError ||= new SurveyPersistenceDeadlineError(); cancel('persistence-timeout'); }
        else if (outcome.error) { receipt.status = 'failed-or-unknown'; receipt.failureKind = outcome.error.kind || outcome.error.code || outcome.error.name || 'callback-error'; callbackError ||= outcome.error; cancel('storage-or-callback'); }
        else {
          receipt.status = options.onResult ? 'committed' : 'computed-only';
          if (outcome.publication && typeof outcome.publication === 'object') {
            try {
              const publication = { schemaVersion: 1 };
              if (outcome.publication.schemaVersion !== 1 || typeof outcome.publication.status !== 'string') throw new TypeError('Invalid callback publication receipt');
              for (const key of ['status', 'reference', 'checksum', 'attemptReference', 'attemptChecksum', 'originalReference', 'originalChecksum', 'durability']) {
                const value = outcome.publication[key];
                if (value === undefined || value === null) continue;
                if (typeof value !== 'string' || value.length > 1024) throw new TypeError('Invalid callback publication receipt field');
                publication[key] = value;
              }
              receipt.publication = freezeSurveyData(publication); receipt.publicationDigest = createHash('sha256').update(JSON.stringify(publication)).digest('hex'); receipt.publicationStatus = 'callback-reported';
            } catch { receipt.publicationStatus = 'invalid-callback-receipt'; }
          }
        }
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); persistenceControllers.delete(controller); releaseTransfer(result.trialId); notify(options.onControlState, state()); }
    });
  };
  try {
    notify(options.onControlReady, controls);
    for (let index = 0; index < count; index++) {
      const assigned = jobs.filter((job, slot) => slot % count === index), residentWorlds = Math.floor(resources.residentWorlds / count) + (index < resources.residentWorlds % count ? 1 : 0);
      const workerGeneration = randomUUID();
      const worker = (options.workerFactory || ((url, configuration) => new Worker(url, configuration)))(new URL('./survey-worker.js', import.meta.url),
        { workerData: { ...resources, residentWorlds, paused, jobs: assigned, workerGeneration, runGeneration }, resourceLimits: { maxOldGenerationSizeMb: resources.maxWorkerMB } });
      if (!(worker instanceof Worker)) throw new TypeError('Survey workerFactory must return a native Worker');
      workers.push(worker); activeWorkers.add(worker); generations.set(worker, workerGeneration); workerSlots.set(worker, index); assignments.set(worker, new Set(assigned.map(job => job.trialId)));
      for (const job of assigned) Object.assign(admissions.get(job.trialId), { worker: index, workerGeneration });
      supervised.push(new Promise(resolve => {
        let done = false;
        const pendingOutcome = () => awaitingOutcomeAcks.has(worker);
        const startupLimit = resources.maxStartupMs < resources.maxTotalMs ? setTimeout(() => {
          for (const job of assigned) Object.assign(admissions.get(job.trialId), { failureKind: 'startup-deadline', startupLimitMs: resources.maxStartupMs });
          cancel('startup-timeout'); terminate(worker);
        }, resources.maxStartupMs) : null;
        const hardLimit = setTimeout(() => { cancel('wall-time-safety'); terminate(worker); }, resources.maxTotalMs + 2000);
        worker.on('message', message => {
          try {
            if (closed) return;
            validateSurveyWorkerEnvelope(message, runGeneration, workerGeneration);
            if (message.type === 'ready') {
              if (message.queued !== assigned.length || message.residentWorldLimit !== residentWorlds || !Number.isFinite(message.assetPreparationMs) || message.assetPreparationMs < 0) { infrastructure('Invalid worker preparation receipt', worker); return; }
              clearTimeout(startupLimit); readyWorkers.add(worker);
              for (const job of assigned) Object.assign(admissions.get(job.trialId), { workerGeneration, workerReadyMs: performance.now() - started, assetPreparationMs: message.assetPreparationMs });
              notify(options.onControlState, state());
            } else if (message.type === 'preparing') {
              if (pendingOutcome()) { infrastructure('Worker resumed without acknowledging persistence outcome', worker); return; }
              const job = assignedByTrial.get(message.trialId), admission = admissions.get(message.trialId);
              if (!readyWorkers.has(worker) || !assignments.get(worker).has(message.trialId) || message.attemptId !== job?.attemptId ||
                message.scenarioId !== job.scenario.id || message.candidateId !== job.candidate.id || admission.status !== 'not-admitted') { infrastructure('Invalid worker preparation identity', worker); return; }
              Object.assign(admission, { status: 'preparing', preparationStartedMs: performance.now() - started });
              trialTimers.set(job.trialId, setTimeout(() => {
                const preparing = admission.status === 'preparing';
                Object.assign(admission, { failureKind: preparing ? 'trial-preparation-deadline' : 'trial-wall-time-deadline', trialLimitMs: resources.maxTrialMs });
                cancel(preparing ? 'trial-preparation-timeout' : 'trial-wall-time-safety'); terminate(worker);
              }, resources.maxTrialMs));
              notify(options.onControlState, state());
            } else if (message.type === 'started') {
              const job = assignedByTrial.get(message.trialId), previous = admissions.get(message.trialId);
              if (!readyWorkers.has(worker) || !assignments.get(worker).has(message.trialId) || message.attemptId !== job?.attemptId ||
                message.scenarioId !== job.scenario.id || message.candidateId !== job.candidate.id || message.tick !== 0 || previous.status !== 'preparing') { infrastructure('Invalid worker admission identity', worker); return; }
              Object.assign(previous, { status: 'admitted', admittedMs: performance.now() - started, preparationLatencyMs: performance.now() - started - previous.preparationStartedMs });
              notify(options.onControlState, state());
            } else if (message.type === 'result-ready') {
              if (pendingOutcome()) { infrastructure('Worker resumed without acknowledging persistence outcome', worker); return; }
              const job = assignedByTrial.get(message.trialId);
              if (!readyWorkers.has(worker) || !assignments.get(worker).has(message.trialId) || message.attemptId !== job?.attemptId || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || !/^[0-9a-f]{64}$/.test(message.digest || '')) { infrastructure('Invalid worker transfer identity', worker); return; }
              clearTimeout(trialTimers.get(job.trialId)); trialTimers.delete(job.trialId);
              const duplicate = reservations.get(message.trialId) || transferRequests.find(request => request.trialId === message.trialId) || computations.get(message.trialId);
              if (duplicate) {
                if (duplicate.digest !== message.digest || duplicate.bytes !== message.bytes || duplicate.attemptId !== message.attemptId) { deliveryConflicts.push({ trialId: message.trialId, attemptId: message.attemptId, digest: message.digest, originalDigest: duplicate.digest }); infrastructure('Conflicting worker transfer request', worker); }
                else if (reservations.has(message.trialId) || persistence.has(message.trialId)) send(worker, { type: 'result-permit', trialId: message.trialId, attemptId: message.attemptId, digest: message.digest });
                return;
              }
              computations.set(message.trialId, { trialId: message.trialId, attemptId: message.attemptId, digest: message.digest, bytes: message.bytes,
                runGeneration, workerGeneration, status: 'computed-waiting-transfer' });
              if (message.bytes > resources.maxPendingResultBytes) { computations.get(message.trialId).status = 'transfer-rejected-byte-bound'; send(worker, { type: 'result-reject', trialId: message.trialId, attemptId: message.attemptId, digest: message.digest }); infrastructure('Worker result exceeds pending byte bound'); return; }
              transferRequests.push({ ...message, worker }); admitTransfers();
            } else if (message.type === 'result') accept(message, worker);
            else if (message.type === 'result-outcome-ack') {
              const receipt = persistence.get(message.trialId);
              if (!receipt || !assignments.get(worker).has(message.trialId) || message.attemptId !== receipt.attemptId || receipt.workerGeneration !== workerGeneration ||
                message.digest !== receipt.digest || message.status !== receipt.status || message.publicationDigest !== (receipt.publicationDigest || null) ||
                !['sent-unacknowledged', 'acknowledged'].includes(receipt.workerReceiptStatus)) { infrastructure('Invalid worker persistence outcome acknowledgement', worker); return; }
              receipt.workerReceiptStatus = 'acknowledged'; receipt.workerAcknowledgedMs ??= performance.now() - started;
              if (awaitingOutcomeAcks.get(worker) === message.trialId) awaitingOutcomeAcks.delete(worker); notify(options.onControlState, state());
            }
            else if (message.type === 'telemetry') {
              const job = assignedByTrial.get(message.trialId), admission = admissions.get(message.trialId);
              if (!assignments.get(worker).has(message.trialId) || admission.status !== 'admitted' || message.value?.trialId !== message.trialId ||
                !Number.isSafeInteger(message.value.tick) || message.value.tick < admission.lastVerifiedTick || message.value.tick > job.scenario.horizonTicks) { infrastructure('Invalid worker telemetry identity or tick', worker); return; }
              admission.lastVerifiedTick = message.value.tick; receipts.set(message.trialId, message.value); notify(options.onTelemetry, message.trialId, message.value);
            }
            else if (message.type === 'control-state') {
              const value = message.value;
              if (!value || !Number.isSafeInteger(value.controlId)) { infrastructure('Invalid worker control identity', worker); return; }
              if (value.controlId !== controlId) return;
              if (value.stepStatus !== undefined) {
                if (!stepInFlight || stepInFlight.controlId !== value.controlId || !stepInFlight.pending.has(worker)) return;
                const prepared = stepInFlight.workers.get(worker), selected = value.selected;
                const validSelection = Array.isArray(selected) && selected.length === prepared.selected.length && new Set(selected.map(receipt => receipt?.trialId)).size === selected.length && selected.every(receipt => {
                  const prior = prepared.selected.find(original => original.trialId === receipt?.trialId), job = assignedByTrial.get(receipt?.trialId);
                  return prior && receipt.attemptId === job.attemptId && Number.isSafeInteger(receipt.tick) && receipt.tick >= prior.tick && receipt.tick <= job.scenario.horizonTicks &&
                  ['resident', 'episode', 'infrastructure-error', 'cancelled', 'interrupted'].includes(receipt.status) &&
                  (receipt.tick >= stepInFlight.targetTick || receipt.status !== 'resident');
                });
                const reached = validSelection && selected.length > 0 && selected.every(receipt => receipt.tick >= stepInFlight.targetTick);
                const expected = !validSelection ? null : !selected.length ? 'empty' : reached ? 'reached' : selected.some(receipt => receipt.status === 'infrastructure-error') ? 'failed' : 'terminal-before-target';
                if (!validSelection || value.workerGeneration !== workerGeneration || value.targetTick !== stepInFlight.targetTick || value.stepStatus !== expected || value.reachedCheckpoint !== (reached ? stepInFlight.targetTick : null)) { infrastructure('Invalid worker checkpoint receipt', worker); return; }
                message.value = { ...value, barrierLatencyMs: performance.now() - started - stepInFlight.requestedMs, prepareLatencyMs: stepInFlight.preparedMs - stepInFlight.requestedMs };
                Object.assign(prepared, { acknowledged: true, status: value.stepStatus, selected: selected.map(receipt => ({ ...receipt })) });
                for (const receipt of selected) admissions.get(receipt.trialId).lastVerifiedTick = Math.max(admissions.get(receipt.trialId).lastVerifiedTick, receipt.tick);
                stepInFlight.pending.delete(worker);
                if (!stepInFlight.pending.size) {
                  const outcomes = [...stepInFlight.workers.values()];
                  finishStep(outcomes.some(receipt => receipt.status === 'failed') ? 'failed' : outcomes.some(receipt => receipt.status === 'terminal-before-target') ? 'terminal-before-target' : outcomes.some(receipt => receipt.status === 'reached') ? 'reached' : 'empty');
                }
              }
              notify(options.onControlState, { ...state(), worker: index, ...message.value });
            }
            else if (message.type === 'step-ready' && stepBarrier?.controlId === message.controlId && stepBarrier.pending.has(worker)) {
              const selected = message.selected;
              if (!Array.isArray(selected) || selected.length > residentWorlds || new Set(selected.map(receipt => receipt?.trialId)).size !== selected.length || selected.some(receipt => {
                const job = assignedByTrial.get(receipt?.trialId);
                return !assignments.get(worker).has(receipt?.trialId) || receipt.attemptId !== job.attemptId || !Number.isSafeInteger(receipt.tick) || receipt.tick < 0 || receipt.tick > job.scenario.horizonTicks ||
                !['resident', 'preparing', 'queued'].includes(receipt.status) || receipt.status !== 'resident' && receipt.tick !== 0;
              }) || message.maxTick !== Math.max(0, ...selected.map(receipt => receipt.tick))) { infrastructure('Invalid worker checkpoint selection', worker); return; }
              Object.assign(stepBarrier.workers.get(worker), { status: 'prepared', selected: selected.map(receipt => ({ ...receipt })) });
              for (const receipt of selected) admissions.get(receipt.trialId).lastVerifiedTick = Math.max(admissions.get(receipt.trialId).lastVerifiedTick, receipt.tick);
              stepBarrier.maxTick = Math.max(stepBarrier.maxTick, message.maxTick); stepBarrier.pending.delete(worker); finishStepBarrier();
            }
            else if (message.type === 'done') {
              if (pendingOutcome()) { infrastructure('Worker completed without acknowledging persistence outcome', worker); return; }
              done = true;
            }
            else if (message.type === 'fatal') { callbackError ||= new Error(message.error); cancel('infrastructure-error'); }
            else if (message.type !== 'step-ready') infrastructure('Unknown worker message type', worker);
          } catch (error) { infrastructure('Worker ingress failed: ' + error.message, worker, error); }
        });
        worker.on('error', error => infrastructure('Worker runtime failed: ' + error.message, worker, error));
        worker.on('messageerror', error => infrastructure('Worker message could not be decoded', worker, error));
        worker.on('exit', code => {
          try {
            clearTimeout(startupLimit); clearTimeout(hardLimit); activeWorkers.delete(worker); readyWorkers.delete(worker);
            awaitingOutcomeAcks.delete(worker);
            for (const job of assigned) { clearTimeout(trialTimers.get(job.trialId)); trialTimers.delete(job.trialId); }
            if ((!done || code !== 0) && !cancelled) infrastructure('Worker exited unexpectedly: ' + code);
            const pendingStep = stepBarrier || stepInFlight;
            if (pendingStep?.pending.has(worker)) {
              pendingStep.workers.get(worker).status = 'worker-exited'; finishStep('failed', 'worker-exited-before-control-receipt'); notify(options.onControlState, state());
            }
            for (let index = transferRequests.length - 1; index >= 0; index--) if (transferRequests[index].worker === worker) transferRequests.splice(index, 1);
            for (const job of assigned) if (!finished.has(job.trialId)) {
              if (computations.get(job.trialId)?.status === 'computed-waiting-transfer') computations.get(job.trialId).status = 'computed-not-transferred-worker-exit';
              releaseTransfer(job.trialId);
              accept({ result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id,
                status: cancelled ? 'interrupted' : 'infrastructure-error', episodeComplete: false, terminationReason: reason || (done ? 'missing-worker-result' : 'worker-exit-' + code), lastTick: receipts.get(job.trialId)?.tick ?? 0, lastVerifiedReceipt: receipts.get(job.trialId) || null }, attemptId: job.attemptId }, worker, true);
            }
          } catch (error) { infrastructure('Worker retirement failed: ' + error.message, null, error); }
          finally { clearTimeout(startupLimit); clearTimeout(hardLimit); activeWorkers.delete(worker); readyWorkers.delete(worker); resolve(); }
        });
      }));
      if (cancelled) send(worker, { type: 'cancel' });
    }
    workersReady = true;
    if (stepBarrier) { includeStepWorkers(stepBarrier); stepBarrier.pending = new Set(activeWorkers); broadcast({ type: 'step-prepare', controlId: stepBarrier.controlId }); finishStepBarrier(); }
    notify(options.onControlState, state());
    await Promise.all(supervised);
    await callbackTail;
    return { results, resources, runGeneration, elapsedMs: performance.now() - started, cancelled, reason, error: callbackError?.message || null,
      errorKind: callbackError?.kind || callbackError?.code || callbackError?.name || null,
      persistence: [...persistence.values()].map(receipt => ({ ...receipt })), deliveryConflicts, presentationErrors,
      workerFailures: [...workerFailures.values()],
      computations: [...computations.values()].map(receipt => ({ ...receipt })),
      admissions: [...admissions.values()].map(receipt => ({ ...receipt })),
      controlReceipts: [...controlReceipts], discardedControlReceipts, controlState: state(),
      storage: { pendingResultCount, pendingResultBytes, peakPendingResultCount, peakPendingResultBytes },
      cancellationPolicy: 'stop-admission; drain received evidence within persistence and total deadlines',
      deadlineScope: 'startup includes import and mask preparation until readiness; control includes startup, selection, stepping and acknowledgement; trial includes per-world asset preparation, admitted pause and transfer waits; total includes all stages' };
  } finally {
    closed = true; for (const controller of persistenceControllers) controller.abort(new Error('run-closed'));
    for (const timer of trialTimers.values()) clearTimeout(timer); trialTimers.clear();
    clearTimeout(timeout); clearTimeout((stepBarrier || stepInFlight)?.timer); options.signal?.removeEventListener('abort', abort); stepBarrier = null; stepInFlight = null;
    await Promise.all(workers.map(worker => worker.terminate()));
  }
};
export { normalizeSurveyResources, runSurveyJobs, SurveyPersistenceDeadlineError };
