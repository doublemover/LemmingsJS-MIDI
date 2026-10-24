import { backgroundJobService } from './BackgroundJobService.js';

let nextOwner = 0;
const failure = message => Object.assign(new Error(message), { name: 'DataSnapshotError' });
export function createOwnedDataSnapshots({ resourceBudget, jobs = backgroundJobService, ownerId = 'data-snapshot' } = {}) {
  if (typeof resourceBudget?.reserve !== 'function' || typeof resourceBudget?.release !== 'function' || typeof jobs?.compute !== 'function' || typeof ownerId !== 'string' || !ownerId || ownerId.length > 192)
    throw new TypeError('Snapshots require shared data and computation ownership.');
  const identity = ownerId + '-' + (++nextOwner); let serial = 0;
  const prepare = async (value, { signal, sourceRevision, maxBytes = 1048576, inputFootprintBytes, isCurrent = () => true } = {}) => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(inputFootprintBytes) || inputFootprintBytes < 4096 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1048576 ||
        typeof isCurrent !== 'function' || !['number', 'string'].includes(typeof sourceRevision) || !String(sourceRevision).length || String(sourceRevision).length > 256 ||
        typeof sourceRevision === 'number' && (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) || serial === Number.MAX_SAFE_INTEGER)
      throw new TypeError('Invalid owned snapshot source bounds.');
    const estimatedPeakBytes = inputFootprintBytes * 3 + maxBytes * 8 + 65536;
    if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes > 512 * 1048576) throw failure('Snapshot requires a smaller data window or a qualified larger memory profile.');
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    let handle = null, published = false, captured = null, released = false, releaseError = null;
    const release = () => {
      if (released) { if (releaseError) throw releaseError; return false; } released = true; captured = null;
      if (!handle) return true;
      releaseError = failure('Snapshot result retirement is unresolved.');
      try { handle.release(); if (!['released', 'canceled'].includes(handle.retirementState().phase)) throw releaseError; }
      catch (error) { releaseError = error; throw error; }
      releaseError = null; return true;
    };
    try {
      handle = await jobs.compute({ kind: 'snapshot-canonical-data', ownerId: identity, ownerEpoch: ++serial, sourceRevision,
        maxBytes, inputBytes: maxBytes, estimatedPeakBytes, budgetAdapter: resourceBudget, signal: controller.signal,
        isCurrent: () => published || isCurrent(), priority: 'interactive', prepareInput: () => value });
      signal?.throwIfAborted(); if (!isCurrent()) throw failure('Snapshot source changed before publication.');
      captured = handle.value; published = true; value = null; isCurrent = () => true;
      return Object.freeze({ get value() { if (released) throw failure('Snapshot result has retired.'); return captured; }, receipt: handle.receipt,
        release, retirementState: handle.retirementState });
    } catch (error) {
      try { release(); } catch (retirement) { throw Object.assign(failure('Snapshot preparation failed with unresolved result ownership.'), { cause: error, retirement }); }
      throw error;
    } finally { signal?.removeEventListener('abort', cancel); }
  };
  return Object.freeze({ prepare });
}
