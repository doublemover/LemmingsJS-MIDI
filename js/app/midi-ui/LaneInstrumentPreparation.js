import { validateSoundContentReference, resolveSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const keyFor = reference => reference.packHash + ':' + reference.definitionHash;
let nextPreparationOwner = 0;

export function createLaneInstrumentPreparation({ session, routed, getCatalog = getNativeInstrumentCatalog, onState = () => {}, maxLanes = 1024, resourceBudget = null, getMaterialProvider = null } = {}) {
  if (!session?.createInstrumentBackend || !routed?.assign || typeof getCatalog !== 'function' || typeof onState !== 'function' || !Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 1024) throw new TypeError('Invalid lane preparation owner.');
  const pending = new Set(), laneRequests = new Map(), observed = new Map(), observedReferences = new Map(), failures = new Map(), unknown = new Set(), queued = new Map();
  const metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: 'lane-instruments-' + (++nextPreparationOwner), kind: 'lane-instrument-inputs', category: 'audio', bytes: 4096 });
  const reserveInputs = (laneCount = 0, nextPending = pending.size) => metadata.resize(4096 + Math.max(laneCount, observed.size, queued.size, laneRequests.size) * 2048 +
    (nextPending + unknown.size) * 2 * 1048576);
  const retirement = createProcgenRetirementScope(); let disposed = false, serial = 0, pumping = null;
  const report = (laneId, state, code = null) => { try { onState(Object.freeze({ laneId, state, code })); } catch { /* Views cannot publish instruments. */ } };
  const prepare = async (laneId, raw, { signal: externalSignal, retainPrevious = false } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || unknown.size || pending.size >= 2) throw failure('instrument-preparation-capacity', 'Lane instrument preparation is unavailable or busy.');
    if (typeof laneId !== 'string' || !laneId || laneId.length > 160) throw new TypeError('Invalid lane identity.');
    const reference = validateSoundContentReference(raw);
    if (!reference) throw failure('invalid-sound-reference', 'Lane preparation needs a pinned instrument definition.');
    const key = keyFor(reference);
    if (!routed.canAssign(key)) throw failure('instrument-retirement-capacity', 'Prior held voices still occupy renderer capacity.');
    if (!Number.isSafeInteger(serial + 1)) throw failure('instrument-identity-exhausted', 'Lane instrument preparation identity is exhausted.');
    if (retainPrevious && typeof routed.retainAssignment !== 'function') throw failure('instrument-rollback-unavailable', 'This renderer cannot retain its previous lane assignment.');
    reserveInputs(0, pending.size + 1);
    let complete; const previousKey = observed.get(laneId), previousReference = observedReferences.get(laneId);
    let previousAssignment, pin;
    try { previousAssignment = retainPrevious ? routed.retainAssignment(laneId) : null; pin = routed.retain(key); }
    catch (error) { previousAssignment?.release(); reserveInputs(); throw error; }
    const operation = { id: ++serial, laneId, referenceKey: key, controller: new AbortController(), backend: null, material: null, pin, rollbackFailed: false, committed: false, accepted: false, assignmentReceipt: null,
      retired: false, preparing: true, retirement: null, nativeRetirement: null, completion: new Promise(resolve => { complete = resolve; }) };
    const signal = operation.controller.signal, cancel = () => operation.controller.abort(externalSignal.reason);
    const check = () => { signal.throwIfAborted(); if (disposed || laneRequests.get(laneId) !== operation) throw failure('stale-owner', 'Lane instrument preparation source changed.'); };
    const release = () => {
      if (operation.retired) return operation.retirement || operation.retirementScope?.getReceipt();
      if (operation.preparing) return operation.completion; operation.retired = true;
      externalSignal?.removeEventListener('abort', cancel); pending.delete(operation); if (laneRequests.get(laneId) === operation) laneRequests.delete(laneId);
      operation.retirementScope = createProcgenRetirementScope();
      operation.retirement = operation.retirementScope.retire([
        { name: 'previous-assignment-rollback', run: () => { if (operation.committed && !operation.accepted && previousAssignment) { let result; try { result = previousAssignment.restore(operation.assignmentReceipt); } catch (error) { operation.rollbackFailed = true; throw error; } if (result.status === 'restored') { if (previousKey === undefined) observed.delete(laneId); else observed.set(laneId, previousKey); if (previousReference === undefined) observedReferences.delete(laneId); else observedReferences.set(laneId, previousReference); report(laneId, 'restored'); } return result; } } },
        { name: 'previous-assignment-pin', run: () => { if (operation.rollbackFailed) throw failure('retirement-unknown', 'Previous renderer remains pinned after an unacknowledged rollback.'); return previousAssignment?.release(); } },
        { name: 'candidate-pin', run: () => operation.pin?.release() },
        { name: 'decoded-material', run: () => operation.material?.release() },
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
      if (reference.assetHashes.length) {
        if (typeof getMaterialProvider !== 'function') throw failure('material-adapter-unavailable', 'Local sound material preparation is unavailable.');
        operation.material = await getMaterialProvider().acquire({ reference, engineDescriptors: catalog.descriptors,
          owner: 'lane:' + laneId, generation: operation.id, signal, isCurrent: () => !disposed && laneRequests.get(laneId) === operation }); check();
      }
      const resolution = await resolveSoundContentReference(reference, { engineDescriptors: catalog.descriptors, availableHashes: operation.material?.availableHashes || [], signal }); check();
      if (resolution.status !== 'ready') throw failure(resolution.status, 'Pinned lane instrument requirement is unavailable: ' + resolution.status);
      if (!['native-oscillator', 'native-fm', 'native-modal', 'native-sample', 'worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers', 'worklet-texture', 'worklet-friction', 'worklet-wind'].includes(resolution.patch.engineId) || resolution.patch.modulations.length ||
          resolution.patch.engineId === 'worklet-sine' && (resolution.patch.macros.length || resolution.patch.causalBindings.length || resolution.patch.variation) || reference.assetHashes.length && !['worklet-granular', 'native-sample', 'worklet-sample', 'worklet-seed-layers'].includes(resolution.patch.engineId)) throw failure('instrument-adapter-unavailable', 'This lane instrument needs a realized material or gesture adapter.');
      if (!operation.pin) {
        if (resolution.patch.engineId === 'native-sample') {
          if (!session.createSampleInstrumentBackend) throw failure('sample-adapter-unavailable', 'This lane session cannot prepare mapped samples.');
          operation.backend = await session.createSampleInstrumentBackend({ gateMode: 'owned' });
        } else operation.backend = ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers', 'worklet-texture', 'worklet-friction', 'worklet-wind'].includes(resolution.patch.engineId) ? await session.createWorkletInstrumentBackend({ engineId: resolution.patch.engineId }) : session.createInstrumentBackend({ gateMode: 'owned', engineId: resolution.patch.engineId }); check();
      } else operation.backend = operation.pin.backend;
      const ready = await operation.backend.prepare(resolution, operation.material?.assets || []); check(); if (ready?.status !== 'ready') throw failure(ready?.reason || 'preparation-rejected', 'Lane renderer rejected the pinned patch.');
      if (operation.material) {
        const materialRetirement = operation.material.release(); await materialRetirement.completion; check();
        if (materialRetirement.outcome !== 'complete') throw Object.assign(failure('retirement-unknown', 'Lane material retirement is unknown.'), { retirement: materialRetirement });
        operation.material = null;
      }
      check(); operation.preparing = false;
      const { releaseSeconds, oneShotTailSeconds } = resolveOwnedArticulationPolicy(resolution.patch);
      return Object.freeze({ reference,
        commit() {
          check(); if (operation.retired || operation.committed) throw failure('candidate-retired', 'Lane instrument candidate was retired or already committed.');
          operation.assignmentReceipt = routed.assign(laneId, key, operation.backend, { releaseSeconds, oneShotTailSeconds, bodyId: resolution.patch.id, macroIds: (resolution.patch.macros || []).map(macro => macro.id) }); operation.committed = true;
          observed.set(laneId, key); observedReferences.set(laneId, raw); failures.delete(laneId); if (!retainPrevious) { operation.accepted = true; release(); report(laneId, 'ready'); } return reference;
        }, accept() { check(); if (!operation.committed || operation.retired) throw failure('candidate-not-published', 'Only a live committed candidate can be accepted.'); operation.accepted = true; release(); report(laneId, 'ready'); return reference; }, release });
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
