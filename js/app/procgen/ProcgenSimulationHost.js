import { normalizeProcgenViewport } from './ProcgenPausedProjection.js';
import { procgenSimulationProfile } from './ProcgenSimulationProfiles.js';
import { freezeData } from '../../core/CanonicalData.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { encodeBackgroundSnapshotPages, backgroundSnapshotTransfers, createBackgroundSnapshotReceiver } from '../resources/BackgroundSnapshotPages.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';
import { attachProcgenSimulationConsumer } from './ProcgenSimulationConsumer.js';
import { prepareProcgenSimulationRealm } from './ProcgenSimulationRealm.js';
import { SIMULATION_MAX_CONSUMERS, simulationEnvelope, isSimulationEnvelope, simulationFailure, validateSimulationManifest } from './ProcgenSimulationProtocol.js';
export { prepareProcgenNativeOutputRealm } from './ProcgenNativeOutputRealm.js';
export { attachProcgenSimulationOutput, attachProcgenNativeSimulationOutput } from './ProcgenSimulationOutputConsumer.js';

let activeHosts = 0;
export const prepareInProcessProcgenSimulationHost = options => prepareProcgenSimulationRealm(options);
export async function prepareWorkerProcgenSimulationHost({ manifest: input, resourceBudget, Worker = globalThis.Worker, MessageChannel = globalThis.MessageChannel,
  requiredPorts = [], consume = null, onState = () => {}, onViewport = () => {}, signal, timers = globalThis } = {}) {
  validateSimulationManifest(input); signal?.throwIfAborted();
  const execution = getActiveExecutionIdentity();
  if (execution.activeExecution !== 'bound' || typeof Worker !== 'function' || typeof MessageChannel !== 'function' || !resourceBudget ||
      !Array.isArray(requiredPorts) || new Set(requiredPorts).size !== requiredPorts.length || requiredPorts.length + (consume ? 1 : 0) > SIMULATION_MAX_CONSUMERS ||
      !requiredPorts.length && typeof consume !== 'function' || activeHosts >= 2)
    throw simulationFailure('worker-admission', 'This explicit worker mode requires an immutable build, an aggregate reservation and one to four required consumers.');
  const profile = procgenSimulationProfile(input.resourceProfile);
  const manifest = { ownerId: input.ownerId, ownerEpoch: input.ownerEpoch, documentRevision: input.documentRevision },
    reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'simulation-worker:' + manifest.ownerId,
      generation: manifest.ownerEpoch, kind: 'worker-world-semantic-state-and-transfer-overlap', category: 'candidate', bytes: profile.aggregateBytes });
  activeHosts++;
  const scope = createProcgenRetirementScope({ deadlineMs: 15000 }), requests = new Map(), projections = new Set(), controller = new AbortController();
  let worker = null, consumer = null, retired = false, confirmed = false, disposed = false, failure = null, latestState = null, requestSerial = 0,
    inputAck = null, checkpointReceiver = null, checkpointRequestId = null, checkpointTransfer = null, inputProducer = null, terminateError = null, portsTransferred = false, readyResolve, readyReject, retiredResolve, liveViewport = null, viewportSerial = 0, viewportFailure = null;
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
      const timer = timers.setTimeout(() => { requests.delete(requestId); const error = simulationFailure('request-timeout', 'The authoritative request did not complete; the generation must be reviewed paused.'); reject(error); fail(error); }, ['checkpoint', 'checkpoint-detach', 'checkpoint-recovery'].includes(type) ? 180000 : 30000);
      requests.set(requestId, { resolve, reject, timer, kind: type }); try { send(type, { ...fields, requestId }); } catch (error) { timers.clearTimeout(timer); requests.delete(requestId); reject(error); fail(error); }
    });
  };
  const project = async (viewport = {}) => {
    check();
    if (!latestState?.paused || projections.size >= 2 || !viewport || Object.getPrototypeOf(viewport) !== Object.prototype || Object.keys(viewport).some(key => !['x', 'firstLane', 'laneCount', 'width', 'pixelWidth', 'pixelHeight'].includes(key)) || Object.values(viewport).some(value => !Number.isSafeInteger(value) || value < 0)) throw simulationFailure('projection-admission', 'Request one bounded viewport of a paused authoritative host, with at most two retained readers.');
    if (viewport.firstLane != null && viewport.firstLane >= latestState.laneCount || viewport.laneCount != null && (viewport.laneCount < 1 || viewport.laneCount > 4) || viewport.width != null && (viewport.width < 64 || viewport.width > 8192) || viewport.pixelWidth != null && (viewport.pixelWidth < 64 || viewport.pixelWidth > 1024) || viewport.pixelHeight != null && (viewport.pixelHeight < 64 || viewport.pixelHeight > 512) || (viewport.pixelWidth ?? 512) * (viewport.pixelHeight ?? 256) > 262144) throw simulationFailure('projection-capacity', 'Choose an existing lane and a bounded collision viewport.');
    const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'simulation-projection:' + manifest.ownerId, kind: 'immutable-worker-viewport-reader', category: 'checkpoint', bytes: 4 * 1048576 });
    let value = null, released = false;
    const projection = Object.freeze({ read: () => { if (released) throw simulationFailure('projection-retired', 'The immutable viewport reader retired.'); return value; }, release() { if (released) return false; storage.release(); released = true; value = null; projections.delete(projection); return true; } });
    projections.add(projection);
    try { value = await request('project', { viewport }); check(); if (released) throw simulationFailure('projection-retired', 'The viewport owner retired during preparation.'); return projection; }
    catch (error) { projection.release(); throw error; }
  };
  const returnViewportFrame = message => { const cells = message.value?.cells; if (cells instanceof Uint8Array && cells.buffer instanceof ArrayBuffer && cells.byteLength) try { send('viewport-ack', { watchId: message.watchId, sequence: message.sequence, cells }, [cells.buffer]); } catch {} };
  const watchViewport = async (viewport = {}) => {
    check(); if (liveViewport || !latestState || !Number.isSafeInteger(viewportSerial + 1)) throw simulationFailure('viewport-owner', 'Keep one admitted live viewport owner.');
    viewportFailure = null; const selected = normalizeProcgenViewport(viewport, latestState.laneCount, true), storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'live-viewport:' + manifest.ownerId, kind: 'exclusive-worker-frame-receiver', category: 'checkpoint', bytes: 4 * 1048576 });
    const entry = liveViewport = { id: ++viewportSerial, storage, viewport: selected, frame: null, sequence: 0, phase: 'preparing', failure: null, maximumCaptureMs: 0 };
    try { const receipt = await request('watch-viewport', { watchId: entry.id, viewport: selected }); check(); if (receipt?.status === 'refused') { entry.storage.release(); liveViewport = null; throw simulationFailure('viewport-refused', receipt.reason); } entry.phase = 'watching'; return receipt; }
    catch (error) { entry.failure = viewportFailure = error.message; if (!disposed && !failure && liveViewport === entry) { entry.storage.release(); liveViewport = null; } throw error; }
  };
  const stopViewport = async () => {
    const entry = liveViewport; if (!entry) return false; entry.phase = 'stopping'; entry.frame?.release();
    await request('stop-viewport'); if (liveViewport === entry) { entry.storage.release(); liveViewport = null; } return true;
  };
  const consumeViewport = message => {
    const entry = liveViewport;
    if (!entry || disposed || message.watchId !== entry.id || ['stopping', 'unavailable'].includes(entry.phase)) { returnViewportFrame(message); return; }
    try {
      const value = message.value, view = value?.viewport;
      if (entry.frame || message.sequence !== entry.sequence + 1 || !['lemmings-paused-world-projection/v1', 'lemmings-completed-world-projection/v1'].includes(value?.schema) || !Number.isSafeInteger(value.tick) || value.tick < 0 || !Number.isSafeInteger(value.generation) || value.generation < 0 || value.worldId !== latestState?.worldId || typeof value.paused !== 'boolean' || !(value.cells instanceof Uint8Array) || value.cells.byteOffset || value.cells.byteLength !== value.cells.buffer.byteLength || value.cells.length !== entry.viewport.pixelWidth * entry.viewport.pixelHeight || view?.pixelWidth !== entry.viewport.pixelWidth || view?.pixelHeight !== entry.viewport.pixelHeight || !Array.isArray(value.actors) || value.actors.length > 4096) throw simulationFailure('viewport-invalid', 'The optional visual frame differs from its owned source, sequence or inventory.');
      freezeData(value.actors); freezeData(view); Object.freeze(value); entry.sequence = message.sequence; entry.maximumCaptureMs = message.maximumCaptureMs;
      let released = false; const reader = Object.freeze({ read() { if (released) throw simulationFailure('viewport-retired', 'The completed visual frame reader retired.'); return value; },
        release() { if (released) return false; released = true; if (entry.frame === reader) entry.frame = null; returnViewportFrame(message); return true; } }); entry.frame = reader;
      try { onViewport(); } catch {}
    } catch (error) { entry.failure = viewportFailure = error.message; entry.phase = 'unavailable'; returnViewportFrame(message); Promise.resolve().then(stopViewport).catch(() => {}); try { onViewport(); } catch {} }
  };
  const receive = event => {
    const message = event.data;
    if (retired || !isSimulationEnvelope(message, manifest)) return;
    try {
      if (message.type === 'retired') { confirmed = message.outcome === 'complete'; retiredResolve(message); return; }
      if (message.type === 'viewport-frame') { consumeViewport(message); return; }
      if (message.type === 'viewport-unavailable') { if (liveViewport?.id === message.watchId) { liveViewport.failure = viewportFailure = message.reason; liveViewport.phase = 'unavailable'; Promise.resolve().then(stopViewport).catch(() => {}); try { onViewport(); } catch {} } return; }
      if (disposed) return;
      if (message.type === 'failed') { fail(simulationFailure(message.error?.code || 'worker-failed', message.error?.message || 'The authoritative worker paused after failure.')); return; }
      if (message.type === 'input-ack') { if (!inputAck || inputAck.sequence !== message.sequence) throw simulationFailure('input-ack-invalid', 'A worker initialization acknowledgment is out of order.'); const pending = inputAck; inputAck = null; pending.resolve(); return; }
      if (message.type === 'state') { publish(message.state); if (Number.isSafeInteger(message.sequence) && message.sequence > 0) send('state-ack', { sequence: message.sequence }); return; }
      if (message.type === 'suspended') { publish(Object.freeze({ ...latestState, paused: true, phase: 'suspended-paused', reason: message.reason })); return; }
      if (message.type === 'ready') {
        if (!compareActiveExecutionIdentity(message.executionIdentity).matched) throw simulationFailure('worker-build-mismatch', 'The simulation worker executes a different application generation.');
        publish(message.state); readyResolve(message); return;
      }
      const pending = requests.get(message.requestId);
      if (!pending) throw simulationFailure('response-stale', 'The worker response no longer has a current request owner.');
      if (message.type === 'projection') {
        const value = message.value, view = value?.viewport;
        if (pending.kind !== 'project' || value?.schema !== 'lemmings-paused-world-projection/v1' || !(value.cells instanceof Uint8Array) || value.cells.byteOffset || value.cells.byteLength !== value.cells.buffer.byteLength ||
            !Number.isSafeInteger(view?.pixelWidth) || !Number.isSafeInteger(view?.pixelHeight) || view.pixelWidth < 64 || view.pixelWidth > 1024 || view.pixelHeight < 64 || view.pixelHeight > 512 || value.cells.length !== view.pixelWidth * view.pixelHeight || value.cells.length > 262144 || !Array.isArray(value.actors) || value.actors.length > 4096 ||
            value.worldId !== latestState?.worldId || value.generation !== latestState.generation || value.tick !== latestState.tick || value.paused !== true || !latestState.paused) throw simulationFailure('projection-invalid', 'The immutable viewport differs from its paused authoritative completed boundary.');
        freezeData(value.actors); freezeData(value.viewport); Object.freeze(value);
        requests.delete(message.requestId); timers.clearTimeout(pending.timer); pending.resolve(value); return;
      }
      if (message.type === 'response') { requests.delete(message.requestId); timers.clearTimeout(pending.timer); if (message.value?.phase) publish(message.value); else if (message.value?.state) publish(message.value.state); pending.resolve(message.value); return; }
      if (message.type === 'checkpoint-start') {
        if (checkpointReceiver || message.sequence !== 0) throw simulationFailure('checkpoint-overlap', 'Only one checkpoint receiver may own its streamed pages.');
        checkpointRequestId = message.requestId; checkpointReceiver = createBackgroundSnapshotReceiver({ maxBytes: pending.kind === 'checkpoint-recovery' ? 8 * 1048576 : pending.kind === 'checkpoint-detach' ? 16 * 1048576 : profile.checkpointBytes, maxNodes: pending.kind === 'checkpoint-recovery' ? 262144 : 4000000, estimatedPeakBytes: pending.kind === 'checkpoint-recovery' ? 64 * 1048576 : profile.checkpointPeakBytes });
        send('checkpoint-ack', { sequence: 0 }); return;
      }
      if (!checkpointReceiver || checkpointRequestId !== message.requestId) throw simulationFailure('checkpoint-stale', 'The checkpoint stream has no admitted request owner.');
      if (message.type === 'checkpoint-page') { const receipt = checkpointReceiver.push(message.packet); send('checkpoint-ack', { sequence: receipt.sequence }); return; }
      if (message.type !== 'checkpoint-end') throw simulationFailure('response-invalid', 'Unsupported authoritative worker response.');
      const retainedBytes = checkpointReceiver.diagnostics().retainedEstimateBytes + 1048576, value = checkpointReceiver.finish(message.sequence); checkpointReceiver = null; checkpointRequestId = null;
      requests.delete(message.requestId); timers.clearTimeout(pending.timer); pending.resolve(['checkpoint-detach', 'checkpoint-recovery'].includes(pending.kind) ? { value, retainedBytes } : value);
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
      { name: 'worker-listeners', run: async () => { await Promise.allSettled([producerRetirement]); signal?.removeEventListener('abort', abort); worker?.removeEventListener('message', receive); if (liveViewport) { liveViewport.frame?.release(); liveViewport.storage.release(); liveViewport = null; } checkpointReceiver?.dispose(); checkpointReceiver = null; } },
      { name: 'retained-projections', run: () => { for (const projection of [...projections]) projection.release(); } },
      { name: 'worker-budget', run: async () => {
        await Promise.all([producerRetirement, consumerRetirement]);
        if (!terminationConfirmed) throw terminateError || simulationFailure('retirement-unknown', 'The worker may still own its authoritative world.');
        if (portsTransferred && requiredPorts.length && !confirmed) throw simulationFailure('consumer-retirement-unknown', 'Direct consumer ownership was not acknowledged; the aggregate reservation remains charged.');
        retired = true; worker = null; latestState = null; if (!checkpointTransfer) reservation.release(); activeHosts--;
      } }
    ]);
  };
  const captureRecoveryCheckpoint = async () => {
    check(); if (!latestState?.paused || requests.size || checkpointTransfer) throw simulationFailure('recovery-checkpoint-boundary', 'Capture a recovery point from an idle completed paused worker boundary.');
    const source = { ...latestState }, storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'simulation-recovery:' + manifest.ownerId, kind: 'independent-physical-recovery-checkpoint', category: 'checkpoint', bytes: 64 * 1048576 });
    let value = null;
    try {
      const result = await request('checkpoint-recovery'); check(); if (result?.status === 'refused') throw simulationFailure('recovery-checkpoint-refused', result.message || 'The current world exceeds its bounded recovery profile.');
      value = result?.value; const receipt = value?.receipt;
      if (value?.schema !== 'lemmings-owned-simulation-checkpoint/v1' || receipt?.schema !== 'lemmings-simulation-checkpoint-receipt/v1' || receipt.applicationBuildId !== execution.buildId || receipt.ownerId !== manifest.ownerId || receipt.ownerEpoch !== manifest.ownerEpoch || receipt.documentRevision !== manifest.documentRevision || receipt.worldId !== source.worldId || receipt.generation !== source.generation || receipt.tick !== source.tick || receipt.paused !== true || !['sourceHash', 'continuationHash', 'physicsHash'].every(key => /^[a-f0-9]{64}$/.test(receipt[key] || '')) || !Number.isSafeInteger(result.retainedBytes) || result.retainedBytes < 4096 || result.retainedBytes > 32 * 1048576 || value.snapshot?.authoring?.graph == null || value.snapshot.engine?.version !== 1) throw simulationFailure('recovery-checkpoint-invalid', 'The recovery point differs from its exact completed worker source or bounded retained representation.');
      storage.resize(result.retainedBytes); freezeData(receipt); let released = false;
      return Object.freeze({ schema: 'lemmings-owned-simulation-checkpoint/v1', receipt: () => released ? null : value.receipt,
        read() { if (released) throw simulationFailure('checkpoint-retired', 'The independently owned recovery point retired.'); return value.snapshot; },
        release() { if (released) return false; storage.release(); released = true; value = null; return true; } });
    } catch (error) { value = null; storage.release(); throw error; }
  };
  const detachCheckpoint = async () => {
    check();
    if (!latestState?.paused || requests.size || checkpointTransfer) throw simulationFailure('checkpoint-handoff-boundary', 'Detach one checkpoint from an idle paused authoritative host.');
    const source = { ...latestState }, result = await request('checkpoint-detach'); check();
    const value = result.value, receipt = value?.receipt;
    if (value?.schema !== 'lemmings-owned-simulation-checkpoint/v1' || receipt?.schema !== 'lemmings-simulation-checkpoint-receipt/v1' || receipt.applicationBuildId !== execution.buildId || receipt.ownerId !== manifest.ownerId || receipt.ownerEpoch !== manifest.ownerEpoch ||
        receipt.documentRevision !== manifest.documentRevision || receipt.worldId !== source.worldId || receipt.generation !== source.generation || receipt.tick !== source.tick || receipt.paused !== true || !['sourceHash', 'continuationHash', 'physicsHash'].every(key => /^[a-f0-9]{64}$/.test(receipt[key] || '')) ||
        !Number.isSafeInteger(result.retainedBytes) || result.retainedBytes < 4096 || result.retainedBytes > 128 * 1048576 || value.snapshot?.authoring?.graph == null || value.snapshot.engine?.version !== 1) throw simulationFailure('checkpoint-handoff-invalid', 'The checkpoint differs from its exact paused worker, build or retained representation.');
    freezeData(value.receipt); checkpointTransfer = { value, released: false, published: false };
    const retirement = dispose(); await retirement.completion;
    if (retirement.outcome !== 'complete') throw Object.assign(simulationFailure('checkpoint-producer-retirement', 'The checkpoint remains charged to its unresolved worker producer.'), { retirement });
    reservation.resize(result.retainedBytes); checkpointTransfer.published = true;
    return Object.freeze({ schema: 'lemmings-owned-simulation-checkpoint/v1', receipt: () => checkpointTransfer.released ? null : checkpointTransfer.value.receipt,
      read() { if (checkpointTransfer.released || !checkpointTransfer.published) throw simulationFailure('checkpoint-retired', 'This checkpoint no longer has an active independent owner.'); return checkpointTransfer.value.snapshot; },
      release() { if (checkpointTransfer.released) return false; checkpointTransfer.value = null; reservation.release(); checkpointTransfer.released = true; return true; } });
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
      await transmitInput('initialize', 0, { requiredIdentity: execution, resourceProfile: profile.id, ports }, ports);
      let sequence = 0;
      for await (const packet of encodeBackgroundSnapshotPages(input, { maxBytes: profile.maxInputBytes, maxNodes: profile.maxInputNodes, estimatedPeakBytes: profile.inputPeakBytes,
        signal: controller.signal, isCurrent: () => !disposed && !failure })) { sequence = packet.sequence; await transmitInput('input-page', sequence, { packet }, backgroundSnapshotTransfers(packet)); }
      check(); input = null; send('input-end', { sequence });
    })(); await inputProducer; await timeout(ready, 180000, 'The authoritative world did not finish preparation.'); check();
    return Object.freeze({ mode: 'worker', identity: Object.freeze({ ...manifest }), state: () => latestState, pause: () => request('pause'), resume: () => request('resume'),
      watchViewport, stopViewport, liveProjection: () => liveViewport?.frame || null, releaseLiveProjection: () => liveViewport?.frame?.release() || false, viewportState: () => liveViewport ? { active: liveViewport.phase === 'watching', phase: liveViewport.phase, failure: liveViewport.failure, sequence: liveViewport.sequence, frameHeld: !!liveViewport.frame, maximumCaptureMs: liveViewport.maximumCaptureMs } : { active: false, phase: 'off', failure: viewportFailure },
      project, detachCheckpoint, captureRecoveryCheckpoint, advance: steps => request('advance', { steps }), submit: command => request('command', { command }), checkpoint: () => request('checkpoint'),
      diagnostics: () => Object.freeze({ state: latestState, activeHosts, requiredConsumers: requiredPorts.length + (consume ? 1 : 0), mainConsumer: consumer?.state() || null, retainedProjections: projections.size, liveViewport: liveViewport ? { phase: liveViewport.phase, sequence: liveViewport.sequence, failure: liveViewport.failure } : null, checkpointHandoff: checkpointTransfer ? checkpointTransfer.released ? 'released' : checkpointTransfer.published ? 'independently-owned' : 'waiting-for-producer-retirement' : null,
        buildId: execution.buildId, resourceProfile: profile, defaultEnabled: false, performanceQualification: 'required-before-default', reservation: reservation.receipt() }), dispose });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
