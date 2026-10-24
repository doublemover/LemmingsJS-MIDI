import { validateSoundContentReference, resolveSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const keyFor = reference => reference.packHash + ':' + reference.definitionHash;
let nextPreparationOwner = 0;

export function createLaneInstrumentPreparation({ session, routed, getCatalog = getNativeInstrumentCatalog, onState = () => {}, maxLanes = 1024, resourceBudget = null } = {}) {
  if (!session?.createInstrumentBackend || !routed?.assign || typeof getCatalog !== 'function' || typeof onState !== 'function' || !Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 1024) throw new TypeError('Invalid lane preparation owner.');
  const pending = new Set(), laneRequests = new Map(), observed = new Map(), observedReferences = new Map(), failures = new Map(), unknown = new Set(), queued = new Map();
  const metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: 'lane-instruments-' + (++nextPreparationOwner), kind: 'lane-instrument-inputs', category: 'audio', bytes: 4096 });
  const reserveInputs = (laneCount = 0, nextPending = pending.size) => metadata.resize(4096 + Math.max(laneCount, observed.size, queued.size, laneRequests.size) * 2048 +
    (nextPending + unknown.size) * 2 * 1048576);
  const retirement = createProcgenRetirementScope(); let disposed = false, serial = 0, pumping = null;
  const report = (laneId, state, code = null) => { try { onState(Object.freeze({ laneId, state, code })); } catch { /* Views cannot publish instruments. */ } };
  const prepare = async (laneId, raw, { signal: externalSignal } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || unknown.size || pending.size >= 2) throw failure('instrument-preparation-capacity', 'Lane instrument preparation is unavailable or busy.');
    if (typeof laneId !== 'string' || !laneId || laneId.length > 160) throw new TypeError('Invalid lane identity.');
    reserveInputs(0, pending.size + 1);
    const reference = validateSoundContentReference(raw);
    if (!reference) throw failure('invalid-sound-reference', 'Lane preparation needs a pinned instrument definition.');
    const key = keyFor(reference);
    if (!routed.canAssign(key)) throw failure('instrument-retirement-capacity', 'Prior held voices still occupy renderer capacity.');
    let complete;
    const operation = { id: ++serial, laneId, referenceKey: key, controller: new AbortController(), backend: null, pin: routed.retain(key), committed: false,
      retired: false, preparing: true, retirement: null, nativeRetirement: null, completion: new Promise(resolve => { complete = resolve; }) };
    const signal = operation.controller.signal, cancel = () => operation.controller.abort(externalSignal.reason);
    const check = () => { signal.throwIfAborted(); if (disposed || laneRequests.get(laneId) !== operation) throw failure('stale-owner', 'Lane instrument preparation source changed.'); };
    const release = () => {
      if (operation.retired) return operation.retirement || operation.retirementScope?.getReceipt();
      if (operation.preparing) return operation.completion; operation.retired = true;
      externalSignal?.removeEventListener('abort', cancel); pending.delete(operation); if (laneRequests.get(laneId) === operation) laneRequests.delete(laneId);
      operation.retirementScope = createProcgenRetirementScope();
      operation.retirement = operation.retirementScope.retire([
        { name: 'candidate-pin', run: () => operation.pin?.release() },
        { name: 'unpublished-renderer', run: () => { if (!operation.committed && !operation.pin) return operation.nativeRetirement || operation.backend?.dispose(); } }
      ]);
      const settle = receipt => { if (receipt.outcome !== 'complete') { unknown.add(operation); report(laneId, 'retirement-unknown', 'retirement-unknown'); }
        if (!disposed) { try { reserveInputs(); } catch { /* A bookkeeping fault remains charged by its owner. */ } } complete(receipt); };
      if (operation.retirement.state === 'retired') settle(operation.retirement); else operation.retirement.completion.then(settle);
      return operation.retirement;
    };
    operation.release = release; laneRequests.get(laneId)?.controller.abort(failure('stale-owner', 'A newer lane instrument candidate replaced this preparation.'));
    laneRequests.set(laneId, operation); pending.add(operation); externalSignal?.addEventListener('abort', cancel, { once: true });
    signal.addEventListener('abort', () => {
      if (operation.preparing && operation.backend && !operation.pin) operation.nativeRetirement ||= createProcgenRetirementScope().retire([{ name: 'candidate-renderer', run: () => operation.backend.dispose() }]);
      else if (!operation.preparing) release();
    }, { once: true });
    if (externalSignal?.aborted) cancel(); report(laneId, 'preparing');
    try {
      check(); const catalog = await getCatalog(); check();
      const resolution = await resolveSoundContentReference(reference, { engineDescriptors: catalog.descriptors, availableHashes: [], signal }); check();
      if (resolution.status !== 'ready') throw failure(resolution.status, 'Pinned lane instrument requirement is unavailable: ' + resolution.status);
      if (!['native-oscillator', 'native-fm', 'native-modal', 'worklet-sine', 'worklet-pluck'].includes(resolution.patch.engineId) || resolution.patch.modulations.length ||
          resolution.patch.engineId === 'worklet-sine' && (resolution.patch.macros.length || resolution.patch.causalBindings.length || resolution.patch.variation) || reference.assetHashes.length) throw failure('instrument-adapter-unavailable', 'This lane instrument needs a realized material or gesture adapter.');
      if (!operation.pin) {
        operation.backend = ['worklet-sine', 'worklet-pluck'].includes(resolution.patch.engineId) ? await session.createWorkletInstrumentBackend({ engineId: resolution.patch.engineId }) : session.createInstrumentBackend({ gateMode: 'owned', engineId: resolution.patch.engineId }); check();
      } else operation.backend = operation.pin.backend;
      const ready = await operation.backend.prepare(resolution); check(); if (ready?.status !== 'ready') throw failure(ready?.reason || 'preparation-rejected', 'Lane renderer rejected the pinned patch.');
      check(); operation.preparing = false;
      const { releaseSeconds, oneShotTailSeconds } = resolveOwnedArticulationPolicy(resolution.patch);
      return Object.freeze({ reference,
        commit() {
          check(); if (operation.retired) throw failure('candidate-retired', 'Lane instrument candidate was retired.');
          routed.assign(laneId, key, operation.backend, { releaseSeconds, oneShotTailSeconds }); operation.committed = true;
          observed.set(laneId, key); observedReferences.set(laneId, raw); failures.delete(laneId); release(); report(laneId, 'ready'); return reference;
        }, release });
    } catch (error) { operation.preparing = false; const receipt = release(); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; } report(laneId, 'unavailable', error.code || 'preparation-failed'); throw error; }
  };
  const synchronize = lanes => {
    if (disposed || !Array.isArray(lanes) || lanes.length > maxLanes) return Promise.reject(failure('owner-retired', 'Lane instrument synchronization is unavailable.'));
    try { reserveInputs(lanes.length); } catch (error) { return Promise.reject(error); }
    const live = new Set(lanes.map(lane => lane.id));
    for (const laneId of laneRequests.keys()) if (!live.has(laneId)) laneRequests.get(laneId)?.controller.abort();
    for (const laneId of observedReferences.keys()) if (!live.has(laneId)) { laneRequests.get(laneId)?.controller.abort(); routed.unassign(laneId); observed.delete(laneId); observedReferences.delete(laneId); failures.delete(laneId); queued.delete(laneId); }
    for (const lane of lanes) {
      const reference = lane.instrumentRef, key = reference && keyFor(reference);
      const sameReference = reference == null || Object.isFrozen(reference) && observedReferences.get(lane.id) === reference;
      if (sameReference && (observed.get(lane.id) === key || failures.get(lane.id)?.key === key || laneRequests.get(lane.id)?.referenceKey === key)) continue;
      laneRequests.get(lane.id)?.controller.abort(); observed.set(lane.id, key); observedReferences.set(lane.id, reference);
      if (!reference) { routed.unassign(lane.id); failures.delete(lane.id); queued.delete(lane.id); continue; }
      routed.block(lane.id, 'instrument-preparing'); queued.set(lane.id, { laneId: lane.id, reference, key });
    }
    if (pumping) return pumping;
    if (!queued.size) return Promise.resolve(Object.freeze([]));
    const run = async () => { const results = new Map();
      while (queued.size && !disposed) {
        const entry = queued.values().next().value; queued.delete(entry.laneId);
        if (disposed || observed.get(entry.laneId) !== entry.key) continue;
        try { const candidate = await prepare(entry.laneId, entry.reference);
          try { if (disposed || observed.get(entry.laneId) !== entry.key) throw failure('stale-owner', 'Saved lane instrument changed while preparing.'); candidate.commit(); results.set(entry.laneId, { laneId: entry.laneId, state: 'ready' }); }
          finally { candidate.release(); }
        } catch (error) {
          if (!disposed && observed.get(entry.laneId) === entry.key) { const code = error.code || 'preparation-failed'; failures.set(entry.laneId, { key: entry.key, code }); routed.block(entry.laneId, code); }
          results.set(entry.laneId, { laneId: entry.laneId, state: 'unavailable', code: error.code || 'preparation-failed' });
        }
      }
      return Object.freeze([...results.values()]);
    };
    const finish = () => { pumping = null; if (queued.size && !disposed) { pumping = run().finally(finish); pumping.catch(() => {}); } };
    pumping = run().finally(finish); return pumping;
  };
  return Object.freeze({ prepare, synchronize,
    retry(lanes) { for (const laneId of failures.keys()) observed.delete(laneId); failures.clear(); return synchronize(lanes); },
    diagnostics: () => Object.freeze({ pending: pending.size, queued: queued.size, maxLanes, metadata: metadata.receipt(), unknownRetirement: unknown.size, failures: Object.freeze([...failures].map(([laneId, value]) => ({ laneId, code: value.code }))), disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      const accepted = [...new Set([...pending, ...unknown])];
      queued.clear(); for (const operation of accepted) operation.controller.abort(failure('owner-retired', 'Lane instrument owner retired.'));
      let candidates;
      return retirement.retire([{ name: 'accepted-candidates', run: () => candidates = createProcgenRetirementScope().retire(accepted
        .map((operation, index) => ({ name: 'candidate-' + index, run: () => operation.release() }))) },
      { name: 'preparation-metadata', run: async () => { await candidates.completion; if (candidates.outcome !== 'complete') throw failure('retirement-unknown', 'Lane preparation metadata has unresolved candidates.');
        observed.clear(); observedReferences.clear(); failures.clear(); queued.clear(); laneRequests.clear(); metadata.release(); } }]);
    }
  });
}
