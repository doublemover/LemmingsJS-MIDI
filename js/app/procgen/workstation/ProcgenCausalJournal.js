import { canonicalJournalText, estimateJournalBytes, cloneJournalData, freezeJournalData, hashJournalText, hashJournalData, journalError } from './CausalJournalCanonical.js';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const nameReason = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const RECORD_KINDS = new Set(['physical-batch', 'musical-intents', 'intervention', 'input-observation', 'timeline', 'mapping', 'sink-outcome', 'marker']);
const validRange = value => value && Number.isSafeInteger(value.firstSequence) && Number.isSafeInteger(value.lastSequence) &&
  value.firstSequence > 0 && value.lastSequence >= value.firstSequence;
const makeChunkId = (takeId, ordinal) => JSON.stringify([takeId, 'chunk', ordinal]);
const METADATA_KEYS = ['schema', 'version', 'takeId', 'takeName', 'documentId', 'sourceVersions', 'captureProfile', 'boundaryState', 'mapping', 'assetRefs', 'prefix', 'initialCheckpoint'];
const finalizationEvidence = manifest => ({ canonicalHash: manifest.canonicalHash, state: manifest.state,
  complete: manifest.complete, durableSequence: manifest.durableSequence, admittedSequence: manifest.admittedSequence,
  checkpoints: manifest.checkpoints, chunks: manifest.chunks, coverage: manifest.coverage,
  stopBoundaryState: manifest.stopBoundaryState, stopReason: manifest.stopReason });
const verifyManifestHashes = async (manifest, { maxChunks = 4096 } = {}) => {
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
  const metadata = Object.fromEntries(METADATA_KEYS.map(key => [key, manifest[key]]));
  if (await hashJournalData(metadata, { maxBytes: 8 * 1048576 }) !== manifest.rootHash) throw journalError('metadata-divergence', 'The causal take source manifest changed.');
  if (manifest.state !== 'recording' && (!hash(manifest.finalizationHash) ||
      await hashJournalData(finalizationEvidence(manifest), { maxBytes: 8 * 1048576 }) !== manifest.finalizationHash)) {
    throw journalError('finalization-divergence', 'The causal take finalization evidence changed.');
  }
  return Object.freeze({ takeId: manifest.takeId, rootHash: manifest.rootHash, canonicalHash: manifest.canonicalHash,
    effectiveStatus: manifest.state === 'finalized' && manifest.complete ? 'complete' : 'partial' });
};

