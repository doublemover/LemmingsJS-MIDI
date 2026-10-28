import { metadataFor, finalizationEvidence, verifyManifestHashes } from './CausalJournalValidation.js';
import { validateCausalChunk } from './CausalArchiveEntry.js';
import { canonicalJournalText, estimateJournalBytes, cloneJournalData, freezeJournalData, hashJournalText, hashJournalData, journalError } from './CausalJournalCanonical.js';
import { compactCausalCommit, causalTakeHead } from './CausalJournalLayout.js';
import { createCausalSourceJobs } from './CausalSourceJobs.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const nameReason = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const RECORD_KINDS = new Set(['physical-batch', 'musical-intents', 'intervention', 'input-observation', 'timeline', 'mapping', 'sink-outcome', 'marker']);
const validRange = value => value && Number.isSafeInteger(value.firstSequence) && Number.isSafeInteger(value.lastSequence) &&
  value.firstSequence > 0 && value.lastSequence >= value.firstSequence;
const makeChunkId = (takeId, ordinal) => JSON.stringify([takeId, 'chunk', ordinal]);
// Match the canonical encoder's finite structural bound. The chunk envelope
// owns eight nodes in addition to its records, including the records array.
const MAX_CHUNK_NODES = 200000, CHUNK_ENVELOPE_NODES = 8;
const readAuthorities = new WeakMap();
const inspectCausalReadOwnership = (handle, resourceBudget) => {
  const authority = readAuthorities.get(handle);
  return authority?.budget === resourceBudget && resourceBudget ? Object.freeze({ active: authority.isActive(), ...authority.receipt }) : null;
};
const ownedQueryResult = (value, sources, releaseIndex, { kind = 'causal-query-page', metadataBytes = 0, resourceBudget = null } = {}) => {
  const retirement = createProcgenRetirementScope(); let released = false, releaseError = null;
  const dataBytes = sources.reduce((sum, source) => sum + (source.receipt?.retainedBytes || 0), 0);
  const receipt = Object.freeze({ kind, retainedDataBytes: dataBytes + metadataBytes, resourceAccountingEnabled: !!resourceBudget });
  const handle = Object.freeze({ get value() { if (released) throw journalError('query-retired', 'The causal query reader has retired.'); return value; },
    receipt,
    release() {
      if (released) { if (releaseError) throw releaseError; return false; } released = true; value = null;
      const receipt = retirement.retire([...sources.map((source, index) => ({ name: 'chunk-source-' + index, run: () => source.release() })),
        { name: 'query-index', run: releaseIndex }]);
      if (receipt.outcome !== 'complete') { releaseError = journalError('query-retirement-unknown', 'Causal query resource retirement is unresolved.', { retirement: receipt }); throw releaseError; }
      sources.length = 0; return true;
    }, retirementState: () => retirement.getReceipt() });
  readAuthorities.set(handle, { budget: resourceBudget, receipt, isActive: () => !released }); return handle;
};

