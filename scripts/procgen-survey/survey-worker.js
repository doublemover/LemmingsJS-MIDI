import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createNodeSurveyTrial, loadProcgenMasks } from './SurveyNodeWorld.js';

let stopped = false, paused = !!workerData.paused, stepTarget = null;
const resident = [], waiting = workerData.jobs.slice();
const controlState = () => ({ paused, stepTarget, residentWorlds: resident.length, queued: waiting.length, ticks: resident.map(entry => ({ trialId: entry.job.trialId, tick: entry.trial.world.tickIndex })) });
parentPort.on('message', message => {
  if (message.type === 'cancel') { stopped = true; stepTarget = null; }
  else if (message.type === 'pause') { paused = true; stepTarget = null; parentPort.postMessage({ type: 'control-state', value: controlState() }); }
  else if (message.type === 'resume') { paused = false; stepTarget = null; parentPort.postMessage({ type: 'control-state', value: controlState() }); }
  else if (message.type === 'step-prepare') {
    paused = true; stepTarget = null;
    parentPort.postMessage({ type: 'step-ready', controlId: message.controlId, maxTick: Math.max(0, ...resident.map(entry => entry.trial.world.tickIndex)) });
  } else if (message.type === 'step' && Number.isInteger(message.targetTick) && message.targetTick >= 1) { paused = true; stepTarget = message.targetTick; }
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
  const admit = async () => {
    while (!stopped && !paused && waiting.length && resident.length < workerData.residentWorlds) {
      const job = waiting.shift(), start = performance.now();
      try {
        const trial = await createNodeSurveyTrial(job, masks), entry = { job, trial, start, ticks: 0, lastPublished: -Infinity };
        resident.push(entry); parentPort.postMessage({ type: 'started', trialId: job.trialId }); publish(entry);
      } catch (error) { parentPort.postMessage({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'infrastructure-error', lastTick: 0, error: error.message }, attemptId: job.attemptId }); }
      await yieldTurn();
    }
  };
  try {
    while (resident.length || !stopped && waiting.length) {
      if (!stopped && paused && stepTarget == null) { await idle(); continue; }
      await admit();
      for (let index = 0; index < resident.length;) {
        const entry = resident[index], { trial, job } = entry;
        if (!stopped && paused && (stepTarget == null || trial.world.tickIndex >= Math.min(stepTarget, job.scenario.horizonTicks))) { index++; continue; }
        let status = null;
        try {
          if (stopped) status = 'cancelled';
          else if (performance.now() - entry.start > workerData.maxTrialMs) status = 'interrupted';
          else {
            const previousTick = trial.world.tickIndex, target = Math.min(job.scenario.horizonTicks, stepTarget ?? job.scenario.horizonTicks), count = Math.min(workerData.sliceTicks, target - previousTick);
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
        if (status) { trial.dispose(); resident.splice(index, 1); } else index++;
        await yieldTurn();
      }
      if (stepTarget != null && resident.every(entry => entry.trial.world.tickIndex >= Math.min(stepTarget, entry.job.scenario.horizonTicks))) {
        const reachedCheckpoint = stepTarget; stepTarget = null;
        parentPort.postMessage({ type: 'control-state', value: { ...controlState(), reachedCheckpoint } });
      }
      if (!resident.length && paused && !stopped) await idle();
    }
    for (const job of waiting) parentPort.postMessage({ type: 'result', result: { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id, status: 'cancelled', lastTick: 0, terminationReason: 'not-admitted' }, attemptId: job.attemptId });
  } finally { for (const entry of resident) entry.trial.dispose(); }
  parentPort.postMessage({ type: 'done' }); parentPort.close();
};
main().catch(error => { parentPort.postMessage({ type: 'fatal', error: error.message }); parentPort.close(); });
