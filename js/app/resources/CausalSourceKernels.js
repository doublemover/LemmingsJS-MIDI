import { canonicalDataText } from '../../core/CanonicalData.js';
import { validateCausalChunk } from '../procgen/workstation/CausalArchiveEntry.js';
import { CAUSAL_SOURCE_JOB_KINDS } from './BackgroundJobKinds.js';
import { yieldBackgroundTask } from './BackgroundTaskYield.js';
import { backgroundJobError as problem, checkBackgroundJob as guard, inspectText } from './BackgroundJsonInspector.js';

const MAX_BYTES = 64 * 1048576, MAX_NODES = 4000000;
export async function runCausalSourceKernel(kind, input, { signal, current, maxBytes = MAX_BYTES, estimatedPeakBytes,
  maxNodes = MAX_NODES, maxStringBytes = MAX_BYTES, crypto = globalThis.crypto, onProgress = () => {}, yieldControl = () => yieldBackgroundTask(), expectedInputHash = null } = {}) {
  if (!CAUSAL_SOURCE_JOB_KINDS.includes(kind) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES ||
      !Number.isSafeInteger(maxStringBytes) || maxStringBytes < 1 || maxStringBytes > MAX_BYTES ||
      expectedInputHash != null && !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw problem('invalid-contract', 'Unsupported causal source kernel contract.');
  guard(signal, current);
  const options = { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl };
  if (kind === 'verify-stored-causal-sources') {
    const { verifyStoredCausalSources } = await import('../procgen/workstation/CausalStoredSourceVerification.js'); guard(signal, current);
    return verifyStoredCausalSources(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress, crypto,
      verifySource: source => runCausalSourceKernel('verify-causal-source', source, { signal, current, maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, crypto, onProgress: () => {}, yieldControl }) });
  }
  if (kind === 'verify-causal-sources') {
    if (!input || Object.keys(input).some(key => !['sources', 'selection'].includes(key)) || !Array.isArray(input.sources) || !input.sources.length || input.sources.length > 16)
      throw problem('invalid-contract', 'Invalid causal source verification window.');
    let sourceBytes = 0, sourceNodes = 0;
    for (const source of input.sources) {
      if (source?.kind !== 'chunk' || source.metadataOnly !== !input.selection || source.selection !== null || typeof source.canonical !== 'string') throw problem('invalid-contract', 'Invalid causal verification window source.');
      sourceBytes += source.canonical.length;
      if (sourceBytes > 4 * 1048576) throw problem('input-capacity', 'Causal verification window exceeds its byte bound.');
    }
    sourceBytes = 0;
    for (const source of input.sources) {
      let inventory;
      try { inventory = await inspectText(source.canonical, { maxBytes, maxNodes, estimatedPeakBytes, signal, current, onProgress, yieldControl }); }
      catch (error) { error.sourceId = source.ref?.id; error.firstSequence = source.ref?.firstSequence; throw error; }
      sourceBytes += inventory.bytes; sourceNodes += inventory.nodes;
      if (sourceBytes > 4 * 1048576 || sourceNodes > 1000000 || sourceBytes * 12 + sourceNodes * 96 + 65536 > estimatedPeakBytes)
        throw problem('memory-capacity', 'Causal verification window exceeds its admitted representation.');
    }
    const value = input.selection ? { records: [], recordBytes: [], bytes: 0, nodes: 0, nextSequence: null } : [];
    let inputBytes = 0, nodes = 0, retainedBytes = 4096;
    for (const source of input.sources) {
      guard(signal, current);
      const full = input.selection && value.records.length >= input.selection.limit;
      const selectedSource = input.selection ? { ...source, selection: { ...input.selection,
        throughSequence: Math.min(input.selection.throughSequence, source.ref.throughSequence ?? source.ref.lastSequence),
        limit: Math.max(1, input.selection.limit - value.records.length), maxBytes: Math.max(1, input.selection.maxBytes - value.bytes) } } : source;
      let verified;
      try { verified = await runCausalSourceKernel('verify-causal-source', selectedSource,
        { signal, current, maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, crypto, onProgress, yieldControl }); }
      catch (error) { error.sourceId = source.ref?.id; error.firstSequence = source.ref?.firstSequence; throw error; }
      inputBytes += verified.inputBytes; nodes += verified.nodes; retainedBytes += verified.retainedBytes;
      if (inputBytes > 4 * 1048576 || nodes > 500000 || retainedBytes > estimatedPeakBytes) throw problem('memory-capacity', 'Causal verification window exceeds its admitted inventory.');
      if (input.selection) {
        if (full && verified.value.records.length) { value.nextSequence = verified.value.records[0].sequence; break; }
        value.records.push(...verified.value.records); value.recordBytes.push(...verified.value.recordBytes);
        value.bytes += verified.value.bytes; value.nodes += verified.value.nodes; value.nextSequence = verified.value.nextSequence;
        if (value.nextSequence != null) break;
      } else value.push(verified.value);
      await yieldControl();
    }
    guard(signal, current); return { value, inputBytes, nodes, retainedBytes };
  }
  if (kind === 'verify-causal-source') {
    if (!input || Object.keys(input).some(key => !['kind', 'ref', 'canonical', 'metadataOnly', 'maxRecords', 'selection', 'proof'].includes(key)) ||
        !['chunk', 'checkpoint'].includes(input.kind) || typeof input.metadataOnly !== 'boolean' || !input.ref ||
        typeof input.ref.id !== 'string' || input.ref.id.length > 256 || !/^[a-f0-9]{64}$/.test(input.ref.hash) ||
        !Number.isSafeInteger(input.maxRecords) || input.maxRecords < 1 || input.maxRecords > 1024) throw problem('invalid-contract', 'Invalid causal source verification request.');
    const referenceInventory = canonicalDataText(input.ref, { maxBytes: 16384, maxNodes: 4096 });
    const proof = input.proof, known = input.kind === 'chunk' && typeof input.canonical === 'string' && input.canonical.length <= maxBytes && proof && typeof proof === 'object' && !Array.isArray(proof) &&
      Object.keys(proof).every(key => ['reference', 'bytes', 'nodes', 'previousHash', 'maxRecords'].includes(key)) && proof.reference === referenceInventory.text && proof.maxRecords === input.maxRecords &&
      Number.isSafeInteger(proof.bytes) && proof.bytes > 0 && proof.bytes <= maxBytes && proof.bytes === input.ref.bytes &&
      Number.isSafeInteger(proof.nodes) && proof.nodes > 0 && proof.nodes <= maxNodes && proof.nodes === input.ref.nodes && /^[a-f0-9]{64}$/.test(proof.previousHash);
    const metadata = known ? { bytes: proof.bytes, nodes: proof.nodes } : await inspectText(input.canonical, options); guard(signal, current);
    if (input.ref.bytes != null && metadata.bytes !== input.ref.bytes || metadata.bytes * 12 + metadata.nodes * 96 + 65536 > estimatedPeakBytes)
      throw problem('memory-capacity', 'Causal source byte or structure inventory exceeds its admitted representation.');
    const bytes = new TextEncoder().encode(input.canonical);
    if (bytes.length !== metadata.bytes) throw problem('content-mismatch', 'Causal source differs from its previously validated byte inventory.');
    const digest = await crypto.subtle.digest('SHA-256', bytes); guard(signal, current);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== input.ref.hash) throw problem('content-mismatch', 'Causal source differs from its immutable reference.');
    const body = JSON.parse(input.canonical); guard(signal, current);
    const encoded = known ? { nodes: proof.nodes } : canonicalDataText(body, { maxBytes, maxNodes });
    if (!known && (encoded.text !== input.canonical || input.ref.nodes != null && encoded.nodes !== input.ref.nodes)) throw problem('content-mismatch', 'Causal source is not the declared canonical object inventory.');
    if (input.kind === 'chunk') { if (!known) validateCausalChunk(body, input.ref, input.maxRecords); }
    else if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('invalid-data', 'Causal checkpoint is not a component snapshot.');
    let value = input.metadataOnly ? { kind: input.kind, ref: input.ref, bytes: metadata.bytes, nodes: encoded.nodes,
      ...(input.kind === 'chunk' ? { previousHash: body.previousHash, firstSequence: body.firstSequence, lastSequence: body.lastSequence } : {}) } : body;
    let retainedBytes = input.metadataOnly ? referenceInventory.bytes.byteLength * 2 + referenceInventory.nodes * 64 + 4096 : metadata.bytes * 2 + metadata.nodes * 64;
    if (input.selection != null) {
      const selected = input.selection, bounded = (number, minimum = 0) => Number.isSafeInteger(number) && number >= minimum;
      if (input.kind !== 'chunk' || input.metadataOnly || typeof selected !== 'object' || Array.isArray(selected) ||
          Object.keys(selected).some(key => !['firstSequence', 'lastSequence', 'firstTick', 'lastTick', 'generation', 'kinds', 'throughSequence', 'limit', 'maxBytes', 'maxRecordBytes'].includes(key)) ||
          !bounded(selected.firstSequence, 1) || !bounded(selected.lastSequence, selected.firstSequence) || !bounded(selected.firstTick) || !bounded(selected.lastTick, selected.firstTick) ||
          selected.generation != null && !bounded(selected.generation) || !bounded(selected.throughSequence) || !bounded(selected.limit, 1) || selected.limit > 65536 ||
          !bounded(selected.maxBytes, 1) || selected.maxBytes > MAX_BYTES || !bounded(selected.maxRecordBytes, 1) || selected.maxRecordBytes > MAX_BYTES ||
          selected.kinds != null && (!Array.isArray(selected.kinds) || selected.kinds.length > 8 || selected.kinds.some(kind => typeof kind !== 'string' || kind.length > 64)))
        throw problem('invalid-contract', 'Invalid causal chunk query selection.');
      const records = [], recordBytes = []; let selectedBytes = 0, selectedNodes = 0, nextSequence = null;
      for (const record of body.records) {
        if (record.sequence < selected.firstSequence || record.sequence > Math.min(selected.lastSequence, selected.throughSequence) ||
            record.tick < selected.firstTick || record.tick > selected.lastTick || selected.generation != null && record.generation !== selected.generation ||
            selected.kinds && !selected.kinds.includes(record.kind)) continue;
        if (records.length === selected.limit) { nextSequence = record.sequence; break; }
        const representation = canonicalDataText(record, { maxBytes: selected.maxRecordBytes, maxNodes });
        if (selectedBytes + representation.bytes.byteLength > selected.maxBytes) { nextSequence = record.sequence; break; }
        records.push(record); recordBytes.push(representation.bytes.byteLength); selectedBytes += representation.bytes.byteLength; selectedNodes += representation.nodes;
      }
      value = { records, recordBytes, bytes: selectedBytes, nodes: selectedNodes, nextSequence };
      retainedBytes = selectedBytes * 2 + selectedNodes * 64 + records.length * 256 + 4096;
    }
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Verified source exceeds its result reservation.');
    return { value, inputBytes: metadata.bytes, nodes: encoded.nodes, retainedBytes };
  }
  throw problem('invalid-contract', 'Unsupported causal source computation.');
}
