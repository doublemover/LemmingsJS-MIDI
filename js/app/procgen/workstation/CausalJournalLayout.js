import { canonicalJournalText, cloneJournalData, hashJournalData, hashJournalText, journalError } from './CausalJournalCanonical.js';

export const CAUSAL_HEADER_KEYS = Object.freeze(['schema', 'version', 'takeId', 'takeName', 'documentId', 'sourceVersions',
  'captureProfile', 'boundaryState', 'mapping', 'assetRefs', 'prefix', 'initialCheckpoint', 'rootHash']);
const HEAD_KEYS = ['takeId', 'revision', 'state', 'complete', 'durableSequence', 'admittedSequence', 'chunkCount',
  'canonicalHash', 'coverage', 'lastCommitId', 'stopBoundaryState', 'stopReason', 'finalizationHash'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export const causalTakeHeader = manifest => pick(manifest, CAUSAL_HEADER_KEYS);
export const causalTakeHead = manifest => ({ ...pick(manifest, HEAD_KEYS), checkpointCount: manifest.checkpointCount ?? manifest.checkpoints.length });
export const causalTakeSummary = (header, head) => ({ id: head.takeId, takeId: head.takeId, takeName: header.takeName, documentId: header.documentId,
  revision: head.revision, state: head.state, complete: head.state === 'finalized' && head.complete === true,
  durableSequence: head.durableSequence, admittedSequence: head.admittedSequence, canonicalHash: head.canonicalHash,
  sourceRange: head.coverage?.sourceRange ? { firstTick: head.coverage.sourceRange.firstTick,
    lastTick: head.coverage.sourceRange.lastTick, worldId: head.coverage.sourceRange.worldId } : null });

export const compactCausalCommit = update => {
  if (update.head) return update;
  const { manifest, ...rest } = update;
  return { ...rest, header: update.expectedRevision === 0 ? causalTakeHeader(manifest) : null, head: causalTakeHead(manifest),
    chunkRef: update.chunkRef ?? (update.chunk ? manifest.chunks.at(-1) : null),
    checkpointRef: update.checkpointRef ?? (update.checkpoint ? manifest.checkpoints.at(-1) : null) };
};

export const prepareCausalCommit = async update => {
  const compact = compactCausalCommit(update);
  const value = { ...compact, head: cloneJournalData(compact.head, { maxBytes: 8 * 1048576 }),
    header: compact.header ? cloneJournalData(compact.header, { maxBytes: 8 * 1048576 }) : null,
    chunkRef: compact.chunkRef ? cloneJournalData(compact.chunkRef, { maxBytes: 16384 }) : null,
    checkpointRef: compact.checkpointRef ? cloneJournalData(compact.checkpointRef, { maxBytes: 16384 }) : null,
    chunk: compact.chunk ? { ...compact.chunk } : null, checkpoint: compact.checkpoint ? { ...compact.checkpoint } : null };
  const { takeId, expectedRevision, commitId, head, header, chunk, checkpoint, chunkRef, checkpointRef } = value;
  if (typeof takeId !== 'string' || !takeId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      head?.takeId !== takeId || head.revision !== expectedRevision + 1 || head.lastCommitId !== commitId ||
      typeof commitId !== 'string' || !commitId || !Number.isSafeInteger(head.chunkCount) || head.chunkCount < 0 || head.chunkCount > 65536 ||
      !Number.isSafeInteger(head.checkpointCount) || head.checkpointCount < 1 || head.checkpointCount > 4096 ||
      !Number.isSafeInteger(head.durableSequence) || head.durableSequence < 0 || !Number.isSafeInteger(head.admittedSequence) || head.admittedSequence < head.durableSequence ||
      expectedRevision === 0 && (header?.takeId !== takeId || !checkpoint) || expectedRevision !== 0 && header ||
      Boolean(chunk) !== Boolean(chunkRef) || Boolean(checkpoint) !== Boolean(checkpointRef)) throw new Error('Invalid causal journal transaction.');
  canonicalJournalText(head, { maxBytes: 8 * 1048576 });
  if (header) canonicalJournalText(header, { maxBytes: 8 * 1048576 });
  const hashes = [];
  for (const [body, ref, maxBytes] of [[chunk, chunkRef, 16 * 1048576], [checkpoint, checkpointRef, 32 * 1048576]]) if (body) {
    if (body.takeId !== takeId || body.id !== ref.id || body.hash !== ref.hash || typeof body.canonical !== 'string' ||
        body.canonical.length > maxBytes || await hashJournalText(body.canonical) !== ref.hash) throw journalError('content-conflict', 'Causal bytes do not match their immutable index.');
    hashes.push(ref.hash);
  }
  const contentHash = await hashJournalData({ takeId, expectedRevision, commitId, header: header ?? null, head,
    chunkRef: chunkRef ?? null, checkpointRef: checkpointRef ?? null, hashes }, { maxBytes: 16 * 1048576 });
  return { ...value, contentHash };
};

export const validateCausalExtension = (current, update) => {
  const { expectedRevision, head, chunk, chunkRef, checkpoint, checkpointRef, header } = update;
  if ((current?.revision || 0) !== expectedRevision || current && current.state !== 'recording') throw journalError('revision-conflict', 'Causal take changed or was already finalized.');
  if (!current && (head.chunkCount !== 0 || head.checkpointCount !== 1 || head.durableSequence !== (header.prefix?.throughSequence ?? 0)))
    throw journalError('prefix-conflict', 'A new causal take must begin at its declared immutable prefix.');
  if (chunk && (chunk.ordinal !== (current?.chunkCount || 0) + 1 || chunkRef.ordinal !== chunk.ordinal ||
      chunk.firstSequence !== (current?.durableSequence ?? header?.prefix?.throughSequence ?? 0) + 1 ||
      chunk.lastSequence !== head.durableSequence || head.chunkCount !== (current?.chunkCount || 0) + 1)) throw journalError('chunk-conflict', 'A causal chunk does not extend the durable prefix.');
  if (!chunk && current && (head.durableSequence !== current.durableSequence || head.chunkCount !== current.chunkCount)) throw journalError('prefix-conflict', 'A head-only commit cannot change the durable source prefix.');
  if (head.checkpointCount !== (current?.checkpointCount || 0) + (checkpoint ? 1 : 0) ||
      checkpoint && (checkpoint.sequence !== checkpointRef.sequence || checkpoint.sequence > head.durableSequence)) throw journalError('checkpoint-conflict', 'Invalid causal component checkpoint index.');
};
