import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { getOwnedSourceBankIdentity, validateOwnedSourceBank } from './OwnedSourceBank.js';

export async function prepareOwnedSourceBank(id, { resources, owner = null, generation = 0, signal, isCurrent = () => true, jobs = backgroundJobService } = {}) {
  signal?.throwIfAborted(); const expected = getOwnedSourceBankIdentity(id);
  const workspace = resources?.reserve({ kind: 'source-bank-preparation', owner, generation, estimateBytes: 16 * 1048576, consumerOwned: true });
  let result = null, released = false, failure = null;
  const release = () => {
    if (failure) throw failure;
    if (released) return;
    released = true;
    try {
      result?.release();
      if (result && !['released', 'canceled'].includes(result.retirementState().phase)) throw new Error('Fixed source bank producer retirement is unknown.');
      result = null; workspace?.release();
    } catch (error) { failure = error; workspace?.retainUnknown(error); throw error; }
  };
  try {
    result = await jobs.compute({ kind: 'prepare-owned-source-bank', ownerId: 'source-bank:' + id, ownerEpoch: generation,
      sourceRevision: expected.hash, inputBytes: 128, maxBytes: 1048576, estimatedPeakBytes: 16 * 1048576,
      signal, isCurrent, deadlineMs: 60000, prepareInput: () => ({ id }) });
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('Fixed source bank preparation is stale.');
    validateOwnedSourceBank(result.value, id);
    return Object.freeze({ get payload() { if (released || signal?.aborted || !isCurrent()) throw new Error('Fixed source bank is retired.'); return result.value; }, release });
  } catch (error) {
    if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
    if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) {
      failure = error; workspace?.retainUnknown(error);
    } else release();
    throw error;
  }
}
