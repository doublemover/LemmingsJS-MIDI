import { cloneData } from '../../core/CanonicalData.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { chooseOwnedAudioFrame } from './OwnedAudioFrame.js';
import { prepareOwnedSourceContinuation } from './OwnedSourceContinuation.js';
import { prepareOwnedEffectContinuation } from './OwnedEffectContinuation.js';

const tickets = new WeakMap();
const failure = code => Object.assign(new Error('Audio continuation: ' + code), { name: 'AudioRestoreError', code });
const deferred = () => { let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const sourceInventory = (sources, method) => {
  if (!Array.isArray(sources) || sources.length > 16 || new Set(sources.map(row => row?.sourceId)).size !== sources.length ||
      sources.some(row => typeof row?.sourceId !== 'string' || !row.sourceId || row.sourceId.length > 160 || typeof row.backend?.[method] !== 'function' || typeof row.backend?.dispose !== 'function')) throw failure('complete-owned-source-inventory-required');
  return sources;
};
const linkAbort = (signal, controller) => {
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  return () => signal?.removeEventListener('abort', abort);
};
const retireSources = async sources => {
  const receipt = createProcgenRetirementScope({ deadlineMs: 20000 }).retire(sources.map(row => ({ name: row.sourceId, run: () => row.backend.dispose() })));
  await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(failure('audio-source-producer-retirement-unresolved'), { retirement: receipt });
};
const releaseTickets = async (entry, ticket) => {
  entry.busy = false; const receipt = ticket.release(); await receipt?.completion;
  if (receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(failure('prepared-audio-retirement-unresolved'), { retirement: receipt });
};

export async function captureOwnedAudioContinuation({ context, sources, rack = null, graphRevision, semanticBoundary = null, captureBindings = null, signal, timeoutMs = 30000, assertCoverage = () => {} } = {}) {
  sourceInventory(sources, 'detachSourceState');
  if (context?.state !== 'running' || !Number.isSafeInteger(graphRevision) || graphRevision < 0 || graphRevision > 0xffffffff ||
      !sources.length && !rack || rack && typeof rack.detachState !== 'function' || typeof assertCoverage !== 'function' || captureBindings !== null && typeof captureBindings !== 'function') throw failure('running-owned-audio-cone-required');
  const controller = new AbortController(), unlink = linkAbort(signal, controller), target = deferred(), effectsDetached = deferred(), grids = new Map();
  const operations = [], expected = sources.length + (rack ? 1 : 0); let audioFrame = null, bindingState = null;
  const select = id => incoming => {
    controller.signal.throwIfAborted(); assertCoverage();
    if (grids.has(id)) throw failure('duplicate-producer-cut-offer');
    grids.set(id, incoming);
    if (grids.size === expected) {
      audioFrame = chooseOwnedAudioFrame([...grids.values()].flat(), Math.ceil((context.currentTime + 0.2) * context.sampleRate), Math.floor((context.currentTime + 1.8) * context.sampleRate));
      target.resolve(audioFrame);
    }
    return target.promise;
  };
  const observeFailure = promise => Promise.resolve(promise).catch(error => { target.reject(error); effectsDetached.reject(error); controller.abort(error); throw error; });
  try {
    assertCoverage(); controller.signal.throwIfAborted();
    if (rack) {
      const promise = observeFailure(Promise.resolve().then(() => rack.detachState({ signal: controller.signal, timeoutMs, selectTargetAudioFrame: select('rack'), beforeProducerRetire: frontier => { assertCoverage(); bindingState = captureBindings ? cloneData(captureBindings(frontier), { maxBytes: 2 * 1048576, maxNodes: 131072 }) : null; } })).then(cut => { effectsDetached.resolve(); return cut; }));
      operations.push({ kind: 'rack', promise });
    } else effectsDetached.resolve();
    for (const source of sources) operations.push({ kind: 'source', sourceId: source.sourceId,
      promise: observeFailure(Promise.resolve().then(() => source.backend.detachSourceState({ graphRevision, signal: controller.signal, timeoutMs, selectTargetAudioFrame: select('source:' + source.sourceId), retireAfter: effectsDetached.promise }))) });
    const results = await Promise.allSettled(operations.map(operation => operation.promise));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) { for (const result of results) if (result.status === 'fulfilled') result.value.release(); throw failed.reason; }
    const ownedSources = [], rackResult = results[operations.findIndex(operation => operation.kind === 'rack')]?.value || null;
    for (let index = 0; index < operations.length; index++) if (operations[index].kind === 'source') ownedSources.push({ sourceId: operations[index].sourceId, cut: results[index].value });
    try {
      controller.signal.throwIfAborted(); await retireSources(sources); assertCoverage();
      for (const row of ownedSources) if (row.cut.metadata().audioFrame !== audioFrame || row.cut.metadata().cut.sampleRate !== context.sampleRate || row.cut.metadata().cut.graphRevision !== graphRevision) throw failure('source-cut-common-frontier-differs');
      if (rackResult && rackResult.metadata().audioFrame !== audioFrame) throw failure('rack-cut-common-frontier-differs');
      if (!rack && captureBindings) bindingState = cloneData(captureBindings({ audioFrame, sampleRate: context.sampleRate, graphHash: null, hostState: null, controlState: null }), { maxBytes: 2 * 1048576, maxNodes: 131072 });
      let metadata = cloneData({ schema: 'lemmings-owned-audio-cut/v1', audioFrame, sampleRate: context.sampleRate, graphRevision, semanticBoundary, bindings: bindingState,
        sources: ownedSources.map(row => ({ sourceId: row.sourceId, runtime: row.cut.metadata().runtime, sourceFrame: row.cut.metadata().cut.frame })),
        rack: rackResult?.metadata() || null, scope: 'owned-source-and-creative-rack;shared-master-protection-excluded', validation: 'common-frame-cut-awaiting-worker-validation',
        semanticCoverage: semanticBoundary === null ? 'separate-semantic-checkpoint-required' : 'caller-declared-semantic-boundary;not-physics-hash-proof', qualification: 'awaiting-consolidated-validation' }, { maxBytes: 2 * 1048576, maxNodes: 131072 });
      let released = false;
      return Object.freeze({ schema: 'lemmings-owned-audio-cut/v1', metadata: () => metadata,
        sources: () => { if (released) throw failure('audio-cut-released'); return ownedSources.map(row => Object.freeze({ ...row })); },
        rack: () => { if (released) throw failure('audio-cut-released'); return rackResult; },
        release() { if (released) return false; released = true; metadata = null; for (const row of ownedSources) row.cut.release(); ownedSources.length = 0; rackResult?.release(); return true; } });
    } catch (error) { for (const row of ownedSources) row.cut.release(); rackResult?.release(); throw error; }
  } catch (error) {
    controller.abort(error); target.reject(error); effectsDetached.reject(error);
    try { await retireSources(sources); const receipt = rack?.dispose?.(); await receipt?.completion; if (receipt?.outcome && receipt.outcome !== 'complete') error.rackRetirement = receipt; } catch (retirementError) { error.retirementError = retirementError; }
    throw error;
  } finally { unlink(); }
}

export async function prepareOwnedAudioContinuation({ cut, sources, jobs, resourceBudget, signal, isCurrent = () => true, getCatalog } = {}) {
  const metadata = cut?.metadata?.(), captured = cut?.sources?.(), rack = cut?.rack?.();
  if (metadata?.schema !== 'lemmings-owned-audio-cut/v1' || !Array.isArray(captured) || !Array.isArray(sources) || sources.length !== captured.length ||
      new Set(sources.map(row => row?.sourceId)).size !== sources.length || captured.some(row => !sources.some(input => input.sourceId === row.sourceId))) throw failure('exact-cut-source-references-required');
  const entry = { metadata, sources: [], rack: null, busy: false, released: false, retirement: createProcgenRetirementScope() };
  const ticket = Object.freeze({ schema: 'lemmings-owned-audio-continuation/v1', metadata: () => entry.released ? null : entry.metadata,
    release() {
      if (entry.busy) throw failure('audio-continuation-owned-by-renderers');
      if (entry.released) return entry.retirement.getReceipt(); entry.released = true;
      return entry.retirement.retire([...entry.sources.map(row => ({ name: 'source:' + row.sourceId, run: () => row.ticket.release() })),
        ...(entry.rack ? [{ name: 'creative-rack', run: () => entry.rack.ticket.release() }] : [])]);
    } });
  try {
    for (const row of captured) {
      signal?.throwIfAborted(); if (!isCurrent()) throw failure('audio-preparation-superseded');
      const input = sources.find(input => input.sourceId === row.sourceId);
      const prepared = await prepareOwnedSourceContinuation({ cut: row.cut, reference: input.reference, pcm: input.pcm, jobs, resourceBudget, signal, isCurrent, getCatalog });
      entry.sources.push({ sourceId: row.sourceId, ticket: prepared });
    }
    if (rack) entry.rack = { state: rack.metadata(), ticket: await prepareOwnedEffectContinuation({ cut: rack.graphCut(), definition: rack.definition(), jobs, resourceBudget, signal, isCurrent, getCatalog }) };
    signal?.throwIfAborted(); if (!isCurrent()) throw failure('audio-preparation-superseded');
    tickets.set(ticket, entry); return ticket;
  } catch (error) { try { await releaseTickets(entry, ticket); } catch (retirementError) { error.retirementError = retirementError; } throw error; }
}

export async function restoreOwnedAudioContinuation({ continuation, context, sources, stageRack = null, signal, isCurrent = () => true, beforeArm = () => {}, restoreBindings = null, timeoutMs = 30000 } = {}) {
  sourceInventory(sources, 'restoreSourceState');
  const entry = tickets.get(continuation);
  if (!entry || entry.released || entry.busy || context?.state !== 'running' || context.sampleRate !== entry.metadata.sampleRate ||
      sources.length !== entry.sources.length || sources.some(row => !entry.sources.some(input => input.sourceId === row.sourceId)) ||
      entry.rack && typeof stageRack !== 'function' || typeof beforeArm !== 'function' || entry.metadata.bindings !== null && entry.metadata.bindings !== undefined && typeof restoreBindings !== 'function' || restoreBindings !== null && typeof restoreBindings !== 'function' || typeof isCurrent !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw failure('fresh-matching-audio-destinations-required');
  entry.busy = true;
  const controller = new AbortController(), unlink = linkAbort(signal, controller), planned = deferred(), ready = deferred(), effectsActive = deferred(), grids = new Map(), armed = new Set();
  let rack = null, audioFrame = null, failed = false;
  const check = () => { controller.signal.throwIfAborted(); if (!isCurrent()) throw failure('audio-restoration-superseded'); };
  const abort = error => { if (!failed) { failed = true; controller.abort(error); planned.reject(error); ready.reject(error); effectsActive.reject(error); } };
  const canceled = () => abort(controller.signal.reason instanceof Error ? controller.signal.reason : failure('audio-restoration-aborted'));
  controller.signal.addEventListener('abort', canceled, { once: true });
  const timer = setTimeout(() => abort(failure('audio-restoration-timeout')), timeoutMs);
  const arm = id => {
    if (armed.has(id)) throw failure('duplicate-source-activation-barrier'); armed.add(id);
    if (armed.size === Math.max(1, entry.sources.length)) void (async () => {
      try {
        check(); const frontier = Object.freeze({ audioFrame, sourceAudioFrame: entry.metadata.audioFrame, sampleRate: context.sampleRate,
          ownerRouteRevision: rack?.ownerRouteRevision ?? null, sourceOwnerRouteRevision: entry.rack?.state.sourceOwnerRouteRevision ?? null });
        if (entry.metadata.bindings != null) await restoreBindings(entry.metadata.bindings, frontier);
        await beforeArm(frontier);
        check();
        if (audioFrame < Math.ceil((context.currentTime + 0.02) * context.sampleRate)) throw failure('audio-activation-frontier-missed');
        const activation = rack ? rack.activate(audioFrame) : Promise.resolve(null);
        Promise.resolve(activation).then(effectsActive.resolve, error => { abort(error); effectsActive.reject(error); }); ready.resolve();
      } catch (error) { abort(error); }
    })();
    return { ready: ready.promise, completion: effectsActive.promise };
  };
  const beforeActivate = id => async source => {
    check();
    if (source.sourceAudioFrame !== entry.metadata.audioFrame || source.context !== context || grids.has(id)) throw failure('source-restoration-frontier-differs');
    grids.set(id, { frame: source.blockFrame, frames: source.blockFrames });
    if (grids.size === entry.sources.length) {
      audioFrame = chooseOwnedAudioFrame([...grids.values(), ...(rack?.grids() || [])], Math.ceil((context.currentTime + 0.2) * context.sampleRate), Math.floor((context.currentTime + 1.8) * context.sampleRate));
      planned.resolve(audioFrame);
    }
    const frame = await planned.promise; check();
    return { audioFrame: frame, arm: () => arm(id), cancel: async () => { abort(failure('audio-component-restoration-canceled')); await rack?.cancel(); } };
  };
  try {
    check();
    if (entry.rack) rack = await stageRack(entry.rack.ticket, entry.rack.state, { signal: controller.signal, isCurrent });
    check();
    const operations = entry.sources.map(source => {
      const destination = sources.find(row => row.sourceId === source.sourceId);
      return Promise.resolve().then(() => destination.backend.restoreSourceState({ continuation: source.ticket, bindings: destination.bindings, graphRevision: entry.metadata.graphRevision,
        signal: controller.signal, isCurrent, timeoutMs, beforeActivate: beforeActivate(source.sourceId) })).catch(error => { abort(error); throw error; });
    });
    if (!operations.length) {
      audioFrame = chooseOwnedAudioFrame(rack.grids(), Math.ceil((context.currentTime + 0.2) * context.sampleRate), Math.floor((context.currentTime + 1.8) * context.sampleRate));
      arm('rack-only');
    }
    const results = await Promise.allSettled(operations), rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
    const rackReceipt = await effectsActive.promise; check();
    const receipt = Object.freeze({ status: 'accepted', stage: 'owned-audio-continuation-active', audioFrame, sourceAudioFrame: entry.metadata.audioFrame,
      sampleRate: context.sampleRate, graphRevision: entry.metadata.graphRevision, sources: results.map((result, index) => ({ sourceId: entry.sources[index].sourceId, receipt: result.value })),
      rack: rackReceipt, scope: entry.metadata.scope, qualification: 'awaiting-consolidated-validation', acousticReceipt: false });
    await releaseTickets(entry, continuation); return receipt;
  } catch (error) {
    abort(error); try { await rack?.cancel(); } catch (retirementError) { error.retirementError = retirementError; }
    try { await releaseTickets(entry, continuation); } catch (retirementError) { error.preparedRetirementError = retirementError; } throw error;
  } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', canceled); unlink(); }
}
