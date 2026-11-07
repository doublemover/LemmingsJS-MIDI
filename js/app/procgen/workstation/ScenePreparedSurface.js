import { canonicalDataText, cloneData, freezeData } from '../../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from '../../../midi/content/EffectGraphRevision.js';
import { validatePreparedSurfaceDefinitions } from './physical/PreparedSurfaceMapping.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export const SCENE_PREPARED_SURFACE_REQUIREMENT = 'owned-observed-prepared-surface';
const fail = message => Object.assign(new Error(message), { code: 'scene-prepared-surface-unavailable' });
export function validateScenePreparedSurface(raw) {
  const value = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 });
  if (!value || Object.keys(value).some(key => !['schema', 'surfaceId', 'nodeId', 'graph'].includes(key)) || value.schema !== 'lemmings-scene-prepared-surface/v1' ||
      ![value.surfaceId, value.nodeId].every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,47}$/.test(id))) throw fail('Name the exact surface, body node and bounded saved graph.');
  const plan = prepareEffectGraphRevision(value.graph, { sampleRate: 96000 }), bodies = plan.nodes.filter(node => node.membrane || node.network);
  if (bodies.length !== 1 || bodies[0].id !== value.nodeId || !plan.nodes.every(node => ['bus-in', 'bus-out', 'gain', 'sidechain-in', 'rectangular-membrane', 'sympathetic-network'].includes(node.kind)) ||
      plan.maximumTailFrames > 96000 * 15 || plan.stateBytes > 16 * 1048576 || plan.latencyFrames !== 0) throw fail('A scene surface needs one admitted membrane or authored bar and a bounded loss-only route.');
  if (bodies[0].network && bodies[0].parameters.bodies.length !== 1) throw fail('This surface profile binds one bar rather than an unassigned body network.');
  return freezeData({ ...value, graph: plan.definition });
}
export function validateScenePreparedSurfaceMapping(raw, graph) {
  const mechanism = validateScenePreparedSurface(raw), surfaces = validatePreparedSurfaceDefinitions(graph.preparedSurfaces), surface = surfaces.find(row => row.id === mechanism.surfaceId);
  const membrane = mechanism.graph.nodes.some(node => node.kind === 'rectangular-membrane');
  if (surfaces.length !== 1 || !surface || !graph.instruments.length || graph.instruments.some(instrument => membrane ? instrument.route !== 'prepared-body' || instrument.preparedBodyStrike?.surfaceId !== surface.id || instrument.preparedBodyStrike.surfaceRevision !== surface.revision : instrument.route !== 'local' || !['ContactSpanBegan', 'ContactResolved'].includes(instrument.sourceKind))) throw fail('The score must bind finite membrane strikes or actual local bar exciters to its one exact shared surface.');
  return mechanism;
}
let ordinal = 0;
export function createScenePreparedSurface({ mechanism: raw, getGraph, prepareGraph, bindSurface, getContext, getOwnerState, resourceBudget, onReceipt = () => {} } = {}) {
  const mechanism = validateScenePreparedSurface(raw), id = 'scene-surface-' + (++ordinal), scope = createProcgenRetirementScope(), metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-prepared-surface-map', category: 'audio', bytes: canonicalDataText(mechanism).bytes.length * 8 + 16384 });
  let disposed = false, unknown = false, pending = null, source = null, version = 0, preparedVersion = -1, graphRevision = mechanism.graph.revision, expected = null, binding = null, context = null, error = null;
  const active = () => { const state = getOwnerState(); return !!expected && state?.revision === expected.ownerRouteRevision && state.activeGraph?.hash === expected.graphDefinitionHash && ['active', 'mute'].includes(state.mode); };
  const state = () => Object.freeze({ prepared: !!binding && preparedVersion === version && context === getContext() && active(), preparing: !!pending, surfaceId: mechanism.surfaceId,
    bodyInstanceId: binding?.bodyInstanceId || null, mapId: binding?.surfaceMap.id || null, mapRevision: binding?.surfaceMap.revision ?? null, error, unknownRetirement: unknown,
    sourcePolicy: 'actual-contact-only;omit-before-preparation;no-late-excitation', heldContactPolicy: 'keep-old-tail', semanticOnsetsAdded: 0 });
  const report = status => { if (!disposed) try { onReceipt(Object.freeze({ ...state(), status, stage: 'scene-prepared-surface', acousticReceipt: false })); } catch {} };
  const ensure = () => {
    if (disposed || unknown) return Promise.reject(fail('The shared surface owner has retired or retains unresolved storage.'));
    if (pending) return pending.promise;
    if (!source || state().prepared) return Promise.resolve(state());
    const selected = getContext(); if (selected?.state !== 'running') return Promise.resolve(state());
    if (expected && preparedVersion === version && context === selected && !active()) { error = 'scene-body-route-replaced'; return Promise.resolve(state()); }
    if (getOwnerState()?.retiringGraphs) { error = 'waiting-for-previous-body-tail'; return Promise.resolve(state()); }
    let workspace; try { workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-surface-preparation', category: 'candidate', bytes: 2 * 1048576 }); } catch (caught) { error = caught.message; report('rejected'); return Promise.reject(caught); }
    const operation = { controller: new AbortController(), version, source, promise: null }; pending = operation; error = null;
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || version !== operation.version || source !== operation.source || getContext() !== selected || selected.state !== 'running') throw fail('The surface map, physical execution or audio clock changed during preparation.'); };
    operation.promise = (async () => {
      try {
        check(); if (graphRevision >= 2147483647) throw fail('The shared surface graph revision is exhausted.');
        const graph = { ...mechanism.graph, revision: ++graphRevision }, receipt = await prepareGraph(graph, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        const route = Object.freeze({ ownerRouteRevision: receipt.revision, graphDefinitionHash: receipt.activeGraph.hash });
        const identity = await bindSurface({ surfaceId: mechanism.surfaceId, nodeId: mechanism.nodeId, expected: route, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        expected = route; binding = identity; context = selected; preparedVersion = version; report('accepted'); return state();
      } catch (caught) { if (!operation.controller.signal.aborted) { error = caught.message; report('rejected'); } throw caught; }
      finally { try { workspace.release(); } catch (caught) { unknown = true; error = caught.message; throw caught; } finally { pending = null; if (!disposed && !unknown && source && version !== operation.version) ensure().catch(() => {}); } }
    })(); return operation.promise;
  };
  const reset = () => { version++; pending?.controller.abort(fail('The shared surface execution stopped.')); source = expected = binding = context = null; preparedVersion = -1; error = null; };
  return Object.freeze({ state, ensure, reset,
    observe(batch, executionEpoch) {
      if (disposed || unknown) return;
      const surface = getGraph().preparedSurfaces?.find(row => row.id === mechanism.surfaceId), topology = batch.terrainRevisionAfter ?? batch.snapshot?.terrainRevision;
      const key = surface && surface.surfaceMap.boundTopologyRevision === topology ? canonicalDataText({ surface, executionEpoch, worldId: batch.worldId, generation: batch.generation }).text : null;
      if (key === source?.key || key === null && source === null) return;
      version++; pending?.controller.abort(fail('A newer surface binding superseded preparation.')); source = key ? { key, executionEpoch, worldId: batch.worldId, generation: batch.generation } : null;
      error = source ? null : 'surface-map-topology-unavailable';
    },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('The scene surface owner retired.')); const settled = pending?.promise;
      return scope.retire([{ name: 'scene-surface-preparation', run: async () => { try { await settled; } catch {} if (unknown) throw fail('Shared surface preparation storage remains unresolved.'); metadata.release(); source = binding = expected = null; } }]); }
  });
}
