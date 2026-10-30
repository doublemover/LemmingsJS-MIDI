import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { validateCavitySoundMap, validateCavitySoundRegion, compileCavitySoundMap } from './physical/CavitySoundMap.js';
import { topologyResultMatchesRegion } from './physical/TopologyInstrumentRegion.js';

export const SCENE_CAVITY_REQUIREMENT = 'owned-cavity-modal-body';
const fail = message => Object.assign(new Error(message), { code: 'scene-cavity-body-unavailable' });
export function validateSceneCavityBody(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['schema', 'map'].includes(key)) || raw.schema !== 'lemmings-scene-cavity-route/v1') throw fail('Use an explicitly authored cavity body route.');
  const map = validateCavitySoundMap(raw.map);
  if (map.bindingPolicy !== 'endOfTick') throw fail('This live cavity route admits completed-tick geometry; local-revision rendering requires a separately retained body route.');
  return freezeData({ schema: raw.schema, map });
}
let ordinal = 0;
export function createSceneCavityBody({ mechanism: raw, getGraph, prepareGraph, getContext, getOwnerState, resourceBudget, onReceipt = () => {} } = {}) {
  const mechanism = validateSceneCavityBody(raw), map = mechanism.map, id = 'scene-cavity-' + (++ordinal), metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-cavity-map', category: 'audio', bytes: canonicalDataText(mechanism).bytes.length * 8 + 65536 }), scope = createProcgenRetirementScope(), qualifiedRevisions = new Set();
  let disposed = false, unknown = false, pending = null, latest = null, selectedRegion = null, epoch = null, version = 0, preparedVersion = -1, expected = null, context = null, model = null, graphRevision = 0, error = null;
  const active = () => { try { const state = getOwnerState(); return !!expected && state?.revision === expected.ownerRouteRevision && state.activeGraph?.hash === expected.graphDefinitionHash && ['active', 'mute'].includes(state.mode); } catch { return false; } };
  const state = () => Object.freeze({ prepared: !!expected && preparedVersion === version && context === getContext() && active(), preparing: !!pending, active: active(), mapId: map.id, mapRevision: map.revision, boundTopologyRevision: latest?.sourceRevision ?? null, preparedTopologyRevision: model?.boundTopologyRevision ?? null, bodyIdentityHash: model?.bodyIdentityHash ?? null, bindings: model?.bindings || [], cost: model?.cost || null, maximumRetainedBodies: map.bodyRecipe === 'throat-duet' ? 4 : 2, error, unknownRetirement: unknown, latencyPolicy: 'original-frame-bounded-buffer;omit-unavailable-no-catch-up', semanticOnsetsAdded: 0 });
  const report = (status, reason = null) => { if (!disposed) try { onReceipt(Object.freeze({ status, stage: 'cavity-body-preparation', reason, ...state(), acousticReceipt: false })); } catch {} };
  const ensure = () => {
    if (disposed || unknown) return Promise.reject(fail('The cavity owner has retired or retains unresolved storage.'));
    if (pending) return pending.promise;
    if (!latest || !selectedRegion) return Promise.resolve(state());
    if (expected && preparedVersion === version && context === getContext()) return Promise.resolve(state());
    const selectedContext = getContext(); if (selectedContext?.state !== 'running') return Promise.resolve(state());
    if (getOwnerState()?.retiringGraphs >= 1) { error = 'waiting-for-previous-body-tail'; return Promise.resolve(state()); }
    let workspace; try { workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'cavity-body-preparation', category: 'candidate', bytes: 2 * 1048576 }); } catch (caught) { error = caught.message; report('rejected', error); return Promise.reject(caught); }
    const operation = { controller: new AbortController(), version, epoch, result: latest, region: selectedRegion, promise: null }; pending = operation; error = null;
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || operation.version !== version || operation.epoch !== epoch || getContext() !== selectedContext || selectedContext.state !== 'running') throw fail('The cavity geometry, execution or audio clock changed during preparation.'); };
    operation.promise = (async () => {
      try { check(); if (!Number.isSafeInteger(graphRevision + 1) || graphRevision >= 2147483647) throw fail('Cavity graph revision exhausted.'); const candidate = await compileCavitySoundMap(map, operation.region, operation.result, { sampleRate: selectedContext.sampleRate, graphRevision: ++graphRevision }); check();
        if (candidate.status !== 'ready') throw fail(candidate.reason);
        if (model?.bodyIdentityHash === candidate.bodyIdentityHash && context === selectedContext && expected) { model = candidate; preparedVersion = version; return state(); }
        const result = await prepareGraph(candidate.graph, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        model = candidate; context = selectedContext; expected = Object.freeze({ ownerRouteRevision: result.revision, graphDefinitionHash: result.activeGraph.hash }); preparedVersion = version; report('accepted'); return state();
      } catch (caught) { if (!operation.controller.signal.aborted) { error = caught.message; report('rejected', error); } throw caught; }
      finally { try { workspace.release(); } catch (caught) { unknown = true; error = caught.message; throw caught; } finally { pending = null; if (!disposed && !unknown && latest && version !== operation.version && getContext()?.state === 'running') ensure().catch(() => {}); } }
    })(); return operation.promise;
  };
  const reset = () => { pending?.controller.abort(fail('Cavity execution stopped.')); latest = selectedRegion = epoch = expected = model = context = null; preparedVersion = -1; version++; qualifiedRevisions.clear(); error = null; };
  const qualification = intent => {
    const binding = intent.topologyBinding, component = latest?.components.find(component => component.id === binding?.componentId), firstAnchor = map.componentSelector.anchorIds[0];
    if (!latest || intent.worldId !== latest.worldId || intent.generation !== latest.generation || binding?.regionId !== latest.regionId || !qualifiedRevisions.has(binding.boundTopologyRevision) || component?.enclosure !== 'closed' || component.musical.status !== 'complete' || (firstAnchor ? !component.anchors.includes(firstAnchor) : latest.components.length !== 1)) return null;
    return Object.freeze({ version, epoch, sourceRevision: binding.boundTopologyRevision, componentId: component.id });
  };
  const canEmit = (intent, ticket = null) => {
    if (intent.kind === 'end') return true;
    const binding = intent.topologyBinding, qualified = ticket ? ticket.version === version && ticket.epoch === epoch && binding?.boundTopologyRevision === ticket.sourceRevision && binding.componentId === ticket.componentId : !!qualification(intent);
    return qualified && !!latest && !!expected && preparedVersion === version && context === getContext() && active() && intent.worldId === latest.worldId && intent.generation === latest.generation && binding?.regionId === latest.regionId && model.excitationComponentId === binding.componentId;
  };
  const rememberRevision = revision => { qualifiedRevisions.add(revision); while (qualifiedRevisions.size > 4) qualifiedRevisions.delete(qualifiedRevisions.values().next().value); };
  return Object.freeze({ state, ensure,
    observe(batch, executionEpoch) {
      if (disposed || unknown) return;
      const graph = getGraph(), region = graph.topologyRegions?.find(region => region.id === map.topologyRegionRef.id), result = batch.snapshot?.topology?.regions?.find(entry => entry.regionId === map.topologyRegionRef.id)?.current;
      let valid = false;
      try { if (region) { if (region !== selectedRegion) validateCavitySoundRegion(map, region); valid = topologyResultMatchesRegion(result, region) && result.coverage === 'complete' && result.worldId === batch.worldId && result.generation === batch.generation && result.sourceRevision === batch.snapshot.terrainRevision && result.tick <= batch.tick; } } catch {}
      if (!valid) { if (latest || epoch !== executionEpoch) { version++; pending?.controller.abort(fail('Qualified cavity geometry is unavailable.')); } latest = selectedRegion = null; qualifiedRevisions.clear(); epoch = executionEpoch; return; }
      if (epoch === executionEpoch && (latest === result || latest && result.definitionSignature === latest.definitionSignature && result.work.reusedFromRevision === latest.sourceRevision)) { latest = result; rememberRevision(result.sourceRevision); return; }
      epoch = executionEpoch; latest = result; selectedRegion = region; version++; qualifiedRevisions.clear(); rememberRevision(result.sourceRevision); pending?.controller.abort(fail('A newer cavity geometry superseded preparation.')); ensure().catch(() => {});
    },
    qualification, canEmit,
    resolveSharedTopologyBody(intent) { return canEmit(intent) ? Object.freeze({ bodyId: map.id, bodyRevision: map.revision, boundTopologyRevision: intent.topologyBinding.boundTopologyRevision, graphDefinitionHash: expected.graphDefinitionHash, ownerRouteRevision: expected.ownerRouteRevision, bodyIdentityHash: model.bodyIdentityHash }) : null; }, reset,
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('Cavity owner retired.')); const settled = pending?.promise; return scope.retire([{ name: 'cavity-preparation', run: async () => { try { await settled; } catch {} if (unknown) throw fail('Cavity preparation storage remains unresolved.'); metadata.release(); latest = selectedRegion = model = expected = null; } }]); }
  });
}
