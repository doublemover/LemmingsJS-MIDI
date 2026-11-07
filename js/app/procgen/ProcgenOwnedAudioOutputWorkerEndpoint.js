import { createDirectOwnedSineOutput } from '../midi-ui/DirectOwnedSineOutput.js';
import { attachProcgenSimulationOutput } from './ProcgenSimulationOutputConsumer.js';
import { createResourceBudget } from '../resources/ResourceBudget.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { cloneData } from '../../core/CanonicalData.js';
import { OWNED_AUDIO_OUTPUT_PROTOCOL } from './ProcgenOwnedAudioOutputProtocol.js';

export function createProcgenOwnedAudioOutputWorkerEndpoint({ postMessage, close, timers = globalThis } = {}) {
  const budget = createResourceBudget({ limitBytes: 64 * 1048576 });
  let ownerId = null, producer = null, consumer = null, pending = null, closing = null, sequence = 0, failure = null, timer = null, stateSequence = 0, awaitingState = 0, dirty = false, receiptCount = 0;
  const send = (type, fields = {}) => postMessage({ protocol: OWNED_AUDIO_OUTPUT_PROTOCOL, ownerId, type, ...fields });
  const state = () => ({ phase: closing ? 'retiring' : failure ? 'failed-paused' : consumer ? 'attached-awaiting-explicit-simulation-run' : producer ? 'prepared-silent' : 'preparing',
    failure: failure?.message || null, output: 'owned-reference-sine', source: producer?.diagnostics() || null, consumer: consumer?.state() || null, receiptCount,
    path: 'simulation-worker-to-owned-audio-worker-to-actual-audio-worklet', recording: 'off', acousticReceipt: false });
  const report = () => {
    dirty = true; if (timer !== null || awaitingState || closing) return;
    timer = timers.setTimeout(() => { timer = null; if (closing) return; dirty = false; awaitingState = ++stateSequence; send('state', { sequence: awaitingState, state: state() }); }, 250);
  };
  const fail = error => { failure ||= error instanceof Error ? error : new Error(String(error)); report(); };
  const retire = () => {
    if (closing) return closing;
    closing = (async () => {
      timers.clearTimeout(timer); if (pending) await Promise.allSettled([pending]);
      const receipt = (consumer || producer)?.dispose(); await receipt?.completion;
      const outcome = receipt?.outcome || 'complete';
      send('retired', { outcome, processorRetirement: producer?.processorRetirement() || null }); close();
    })().catch(error => { fail(error); send('retired', { outcome: 'unknown', error: error.message, processorRetirement: producer?.processorRetirement() || null }); close(); });
    return closing;
  };
  return Object.freeze({ fail, dispose: retire, receive(request) {
    if (request?.protocol !== OWNED_AUDIO_OUTPUT_PROTOCOL || typeof request.ownerId !== 'string' || !request.ownerId || request.ownerId.length > 128 || ownerId && request.ownerId !== ownerId) return;
    if (request.type === 'state-ack') { if (request.sequence === awaitingState) { awaitingState = 0; if (dirty) report(); } return; }
    if (request.type === 'dispose') { if (ownerId) void retire(); return; }
    if (closing || pending || !Number.isSafeInteger(request.requestId) || request.requestId <= sequence) { if (ownerId) send('response', { requestId: request.requestId, error: 'Complete the active owned-audio preparation first.' }); return; }
    sequence = request.requestId;
    pending = (async () => {
      let value;
      if (!ownerId) {
        ownerId = request.ownerId;
        const execution = getActiveExecutionIdentity();
        if (request.type !== 'initialize' || execution.activeExecution !== 'bound' || !compareActiveExecutionIdentity(request.executionIdentity).matched) throw new Error('The direct owned-audio worker must execute the exact bound application.');
        producer = await createDirectOwnedSineOutput({ port: request.port, sampleRate: request.sampleRate, maxVoices: 8, resourceBudget: budget, performance: cloneData(request.performance, { maxBytes: 1048576, maxNodes: 16384 }), timers, onFailure: fail, onReceipt: () => { receiptCount++; report(); } });
        value = { executionIdentity: execution };
      } else if (request.type === 'attach' && producer && !consumer && !failure) {
        const options = cloneData(request.options, { maxBytes: 4096, maxNodes: 128 });
        if (options.initialHeldVoices !== 0) throw new Error('The direct reference source needs a complete empty initial voice boundary.');
        consumer = attachProcgenSimulationOutput({ port: request.port, manifest: options.manifest, outputs: [producer], resourceBudget: budget, onFailure: fail, onReceipt: report });
        value = { status: 'attached', output: 'owned-reference-sine' };
      } else throw new Error('The direct audio owner only admits one immutable source and simulation attachment.');
      report(); send('response', { requestId: request.requestId, value });
    })().catch(error => { fail(error); send('response', { requestId: request.requestId, error: String(error.message).slice(0, 512) }); }).finally(() => { pending = null; });
  } });
}
