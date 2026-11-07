import assert from 'node:assert/strict';
import { captureCircularPickupCoordinate, planCircularTravel } from '../../js/midi/content/CircularSpectrum.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { sampleMotionBatch } from '../helpers/sampleTraversal.js';

describe('actual swept-pickup circular source coordinates', () => {
  const profile = getOwnedSourceProfile('worklet-spectrum'), parameters = { ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), sourceMode: 2, circularControlMode: 3, circularPixelsPerCycle: 256 };
  const graph = { version: 1, revision: 3, pickups: [{ id: 'gate', revision: 2, geometry: { kind: 'segment', points: [{ x: -64, y: 0 }, { x: -64, y: 80 }] } }], instruments: [{ id: 'stones', sourceKind: 'PickupCrossing', pickupId: 'gate', pitchCents: 6000, velocity01: 0.5, role: 'stones', route: 'local' }] };
  it('retains the exact gate intersection rather than the later actor endpoint', () => {
    const batch = sampleMotionBatch(2, -70, -60), fact = { kind: 'PickupCrossing', derivedObservation: true, actorId: batch.facts[0].actorId, gateId: 'gate', gateRevision: 2, local01: 0.5, observationId: 'crossing:one', causalSequence: batch.facts[0].causalSequence, sourceEventIds: [batch.facts[0].eventId] }, coordinate = captureCircularPickupCoordinate(batch, fact, 'stones', graph);
    assert.deepEqual(coordinate.coordinate, { x: -64, y: 40 });
    const intent = { kind: 'begin', physicalSourceKind: 'PickupCrossing', worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId, mappingId: 'stones', sourceEventIds: fact.sourceEventIds, observationId: fact.observationId, observation: { gateId: 'gate', gateRevision: 2, local01: 0.5 }, articulationState: { pickupCoordinate: coordinate } };
    const planned = planCircularTravel(parameters, intent, 100, 48000); assert.equal(planned.from, -0.25); assert.equal(planned.to, -0.25); assert.equal(planned.endFrame, 101);
    assert.throws(() => planCircularTravel(parameters, { ...intent, sourceEventIds: [] }, 100, 48000));
    assert.throws(() => planCircularTravel(parameters, { ...intent, observation: { ...intent.observation, gateRevision: 3 } }, 100, 48000));
    assert.equal(captureCircularPickupCoordinate(batch, { ...fact, gateRevision: 3 }, 'stones', graph), null);
  });
  it('attaches coordinates to the original real gate onset without another musical event', () => {
    const engine = createCausalMusicEngine({ getGraph: () => graph }); engine.processBatch(sampleMotionBatch(1, -80, -75));
    const intents = engine.processBatch(sampleMotionBatch(2, -70, -60)), begins = intents.filter(intent => intent.kind === 'begin');
    assert.equal(begins.length, 1); assert.equal(begins[0].physicalSourceKind, 'PickupCrossing'); assert.equal(begins[0].articulationState.pickupCoordinate.coordinate.x, -64);
    assert.equal(planCircularTravel(parameters, begins[0], 100, 48000).from, -0.25); engine.dispose();
  });
});