const createProcgenCausalJournal = ({ storage, maxRecordBytes = 1048576, maxChunkBytes = 4194304,
  maxChunkRecords = 64, maxPendingBytes = 8388608, maxChunks = 4096, resourceBudget = null, onState = () => {} } = {}) => {
  if (!storage || ['commitCausalTake', 'loadCausalTake', 'loadCausalChunk', 'loadCausalCheckpoint'].some(key => typeof storage[key] !== 'function') ||
      ![maxRecordBytes, maxChunkBytes, maxChunkRecords, maxPendingBytes, maxChunks].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxChunkRecords > 1024 || maxChunks > 65536 || maxRecordBytes > maxChunkBytes || maxChunkBytes > maxPendingBytes) throw new Error('Invalid causal journal storage or budgets.');
  const reserve = (bytes, generation = 0) => {
    const token = {}, owner = 'causal-journal';
    resourceBudget?.reserve({ token, owner, generation, kind: 'checkpoint', bytes: Math.ceil(bytes), pinned: true, reloadable: false });
    let released = false;
    return () => { if (!released) { released = true; resourceBudget?.release({ token, owner }); } };
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
        initialCheckpoint: { id: checkpointId, sequence: 0, hash: checkpointHash, bytes: encodedCheckpoint.bytes.length } }, { maxBytes: 8 * 1048576 });
      const rootHash = await hashJournalData(metadata, { maxBytes: 8 * 1048576 });
      const start = prefix?.throughSequence ?? 0;
      const manifest = { ...metadata, revision: 1, state: 'recording', complete: false, durableSequence: start,
        admittedSequence: start, chunkCount: 0, chunks: [], canonicalHash: rootHash, rootHash,
        coverage: { status: 'complete', gaps: [] }, lastCommitId: `${takeId}:create` };
      manifest.checkpoints = [manifest.initialCheckpoint];
      await storage.commitCausalTake({ takeId, expectedRevision: 0, manifest,
        checkpoint: { id: checkpointId, takeId, sequence: 0, hash: checkpointHash, canonical: checkpointText }, commitId: manifest.lastCommitId });
      return openWriter(manifest);
    } finally { release(); }
  };
  const openWriter = initial => {
    let manifest = cloneJournalData(initial, { maxBytes: 8 * 1048576 }), pending = [], pendingBytes = 0, admittedSequence = initial.durableSequence;
    let state = 'recording', draining = null, checkpointing = null, finishing = false, failure = null, rejectedRange = null;
    const notify = () => { try { onState(status()); } catch { /* Inspection does not change recording admission. */ } };
    const status = () => freezeJournalData({ takeId: manifest.takeId, documentId: manifest.documentId, state,
      revision: manifest.revision, durableSequence: manifest.durableSequence, admittedSequence, pendingBytes,
      complete: state === 'finalized' && manifest.complete, failure: failure ? { code: failure.code || failure.name || 'storage', message: String(failure.message) } : null,
      rejectedRange });
    const fail = (error, detail = {}) => {
      state = 'partial'; failure = error; rejectedRange ||= detail;
      notify();
    };
    const appendMany = inputs => {
      if (state !== 'recording' || finishing) return Object.freeze({ status: 'rejected', reason: 'take-not-recording', ...status() });
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxChunkRecords) throw new Error('Invalid causal journal admission group.');
      const prepared = [], firstSequence = admittedSequence + 1;
      let bytes = 0, release = null;
      try {
        const estimate = inputs.reduce((sum, input) => sum + estimateJournalBytes(input, { maxBytes: maxRecordBytes }), 0);
        release = reserve(estimate * 4, inputs[0]?.generation ?? 0);
        for (const input of inputs) {
          if (!RECORD_KINDS.has(input?.kind) || !Number.isSafeInteger(input.tick) || input.tick < 0 ||
              !Number.isSafeInteger(input.generation) || input.generation < 0) throw new Error('Invalid causal journal record identity.');
          const record = cloneJournalData({ ...input, sequence: firstSequence + prepared.length }, { maxBytes: maxRecordBytes });
          const size = canonicalJournalText(record, { maxBytes: maxRecordBytes }).bytes.length;
          prepared.push({ record, bytes: size }); bytes += size;
        }
        if (bytes > maxChunkBytes || pendingBytes + bytes > maxPendingBytes) throw journalError('capacity', 'Causal journal pending capacity reached.');
      } catch (error) {
        release?.();
        fail(error, { firstSequence, tick: inputs[0]?.tick ?? null, generation: inputs[0]?.generation ?? null, reason: 'admission-failed' });
        return Object.freeze({ status: 'rejected', reason: error.code || 'unsupported-record', ...status() });
      }
      const group = { entries: prepared, bytes, release };
      pending.push(group); pendingBytes += bytes; admittedSequence += prepared.length;
      notify();
      void flush().catch(() => {});
      return Object.freeze({ status: 'accepted', takeId: manifest.takeId, firstSequence, lastSequence: admittedSequence });
    };
    const commit = async update => {
      try { await storage.commitCausalTake(update); }
      catch (error) {
        // Recover an acknowledged-by-storage commit when only its caller receipt
        // was lost. Never append the same sequence a second time.
        const latest = await storage.loadCausalTake(manifest.takeId).catch(() => null);
        if (latest?.lastCommitId !== update.commitId) throw error;
      }
      manifest = cloneJournalData(update.manifest, { maxBytes: 8 * 1048576 });
    };
    const drain = async () => {
      while (pending.length) {
        if (manifest.chunkCount >= maxChunks) throw journalError('capacity', 'Causal journal chunk limit reached.');
        const groups = [], records = [];
        let bytes = 0;
        for (const group of pending) {
          if (groups.length && (records.length + group.entries.length > maxChunkRecords || bytes + group.bytes > maxChunkBytes - 2048)) break;
          groups.push(group); records.push(...group.entries.map(entry => entry.record)); bytes += group.bytes;
        }
        const ordinal = manifest.chunkCount + 1, firstSequence = records[0].sequence, lastSequence = records.at(-1).sequence;
        const body = { version: 1, takeId: manifest.takeId, ordinal, firstSequence, lastSequence, previousHash: manifest.canonicalHash, records };
        const release = reserve((bytes + 4096) * 5, records[0].generation);
        try {
          const canonical = canonicalJournalText(body, { maxBytes: maxChunkBytes + 4096 }).text;
          const hash = await hashJournalText(canonical), chunkId = makeChunkId(manifest.takeId, ordinal);
          const ref = { id: chunkId, takeId: manifest.takeId, ordinal, firstSequence, lastSequence, hash,
            firstTick: Math.min(...records.map(record => record.tick)), lastTick: Math.max(...records.map(record => record.tick)),
            generations: [...new Set(records.map(record => record.generation))], kinds: [...new Set(records.map(record => record.kind))] };
          const next = { ...manifest, revision: manifest.revision + 1, durableSequence: lastSequence, admittedSequence,
            chunkCount: ordinal, chunks: [...manifest.chunks, ref], canonicalHash: hash, lastCommitId: `${manifest.takeId}:chunk:${ordinal}:${hash}` };
          await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next,
            chunk: { ...ref, canonical }, commitId: next.lastCommitId });
          pending.splice(0, groups.length); pendingBytes -= bytes; for (const group of groups) group.release(); notify();
        } finally { release(); }
      }
    };
    const flush = () => {
      if (checkpointing) return checkpointing.then(() => flush());
      if (draining) return draining;
      draining = drain().catch(error => { fail(error, { firstSequence: manifest.durableSequence + 1, reason: 'durability-failed' }); throw error; })
        .finally(() => { draining = null; });
      return draining;
    };
    const stop = async ({ coverage = { status: 'complete', gaps: [] }, boundaryState = {}, reason = 'user-stop' } = {}) => {
      if (state === 'finalized') return status();
      finishing = true;
      try { await flush(); } catch { /* Finalize the verified durable prefix as partial when possible. */ }
      const complete = !failure && state !== 'partial' && coverage.status === 'complete' && manifest.durableSequence === admittedSequence;
      const next = { ...manifest, revision: manifest.revision + 1, state: complete ? 'finalized' : 'partial', complete,
        admittedSequence, stopBoundaryState: cloneJournalData(boundaryState), stopReason: reason,
        coverage: cloneJournalData({ ...coverage, status: complete ? 'complete' : 'partial',
          gaps: [...(coverage.gaps || []), ...(rejectedRange ? [rejectedRange] : [])] }),
        lastCommitId: `${manifest.takeId}:stop:${manifest.revision + 1}` };
      next.finalizationHash = await hashJournalData(finalizationEvidence(next), { maxBytes: 8 * 1048576 });
      try { await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next, commitId: next.lastCommitId }); state = next.state; }
      catch (error) { fail(error, rejectedRange || { firstSequence: manifest.durableSequence + 1, reason: 'finalization-failed' }); }
      notify(); return status();
    };
    const checkpoint = ({ value, tick, generation } = {}) => {
      if (state !== 'recording' || finishing || checkpointing || !Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid or busy causal checkpoint boundary.');
      const release = reserve(estimateJournalBytes(value, { maxBytes: 32 * 1048576, maxNodes: 4000000 }) * 4, generation);
      let canonical, checkpointBytes;
      try { const encoded = canonicalJournalText(value, { maxBytes: 32 * 1048576, maxNodes: 4000000 }); canonical = encoded.text; checkpointBytes = encoded.bytes.length; } catch (error) { release(); throw error; }
      const sequence = admittedSequence, existingFlush = flush();
      const work = (async () => {
        await existingFlush;
        const hash = await hashJournalText(canonical);
        const ref = { id: JSON.stringify([manifest.takeId, 'checkpoint', sequence]), sequence, hash, tick, generation, bytes: checkpointBytes };
        const existing = manifest.checkpoints.find(item => item.sequence === sequence);
        if (existing) {
          if (existing.hash !== hash) throw journalError('checkpoint-conflict', 'A different component checkpoint already owns this source sequence.', { firstSequence: sequence });
          return Object.freeze({ status: 'unchanged', ...ref });
        }
        if (manifest.checkpoints.length >= 4096) throw new Error('Causal checkpoint index capacity reached.');
        const next = { ...manifest, revision: manifest.revision + 1, checkpoints: [...manifest.checkpoints, ref],
          lastCommitId: `${manifest.takeId}:checkpoint:${sequence}:${hash}` };
        await commit({ takeId: manifest.takeId, expectedRevision: manifest.revision, manifest: next,
          checkpoint: { ...ref, takeId: manifest.takeId, canonical }, commitId: next.lastCommitId });
        return Object.freeze({ status: 'durable', ...ref });
      })();
      checkpointing = work.finally(() => { release(); checkpointing = null; if (pending.length && !finishing) void flush().catch(() => {}); });
      return checkpointing;
    };
    const discardPending = ({ reason } = {}) => {
      if (!finishing || draining || checkpointing || !nameReason(reason)) throw new Error('Pending take data requires an explicit discard reason after completed stop.');
      for (const group of pending) group.release();
      pending = []; pendingBytes = 0; state = 'partial'; rejectedRange ||= { firstSequence: manifest.durableSequence + 1, reason };
      notify(); return status();
    };
    return { appendMany, append: input => appendMany([input]), flush, stop, status, checkpoint, discardPending,
      manifest: () => manifest, canReplaceDocument: () => state === 'finalized' || state === 'partial' && !pendingBytes };
  };
  const readChunk = async ref => {
    const chunk = await storage.loadCausalChunk(ref.id);
    if (!chunk) throw journalError('missing-chunk', 'A causal take chunk is missing.', { chunkId: ref.id, firstSequence: ref.firstSequence });
    if (typeof chunk.canonical !== 'string' || chunk.canonical.length > maxChunkBytes + 4096 || await hashJournalText(chunk.canonical) !== ref.hash) throw journalError('corrupt-chunk', 'A causal take chunk failed its hash.', { chunkId: ref.id, firstSequence: ref.firstSequence });
    let body;
    try { body = JSON.parse(chunk.canonical); } catch { throw journalError('corrupt-chunk', 'A causal take chunk is not JSON.', { chunkId: ref.id }); }
    if (body.version !== 1 || body.takeId !== ref.takeId || body.ordinal !== ref.ordinal || body.firstSequence !== ref.firstSequence || body.lastSequence !== ref.lastSequence ||
        !Array.isArray(body.records) || !body.records.length || body.records.length > maxChunkRecords || body.lastSequence !== body.firstSequence + body.records.length - 1 ||
        body.records.some((record, index) => record.sequence !== body.firstSequence + index || !RECORD_KINDS.has(record.kind) ||
          !Number.isSafeInteger(record.tick) || record.tick < 0 || !Number.isSafeInteger(record.generation) || record.generation < 0) ||
        ref.firstTick !== Math.min(...body.records.map(record => record.tick)) || ref.lastTick !== Math.max(...body.records.map(record => record.tick)) ||
        canonicalJournalText(ref.generations).text !== canonicalJournalText([...new Set(body.records.map(record => record.generation))]).text ||
        ref.kinds && canonicalJournalText(ref.kinds).text !== canonicalJournalText([...new Set(body.records.map(record => record.kind))]).text) {
      throw journalError('corrupt-chunk', 'A causal take chunk has inconsistent sequence metadata.', { chunkId: ref.id });
    }
    return freezeJournalData(body);
  };
  const openTake = async takeId => {
    const manifest = await storage.loadCausalTake(takeId);
    const verified = await verifyManifestHashes(manifest, { maxChunks });
    return cloneJournalData({ ...manifest, inspection: { paused: true, recording: false, hardware: false, thru: false, physicalLayers: false },
      effectiveStatus: verified.effectiveStatus }, { maxBytes: 8 * 1048576 });
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
  const query = async ({ takeId, takeRevision = null, firstSequence = 1, lastSequence = Number.MAX_SAFE_INTEGER, firstTick = 0,
    lastTick = Number.MAX_SAFE_INTEGER, generation = null, kinds = null, signal, limit = 4096 } = {}) => {
    if (!id(takeId) || !Number.isSafeInteger(firstSequence) || firstSequence < 1 || !Number.isSafeInteger(lastSequence) || lastSequence < firstSequence ||
        !Number.isSafeInteger(firstTick) || firstTick < 0 || !Number.isSafeInteger(lastTick) || lastTick < firstTick ||
        generation != null && (!Number.isSafeInteger(generation) || generation < 0) ||
        kinds && (!Array.isArray(kinds) || kinds.length > RECORD_KINDS.size || kinds.some(kind => !RECORD_KINDS.has(kind))) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 65536) throw new Error('Invalid causal take query.');
    const manifest = await openTake(takeId), refs = [...(manifest.prefix?.chunks || []), ...manifest.chunks], records = [];
    let resultBytes = 0;
    if (takeRevision != null && takeRevision !== manifest.revision) throw journalError('stale-revision', 'The requested take revision is no longer current.');
    for (const ref of refs) {
      if (signal?.aborted) throw journalError('cancelled', 'Causal take query canceled.');
      if (ref.lastSequence < firstSequence || ref.firstSequence > lastSequence || ref.lastTick < firstTick || ref.firstTick > lastTick) continue;
      if (generation != null && !ref.generations.includes(generation) || kinds && ref.kinds && !ref.kinds.some(kind => kinds.includes(kind))) continue;
      const chunk = await readChunk(ref);
      for (const record of chunk.records) {
        if (manifest.prefix && ref.takeId !== takeId && record.sequence > Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence)) continue;
        if (record.sequence < firstSequence || record.sequence > lastSequence || record.tick < firstTick || record.tick > lastTick ||
            generation != null && record.generation !== generation || kinds && !kinds.includes(record.kind)) continue;
        const bytes = canonicalJournalText(record, { maxBytes: maxRecordBytes }).bytes.length;
        if (records.length >= limit || resultBytes + bytes > maxPendingBytes) return freezeJournalData({ takeId, takeRevision: manifest.revision, records, nextSequence: record.sequence, coverage: manifest.coverage });
        resultBytes += bytes;
        records.push(record);
      }
    }
    return freezeJournalData({ takeId, takeRevision: manifest.revision, records, nextSequence: null, coverage: manifest.coverage });
  };
  const verify = async takeId => {
    const manifest = await openTake(takeId), checkpoint = await storage.loadCausalCheckpoint(manifest.initialCheckpoint.id);
    if (!checkpoint || await hashJournalText(checkpoint.canonical) !== manifest.initialCheckpoint.hash) throw journalError('checkpoint-mismatch', 'The causal take initial checkpoint is missing or corrupt.');
    let previousHash = manifest.rootHash, sequence = manifest.prefix?.throughSequence ?? 0;
    for (const ref of manifest.chunks) {
      const chunk = await readChunk(ref);
      if (!validRange(ref) || chunk.previousHash !== previousHash || chunk.firstSequence !== sequence + 1) throw journalError('chain-divergence', 'The causal take diverges at a chunk boundary.', { firstSequence: ref.firstSequence, chunkId: ref.id });
      sequence = chunk.lastSequence; previousHash = ref.hash;
    }
    if (sequence !== manifest.durableSequence || previousHash !== manifest.canonicalHash) throw journalError('manifest-divergence', 'The causal take durable prefix does not match its manifest.', { firstSequence: sequence + 1 });
    if (manifest.prefix) {
      let prefixSequence = 0;
      for (const ref of manifest.prefix.chunks) {
        await readChunk(ref);
        const through = Math.min(manifest.prefix.throughSequence, ref.throughSequence ?? ref.lastSequence);
        if (!validRange(ref) || ref.firstSequence !== prefixSequence + 1 || through < ref.firstSequence || through > ref.lastSequence) {
          throw journalError('prefix-divergence', 'The shared causal prefix has a gap or overlapping source range.', { firstSequence: prefixSequence + 1, chunkId: ref.id });
        }
        prefixSequence = through;
      }
      if (prefixSequence !== manifest.prefix.throughSequence) throw journalError('prefix-divergence', 'The shared causal prefix is incomplete.', { firstSequence: prefixSequence + 1 });
    }
    return freezeJournalData({ takeId, revision: manifest.revision, verifiedThroughSequence: sequence,
      canonicalHash: previousHash, status: manifest.effectiveStatus, coverage: manifest.coverage });
  };
  const seek = async ({ takeId, sequence, sourceVersions = null, assetRefs = null, signal } = {}) => {
    const manifest = await openTake(takeId);
    await verify(takeId);
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
    const prefix = { takeId: parentTakeId, revision: parent.revision, throughSequence, chunks, boundaryQualification,
      parentHash: parent.canonicalHash, mode: 'immutable-prefix' };
    return createTake({ takeId, takeName: takeName || `${(parent.takeName || 'Take').slice(0, 113)} branch`, documentId: documentId || parent.documentId, sourceVersions: parent.sourceVersions,
      captureProfile: parent.captureProfile, boundaryState: parent.boundaryState, initialCheckpoint: JSON.parse(checkpoint.canonical),
      mapping: parent.mapping, assetRefs: parent.assetRefs, prefix });
  };
  return { createTake, openTake, query, verify, branch, readChunk, readCheckpoint, seek };
};

export { createProcgenCausalJournal, verifyManifestHashes, RECORD_KINDS };
