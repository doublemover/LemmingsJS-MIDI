import { prepareReplayableExportArtifact } from '../../export/ExportArtifact.js';
import { canonicalJournalText, cloneJournalData, hashJournalText } from './CausalJournalCanonical.js';
import { verifyManifestHashes } from './ProcgenCausalJournal.js';

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

const encodeLine = value => {
  const text = JSON.stringify(value) + '\n';
  if (text.length > MAX_ARCHIVE_LINE_BYTES) throw new Error('Causal archive entry exceeds its size limit.');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_ARCHIVE_LINE_BYTES) throw new Error('Causal archive entry exceeds its size limit.');
  return bytes;
};

// A prepared archive names one immutable finalized take revision. Each retry
// reopens its original canonical records and checks their content hash before
// yielding bytes to the file sink. The browser cannot certify disk durability.
const prepareCausalTakeArchive = async ({ journal, storage, takeId, maxDeliveryBytes = MAX_ARCHIVE_BYTES } = {}) => {
  if (!journal?.verify || !storage?.loadCausalTake || !storage?.loadCausalCheckpoint || !storage?.loadCausalChunk ||
      !Number.isSafeInteger(maxDeliveryBytes) || maxDeliveryBytes < 1 || maxDeliveryBytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Causal take archive needs journal storage and a bounded delivery limit.');
  }
  await journal.verify(takeId);
  const raw = await journal.openTake(takeId);
  if (!raw || !['finalized', 'partial'].includes(raw.state) || !raw.finalizationHash)
    throw new Error('Finish the causal take before preparing its archive.');
  const manifest = cloneJournalData(raw, { maxBytes: 8 * 1048576 });
  const checkpoints = uniqueRefs([manifest.initialCheckpoint, ...(manifest.checkpoints || [])]);
  const chunks = uniqueRefs([...(manifest.prefix?.chunks || []), ...(manifest.chunks || [])]);
  if (checkpoints.length + chunks.length > MAX_ARCHIVE_ENTRIES) throw new Error('Causal archive entry limit exceeded.');
  const title = String(manifest.takeName || takeId).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'causal-take';
  const sourceRef = `causal-take:${takeId}:${manifest.revision}:${manifest.canonicalHash}`;
  const openChunks = async function*() {
    const current = await (storage.loadCausalTakeHead?.(takeId) ?? storage.loadCausalTake(takeId));
    if (current?.revision !== manifest.revision || current?.finalizationHash !== manifest.finalizationHash ||
        current?.canonicalHash !== manifest.canonicalHash) throw new Error('The prepared causal take revision changed. Prepare a new archive.');
    let total = 0;
    const emit = value => {
      const bytes = encodeLine(value);
      total += bytes.byteLength;
      if (total > maxDeliveryBytes) throw new Error('Causal archive exceeds its declared delivery limit.');
      return bytes;
    };
    yield emit({ schema: ARCHIVE_SCHEMA, kind: 'manifest', manifest });
    for (const ref of checkpoints) {
      const stored = await storage.loadCausalCheckpoint(ref.id);
      if (typeof stored?.canonical !== 'string' || await hashJournalText(stored.canonical) !== ref.hash)
        throw new Error('A causal checkpoint changed after archive preparation.');
      yield emit({ kind: 'checkpoint', ref, canonical: stored.canonical });
    }
    for (const ref of chunks) {
      const stored = await storage.loadCausalChunk(ref.id);
      if (typeof stored?.canonical !== 'string' || await hashJournalText(stored.canonical) !== ref.hash)
        throw new Error('A causal chunk changed after archive preparation.');
      yield emit({ kind: 'chunk', ref, canonical: stored.canonical });
    }
    yield emit({ kind: 'end', takeId, revision: manifest.revision, canonicalHash: manifest.canonicalHash,
      finalizationHash: manifest.finalizationHash, checkpoints: checkpoints.length, chunks: chunks.length });
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
const inspectCausalTakeArchive = async (source, { maxBytes = MAX_ARCHIVE_BYTES } = {}) => {
  if (!source?.[Symbol.asyncIterator] && !source?.[Symbol.iterator] ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARCHIVE_BYTES) throw new Error('Invalid causal archive source or byte limit.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let carry = '', byteCount = 0, manifest = null, checkpoints = [], chunks = [], nextCheckpoint = 0, nextChunk = 0;
  let previousHash = null, previousSequence = 0, ended = false;
  const sameRef = (left, right) => canonicalJournalText(left, { maxBytes: 16384 }).text ===
    canonicalJournalText(right, { maxBytes: 16384 }).text;
  const readLine = async line => {
    if (ended) throw new Error('Causal archive has data after its footer.');
    let entry;
    try { entry = JSON.parse(line); } catch { throw new Error('Causal archive has invalid JSON.'); }
    if (!manifest) {
      if (entry?.schema !== ARCHIVE_SCHEMA || entry.kind !== 'manifest') throw new Error('Causal archive has no versioned manifest.');
      manifest = cloneJournalData(entry.manifest, { maxBytes: 8 * 1048576 });
      if (!['finalized', 'partial'].includes(manifest.state)) throw new Error('Causal archive contains an unfinalized take.');
      await verifyManifestHashes(manifest);
      checkpoints = uniqueRefs([manifest.initialCheckpoint, ...(manifest.checkpoints || [])]);
      chunks = uniqueRefs([...(manifest.prefix?.chunks || []), ...(manifest.chunks || [])]);
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
      if (!ref || nextChunk || !sameRef(entry.ref, ref) || typeof entry.canonical !== 'string' ||
          await hashJournalText(entry.canonical) !== ref.hash) throw new Error('Causal archive checkpoint is missing, reordered or corrupt.');
      return;
    }
    if (entry?.kind === 'chunk') {
      const ref = chunks[nextChunk++];
      if (nextCheckpoint !== checkpoints.length || !ref || !sameRef(entry.ref, ref) ||
          typeof entry.canonical !== 'string' || await hashJournalText(entry.canonical) !== ref.hash)
        throw new Error('Causal archive chunk is missing, reordered or corrupt.');
      let body;
      try { body = JSON.parse(entry.canonical); } catch { throw new Error('Causal archive chunk is not canonical JSON.'); }
      if (body.takeId !== ref.takeId || body.ordinal !== ref.ordinal || body.firstSequence !== ref.firstSequence ||
          body.lastSequence !== ref.lastSequence || !Array.isArray(body.records) ||
          body.records.length !== ref.lastSequence - ref.firstSequence + 1) throw new Error('Causal archive chunk identity does not match its index.');
      if (manifest.chunks.some(owned => owned.id === ref.id)) {
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
  for await (const part of source) {
    if (!(part instanceof Uint8Array)) throw new Error('Causal archive source must yield bytes.');
    byteCount += part.byteLength;
    if (byteCount > maxBytes) throw new Error('Causal archive exceeds its byte limit.');
    carry += decoder.decode(part, { stream: true });
    if (carry.length > MAX_ARCHIVE_LINE_BYTES) throw new Error('Causal archive entry exceeds its size limit.');
    for (let newline = carry.indexOf('\n'); newline >= 0; newline = carry.indexOf('\n')) {
      const line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (!line) throw new Error('Causal archive has an empty entry.');
      await readLine(line);
    }
  }
  carry += decoder.decode();
  if (carry || !ended) throw new Error('Causal archive ended before its verified footer.');
  return Object.freeze({ schema: ARCHIVE_SCHEMA, takeId: manifest.takeId, takeName: manifest.takeName,
    revision: manifest.revision, complete: manifest.complete, canonicalHash: manifest.canonicalHash,
    coverage: manifest.coverage, checkpoints: checkpoints.length, chunks: chunks.length, bytes: byteCount,
    inspection: Object.freeze({ paused: true, recording: false, hardware: false, thru: false }) });
};

export { ARCHIVE_SCHEMA, prepareCausalTakeArchive, inspectCausalTakeArchive };
