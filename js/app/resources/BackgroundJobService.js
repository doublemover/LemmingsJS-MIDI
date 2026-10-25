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
  now = () => performance.now(), yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const owners = new Set(); let disposed = false;
  const compute = async ({ kind, ownerId, ownerEpoch, sourceRevision, inputBytes = 0, estimatedPeakBytes, priority = 'interactive',
    prepareInput, releasePreparedInput = null, signal, budgetAdapter, isCurrent = () => true, onProgress = () => {}, maxBytes = 64 * 1048576,
    expectedInputHash = null, deadlineMs = 180000, crypto = globalThis.crypto, retainInput = false } = {}) => {
    signal?.throwIfAborted();
    if (disposed || !BACKGROUND_JOB_KINDS.includes(kind) || typeof prepareInput !== 'function' || typeof isCurrent !== 'function' || typeof onProgress !== 'function' ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1048576 || releasePreparedInput != null && typeof releasePreparedInput !== 'function') throw failure('invalid-contract', 'Invalid background computation request.');
    if (!isCurrent()) throw failure('stale-owner', 'Background job source ownership changed.');
    if (['encode-recovery-page', 'decode-recovery-page', 'analyze-native-impulse', 'encode-native-render', 'render-sound-controls', 'render-causal-sine-take', 'render-causal-source-pcm', 'prepare-owned-source-bank', 'inspect-wave-asset', 'generate-procedural-sound', 'decode-wave-source'].includes(kind) && typeof Worker !== 'function') throw failure('worker-required', 'This offline computation requires its admitted worker.');
    if (typeof Worker !== 'function' && !['asset-hash', 'recovery-checksum'].includes(kind) && inputBytes > 128 * 1024)
      throw failure('worker-required', 'This computation needs a worker; only small bounded fallback work is supported.');
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
      lease = await admission.acquire({ kind, ownerId, ownerEpoch, sourceRevision, inputBytes, estimatedPeakBytes, priority,
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
          let terminal = false;
          const failed = error => { if (!terminal) { terminal = true; reject(error); } };
          rejectWorker = failed;
          worker.onmessage = event => {
            if (terminal) return;
            try {
              const message = event.data;
              if (message?.protocol !== BACKGROUND_JOB_PROTOCOL || message.jobId !== lease.jobId || message.ownerEpoch !== ownerEpoch || message.sourceRevision !== sourceRevision)
                throw failure('stale-envelope', 'Background worker response has stale ownership.');
              if (message.type === 'progress') { progress(message.progress); return; }
              if (message.type === 'failed') { failed(failure(message.error?.code || 'worker-failed', String(message.error?.message || 'Background worker failed.').slice(0, 512))); return; }
              if (message.type !== 'computed' || !message.result || !Number.isSafeInteger(message.result.inputBytes) || message.result.inputBytes < 0 || message.result.inputBytes > maxBytes ||
                  !Number.isSafeInteger(message.result.nodes) || message.result.nodes < 1 || message.result.nodes > 4000000 ||
                  message.result.retainedBytes != null && (!Number.isSafeInteger(message.result.retainedBytes) || message.result.retainedBytes < 0 || message.result.retainedBytes > estimatedPeakBytes)) throw failure('invalid-result', 'Background worker result exceeds its admitted protocol.');
              if (identity.activeExecution === 'bound' && !compareActiveExecutionIdentity(message.executionIdentity, 'browser-background-jobs').matched)
                throw failure('worker-build-mismatch', 'Background worker executes a different application build.');
              executionIdentity = message.executionIdentity; terminal = true; resolve(message.result);
            } catch (error) { failed(error); }
          };
          worker.onerror = event => { event.preventDefault?.(); failed(failure('worker-crash', 'Background worker crashed before computation completed.')); };
          worker.onmessageerror = () => failed(failure('worker-message', 'Background worker result could not be decoded.'));
          worker.postMessage({ protocol: BACKGROUND_JOB_PROTOCOL, jobId: lease.jobId, ownerEpoch, sourceRevision, kind, input, limits, requiredIdentity: identity });
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
      check();
      if (!terminate()) throw failure('worker-retirement-unknown', 'Background worker retirement could not be confirmed.');
      ownedWork = null;
      if (!retainInput) { input = null; releaseInput(); }
      const objectResult = result.value != null && typeof result.value === 'object';
      if (kind === 'verify-causal-source' && !Number.isSafeInteger(result.retainedBytes)) throw failure('invalid-result', 'Verified causal source omitted its result footprint.');
      const inferredBytes = kind === 'verify-causal-source' && !retainInput ? 0 : (typeof result.value === 'string' ? result.value.length * 2 : 0) +
        (retainInput || objectResult ? result.inputBytes * 2 + result.nodes * 64 : 0);
      const retainedBytes = Math.min(estimatedPeakBytes, Math.max(4096, result.retainedBytes ?? 0, inferredBytes));
      if (!lease.computationFinished({ retainedBytes })) throw failure('ownership-retired', 'Background computation owner retired before publication.');
      const receipt = Object.freeze({ protocol: BACKGROUND_JOB_PROTOCOL, jobId: lease.jobId, kind, ownerId, ownerEpoch, sourceRevision,
        state: 'computed', publication: 'not-committed', method, queueWaitMs: lease.getState().queueWaitMs, elapsedMs: Math.max(0, now() - startedAt),
        inputBytes: result.inputBytes, nodes: result.nodes, retainedBytes, executionIdentity });
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
