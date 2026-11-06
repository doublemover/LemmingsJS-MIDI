import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { acquireOwnedEffectContinuation } from './OwnedEffectContinuation.js';
import { chooseOwnedAudioFrame } from './OwnedAudioFrame.js';

const MAX_BYTES = 48 * 1048576, PROTOCOL = 1;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const fail = reason => Object.assign(new Error('Effect state: ' + reason), { name: 'AudioRestoreError', code: reason });
const exclusive = (bytes, length) => bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && !bytes.byteOffset && bytes.length === length && bytes.buffer.byteLength === length;
const bounded = value => cloneData(value, { maxBytes: 2 * 1048576, maxNodes: 131072 });
const deferred = () => { let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; }); promise.catch(() => {}); return { promise, resolve, reject }; };

export function createOwnedEffectGraphState({ context, resources, owner, generation, hash, processors, stagedRestore, unsupported,
  check, captureControls, restoreControls, captureHost, restoreHost, retire }) {
  let serial = 0, operation = null, detached = false, retired = false;
  const fenced = () => stagedRestore || detached || !!operation;
  const clean = op => { clearTimeout(op.timer); op.signal?.removeEventListener('abort', op.abort); };
  const current = op => {
    if (retired || operation !== op) throw fail('effect-state-owner-retired');
    op.signal?.throwIfAborted(); check();
  };
  const releasePrepared = async op => { if (!op.acquired) return; const receipt = op.acquired.release(); await receipt?.completion; if (receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(fail('effect-prepared-retirement-unresolved'), { retirement: receipt }); op.acquired = null; };
  const reject = (op, error) => {
    if (op.ending) return; op.ending = true; op.phase = 'failed'; detached = true; clean(op); op.retiring = true;
    void (async () => {
      try {
        const receipt = retire(); await receipt?.completion;
        const confirmed = receipt?.outcome === 'complete';
        for (const row of op.rows.values()) {
          if (!row.lease) continue;
          if (!row.transferred || row.returned || confirmed) row.lease.release(); else row.lease.retainUnknown(error);
        }
        op.controlCut?.release(); op.controlCut = null;
        if (confirmed || [...op.rows.values()].every(row => !row.transferred || row.returned)) await releasePrepared(op);
        if (!confirmed) error.retirement = receipt;
      } catch (retirementError) { error.retirementError = retirementError; }
      op.ready.reject(error); op.active.reject(error);
    })();
  };
  const start = (kind, { signal, timeoutMs = 30000 } = {}) => {
    check(); signal?.throwIfAborted();
    if (retired || operation || detached || context.state !== 'running' || unsupported || kind === 'capture' && stagedRestore || kind === 'restore' && !stagedRestore ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 || serial >= 0xffffffff || processors.length > 512) throw fail('complete-owned-effect-graph-required');
    let total = 0;
    for (const processor of processors) {
      const capability = processor.stateTransfer;
      if (!processor.ready || capability?.protocol !== PROTOCOL || !natural(capability.bytes) || capability.bytes < 128 || capability.chunkBytes !== 32768 ||
          kind === 'restore' && capability.restoring !== true || processor.health?.muted) throw fail('effect-component-state-unavailable');
      total += capability.bytes;
    }
    if (total > MAX_BYTES) throw fail('effect-state-capacity');
    const op = operation = { id: ++serial, kind, phase: kind === 'capture' ? 'offering' : 'restoring', signal, rows: new Map(processors.map(processor => [processor.nodeId, { processor, length: processor.stateTransfer.bytes, transferred: false, returned: false, phase: 'initial' }])),
      ready: deferred(), active: deferred(), timer: null, abort: null, ending: false, retiring: false, controlCut: null, acquired: null };
    op.abort = () => reject(op, signal.reason instanceof Error ? signal.reason : fail('effect-state-aborted'));
    signal?.addEventListener('abort', op.abort, { once: true });
    op.timer = setTimeout(() => reject(op, fail('effect-state-timeout')), timeoutMs);
    return op;
  };
  const capture = (options = {}) => {
    let op;
    try {
      op = start('capture', options); op.targetAudioFrame = options.targetAudioFrame ?? null; op.selectTargetAudioFrame = options.selectTargetAudioFrame ?? null; op.onTargetAudioFrame = options.onTargetAudioFrame ?? null; op.beforeProducerRetire = options.beforeProducerRetire ?? null;
      if (op.selectTargetAudioFrame !== null && typeof op.selectTargetAudioFrame !== 'function' || op.onTargetAudioFrame !== null && typeof op.onTargetAudioFrame !== 'function' || op.beforeProducerRetire !== null && typeof op.beforeProducerRetire !== 'function') throw fail('invalid-effect-cut-negotiator');
      if (op.targetAudioFrame !== null && !natural(op.targetAudioFrame)) throw fail('invalid-effect-cut-frame');
      for (const row of op.rows.values()) row.processor.node.port.postMessage({ type: 'effect-state-offer', effectStateProtocol: PROTOCOL, requestId: op.id });
      if (!op.rows.size) beginCapture(op);
      return op.ready.promise;
    } catch (error) { if (op) { reject(op, error); return op.ready.promise; } return Promise.reject(error); }
  };
  const beginCapture = op => {
    if (op.phase !== 'offering') throw fail('duplicate-effect-cut-negotiation');
    op.phase = 'planning';
    void (async () => {
      try {
        current(op);
        const grids = [...op.rows.values()].map(row => row.grid);
        let target = op.targetAudioFrame;
        if (op.selectTargetAudioFrame) target = await op.selectTargetAudioFrame(grids.map(grid => Object.freeze({ ...grid })));
        current(op);
        const earliest = Math.ceil((context.currentTime + 0.15) * context.sampleRate), latest = Math.floor((context.currentTime + 1.8) * context.sampleRate);
        target ??= chooseOwnedAudioFrame(grids, earliest, latest);
        if (!natural(target) || target < Math.ceil(context.currentTime * context.sampleRate) || target > latest || chooseOwnedAudioFrame(grids, target, target) !== target) throw fail('effect-cut-frontier-unavailable');
        op.onTargetAudioFrame?.(target); op.targetAudioFrame = target; op.controlCut = captureControls(target); op.phase = 'capturing';
        for (const row of op.rows.values()) row.lease = resources.reserve({ kind: 'effect-dsp-state-cut', owner, generation, bytes: row.length, consumerOwned: true });
        for (const row of op.rows.values()) {
          current(op); const bytes = new Uint8Array(row.length); row.phase = 'copying';
          try { row.processor.node.port.postMessage({ type: 'effect-state-begin', effectStateProtocol: PROTOCOL, requestId: op.id, targetAudioFrame: target, bytes }, [bytes.buffer]); row.transferred = true; }
          catch (error) { row.transferred ||= bytes.byteLength === 0; throw error; }
        }
        if (!op.rows.size) void completeCapture(op);
      } catch (error) { reject(op, error); }
    })();
  };
  const completeCapture = async op => {
    try {
      while (!op.rows.size && !op.ending && context.currentTime * context.sampleRate < op.targetAudioFrame) await new Promise(resolve => setTimeout(resolve, 10));
      if (op.ending) return;
      current(op); op.phase = 'detached'; detached = true;
      const metadata = freezeData(bounded({ schema: 'lemmings-live-effect-cut/v1', graphHash: hash, sampleRate: context.sampleRate, audioFrame: op.targetAudioFrame,
        controlState: op.controlCut.value(), hostState: captureHost(op.targetAudioFrame), validation: 'captured-awaiting-independent-validation',
        sourceCoverage: 'separate-common-frame-source-cut-required', nativeHiddenState: false, portableNodeReferences: false }));
      op.beforeProducerRetire?.(Object.freeze({ audioFrame: op.targetAudioFrame, sampleRate: context.sampleRate, graphHash: hash, hostState: metadata.hostState, controlState: metadata.controlState }));
      let components = [...op.rows.values()].map(row => row.component), image = metadata;
      op.retiring = true; const receipt = retire(); await receipt?.completion;
      if (receipt?.outcome !== 'complete') throw Object.assign(fail('effect-cut-producer-retirement-unresolved'), { retirement: receipt });
      op.signal?.throwIfAborted(); if (op.ending) return;
      clean(op); op.ending = true;
      op.ready.resolve(Object.freeze({ metadata: () => image, components: () => { if (!components) throw fail('effect-cut-released'); return components; },
        release() { if (!components) return false; components = image = null; for (const row of op.rows.values()) { row.component = null; row.lease?.release(); } op.rows.clear(); op.controlCut.release(); op.controlCut = null; return true; } }));
    } catch (error) { reject(op, error); }
  };
  const activate = (op, frame) => {
    try {
      current(op);
      if (op.phase !== 'staged' || !natural(frame) || frame < Math.ceil((context.currentTime + 0.02) * context.sampleRate) ||
          frame > Math.floor((context.currentTime + 1.8) * context.sampleRate) || chooseOwnedAudioFrame(op.grids, frame, frame) !== frame) throw fail('effect-activation-frontier-unavailable');
      restoreControls(op.acquired.value.metadata.controlState, frame);
      restoreHost(op.acquired.value.metadata.hostState, op.acquired.value.metadata.audioFrame, frame);
      op.activationFrame = frame; op.phase = 'armed';
      for (const row of op.rows.values()) { row.phase = 'armed'; row.processor.node.port.postMessage({ type: 'effect-state-activate', effectStateProtocol: PROTOCOL, requestId: op.id, startAfterFrame: frame }); }
      if (!op.rows.size) void completeActivation(op);
    } catch (error) { reject(op, error); }
    return op.active.promise;
  };
  const completeActivation = async op => {
    try {
      current(op); op.phase = 'active'; await releasePrepared(op); current(op);
      clean(op); operation = null; stagedRestore = false; op.ending = true;
      op.active.resolve(Object.freeze({ status: 'accepted', stage: 'effect-continuation-active', graphHash: hash, sourceAudioFrame: op.sourceAudioFrame,
        audioFrame: op.activationFrame, sampleRate: context.sampleRate, components: op.rows.size, acousticReceipt: false }));
    } catch (error) { reject(op, error); }
  };
  const stage = (ticket, options = {}) => {
    let op;
    try {
      op = start('restore', options); op.acquired = acquireOwnedEffectContinuation(ticket);
      const value = op.acquired.value;
      if (value?.schema !== 'lemmings-prepared-effect-cut/v1' || value.validation !== 'worker-restored-pinned-effect-components' || value.metadata.graphHash !== hash ||
          value.metadata.sampleRate !== context.sampleRate || value.components.length !== op.rows.size) throw fail('effect-prepared-identity-differs');
      op.sourceAudioFrame = value.metadata.audioFrame;
      const seen = new Set();
      for (const component of value.components) {
        const row = op.rows.get(component.nodeId);
        if (!row || seen.has(component.nodeId) || row.processor.kind !== component.kind || !exclusive(component.bytes, row.length)) throw fail('effect-prepared-inventory-differs');
        seen.add(component.nodeId); row.component = component;
      }
      for (const row of op.rows.values()) {
        current(op); const component = row.component; row.phase = 'restoring';
        try { row.processor.node.port.postMessage({ ...component, type: 'effect-state-restore', effectStateProtocol: PROTOCOL, requestId: op.id, validation: value.validation }, [component.bytes.buffer]); row.transferred = true; }
        catch (error) { row.transferred ||= component.bytes.byteLength === 0; throw error; }
      }
      if (!op.rows.size) finishStage(op);
      return op.ready.promise;
    } catch (error) { if (op) { reject(op, error); return op.ready.promise; } return Promise.reject(error); }
  };
  const finishStage = op => {
    current(op); op.phase = 'staged';
    op.grids = [...op.rows.values()].flatMap(row => [row.grid, { frame: row.component.logicalAudioFrame, frames: row.processor.stateTransfer.alignmentFrames }]);
    op.ready.resolve(Object.freeze({ schema: 'lemmings-staged-effect-graph/v1', graphHash: hash, sourceAudioFrame: op.sourceAudioFrame,
      grids: () => op.grids.map(grid => ({ ...grid })), activate: frame => activate(op, frame),
      cancel: () => { reject(op, fail('effect-staging-canceled')); return op.active.promise.catch(() => {}); } }));
  };
  const consume = (processor, data) => {
    if (data?.effectStateProtocol !== PROTOCOL || !data.type?.startsWith('effect-state-')) return false;
    const op = operation, row = op?.rows.get(processor.nodeId);
    if (!op || op.ending || !row || data.requestId !== op.id) return true;
    try {
      current(op);
      if (exclusive(data.bytes, row.length)) { row.returned = true; if (row.component) row.component.bytes = data.bytes; }
      if (data.type === 'effect-state-error') throw fail(data.reason || 'effect-state-refused');
      if (data.type === 'effect-state-offered') {
        if (op.phase !== 'offering' || row.phase !== 'initial' || data.bytes !== row.length || data.chunkBytes !== 32768 || !natural(data.blockFrame) || !natural(data.blockFrames) || data.blockFrames < 1 || data.blockFrames > 16384) throw fail('invalid-effect-state-offer');
        row.grid = { frame: data.blockFrame, frames: data.blockFrames }; row.phase = 'offered';
        if ([...op.rows.values()].every(entry => entry.phase === 'offered')) beginCapture(op);
      } else if (data.type === 'effect-state-complete') {
        if (op.phase !== 'capturing' || row.phase !== 'copying' || !row.returned || data.audioFrame !== op.targetAudioFrame || !natural(data.logicalAudioFrame) || !natural(data.sourceFrame) ||
            data.sourceClock !== 'frozen-at-common-audio-block-boundary') throw fail('invalid-effect-state-result');
        row.component = { nodeId: processor.nodeId, kind: processor.kind, audioFrame: data.audioFrame, logicalAudioFrame: data.logicalAudioFrame, sourceFrame: data.sourceFrame, hostState: bounded(data.hostState), bytes: data.bytes };
        row.phase = 'detached'; if ([...op.rows.values()].every(entry => entry.phase === 'detached')) void completeCapture(op);
      } else if (data.type === 'effect-state-staged') {
        if (op.phase !== 'restoring' || row.phase !== 'restoring' || !row.returned || data.sourceFrame !== row.component.sourceFrame || data.sourceAudioFrame !== op.sourceAudioFrame ||
            data.logicalAudioFrame !== row.component.logicalAudioFrame || !natural(data.blockFrame) || !natural(data.blockFrames) || data.blockFrames < 1 || data.blockFrames > 16384) throw fail('invalid-effect-staged-result');
        row.grid = { frame: data.blockFrame, frames: data.blockFrames }; row.phase = 'staged';
        if (processor.kind === 'spectral-freeze') processor.spectralSerial = row.component.hostState.reportedCapture;
        if ([...op.rows.values()].every(entry => entry.phase === 'staged')) finishStage(op);
      } else if (data.type === 'effect-state-activated') {
        if (op.phase !== 'armed' || row.phase !== 'armed' || data.audioFrame !== op.activationFrame || data.logicalAudioFrame !== row.component.logicalAudioFrame ||
            data.sourceFrame !== row.component.sourceFrame || data.frameOffset !== row.component.logicalAudioFrame - op.activationFrame) throw fail('invalid-effect-activation-result');
        row.phase = 'active'; if ([...op.rows.values()].every(entry => entry.phase === 'active')) void completeActivation(op);
      } else throw fail('unexpected-effect-state-message');
    } catch (error) { reject(op, error); }
    return true;
  };
  for (const processor of processors) processor.effectStateOwner = { consume: data => consume(processor, data) };
  return Object.freeze({ capture, stage, fenced,
    assertMutable() { if (fenced()) throw fail('effect-graph-state-fenced'); },
    retired(confirmed) { retired = true; const op = operation; if (op && !op.retiring && !op.ending) reject(op, fail(confirmed ? 'effect-graph-retired' : 'effect-graph-retirement-unresolved')); },
    diagnostics: () => ({ phase: operation?.phase || (stagedRestore ? 'restore-muted' : detached ? 'detached' : 'idle'), protocol: PROTOCOL, maximumBytes: MAX_BYTES, sourceCoverage: 'separate-common-frame-source-cut-required' }) });
}
