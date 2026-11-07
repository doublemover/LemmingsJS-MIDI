import { Worker } from 'node:worker_threads';
import { runSurveyJobs } from '../../scripts/procgen-survey/SurveyWorkerPool.js';

const mode = process.argv[2], retained = [];
const job = trialId => ({ trialId, attemptId: trialId + ':attempt', scenario: { id: 'ingress-eight', horizonTicks: 8 }, candidate: { id: 'baseline' } });
const source = `import { parentPort, workerData as d } from 'node:worker_threads';
  import { createHash } from 'node:crypto';
  const mode = ${JSON.stringify(mode)}, job = d.jobs[0];
  const post = message => parentPort.postMessage({ ...message, schemaVersion: 1, runGeneration: d.runGeneration, workerGeneration: d.workerGeneration });
  const result = { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id,
    status: 'completed', episodeComplete: true, lastTick: 8 };
  const encoded = JSON.stringify(result), bytes = Buffer.byteLength(encoded), digest = createHash('sha256').update(encoded).digest('hex');
  parentPort.on('message', message => {
    if (message.type === 'cancel') { parentPort.close(); return; }
    if (message.fault) { parentPort.postMessage(null); return; }
    if (message.type === 'result-permit') {
      if (mode === 'permitted-cycle') result.self = result;
      if (mode === 'bigint') result.value = 1n;
      post({ type: 'result', attemptId: job.attemptId, result });
    }
    if (message.type === 'result-ack') {
      post({ type: 'result-outcome-ack', trialId: job.trialId, attemptId: job.attemptId, digest, status: message.status, publicationDigest: null });
      post({ type: 'done' }); parentPort.close();
    }
  });
  if (mode === 'null') parentPort.postMessage(null);
  else if (mode === 'undefined') parentPort.postMessage(undefined);
  else if (mode === 'scalar') parentPort.postMessage(3);
  else if (mode === 'unknown') post({ type: 'unknown' });
  else if (mode === 'missing') post({ type: 'telemetry', trialId: job.trialId });
  else if (mode === 'unreserved-cycle') { result.self = result; post({ type: 'result', attemptId: job.attemptId, result }); }
  else {
    post({ type: 'ready', queued: 1, residentWorldLimit: d.residentWorlds, assetPreparationMs: 0 });
    if (mode !== 'preserve-original' || job.trialId === 'original') {
      post({ type: 'preparing', trialId: job.trialId, attemptId: job.attemptId, scenarioId: job.scenario.id, candidateId: job.candidate.id });
      post({ type: 'started', trialId: job.trialId, attemptId: job.attemptId, scenarioId: job.scenario.id, candidateId: job.candidate.id, tick: 0 });
      post({ type: 'result-ready', trialId: job.trialId, attemptId: job.attemptId, bytes, digest });
    }
  }`;
const jobs = mode === 'preserve-original' ? [job('original'), job('faulty')] : [job('faulty')];
const report = await runSurveyJobs(jobs, { executionWorkers: jobs.length, residentWorlds: jobs.length, maxTotalMs: 1500, maxStartupMs: 500,
  workerFactory(_url, configuration) {
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), configuration); retained.push(worker);
    if (mode === 'send-failure') worker.postMessage = () => { throw new Error('host-send-refused'); };
    return worker;
  }, onResult(result) {
    if (mode === 'preserve-original' && result.trialId === 'original') setTimeout(() => retained[1].postMessage({ fault: true }), 10);
  } });
process.stdout.write(JSON.stringify({ ...report, orphanWorkers: retained.filter(worker => worker.threadId !== -1).length }) + '\n');
