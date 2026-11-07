import { canonicalDataText, cloneData, freezeData } from '../../../core/CanonicalData.js';
import { createSympatheticMapRecipe } from '../../../midi/content/SympatheticMapRecipes.js';
import { prepareEffectGraphRevision } from '../../../midi/content/EffectGraphRevision.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export const SCENE_SYMPATHETIC_REQUIREMENT = 'owned-anchored-sympathetic-network';
const fail = message => Object.assign(new Error(message), { code: 'scene-sympathetic-body-unavailable' });
export function validateSceneSympatheticBody(raw) {
  const value = cloneData(raw, { maxBytes: 16384, maxNodes: 1024 });
  if (!value || Object.keys(value).some(key => !['schema', 'recipeId', 'rootBody', 'couple01', 'damp01', 'tuneRatio', 'wet01', 'anchors'].includes(key)) || value.schema !== 'lemmings-scene-sympathetic-body/v1' || !['string-trellis', 'metal-constellation', 'undertone-basin'].includes(value.recipeId)) throw fail('Choose an original sparse anchored body map.');
  const model = createSympatheticMapRecipe({ recipe: value.recipeId, touchBody: value.rootBody, couple01: value.couple01, damp01: value.damp01, tuneRatio: value.tuneRatio, wet01: value.wet01 });
  if (!Number.isInteger(value.rootBody) || !Number.isFinite(value.tuneRatio) || value.tuneRatio < 0.5 || value.tuneRatio > 2 || !Number.isFinite(value.wet01) || value.wet01 < 0 || value.wet01 > 0.35 || ![value.couple01, value.damp01].every(number => Number.isFinite(number) && number >= 0 && number <= 1) || !Array.isArray(value.anchors) || value.anchors.length !== model.bodyIds.length || value.anchors.some((anchor, index) => !anchor || Object.keys(anchor).some(key => !['bodyId', 'pickupId', 'x', 'y'].includes(key)) || anchor.bodyId !== model.bodyIds[index] || typeof anchor.pickupId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(anchor.pickupId) || ![anchor.x, anchor.y].every(number => Number.isFinite(number) && Math.abs(number) <= 1e9)) || new Set(value.anchors.map(anchor => anchor.pickupId)).size !== value.anchors.length) throw fail('Every persistent body needs one explicit distinct world pickup anchor.');
  return freezeData(value);
}
export function sceneSympatheticBodyModel(raw, sampleRate = 48000) {
  const mechanism = validateSceneSympatheticBody(raw), model = createSympatheticMapRecipe({ recipe: mechanism.recipeId, touchBody: mechanism.rootBody, couple01: mechanism.couple01, damp01: mechanism.damp01, tuneRatio: mechanism.tuneRatio, wet01: mechanism.wet01 }), plan = prepareEffectGraphRevision(model.graph, { sampleRate }), network = plan.nodes.find(node => node.network).network;
  return { mechanism, model, plan, bodyCount: network.bodyCount, modeCount: network.modeCount, strategy: 'anchored-sparse-audio-network' };
}
export function validateSceneSympatheticMapping(raw, graph) {
  const value = validateSceneSympatheticBody(raw);
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
  let disposed = false, pending = null, expected = null, context = null, prepared = null, error = null, errorContext = null, unknown = false;
  const active = () => { const state = getOwnerState(); return !!expected && state?.revision === expected.ownerRouteRevision && state.activeGraph?.hash === expected.graphDefinitionHash && ['active', 'mute'].includes(state.mode); };
  const isPrepared = () => !!expected && context === getContext();
  const state = () => Object.freeze({ prepared: isPrepared(), active: active(), preparing: !!pending, error, unknownRetirement: unknown, bodyCount: prepared?.bodyCount || 0, modeCount: prepared?.modeCount || 0, rootBody: mechanism.rootBody, anchors: mechanism.anchors, graphDefinitionHash: expected?.graphDefinitionHash || null, semanticOnsetsAdded: 0, physicalFeedback: false });
  const report = status => { if (!disposed) try { onReceipt(Object.freeze({ status, stage: 'scene-sympathetic-body', ...state(), acousticReceipt: false })); } catch {} };
  return Object.freeze({ state, isPrepared,
    ensure() {
      if (disposed || unknown) return Promise.reject(fail('The scene body owner has retired or retains unknown storage.'));
      if (pending) return pending.promise; if (isPrepared()) return Promise.resolve(state());
      const selected = getContext(); if (error && errorContext === selected) return Promise.resolve(state()); if (selected?.state !== 'running') return Promise.resolve(state());
      let workspace; try { workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-network-preparation', category: 'candidate', bytes: 2 * 1048576 }); } catch (caught) { error = caught.message; errorContext = selected; report('rejected'); return Promise.reject(caught); }
      const operation = { controller: new AbortController(), promise: null }; pending = operation; error = errorContext = null;
      const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || getContext() !== selected || selected.state !== 'running') throw fail('The scene or audio clock changed during network preparation.'); };
      operation.promise = (async () => { try { check(); const candidate = sceneSympatheticBodyModel(mechanism, selected.sampleRate), receipt = await prepareGraph(candidate.model.graph, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        prepared = candidate; expected = Object.freeze({ ownerRouteRevision: receipt.revision, graphDefinitionHash: receipt.activeGraph.hash }); context = selected; report('accepted'); return state();
      } catch (caught) { if (!operation.controller.signal.aborted) { error = caught.message; errorContext = selected; report('rejected'); } throw caught; }
      finally { try { workspace.release(); } catch (caught) { unknown = true; error = caught.message; throw caught; } finally { pending = null; } } })(); return operation.promise;
    },
    source() { return !disposed && isPrepared() && active() ? Object.freeze({ model: prepared.model, expected, mechanism }) : null; },
    reset() { pending?.controller.abort(fail('The scene network stopped.')); expected = context = prepared = null; error = errorContext = null; },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('The scene network retired.')); const settled = pending?.promise;
      return scope.retire([{ name: 'scene-network-preparation', run: async () => { try { await settled; } catch {} if (unknown) throw fail('Network preparation storage remains unresolved.'); metadata.release(); prepared = expected = null; } }]); }
  });
}
