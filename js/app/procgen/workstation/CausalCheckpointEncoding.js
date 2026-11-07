import { backgroundJobService } from '../../resources/BackgroundJobService.js';
import { inspectBackgroundSnapshot } from '../../resources/BackgroundSnapshotPages.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { canonicalJournalText, hashJournalText, journalError } from './CausalJournalCanonical.js';
let serial = 0;
export async function prepareCausalCheckpointEncoding(value, { resourceBudget = null, jobs = backgroundJobService, signal, isCurrent = () => true, sourceRevision = 'initial-checkpoint' } = {}) {
  signal?.throwIfAborted(); if (!isCurrent()) throw journalError('checkpoint-source-changed', 'The checkpoint source changed before encoding.');
  const inventory = await inspectBackgroundSnapshot(value, { maxBytes: 32 * 1048576, maxNodes: 4000000, estimatedPeakBytes: 512 * 1048576, signal, isCurrent });
  const retirement = createProcgenRetirementScope(); let storage = null, job = null, encoded = null, released = false;
  try {
    if (inventory.dataBytes <= 131072 && inventory.nodes <= 4096) {
      storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-small-checkpoint:' + (++serial), kind: 'bounded-canonical-checkpoint-encoding', category: 'checkpoint', bytes: Math.max(4096, inventory.retainedEstimateBytes * 4 + 65536) });
      const result = canonicalJournalText(value, { maxBytes: 1048576, maxNodes: 16384 });
      encoded = { schema: 'lemmings-canonical-checkpoint-encoding/v1', canonical: result.text, hash: await hashJournalText(result.text), bytes: result.bytes.length, nodes: result.nodes, method: 'small-bounded-main-realm' };
    } else {
      const peak = Math.max(32 * 1048576, inventory.retainedEstimateBytes * 2 + inventory.canonicalMaxBytes * 4 + 16 * 1048576);
      if (!Number.isSafeInteger(peak) || peak > 496 * 1048576) throw journalError('checkpoint-capacity', 'The checkpoint encoder needs a larger qualified representation profile.');
      job = await jobs.compute({ kind: 'encode-causal-checkpoint', ownerId: 'causal-checkpoint-encoder:' + (++serial), ownerEpoch: 1, sourceRevision,
        inputBytes: Math.min(64 * 1048576, inventory.dataBytes + 4096), maxBytes: 32 * 1048576, estimatedPeakBytes: peak, deadlineMs: 90000, budgetAdapter: resourceBudget, signal, isCurrent, prepareInput: () => value });
      if (job.receipt?.method !== 'dedicated-worker') throw journalError('checkpoint-worker-required', 'Large checkpoint encoding must execute in its admitted worker.'); encoded = job.value;
    }
    signal?.throwIfAborted(); if (!isCurrent() || encoded?.schema !== 'lemmings-canonical-checkpoint-encoding/v1' || typeof encoded.canonical !== 'string' || !/^[a-f0-9]{64}$/.test(encoded.hash || '') || !Number.isSafeInteger(encoded.bytes) || encoded.bytes < 1 || encoded.bytes > 32 * 1048576 || !Number.isSafeInteger(encoded.nodes) || encoded.nodes < 1 || encoded.nodes > 4000000) throw journalError('checkpoint-encoding-invalid', 'The canonical checkpoint encoder returned an incompatible result.');
    const release = () => { if (released) return retirement.getReceipt(); released = true; encoded = null;
      return retirement.retire([...(job ? [{ name: 'checkpoint-worker-result', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw journalError('checkpoint-retirement-unknown', 'The checkpoint worker result remains charged.'); } }] : []), ...(storage ? [{ name: 'checkpoint-encoding-storage', run: () => storage.release() }] : [])]); };
    return Object.freeze({ read: () => { if (released) throw journalError('checkpoint-retired', 'The canonical checkpoint encoding has retired.'); return encoded; }, release });
  } catch (error) { const receipt = retirement.retire([...(job ? [{ name: 'failed-checkpoint-worker', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw new Error('Failed checkpoint worker retirement is unresolved.'); } }] : []), ...(storage ? [{ name: 'failed-checkpoint-storage', run: () => storage.release() }] : [])]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
