import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createNodeSurveyTrial, loadProcgenMasks } from './SurveyNodeWorld.js';

let stopped = false, paused = !!workerData.paused, stepTarget = null, preparedStep = null, preparingJob = null, controlId = 0;
const resident = [], waiting = workerData.jobs.slice();
const deliveryWaiters = new Map();
const post = message => parentPort.postMessage({ ...message, schemaVersion: 1, runGeneration: workerData.runGeneration, workerGeneration: workerData.workerGeneration });
const deliver = async message => {
  const encoded = JSON.stringify(message.result), trialId = message.result.trialId, digest = createHash('sha256').update(encoded).digest('hex');
  const wait = phase => new Promise(resolve => deliveryWaiters.set(trialId, { attemptId: message.attemptId, digest, phase, resolve }));
  const permission = wait('permission');
  post({ type: 'result-ready', trialId, attemptId: message.attemptId, bytes: Buffer.byteLength(encoded), digest });
  if (!await permission) return;
  const acknowledged = wait('outcome'); post(message); await acknowledged;
};
const controlState = () => ({ paused, stepTarget: stepTarget?.tick ?? null, residentWorlds: resident.length, queued: waiting.length, ticks: resident.map(entry => ({ trialId: entry.job.trialId, tick: entry.trial.world.tickIndex })) });
const plannedSelection = () => {
  const selected = resident.map(entry => ({ trialId: entry.job.trialId, attemptId: entry.job.attemptId, tick: entry.trial.world.tickIndex, status: 'resident' }));
  if (preparingJob) selected.push({ trialId: preparingJob.trialId, attemptId: preparingJob.attemptId, tick: 0, status: 'preparing' });
  if (!resident.length) for (const job of waiting.slice(0, Math.max(0, workerData.residentWorlds - selected.length))) selected.push({ trialId: job.trialId, attemptId: job.attemptId, tick: 0, status: 'queued' });
  return selected;
};
parentPort.on('message', message => {
  if (message.runGeneration !== workerData.runGeneration || message.workerGeneration !== workerData.workerGeneration) return;
  if (['result-permit', 'result-ack', 'result-reject'].includes(message.type)) {
    const pending = deliveryWaiters.get(message.trialId);
    if (pending?.attemptId === message.attemptId) {
      if (message.type === 'result-permit' && pending.phase === 'outcome' && message.digest === pending.digest) return;
      if (message.digest !== pending.digest || message.type === 'result-ack' && (pending.phase !== 'outcome' ||
          !['committed', 'computed-only', 'received-uncommitted', 'failed-or-unknown', 'unknown-after-timeout'].includes(message.status)) ||
          message.type !== 'result-ack' && pending.phase !== 'permission') throw new Error('Invalid host persistence outcome receipt');
      if (message.type === 'result-ack' && message.publicationDigest !== (message.publication ? createHash('sha256').update(JSON.stringify(message.publication)).digest('hex') : null)) throw new Error('Invalid host publication receipt digest');
      deliveryWaiters.delete(message.trialId);
      if (message.type === 'result-ack') post({ type: 'result-outcome-ack', trialId: message.trialId, attemptId: message.attemptId, digest: message.digest, status: message.status, publicationDigest: message.publicationDigest });
      pending.resolve(message.type !== 'result-reject');
    }
    return;
  }
  if (message.type === 'cancel') { stopped = true; stepTarget = null; preparedStep = null; }
  else if (Number.isSafeInteger(message.controlId) && message.controlId > controlId && ['pause', 'resume', 'step-prepare'].includes(message.type)) {
    controlId = message.controlId; stepTarget = null; preparedStep = null; paused = message.type !== 'resume';
    if (message.type === 'step-prepare') {
      const selected = plannedSelection(); preparedStep = { controlId, selected };
      post({ type: 'step-ready', controlId, selected, maxTick: Math.max(0, ...selected.map(receipt => receipt.tick)) });
    }
    else post({ type: 'control-state', value: { ...controlState(), controlId } });
  } else if (message.type === 'step' && message.controlId === controlId && message.workerGeneration === workerData.workerGeneration &&
      preparedStep?.controlId === controlId && Number.isSafeInteger(message.targetTick) && message.targetTick >= 1) {
    paused = true; stepTarget = { tick: message.targetTick, controlId, selected: new Map(preparedStep.selected.map(receipt => [receipt.trialId, receipt])), admit: resident.length === 0 };
    preparedStep = null;
  }
});
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const idle = () => new Promise(resolve => setTimeout(resolve, 25));
const publish = (entry, final = false) => {
  entry.trial.observeMilestone?.(); entry.lastPublished = entry.trial.world.tickIndex;
  const now = performance.now(), telemetry = entry.trial.telemetry();
  if (final || !entry.preview || now - entry.lastPreviewMs >= 500) { entry.preview = entry.trial.preview(); entry.previewTick = entry.trial.world.tickIndex; entry.lastPreviewMs = now; }
  post({ type: 'telemetry', trialId: entry.job.trialId, value: { ...telemetry, preview: { ...entry.preview, tick: entry.previewTick, stale: entry.previewTick !== telemetry.tick } } });
};
const main = async () => {
  const preparing = performance.now();
  const masks = await loadProcgenMasks();
  post({ type: 'ready', queued: waiting.length, residentWorldLimit: workerData.residentWorlds, assetPreparationMs: performance.now() - preparing });
  const admit = async (lease = null) => {
    while (!stopped && (!paused || lease?.admit && stepTarget === lease && lease.selected.has(waiting[0]?.trialId)) && waiting.length && resident.length < workerData.residentWorlds) {
      const job = waiting.shift(), start = performance.now();
      preparingJob = job;
      post({ type: 'preparing', trialId: job.trialId, attemptId: job.attemptId, scenarioId: job.scenario.id, candidateId: job.candidate.id });
      try {
        const trial = await createNodeSurveyTrial(job, masks), entry = { job, trial, start, ticks: 0, lastPublished: -Infinity };
        resident.push(entry);
        const receipt = { trialId: job.trialId, attemptId: job.attemptId, tick: 0, status: 'admitted' };
        if (lease?.selected.has(job.trialId)) lease.selected.set(job.trialId, receipt);
        if (stepTarget?.selected.has(job.trialId)) stepTarget.selected.set(job.trialId, receipt);
        post({ type: 'started', trialId: job.trialId,
          attemptId: job.attemptId, scenarioId: trial.scenario.id, candidateId: trial.candidate.id, tick: trial.world.tickIndex }); publish(entry);
      } catch (error) {
        preparingJob = null;
        const receipt = { trialId: job.trialId, attemptId: job.attemptId, tick: 0, status: 'infrastructure-error' };
        if (lease?.selected.has(job.trialId)) lease.selected.set(job.trialId, receipt);
        if (stepTarget?.selected.has(job.trialId)) stepTarget.selected.set(job.trialId, receipt);
        await deliver({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'infrastructure-error', episodeComplete: false, lastTick: 0, error: error.message }, attemptId: job.attemptId });
      } finally { preparingJob = null; }
      await yieldTurn();
    }
    if (lease) lease.admit = false;
  };
  try {
    while (resident.length || !stopped && waiting.length) {
      if (!stopped && paused && stepTarget == null) { await idle(); continue; }
      await admit(stepTarget);
      for (let index = 0; index < resident.length;) {
        const entry = resident[index], { trial, job } = entry;
        if (!stopped && paused && (stepTarget == null || !stepTarget.selected.has(job.trialId) || trial.world.tickIndex >= Math.min(stepTarget.tick, job.scenario.horizonTicks))) { index++; continue; }
        let status = null;
        try {
          if (stopped) status = 'cancelled';
          else if (performance.now() - entry.start > workerData.maxTrialMs) status = 'interrupted';
          else {
            const previousTick = trial.world.tickIndex, target = Math.min(job.scenario.horizonTicks, stepTarget?.tick ?? job.scenario.horizonTicks), count = Math.min(workerData.sliceTicks, target - previousTick);
            if (count > 0) { trial.step(count, { telemetry: false }); entry.ticks += trial.world.tickIndex - previousTick; }
            const tick = trial.world.tickIndex;
            if (tick - entry.lastPublished >= workerData.checkpointTicks || tick >= target || trial.done) publish(entry);
            if (trial.done) status = 'episode';
          }
          if (status) {
            publish(entry, true);
            const result = status === 'episode' ? trial.result() : { ...trial.result(status), status };
            await deliver({ type: 'result', result, attemptId: job.attemptId,
              performance: { elapsedMs: performance.now() - entry.start, measuredTicks: entry.ticks, rssBytes: process.memoryUsage().rss, rssScope: 'whole-node-process', memoryLimitScope: 'worker-v8-old-generation' } });
          }
        } catch (error) {
          status = 'infrastructure-error'; await deliver({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status, episodeComplete: false, lastTick: trial.world.tickIndex, error: error.message }, attemptId: job.attemptId });
        }
        if (stepTarget?.selected.has(job.trialId)) stepTarget.selected.set(job.trialId, { trialId: job.trialId, attemptId: job.attemptId, tick: trial.world.tickIndex, status: status || 'resident' });
        if (status) { trial.dispose(); resident.splice(index, 1); } else index++;
        await yieldTurn();
      }
      if (stepTarget && !stepTarget.admit && [...stepTarget.selected.values()].every(receipt => !['resident', 'admitted', 'preparing', 'queued'].includes(receipt.status) ||
          receipt.tick >= Math.min(stepTarget.tick, workerData.jobs.find(job => job.trialId === receipt.trialId).scenario.horizonTicks))) {
        const lease = stepTarget; stepTarget = null;
        const selected = [...lease.selected.values()], reached = selected.length > 0 && selected.every(receipt => receipt.tick >= lease.tick);
        const stepStatus = !selected.length ? 'empty' : reached ? 'reached' : selected.some(receipt => receipt.status === 'infrastructure-error') ? 'failed' : 'terminal-before-target';
        post({ type: 'control-state', value: { ...controlState(), controlId: lease.controlId,
          workerGeneration: workerData.workerGeneration, stepStatus, targetTick: lease.tick,
          reachedCheckpoint: reached ? lease.tick : null, selected } });
      }
      if (!resident.length && paused && !stopped) await idle();
    }
    for (const job of waiting) await deliver({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'cancelled', episodeComplete: false, lastTick: 0, terminationReason: 'not-admitted' }, attemptId: job.attemptId });
  } finally { for (const entry of resident) entry.trial.dispose(); }
  post({ type: 'done' }); parentPort.close();
};
main().catch(error => { post({ type: 'fatal', error: error.message }); parentPort.close(); });
