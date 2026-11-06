import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { encodeBackgroundSnapshotPages, backgroundSnapshotTransfers } from '../resources/BackgroundSnapshotPages.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { validateBufferedWarpPlan } from '../../midi/content/BufferedWarpPlan.js';

const modules = new WeakMap(); let nextOwner = 0, active = 0;
const protocol = 'lemmings-buffered-warp-worker/v1';
const fail = message => Object.assign(new Error('WarpVoice owner: ' + message), { code: 'buffered-warp-owner-unavailable' });
export async function prepareBufferedWarpVoiceOwner({ context, destination, material, resourceBudget, contextEpoch, signal, isCurrent = () => true,
  onState = () => {}, Worker = globalThis.Worker, AudioWorkletNode = globalThis.AudioWorkletNode, MessageChannel = globalThis.MessageChannel } = {}) {
  const execution = getActiveExecutionIdentity('browser-background-jobs'), plan = validateBufferedWarpPlan(material?.plan);
  if (execution.activeExecution !== 'bound' || context?.state !== 'running' || context.sampleRate !== plan.outputRate || !context.audioWorklet || !destination ||
      !resourceBudget || !Number.isSafeInteger(contextEpoch) || contextEpoch < 0 || typeof Worker !== 'function' || typeof AudioWorkletNode !== 'function' || typeof MessageChannel !== 'function' || active >= 2)
    throw fail('Use explicitly enabled owned audio, its exact context epoch, approved destination and immutable application generation.');
  signal?.throwIfAborted(); if (!isCurrent()) throw fail('The requesting sound owner changed.');
  const identity = { ownerId: 'buffered-warp-' + (++nextOwner), ownerEpoch: contextEpoch + 1 }, scope = createProcgenRetirementScope({ deadlineMs: 15000 }),
    reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: identity.ownerId, generation: contextEpoch, category: 'candidate', kind: 'warp-processing-worker-and-owned-pcm-node', bytes: 256 * 1048576 }),
    controller = new AbortController(), pending = new Map(); active++;
  let worker = null, node = null, producer = null, moduleWork = null, inputAck = null, disposed = false, fault = null, serial = 0, metadata = null, fence = null, bound = false, ended = false,
    readyResolve, readyReject, workerRetiredResolve, nodeRetiredResolve, nodeRetired = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); ready.catch(() => {});
  const workerRetirement = new Promise(resolve => { workerRetiredResolve = resolve; }), nodeRetirement = new Promise(resolve => { nodeRetiredResolve = resolve; });
  const envelope = (type, fields = {}) => ({ protocol, ...identity, type, ...fields });
  const changed = () => { controller.signal.throwIfAborted(); if (disposed || fault || !isCurrent() || context.state !== 'running') throw fault || fail('The audio source, route or clock changed.'); };
  const state = () => Object.freeze({ disposed, bound, ended, fault: fault?.message || null, prepared: !!metadata, configuration: metadata?.configuration || null,
    ownerId: identity.ownerId, contextEpoch, pendingRequests: pending.size, activeOwners: active,
    timing: 'fixed-physical-onset;positive-declared-preparation-and-processing-lead;no-device-latency-inference', qualification: 'streaming-buffered-source-adapter;device-and-quality-evidence-pending' });
  const report = () => { try { onState(state()); } catch {} };
  const wait = (value, ms, message) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(fail(message)), ms); Promise.resolve(value).then(resolve, reject).finally(() => clearTimeout(timer)); });
  const failed = error => { fault ||= error; controller.abort(error); readyReject(error); inputAck?.reject(error); inputAck = null;
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(error); } pending.clear(); report(); if (!disposed) dispose(); };
  const send = (type, fields = {}, transfers = []) => worker.postMessage(envelope(type, fields), transfers);
  const request = (type, fields = {}) => {
    changed(); if (pending.size >= 16) throw fail('The bounded warp command queue is full.'); const requestId = ++serial;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); const error = fail('The streaming source command expired.'); reject(error); failed(error); }, 10000);
      pending.set(requestId, { resolve, reject, timer }); try { send(type, { ...fields, requestId }); } catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); failed(error); } });
  };
  const transmit = (type, sequence, fields = {}, transfers = []) => wait(new Promise((resolve, reject) => {
    changed(); if (inputAck) throw fail('The previous source page remains leased.'); inputAck = { sequence, resolve, reject }; send(type, { sequence, ...fields }, transfers);
  }), 30000, 'The warp source page was not acknowledged.');
  const receive = event => {
    const message = event.data; if (message?.protocol !== protocol || message.ownerId !== identity.ownerId || message.ownerEpoch !== identity.ownerEpoch) return;
    if (message.type === 'retired') { workerRetiredResolve(message); return; } if (disposed) return;
    try {
      if (message.type === 'input-ack') { if (!inputAck || inputAck.sequence !== message.sequence) throw fail('A preparation acknowledgment is stale.'); const row = inputAck; inputAck = null; row.resolve(); }
      else if (message.type === 'material-ready') { if (!compareActiveExecutionIdentity(message.executionIdentity, 'browser-background-jobs').matched || message.configurationHash !== plan.algorithm.configurationHash) throw fail('The prepared processing core differs from its pinned plan or application.'); metadata = message; readyResolve(message); report(); }
      else if (message.type === 'response') { const row = pending.get(message.requestId); if (!row) throw fail('The warp response has no current command owner.'); pending.delete(message.requestId); clearTimeout(row.timer); row.resolve(message.value); }
      else if (message.type === 'failed') throw fail(message.message);
      else if (message.type === 'ended') { bound = false; ended = true; report(); }
    } catch (error) { failed(error); }
  };
  const aborted = () => failed(signal.reason || fail('The source owner canceled streaming warp.'));
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true; controller.abort(); clearInterval(fence); inputAck?.reject(fail('The source preparation retired.')); inputAck = null;
    for (const row of pending.values()) { clearTimeout(row.timer); row.reject(fail('The warp request retired.')); } pending.clear();
    const stopNode = (async () => {
      if (!node) { nodeRetired = true; return; } node.port.postMessage({ type: 'retire' }); await wait(nodeRetirement, 5000, 'The PCM processor did not acknowledge retirement.');
      if (!nodeRetired) throw fail('The PCM processor still owns queued output.'); node.disconnect();
    })(); stopNode.catch(() => {});
    const stopWorker = (async () => {
      await Promise.allSettled([moduleWork, producer].filter(Boolean)); if (!worker) return;
      try { send('dispose'); await wait(workerRetirement, 5000, 'The processing worker did not acknowledge retirement.'); } catch {}
      worker.terminate();
    })(); stopWorker.catch(() => {});
    return scope.retire([{ name: 'warp-pcm-processor', run: () => stopNode }, { name: 'warp-processing-worker', run: () => stopWorker },
      { name: 'warp-owner-storage', run: async () => { await Promise.all([stopNode, stopWorker]); signal?.removeEventListener('abort', aborted); worker?.removeEventListener('message', receive); node?.port.close();
        node = worker = metadata = null; reservation.release(); active--; } }]);
  };
  try {
    signal?.addEventListener('abort', aborted, { once: true });
    let module = modules.get(context); if (!module) { module = context.audioWorklet.addModule(new URL('./worklet/BufferedWarpPcmProcessor.js', import.meta.url)); modules.set(context, module); module.catch(() => { if (modules.get(context) === module) modules.delete(context); }); }
    moduleWork = module; await module; changed(); node = new AudioWorkletNode(context, 'lemmings-buffered-warp-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.onprocessorerror = () => failed(fail('The owned PCM processor failed.'));
    node.port.onmessage = event => { const message = event.data; if (message?.type === 'retired') { nodeRetired = message.outcome === 'complete' && message.queuedPcmRetained === false; nodeRetiredResolve(message); } else if (message?.type === 'failed') failed(fail(message.reason)); };
    node.connect(destination); const channel = new MessageChannel(); node.port.postMessage({ type: 'attach-source', ...identity, port: channel.port1 }, [channel.port1]);
    worker = new Worker(new URL('../resources/BufferedWarpVoiceWorker.js', import.meta.url), { type: 'module', name: identity.ownerId }); worker.addEventListener('message', receive);
    worker.onerror = event => { event.preventDefault?.(); failed(fail('The streaming processing worker crashed.')); }; worker.onmessageerror = () => failed(fail('The streaming worker response could not be decoded.'));
    producer = (async () => {
      await transmit('prepare-start', 0, { requiredIdentity: execution, port: channel.port2 }, [channel.port2]); let sequence = 0;
      const ownedTransferBuffers = new Set();
      if (material.image?.fork) {
        const image = material.image.fork({ estimatedPeakBytes: 128 * 1048576 }); material = { ...material, image };
        ownedTransferBuffers.add(image.heapBytes.buffer); ownedTransferBuffers.add(image.moduleBytes.buffer);
      }
      for await (const packet of encodeBackgroundSnapshotPages(material, { maxBytes: 64 * 1048576, maxNodes: 1000000, estimatedPeakBytes: 256 * 1048576, signal: controller.signal,
        ownedTransferBuffers, allowOwnedWasmModule: true, isCurrent: () => !disposed && !fault && isCurrent() })) { sequence = packet.sequence; await transmit('prepare-page', sequence, { packet }, backgroundSnapshotTransfers(packet)); }
      changed(); material = null; send('prepare-end', { sequence });
    })(); await producer; await wait(ready, 180000, 'The streaming source did not finish preparation.'); changed();
    fence = setInterval(() => { try { changed(); } catch (error) { failed(error); } }, 50); report();
    return Object.freeze({ state, configuration: metadata.configuration, preparationLeadFrames: plan.algorithm.requiredPreparationLeadFrames,
      async begin({ identity: sourceIdentity, onsetOutputFrame, segment, endOutputFrame }) { const value = await request('bind', { identity: sourceIdentity, onsetOutputFrame, segment, ...(endOutputFrame == null ? {} : { endOutputFrame }) }); bound = true; report(); return value; },
      schedule: (segment, sourceIdentity) => request('schedule', { segment, identity: sourceIdentity }),
      cancelFrom: (outputFrame, sourceIdentity) => request('cancel-from', { outputFrame, identity: sourceIdentity }), inspect: () => request('inspect'), dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
