import { backgroundJobService } from './BackgroundJobService.js';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult } from './ResourceRetirement.js';

export const SHARED_PURE_JOB_KINDS = Object.freeze(['render-resonator-morph-reference', 'analyze-resonator-morph', 'asset-hash', 'asset-decode', 'parse-json', 'encode-json', 'encode-canonical-json',
  'encode-recovery-page', 'decode-recovery-page', 'compile-sound-content', 'inspect-wave-asset', 'decode-wave-source', 'analyze-native-impulse',
  'generate-procedural-sound', 'prepare-owned-source-bank', 'snapshot-canonical-data', 'inspect-causal-archive-entry']);
const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
const knownRetired = state => state && ['released', 'canceled'].includes(state.phase);
export function createSharedContentJobs({ jobs = backgroundJobService, maxEntries = 64 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw new RangeError('Invalid shared content job bound.');
  const entries = new Map(), scopes = new WeakMap(), orphanedInputs = new Set(); let nextScope = 0, disposed = false;
  const drop = entry => { if (entries.get(entry.key) === entry) entries.delete(entry.key); };
  const retire = entry => {
    if (entry.retirementError) throw entry.retirementError;
    if (entry.phase === 'released') return;
    if (!entry.result) { entry.phase = 'canceling'; entry.controller.abort(failure('no-consumers', 'The last content consumer released its lease.')); return; }
    entry.phase = 'retiring';
    try { retireBackgroundResult(entry.result); entry.result.signal?.removeEventListener('abort', entry.resultAborted); entry.result = null; entry.resultAborted = null; entry.promise = null; entry.phase = 'released'; drop(entry); }
    catch (error) { entry.phase = 'failed-or-unknown'; entry.retirementError = error; throw error; }
  };
  const acquire = ({ contentHash, decoderVersion, signal, isCurrent = () => true, onProgress = () => {}, ...specification } = {}) => {
    signal?.throwIfAborted();
    if (disposed || !/^[a-f0-9]{64}$/.test(contentHash || '') || typeof decoderVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(decoderVersion) ||
        !SHARED_PURE_JOB_KINDS.includes(specification.kind) || typeof specification.prepareInput !== 'function' || typeof isCurrent !== 'function' || typeof onProgress !== 'function' || specification.retainInput || specification.crypto)
      throw failure('invalid-contract', 'Shared jobs require a versioned pure content identity and the service crypto implementation.');
    if (!isCurrent()) throw failure('stale-owner', 'Shared content consumer no longer owns its source.');
    const budget = specification.budgetAdapter;
    if (budget && !scopes.has(budget)) scopes.set(budget, ++nextScope);
    const key = JSON.stringify([specification.kind, contentHash, decoderVersion, budget ? scopes.get(budget) : 0,
      specification.inputBytes, specification.estimatedPeakBytes, specification.maxBytes ?? null, specification.expectedInputHash ?? null,
      specification.deadlineMs ?? 180000, specification.priority ?? 'interactive']);
    let entry = entries.get(key);
    if (entry && ['canceling', 'retiring', 'failed-or-unknown'].includes(entry.phase)) throw failure('retirement-pending', 'Identical content still has unresolved retirement.');
    if (!entry) {
      if (entries.size + orphanedInputs.size >= maxEntries) throw failure('queue-capacity', 'Shared content job limit reached.');
      entry = { key, controller: new AbortController(), consumers: new Set(), result: null, promise: null, phase: 'pending', retirementError: null, resultAborted: null };
      entries.set(key, entry);
      let prepared = false, inputRetired = false, inputRetirementError = null, prepare = specification.prepareInput, releaseInput = specification.releasePreparedInput;
      specification.prepareInput = null; specification.releasePreparedInput = null;
      const releasePreparedInput = () => {
        if (inputRetirementError) throw inputRetirementError;
        if (inputRetired) return;
        try { requireSynchronousResourceAcknowledgement(releaseInput?.(), 'Shared content input'); inputRetired = true; prepare = releaseInput = null; }
        catch (error) { inputRetirementError = error; entry.retirementError = error; throw error; }
      };
      const progress = value => {
        for (const consumer of [...entry.consumers]) {
          if (!consumer.current()) { consumer.cancel(failure('stale-owner', 'Shared content consumer source changed.')); continue; }
          try { consumer.progress(value); } catch { /* One observer cannot retire another consumer. */ }
        }
      };
      entry.promise = Promise.resolve().then(() => {
        entry.controller.signal.throwIfAborted();
        return jobs.compute({ ...specification, ownerId: 'content:' + contentHash, ownerEpoch: 0,
          sourceRevision: decoderVersion + ':' + contentHash, signal: entry.controller.signal, isCurrent: () => !disposed, onProgress: progress,
          releasePreparedInput, prepareInput: options => { prepared = true; return prepare(options); } });
      }).then(result => {
        entry.result = result; entry.phase = 'computed';
        entry.resultAborted = () => entry.controller.abort(result.signal.reason || failure('service-retired', 'Shared computation retired.'));
        result.signal?.addEventListener('abort', entry.resultAborted, { once: true }); if (result.signal?.aborted) entry.resultAborted();
        if (!entry.consumers.size) retire(entry); return result;
      }).catch(reason => {
        const error = reason instanceof Error && Object.isExtensible(reason) ? reason : new Error(String(reason?.message || reason), { cause: reason });
        if (!prepared) try { releasePreparedInput(); } catch (retirementError) { error.inputRetirementError = retirementError; }
        const settle = state => {
          if (entry.retirementError || (state ? !knownRetired(state) : prepared || !!entry.result)) { entry.phase = 'failed-or-unknown'; entry.retirementError ||= error; entry.retirementError.backgroundRetirement = state || { phase: 'failed-or-unknown' }; }
          else { entry.phase = 'released'; entry.promise = null; drop(entry); }
        };
        if (error.backgroundRetirementCompletion) { entry.phase = 'canceling'; Promise.resolve(error.backgroundRetirementCompletion).then(settle, () => settle({ phase: 'failed-or-unknown' })); }
        else settle(error.backgroundRetirement);
        throw error;
      });
      entry.promise.catch(() => {});
    } else if (specification.releasePreparedInput) {
      if (entries.size + orphanedInputs.size >= maxEntries) throw failure('queue-capacity', 'Shared input-retirement capacity is occupied.');
      const orphan = { release: specification.releasePreparedInput, error: null }; orphanedInputs.add(orphan);
      try { requireSynchronousResourceAcknowledgement(orphan.release(), 'Duplicate shared content input'); orphanedInputs.delete(orphan); }
      catch (error) { orphan.error = error; throw error; }
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController(); let released = false, delivered = false, retirementError = null, valueOwner = null;
      const current = () => { try { return !disposed && !controller.signal.aborted && isCurrent(); } catch { return false; } };
      const release = () => {
        if (retirementError) throw retirementError;
        if (released) return; released = true; valueOwner = null;
        signal?.removeEventListener('abort', abort); entry.controller.signal.removeEventListener('abort', retired);
        entry.consumers.delete(consumer);
        if (!entry.consumers.size) try { retire(entry); } catch (error) { retirementError = error; throw error; }
      };
      const cancel = reason => {
        if (!controller.signal.aborted) controller.abort(reason);
        if (!delivered) { try { release(); } catch (error) { retirementError = error; } reject(retirementError || reason); }
      };
      const abort = () => cancel(signal.reason || failure('cancelled', 'Shared content consumer canceled.'));
      const retired = () => cancel(entry.controller.signal.reason || failure('service-retired', 'Shared content job retired.'));
      const consumer = { current, cancel, progress: onProgress };
      entry.consumers.add(consumer);
      signal?.addEventListener('abort', abort, { once: true }); entry.controller.signal.addEventListener('abort', retired, { once: true });
      if (signal?.aborted) abort(); if (entry.controller.signal.aborted) retired();
      entry.promise.then(result => {
        if (released) return;
        if (!current()) { cancel(failure('stale-owner', 'Shared content consumer source changed.')); return; }
        delivered = true; valueOwner = result;
        resolve(Object.freeze({ signal: controller.signal, receipt: result.receipt, release,
          retirementState: () => Object.freeze({ phase: retirementError ? 'failed-or-unknown' : released ? 'released' : controller.signal.aborted ? 'canceling' : 'computed', sharedPhase: entry.phase }),
          get value() { if (released || !current()) throw failure('stale-owner', 'Shared content result lease is retired.'); return valueOwner.value; } }));
      }, error => { if (!released) { try { release(); } catch (retirementError) { reject(retirementError); return; } reject(error); } });
    });
  };
  return Object.freeze({ acquire, diagnostics: () => ({ entries: entries.size, orphanedInputs: orphanedInputs.size,
    failedOrUnknown: [...entries.values()].filter(entry => entry.phase === 'failed-or-unknown').length + orphanedInputs.size,
    retiring: [...entries.values()].filter(entry => ['canceling', 'retiring'].includes(entry.phase)).length,
    consumers: [...entries.values()].reduce((total, entry) => total + entry.consumers.size, 0), disposed }),
  dispose() { if (!disposed) { disposed = true; for (const entry of [...entries.values()]) entry.controller.abort(failure('service-retired', 'Shared content jobs retired.')); } } });
}

export const sharedContentJobs = createSharedContentJobs();

const serviceRegistries = new WeakMap([[backgroundJobService, sharedContentJobs]]);
export function sharedContentJobsFor(jobs = backgroundJobService) {
  if (!jobs || typeof jobs.compute !== 'function') throw new TypeError('Shared content requires a background computation service.');
  let registry = serviceRegistries.get(jobs);
  if (!registry) { registry = createSharedContentJobs({ jobs }); serviceRegistries.set(jobs, registry); }
  return registry;
}
