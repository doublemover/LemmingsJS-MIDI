import { backgroundJobService } from './BackgroundJobService.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
export function createSharedContentJobs({ jobs = backgroundJobService, maxEntries = 64 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw new RangeError('Invalid shared content job bound.');
  const entries = new Map(), scopes = new WeakMap(); let nextScope = 0, disposed = false;
  const acquire = ({ contentHash, decoderVersion, signal, isCurrent = () => true, onProgress = () => {}, ...specification } = {}) => {
    signal?.throwIfAborted();
    if (disposed || !/^[a-f0-9]{64}$/.test(contentHash || '') || typeof decoderVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(decoderVersion) ||
        !['asset-hash', 'asset-decode', 'parse-json'].includes(specification.kind) || typeof isCurrent !== 'function' || typeof onProgress !== 'function' || specification.retainInput)
      throw failure('invalid-contract', 'Shared jobs require a versioned pure content identity.');
    if (!isCurrent()) throw failure('stale-owner', 'Shared content consumer no longer owns its source.');
    const budget = specification.budgetAdapter;
    if (budget && !scopes.has(budget)) scopes.set(budget, ++nextScope);
    const key = JSON.stringify([specification.kind, contentHash, decoderVersion, budget ? scopes.get(budget) : 0,
      specification.inputBytes, specification.estimatedPeakBytes, specification.maxBytes ?? null, specification.expectedInputHash ?? null]);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxEntries) throw failure('queue-capacity', 'Shared content job limit reached.');
      entry = { controller: new AbortController(), consumers: new Set(), result: null, promise: null };
      entries.set(key, entry);
      const progress = value => {
        for (const consumer of [...entry.consumers]) {
          if (!consumer.current()) { consumer.cancel(failure('stale-owner', 'Shared content consumer source changed.')); continue; }
          try { consumer.progress(value); } catch { /* Progress observers cannot retire another consumer. */ }
        }
      };
      entry.promise = Promise.resolve().then(() => jobs.compute({ ...specification, ownerId: 'content:' + contentHash, ownerEpoch: 0,
        sourceRevision: decoderVersion + ':' + contentHash, signal: entry.controller.signal, isCurrent: () => !disposed, onProgress: progress }))
        .then(result => { entry.result = result; if (!entry.consumers.size) result.release(); return result; })
        .catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      entry.promise.catch(() => {});
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController(); let released = false, delivered = false;
      const current = () => { try { return !disposed && !controller.signal.aborted && isCurrent(); } catch { return false; } };
      const release = () => {
        if (released) return; released = true;
        signal?.removeEventListener('abort', abort); entry.controller.signal.removeEventListener('abort', retired);
        entry.consumers.delete(consumer);
        if (!entry.consumers.size) {
          if (entries.get(key) === entry) entries.delete(key);
          entry.controller.abort(failure('no-consumers', 'The last content consumer released its lease.'));
          entry.result?.release();
        }
      };
      const cancel = reason => {
        if (!controller.signal.aborted) controller.abort(reason);
        if (!delivered) { release(); reject(reason); }
      };
      const abort = () => cancel(signal.reason || failure('cancelled', 'Shared content consumer canceled.'));
      const retired = () => cancel(entry.controller.signal.reason || failure('service-retired', 'Shared content job retired.'));
      const consumer = { current, cancel, progress: onProgress };
      entry.consumers.add(consumer);
      signal?.addEventListener('abort', abort, { once: true }); entry.controller.signal.addEventListener('abort', retired, { once: true });
      if (signal?.aborted) abort();
      if (entry.controller.signal.aborted) retired();
      entry.promise.then(result => {
        if (released) return;
        if (!current()) { cancel(failure('stale-owner', 'Shared content consumer source changed.')); return; }
        delivered = true;
        resolve(Object.freeze({ signal: controller.signal, receipt: result.receipt, release,
          get value() {
            if (released || !current()) throw failure('stale-owner', 'Shared content result lease is retired.');
            return result.value;
          } }));
      }, error => { if (!released) { release(); reject(error); } });
    });
  };
  return Object.freeze({ acquire, diagnostics: () => ({ entries: entries.size,
    consumers: [...entries.values()].reduce((total, entry) => total + entry.consumers.size, 0), disposed }),
  dispose() { if (!disposed) { disposed = true; for (const entry of [...entries.values()]) entry.controller.abort(failure('service-retired', 'Shared content jobs retired.')); } } });
}

export const sharedContentJobs = createSharedContentJobs();
