import { createBrowserSurveyTrial } from './ProcgenSurveyBrowserAssets.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { openIsolatedBrowserSurveyExecution } from './ProcgenSurveyExecution.js';
import { canonicalJournalText, cloneJournalData } from '../workstation/CausalJournalCanonical.js';
import { createResourceBudget } from '../../resources/ResourceBudget.js';
import { estimateBrowserSurveyReplayBytes } from './ProcgenSurveyReplayBudget.js';

let nonce = null, trial = null, execution = null, busy = false, sequence = 0, retired = false;
const controller = new AbortController();
const send = value => {
  canonicalJournalText(value, { maxBytes: 16 * 1048576, maxNodes: 400000 });
  globalThis.postMessage(value);
};
const retire = () => {
  retired = true; controller.abort(); execution?.close(); execution = null;
  try { trial?.dispose(); } finally { trial = null; }
};
const dispatch = async raw => {
  if (retired) return;
  const message = cloneJournalData(raw, { maxBytes: 4 * 1048576, maxNodes: 65536 });
  if (message?.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(message.nonce || '') ||
      !Number.isSafeInteger(message.sequence) || message.sequence !== sequence + 1 || busy) throw new Error('Invalid isolated replay command envelope.');
  if (nonce && message.nonce !== nonce) throw new Error('Replay owner changed.');
  sequence = message.sequence; nonce ||= message.nonce; busy = true;
  try {
    if (message.kind === 'prepare' && !trial && sequence === 1) {
      if (!compareActiveExecutionIdentity(message.requiredIdentity).matched) throw new Error('Replay worker executes a different or unbound build.');
      execution = openIsolatedBrowserSurveyExecution();
      const estimate = estimateBrowserSurveyReplayBytes(message.job?.scenario), budget = createResourceBudget({ limitBytes: estimate });
      trial = await createBrowserSurveyTrial({ ...message.job, mode: 'exact', executionLease: execution.lease, signal: controller.signal, resourceBudget: budget });
      if (retired) { trial.dispose(); trial = null; return; }
      send({ schemaVersion: 1, kind: 'ready', nonce, sequence, identity: getActiveExecutionIdentity(), sourceVerification: trial.sourceVerification,
        tick: trial.world.tickIndex, done: trial.done, telemetry: trial.telemetry(), preview: trial.preview({ maximumChunks: 2 }) });
    } else if (message.kind === 'step' && trial && Number.isSafeInteger(message.count) && message.count >= 1 && message.count <= 16) {
      trial.step(message.count);
      send({ schemaVersion: 1, kind: 'progress', nonce, sequence, tick: trial.world.tickIndex, done: trial.done,
        telemetry: trial.telemetry(), preview: trial.preview({ maximumChunks: 2 }) });
    } else if (message.kind === 'result' && trial) {
      send({ schemaVersion: 1, kind: 'result', nonce, sequence, result: trial.result() });
    } else throw new Error('Unsupported isolated replay command.');
  } finally { busy = false; }
};
globalThis.addEventListener('message', event => {
  dispatch(event.data).catch(error => {
    try { send({ schemaVersion: 1, kind: 'failure', nonce, sequence, error: String(error.message || error).slice(0, 512) }); }
    finally { try { retire(); } finally { globalThis.close(); } }
  });
});
globalThis.addEventListener('messageerror', () => { try { retire(); } finally { globalThis.close(); } });
