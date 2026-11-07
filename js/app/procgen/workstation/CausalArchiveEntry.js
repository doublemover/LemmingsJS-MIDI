import { canonicalJournalText, journalError } from './CausalJournalCanonical.js';
import { verifyManifestHashes } from './CausalJournalValidation.js';

const RECORD_KINDS = new Set(['physical-batch', 'musical-intents', 'intervention', 'input-observation', 'timeline', 'mapping', 'sink-outcome', 'marker']);
export function validateCausalChunk(body, ref, maxRecords = 1024) {
  const fail = () => { throw journalError('corrupt-chunk', 'A causal take chunk has inconsistent sequence metadata.', { chunkId: ref?.id }); };
  if (!ref || !body || body.version !== 1 || body.takeId !== ref.takeId || body.ordinal !== ref.ordinal || body.firstSequence !== ref.firstSequence || body.lastSequence !== ref.lastSequence ||
      !Number.isSafeInteger(body.firstSequence) || body.firstSequence < 1 || !Array.isArray(body.records) || !body.records.length || body.records.length > maxRecords ||
      body.lastSequence !== body.firstSequence + body.records.length - 1) fail();
  let firstTick = Infinity, lastTick = -Infinity; const generations = new Set(), kinds = new Set();
  for (let index = 0; index < body.records.length; index++) {
    const record = body.records[index];
    if (!record || record.sequence !== body.firstSequence + index || !RECORD_KINDS.has(record.kind) || !Number.isSafeInteger(record.tick) || record.tick < 0 ||
        !Number.isSafeInteger(record.generation) || record.generation < 0) fail();
    firstTick = Math.min(firstTick, record.tick); lastTick = Math.max(lastTick, record.tick); generations.add(record.generation); kinds.add(record.kind);
  }
  if (ref.firstTick !== firstTick || ref.lastTick !== lastTick || !Array.isArray(ref.generations) ||
      canonicalJournalText(ref.generations).text !== canonicalJournalText([...generations]).text ||
      ref.kinds && canonicalJournalText(ref.kinds).text !== canonicalJournalText([...kinds]).text) fail();
}

export async function inspectCausalArchiveEntry(entry, { parse, hash, signal } = {}) {
  const fail = message => { throw new Error('Causal archive ' + message); };
  const keys = allowed => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object' || Object.keys(entry).some(key => !allowed.includes(key))) fail('entry has unsupported fields.');
  };
  signal?.throwIfAborted();
  if (entry?.kind === 'manifest') {
    keys(['schema', 'kind', 'manifest']);
    if (entry.schema !== 'lemmings-causal-take-archive/v1' || !['finalized', 'partial'].includes(entry.manifest?.state)) fail('has no finalized versioned manifest.');
    await verifyManifestHashes(entry.manifest); signal?.throwIfAborted();
    return entry;
  }
  if (entry?.kind === 'checkpoint' || entry?.kind === 'chunk') {
    keys(['kind', 'ref', 'canonical']);
    if (!entry.ref || typeof entry.ref.id !== 'string' || typeof entry.ref.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.ref.hash) || typeof entry.canonical !== 'string') fail('record has an invalid source reference.');
    canonicalJournalText(entry.ref, { maxBytes: 16384 });
    const checked = await hash(entry.canonical); signal?.throwIfAborted();
    if (checked.hash !== entry.ref.hash || entry.ref.bytes != null && checked.bytes !== entry.ref.bytes) fail('record hash or byte inventory is corrupt.');
    const body = await parse(entry.canonical); signal?.throwIfAborted();
    if (entry.kind === 'chunk') {
      validateCausalChunk(body, entry.ref);
      return { kind: entry.kind, ref: entry.ref, body: { previousHash: body.previousHash, firstSequence: body.firstSequence, lastSequence: body.lastSequence } };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('checkpoint is not an object snapshot.');
    return { kind: entry.kind, ref: entry.ref };
  }
  if (entry?.kind === 'end') {
    keys(['kind', 'takeId', 'revision', 'canonicalHash', 'finalizationHash', 'checkpoints', 'chunks']);
    return entry;
  }
  fail('entry kind is unsupported.');
}
