import { backgroundJobService } from '../../resources/BackgroundJobService.js';
import { journalError, cloneJournalData, canonicalJournalText, hashJournalData } from './CausalJournalCanonical.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

const MAX_BYTES = 32 * 1048576, MAX_NODES = 4000000;
let nextOwner = 0;
const ownedSource = handle => {
  let released = false, releaseError = null;
  return Object.freeze({ get value() { if (released) throw journalError('source-retired', 'The causal source reader has retired.'); return handle.value; },
    receipt: handle.receipt, signal: handle.signal, retirementState: handle.retirementState,
    release() {
      if (released) { if (releaseError) throw releaseError; return false; } released = true;
      releaseError = journalError('source-retirement-unknown', 'Causal source result ownership remains unresolved.');
      try { handle.release(); if (!['released', 'canceled'].includes(handle.retirementState().phase)) throw releaseError; }
      catch (error) { releaseError = error; throw error; }
      releaseError = null; return true;
    } });
};
export function createCausalSourceJobs({ storage, resourceBudget, jobs = backgroundJobService, maxChunkBytes = 4194304, maxChunkRecords = 64 } = {}) {
  if (!storage?.loadCausalChunk || !storage?.loadCausalCheckpoint || !resourceBudget?.reserve || !resourceBudget?.release || !jobs?.compute)
    throw new TypeError('Causal source jobs require shared storage and resource ownership.');
  const ownerId = 'causal-source-reader-' + (++nextOwner); let ordinal = 0;
  const proofs = new Map(), proofWork = new Set(); let proofBytes = 0, proofReservation = null, proofEpoch = 0, proofClosing = false, proofRelease = null;
  const rememberProof = (ref, metadata, epoch) => {
    if (proofClosing || epoch !== proofEpoch || metadata?.kind !== 'chunk' || !/^[a-f0-9]{64}$/.test(metadata.previousHash)) return;
    const reference = canonicalJournalText(ref, { maxBytes: 16384, maxNodes: 4096 }).text;
    if (proofs.has(reference)) { const entry = proofs.get(reference); proofs.delete(reference); proofs.set(reference, entry); return; }
    const proof = Object.freeze({ reference, bytes: metadata.bytes, nodes: metadata.nodes, previousHash: metadata.previousHash, maxRecords: maxChunkRecords });
    const encoded = canonicalJournalText(proof, { maxBytes: 65536, maxNodes: 4096 }), bytes = encoded.bytes.length * 2 + encoded.nodes * 64 + reference.length * 2 + 256;
    if (bytes > 4 * 1048576 || proofReservation && !proofReservation.isActive()) return;
    try { proofReservation ||= createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId + '-proofs', kind: 'canonical-source-proofs', bytes: 4 * 1048576 + 4096 }); }
    catch { return; }
    while (proofs.size && (proofs.size >= 4096 || proofBytes + bytes > 4 * 1048576)) {
      const key = proofs.keys().next().value; proofBytes -= proofs.get(key).bytes; proofs.delete(key);
    }
    proofs.set(reference, { proof, bytes }); proofBytes += bytes;
  };
  const releaseProofs = () => {
    if (proofRelease) return proofRelease; proofEpoch++; proofClosing = true;
    proofRelease = Promise.allSettled([...proofWork]).then(() => {
      proofs.clear(); proofBytes = 0; proofReservation?.release(); proofReservation = null; proofClosing = false; proofRelease = null;
    });
    return proofRelease;
  };
  const knownProof = reference => !proofClosing && proofReservation?.isActive() ? proofs.get(reference)?.proof || null : null;
  const read = async (kind, ref, { signal, metadataOnly = false, selection = null } = {}) => {
    signal?.throwIfAborted();
    const maximum = kind === 'chunk' ? maxChunkBytes + 4096 : MAX_BYTES;
    const bytes = ref?.bytes ?? maximum, nodes = ref?.nodes ?? Math.min(MAX_NODES, Math.ceil(bytes / 2) + 1);
    if (!['chunk', 'checkpoint'].includes(kind) || typeof ref?.id !== 'string' || !ref.id || ref.id.length > 256 || !/^[a-f0-9]{64}$/.test(ref.hash) ||
        !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximum || !Number.isSafeInteger(nodes) || nodes < 1 || nodes > MAX_NODES)
      throw journalError('invalid-source-inventory', 'Causal source has no admissible byte and object bounds.');
    const referenceInventory = canonicalJournalText(ref, { maxBytes: 16384, maxNodes: 4096 });
    const selectionInventory = canonicalJournalText(selection, { maxBytes: 16384, maxNodes: 4096 });
    const proof = kind === 'chunk' ? knownProof(referenceInventory.text) : null, proofInventory = canonicalJournalText(proof, { maxBytes: 65536, maxNodes: 4096 });
    const metadataBytes = referenceInventory.bytes.byteLength + selectionInventory.bytes.byteLength + proofInventory.bytes.byteLength;
    const estimatedPeakBytes = Math.max(131072, (bytes + metadataBytes) * 12 + (nodes + referenceInventory.nodes + selectionInventory.nodes + proofInventory.nodes) * 192 + 65536);
    if (estimatedPeakBytes > 512 * 1048576) throw journalError('source-capacity', 'This causal source requires a larger qualified memory profile.');
    if (ordinal === Number.MAX_SAFE_INTEGER) throw journalError('source-identity-exhausted', 'Causal source reader identity is exhausted.');
    const reference = cloneJournalData(ref, { maxBytes: 16384, maxNodes: 4096 }), selected = selection == null ? null : cloneJournalData(selection, { maxBytes: 16384, maxNodes: 4096 });
    const handle = await jobs.compute({ kind: 'verify-causal-source', ownerId, ownerEpoch: ++ordinal,
      sourceRevision: reference.hash, inputBytes: bytes + metadataBytes, estimatedPeakBytes, budgetAdapter: resourceBudget, signal, maxBytes: bytes + metadataBytes + 4096,
      priority: metadataOnly ? 'background' : 'interactive',
      prepareInput: async ({ signal: ownedSignal }) => {
        const record = await (kind === 'chunk' ? storage.loadCausalChunk(reference.id, { signal: ownedSignal, maxCanonicalBytes: bytes }) :
          storage.loadCausalCheckpoint(reference.id, { signal: ownedSignal, maxCanonicalBytes: bytes }));
        ownedSignal.throwIfAborted();
        if (!record || typeof record.canonical !== 'string' || record.canonical.length > bytes)
          throw journalError(kind === 'chunk' ? 'missing-chunk' : 'checkpoint-mismatch', 'The admitted causal source is missing or exceeds its byte inventory.');
        return { kind, ref: reference, canonical: record.canonical, metadataOnly, maxRecords: maxChunkRecords, selection: selected, proof };
      }
    });
    return ownedSource(handle);
  };
  const readWindow = async (refs, index, { signal, selection = null, maximumRefs = 16 } = {}) => {
    signal?.throwIfAborted(); const window = [], windowProofs = []; let bytes = 0, nodes = 0, metadataBytes = 0, records = 0;
    for (let next = index; next < refs.length && window.length < Math.min(16, maximumRefs); next++) {
      if (selection && records > selection.limit) break;
      const ref = refs[next], size = ref?.bytes, count = ref?.nodes;
      if (!Number.isSafeInteger(size) || size < 1 || size > maxChunkBytes + 4096 || !Number.isSafeInteger(count) || count < 1 || count > MAX_NODES ||
            size + bytes > 4 * 1048576 || count + nodes > 500000) break;
      const inventory = canonicalJournalText(ref, { maxBytes: 16384, maxNodes: 4096 });
      const proof = knownProof(inventory.text), proofInventory = canonicalJournalText(proof, { maxBytes: 65536, maxNodes: 4096 });
      const copy = cloneJournalData(ref, { maxBytes: 16384, maxNodes: 4096 });
      window.push(copy); windowProofs.push(proof); bytes += size; nodes += count + inventory.nodes + proofInventory.nodes; metadataBytes += inventory.bytes.byteLength + proofInventory.bytes.byteLength; records += ref.lastSequence - ref.firstSequence + 1;
    }
    if (window.length < 2) {
      const ref = refs[index], source = await read('chunk', ref, { signal, metadataOnly: !selection,
        selection: selection ? { ...selection, throughSequence: Math.min(selection.throughSequence, ref.throughSequence ?? ref.lastSequence) } : null });
      return { refs: [ref], source, batched: false };
    }
    const selected = selection ? cloneJournalData(selection, { maxBytes: 16384, maxNodes: 4096 }) : null;
    if (selected) { const inventory = canonicalJournalText(selected); metadataBytes += inventory.bytes.byteLength; nodes += inventory.nodes; }
    if (ordinal === Number.MAX_SAFE_INTEGER) throw journalError('source-identity-exhausted', 'Causal source reader identity is exhausted.');
    let handle;
    try { handle = await jobs.compute({ kind: 'verify-causal-sources', ownerId, ownerEpoch: ++ordinal,
      sourceRevision: await hashJournalData(window, { maxBytes: 262144, maxNodes: 8192 }), inputBytes: bytes + metadataBytes + 4096,
      estimatedPeakBytes: (bytes + metadataBytes) * 12 + nodes * 192 + 131072, budgetAdapter: resourceBudget, signal,
      maxBytes: bytes + metadataBytes + 4096, priority: selected ? 'interactive' : 'background', prepareInput: async ({ signal: ownedSignal }) => {
        const sources = [];
        for (const ref of window) {
          ownedSignal.throwIfAborted(); const record = await storage.loadCausalChunk(ref.id, { signal: ownedSignal, maxCanonicalBytes: ref.bytes });
          ownedSignal.throwIfAborted();
          if (typeof record?.canonical !== 'string' || record.canonical.length > ref.bytes) throw journalError('missing-chunk', 'The admitted causal source is missing or exceeds its byte inventory.', { sourceId: ref.id, firstSequence: ref.firstSequence });
          sources.push({ kind: 'chunk', ref, canonical: record.canonical, metadataOnly: !selected, maxRecords: maxChunkRecords, selection: null,
            proof: windowProofs[sources.length] });
        }
        return { sources, selection: selected };
      } }); }
    catch (error) {
      if (error?.name === 'ResourceBudgetError' && window.length > 1) return readWindow(refs, index, { signal, selection, maximumRefs: Math.max(1, Math.floor(window.length / 2)) });
      throw error;
    }
    const source = ownedSource(handle);
    return { refs: window, source, batched: true };
  };
  const inspectChunks = async function*(refs, { signal, onProgress = () => {} } = {}) {
    if (refs.length && refs.length <= 4096 && maxChunkBytes <= 16 * 1048576 && storage.openCausalWorkerSource && refs.every(ref => typeof ref.id === 'string' && ref.id.length <= 256 && /^[a-f0-9]{64}$/.test(ref.hash) &&
      Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= maxChunkBytes + 4096 && Number.isSafeInteger(ref.nodes) && ref.nodes > 0 && ref.nodes <= MAX_NODES)) {
      signal?.throwIfAborted(); const owner = await storage.openCausalWorkerSource(), controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason || owner.signal.reason);
      signal?.addEventListener('abort', cancel, { once: true }); owner.signal.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted || owner.signal.aborted) cancel();
      const epoch = proofEpoch; let finishWork;
      const work = new Promise(resolve => { finishWork = resolve; }); proofWork.add(work);
      let source = null;
      try {
        let known = proofClosing ? null : refs.map(ref => proofs.get(canonicalJournalText(ref, { maxBytes: 16384, maxNodes: 4096 }).text)?.proof || null);
        let input = { refs, maxRecords: maxChunkRecords, maxChunkBytes, proofs: known }, inventory;
        try { inventory = canonicalJournalText(input, { maxBytes: 8 * 1048576, maxNodes: 200000 }); }
        catch (error) {
          if (!known?.some(Boolean)) throw error;
          known = null; input = { refs, maxRecords: maxChunkRecords, maxChunkBytes, proofs: null };
          inventory = canonicalJournalText(input, { maxBytes: 8 * 1048576, maxNodes: 200000 });
        }
        const peak = Math.max(...refs.map(ref => ref.bytes * 12 + ref.nodes * 192 + 65536));
        const estimatedPeakBytes = peak + inventory.bytes.length * 8 + inventory.nodes * 128 + refs.length * 16384 + 131072;
        if (estimatedPeakBytes > 512 * 1048576) throw journalError('source-capacity', 'Stored causal source verification exceeds its qualified workspace.');
        if (ordinal === Number.MAX_SAFE_INTEGER) throw journalError('source-identity-exhausted', 'Causal source reader identity is exhausted.');
        source = ownedSource(await jobs.compute({ kind: 'verify-stored-causal-sources', ownerId, ownerEpoch: ++ordinal,
          sourceRevision: await hashJournalData(input, { maxBytes: 8 * 1048576, maxNodes: 200000 }), inputBytes: inventory.bytes.length,
          estimatedPeakBytes, budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !owner.signal.aborted && (!owner.isCurrent || owner.isCurrent()),
          maxBytes: Math.max(maxChunkBytes + 4096, inventory.bytes.length + 4096), priority: 'background',
          onProgress(value) { if (value?.phase === 'verifying' && Number.isSafeInteger(value.completedUnits)) onProgress({ phase: 'verifying', completedChunks: value.completedUnits, totalChunks: value.totalUnits }); },
          prepareInput: async ({ signal: ownedSignal }) => { ownedSignal.throwIfAborted(); return input; } }));
        input = null; known = null; inventory = null;
        for (let index = 0; index < refs.length; index++) { controller.signal.throwIfAborted();
          if (owner.isCurrent && !owner.isCurrent()) throw journalError('stale-source', 'The stored causal source connection changed.');
          rememberProof(refs[index], source.value[index], epoch);
          yield { ref: refs[index], metadata: source.value[index] };
        }
      } finally {
        signal?.removeEventListener('abort', cancel); owner.signal.removeEventListener('abort', cancel);
        try { source?.release(); } finally { proofWork.delete(work); finishWork(); }
      }
      return;
    }
    for (let index = 0; index < refs.length;) {
      const window = await readWindow(refs, index, { signal }), source = window.source;
      try {
        for (let offset = 0; offset < window.refs.length; offset++) { signal?.throwIfAborted(); yield { ref: window.refs[offset], metadata: window.batched ? source.value[offset] : source.value }; }
      } finally { source.release(); }
      index += window.refs.length;
    }
  };
  return Object.freeze({ read, readWindow, inspectChunks, releaseProofs });
}
