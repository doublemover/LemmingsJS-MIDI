import { prepareReplayableExportArtifact } from '../../export/ExportArtifact.js';
import { canonicalJournalText, cloneJournalData, freezeJournalData } from './CausalJournalCanonical.js';
import { readOwnedNdjsonLines } from '../../resources/OwnedNdjsonReader.js';
import { encodeOwnedJsonLine } from '../../resources/OwnedJsonByteStream.js';
import { backgroundJobService } from '../../resources/BackgroundJobService.js';

const ARCHIVE_SCHEMA = 'lemmings-causal-take-archive/v1';
const MAX_ARCHIVE_BYTES = 512 * 1048576;
const MAX_ARCHIVE_LINE_BYTES = 96 * 1048576;
const MAX_ARCHIVE_ENTRIES = 8192;

const uniqueRefs = refs => {
  const seen = new Map(), result = [];
  for (const ref of refs) {
    if (typeof ref?.id !== 'string' || typeof ref.hash !== 'string') throw new Error('Invalid causal archive reference.');
    const previous = seen.get(ref.id);
    if (previous) {
      if (previous.hash !== ref.hash) throw new Error('A causal archive reference has conflicting hashes.');
      continue;
    }
    seen.set(ref.id, ref); result.push(ref);
  }
  if (result.length > MAX_ARCHIVE_ENTRIES) throw new Error('Causal archive entry limit exceeded.');
  return result;
};

// A prepared archive names one immutable finalized take revision. Each retry
// reopens its original canonical records and checks their content hash before
// yielding bytes to the file sink. The browser cannot certify disk durability.
const prepareCausalTakeArchive = async ({ journal, storage, takeId, maxDeliveryBytes = MAX_ARCHIVE_BYTES, resourceBudget = null, jobs = backgroundJobService, signal } = {}) => {
  if (!journal?.verify || !storage?.loadCausalTake || !storage?.loadCausalCheckpoint || !storage?.loadCausalChunk ||
      !Number.isSafeInteger(maxDeliveryBytes) || maxDeliveryBytes < 1 || maxDeliveryBytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Causal take archive needs journal storage and a bounded delivery limit.');
  }
  signal?.throwIfAborted();
  await journal.verify(takeId, { signal });
  signal?.throwIfAborted();
  const raw = await journal.openTake(takeId);
  signal?.throwIfAborted();
  if (!raw || !['finalized', 'partial'].includes(raw.state) || !raw.finalizationHash)
    throw new Error('Finish the causal take before preparing its archive.');
  const manifest = cloneJournalData(raw, { maxBytes: 8 * 1048576 });
  const checkpoints = uniqueRefs([manifest.initialCheckpoint, ...(manifest.checkpoints || [])]);
  const chunks = uniqueRefs([...(manifest.prefix?.chunks || []), ...(manifest.chunks || [])]);
  if (checkpoints.length + chunks.length > MAX_ARCHIVE_ENTRIES) throw new Error('Causal archive entry limit exceeded.');
  const title = String(manifest.takeName || takeId).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'causal-take';
  const sourceRef = `causal-take:${takeId}:${manifest.revision}:${manifest.canonicalHash}`;
  const openChunks = async function*({ signal } = {}) {
    const token = {}; let held = false;
    if (resourceBudget) { resourceBudget.reserve({ token, owner: 'causal-archive-encode', category: 'export', bytes: 262144, pinned: true, reloadable: false }); held = true; }
    try {
      signal?.throwIfAborted();
      const current = await (storage.loadCausalTakeHead?.(takeId) ?? storage.loadCausalTake(takeId));
      if (current?.revision !== manifest.revision || current?.finalizationHash !== manifest.finalizationHash ||
        current?.canonicalHash !== manifest.canonicalHash) throw new Error('The prepared causal take revision changed. Prepare a new archive.');
      let total = 0;
      const emit = async function*(value) {
        for await (const bytes of encodeOwnedJsonLine(Object.freeze(value), { maxBytes: MAX_ARCHIVE_LINE_BYTES, signal })) {
          total += bytes.byteLength; if (total > maxDeliveryBytes) throw new Error('Causal archive exceeds its declared delivery limit.'); yield bytes;
        }
      };
      const readVerified = async (ref, kind) => {
        const bound = ref.bytes ?? 64 * 1048576;
        if (!Number.isSafeInteger(bound) || bound < 0 || bound > 64 * 1048576) throw new Error('Causal archive source byte inventory is unsupported.');
        let canonical = null;
        const lease = await jobs.compute({ kind: 'asset-hash', ownerId: 'causal-archive-record', ownerEpoch: manifest.revision, sourceRevision: ref.hash,
          inputBytes: bound, estimatedPeakBytes: Math.max(4096, bound * 6), maxBytes: Math.max(1, bound), expectedInputHash: ref.hash,
          retainInput: true, signal, budgetAdapter: resourceBudget, priority: 'background', prepareInput: async () => {
            const stored = await (kind === 'checkpoint' ? storage.loadCausalCheckpoint(ref.id) : storage.loadCausalChunk(ref.id));
            if (typeof stored?.canonical !== 'string') throw Object.assign(new Error('Missing causal archive source.'), { code: 'source-missing' });
            canonical = stored.canonical; return canonical;
          } }).catch(error => {
          if (['content-mismatch', 'source-missing'].includes(error.code)) throw new Error('A causal ' + kind + ' changed after archive preparation.', { cause: error }); throw error;
        });
        if (ref.bytes != null && lease.receipt.inputBytes !== ref.bytes) { canonical = null; lease.release(); throw new Error('Causal archive source byte inventory changed.'); }
        return { get canonical() { lease.value; return canonical; }, release() { canonical = null; lease.release(); } };
      };
      yield* emit({ schema: ARCHIVE_SCHEMA, kind: 'manifest', manifest });
      for (const ref of checkpoints) {
        const stored = await readVerified(ref, 'checkpoint');
        try { yield* emit({ kind: 'checkpoint', ref, canonical: stored.canonical }); } finally { stored.release(); }
      }
      for (const ref of chunks) {
        const stored = await readVerified(ref, 'chunk');
        try { yield* emit({ kind: 'chunk', ref, canonical: stored.canonical }); } finally { stored.release(); }
      }
      yield* emit({ kind: 'end', takeId, revision: manifest.revision, canonicalHash: manifest.canonicalHash,
        finalizationHash: manifest.finalizationHash, checkpoints: checkpoints.length, chunks: chunks.length });
    } finally { if (held) { const ack = resourceBudget.release({ token, owner: 'causal-archive-encode' });
      if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Causal archive encoding reservation retirement is unresolved.'); }
    } }
  };
  const artifact = prepareReplayableExportArtifact({ openChunks, immutableSourceRef: sourceRef,
    formatVersion: ARCHIVE_SCHEMA, mediaType: 'application/x-ndjson', suggestedFilename: `${title}.causal.ndjson`,
    coverageLossReportRef: manifest.complete ? null : `take:${takeId}:partial-coverage`, maxDeliveryBytes });
  return Object.freeze({ artifact, takeId, revision: manifest.revision, manifest,
    entryCounts: Object.freeze({ checkpoints: checkpoints.length, chunks: chunks.length }) });
};

