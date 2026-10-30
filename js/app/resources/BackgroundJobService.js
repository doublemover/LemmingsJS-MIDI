import { BACKGROUND_WORKER_ONLY_JOB_KINDS } from './BackgroundJobKinds.js';
import { yieldBackgroundTask } from './BackgroundTaskYield.js';
import { encodeBackgroundSnapshotPages, createBackgroundSnapshotReceiver, backgroundSnapshotTransfers, BACKGROUND_SNAPSHOT_PACKET_BYTES } from './BackgroundSnapshotPages.js';
import { backgroundWorkerAdmission } from './BackgroundWorkerAdmission.js';
import { BACKGROUND_JOB_PROTOCOL, BACKGROUND_JOB_KINDS, runBackgroundJobKernel } from './BackgroundJobKernels.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
const aborted = signal => signal.reason || failure('cancelled', 'Background computation was canceled.');
const interruptible = (work, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(aborted(signal));
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  if (signal.aborted) abort();
});
export function createBackgroundJobService({ admission = backgroundWorkerAdmission, Worker = globalThis.Worker,
  now = () => performance.now(), yieldTask = yieldBackgroundTask } = {}) {
  const owners = new Set(); let disposed = false;
  const compute = async ({ kind, ownerId, ownerEpoch, sourceRevision, inputBytes = 0, estimatedPeakBytes, priority = 'interactive',
    prepareInput, releasePreparedInput = null, signal, budgetAdapter, isCurrent = () => true, onProgress = () => {}, maxBytes = 64 * 1048576,
    expectedInputHash = null, deadlineMs = 180000, crypto = globalThis.crypto, retainInput = false } = {}) => {
    signal?.throwIfAborted();
    if (disposed || !BACKGROUND_JOB_KINDS.includes(kind) || typeof prepareInput !== 'function' || typeof isCurrent !== 'function' || typeof onProgress !== 'function' ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1048576 || releasePreparedInput != null && typeof releasePreparedInput !== 'function') throw failure('invalid-contract', 'Invalid background computation request.');
    if (!isCurrent()) throw failure('stale-owner', 'Background job source ownership changed.');
    if (BACKGROUND_WORKER_ONLY_JOB_KINDS.includes(kind) && typeof Worker !== 'function') throw failure('worker-required', 'This offline computation requires its admitted worker.');
    if (typeof Worker !== 'function' && !['asset-hash', 'recovery-checksum'].includes(kind) && inputBytes > 128 * 1024)
      throw failure('worker-required', 'This computation needs a worker; only small bounded fallback work is supported.');
    const transportStagingBytes = typeof Worker === 'function' ? BACKGROUND_SNAPSHOT_PACKET_BYTES * 2 : 0, admissionPeakBytes = estimatedPeakBytes + transportStagingBytes;
    if (!Number.isSafeInteger(admissionPeakBytes) || admissionPeakBytes > 512 * 1048576) throw failure('transport-capacity', 'Background snapshot staging exceeds the worker admission ceiling.');
    const outputTransport = { mode: 'not-used', packets: 0, operations: 0, bytes: 0, ownedTransferredBytes: 0, maximumSliceMs: 0, elapsedMs: 0, retainedEstimateBytes: 0 };
    const inputTransport = { schema: 'owned-background-snapshot-pages/v1', packets: 0, operations: 0, bytes: 0, maximumSliceMs: 0, maximumPostMessageMs: 0, elapsedMs: 0, stagingBytes: transportStagingBytes };
    const controller = new AbortController(), identity = getActiveExecutionIdentity('browser-background-jobs'), startedAt = now();
    let lease = null, worker = null, input = null, result = null, released = false, workerFailedRetirement = false;
    let retirementWork = null, ownedWork = null, ownedWorkPending = false, lastProgressAt = -Infinity, progressSequence = 0, rejectWorker = null, preparedInputReleased = false;
    const releaseInput = () => {
      if (preparedInputReleased) return;
      preparedInputReleased = true;
      try {
        const acknowledged = releasePreparedInput?.();
        if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
          if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {});
          throw failure('input-retirement-unknown', 'Prepared input retirement must acknowledge synchronously.');
        }
        prepareInput = null; releasePreparedInput = null;
      }
      catch (error) { workerFailedRetirement = true; lease?.retainUnknown(error); throw error; }
    };
    const terminate = () => {
      if (workerFailedRetirement) return false;
      if (!worker) return true;
      try { worker.terminate(); worker = null; return true; }
      catch (error) { workerFailedRetirement = true; lease?.retainUnknown(error); return false; }
    };
    const cleanupListeners = () => { signal?.removeEventListener('abort', cancel); owners.delete(retire); };
    const release = () => {
      if (released) return; released = true; input = null; result = null; cleanupListeners();
      if (workerFailedRetirement) return;
      if (ownedWorkPending) {
        const acknowledge = () => { try { releaseInput(); lease?.confirmRetirement(); } catch { /* Unknown input retirement remains reserved. */ } return lease?.getState(); };
        retirementWork = Promise.resolve(ownedWork).then(acknowledge, acknowledge);
      } else { try { releaseInput(); lease?.release(); } catch { /* Independent retirement failures remain charged. */ } }
    };
    const retire = reason => {
      if (!controller.signal.aborted) controller.abort(reason);
      terminate(); rejectWorker?.(reason);
    };
    const cancel = () => retire(aborted(signal));
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('stale-owner', 'Background result no longer belongs to this document revision.'); };
    const progress = value => {
      if (controller.signal.aborted) return;
      if (!isCurrent()) { retire(failure('stale-owner', 'Background job source ownership changed.')); return; }
      if (now() - lastProgressAt < 50) return;
      if (!value || typeof value.phase !== 'string' || value.phase.length > 64 || !Number.isSafeInteger(value.completedUnits) || value.completedUnits < 0 ||
          value.totalUnits != null && (!Number.isSafeInteger(value.totalUnits) || value.totalUnits < value.completedUnits)) throw failure('invalid-progress', 'Background progress exceeds its protocol bounds.');
      lastProgressAt = now();
      try { onProgress(Object.freeze({ jobId: lease.jobId, ownerEpoch, sourceRevision, sequence: ++progressSequence, ...value })); } catch { /* Observer failure cannot change computed data or resource ownership. */ }
    };
    signal?.addEventListener('abort', cancel, { once: true }); owners.add(retire);
    try {
      lease = await admission.acquire({ kind, ownerId, ownerEpoch, sourceRevision, inputBytes, estimatedPeakBytes: admissionPeakBytes, priority,
        signal: controller.signal, budgetAdapter, deadlineMs, onCancel: retire });
      check();
      ownedWorkPending = true;
      ownedWork = Promise.resolve().then(() => { check(); return prepareInput({ signal: controller.signal }); }).finally(() => { ownedWorkPending = false; });
      input = await interruptible(ownedWork, controller.signal); check();
      const limits = { maxBytes, estimatedPeakBytes, expectedInputHash, maxNodes: 4000000 };
      let executionIdentity = identity, method = 'dedicated-worker';
      const nativeHash = kind === 'asset-hash' && (typeof input !== 'string' || input.length <= 128 * 1024 || crypto !== globalThis.crypto);
      if (typeof Worker === 'function' && !nativeHash) {
        worker = new Worker(new URL('./BackgroundJobWorker.js', import.meta.url), { type: 'module', name: 'lemmings-background-' + kind });
        result = await interruptible(new Promise((resolve, reject) => {
          let terminal = false, inputReady = false, acknowledgment = null, packetSliceMs = 0, outputReceiver = null, outputMetadata = null, outputReceiving = false, outputStarted = null;
          const failed = error => { outputReceiver?.dispose(); outputReceiver = null; acknowledgment?.reject(error); acknowledgment = null; if (!terminal) { terminal = true; reject(error); } };
          const envelope = { protocol: BACKGROUND_JOB_PROTOCOL, jobId: lease.jobId, ownerEpoch, sourceRevision };
          const send = (payload, transfers = []) => new Promise((resolveAck, rejectAck) => {
            check(); if (acknowledgment) throw failure('input-backpressure', 'One input packet must settle before another is sent.');
            acknowledgment = { sequence: payload.sequence, resolve: resolveAck, reject: rejectAck };
            try { const started = now(); worker.postMessage({ ...envelope, ...payload }, transfers); const duration = Math.max(0, now() - started);
              inputTransport.maximumPostMessageMs = Math.max(inputTransport.maximumPostMessageMs, duration); inputTransport.maximumSliceMs = Math.max(inputTransport.maximumSliceMs, (payload.type === 'input-page' ? packetSliceMs : 0) + duration);
            } catch (error) { acknowledgment = null; rejectAck(error); }
          });
          rejectWorker = failed;
          worker.onmessage = event => {
            if (terminal) return;
            try {
              check(); const message = event.data;
              if (message?.protocol !== BACKGROUND_JOB_PROTOCOL || message.jobId !== lease.jobId || message.ownerEpoch !== ownerEpoch || message.sourceRevision !== sourceRevision)
                throw failure('stale-envelope', 'Background worker response has stale ownership.');
              if (message.type === 'input-ack') {
                if (!acknowledgment || message.sequence !== acknowledgment.sequence) throw failure('input-acknowledgment', 'Background snapshot acknowledgment is stale.');
                const pending = acknowledgment; acknowledgment = null; pending.resolve(); return;
              }
              if (message.type === 'progress') { if (!inputReady) throw failure('early-progress', 'Worker computation preceded its completed snapshot.'); progress(message.progress); return; }
              if (message.type === 'failed') {
                const error = failure(message.error?.code || 'worker-failed', String(message.error?.message || 'Background worker failed.').slice(0, 512));
                if (typeof message.error?.sourceId === 'string' && message.error.sourceId.length <= 256) error.sourceId = message.error.sourceId;
                if (Number.isSafeInteger(message.error?.firstSequence) && message.error.firstSequence >= 0) error.firstSequence = message.error.firstSequence;
                failed(error); return;
              }
              if (!inputReady) throw failure('early-result', 'Worker result preceded its completed input snapshot.');
              if (message.type === 'output-start') {
                const metadata = message.metadata;
                if (outputReceiver || message.sequence !== 0 || !metadata || Object.hasOwn(message, 'result') || !Number.isSafeInteger(metadata.inputBytes) || metadata.inputBytes < 0 || metadata.inputBytes > maxBytes ||
                    !Number.isSafeInteger(metadata.nodes) || metadata.nodes < 1 || metadata.nodes > 4000000 || metadata.retainedBytes != null && (!Number.isSafeInteger(metadata.retainedBytes) || metadata.retainedBytes < 0 || metadata.retainedBytes > estimatedPeakBytes)) throw failure('invalid-result', 'Background worker result exceeds its admitted protocol.');
                if (identity.activeExecution === 'bound' && !compareActiveExecutionIdentity(message.executionIdentity, 'browser-background-jobs').matched) throw failure('worker-build-mismatch', 'Background worker executes a different application build.');
                executionIdentity = message.executionIdentity; outputMetadata = { inputBytes: metadata.inputBytes, nodes: metadata.nodes, retainedBytes: metadata.retainedBytes };
                outputReceiver = createBackgroundSnapshotReceiver({ maxBytes: Math.min(256 * 1048576, Math.floor(estimatedPeakBytes / 2)), maxNodes: 4000000, estimatedPeakBytes, allowOwnedBinary: true, allowOwnedWasmModule: kind === 'prepare-stretch-core-image' && identity.activeExecution === 'bound' });
                outputTransport.mode = 'acknowledged-snapshot-pages'; outputStarted = now(); worker.postMessage({ ...envelope, type: 'output-ack', sequence: 0 }); return;
              }
              if (message.type === 'output-page') {
                if (!outputReceiver || outputReceiving || message.sequence !== message.packet?.sequence) throw failure('result-backpressure', 'Unexpected or overlapping background result packet.');
                outputReceiving = true; ownedWorkPending = true; const receiver = outputReceiver;
                const receiveWork = receiver.pushCooperative(message.packet, { signal: controller.signal, isCurrent, yieldTask, now,
                  onSlice: slice => { outputTransport.maximumSliceMs = Math.max(outputTransport.maximumSliceMs, slice.durationMs); } }).then(receipt => {
                  check(); if (terminal || outputReceiver !== receiver) throw failure('result-retired', 'Background result receiver retired.');
                  outputTransport.ownedTransferredBytes += message.packet.operations.reduce((sum, operation) => sum + (operation[0] === 'owned-binary' ? operation[2].byteLength : 0), 0);
                  outputTransport.packets++; outputTransport.operations += message.packet.operations.length; outputTransport.bytes += message.packet.bytes; outputTransport.retainedEstimateBytes = receipt.retainedEstimateBytes;
                  outputReceiving = false; worker.postMessage({ ...envelope, type: 'output-ack', sequence: receipt.sequence });
                }).catch(failed).finally(() => { if (ownedWork === receiveWork) ownedWorkPending = false; }); ownedWork = receiveWork; return;
              }
              if (message.type !== 'computed' || !outputReceiver || outputReceiving || Object.hasOwn(message, 'result')) throw failure('invalid-result', 'Background result lacks its completed owned snapshot.');
              const value = outputReceiver.finish(message.sequence); outputReceiver = null; outputTransport.elapsedMs = Math.max(0, now() - outputStarted);
              terminal = true; resolve({ ...outputMetadata, value });
            } catch (error) { failed(error); }
          };
          worker.onerror = event => { event.preventDefault?.(); failed(failure('worker-crash', 'Background worker crashed before computation completed.')); };
          worker.onmessageerror = () => failed(failure('worker-message', 'Background worker result could not be decoded.'));
          ownedWorkPending = true;
          ownedWork = Promise.resolve().then(async () => {
            const started = now(); await send({ type: 'input-start', sequence: 0, kind, limits, requiredIdentity: identity });
            for await (const packet of encodeBackgroundSnapshotPages(input, { ...limits, signal: controller.signal, isCurrent, yieldTask, now,
              onSlice: slice => { packetSliceMs = slice.durationMs; } })) {
              check(); const sequence = packet.sequence; inputTransport.packets++; inputTransport.operations += packet.operations.length; inputTransport.bytes += packet.bytes;
              await send({ type: 'input-page', sequence, packet }, backgroundSnapshotTransfers(packet));
            }
            check(); inputTransport.elapsedMs = Math.max(0, now() - started); inputReady = true;
            worker.postMessage({ ...envelope, type: 'input-end', sequence: inputTransport.packets });
          }).catch(failed).finally(() => { ownedWorkPending = false; });
        }), controller.signal);
      } else {
        method = kind === 'asset-hash' ? 'native-crypto' : kind === 'recovery-checksum' ? 'cooperative-main-thread-fallback' : 'bounded-main-thread-fallback';
        if (typeof input === 'string' && input.length > 128 * 1024) throw failure('worker-required', 'Large text computations require a background worker.');
        if (!['asset-hash', 'recovery-checksum'].includes(kind) && inputBytes > 128 * 1024) throw failure('worker-required', 'This computation needs a worker; only small bounded fallback work is supported.');
        ownedWorkPending = true;
        ownedWork = Promise.resolve().then(yieldTask).then(() => runBackgroundJobKernel(kind, input, { ...limits,
          ...(!['asset-hash', 'recovery-checksum'].includes(kind) ? { maxBytes: Math.min(maxBytes, 128 * 1024), maxNodes: 4096 } : {}),
          crypto, maxStringBytes: 128 * 1024, ...(kind === 'asset-decode' ? { maxDecodedBytes: 128 * 1024 } : {}),
          signal: controller.signal, current: isCurrent, onProgress: progress, yieldControl: yieldTask })).finally(() => { ownedWorkPending = false; });
        result = await interruptible(ownedWork, controller.signal);
      }
      check(); if (ownedWorkPending) { await interruptible(ownedWork, controller.signal); check(); }
      if (!terminate()) throw failure('worker-retirement-unknown', 'Background worker retirement could not be confirmed.');
      ownedWork = null;
      if (!retainInput) { input = null; releaseInput(); }
      const objectResult = result.value != null && typeof result.value === 'object';
      if (kind === 'verify-causal-source' && !Number.isSafeInteger(result.retainedBytes)) throw failure('invalid-result', 'Verified causal source omitted its result footprint.');
      const inferredBytes = kind === 'verify-causal-source' && !retainInput ? 0 : (typeof result.value === 'string' ? result.value.length * 2 : 0) +
        (retainInput || objectResult ? result.inputBytes * 2 + result.nodes * 64 : 0);
      const retainedBytes = Math.max(4096, result.retainedBytes ?? 0, inferredBytes, outputTransport.retainedEstimateBytes);
      if (retainedBytes > estimatedPeakBytes) throw failure('result-capacity', 'Computed result exceeds its admitted retained footprint.');
      if (!lease.computationFinished({ retainedBytes })) throw failure('ownership-retired', 'Background computation owner retired before publication.');
      const receipt = Object.freeze({ protocol: BACKGROUND_JOB_PROTOCOL, jobId: lease.jobId, kind, ownerId, ownerEpoch, sourceRevision,
        state: 'computed', publication: 'not-committed', method, queueWaitMs: lease.getState().queueWaitMs, elapsedMs: Math.max(0, now() - startedAt),
        inputBytes: result.inputBytes, nodes: result.nodes, retainedBytes, inputTransport: Object.freeze({ ...inputTransport }), outputTransport: Object.freeze({ ...outputTransport }), executionIdentity });
      return Object.freeze({ get value() { check(); if (released) throw failure('result-retired', 'Background result was released.'); return result.value; }, signal: controller.signal, receipt, release,
        retirementState: () => lease.getState() });
    } catch (error) {
      retire(error); release();
      const reported = error instanceof Error && Object.isExtensible(error) ? error : Object.assign(new Error(String(error?.message || error)), { name: String(error?.name || 'BackgroundJobError'), code: error?.code, cause: error });
      if (lease) { reported.backgroundRetirement = lease.getState(); reported.backgroundRetirementCompletion = retirementWork || Promise.resolve(reported.backgroundRetirement); }
      throw reported;
    }
  };
  return Object.freeze({ compute, diagnostics: () => admission.diagnostics(), dispose() { if (disposed) return; disposed = true; for (const retire of [...owners]) retire(failure('service-retired', 'Background job service retired.')); } });
}

export const backgroundJobService = createBackgroundJobService();
