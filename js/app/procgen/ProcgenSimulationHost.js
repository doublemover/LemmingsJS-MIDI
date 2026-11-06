import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { encodeBackgroundSnapshotPages, backgroundSnapshotTransfers, createBackgroundSnapshotReceiver } from '../resources/BackgroundSnapshotPages.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';
import { attachProcgenSimulationConsumer } from './ProcgenSimulationConsumer.js';
import { prepareProcgenSimulationRealm } from './ProcgenSimulationRealm.js';
import { SIMULATION_MAX_CONSUMERS, simulationEnvelope, isSimulationEnvelope, simulationFailure, validateSimulationManifest } from './ProcgenSimulationProtocol.js';
export { attachProcgenSimulationOutput, attachProcgenNativeSimulationOutput } from './ProcgenSimulationOutputConsumer.js';

let activeHosts = 0;
export const prepareInProcessProcgenSimulationHost = options => prepareProcgenSimulationRealm(options);
export async function prepareWorkerProcgenSimulationHost({ manifest: input, resourceBudget, Worker = globalThis.Worker, MessageChannel = globalThis.MessageChannel,
  requiredPorts = [], consume = null, onState = () => {}, signal, timers = globalThis } = {}) {
  validateSimulationManifest(input); signal?.throwIfAborted();
  const execution = getActiveExecutionIdentity();
  if (execution.activeExecution !== 'bound' || typeof Worker !== 'function' || typeof MessageChannel !== 'function' || !resourceBudget ||
      !Array.isArray(requiredPorts) || new Set(requiredPorts).size !== requiredPorts.length || requiredPorts.length + (consume ? 1 : 0) > SIMULATION_MAX_CONSUMERS ||
      !requiredPorts.length && typeof consume !== 'function' || activeHosts >= 2)
    throw simulationFailure('worker-admission', 'This explicit worker mode requires an immutable build, an aggregate reservation and one to four required consumers.');
  const manifest = { ownerId: input.ownerId, ownerEpoch: input.ownerEpoch, documentRevision: input.documentRevision },
    reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'simulation-worker:' + manifest.ownerId,
      generation: manifest.ownerEpoch, kind: 'worker-world-semantic-state-and-transfer-overlap', category: 'candidate', bytes: 384 * 1048576 });
  activeHosts++;
  const scope = createProcgenRetirementScope({ deadlineMs: 15000 }), requests = new Map(), controller = new AbortController();
  let worker = null, consumer = null, retired = false, confirmed = false, disposed = false, failure = null, latestState = null, requestSerial = 0,
    inputAck = null, checkpointReceiver = null, checkpointRequestId = null, inputProducer = null, terminateError = null, portsTransferred = false, readyResolve, readyReject, retiredResolve;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); ready.catch(() => {});
  const retirementAck = new Promise(resolve => { retiredResolve = resolve; });
  const check = () => { controller.signal.throwIfAborted(); if (disposed || failure) throw failure || simulationFailure('worker-retired', 'The simulation owner retired.'); };
  const publish = state => { latestState = state; try { onState(state); } catch {} };
  const fail = error => {
    failure ||= error; controller.abort(error); readyReject(error); inputAck?.reject(error); inputAck = null;
    for (const pending of requests.values()) { timers.clearTimeout(pending.timer); pending.reject(error); } requests.clear();
    checkpointReceiver?.dispose(); checkpointReceiver = null; checkpointRequestId = null;
    publish(Object.freeze({ ...latestState, phase: 'failed-paused', paused: true, failure: { code: error.code || 'worker-failed', message: error.message },
      recovery: 'prepare-a-fresh-paused-generation-from-a-verified-checkpoint;explicit-output-resume-required' }));
  };
  const send = (type, fields = {}, transfers = []) => worker.postMessage(simulationEnvelope(manifest, type, fields), transfers);
  const timeout = (work, ms, message) => new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(simulationFailure('worker-timeout', message)), ms);
    Promise.resolve(work).then(resolve, reject).finally(() => timers.clearTimeout(timer));
  });
  const transmitInput = (type, sequence, fields = {}, transfers = []) => {
    check(); if (inputAck) throw simulationFailure('input-backpressure', 'The initialization packet is still owned by its receiver.');
    return timeout(new Promise((resolve, reject) => { inputAck = { sequence, resolve, reject }; send(type, { sequence, ...fields }, transfers); if (type === 'initialize') portsTransferred = true; }), 30000, 'The worker did not acknowledge its bounded initialization packet.');
  };
  const request = (type, fields = {}) => {
    check(); if (requests.size >= 8 || requestSerial >= Number.MAX_SAFE_INTEGER - 1) return Promise.reject(simulationFailure('request-capacity', 'The authoritative host request queue is full.'));
    const requestId = ++requestSerial;
    return new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => { requests.delete(requestId); const error = simulationFailure('request-timeout', 'The authoritative request did not complete; the generation must be reviewed paused.'); reject(error); fail(error); }, type === 'checkpoint' ? 180000 : 30000);
      requests.set(requestId, { resolve, reject, timer }); try { send(type, { ...fields, requestId }); } catch (error) { timers.clearTimeout(timer); requests.delete(requestId); reject(error); fail(error); }
    });
  };
  const receive = event => {
    const message = event.data;
    if (retired || !isSimulationEnvelope(message, manifest)) return;
    try {
      if (message.type === 'retired') { confirmed = message.outcome === 'complete'; retiredResolve(message); return; }
      if (disposed) return;
      if (message.type === 'failed') { fail(simulationFailure(message.error?.code || 'worker-failed', message.error?.message || 'The authoritative worker paused after failure.')); return; }
      if (message.type === 'input-ack') { if (!inputAck || inputAck.sequence !== message.sequence) throw simulationFailure('input-ack-invalid', 'A worker initialization acknowledgment is out of order.'); const pending = inputAck; inputAck = null; pending.resolve(); return; }
      if (message.type === 'state') { publish(message.state); return; }
      if (message.type === 'suspended') { publish(Object.freeze({ ...latestState, paused: true, phase: 'suspended-paused', reason: message.reason })); return; }
      if (message.type === 'ready') {
        if (!compareActiveExecutionIdentity(message.executionIdentity).matched) throw simulationFailure('worker-build-mismatch', 'The simulation worker executes a different application generation.');
        publish(message.state); readyResolve(message); return;
      }
      const pending = requests.get(message.requestId);
      if (!pending) throw simulationFailure('response-stale', 'The worker response no longer has a current request owner.');
      if (message.type === 'response') { requests.delete(message.requestId); timers.clearTimeout(pending.timer); if (message.value?.phase) publish(message.value); else if (message.value?.state) publish(message.value.state); pending.resolve(message.value); return; }
      if (message.type === 'checkpoint-start') {
        if (checkpointReceiver || message.sequence !== 0) throw simulationFailure('checkpoint-overlap', 'Only one checkpoint receiver may own its streamed pages.');
        checkpointRequestId = message.requestId; checkpointReceiver = createBackgroundSnapshotReceiver({ maxBytes: 128 * 1048576, maxNodes: 4000000, estimatedPeakBytes: 384 * 1048576 });
        send('checkpoint-ack', { sequence: 0 }); return;
      }
      if (!checkpointReceiver || checkpointRequestId !== message.requestId) throw simulationFailure('checkpoint-stale', 'The checkpoint stream has no admitted request owner.');
      if (message.type === 'checkpoint-page') { const receipt = checkpointReceiver.push(message.packet); send('checkpoint-ack', { sequence: receipt.sequence }); return; }
      if (message.type !== 'checkpoint-end') throw simulationFailure('response-invalid', 'Unsupported authoritative worker response.');
      const value = checkpointReceiver.finish(message.sequence); checkpointReceiver = null; checkpointRequestId = null;
      requests.delete(message.requestId); timers.clearTimeout(pending.timer); pending.resolve(value);
    } catch (error) { fail(error); }
  };
  const abort = () => { if (!disposed) fail(signal.reason || simulationFailure('worker-canceled', 'The authoritative simulation preparation was canceled.')); };
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true; controller.abort(); inputAck?.reject(simulationFailure('input-retired', 'The initialization owner retired.')); inputAck = null;
    for (const pending of requests.values()) { timers.clearTimeout(pending.timer); pending.reject(simulationFailure('request-retired', 'The simulation request owner retired.')); } requests.clear();
    let terminationConfirmed = false;
    const producerRetirement = (async () => {
      if (inputProducer) await Promise.allSettled([inputProducer]);
      if (worker) {
        try { send('dispose'); await timeout(retirementAck, 10000, 'The worker retirement acknowledgment expired.'); } catch {}
        try { worker.terminate(); terminationConfirmed = true; } catch (error) { terminateError = error; throw error; }
      } else terminationConfirmed = true;
    })(); producerRetirement.catch(() => {});
    const consumerRetirement = Promise.resolve().then(() => consumer?.dispose()); consumerRetirement.catch(() => {});
    return scope.retire([
      { name: 'worker-producer', run: () => producerRetirement },
      { name: 'required-main-consumer', run: () => consumerRetirement },
      { name: 'worker-listeners', run: async () => { await Promise.allSettled([producerRetirement]); signal?.removeEventListener('abort', abort); worker?.removeEventListener('message', receive); checkpointReceiver?.dispose(); checkpointReceiver = null; } },
      { name: 'worker-budget', run: async () => {
        await Promise.all([producerRetirement, consumerRetirement]);
        if (!terminationConfirmed) throw terminateError || simulationFailure('retirement-unknown', 'The worker may still own its authoritative world.');
        if (portsTransferred && requiredPorts.length && !confirmed) throw simulationFailure('consumer-retirement-unknown', 'Direct consumer ownership was not acknowledged; the aggregate reservation remains charged.');
        retired = true; worker = null; latestState = null; reservation.release(); activeHosts--;
      } }
    ]);
  };
  try {
    worker = new Worker(new URL('./ProcgenSimulationWorker.js', import.meta.url), { type: 'module', name: 'authoritative-procgen-' + manifest.ownerEpoch });
    worker.addEventListener('message', receive); worker.addEventListener('error', event => { event.preventDefault?.(); fail(simulationFailure('worker-crash', 'The authoritative simulation worker crashed; its generation is abandoned.')); });
    worker.addEventListener('messageerror', () => fail(simulationFailure('worker-message', 'The authoritative worker response could not be decoded.')));
    const ports = [...requiredPorts];
    if (consume) { const channel = new MessageChannel(); consumer = attachProcgenSimulationConsumer({ port: channel.port1, manifest, consume,
      resourceBudget, onFailure: fail }); ports.push(channel.port2); }
    signal?.addEventListener('abort', abort, { once: true });
    inputProducer = (async () => {
      await transmitInput('initialize', 0, { requiredIdentity: execution, ports }, ports);
      let sequence = 0;
      for await (const packet of encodeBackgroundSnapshotPages(input, { maxBytes: 128 * 1048576, maxNodes: 4000000, estimatedPeakBytes: 384 * 1048576,
        signal: controller.signal, isCurrent: () => !disposed && !failure })) { sequence = packet.sequence; await transmitInput('input-page', sequence, { packet }, backgroundSnapshotTransfers(packet)); }
      check(); input = null; send('input-end', { sequence });
    })(); await inputProducer; await timeout(ready, 180000, 'The authoritative world did not finish preparation.'); check();
    return Object.freeze({ mode: 'worker', identity: Object.freeze({ ...manifest }), state: () => latestState, pause: () => request('pause'), resume: () => request('resume'),
      advance: steps => request('advance', { steps }), submit: command => request('command', { command }), checkpoint: () => request('checkpoint'),
      diagnostics: () => Object.freeze({ state: latestState, activeHosts, requiredConsumers: requiredPorts.length + (consume ? 1 : 0), mainConsumer: consumer?.state() || null,
        buildId: execution.buildId, defaultEnabled: false, performanceQualification: 'required-before-default', reservation: reservation.receipt() }), dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
