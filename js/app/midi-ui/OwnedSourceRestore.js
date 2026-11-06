import { acquireOwnedSourceContinuation } from './OwnedSourceContinuation.js';
const failure = code => Object.assign(new Error('Source restore: ' + code), { code });
const returnedBuffer = (data, operation) => data?.bytes instanceof Uint8Array && data.bytes.buffer instanceof ArrayBuffer && !data.bytes.byteOffset && data.bytes.length === operation.length && data.bytes.buffer.byteLength === operation.length;
export function createOwnedSourceRestoreOwner({ getProducer, getContext, getGeneration, isReady, validate, stage, onActivated, retire } = {}) {
  if ([getProducer, getContext, getGeneration, isReady, validate, stage, onActivated, retire].some(value => typeof value !== 'function')) throw new TypeError('Source restore requires its complete owner boundary.');
  let serial = 0, pending = null, disposed = false;
  const current = operation => pending === operation && !disposed && getProducer() === operation.producer && getContext() === operation.context && getGeneration() === operation.generation && operation.isCurrent();
  const clean = operation => { clearTimeout(operation.timer); operation.signal?.removeEventListener('abort', operation.abort); if (pending === operation) pending = null; };
  const releaseTicket = async operation => { const receipt = operation.acquired.release(); await receipt?.completion; if (receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(failure('prepared-result-retirement-unresolved'), { retirement: receipt }); };
  const fail = (operation, error, returned = false) => {
    if (operation.failing) return; operation.failing = true; clean(operation); operation.returned ||= returned;
    void (async () => {
      try {
        const dependentRetirement = Promise.resolve().then(() => operation.activationPlan?.cancel()); dependentRetirement.catch(() => {});
        const receipt = await retire(); await receipt?.completion;
        try { await dependentRetirement; } catch (dependentRetirementError) { error.dependentRetirementError = dependentRetirementError; }
        if (operation.transferred && !operation.returned && receipt?.outcome !== 'complete') throw Object.assign(failure('transferred-state-retirement-unresolved'), { retirement: receipt });
        await releaseTicket(operation); operation.reject(error);
      } catch (retirementError) { operation.reject(Object.assign(error, { retirementError })); }
    })();
  };
  const restore = (ticket, bindings, { signal = null, isCurrent = () => true, timeoutMs = 30000, beforeActivate = null } = {}) => {
    const producer = getProducer(), context = getContext();
    if (disposed || pending || !isReady() || !producer || context?.state !== 'running' || !Number.isSafeInteger(serial + 1) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 || typeof isCurrent !== 'function' || beforeActivate !== null && typeof beforeActivate !== 'function') return Promise.reject(failure('fresh-running-source-required'));
    signal?.throwIfAborted(); let acquired;
    try { acquired = acquireOwnedSourceContinuation(ticket); validate(acquired.value, acquired.reference, bindings); }
    catch (error) { if (acquired) { try { acquired.release(); } catch (retirementError) { error.retirementError = retirementError; } } return Promise.reject(error); }
    let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; });
    const operation = pending = { id: ++serial, acquired, bindings, producer, context, generation: getGeneration(), signal, isCurrent, resolve, reject, timer: null, abort: null,
      beforeActivate, activationPlan: null, dependentActivation: null, failing: false, length: acquired.value.bytes.length, transferred: false, returned: false, plannedFrame: null, staged: null, phase: 'transferred' };
    operation.abort = () => { if (pending === operation) fail(operation, signal.reason instanceof Error ? signal.reason : failure('source-restore-aborted')); };
    signal?.addEventListener('abort', operation.abort, { once: true });
    operation.timer = setTimeout(() => { if (pending === operation) fail(operation, failure('source-restore-timeout')); }, timeoutMs);
    try {
      if (!current(operation)) throw failure('source-restore-owner-changed');
      const value = acquired.value;
      producer.port.postMessage({ type: 'source-state-restore', stateTransferProtocol: 1, requestId: operation.id, bytes: value.bytes, checksum: value.transportChecksum32,
        identity: value.metadata.runtime, validation: value.validation }, [value.bytes.buffer]); operation.transferred = true;
    } catch (error) { operation.transferred ||= acquired.value.bytes.byteLength === 0; fail(operation, error); }
    return promise;
  };
  const consume = data => {
    const operation = pending; if (!operation || data?.stateTransferProtocol !== 1 || data.requestId !== operation.id || !['source-state-staged', 'source-state-activated', 'source-restore-error'].includes(data.type)) return false;
    if (!current(operation)) { fail(operation, failure('source-restore-owner-changed'), returnedBuffer(data, operation)); return true; }
    if (data.type === 'source-restore-error') { fail(operation, failure(data.reason || 'source-restore-refused'), returnedBuffer(data, operation)); return true; }
    if (data.type === 'source-state-staged') {
      const value = operation.acquired.value;
      if (operation.phase !== 'transferred' || !returnedBuffer(data, operation) || data.cut?.abi !== value.stateAbi || data.cut.frame !== value.sourceFrame || !Number.isSafeInteger(data.blockFrames) || data.blockFrames < 1 || data.blockFrames > 16384 || !Number.isSafeInteger(data.blockFrame) || data.blockFrame < 0) { fail(operation, failure('invalid-staged-source'), returnedBuffer(data, operation)); return true; }
      operation.returned = true; value.bytes = data.bytes; operation.phase = 'planning';
      void (async () => {
        try {
          if (operation.beforeActivate) {
            operation.activationPlan = await operation.beforeActivate(Object.freeze({ context: operation.context, blockFrame: data.blockFrame, blockFrames: data.blockFrames,
              sourceFrame: value.sourceFrame, sourceAudioFrame: value.metadata.audioFrame ?? null, signal: operation.signal, isCurrent: () => current(operation) }));
            if (!operation.activationPlan || typeof operation.activationPlan.arm !== 'function' || typeof operation.activationPlan.cancel !== 'function') throw failure('complete-source-activation-barrier-required');
          }
          if (!current(operation)) throw failure('source-restore-owner-changed');
          const earliest = Math.ceil((operation.context.currentTime + 0.1) * operation.context.sampleRate), quantum = data.blockFrames;
          operation.plannedFrame = operation.activationPlan?.audioFrame ?? data.blockFrame + Math.max(1, Math.ceil((earliest - data.blockFrame) / quantum)) * quantum;
          if (!Number.isSafeInteger(operation.plannedFrame) || operation.plannedFrame < Math.ceil((operation.context.currentTime + 0.02) * operation.context.sampleRate) ||
              operation.plannedFrame > Math.floor((operation.context.currentTime + 1.8) * operation.context.sampleRate) || (operation.plannedFrame - data.blockFrame) % quantum) throw failure('source-activation-barrier-frontier');
          operation.staged = stage(value, operation.bindings, operation.plannedFrame);
          if (!operation.staged || !Array.isArray(operation.staged.lanes) || operation.staged.lanes.length > 4096 || !current(operation)) throw failure('source-bindings-not-staged');
          operation.phase = 'arming';
          const barrier = operation.activationPlan?.arm();
          operation.dependentActivation = Promise.resolve(barrier && typeof barrier === 'object' && 'completion' in barrier ? barrier.completion : barrier);
          operation.dependentActivation.catch(error => { if (pending === operation) fail(operation, error); });
          if (barrier?.ready) await barrier.ready;
          if (!current(operation) || operation.plannedFrame < Math.ceil(operation.context.currentTime * operation.context.sampleRate)) throw failure('source-activation-arm-frontier-missed');
          operation.phase = 'armed'; operation.producer.port.postMessage({ type: 'source-state-activate', stateTransferProtocol: 1, requestId: operation.id, startAfterFrame: operation.plannedFrame, lanes: operation.staged.lanes });
        } catch (error) {
          if (pending === operation) fail(operation, error, true);
          else { try { await operation.activationPlan?.cancel(); } catch {} }
        }
      })();
      return true;
    }
    const value = operation.acquired.value;
    if (operation.phase !== 'armed' || data.sourceFrame !== value.sourceFrame || data.audioFrame !== operation.plannedFrame || data.sourceFrameOffset !== value.sourceFrame - operation.plannedFrame) { fail(operation, failure('source-activation-frontier-mismatch')); return true; }
    operation.phase = 'active';
    void (async () => {
      try {
        if (!current(operation)) throw failure('source-restore-owner-changed');
        const receipt = Object.freeze({ status: 'accepted', stage: 'source-continuation-active', sourceFrame: data.sourceFrame, audioFrame: data.audioFrame, sourceFrameOffset: data.sourceFrameOffset,
          sampleRate: operation.context.sampleRate, restoredVoices: value.metadata.host.voices.length, futureCommands: value.metadata.host.inFlight.length,
          engineArtifactHash: value.metadata.cut.engineArtifactHash, patchDefinitionHash: value.metadata.cut.patchDefinitionHash, acousticReceipt: false });
        await operation.dependentActivation; if (!current(operation)) throw failure('source-restore-owner-changed');
        await onActivated(receipt, operation.staged); await releaseTicket(operation);
        if (!current(operation)) throw failure('source-restore-owner-changed'); clean(operation); operation.resolve(receipt);
      } catch (error) { if (pending === operation) fail(operation, error); else operation.reject(error); }
    })(); return true;
  };
  return Object.freeze({ restore, consume, pending: () => !!pending, diagnostics: () => Object.freeze({ pending: !!pending, phase: pending?.phase || 'idle' }),
    dispose() { disposed = true; const operation = pending; if (operation) fail(operation, failure('source-restore-owner-disposed')); } });
}
