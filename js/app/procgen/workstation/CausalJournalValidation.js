import { hashJournalData, journalError } from './CausalJournalCanonical.js';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const METADATA_KEYS = ['schema', 'version', 'takeId', 'takeName', 'documentId', 'sourceVersions', 'captureProfile', 'boundaryState', 'mapping', 'assetRefs', 'prefix', 'initialCheckpoint'];
export const metadataFor = manifest => {
  const metadata = Object.fromEntries(METADATA_KEYS.map(key => [key, manifest[key]]));
  if (metadata.prefix?.version === 2) {
    const { chunks, ...lineage } = metadata.prefix; metadata.prefix = lineage;
  }
  return metadata;
};
export const finalizationEvidence = manifest => ({ canonicalHash: manifest.canonicalHash, state: manifest.state,
  complete: manifest.complete, durableSequence: manifest.durableSequence, admittedSequence: manifest.admittedSequence,
  checkpoints: manifest.checkpoints, chunks: manifest.chunks, coverage: manifest.coverage,
  stopBoundaryState: manifest.stopBoundaryState, stopReason: manifest.stopReason });
export const verifyManifestHashes = async (manifest, { maxChunks = 4096 } = {}) => {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!manifest || manifest.schema !== 'lemmings-causal-take' || manifest.version !== 1 || !id(manifest.takeId) || !id(manifest.documentId) ||
      typeof manifest.takeName !== 'string' || !manifest.takeName.trim() || manifest.takeName.length > 120 ||
      !Array.isArray(manifest.chunks) || manifest.chunks.length > maxChunks || manifest.chunkCount !== manifest.chunks.length ||
      !Array.isArray(manifest.checkpoints) || manifest.checkpoints.length > 4096 || manifest.initialCheckpoint?.sequence !== 0 ||
      !['recording', 'finalized', 'partial'].includes(manifest.state) || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1 ||
      !Number.isSafeInteger(manifest.durableSequence) || manifest.durableSequence < 0 ||
      !Number.isSafeInteger(manifest.admittedSequence) || manifest.admittedSequence < manifest.durableSequence ||
      typeof manifest.complete !== 'boolean' || manifest.complete && manifest.state !== 'finalized' ||
      !hash(manifest.rootHash) || !hash(manifest.canonicalHash) || !hash(manifest.initialCheckpoint?.hash) ||
      manifest.prefix && (!Array.isArray(manifest.prefix.chunks) || manifest.prefix.chunks.length > maxChunks ||
        !Number.isSafeInteger(manifest.prefix.throughSequence) || manifest.prefix.throughSequence < 0 || manifest.prefix.throughSequence > manifest.durableSequence)) {
    throw journalError('unsupported-take', 'Missing or unsupported causal take.');
  }
  const metadata = metadataFor(manifest);
  if (await hashJournalData(metadata, { maxBytes: 8 * 1048576 }) !== manifest.rootHash) throw journalError('metadata-divergence', 'The causal take source manifest changed.');
  if (manifest.prefix?.version === 2 && await hashJournalData(manifest.prefix.chunks, { maxBytes: 8 * 1048576 }) !== manifest.prefix.indexHash)
    throw journalError('prefix-divergence', 'The resolved causal lineage does not match its immutable range hash.');
  if (manifest.state !== 'recording' && (!hash(manifest.finalizationHash) ||
      await hashJournalData(finalizationEvidence(manifest), { maxBytes: 8 * 1048576 }) !== manifest.finalizationHash)) {
    throw journalError('finalization-divergence', 'The causal take finalization evidence changed.');
  }
  return Object.freeze({ takeId: manifest.takeId, rootHash: manifest.rootHash, canonicalHash: manifest.canonicalHash,
    effectiveStatus: manifest.state === 'finalized' && manifest.complete ? 'complete' : 'partial' });
};