const createProcgenCausalJournal = ({ storage, maxRecordBytes = 1048576, maxChunkBytes = 4194304,
  maxChunkRecords = 64, maxPendingBytes = 8388608, maxChunks = 4096, resourceBudget = null, onState = () => {}, jobs } = {}) => {
  if (!storage || ['commitCausalTake', 'loadCausalTake', 'loadCausalChunk', 'loadCausalCheckpoint'].some(key => typeof storage[key] !== 'function') ||
      ![maxRecordBytes, maxChunkBytes, maxChunkRecords, maxPendingBytes, maxChunks].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxChunkRecords > 1024 || maxChunks > 65536 || maxRecordBytes > maxChunkBytes || maxChunkBytes > maxPendingBytes) throw new Error('Invalid causal journal storage or budgets.');
  const reserve = (bytes, generation = 0) => {
    const token = {}, owner = 'causal-journal';
    resourceBudget?.reserve({ token, owner, generation, kind: 'checkpoint', bytes: Math.ceil(bytes), pinned: true, reloadable: false });
    let released = false, attempted = false, releaseError = null;
    return () => {
      if (released) return false; if (attempted) throw releaseError;
      attempted = true; releaseError = new Error('Causal journal reservation retirement is unresolved.');
      try {
        const acknowledged = resourceBudget?.release({ token, owner });
        if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
          if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {}); throw releaseError;
        }
      } catch (error) { releaseError = error; throw error; }
      released = true; releaseError = null; return true;
    };
  };
  const publish = update => storage.commitCausalTake(storage.causalIndexVersion === 2 ? compactCausalCommit(update) : update);
  const sourceJobs = resourceBudget ? createCausalSourceJobs({ storage, resourceBudget, jobs, maxChunkBytes, maxChunkRecords }) : null;
  const qualified = new Map();
  let qualifiedBytes = 0;
  const forgetQualification = takeId => {
    const entry = qualified.get(takeId);
    if (entry) { entry.retiring = true; entry.release?.(); qualifiedBytes -= entry.bytes; qualified.delete(takeId); }
  };
  const createTake = async ({ takeId, takeName = 'Untitled take', documentId, sourceVersions, captureProfile, boundaryState = {}, initialCheckpoint,
    mapping, assetRefs = [], prefix = null } = {}) => {
    if (!id(takeId) || typeof takeName !== 'string' || !takeName.trim() || takeName.length > 120 || !id(documentId) || !sourceVersions || !captureProfile || !initialCheckpoint || !mapping) throw new Error('A take requires bounded name/document/source/checkpoint/capture identities.');
    const release = reserve((estimateJournalBytes(initialCheckpoint, { maxBytes: 32 * 1048576, maxNodes: 4000000 }) +
      estimateJournalBytes({ sourceVersions, captureProfile, boundaryState, mapping, assetRefs, prefix }, { maxBytes: 8 * 1048576 })) * 4);
    try {
      const encodedCheckpoint = canonicalJournalText(initialCheckpoint, { maxBytes: 32 * 1048576, maxNodes: 4000000 });
      const checkpointText = encodedCheckpoint.text;
      const checkpointHash = await hashJournalText(checkpointText), checkpointId = JSON.stringify([takeId, 'checkpoint', 0]);
      const metadata = cloneJournalData({ schema: 'lemmings-causal-take', version: 1, takeId, takeName: takeName.trim(), documentId, sourceVersions,
        captureProfile, boundaryState, mapping, assetRefs, prefix,
        initialCheckpoint: { id: checkpointId, sequence: 0, hash: checkpointHash, bytes: encodedCheckpoint.bytes.length, nodes: encodedCheckpoint.nodes } }, { maxBytes: 8 * 1048576 });
      const rootHash = await hashJournalData(metadata, { maxBytes: 8 * 1048576 });
      const start = prefix?.throughSequence ?? 0;
      const manifest = { ...metadata, revision: 1, state: 'recording', complete: false, durableSequence: start,
        admittedSequence: start, chunkCount: 0, chunks: [], canonicalHash: rootHash, rootHash,
        coverage: { status: 'complete', gaps: [] }, lastCommitId: `${takeId}:create` };
      manifest.checkpoints = [manifest.initialCheckpoint];
      await publish({ takeId, expectedRevision: 0, manifest,
        checkpoint: { id: checkpointId, takeId, sequence: 0, hash: checkpointHash, canonical: checkpointText }, commitId: manifest.lastCommitId });
      return openWriter(manifest);
    } finally { release(); }
  };
  const openWriter = initial => {
    const copied = cloneJournalData(initial, { maxBytes: 8 * 1048576 });
    let manifest = { ...copied, chunks: [...copied.chunks], checkpoints: [...copied.checkpoints] }, pending = [], pendingBytes = 0, admittedSequence = initial.durableSequence;
    let state = 'recording', draining = null, checkpointing = null, finishing = false, stopping = null, stopRequest = null, failure = null, rejectedRange = null;
    const discardedRanges = [];
    const notify = () => { try { onState(status()); } catch { /* Inspection does not change recording admission. */ } };
    const status = () => freezeJournalData({ takeId: manifest.takeId, documentId: manifest.documentId, state,
      revision: manifest.revision, durableSequence: manifest.durableSequence, admittedSequence, pendingBytes,
      complete: state === 'finalized' && manifest.complete, failure: failure ? { code: failure.code || failure.name || 'storage', message: String(failure.message) } : null,
      rejectedRange, recoveryRequired: state === 'recovery-required', captureStopped: finishing,
      terminal: manifest.state !== 'recording', discardedRanges: [...discardedRanges] });
    const fail = (error, detail = {}, permanent = false) => {
      state = permanent ? 'partial' : 'recovery-required'; failure = error;
      if (permanent) rejectedRange ||= detail;
      notify();
    };
    const appendMany = inputs => {
      if (state !== 'recording' || finishing) return Object.freeze({ status: 'rejected', reason: 'take-not-recording', ...status() });
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxChunkRecords) throw new Error('Invalid causal journal admission group.');
      const prepared = [], firstSequence = admittedSequence + 1;
      let bytes = 0, nodes = CHUNK_ENVELOPE_NODES, release = null;
      try {
        const estimate = inputs.reduce((sum, input) => sum + estimateJournalBytes(input, { maxBytes: maxRecordBytes }), 0);
        release = reserve(estimate * 4, inputs[0]?.generation ?? 0);
        for (const input of inputs) {
          if (!RECORD_KINDS.has(input?.kind) || !Number.isSafeInteger(input.tick) || input.tick < 0 ||
              !Number.isSafeInteger(input.generation) || input.generation < 0) throw new Error('Invalid causal journal record identity.');
          const record = cloneJournalData({ ...input, sequence: firstSequence + prepared.length,
            admissionGroup: { version: 1, firstSequence, lastSequence: firstSequence + inputs.length - 1 } }, { maxBytes: maxRecordBytes });
          const encoded = canonicalJournalText(record, { maxBytes: maxRecordBytes });
          prepared.push({ record, bytes: encoded.bytes.length }); bytes += encoded.bytes.length; nodes += encoded.nodes;
        }
        if (bytes > maxChunkBytes || nodes > MAX_CHUNK_NODES || pendingBytes + bytes > maxPendingBytes) throw journalError('capacity', 'Causal journal admission group exceeds its byte or structural capacity.');
      } catch (error) {
        release?.();
        fail(error, { firstSequence, tick: inputs[0]?.tick ?? null, generation: inputs[0]?.generation ?? null, reason: 'admission-failed' }, true);
        return Object.freeze({ status: 'rejected', reason: error.code || 'unsupported-record', ...status() });
      }
      const group = { entries: prepared, bytes, nodes: nodes - CHUNK_ENVELOPE_NODES, release };
      pending.push(group); pendingBytes += bytes; admittedSequence += prepared.length;
      notify();
      void flush().catch(() => {});
      return Object.freeze({ status: 'accepted', takeId: manifest.takeId, firstSequence, lastSequence: admittedSequence });
    };
    const commit = async update => {
      const legacy = storage.causalIndexVersion !== 2;
      const published = legacy ? { ...update, manifest: { ...update.manifest,
        chunks: update.chunkRef ? [...manifest.chunks, update.chunkRef] : manifest.chunks,
        checkpoints: update.checkpointRef ? [...manifest.checkpoints, update.checkpointRef] : manifest.checkpoints } } : update;
      try { await publish(published); }
      catch (error) {
        // Recover an acknowledged-by-storage commit when only its caller receipt
        // was lost. Never append the same sequence a second time.
        const latest = await (storage.loadCausalTakeHead?.(manifest.takeId) ?? storage.loadCausalTake(manifest.takeId)).catch(() => null);
        if (!latest || canonicalJournalText(causalTakeHead(latest)).text !== canonicalJournalText(causalTakeHead(published.manifest)).text) throw error;
      }
      if (update.chunkRef) manifest.chunks.push(update.chunkRef);
      if (update.checkpointRef) manifest.checkpoints.push(update.checkpointRef);
      manifest = update.manifest;
    };
    const drain = async () => {
      while (pending.length) {
        if (manifest.chunkCount >= maxChunks) throw journalError('capacity', 'Causal journal chunk limit reached.');
        const groups = [], records = [];
        let bytes = 0, nodes = CHUNK_ENVELOPE_NODES;
        for (const group of pending) {
          if (groups.length && (records.length + group.entries.length > maxChunkRecords || bytes + group.bytes > maxChunkBytes - 2048 || nodes + group.nodes > MAX_CHUNK_NODES)) break;
          groups.push(group); records.push(...group.entries.map(entry => entry.record)); bytes += group.bytes; nodes += group.nodes;
        }
        const ordinal = manifest.chunkCount + 1, firstSequence = records[0].sequence, lastSequence = records.at(-1).sequence;
        const body = { version: 1, takeId: manifest.takeId, ordinal, firstSequence, lastSequence, previousHash: manifest.canonicalHash, records };
        const release = reserve((bytes + 4096) * 5 + nodes * 64, records[0].generation);
        try {
          const encoded = canonicalJournalText(body, { maxBytes: maxChunkBytes + 4096 }), canonical = encoded.text;
          const hash = await hashJournalText(canonical), chunkId = makeChunkId(manifest.takeId, ordinal);
          const ref = { id: chunkId, takeId: manifest.takeId, ordinal, firstSequence, lastSequence, hash, bytes: encoded.bytes.byteLength, nodes: encoded.nodes,
            firstTick: Math.min(...records.map(record => record.tick)), lastTick: Math.max(...records.map(record => record.tick)),
            generations: [...new Set(records.map(record => record.generation))], kinds: [...new Set(records.map(record => record.kind))] };
          const next = { ...manifest, revision: manifest.revision + 1, durableSequence: lastSequence, admittedSequence,
            chunkCount: ordinal, canonicalHash: hash, lastCommitId: `${manifest.takeId}:chunk:${ordinal}:${hash}` };
          await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next,
            chunkRef: ref, chunk: { ...ref, canonical }, commitId: next.lastCommitId });
          pending.splice(0, groups.length); pendingBytes -= bytes; for (const group of groups) group.release(); notify();
        } finally { release(); }
      }
    };
    const flush = () => {
      if (checkpointing) return checkpointing.then(() => flush());
      if (draining) return draining;
      draining = drain().then(() => { if (!rejectedRange) { failure = null; state = finishing ? 'stopping' : 'recording'; } })
        .catch(error => { fail(error); throw error; })
        .finally(() => { draining = null; });
      return draining;
    };
    const stop = ({ coverage = { status: 'complete', gaps: [] }, boundaryState = {}, reason = 'user-stop', finalCheckpoint = null } = {}) => {
      if (manifest.state !== 'recording') return Promise.resolve(status());
      if (stopping) return stopping;
      finishing = true;
      stopRequest ||= { coverage: cloneJournalData(coverage), boundaryState: cloneJournalData(boundaryState), reason, finalCheckpoint };
      const finish = async () => {
        try {
          await flush();
          if (stopRequest.finalCheckpoint && !discardedRanges.length) await checkpoint({ ...stopRequest.finalCheckpoint, finalBoundary: true });
        } catch (error) { fail(error); return status(); }
        if (pendingBytes) { fail(journalError('pending-durability', 'The stopped take still owns an undurable suffix.')); return status(); }
        const complete = !rejectedRange && !discardedRanges.length && stopRequest.coverage.status === 'complete' && manifest.durableSequence === admittedSequence;
        const next = { ...manifest, revision: manifest.revision + 1, state: complete ? 'finalized' : 'partial', complete,
          admittedSequence, stopBoundaryState: stopRequest.boundaryState, stopReason: stopRequest.reason,
          coverage: cloneJournalData({ ...stopRequest.coverage, status: complete ? 'complete' : 'partial',
            gaps: [...(stopRequest.coverage.gaps || []), ...(rejectedRange ? [rejectedRange] : []), ...discardedRanges] }),
          lastCommitId: `${manifest.takeId}:stop:${manifest.revision + 1}` };
        next.finalizationHash = await hashJournalData(finalizationEvidence(next), { maxBytes: 8 * 1048576 });
        try { await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next, commitId: next.lastCommitId }); state = next.state; }
        catch (error) { fail(error); }
        notify(); return status();
      };
      stopping = finish().finally(() => { stopping = null; });
      return stopping;
    };
    const checkpoint = ({ value, tick, generation, finalBoundary = false } = {}) => {
      if (manifest.state !== 'recording' || finishing && !finalBoundary || checkpointing || !Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid or busy causal checkpoint boundary.');
      const release = reserve(estimateJournalBytes(value, { maxBytes: 32 * 1048576, maxNodes: 4000000 }) * 4, generation);
      let canonical, checkpointBytes, checkpointNodes;
      try { const encoded = canonicalJournalText(value, { maxBytes: 32 * 1048576, maxNodes: 4000000 }); canonical = encoded.text; checkpointBytes = encoded.bytes.length; checkpointNodes = encoded.nodes; } catch (error) { release(); throw error; }
      const sequence = admittedSequence, existingFlush = flush();
      const work = (async () => {
        await existingFlush;
        const hash = await hashJournalText(canonical);
        const ref = { id: JSON.stringify([manifest.takeId, 'checkpoint', sequence]), sequence, hash, tick, generation, bytes: checkpointBytes, nodes: checkpointNodes };
        const existing = manifest.checkpoints.find(item => item.sequence === sequence);
        if (existing) {
          if (existing.hash !== hash) throw journalError('checkpoint-conflict', 'A different component checkpoint already owns this source sequence.', { firstSequence: sequence });
          return Object.freeze({ status: 'unchanged', ...ref });
        }
        if (manifest.checkpoints.length >= 4096) throw new Error('Causal checkpoint index capacity reached.');
        const next = { ...manifest, revision: manifest.revision + 1, checkpointCount: manifest.checkpoints.length + 1,
          lastCommitId: `${manifest.takeId}:checkpoint:${sequence}:${hash}` };
        await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next,
          checkpointRef: ref, checkpoint: { ...ref, takeId: manifest.takeId, canonical }, commitId: next.lastCommitId });
        return Object.freeze({ status: 'durable', ...ref });
      })();
      checkpointing = work.finally(() => { release(); checkpointing = null; if (pending.length && !finishing) void flush().catch(() => {}); });
      return checkpointing;
    };
    const discardPending = ({ reason } = {}) => {
      if (!finishing || draining || checkpointing || !nameReason(reason)) throw new Error('Pending take data requires an explicit discard reason after completed stop.');
      if (stopping) throw new Error('Wait for the finishing attempt before discarding its suffix.');
      if (pending.length) {
        let firstTick = Infinity, lastTick = -Infinity;
        const generations = new Set();
        for (const group of pending) for (const { record } of group.entries) {
          firstTick = Math.min(firstTick, record.tick); lastTick = Math.max(lastTick, record.tick); generations.add(record.generation);
        }
        discardedRanges.push({ kind: 'all', firstSequence: pending[0].entries[0].record.sequence,
          lastSequence: pending.at(-1).entries.at(-1).record.sequence, firstTick, lastTick,
          generations: [...generations], reason, discarded: true });
      }
      for (const group of pending) group.release();
      pending = []; pendingBytes = 0; state = 'recovery-required';
      notify(); return status();
    };
    return { appendMany, append: input => appendMany([input]), flush, stop, status, checkpoint, discardPending,
      manifest: () => cloneJournalData(manifest, { maxBytes: 8 * 1048576 }), canReplaceDocument: () => manifest.state !== 'recording' && !pendingBytes };
  };
  const readChunk = async ref => {
    const chunk = await storage.loadCausalChunk(ref.id);
    if (!chunk) throw journalError('missing-chunk', 'A causal take chunk is missing.', { chunkId: ref.id, firstSequence: ref.firstSequence });
    if (typeof chunk.canonical !== 'string' || chunk.canonical.length > maxChunkBytes + 4096 || await hashJournalText(chunk.canonical) !== ref.hash) throw journalError('corrupt-chunk', 'A causal take chunk failed its hash.', { chunkId: ref.id, firstSequence: ref.firstSequence });
    let body;
    try { body = JSON.parse(chunk.canonical); } catch { throw journalError('corrupt-chunk', 'A causal take chunk is not JSON.', { chunkId: ref.id }); }
    validateCausalChunk(body, ref, maxChunkRecords);
    return freezeJournalData(body);
  };
  const qualifyTake = async (takeId, { signal, force = false, ancestors = new Set() } = {}) => {
    if (signal?.aborted) throw journalError('cancelled', 'Causal take qualification canceled.');
    if (ancestors.has(takeId) || ancestors.size >= 32) throw journalError('prefix-divergence', 'Causal lineage is cyclic or exceeds its depth budget.');
    const head = storage.loadCausalTakeHead ? await storage.loadCausalTakeHead(takeId) : null;
    const fingerprint = head ? canonicalJournalText(head, { maxBytes: 8 * 1048576 }).text : null;
    const cached = qualified.get(takeId);
    if (!force && fingerprint && !cached?.retiring && cached?.fingerprint === fingerprint) {
      qualified.delete(takeId); qualified.set(takeId, cached); return cached;
    }
    forgetQualification(takeId);
    const manifest = await storage.loadCausalTake(takeId, { signal, maxIndexRows: maxChunks + 4096 });
    if (manifest?.prefix?.version === 2) {
      const lineage = manifest.prefix;
      const parent = (await qualifyTake(lineage.takeId, { signal, force, ancestors: new Set([...ancestors, takeId]) })).manifest;
      if (parent.rootHash !== lineage.parentRootHash || parent.chunkCount < lineage.parentChunkCount ||
          (lineage.parentChunkCount ? parent.chunks[lineage.parentChunkCount - 1]?.hash : parent.rootHash) !== lineage.parentHash)
        throw journalError('prefix-divergence', 'Causal lineage source identity changed.');
      const refs = [...(parent.prefix?.chunks || []), ...parent.chunks].filter(ref => ref.firstSequence <= lineage.throughSequence)
        .map(ref => ({ ...ref, throughSequence: Math.min(lineage.throughSequence, ref.throughSequence ?? ref.lastSequence) }));
      if (refs.length > maxChunks) throw journalError('capacity', 'Resolved causal lineage exceeds its index budget.');
      manifest.prefix = { ...lineage, chunks: refs };
    }
    const verified = await verifyManifestHashes(manifest, { maxChunks });
    const encoded = canonicalJournalText(manifest, { maxBytes: 8 * 1048576 });
    const indexCount = (manifest.prefix?.chunks?.length || 0) + manifest.chunks.length;
    const entry = { fingerprint, bytes: encoded.bytes.byteLength * 2 + encoded.nodes * 64 + indexCount * (8 * 96 + 16) + 65536, manifest: freezeJournalData({ ...manifest,
      inspection: { paused: true, recording: false, hardware: false, thru: false, physicalLayers: false }, effectiveStatus: verified.effectiveStatus }),
    refs: [...(manifest.prefix?.chunks || []), ...manifest.chunks], tickTrees: new Map() };
    if (fingerprint && manifest.state !== 'recording' && entry.bytes <= 16 * 1048576) {
      while (qualified.size >= 8 || qualifiedBytes + entry.bytes > 16 * 1048576) forgetQualification(qualified.keys().next().value);
      try { entry.release = reserve(entry.bytes); qualified.set(takeId, entry); qualifiedBytes += entry.bytes; }
      catch (error) { if (error.name !== 'ResourceBudgetError') throw error; }
    }
    return entry;
  };
  const openTake = async (takeId, options) => (await qualifyTake(takeId, options)).manifest;
  const selectRefs = (entry, firstSequence, lastSequence, firstTick, lastTick, generation) => {
    const refs = entry.refs;
    let low = 0, high = refs.length;
    while (low < high) { const middle = (low + high) >>> 1;
      if (Math.min(refs[middle].lastSequence, refs[middle].throughSequence ?? Infinity) < firstSequence) low = middle + 1; else high = middle; }
    let upper = low, bound = refs.length;
    while (upper < bound) { const middle = (upper + bound) >>> 1;
      if (refs[middle].firstSequence <= lastSequence) upper = middle + 1; else bound = middle; }
    const end = upper;
    if (end - low <= 128 || firstTick === 0 && lastTick === Number.MAX_SAFE_INTEGER) return refs.slice(low, end);
    const treeKey = generation ?? 'all';
    let tree = entry.tickTrees.get(treeKey);
    if (!entry.tickTrees.has(treeKey)) {
      const sorted = refs.filter(ref => generation == null || ref.generations.includes(generation)).sort((a, b) => a.firstTick - b.firstTick || a.firstSequence - b.firstSequence);
      const build = (first, last) => {
        if (first >= last) return null;
        const middle = (first + last) >>> 1, ref = sorted[middle], left = build(first, middle), right = build(middle + 1, last);
        return { ref, left, right, maxTick: Math.max(ref.lastTick, left?.maxTick ?? -1, right?.maxTick ?? -1) };
      };
      tree = build(0, sorted.length);
      if (entry.tickTrees.size >= 8) entry.tickTrees.delete(entry.tickTrees.keys().next().value);
      entry.tickTrees.set(treeKey, tree);
    }
    const selected = [];
    const visit = node => {
      if (!node || node.maxTick < firstTick) return;
      visit(node.left);
      if (node.ref.firstTick > lastTick) return;
      if (node.ref.lastTick >= firstTick && node.ref.firstSequence <= lastSequence &&
          Math.min(node.ref.lastSequence, node.ref.throughSequence ?? Infinity) >= firstSequence) selected.push(node.ref);
      visit(node.right);
    };
    visit(tree); return selected.sort((a, b) => a.firstSequence - b.firstSequence);
  };
  const readCheckpoint = async ref => {
    const checkpoint = await storage.loadCausalCheckpoint(ref.id);
    if (!checkpoint || typeof checkpoint.canonical !== 'string' || checkpoint.canonical.length > 32 * 1048576 ||
        ref.bytes != null && (!Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > 32 * 1048576 ||
          checkpoint.canonical.length > ref.bytes || new TextEncoder().encode(checkpoint.canonical).length !== ref.bytes) ||
        await hashJournalText(checkpoint.canonical) !== ref.hash) throw journalError('checkpoint-mismatch', 'A causal component checkpoint is missing or corrupt.', { checkpointId: ref.id, firstSequence: ref.sequence });
    let value;
    try { value = JSON.parse(checkpoint.canonical); } catch { throw journalError('checkpoint-mismatch', 'A causal component checkpoint is not JSON.', { checkpointId: ref.id }); }
    return cloneJournalData(value, { maxBytes: 32 * 1048576, maxNodes: 4000000 });
  };
  const readSourceOwned = async (kind, ref, options) => {
    if (sourceJobs) {
      try { return await sourceJobs.read(kind, ref, options); }
      catch (error) {
        if (error.code !== 'content-mismatch') throw error;
        throw journalError(kind === 'chunk' ? 'corrupt-chunk' : 'checkpoint-mismatch', 'The causal source failed its immutable hash or object inventory.',
          { sourceId: ref.id, firstSequence: ref.firstSequence ?? ref.sequence, cause: error });
      }
    }
    let value = kind === 'chunk' ? await readChunk(ref) : await readCheckpoint(ref), released = false;
    return Object.freeze({ get value() { if (released) throw journalError('source-retired', 'Causal source read has retired.'); return value; },
      receipt: Object.freeze({ method: 'legacy-bounded-unadmitted-reader' }),
      release() { if (released) return false; released = true; value = null; return true; } });
  };
  const inspectSource = async (kind, ref, options) => {
    const source = await readSourceOwned(kind, ref, { ...options, metadataOnly: true });
    try {
      if (sourceJobs) return freezeJournalData(source.value);
      const value = source.value;
      return kind === 'chunk' ? { previousHash: value.previousHash, firstSequence: value.firstSequence, lastSequence: value.lastSequence } : { kind: 'checkpoint', ref };
    } finally { source.release(); }
  };
  const checkQualifiedRevision = async (entry, signal) => {
    if (signal?.aborted) throw journalError('cancelled', 'Causal take query canceled.');
    if (!entry.fingerprint || !storage.loadCausalTakeHead) return;
    const head = await storage.loadCausalTakeHead(entry.manifest.takeId);
    if (!head || canonicalJournalText(head, { maxBytes: 8 * 1048576 }).text !== entry.fingerprint)
      throw journalError('stale-revision', 'Causal take changed while reading the requested range.');
  };
  const queryOwned = async ({ takeId, takeRevision = null, firstSequence = 1, lastSequence = Number.MAX_SAFE_INTEGER, firstTick = 0,
    lastTick = Number.MAX_SAFE_INTEGER, generation = null, kinds = null, signal, limit = 4096 } = {}) => {
    if (!id(takeId) || !Number.isSafeInteger(firstSequence) || firstSequence < 1 || !Number.isSafeInteger(lastSequence) || lastSequence < firstSequence ||
        !Number.isSafeInteger(firstTick) || firstTick < 0 || !Number.isSafeInteger(lastTick) || lastTick < firstTick ||
        generation != null && (!Number.isSafeInteger(generation) || generation < 0) ||
        kinds && (!Array.isArray(kinds) || kinds.length > RECORD_KINDS.size || kinds.some(kind => !RECORD_KINDS.has(kind))) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 65536) throw new Error('Invalid causal take query.');
    const qualifiedTake = await qualifyTake(takeId, { signal }), manifest = qualifiedTake.manifest;
    const records = [], recordBytes = [];
    if (takeRevision != null && takeRevision !== manifest.revision) throw journalError('stale-revision', 'The requested take revision is no longer current.');
    const sources = [], releaseIndex = reserve(1048576 + qualifiedTake.bytes + qualifiedTake.refs.length * 32 + limit * 32);
    const result = { takeId, takeRevision: manifest.revision, records, recordBytes, nextSequence: null, coverage: null };
    let resultBytes = 0, completed = false;
    const finish = async nextSequence => {
      await checkQualifiedRevision(qualifiedTake, signal); result.nextSequence = nextSequence;
      // The qualified manifest is immutable and charged to this query's index
      // lease. Share its admitted coverage instead of recloning it per page.
      result.coverage = manifest.coverage;
      Object.freeze(records); Object.freeze(recordBytes); Object.freeze(result); completed = true;
      return ownedQueryResult(result, sources, releaseIndex, { resourceBudget });
    };
    try {
      const refs = selectRefs(qualifiedTake, firstSequence, lastSequence, firstTick, lastTick, generation);
      for (const ref of refs) {
        if (signal?.aborted) throw journalError('cancelled', 'Causal take query canceled.');
        if (ref.lastSequence < firstSequence || ref.firstSequence > lastSequence || ref.lastTick < firstTick || ref.firstTick > lastTick) continue;
        if (generation != null && !ref.generations.includes(generation) || kinds && ref.kinds && !ref.kinds.some(kind => kinds.includes(kind))) continue;
        if (sourceJobs) {
          const source = await readSourceOwned('chunk', ref, { signal, selection: { firstSequence, lastSequence, firstTick, lastTick, generation, kinds,
            throughSequence: manifest.prefix && ref.takeId !== takeId ? Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence) : ref.lastSequence,
            limit: Math.max(1, limit - records.length), maxBytes: records.length >= limit ? 1 : Math.max(1, maxPendingBytes - resultBytes), maxRecordBytes } });
          sources.push(source); const selected = source.value;
          if (selected.records.length) { records.push(...selected.records); recordBytes.push(...selected.recordBytes); resultBytes += selected.bytes; }
          else { source.release(); sources.pop(); }
          if (selected.nextSequence != null) return await finish(selected.nextSequence);
          continue;
        }
        const source = await readSourceOwned('chunk', ref, { signal }); sources.push(source); const chunk = source.value;
        for (const record of chunk.records) {
          if (manifest.prefix && ref.takeId !== takeId && record.sequence > Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence)) continue;
          if (record.sequence < firstSequence || record.sequence > lastSequence || record.tick < firstTick || record.tick > lastTick ||
            generation != null && record.generation !== generation || kinds && !kinds.includes(record.kind)) continue;
          const bytes = canonicalJournalText(record, { maxBytes: maxRecordBytes }).bytes.length;
          if (records.length >= limit || resultBytes + bytes > maxPendingBytes) {
            return await finish(record.sequence);
          }
          resultBytes += bytes;
          records.push(record); recordBytes.push(bytes);
        }
      }
      return await finish(null);
    } finally {
      if (!completed) ownedQueryResult(null, sources, releaseIndex).release();
    }
  };
  const query = async options => {
    const source = await queryOwned(options);
    try { return freezeJournalData(source.value); } finally { source.release(); }
  };
  const verify = async (takeId, { signal } = {}) => {
    const qualification = await qualifyTake(takeId, { force: true, signal }), manifest = qualification.manifest;
    await inspectSource('checkpoint', manifest.initialCheckpoint, { signal });
    let previousHash = manifest.rootHash, sequence = manifest.prefix?.throughSequence ?? 0;
    for (const ref of manifest.chunks) {
      signal?.throwIfAborted(); const chunk = await inspectSource('chunk', ref, { signal });
      if (!validRange(ref) || chunk.previousHash !== previousHash || chunk.firstSequence !== sequence + 1) throw journalError('chain-divergence', 'The causal take diverges at a chunk boundary.', { firstSequence: ref.firstSequence, chunkId: ref.id });
      sequence = chunk.lastSequence; previousHash = ref.hash;
    }
    if (sequence !== manifest.durableSequence || previousHash !== manifest.canonicalHash) throw journalError('manifest-divergence', 'The causal take durable prefix does not match its manifest.', { firstSequence: sequence + 1 });
    if (manifest.prefix) {
      let prefixSequence = 0;
      for (const ref of manifest.prefix.chunks) {
        signal?.throwIfAborted(); await inspectSource('chunk', ref, { signal });
        const through = Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence);
        if (!validRange(ref) || ref.firstSequence !== prefixSequence + 1 || through < ref.firstSequence || through > ref.lastSequence) {
          throw journalError('prefix-divergence', 'The shared causal prefix has a gap or overlapping source range.', { firstSequence: prefixSequence + 1, chunkId: ref.id });
        }
        prefixSequence = through;
      }
      if (prefixSequence !== manifest.prefix.throughSequence) throw journalError('prefix-divergence', 'The shared causal prefix is incomplete.', { firstSequence: prefixSequence + 1 });
    }
    await checkQualifiedRevision(qualification, signal);
    return freezeJournalData({ takeId, revision: manifest.revision, verifiedThroughSequence: sequence,
      canonicalHash: previousHash, status: manifest.effectiveStatus, coverage: manifest.coverage });
  };
  const seek = async ({ takeId, sequence, sourceVersions = null, assetRefs = null, signal } = {}) => {
    const manifest = await openTake(takeId);
    await verify(takeId, { signal });
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > manifest.durableSequence) throw new Error('Seek is outside the durable causal prefix.');
    if (sourceVersions && canonicalJournalText(sourceVersions).text !== canonicalJournalText(manifest.sourceVersions).text ||
        assetRefs && canonicalJournalText(assetRefs).text !== canonicalJournalText(manifest.assetRefs).text) throw journalError('source-incompatible', 'Take replay requires its original source and assets.');
    const ref = manifest.state === 'recording' ? manifest.initialCheckpoint :
      [...manifest.checkpoints].reverse().find(item => item.sequence <= sequence) || manifest.initialCheckpoint;
    const checkpoint = await storage.loadCausalCheckpoint(ref.id);
    if (!checkpoint || await hashJournalText(checkpoint.canonical) !== ref.hash) throw journalError('checkpoint-mismatch', 'The requested seek checkpoint is missing or corrupt.', { firstSequence: ref.sequence });
    const result = sequence > ref.sequence ? await query({ takeId, firstSequence: ref.sequence + 1, lastSequence: sequence, signal, limit: 65536 }) : { records: [], nextSequence: null };
    return freezeJournalData({ takeId, takeRevision: manifest.revision, mode: 'qualified-reperformance-plan',
      checkpoint: JSON.parse(checkpoint.canonical), checkpointSequence: ref.sequence, targetSequence: sequence,
      records: result.records, nextSequence: result.nextSequence, inspection: manifest.inspection });
  };
  const branch = async ({ parentTakeId, parentRevision = null, throughSequence, takeId, takeName, documentId, boundaryQualification = null } = {}) => {
    const parent = await openTake(parentTakeId);
    if (parentRevision != null && parent.revision !== parentRevision) throw journalError('stale-revision', 'The branch parent changed after boundary qualification.');
    if (!Number.isSafeInteger(throughSequence) || throughSequence < 0 || throughSequence > parent.durableSequence) throw new Error('Branch boundary is outside the durable prefix.');
    await verify(parentTakeId);
    const chunks = [...(parent.prefix?.chunks || []), ...parent.chunks].filter(ref => ref.firstSequence <= throughSequence)
      .map(ref => ({ ...ref, throughSequence: Math.min(throughSequence, ref.throughSequence ?? ref.lastSequence) }));
    if (chunks.length > maxChunks) throw new Error('Branch prefix index exceeds its budget.');
    const checkpoint = await storage.loadCausalCheckpoint(parent.initialCheckpoint.id);
    if (boundaryQualification && (boundaryQualification.sourceTakeId !== parentTakeId || boundaryQualification.sourceCanonicalHash !== parent.canonicalHash ||
        boundaryQualification.sourceTakeRevision !== parent.revision || boundaryQualification.throughSequence !== throughSequence)) throw journalError('qualification-mismatch', 'Branch qualification does not bind this parent prefix.');
    const prefix = { version: 2, takeId: parentTakeId, revision: parent.revision, throughSequence, boundaryQualification,
      parentRootHash: parent.rootHash, parentChunkCount: parent.chunkCount, indexHash: await hashJournalData(chunks, { maxBytes: 8 * 1048576 }),
      parentHash: parent.canonicalHash, mode: 'immutable-prefix' };
    return createTake({ takeId, takeName: takeName || `${(parent.takeName || 'Take').slice(0, 113)} branch`, documentId: documentId || parent.documentId, sourceVersions: parent.sourceVersions,
      captureProfile: parent.captureProfile, boundaryState: parent.boundaryState, initialCheckpoint: JSON.parse(checkpoint.canonical),
      mapping: parent.mapping, assetRefs: parent.assetRefs, prefix });
  };
  return { createTake, openTake, query, queryOwned, verify, branch, readChunk, readCheckpoint, seek,
    openTakeOwned: async (takeId, options) => {
      const entry = await qualifyTake(takeId, options);
      return ownedQueryResult(entry.manifest, [], reserve(entry.bytes), { kind: 'causal-take-metadata', metadataBytes: entry.bytes, resourceBudget });
    },
    readChunkOwned: (ref, options) => readSourceOwned('chunk', ref, options),
    readCheckpointOwned: (ref, options) => readSourceOwned('checkpoint', ref, options),
    releaseQualifications: () => createProcgenRetirementScope().retire([...qualified.keys()].map(takeId => ({ name: 'take-qualification-' + takeId, run: () => forgetQualification(takeId) }))),
    qualificationDiagnostics: () => Object.freeze({ retained: qualified.size, estimatedBytes: qualifiedBytes, maximumBytes: 16 * 1048576 }) };
};

export { createProcgenCausalJournal, verifyManifestHashes, RECORD_KINDS, inspectCausalReadOwnership };
