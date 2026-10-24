import { compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { cloneJournalData } from '../workstation/CausalJournalCanonical.js';
import { browserSurveyReplayBudget, estimateBrowserSurveyReplayBytes } from './ProcgenSurveyReplayBudget.js';
import { getApplicationDeploymentRoot } from '../../../runtime/ActiveExecutionIdentity.js';
import { readBrowserGenerationStatus } from '../../../runtime/BrowserGenerationClient.js';
import { backgroundWorkerAdmission } from '../../resources/BackgroundWorkerAdmission.js';

let activeOwner = null;
export async function createBrowserSurveyReplaySession({ scenario, candidate, sourceManifest, signal, resourceBudget = browserSurveyReplayBudget,
  Worker = globalThis.Worker, serviceWorker = globalThis.navigator?.serviceWorker, workerAdmission = backgroundWorkerAdmission } = {}) {
  signal?.throwIfAborted();
  const job = cloneJournalData({ scenario, candidate: candidate || {}, sourceManifest }, { maxBytes: 4 * 1048576, maxNodes: 65536 });
  const comparison = compareActiveExecutionIdentity(job.sourceManifest?.executionIdentity);
  if (!comparison.matched) throw new Error('Exact replay requires the recorded immutable browser build: ' + comparison.mismatches.join(', '));
  if (activeOwner) throw new Error('An isolated browser replay is already active.');
  if (typeof Worker !== 'function') throw new Error('Dedicated workers are unavailable for exact replay.');
  const root = getApplicationDeploymentRoot(), controller = serviceWorker?.controller;
  if (!root || !controller || new URL(controller.scriptURL).origin + new URL(controller.scriptURL).pathname !== new URL('service-worker.js', root).href)
    throw new Error('Open the application installer before exact replay; a verified generation controller is required.');
  const token = {}, owner = 'isolated-survey-replay', bytes = estimateBrowserSurveyReplayBytes(job.scenario), nonce = globalThis.crypto.randomUUID();
  activeOwner = token; let admission, retireJob = () => {};
  try {
    admission = await workerAdmission.acquire({ kind: 'survey-replay', ownerId: owner, ownerEpoch: 0, sourceRevision: comparison.active.buildId,
      estimatedPeakBytes: bytes, signal, budgetAdapter: resourceBudget, deadlineMs: 300000, onCancel: reason => retireJob(reason) });
  } catch (error) { if (activeOwner === token) activeOwner = null; throw error; }
  let worker = null, pending = null, retired = false, sequence = 0, state = null, verification = null;
  const lifecycle = new AbortController();
  const retire = (reason = new Error('Isolated replay was canceled.')) => {
    if (retired) return;
    retired = true; lifecycle.abort(reason); signal?.removeEventListener('abort', cancel);
    try { serviceWorker.removeEventListener('controllerchange', controllerChanged); } catch { /* Listener failure cannot skip worker termination. */ }
    clearTimeout(lifetime);
    const request = pending; pending = null; if (request) { clearTimeout(request.timer); request.reject(reason); }
    try { worker?.terminate(); }
    catch (error) { admission.retainUnknown(error); return; }
    worker = null; if (activeOwner === token) activeOwner = null; admission.release();
  };
  const cancel = () => retire(signal.reason || new Error('Isolated replay was canceled.'));
  const controllerChanged = () => retire(new Error('The generation controller changed during isolated replay; restart the replay.'));
  const lifetime = setTimeout(() => retire(new Error('Isolated replay lifetime exceeded its five-minute bound.')), 300000);
  retireJob = retire;
  const request = (kind, details = {}) => {
    if (retired || pending) return Promise.reject(new Error(retired ? 'Replay owner is retired.' : 'Replay already has one pending command.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => retire(new Error('Isolated replay command timed out.')), kind === 'prepare' ? 180000 : 30000);
      pending = { sequence: id, kind, resolve, reject, timer };
      try { worker.postMessage({ schemaVersion: 1, kind, nonce, sequence: id, ...details }); }
      catch (error) { retire(error); }
    });
  };
  try {
    signal?.addEventListener('abort', cancel, { once: true }); signal?.throwIfAborted();
    serviceWorker.addEventListener('controllerchange', controllerChanged);
    const installed = await readBrowserGenerationStatus(controller, { signal: lifecycle.signal, timeout: 125000, verifyBuildId: comparison.active.buildId });
    if (retired || serviceWorker.controller !== controller || !installed?.offlineReady || installed.buildId !== comparison.active.buildId ||
        installed.resourceDelivery !== 'verified-immutable-responses') throw new Error('The executing generation is not completely installed under this controller.');
    worker = new Worker(new URL('./ProcgenSurveyReplayWorker.js', import.meta.url), { type: 'module', name: 'lemmings-exact-survey-replay' });
    worker.onmessage = event => {
      if (retired) return;
      try {
        const envelope = event.data, current = pending;
        if (!current || envelope?.schemaVersion !== 1 || envelope.nonce !== nonce || envelope.sequence !== current.sequence) throw new Error('Replay worker response has stale ownership.');
        const message = cloneJournalData(envelope, { maxBytes: 16 * 1048576, maxNodes: 400000 });
        if (message.kind === 'failure') throw new Error(message.error || 'Replay worker failed.');
        const expected = current.kind === 'prepare' ? 'ready' : current.kind === 'step' ? 'progress' : 'result';
        if (message.kind !== expected) throw new Error('Replay worker response has an unexpected command kind.');
        if (message.kind === 'ready') {
          if (!compareActiveExecutionIdentity(message.identity).matched || message.identity.activeExecution !== 'bound' ||
              !/^[a-f0-9-]{36}$/.test(message.identity.realmId || '') || message.identity.realmId === comparison.active.realmId ||
              message.sourceVerification?.activeExecution !== 'bound' || message.sourceVerification?.artifactIntegrity !== 'verified' ||
              message.sourceVerification?.codeDigest !== job.sourceManifest.codeDigest || message.sourceVerification?.executionIdentity?.realmId !== message.identity.realmId ||
              !compareActiveExecutionIdentity(message.sourceVerification?.executionIdentity).matched)
            throw new Error('Replay worker did not bind its actual isolated executable closure.');
          verification = message.sourceVerification;
        }
        if (message.kind !== 'result') {
          if (!Number.isSafeInteger(message.tick) || message.tick < (state?.tick ?? 0) || message.tick > job.scenario.horizonTicks || typeof message.done !== 'boolean') throw new Error('Replay worker progress is outside its declared horizon.');
          state = message;
        }
        clearTimeout(current.timer); pending = null; current.resolve(message);
      } catch (error) { retire(error); }
    };
    worker.onerror = event => { event.preventDefault?.(); retire(new Error('Replay worker failed to execute its immutable entry.')); };
    worker.onmessageerror = () => retire(new Error('Replay worker response could not be decoded.'));
    signal?.throwIfAborted();
    await request('prepare', { requiredIdentity: job.sourceManifest.executionIdentity, job });
    signal?.throwIfAborted();
    return Object.freeze({ get done() { return state.done; }, get sourceVerification() { return verification; },
      world: Object.freeze({ get tickIndex() { return state.tick; } }), telemetry: () => state.telemetry, preview: () => state.preview,
      step: count => request('step', { count }), result: async () => (await request('result')).result, dispose: () => retire() });
  } catch (error) { retire(error); throw error; }
}
