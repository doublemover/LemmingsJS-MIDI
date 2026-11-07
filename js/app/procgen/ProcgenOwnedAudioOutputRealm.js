import { validateDirectOwnedSinePerformance } from '../midi-ui/DirectOwnedSinePerformance.js';
import { createBrowserNotePreview } from '../midi-ui/browserNotePreview.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { OWNED_AUDIO_OUTPUT_PROTOCOL } from './ProcgenOwnedAudioOutputProtocol.js';

let ownerSequence = 0;
export async function prepareProcgenOwnedAudioOutputRealm({ resourceBudget, Worker = globalThis.Worker, MessageChannel = globalThis.MessageChannel, signal, performance, onState = () => {}, timers = globalThis } = {}) {
  performance = validateDirectOwnedSinePerformance(performance);
  signal?.throwIfAborted(); const execution = getActiveExecutionIdentity();
  if (execution.activeExecution !== 'bound' || typeof Worker !== 'function' || typeof MessageChannel !== 'function' || !resourceBudget) throw new Error('Independent owned audio needs a coherent application build, dedicated worker, transferable port and aggregate budget.');
  const ownerId = 'owned-audio-consumer:' + (++ownerSequence), storage = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'independent-owned-audio-producer-worker', category: 'checkpoint', bytes: 64 * 1048576 }), scope = createProcgenRetirementScope(), requests = new Map();
  let preview = null, session = null, source = null, worker = null, channel = null, sourceContext = null, state = null, failure = null, disposed = false, serial = 0, attached = false, resolveRetired;
  const retired = new Promise(resolve => { resolveRetired = resolve; });
  const report = () => { try { onState({ phase: disposed ? 'retiring' : failure ? 'failed-paused' : attached ? 'attached' : 'preparing', failure: failure?.message || null, output: 'independent-owned-audio-worker', worker: state, source: source?.state() || null }); } catch {} };
  const fail = error => {
    if (disposed) return; failure ||= error instanceof Error ? error : new Error(String(error));
    for (const pending of requests.values()) { timers.clearTimeout(pending.timer); pending.reject(failure); } requests.clear(); report(); dispose();
  };
  const send = (type, fields = {}, transfers = []) => worker.postMessage({ protocol: OWNED_AUDIO_OUTPUT_PROTOCOL, ownerId, type, ...fields }, transfers);
  const request = (type, fields = {}, transfers = []) => {
    if (disposed || failure || requests.size || !worker) return Promise.reject(failure || new Error('The independent audio owner is unavailable or busy.'));
    const requestId = ++serial;
    return new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => fail(new Error('The independent audio worker did not complete ' + type + '.')), 10000); requests.set(requestId, { resolve, reject, timer });
      try { send(type, { ...fields, requestId }, transfers); } catch (error) { fail(error); }
    });
  };
  const receive = event => {
    const message = event.data; if (message?.protocol !== OWNED_AUDIO_OUTPUT_PROTOCOL || message.ownerId !== ownerId) return;
    if (message.type === 'retired') { if (message.processorRetirement) source?.confirmRetirement(message.processorRetirement); resolveRetired(message); return; }
    if (disposed) return;
    if (message.type === 'state') { state = message.state; try { send('state-ack', { sequence: message.sequence }); } catch (error) { fail(error); } report(); if (state?.failure) fail(new Error(state.failure)); }
    else if (message.type === 'response') { const pending = requests.get(message.requestId); if (!pending) return; requests.delete(message.requestId); timers.clearTimeout(pending.timer); if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value); }
  };
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true; try { source?.mute(); } catch {} signal?.removeEventListener('abort', abort);
    for (const pending of requests.values()) { timers.clearTimeout(pending.timer); pending.reject(new Error('The independent audio owner retired.')); } requests.clear();
    const producer = (async () => {
      const failures = [];
      if (worker) {
        try { send('dispose'); } catch {} let timer;
        try { await Promise.race([retired, new Promise(resolve => { timer = timers.setTimeout(resolve, 5000); })]); } finally { timers.clearTimeout(timer); }
        try { worker.terminate(); } catch (error) { failures.push(error); }
        try { worker.removeEventListener('message', receive); } catch (error) { failures.push(error); }
      }
      for (const port of [channel?.port1, channel?.port2]) try { port?.close(); } catch (error) { failures.push(error); }
      try { const receipt = await preview?.dispose(); if (receipt?.outcome && receipt.outcome !== 'complete') throw new Error('The private audio owner retained unresolved resources.'); } catch (error) { failures.push(error); }
      if (sourceContext && sourceContext.state !== 'closed') failures.push(new Error('The direct browser context did not confirm closure; its aggregate reservation remains owned.'));
      if (source) try { const receipt = source.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(new Error('The direct source retained native ownership.'), { retirement: receipt }); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Independent audio retirement remains unresolved.');
      worker = preview = session = source = channel = null;
    })();
    return scope.retire([{ name: 'direct-worker-and-private-native-context', run: () => producer }, { name: 'direct-output-worker-storage', run: async () => { await producer; storage.release(); } }]);
  };
  const abort = () => dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    preview = createBrowserNotePreview({ resourceBudget, maxVoices: 8, maxInstrumentBackends: 1, maxNoteSeconds: 120, volume: 1, masterVolume: .7, runtimeConfig: { latencyProfile: 'robust', preferredSampleRate: 48000 } });
    if (!await preview.enable(null, { takeOver: true })) throw new Error('The explicitly selected independent browser output could not acquire performance ownership.');
    signal?.throwIfAborted(); if (disposed) throw new Error('Independent browser output preparation retired.');
    session = preview.createSession(ownerId); if (!await session.enable()) throw new Error('The direct browser source session could not be enabled.');
    sourceContext = preview.getAudioContext(); source = await session.prepareDirectOwnedSineSource({ signal, onFailure: fail }); signal?.throwIfAborted();
    if (disposed) throw new Error('The independent audio source retired during preparation.');
    worker = new Worker(new URL('./ProcgenOwnedAudioOutputWorker.js', import.meta.url), { type: 'module', name: ownerId });
    worker.addEventListener('message', receive); worker.addEventListener('error', event => { event.preventDefault?.(); fail(new Error('The independent audio worker failed.')); }); worker.addEventListener('messageerror', () => fail(new Error('The independent audio worker message could not decode.')));
    const port = source.transferPort(), ready = await request('initialize', { executionIdentity: execution, port, sampleRate: source.sampleRate, performance }, [port]);
    if (!compareActiveExecutionIdentity(ready.executionIdentity).matched) throw new Error('The direct audio worker executes another application generation.');
    channel = new MessageChannel(); report();
    return Object.freeze({ kind: 'owned-audio', requiredPort: channel.port2, state: () => ({ terminalPause: true, output: 'independent-owned-audio-worker', failure: failure?.message || null, worker: state, source: source?.state() || null }),
      async attach(manifest) { if (attached || disposed || failure) throw failure || new Error('The direct audio source already attached or retired.');
        await request('attach', { port: channel.port1, options: { manifest, initialHeldVoices: 0 } }, [channel.port1]); signal?.throwIfAborted(); source.activate(); attached = true; report(); },
      dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
