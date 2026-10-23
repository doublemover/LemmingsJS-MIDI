import { cloneJournalData, canonicalJournalText, journalError } from '../../js/app/procgen/workstation/CausalJournalCanonical.js';

const createMemoryCausalStore = () => {
  const manifests = new Map(), chunks = new Map(), checkpoints = new Map();
  const control = { failNext: false, loseNextReceipt: false, commits: 0 };
  const storage = {
    async commitCausalTake({ takeId, expectedRevision, manifest, chunk, checkpoint, commitId }) {
      const current = manifests.get(takeId);
      if (current?.lastCommitId === commitId) {
        if (canonicalJournalText(current).text !== canonicalJournalText(manifest).text) throw journalError('commit-conflict', 'Commit content changed.');
        return { repeated: true, revision: current.revision };
      }
      if (control.failNext) { control.failNext = false; throw Object.assign(new Error('Injected quota failure'), { name: 'QuotaExceededError' }); }
      if ((current?.revision || 0) !== expectedRevision || current && current.state !== 'recording') throw journalError('revision-conflict', 'Revision mismatch.');
      if (chunk && chunks.has(chunk.id) || checkpoint && checkpoints.has(checkpoint.id)) throw new Error('Immutable journal record already exists.');
      if (chunk) chunks.set(chunk.id, structuredClone(chunk));
      if (checkpoint) checkpoints.set(checkpoint.id, structuredClone(checkpoint));
      manifests.set(takeId, structuredClone(manifest)); control.commits++;
      if (control.loseNextReceipt) { control.loseNextReceipt = false; throw new Error('Commit receipt lost.'); }
      return { repeated: false, revision: manifest.revision };
    },
    async loadCausalTake(id) { return manifests.has(id) ? structuredClone(manifests.get(id)) : null; },
    async loadCausalChunk(id) { return chunks.has(id) ? structuredClone(chunks.get(id)) : null; },
    async loadCausalCheckpoint(id) { return checkpoints.has(id) ? structuredClone(checkpoints.get(id)) : null; }
  };
  return { storage, manifests, chunks, checkpoints, control };
};

export { createMemoryCausalStore };
