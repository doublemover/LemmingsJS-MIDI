import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createNodeSurveyTrial, loadProcgenMasks } from './SurveyNodeWorld.js';

let stopped = false, paused = !!workerData.paused, stepTarget = null, controlId = 0;
const resident = [], waiting = workerData.jobs.slice();
const controlState = () => ({ paused, stepTarget: stepTarget?.tick ?? null, residentWorlds: resident.length, queued: waiting.length, ticks: resident.map(entry => ({ trialId: entry.job.trialId, tick: entry.trial.world.tickIndex })) });
parentPort.on('message', message => {
  if (message.type === 'cancel') { stopped = true; stepTarget = null; }
  else if (Number.isSafeInteger(message.controlId) && message.controlId > controlId && ['pause', 'resume', 'step-prepare'].includes(message.type)) {
    controlId = message.controlId; stepTarget = null; paused = message.type !== 'resume';
    if (message.type === 'step-prepare') parentPort.postMessage({ type: 'step-ready', controlId, workerGeneration: workerData.workerGeneration, maxTick: Math.max(0, ...resident.map(entry => entry.trial.world.tickIndex)) });
    else parentPort.postMessage({ type: 'control-state', value: controlState() });
  } else if (message.type === 'step' && message.controlId === controlId && message.workerGeneration === workerData.workerGeneration &&
      Number.isSafeInteger(message.targetTick) && message.targetTick >= 1) {
    paused = true; stepTarget = { tick: message.targetTick, controlId, selected: new Map(), admit: resident.length === 0 };
    for (const entry of resident) stepTarget.selected.set(entry.job.trialId, { trialId: entry.job.trialId, tick: entry.trial.world.tickIndex, status: 'resident' });
  }
});
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
const idle = () => new Promise(resolve => setTimeout(resolve, 25));
const publish = (entry, final = false) => {
  entry.trial.observeMilestone?.(); entry.lastPublished = entry.trial.world.tickIndex;
  const now = performance.now(), telemetry = entry.trial.telemetry();
  if (final || !entry.preview || now - entry.lastPreviewMs >= 500) { entry.preview = entry.trial.preview(); entry.previewTick = entry.trial.world.tickIndex; entry.lastPreviewMs = now; }
  parentPort.postMessage({ type: 'telemetry', trialId: entry.job.trialId, value: { ...telemetry, preview: { ...entry.preview, tick: entry.previewTick, stale: entry.previewTick !== telemetry.tick } } });
};
const main = async () => {
  const masks = await loadProcgenMasks();
  const admit = async (lease = null) => {
    while (!stopped && (!paused || lease?.admit) && waiting.length && resident.length < workerData.residentWorlds) {
      const job = waiting.shift(), start = performance.now();
      try {
        const trial = await createNodeSurveyTrial(job, masks), entry = { job, trial, start, ticks: 0, lastPublished: -Infinity };
        resident.push(entry); lease?.selected.set(job.trialId, { trialId: job.trialId, tick: 0, status: 'admitted' }); parentPort.postMessage({ type: 'started', trialId: job.trialId }); publish(entry);
      } catch (error) { lease?.selected.set(job.trialId, { trialId: job.trialId, tick: 0, status: 'infrastructure-error' }); parentPort.postMessage({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'infrastructure-error', lastTick: 0, error: error.message }, attemptId: job.attemptId }); }
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
            if (count > 0) { trial.step(count); entry.ticks += trial.world.tickIndex - previousTick; }
            const tick = trial.world.tickIndex;
            if (tick - entry.lastPublished >= workerData.checkpointTicks || tick >= target || trial.done) publish(entry);
            if (trial.done) status = 'episode';
          }
          if (status) {
            publish(entry, true);
            const result = status === 'episode' ? trial.result() : { ...trial.result(status), status };
            parentPort.postMessage({ type: 'result', result, attemptId: job.attemptId,
              performance: { elapsedMs: performance.now() - entry.start, measuredTicks: entry.ticks, rssBytes: process.memoryUsage().rss, rssScope: 'whole-node-process', memoryLimitScope: 'worker-v8-old-generation' } });
          }
        } catch (error) {
          status = 'infrastructure-error'; parentPort.postMessage({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status, lastTick: trial.world.tickIndex, error: error.message }, attemptId: job.attemptId });
        }
        if (stepTarget?.selected.has(job.trialId)) stepTarget.selected.set(job.trialId, { trialId: job.trialId, tick: trial.world.tickIndex, status: status || 'resident' });
        if (status) { trial.dispose(); resident.splice(index, 1); } else index++;
        await yieldTurn();
      }
      if (stepTarget && !stepTarget.admit && [...stepTarget.selected.values()].every(receipt => receipt.status !== 'resident' ||
          receipt.tick >= Math.min(stepTarget.tick, resident.find(entry => entry.job.trialId === receipt.trialId)?.job.scenario.horizonTicks ?? stepTarget.tick))) {
        const lease = stepTarget; stepTarget = null;
        const selected = [...lease.selected.values()], progressed = selected.some(receipt => receipt.tick > 0);
        parentPort.postMessage({ type: 'control-state', value: { ...controlState(), controlId: lease.controlId,
          workerGeneration: workerData.workerGeneration, stepStatus: !selected.length ? 'empty' : progressed ? 'reached' : 'failed',
          reachedCheckpoint: progressed ? lease.tick : null, selected } });
      }
      if (!resident.length && paused && !stopped) await idle();
    }
    for (const job of waiting) parentPort.postMessage({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'cancelled', lastTick: 0, terminationReason: 'not-admitted' }, attemptId: job.attemptId });
  } finally { for (const entry of resident) entry.trial.dispose(); }
  parentPort.postMessage({ type: 'done' }); parentPort.close();
};
main().catch(error => { parentPort.postMessage({ type: 'fatal', error: error.message }); parentPort.close(); });
