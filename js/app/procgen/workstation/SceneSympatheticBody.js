import { canonicalDataText, cloneData, freezeData } from '../../../core/CanonicalData.js';
import { createSympatheticMapRecipe, createBodyRoutedSympatheticMap } from '../../../midi/content/SympatheticMapRecipes.js';
import { prepareEffectGraphRevision } from '../../../midi/content/EffectGraphRevision.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { captureSceneBodyContinuation, restoreSceneBodyContinuation } from './SceneBodyContinuation.js';

export const SCENE_SYMPATHETIC_REQUIREMENT = 'owned-anchored-sympathetic-network';
const fail = message => Object.assign(new Error(message), { code: 'scene-sympathetic-body-unavailable' });
export function validateSceneSympatheticBody(raw) {
  const value = cloneData(raw, { maxBytes: 16384, maxNodes: 1024 });
  if (!value || Object.keys(value).some(key => !['schema', 'recipeId', 'rootBody', 'couple01', 'damp01', 'tuneRatio', 'wet01', 'anchors', 'sourceInstrumentIds', 'bodySourceRoutes'].includes(key)) || !['lemmings-scene-sympathetic-body/v1', 'lemmings-scene-sympathetic-body/v2', 'lemmings-scene-sympathetic-body/v3'].includes(value.schema) || !['string-trellis', 'metal-constellation', 'undertone-basin'].includes(value.recipeId)) throw fail('Choose an original sparse anchored body map.');
  const routed = value.schema === 'lemmings-scene-sympathetic-body/v3', direct = value.schema !== 'lemmings-scene-sympathetic-body/v1';
  if (direct ? !Array.isArray(value.sourceInstrumentIds) || !value.sourceInstrumentIds.length || value.sourceInstrumentIds.length > 64 || value.sourceInstrumentIds.some(id => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(id)) || new Set(value.sourceInstrumentIds).size !== value.sourceInstrumentIds.length : value.sourceInstrumentIds !== undefined) throw fail('A v2 world-anchor map requires one bounded exact inventory of source instruments.');
  const model = createSympatheticMapRecipe({ recipe: value.recipeId, touchBody: value.rootBody, couple01: value.couple01, damp01: value.damp01, tuneRatio: value.tuneRatio, wet01: value.wet01 });
  if (!Number.isInteger(value.rootBody) || !Number.isFinite(value.tuneRatio) || value.tuneRatio < 0.5 || value.tuneRatio > 2 || !Number.isFinite(value.wet01) || value.wet01 < 0 || value.wet01 > 0.35 || ![value.couple01, value.damp01].every(number => Number.isFinite(number) && number >= 0 && number <= 1) || !Array.isArray(value.anchors) || value.anchors.length !== model.bodyIds.length || value.anchors.some((anchor, index) => !anchor || Object.keys(anchor).some(key => !(direct ? ['bodyId', 'x', 'y'] : ['bodyId', 'pickupId', 'x', 'y']).includes(key)) || anchor.bodyId !== model.bodyIds[index] || !direct && (typeof anchor.pickupId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(anchor.pickupId)) || ![anchor.x, anchor.y].every(number => Number.isFinite(number) && Math.abs(number) <= 1e9)) || !direct && new Set(value.anchors.map(anchor => anchor.pickupId)).size !== value.anchors.length) throw fail('Every persistent body needs one explicit distinct world pickup anchor.');
  if (routed ? !Array.isArray(value.bodySourceRoutes) || !value.bodySourceRoutes.length || value.bodySourceRoutes.length > model.bodyIds.length || value.bodySourceRoutes.some(route => !route || Object.keys(route).some(key => !['bodyId', 'laneId', 'sourceLaneIndex'].includes(key)) || !model.bodyIds.includes(route.bodyId) || typeof route.laneId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(route.laneId) || !Number.isInteger(route.sourceLaneIndex) || route.sourceLaneIndex < 0 || route.sourceLaneIndex >= value.bodySourceRoutes.length) || ['bodyId', 'laneId', 'sourceLaneIndex'].some(key => new Set(value.bodySourceRoutes.map(route => route[key])).size !== value.bodySourceRoutes.length) : value.bodySourceRoutes !== undefined) throw fail('A routed body map declares a complete unique bounded lane/body input inventory.');
  return freezeData(value);
}
export function sceneSympatheticBodyModel(raw, sampleRate = 48000) {
  const mechanism = validateSceneSympatheticBody(raw), model = (mechanism.bodySourceRoutes ? createBodyRoutedSympatheticMap : createSympatheticMapRecipe)({ recipe: mechanism.recipeId, touchBody: mechanism.rootBody, couple01: mechanism.couple01, damp01: mechanism.damp01, tuneRatio: mechanism.tuneRatio, wet01: mechanism.wet01, ...(mechanism.bodySourceRoutes ? { bodySourceBusIds: mechanism.anchors.map(anchor => { const route = mechanism.bodySourceRoutes.find(route => route.bodyId === anchor.bodyId); return route ? 'lane:' + route.laneId : null; }) } : {}) }), plan = prepareEffectGraphRevision(model.graph, { sampleRate }), network = plan.nodes.find(node => node.network).network;
  return { mechanism, model, plan, bodyCount: network.bodyCount, modeCount: network.modeCount, strategy: 'anchored-sparse-audio-network' };
}
export function validateSceneSympatheticMapping(raw, graph, laneIds = null) {
  const value = validateSceneSympatheticBody(raw);
  if (value.schema !== 'lemmings-scene-sympathetic-body/v1') {
    const ids = new Set(value.sourceInstrumentIds); if (graph.instruments.length !== ids.size || graph.instruments.some(instrument => instrument.route !== 'local' || !ids.has(instrument.id))) throw fail('The world-anchor network receives the complete declared local owner mix; hidden omitted sources need a separately routed graph.');
    if (value.bodySourceRoutes && (!Array.isArray(laneIds) || laneIds.length !== value.bodySourceRoutes.length || value.bodySourceRoutes.some(route => laneIds[route.sourceLaneIndex] !== route.laneId) || graph.instruments.some(instrument => instrument.sourceKind !== 'PickupCrossing' || instrument.sourceLanes?.length !== 1 || !value.bodySourceRoutes.some(route => route.sourceLaneIndex === instrument.sourceLanes[0])))) throw fail('The routed network needs its exact static pickup lane/body bindings and complete scene lane inventory.'); return value;
  }
  for (const anchor of value.anchors) {
    const pickup = graph.pickups?.find(row => row.id === anchor.pickupId), points = pickup?.geometry?.points;
    if (!pickup || pickup.geometry.kind !== 'segment' || points[0].x !== anchor.x || points[1].x !== anchor.x || anchor.y < Math.min(points[0].y, points[1].y) || anchor.y > Math.max(points[0].y, points[1].y) || !graph.instruments.some(row => row.pickupId === pickup.id)) throw fail('A body anchor needs its exact observed world pickup and actual source mapping.');
  }
  if (graph.instruments.some(row => row.sourceKind !== 'PickupCrossing' || row.route !== 'local' || !value.anchors.some(anchor => anchor.pickupId === row.pickupId))) throw fail('The network admits only its explicitly authored actual pickup exciters.');
  return value;
}
let ordinal = 0;
export function createSceneSympatheticBody({ mechanism: raw, prepareGraph, getContext, getOwnerState, resourceBudget, onReceipt = () => {} } = {}) {
  const mechanism = validateSceneSympatheticBody(raw), id = 'scene-network-' + (++ordinal), metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'anchored-sympathetic-map', category: 'audio', bytes: canonicalDataText(mechanism).bytes.length * 8 + 16384 }), scope = createProcgenRetirementScope();
  let restoredContext = null, disposed = false, pending = null, expected = null, context = null, prepared = null, error = null, errorContext = null, unknown = false;
  const active = () => { const state = getOwnerState(); return !!expected && state?.revision === expected.ownerRouteRevision && state.activeGraph?.hash === expected.graphDefinitionHash && ['active', 'mute'].includes(state.mode); };
  const isPrepared = () => !!expected && context === getContext();
  const state = () => Object.freeze({ prepared: isPrepared(), active: active(), preparing: !!pending, error, unknownRetirement: unknown, bodyCount: prepared?.bodyCount || 0, modeCount: prepared?.modeCount || 0, rootBody: mechanism.rootBody, anchors: mechanism.anchors, ...(mechanism.sourceInstrumentIds ? { sourceInstrumentIds: mechanism.sourceInstrumentIds, excitationPolicy: mechanism.bodySourceRoutes ? 'per-body-declared-lane-audio-inputs' : 'complete-declared-local-owner-mix-into-one-root', ...(mechanism.bodySourceRoutes ? { bodySourceRoutes: mechanism.bodySourceRoutes } : {}) } : {}), graphDefinitionHash: expected?.graphDefinitionHash || null, semanticOnsetsAdded: 0, physicalFeedback: false });
  const report = status => { if (!disposed) try { onReceipt(Object.freeze({ status, stage: 'scene-sympathetic-body', ...state(), acousticReceipt: false })); } catch {} };
  return Object.freeze({ state, isPrepared,
    ensure() {
      if (disposed || unknown) return Promise.reject(fail('The scene body owner has retired or retains unknown storage.'));
      if (pending) return pending.promise; if (restoredContext === getContext() || isPrepared()) return Promise.resolve(state());
      const selected = getContext(); if (error && errorContext === selected) return Promise.resolve(state()); if (selected?.state !== 'running') return Promise.resolve(state());
      let workspace; try { workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-network-preparation', category: 'candidate', bytes: 2 * 1048576 }); } catch (caught) { error = caught.message; errorContext = selected; report('rejected'); return Promise.reject(caught); }
      const operation = { controller: new AbortController(), promise: null }; pending = operation; error = errorContext = null;
      const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || getContext() !== selected || selected.state !== 'running') throw fail('The scene or audio clock changed during network preparation.'); };
      operation.promise = (async () => { try { check(); const candidate = sceneSympatheticBodyModel(mechanism, selected.sampleRate), receipt = await prepareGraph(candidate.model.graph, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        prepared = candidate; expected = Object.freeze({ ownerRouteRevision: receipt.revision, graphDefinitionHash: receipt.activeGraph.hash }); context = selected; report('accepted'); return state();
      } catch (caught) { if (!operation.controller.signal.aborted) { error = caught.message; errorContext = selected; report('rejected'); } throw caught; }
      finally { try { workspace.release(); } catch (caught) { unknown = true; error = caught.message; throw caught; } finally { pending = null; } } })(); return operation.promise;
    },
    snapshot() { return captureSceneBodyContinuation({ mechanism, expected, context, pending, active: active(), metadata: prepared && { model: prepared.model, bodyCount: prepared.bodyCount, modeCount: prepared.modeCount } }); },
    restore(value, frontier) {
      if (disposed || pending || expected || context) throw fail('Restore only a fresh scene network owner.');
      const selected = getContext(), restored = restoreSceneBodyContinuation(value, mechanism, selected, frontier);
      if (restored.expected && (!restored.metadata?.model || !Number.isInteger(restored.metadata.bodyCount) || !Number.isInteger(restored.metadata.modeCount))) throw fail('The exact scene network model is missing.');
      prepared = restored.metadata; expected = restored.expected; context = selected; restoredContext = restored.retainedRoute ? selected : null; report('accepted'); return state();
    },
    source() { return !disposed && isPrepared() && active() ? Object.freeze({ model: prepared.model, expected, mechanism }) : null; },
    reset() { pending?.controller.abort(fail('The scene network stopped.')); expected = context = restoredContext = prepared = null; error = errorContext = null; },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('The scene network retired.')); const settled = pending?.promise;
      return scope.retire([{ name: 'scene-network-preparation', run: async () => { try { await settled; } catch {} if (unknown) throw fail('Network preparation storage remains unresolved.'); metadata.release(); prepared = expected = null; } }]); }
  });
}
