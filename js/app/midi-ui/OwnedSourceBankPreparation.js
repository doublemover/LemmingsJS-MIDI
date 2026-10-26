import { requireSynchronousResourceAcknowledgement } from '../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { getOwnedSourceBankIdentity, validateOwnedSourceBank } from './OwnedSourceBank.js';

export async function prepareOwnedSourceBank(id, { resources, owner = null, generation = 0, signal, isCurrent = () => true, jobs = backgroundJobService } = {}) {
  signal?.throwIfAborted(); const expected = getOwnedSourceBankIdentity(id);
  const preparationBytes = id === 'sample-read-v1' ? 24 * 1048576 : 16 * 1048576;
  const workspace = resources?.reserve({ kind: 'source-bank-preparation', owner, generation, estimateBytes: preparationBytes, consumerOwned: true });
  let result = null, released = false, failure = null;
  const unknown = cause => {
    if (failure) return failure;
    failure = Object.assign(new Error('Fixed source bank retirement is unresolved.'), { cause });
    try { workspace?.retainUnknown(failure); } catch (error) { failure.budgetFailure = error; }
    failure.retirement = createProcgenRetirementScope().retire([{ name: 'fixed-source-bank-producer', run: () => { throw failure; } }]);
    return failure;
  };
  const release = () => {
    if (failure) throw failure;
    if (released) return;
    released = true;
    try {
      if (result) requireSynchronousResourceAcknowledgement(result.release(), 'Fixed source bank result release');
      if (result && !['released', 'canceled'].includes(result.retirementState().phase)) throw new Error('Fixed source bank producer retirement is unknown.');
      result = null; if (workspace) requireSynchronousResourceAcknowledgement(workspace.release(), 'Fixed source bank workspace release');
    } catch (error) { throw unknown(error); }
  };
  try {
    result = await jobs.compute({ kind: 'prepare-owned-source-bank', ownerId: 'source-bank:' + id, ownerEpoch: generation,
      sourceRevision: expected.hash, inputBytes: 128, maxBytes: Math.max(1048576, expected.bytes + 16384), estimatedPeakBytes: preparationBytes,
      signal, isCurrent, deadlineMs: 60000, prepareInput: () => ({ id }) });
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('Fixed source bank preparation is stale.');
    validateOwnedSourceBank(result.value, id);
    return Object.freeze({ get payload() { if (released || signal?.aborted || !isCurrent()) throw new Error('Fixed source bank is retired.'); return result.value; }, release });
  } catch (error) {
    let producer = error.backgroundRetirement;
    if (error.backgroundRetirementCompletion) {
      try { producer = await error.backgroundRetirementCompletion; }
      catch (retirementError) { const unresolved = unknown(retirementError); unresolved.originalFailure = error; await unresolved.retirement.completion; throw unresolved; }
    }
    if (producer && !['released', 'canceled'].includes(producer.phase)) {
      const unresolved = unknown(error); unresolved.backgroundRetirement = producer; await unresolved.retirement.completion; throw unresolved;
    }
    release(); throw error;
  }
}
