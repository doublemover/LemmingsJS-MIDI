import { canonicalDataText, encodeUtf8, hashDataText } from '../../../core/CanonicalData.js';
import { RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION } from '../../../runtime/BrowserGenerationPins.js';

const failure = message => Object.assign(new Error(message), { code: 'source-storage-unavailable' });
const openReader = async signal => {
  if (!globalThis.indexedDB?.open) throw failure('This worker cannot read the stored causal source.');
  const database = await new Promise((resolve, reject) => {
    let settled = false; const request = indexedDB.open(RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION);
    const fail = error => { if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); reject(error); };
    const cancel = () => fail(signal?.reason || failure('Causal source opening canceled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    request.onupgradeneeded = () => { request.transaction?.abort(); fail(failure('The causal source database must already exist at its supported version.')); };
    request.onblocked = () => fail(failure('The causal source database is blocked by a schema transition.'));
    request.onerror = () => fail(failure('The causal source database could not be opened.'));
    request.onsuccess = () => {
      if (settled || signal?.aborted) { request.result.close(); cancel(); return; }
      settled = true; signal?.removeEventListener('abort', cancel); request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    if (signal?.aborted) cancel();
  });
  return { close: () => database.close(), read: ref => new Promise((resolve, reject) => {
    signal?.throwIfAborted(); let value, aborted = null;
    const transaction = database.transaction('takeChunks', 'readonly'), request = transaction.objectStore('takeChunks').get(ref.id);
    const cancel = () => { aborted = signal?.reason || failure('Causal source read canceled.'); try { transaction.abort(); } catch { /* Completion owns the terminal result. */ } };
    signal?.addEventListener('abort', cancel, { once: true });
    request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => { signal?.removeEventListener('abort', cancel); resolve(value); };
    transaction.onabort = () => { signal?.removeEventListener('abort', cancel); reject(aborted || failure('Causal source read failed.')); };
    if (signal?.aborted) cancel();
  }) };
};

export async function verifyStoredCausalSources(input, { verifySource, signal, current, estimatedPeakBytes,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, createReader = openReader, crypto = globalThis.crypto } = {}) {
  const check = () => { signal?.throwIfAborted(); if (current && !current()) throw failure('The stored source owner changed.'); };
  check();
  if (typeof verifySource !== 'function' || typeof yieldControl !== 'function' || typeof onProgress !== 'function' || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576)
    throw failure('Stored causal verification requires its admitted worker contract.');
  if (!input || Object.keys(input).some(key => !['refs', 'maxRecords', 'maxChunkBytes', 'proofs'].includes(key)) || !Array.isArray(input.refs) || !input.refs.length || input.refs.length > 4096 ||
      input.proofs != null && (!Array.isArray(input.proofs) || input.proofs.length !== input.refs.length) ||
      !Number.isSafeInteger(input.maxRecords) || input.maxRecords < 1 || input.maxRecords > 1024 || !Number.isSafeInteger(input.maxChunkBytes) || input.maxChunkBytes < 1 || input.maxChunkBytes > 16 * 1048576)
    throw failure('Invalid bounded stored-source verification inventory.');
  const inventory = canonicalDataText(input, { maxBytes: 8 * 1048576, maxNodes: 200000 });
  let peak = 0;
  for (const ref of input.refs) {
    if (typeof ref?.id !== 'string' || !ref.id || ref.id.length > 256 || !/^[a-f0-9]{64}$/.test(ref.hash) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > input.maxChunkBytes + 4096 ||
        !Number.isSafeInteger(ref.nodes) || ref.nodes < 1 || ref.nodes > 4000000) throw failure('Stored causal source has no bounded object inventory.');
    peak = Math.max(peak, ref.bytes * 12 + ref.nodes * 192 + 65536);
  }
  if (peak + inventory.bytes.length * 4 + inventory.nodes * 64 + input.refs.length * 4096 > estimatedPeakBytes) throw failure('Stored causal source exceeds its admitted verification workspace.');
  const reader = await createReader(signal), value = [];
  try {
    check();
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index];
      try {
        check(); const stored = await reader.read(ref); check();
        if (typeof stored?.canonical !== 'string' || stored.canonical.length > ref.bytes) throw Object.assign(new Error('A stored causal chunk is missing or exceeds its byte inventory.'), { code: 'missing-chunk' });
        const proof = input.proofs?.[index];
        // Only the reader's private owned cache supplies prior canonical proofs.
        // Rehash the current bytes even when their decoded inventory is known.
        if (proof && proof.reference === canonicalDataText(ref, { maxBytes: 16384, maxNodes: 4096 }).text && proof.maxRecords === input.maxRecords && proof.bytes === ref.bytes && proof.nodes === ref.nodes && /^[a-f0-9]{64}$/.test(proof.previousHash)) {
          if (encodeUtf8(stored.canonical).length !== ref.bytes || await hashDataText(stored.canonical, crypto) !== ref.hash) throw Object.assign(new Error('Stored causal bytes differ from their previously validated canonical proof.'), { code: 'content-mismatch' });
          value.push({ kind: 'chunk', ref, bytes: ref.bytes, nodes: ref.nodes, previousHash: proof.previousHash, firstSequence: ref.firstSequence, lastSequence: ref.lastSequence });
        } else {
          const verified = await verifySource({ kind: 'chunk', ref, canonical: stored.canonical, metadataOnly: true, selection: null, maxRecords: input.maxRecords });
          value.push(verified.value);
        }
      } catch (error) { error.sourceId = ref.id; error.firstSequence = ref.firstSequence; throw error; }
      if (value.length % 16 === 0 || value.length === input.refs.length) onProgress({ phase: 'verifying', completedUnits: value.length, totalUnits: input.refs.length });
      await yieldControl();
    }
    check(); const retained = canonicalDataText(value, { maxBytes: 8 * 1048576, maxNodes: 200000 });
    return { value, inputBytes: inventory.bytes.length, nodes: inventory.nodes, retainedBytes: retained.bytes.length * 2 + retained.nodes * 64 + 4096 };
  } finally { reader.close(); }
}
