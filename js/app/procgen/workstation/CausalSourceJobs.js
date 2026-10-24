import { backgroundJobService } from '../../resources/BackgroundJobService.js';
import { journalError, cloneJournalData } from './CausalJournalCanonical.js';

const MAX_BYTES = 32 * 1048576, MAX_NODES = 4000000;
export function createCausalSourceJobs({ storage, resourceBudget, jobs = backgroundJobService, maxChunkBytes = 4194304, maxChunkRecords = 64 } = {}) {
  if (!storage?.loadCausalChunk || !storage?.loadCausalCheckpoint || !resourceBudget?.reserve || !resourceBudget?.release || !jobs?.compute)
    throw new TypeError('Causal source jobs require shared storage and resource ownership.');
  let ordinal = 0;
  const read = async (kind, ref, { signal, metadataOnly = false } = {}) => {
    signal?.throwIfAborted();
    const maximum = kind === 'chunk' ? maxChunkBytes + 4096 : MAX_BYTES;
    const bytes = ref?.bytes ?? maximum, nodes = ref?.nodes ?? Math.min(MAX_NODES, Math.ceil(bytes / 2) + 1);
    if (!['chunk', 'checkpoint'].includes(kind) || typeof ref?.id !== 'string' || !ref.id || ref.id.length > 256 || !/^[a-f0-9]{64}$/.test(ref.hash) ||
        !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximum || !Number.isSafeInteger(nodes) || nodes < 1 || nodes > MAX_NODES)
      throw journalError('invalid-source-inventory', 'Causal source has no admissible byte and object bounds.');
    const estimatedPeakBytes = Math.max(131072, bytes * 12 + nodes * 192 + 65536);
    if (estimatedPeakBytes > 512 * 1048576) throw journalError('source-capacity', 'This causal source requires a larger qualified memory profile.');
    const reference = cloneJournalData(ref, { maxBytes: 16384, maxNodes: 4096 }), handle = await jobs.compute({ kind: 'verify-causal-source', ownerId: 'causal-source-reader', ownerEpoch: ++ordinal,
      sourceRevision: reference.hash, inputBytes: bytes + 16384, estimatedPeakBytes, budgetAdapter: resourceBudget, signal, maxBytes: bytes,
      priority: metadataOnly ? 'background' : 'interactive',
      prepareInput: async ({ signal: ownedSignal }) => {
        const record = await (kind === 'chunk' ? storage.loadCausalChunk(reference.id, { signal: ownedSignal, maxCanonicalBytes: bytes }) :
          storage.loadCausalCheckpoint(reference.id, { signal: ownedSignal, maxCanonicalBytes: bytes }));
        ownedSignal.throwIfAborted();
        if (!record || typeof record.canonical !== 'string' || record.canonical.length > bytes)
          throw journalError(kind === 'chunk' ? 'missing-chunk' : 'checkpoint-mismatch', 'The admitted causal source is missing or exceeds its byte inventory.');
        return { kind, ref: reference, canonical: record.canonical, metadataOnly, maxRecords: maxChunkRecords };
      }
    });
    let released = false;
    return Object.freeze({ get value() { if (released) throw journalError('source-retired', 'The causal source reader has retired.'); return handle.value; },
      receipt: handle.receipt, signal: handle.signal, retirementState: handle.retirementState,
      release() {
        if (released) return false; released = true; handle.release();
        if (!['released', 'canceled'].includes(handle.retirementState().phase)) throw journalError('source-retirement-unknown', 'Causal source result ownership remains unresolved.');
        return true;
      } });
  };
  return Object.freeze({ read });
}
