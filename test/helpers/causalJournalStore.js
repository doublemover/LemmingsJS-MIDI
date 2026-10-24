import { canonicalJournalText, journalError } from '../../js/app/procgen/workstation/CausalJournalCanonical.js';
import { causalTakeHead, prepareCausalCommit, validateCausalExtension } from '../../js/app/procgen/workstation/CausalJournalLayout.js';

const createMemoryCausalStore = () => {
  const manifests = new Map(), chunks = new Map(), checkpoints = new Map(), commitHashes = new Map();
  const control = { failNext: false, loseNextReceipt: false, commits: 0, indexReferences: 0, metadataBytes: 0, manifestReads: 0, headReads: 0 };
  const storage = {
    causalIndexVersion: 2,
    async commitCausalTake(input) {
      const update = await prepareCausalCommit(input), { takeId, head, header, chunk, checkpoint, chunkRef, checkpointRef, commitId, contentHash } = update;
      const current = manifests.get(takeId);
      if (current?.lastCommitId === commitId) {
        if (commitHashes.get(takeId) !== contentHash) throw journalError('commit-conflict', 'Commit content changed.');
        return { repeated: true, revision: current.revision };
      }
      if (control.failNext) { control.failNext = false; throw Object.assign(new Error('Injected quota failure'), { name: 'QuotaExceededError' }); }
      validateCausalExtension(current ? causalTakeHead(current) : null, update);
      if (chunk && chunks.has(chunk.id) || checkpoint && checkpoints.has(checkpoint.id)) throw new Error('Immutable journal record already exists.');
      if (chunk) chunks.set(chunk.id, structuredClone(chunk));
      if (checkpoint) checkpoints.set(checkpoint.id, structuredClone(checkpoint));
      const next = current || { ...structuredClone(header), chunks: [], checkpoints: [] };
      Object.assign(next, structuredClone(head));
      if (chunkRef) next.chunks.push(structuredClone(chunkRef));
      if (checkpointRef) next.checkpoints.push(structuredClone(checkpointRef));
      manifests.set(takeId, next); commitHashes.set(takeId, contentHash); control.commits++;
      control.indexReferences += (chunkRef ? 1 : 0) + (checkpointRef ? 1 : 0);
      control.metadataBytes += canonicalJournalText({ head, header: header ?? null, chunkRef: chunkRef ?? null, checkpointRef: checkpointRef ?? null }).bytes.length;
      if (control.loseNextReceipt) { control.loseNextReceipt = false; throw new Error('Commit receipt lost.'); }
      return { repeated: false, revision: head.revision, contentHash };
    },
    async loadCausalTake(id) { control.manifestReads++; return manifests.has(id) ? structuredClone(manifests.get(id)) : null; },
    async loadCausalTakeHead(id) { control.headReads++; return manifests.has(id) ? { ...structuredClone(causalTakeHead(manifests.get(id))), contentHash: commitHashes.get(id) } : null; },
    async loadCausalChunk(id) { return chunks.has(id) ? structuredClone(chunks.get(id)) : null; },
    async loadCausalCheckpoint(id) { return checkpoints.has(id) ? structuredClone(checkpoints.get(id)) : null; }
  };
  return { storage, manifests, chunks, checkpoints, control };
};

export { createMemoryCausalStore };
