import { freezeData } from '../../core/CanonicalData.js';
const PROTOCOL = 1, MAX_BYTES = 16 * 1048576, CHUNK_BYTES = 32768;
const failure = code => Object.assign(new Error('Source state capture: ' + code), { code });
export function createOwnedSourceCutOwner({ owner, resources, getProducer, getContext, getGeneration, getIdentity, getBindings, flush, retire } = {}) {
  let serial = 0, pending = null, fenced = false, disposed = false;
  const current = operation => pending === operation && !disposed && getProducer() === operation.producer && getContext() === operation.context && getGeneration() === operation.generation;
  const clean = operation => { clearTimeout(operation.timer); operation.signal?.removeEventListener('abort', operation.abort); if (pending === operation) pending = null; };
  const retireAndRelease = async (operation, returned) => {
    if (!operation.lease) return;
    if (returned || !operation.transferred) { operation.lease.release(); return; }
    const receipt = await retire(); await receipt?.completion;
    if (receipt?.outcome !== 'complete') { const error = failure('source-state-retirement-unresolved'); operation.lease.retainUnknown(error); throw error; }
    operation.lease.release();
  };
  const fail = (operation, error, returned = false) => {
    clean(operation); if (operation.transferred) fenced = true;
    else try { operation.producer.port.postMessage({ type: 'source-state-cancel', stateTransferProtocol: PROTOCOL, requestId: operation.id }); } catch { /* No buffer was transferred. */ }
    void retireAndRelease(operation, returned).then(() => operation.reject(error), retirementError => operation.reject(Object.assign(error, { retirementError })));
  };
  const detach = ({ graphRevision, signal = null, timeoutMs = 20000 } = {}) => {
    const producer = getProducer(), context = getContext(), identity = getIdentity(graphRevision);
    if (disposed || fenced || pending || !producer || !resources?.reserve || context?.state !== 'running' || !Number.isSafeInteger(serial + 1) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 ||
        !identity || !/^[a-f0-9]{64}$/.test(identity.engineArtifactHash) || !/^[a-f0-9]{64}$/.test(identity.patchDefinitionHash) || !Number.isSafeInteger(graphRevision) || graphRevision < 0 || graphRevision > 0xffffffff) return Promise.reject(failure('pinned-running-source-required'));
    signal?.throwIfAborted();
    let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; });
    const operation = pending = { id: ++serial, producer, context, generation: getGeneration(), identity: Object.freeze({ ...identity, graphRevision }), resolve, reject, signal,
      transferred: false, lease: null, host: null, phase: 'offered', timer: null, abort: null };
    operation.abort = () => { if (pending === operation) fail(operation, signal.reason instanceof Error ? signal.reason : failure('source-state-aborted')); };
    signal?.addEventListener('abort', operation.abort, { once: true });
    operation.timer = setTimeout(() => { if (pending === operation) fail(operation, failure('source-state-timeout')); }, timeoutMs);
    try { producer.port.postMessage({ type: 'source-state-offer', stateTransferProtocol: PROTOCOL, requestId: operation.id, identity: operation.identity }); }
    catch (error) { fail(operation, error); }
    return promise;
  };
  const consume = data => {
    const operation = pending;
    if (!operation || data?.stateTransferProtocol !== PROTOCOL || data.requestId !== operation.id) return false;
    if (!current(operation)) { fail(operation, failure('source-state-owner-changed'), data.bytes instanceof Uint8Array && data.bytes.byteLength > 0); return true; }
    if (data.type === 'source-state-offered') {
      if (operation.phase !== 'offered' || !Number.isSafeInteger(data.bytes) || data.bytes < 128 || data.bytes > MAX_BYTES || data.chunkBytes !== CHUNK_BYTES) { fail(operation, failure('invalid-source-state-offer')); return true; }
      try {
        operation.lease = resources.reserve({ kind: 'source-state-cut', owner: owner + ':source-cut:' + operation.id, generation: operation.generation, bytes: data.bytes, estimateBytes: 8 * 1048576, consumerOwned: true });
        const bytes = new Uint8Array(data.bytes); flush();
        const text = JSON.stringify(getBindings()); if (text.length > 1048576) throw failure('source-host-state-capacity');
        operation.host = freezeData(JSON.parse(text)); operation.phase = 'copying'; operation.bytes = data.bytes; fenced = true;
        operation.producer.port.postMessage({ type: 'source-state-begin', stateTransferProtocol: PROTOCOL, requestId: operation.id, bytes }, [bytes.buffer]); operation.transferred = true;
      } catch (error) { fail(operation, error); }
      return true;
    }
    if (data.type === 'source-state-error') { fail(operation, failure(data.reason || 'source-state-refused'), data.bytes instanceof Uint8Array && data.bytes.byteLength === operation.bytes); return true; }
    if (data.type !== 'source-state-complete') return false;
    if (operation.phase !== 'copying' || !(data.bytes instanceof Uint8Array) || !(data.bytes.buffer instanceof ArrayBuffer) || data.bytes.byteOffset || data.bytes.length !== operation.bytes || data.bytes.buffer.byteLength !== operation.bytes ||
        !(data.voiceTokens instanceof Uint32Array) || data.voiceTokens.length !== 64 || !Number.isSafeInteger(data.cut?.frame) || data.cut.frame < 0 || data.cut.bytes !== operation.bytes || data.cut.sampleRate !== operation.context.sampleRate ||
        data.cut.engineArtifactHash !== operation.identity.engineArtifactHash || data.cut.patchDefinitionHash !== operation.identity.patchDefinitionHash || data.cut.graphRevision !== operation.identity.graphRevision || data.sourceClock !== 'frozen-at-detached-block-boundary') { fail(operation, failure('invalid-source-state-result'), data.bytes instanceof Uint8Array && data.bytes.byteLength === operation.bytes && data.bytes.buffer instanceof ArrayBuffer && data.bytes.buffer.byteLength === operation.bytes); return true; }
    try { const text = JSON.stringify(getBindings()); if (text.length > 1048576) throw failure('source-host-state-capacity'); operation.host = freezeData(JSON.parse(text)); } catch (error) { fail(operation, error, true); return true; }
    clean(operation); let bytes = data.bytes, metadata = freezeData({ schema: 'lemmings-live-source-cut/v1', cut: data.cut, runtime: operation.identity, sourceClock: data.sourceClock,
      host: { ...operation.host, voices: operation.host.voices.filter(voice => data.voiceTokens[voice.slot] === voice.slotToken) }, effects: 'not-included-source-cut-only', validation: 'captured-awaiting-independent-validation', portableNodeReferences: false });
    void (async () => {
      try { const receipt = await retire(); await receipt?.completion; if (receipt?.outcome !== 'complete') throw failure('source-state-detachment-unresolved');
        operation.resolve(Object.freeze({ metadata: () => metadata, bytes: () => { if (!bytes) throw failure('source-cut-released'); return bytes; }, release() { if (!bytes) return false; bytes = metadata = null; return operation.lease.release(); } }));
      } catch (error) { bytes = metadata = null; try { operation.lease.release(); } catch (retirementError) { error.retirementError = retirementError; } operation.reject(error); }
    })(); return true;
  };
  return Object.freeze({ detach, consume, fenced: () => fenced, diagnostics: () => Object.freeze({ pending: !!pending, phase: pending?.phase || (fenced ? 'detached' : 'idle'), chunkBytes: CHUNK_BYTES, maxBytes: MAX_BYTES }),
    dispose() { disposed = true; const operation = pending; if (operation) fail(operation, failure('source-state-owner-disposed')); } });
}
