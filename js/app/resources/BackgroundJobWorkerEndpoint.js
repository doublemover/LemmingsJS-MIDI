import { BACKGROUND_JOB_PROTOCOL, BACKGROUND_JOB_KINDS, CAUSAL_SOURCE_JOB_KINDS } from './BackgroundJobKinds.js';
import { createBackgroundSnapshotReceiver, encodeBackgroundSnapshotPages, backgroundSnapshotTransfers } from './BackgroundSnapshotPages.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';

export function createBackgroundJobWorkerEndpoint({ postMessage, close, kernel = null,
  identity = () => getActiveExecutionIdentity('browser-background-jobs'), compareIdentity = required => compareActiveExecutionIdentity(required, 'browser-background-jobs').matched } = {}) {
  let source = null, receiver = null, phase = 'new', outputAcknowledgment = null;
  const respond = (payload, transfers = []) => postMessage({ protocol: BACKGROUND_JOB_PROTOCOL, jobId: source?.jobId, ownerEpoch: source?.ownerEpoch, sourceRevision: source?.sourceRevision, ...payload }, transfers);
  const fail = error => { if (phase === 'closed') return; phase = 'closed'; receiver?.dispose(); receiver = null; outputAcknowledgment?.reject(error); outputAcknowledgment = null;
    try { respond({ type: 'failed', error: { code: String(error.code || error.name).slice(0, 64), message: String(error.message || error).slice(0, 512),
      ...(typeof error.sourceId === 'string' && error.sourceId.length <= 256 ? { sourceId: error.sourceId } : {}),
      ...(Number.isSafeInteger(error.firstSequence) && error.firstSequence >= 0 ? { firstSequence: error.firstSequence } : {}) } }); } finally { close(); } };
  const sendOutput = (payload, transfers = []) => new Promise((resolve, reject) => {
    if (phase !== 'sending' || outputAcknowledgment) throw new Error('Invalid result transport backpressure.');
    outputAcknowledgment = { sequence: payload.sequence, resolve, reject }; try { respond(payload, transfers); } catch (error) { outputAcknowledgment = null; reject(error); }
  });
  const validEnvelope = request => request?.protocol === BACKGROUND_JOB_PROTOCOL && /^background-[0-9]+$/.test(request.jobId || '') && Number.isSafeInteger(request.ownerEpoch) && request.ownerEpoch >= 0 &&
    ['number', 'string'].includes(typeof request.sourceRevision) && (typeof request.sourceRevision !== 'number' || Number.isSafeInteger(request.sourceRevision)) && String(request.sourceRevision).length <= 256;
  return Object.freeze({ async receive(request) {
    try {
      if (phase === 'closed') return;
      if (!validEnvelope(request) || source && ['jobId', 'ownerEpoch', 'sourceRevision'].some(key => request[key] !== source[key])) throw new Error('Invalid or stale background job worker envelope.');
      if (phase === 'new') {
        source = { jobId: request.jobId, ownerEpoch: request.ownerEpoch, sourceRevision: request.sourceRevision, kind: request.kind, limits: request.limits };
        if (request.type !== 'input-start' || !BACKGROUND_JOB_KINDS.includes(request.kind) || request.sequence !== 0 || Object.hasOwn(request, 'input')) throw new Error('Background worker requires a bounded snapshot stream.');
        if (request.requiredIdentity?.activeExecution === 'bound' && !compareIdentity(request.requiredIdentity)) throw new Error('Background worker executes a different immutable build.');
        if (request.limits?.maxBytes > 64 * 1048576) throw new Error('Worker input exceeds the protocol byte ceiling.');
        receiver = createBackgroundSnapshotReceiver({ ...request.limits, allowOwnedWasmModule: false }); phase = 'receiving'; respond({ type: 'input-ack', sequence: 0 }); return;
      }
      if (phase === 'sending' && request.type === 'output-ack') {
        if (!outputAcknowledgment || request.sequence !== outputAcknowledgment.sequence) throw new Error('Stale background result acknowledgment.');
        const pending = outputAcknowledgment; outputAcknowledgment = null; pending.resolve(); return;
      }
      if (phase !== 'receiving') throw new Error('Background worker received input after computation began.');
      if (request.type === 'input-page') { const receipt = receiver.push(request.packet); respond({ type: 'input-ack', sequence: receipt.sequence }); return; }
      if (request.type !== 'input-end') throw new Error('Invalid background snapshot message.');
      let input = receiver.finish(request.sequence); receiver = null; phase = 'computing';
      const compute = kernel || (CAUSAL_SOURCE_JOB_KINDS.includes(source.kind) ? (await import('./CausalSourceKernels.js')).runCausalSourceKernel :
        (await import('./BackgroundJobKernels.js')).runBackgroundJobKernel);
      if (phase !== 'computing') return;
      const result = await compute(source.kind, input, { ...source.limits, onProgress: progress => { if (phase === 'computing') respond({ type: 'progress', progress }); } });
      input = null; if (phase !== 'computing') return;
      const transfers = source.kind === 'compile-scene-terrain' && result.value?.storage instanceof Uint8Array ? [result.value.storage.buffer] : ['prepare-owned-source-bank', 'decode-wave-source', 'render-causal-source-pcm'].includes(source.kind) && Array.isArray(result.value?.planes) ? result.value.planes.map(plane => plane.buffer) :
        ['encode-physical-take-midi', 'encode-midi-clip', 'encode-recorded-midi', 'encode-recovery-page', 'encode-native-render', 'render-sound-controls', 'generate-procedural-sound'].includes(source.kind) && result.value?.bytes instanceof Uint8Array ? [result.value.bytes.buffer] :
          source.kind === 'render-scene-rehearsal' && result.value?.bytes instanceof Uint8Array ? [result.value.bytes.buffer] :
            ['encode-native-render', 'render-causal-sine-take', 'render-shape-body-calibration'].includes(source.kind) && Array.isArray(result.value?.files) && result.value.files.length <= 25 ? result.value.files.map(file => file.bytes.buffer) :
              source.kind === 'build-shape-body-content' && Array.isArray(result.value?.contents) && result.value.contents.length <= 8 ? result.value.contents.map(file => file.bytes.buffer) : [];
      if (source.kind === 'prepare-stretch-core-image' && result.value?.moduleBytes instanceof Uint8Array && result.value?.heapBytes instanceof Uint8Array) transfers.push(result.value.moduleBytes.buffer, result.value.heapBytes.buffer);
      if (source.kind === 'encode-recorded-ump-clip' && result.value?.bytes instanceof Uint8Array && result.value?.manifestBytes instanceof Uint8Array) transfers.push(result.value.bytes.buffer, result.value.manifestBytes.buffer);
      if (source.kind === 'decode-midi-clip') for (const columns of [result.value?.configuration, result.value?.sequence]) {
        if (columns?.ticks instanceof Float64Array && columns?.offsets instanceof Uint32Array && columns?.words instanceof Uint32Array) transfers.push(columns.ticks.buffer, columns.offsets.buffer, columns.words.buffer);
      }
      if (['decompose-sound-seed', 'fit-sound-seed-modes', 'compose-sound-seed-components', 'warp-sound-seed'].includes(source.kind)) {
        for (const entry of [...(result.value?.components || []), ...(result.value?.recombined ? [result.value.recombined] : [])]) {
          if (entry?.bytes instanceof Uint8Array && entry?.waveform?.minMax instanceof Float32Array) transfers.push(entry.bytes.buffer, entry.waveform.minMax.buffer);
        }
      }
      const ownedTransferBuffers = new Set(transfers);
      if (ownedTransferBuffers.size !== transfers.length || ownedTransferBuffers.size > 32) ownedTransferBuffers.clear();
      const resultLimits = { allowOwnedWasmModule: source.kind === 'prepare-stretch-core-image', maxBytes: Math.min(256 * 1048576, Math.floor(source.limits.estimatedPeakBytes / 2)), maxNodes: 4000000, estimatedPeakBytes: source.limits.estimatedPeakBytes };
      phase = 'sending'; await sendOutput({ type: 'output-start', sequence: 0, metadata: { inputBytes: result.inputBytes, nodes: result.nodes, retainedBytes: result.retainedBytes ?? null }, executionIdentity: identity() });
      let sequence = 0;
      for await (const packet of encodeBackgroundSnapshotPages(result.value, { ...resultLimits, ownedTransferBuffers, isCurrent: () => phase === 'sending' })) { sequence = packet.sequence; await sendOutput({ type: 'output-page', sequence, packet }, backgroundSnapshotTransfers(packet)); }
      respond({ type: 'computed', sequence }); phase = 'closed'; close();
    } catch (error) { fail(error); }
  }, fail, diagnostics: () => ({ phase, input: receiver?.diagnostics() || null }) });
}
