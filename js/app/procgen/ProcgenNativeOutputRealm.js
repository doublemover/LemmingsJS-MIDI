import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { cloneData, freezeData } from '../../core/CanonicalData.js';
const PROTOCOL = 'lemmings-native-simulation-output/v1';
let sequence = 0;
export async function prepareProcgenNativeOutputRealm({ resourceBudget, Worker = globalThis.Worker, onState = () => {}, timers = globalThis, signal } = {}) {
  const execution = getActiveExecutionIdentity(); signal?.throwIfAborted();
  if (execution.activeExecution !== 'bound' || typeof Worker !== 'function' || !resourceBudget || typeof onState !== 'function') throw new Error('An independent native output requires the exact immutable application, dedicated worker and aggregate resource owner.');
  const ownerId = 'native-simulation-consumer:' + (++sequence), storage = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'independent-native-client-routes-and-causal-consumer', category: 'checkpoint', bytes: 96 * 1048576 }), scope = createProcgenRetirementScope({ deadlineMs: 20000 }), requests = new Map();
  let worker = null, serial = 0, disposed = false, confirmed = false, state = null, failure = null, resolveRetirement;
  const retired = new Promise(resolve => { resolveRetirement = resolve; });
  const report = value => { state = freezeData(cloneData(value, { maxBytes: 2 * 1048576, maxNodes: 131072 })); try { onState(state); } catch {} };
  const fail = error => { failure ||= error instanceof Error ? error : new Error(String(error)); for (const request of requests.values()) { timers.clearTimeout(request.timer); request.reject(failure); } requests.clear();
    try { onState({ phase: 'failed', failure: failure.message, path: 'independent-native-client-worker', acousticReceipt: false }); } catch {} };
  const request = (type, fields = {}, transfers = []) => {
    signal?.throwIfAborted(); if (disposed || failure || requests.size >= 1 || !Number.isSafeInteger(serial + 1)) return Promise.reject(failure || new Error('Finish the active native worker control before another.'));
    const requestId = ++serial;
    return new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => { requests.delete(requestId); const error = new Error('The native worker control timed out; review this connection before reuse.'); reject(error); fail(error); }, 30000);
      requests.set(requestId, { resolve, reject, timer }); try { worker.postMessage({ protocol: PROTOCOL, ownerId, requestId, type, ...fields }, transfers); } catch (error) { timers.clearTimeout(timer); requests.delete(requestId); reject(error); fail(error); }
    });
  };
  const receive = event => {
    const message = event.data; if (message?.protocol !== PROTOCOL || message.ownerId !== ownerId) return;
    if (message.type === 'retired') { confirmed = message.outcome === 'complete'; resolveRetirement(message); return; }
    if (message.type === 'state') { if (!disposed) try { report(message.state); if (Number.isSafeInteger(message.sequence) && message.sequence > 0) worker.postMessage({ protocol: PROTOCOL, ownerId, type: 'state-ack', sequence: message.sequence }); } catch (error) { fail(error); } return; }
    if (message.type !== 'response') { fail(new Error('Unsupported native worker response.')); return; }
    const pending = requests.get(message.requestId); if (!pending) { if (!disposed) fail(new Error('Stale native consumer worker response.')); return; }
    requests.delete(message.requestId); timers.clearTimeout(pending.timer);
    try { if (message.state) report(message.state); if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value); } catch (error) { pending.reject(error); fail(error); }
  };
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true;
    for (const pending of requests.values()) { timers.clearTimeout(pending.timer); pending.reject(new Error('The independent native output owner retired.')); } requests.clear();
    let producer;
    return scope.retire([{ name: 'native-client-worker', run: () => producer = (async () => {
      if (!worker) { confirmed = true; return; }
      try { worker.postMessage({ protocol: PROTOCOL, ownerId, type: 'dispose' }); } catch {}
      let timer; try { await Promise.race([retired, new Promise(resolve => { timer = timers.setTimeout(resolve, 15000); })]); } finally { timers.clearTimeout(timer); worker.terminate(); }
      if (!confirmed) throw new Error('Native device closure or owned execution cleanup is unconfirmed; the consumer reservation remains owned.');
    })() }, { name: 'native-consumer-listeners', run: async () => { await Promise.allSettled([producer]); worker?.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); } },
    { name: 'native-consumer-reservation', run: async () => { await producer; if (!confirmed) throw new Error('The native worker still owns unconfirmed resources.'); worker = null; state = null; storage.release(); } }]);
  };
  const abort = () => dispose();
  try {
    worker = new Worker(new URL('./ProcgenNativeOutputWorker.js', import.meta.url), { type: 'module', name: ownerId });
    worker.addEventListener('message', receive); worker.addEventListener('error', event => { event.preventDefault?.(); fail(new Error('The native output worker failed; its device ownership must retire before reuse.')); }); worker.addEventListener('messageerror', () => fail(new Error('The native output worker response could not decode.')));
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const ready = await request('initialize', { executionIdentity: execution }); if (!compareActiveExecutionIdentity(ready.executionIdentity).matched) throw new Error('The native output worker executes another application generation.');
    return Object.freeze({ state: () => state, identity: Object.freeze({ ownerId, applicationBuildId: execution.buildId }),
      connect(options) { const copied = { url: options?.url || (globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:') + '//127.0.0.1:8765/midi', pairingCode: options?.pairingCode }; return request('connect', { options: copied }).finally(() => { copied.pairingCode = null; }); },
      enumerate: () => request('enumerate'), selectBackend: api => request('select-backend', { api }),
      open: options => request('open', { options: cloneData(options, { maxBytes: 4096, maxNodes: 256 }) }), assign: options => request('assign', { options: cloneData(options, { maxBytes: 262144, maxNodes: 4096 }) }),
      attach({ port, ...options } = {}) { if (!port?.postMessage) return Promise.reject(new Error('Transfer the required direct simulation consumer port.')); return request('attach', { port, options: cloneData(options, { maxBytes: 2 * 1048576, maxNodes: 131072 }) }, [port]); }, dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
