import { cloneData, canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { inspectResonatorMorphMap } from '../../../midi/content/ResonatorMorph.js';
import { createResonatorMorphGraph } from '../../../midi/content/ResonatorMorphGraph.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const fail = message => Object.assign(new Error(message), { code: 'scene-morph-unavailable' });
export function validateSceneMorphMechanism(raw) {
  const value = cloneData(raw, { maxBytes: 49152, maxNodes: 6000 });
  if (!value || Object.keys(value).some(key => !['schema', 'instrumentId', 'map', 'a', 'b', 'travelPixels', 'wet01'].includes(key)) || value.schema !== 'lemmings-scene-morph-route/v1' || typeof value.instrumentId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value.instrumentId) || !Number.isFinite(value.travelPixels) || value.travelPixels < 128 || value.travelPixels > 1024 || !Number.isFinite(value.wet01) || value.wet01 < 0 || value.wet01 > 0.35) throw fail('The initial morph route needs exact bounded sources, instrument and real travel domain.');
  const inspected = inspectResonatorMorphMap(value.map, value.a, value.b); if (inspected.map.transitionPolicy !== 'paired-synthetic-held' || inspected.slots.length > 8) throw fail('The initial shared body needs reviewed held pairing within eight modes.'); return freezeData(value);
}
export async function verifySceneMorphMechanism(value, instruments) {
  const mechanism = validateSceneMorphMechanism(value), matches = instruments.filter(instrument => instrument.id === mechanism.instrumentId), instrument = matches[0];
  if (matches.length !== 1 || instrument.route !== 'local' || instrument.sourceKind !== 'MotionCommitted' || !instrument.articulation?.sustain || instrument.articulation.orientation !== 'signedX' || instrument.articulation.phaseMode !== 'direction-reversing' || instrument.articulation.lifetimeScope !== 'actorJourney') throw fail('The score must own the exact local sustained signed-X journey used by MORPH.');
  await createResonatorMorphGraph(mechanism); return mechanism;
}
let ordinal = 0;
export function createSceneMorphMechanism({ mechanism: raw, prepareGraph, travelEffects, getContext, getOwnerState, resourceBudget, onState = () => {} } = {}) {
  const mechanism = validateSceneMorphMechanism(raw), id = 'scene-morph-' + (++ordinal), metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-morph-source', category: 'audio', bytes: canonicalDataText(mechanism).bytes.length * 8 + 8192 }), scope = createProcgenRetirementScope();
  let disposed = false, pending = null, expected = null, model = null, context = null, used = false, unknown = false, error = null;
  const active = () => { try { const state = getOwnerState(); return !!expected && state?.revision === expected.ownerRouteRevision && state.activeGraph?.hash === expected.graphDefinitionHash && ['active', 'mute'].includes(state.mode); } catch { return false; } };
  const state = () => Object.freeze({ prepared: !!expected && context === getContext(), preparing: !!pending, bound: used, active: active(), error, unknownRetirement: unknown, instrumentId: mechanism.instrumentId, mapHash: mechanism.map.hash });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  return Object.freeze({ state, isPrepared: () => !!expected && context === getContext(),
    async ensure() {
      if (disposed || unknown) return Promise.reject(fail('The score body owner has retired or retains unknown storage.'));
      if (pending) return pending.promise; if (expected && context === getContext()) return Promise.resolve(state());
      const selected = getContext(); if (selected?.state !== 'running') return Promise.reject(fail('Explicitly enable browser audio before preparing the score body.'));
      let workspace; try { workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'scene-morph-preparation', category: 'candidate', bytes: 2 * 1048576 }); } catch (caught) { error = caught.message; report(); throw caught; }
      const operation = { controller: new AbortController(), workspace, promise: null }; pending = operation; error = null;
      const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || getContext() !== selected || selected.state !== 'running') throw fail('The score or audio clock changed during body preparation.'); };
      operation.promise = (async () => { try { check(); const candidate = await createResonatorMorphGraph(mechanism, selected.sampleRate); check(); const result = await prepareGraph(candidate.graph, { signal: operation.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check(); model = candidate; context = selected; expected = Object.freeze({ ownerRouteRevision: result.revision, graphDefinitionHash: result.activeGraph.hash }); used = false; return state(); }
      catch (caught) { if (!operation.reset) error = caught.message; throw caught; }
      finally { try { operation.workspace.release(); } catch (caught) { unknown = true; error = caught.message; throw caught; } finally { pending = null; report(); } } })(); report(); return operation.promise;
    },
    consume(intents, admissions) {
      if (disposed || used || !expected || context !== getContext() || !active()) return;
      const intent = intents.find(value => value.kind === 'begin' && value.mappingId === mechanism.instrumentId && admissions.get(value.intentId) === 'accepted'); if (!intent) return;
      try { travelEffects.bind({ voiceId: intent.voiceId, generation: intent.generation, instrumentId: mechanism.instrumentId, control: model.control, expected }); used = true; report(); } catch (caught) { error = caught.message; report(); }
    },
    cancel() { pending?.controller.abort(fail('Score body preparation canceled.')); },
    reset() { if (pending) { pending.reset = true; pending.controller.abort(fail('Score body preparation stopped.')); } expected = model = context = null; used = false; error = null; report(); },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('Score body owner retired.')); const settled = pending?.promise; return scope.retire([{ name: 'scene-morph-preparation', run: async () => { try { await settled; } catch {} if (unknown) throw fail('Score preparation storage remains unresolved.'); metadata.release(); model = expected = null; } }]); }
  });
}
