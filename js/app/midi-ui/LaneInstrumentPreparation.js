import { validateSoundContentReference, resolveSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const keyFor = reference => reference.packHash + ':' + reference.definitionHash;

export function createLaneInstrumentPreparation({ session, routed, getCatalog = getNativeInstrumentCatalog, onState = () => {} } = {}) {
  if (!session?.createInstrumentBackend || !routed?.assign || typeof getCatalog !== 'function' || typeof onState !== 'function') throw new TypeError('Invalid lane preparation owner.');
  const pending = new Set(), laneRequests = new Map(), observed = new Map(), failures = new Map(), unknown = new Set(), queued = new Map();
  const retirement = createProcgenRetirementScope(); let disposed = false, serial = 0, pumping = null;
  const report = (laneId, state, code = null) => { try { onState(Object.freeze({ laneId, state, code })); } catch { /* Views cannot publish instruments. */ } };
  const prepare = async (laneId, raw, { signal: externalSignal } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || unknown.size || pending.size >= 2) throw failure('instrument-preparation-capacity', 'Lane instrument preparation is unavailable or busy.');
    if (typeof laneId !== 'string' || !laneId || laneId.length > 160) throw new TypeError('Invalid lane identity.');
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
      const settle = receipt => { if (receipt.outcome !== 'complete') { unknown.add(operation); report(laneId, 'retirement-unknown', 'retirement-unknown'); } complete(receipt); };
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
      if (!['native-oscillator', 'worklet-sine'].includes(resolution.patch.engineId) || resolution.patch.modulations.length || resolution.patch.causalBindings.length ||
          resolution.patch.macros.length || reference.assetHashes.length) throw failure('instrument-adapter-unavailable', 'This lane instrument needs a realized material or gesture adapter.');
      if (!operation.pin) {
        operation.backend = resolution.patch.engineId === 'worklet-sine' ? await session.createWorkletInstrumentBackend() : session.createInstrumentBackend({ gateMode: 'owned' }); check();
      } else operation.backend = operation.pin.backend;
      const ready = await operation.backend.prepare(resolution); check(); if (ready?.status !== 'ready') throw failure(ready?.reason || 'preparation-rejected', 'Lane renderer rejected the pinned patch.');
      check(); operation.preparing = false;
      const releaseSeconds = resolution.patch.parameters.releaseSeconds ?? 0.04, oneShotTailSeconds = Math.min(4, Math.max(0.04,
        (resolution.patch.parameters.attackSeconds ?? 0.008) + (resolution.patch.parameters.decaySeconds ?? 0.05)));
      return Object.freeze({ reference,
        commit() {
          check(); if (operation.retired) throw failure('candidate-retired', 'Lane instrument candidate was retired.');
          routed.assign(laneId, key, operation.backend, { releaseSeconds, oneShotTailSeconds }); operation.committed = true;
          observed.set(laneId, key); failures.delete(laneId); release(); report(laneId, 'ready'); return reference;
        }, release });
    } catch (error) { operation.preparing = false; const receipt = release(); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; } report(laneId, 'unavailable', error.code || 'preparation-failed'); throw error; }
  };
  const synchronize = lanes => {
    if (disposed || !Array.isArray(lanes) || lanes.length > 64) return Promise.reject(failure('owner-retired', 'Lane instrument synchronization is unavailable.'));
    const live = new Set(lanes.map(lane => lane.id));
    for (const laneId of observed.keys()) if (!live.has(laneId)) { laneRequests.get(laneId)?.controller.abort(); routed.unassign(laneId); observed.delete(laneId); failures.delete(laneId); queued.delete(laneId); }
    for (const lane of lanes) {
      const reference = validateSoundContentReference(lane.instrumentRef), key = reference && keyFor(reference);
      if (observed.get(lane.id) === key || failures.get(lane.id)?.key === key || laneRequests.get(lane.id)?.referenceKey === key) continue;
      laneRequests.get(lane.id)?.controller.abort(); observed.set(lane.id, key);
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
    diagnostics: () => Object.freeze({ pending: pending.size, queued: queued.size, unknownRetirement: unknown.size, failures: Object.freeze([...failures].map(([laneId, value]) => ({ laneId, code: value.code }))), disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      queued.clear(); for (const operation of pending) operation.controller.abort(failure('owner-retired', 'Lane instrument owner retired.'));
      return retirement.retire([...pending, ...unknown].map((operation, index) => ({ name: 'candidate-' + index, run: () => operation.release() })));
    }
  });
}