// Validate a streamed archive without concatenating the entire performance.
// The caller may hand the verified records to an explicit import transaction;
// inspection alone never arms output or changes the live document.
const inspectCausalTakeArchive = async (source, { maxBytes = MAX_ARCHIVE_BYTES, resourceBudget = null, jobs = backgroundJobService, signal } = {}) => {
  if (!source?.[Symbol.asyncIterator] && !source?.[Symbol.iterator] ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARCHIVE_BYTES) throw new Error('Invalid causal archive source or byte limit.');
  let byteCount = 0, manifest = null, checkpoints = [], chunks = [], nextCheckpoint = 0, nextChunk = 0;
  let previousHash = null, previousSequence = 0, ended = false, ownedChunks = null;
  const sameRef = (left, right) => canonicalJournalText(left, { maxBytes: 16384 }).text ===
    canonicalJournalText(right, { maxBytes: 16384 }).text;
  const readEntry = entry => {
    if (ended) throw new Error('Causal archive has data after its footer.');
    if (!manifest) {
      if (entry?.schema !== ARCHIVE_SCHEMA || entry.kind !== 'manifest') throw new Error('Causal archive has no versioned manifest.');
      manifest = freezeJournalData(entry.manifest);
      if (!['finalized', 'partial'].includes(manifest.state)) throw new Error('Causal archive contains an unfinalized take.');
      checkpoints = uniqueRefs([manifest.initialCheckpoint, ...(manifest.checkpoints || [])]);
      chunks = uniqueRefs([...(manifest.prefix?.chunks || []), ...(manifest.chunks || [])]);
      ownedChunks = new Set(manifest.chunks.map(ref => ref.id));
      if (checkpoints.length + chunks.length > MAX_ARCHIVE_ENTRIES) throw new Error('Causal archive entry limit exceeded.');
      if (manifest.prefix) {
        let prefixSequence = 0;
        for (const ref of manifest.prefix.chunks) {
          const through = Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence);
          if (!Number.isSafeInteger(ref.firstSequence) || !Number.isSafeInteger(ref.lastSequence) ||
              ref.firstSequence !== prefixSequence + 1 || through < ref.firstSequence || through > ref.lastSequence)
            throw new Error('Causal archive shared prefix has a gap or overlapping source range.');
          prefixSequence = through;
        }
        if (prefixSequence !== manifest.prefix.throughSequence) throw new Error('Causal archive shared prefix is incomplete.');
      }
      previousHash = manifest.rootHash; previousSequence = manifest.prefix?.throughSequence ?? 0;
      return;
    }
    if (entry?.kind === 'checkpoint') {
      const ref = checkpoints[nextCheckpoint++];
      if (!ref || nextChunk || !sameRef(entry.ref, ref)) throw new Error('Causal archive checkpoint is missing, reordered or corrupt.');
      return;
    }
    if (entry?.kind === 'chunk') {
      const ref = chunks[nextChunk++];
      if (nextCheckpoint !== checkpoints.length || !ref || !sameRef(entry.ref, ref))
        throw new Error('Causal archive chunk is missing, reordered or corrupt.');
      const body = entry.body;
      if (ownedChunks.has(ref.id)) {
        if (body.previousHash !== previousHash || body.firstSequence !== previousSequence + 1)
          throw new Error('Causal archive owned chunk chain diverges.');
        previousHash = ref.hash; previousSequence = body.lastSequence;
      }
      return;
    }
    if (entry?.kind === 'end') {
      if (nextCheckpoint !== checkpoints.length || nextChunk !== chunks.length ||
          entry.takeId !== manifest.takeId || entry.revision !== manifest.revision ||
          entry.canonicalHash !== manifest.canonicalHash || entry.finalizationHash !== manifest.finalizationHash ||
          entry.checkpoints !== checkpoints.length || entry.chunks !== chunks.length ||
          previousHash !== manifest.canonicalHash || previousSequence !== manifest.durableSequence)
        throw new Error('Causal archive footer or durable prefix does not match its manifest.');
      ended = true; return;
    }
    throw new Error('Causal archive entry kind is unsupported.');
  };
  for await (const line of readOwnedNdjsonLines(source, { maxBytes, maxLineBytes: Math.min(maxBytes, MAX_ARCHIVE_LINE_BYTES), resourceBudget, signal })) {
    if (ended) throw new Error('Causal archive has data after its footer.');
    const peak = line.byteLength * 8 + Math.min(4000000, Math.ceil(line.byteLength / 2) + 1) * 32 + 1048576;
    if (line.byteLength > 64 * 1048576 || peak > 512 * 1048576) throw new Error('Causal archive entry exceeds shared parsing admission.');
    const lease = await jobs.compute({ kind: 'inspect-causal-archive-entry', ownerId: 'causal-archive-inspect', ownerEpoch: 0,
      sourceRevision: 'archive-line-' + line.totalBytes, inputBytes: line.byteLength, estimatedPeakBytes: Math.max(4096, peak),
      maxBytes: line.byteLength, priority: 'background', budgetAdapter: resourceBudget, signal, prepareInput: () => {
        try { return line.takeText(); } finally { line.release(); }
      } });
    try { readEntry(lease.value); byteCount = line.totalBytes; } finally { lease.release(); }
  }
  if (!ended) throw new Error('Causal archive ended before its verified footer.');
  return Object.freeze({ schema: ARCHIVE_SCHEMA, takeId: manifest.takeId, takeName: manifest.takeName,
    revision: manifest.revision, complete: manifest.complete, canonicalHash: manifest.canonicalHash,
    coverage: manifest.coverage, checkpoints: checkpoints.length, chunks: chunks.length, bytes: byteCount,
    inspection: Object.freeze({ paused: true, recording: false, hardware: false, thru: false }) });
};

export { ARCHIVE_SCHEMA, prepareCausalTakeArchive, inspectCausalTakeArchive };
