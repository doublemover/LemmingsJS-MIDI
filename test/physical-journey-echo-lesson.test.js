import { expect } from 'chai';
import { createJourneyEchoLessonObservation } from '../js/app/procgen/workstation/PhysicalJourneyEchoLesson.js';
import { physicalLessonPolicy } from '../js/app/procgen/workstation/PhysicalLessonPolicy.js';

const graph = { version: 1, revision: 1, instruments: [{ id: 'reply' }] }, releaseGesture = { revision: 1, nominalGapTicks: 54, spreadTicks: 0, grouping: 'free' };
const context = tick => ({ assists: false, graph, releaseGesture, soundIdentity: 'same-source', tick });
const batch = tick => ({ worldId: 'world', generation: 1, tick, batchId: 'world:1:' + tick + ':0', facts: [] });
const member = (value, fact) => ({ ...fact, worldId: value.worldId, generation: value.generation, batchId: value.batchId });
const create = () => createJourneyEchoLessonObservation({ definition: { success: { kind: 'journey-versus-echo', junctionId: 'route', configurationId: 'stepped', deliveryMappingId: 'reply' } }, ...context(0) });
const switched = () => { const value = batch(1); value.facts.push(member(value, { kind: 'CommandApplied', eventId: 'switch', commandId: 'manual:1', origin: 'manual', status: 'accepted',
  requestedCommand: { id: 'manual:1', kind: 'junction-request', parameters: { request: { junctionId: 'route', configurationId: 'stepped' } } },
  terrain: { junction: { commandId: 'manual:1', junctionId: 'route', configurationId: 'stepped' } } })); return value; };
const arrival = () => {
  const value = batch(5); value.facts.push(member(value, { kind: 'MotionCommitted', eventId: 'arrival', actorId: 7 }));
  const intents = [0, 1].map(index => ({ kind: 'begin', intentId: 'dyad:' + index, mappingId: 'reply', physicalSourceKind: 'CargoDelivery',
    worldId: 'world', generation: 1, batchId: value.batchId, actorId: 7, sourceEventIds: ['remembered:1', 'arrival'],
    responseDescriptor: { kind: 'physical-cargo-delivery', tokenId: 'cargo:1', captureTick: 2, deliveryTick: 5, timedSequence: false } }));
  return { batch: value, intents, context: context(5) };
};
const echo = kind => ({ kind, status: 'accepted', stage: 'native-control-submitted', graphDefinitionHash: 'a'.repeat(64), ownerRouteRevision: 3,
  targetFrame: 48000, sourceScope: 'physical-owner-sum', space01: 0, throw01: 0.35, return01: 0.2, delaySeconds: 0.24 });
describe('physical journey versus audio echo lesson', () => {
  it('requires actual switched-route delivery, source input during a throw and a later quiet cause batch', () => {
    const lesson = create(); lesson.observe({ batch: switched(), intents: [], context: context(1) });
    expect(lesson.observe(arrival()).phase).to.equal('perform-echo');
    lesson.effect(echo('echo-throw-pressed'), context(5));
    expect(lesson.effect(echo('echo-throw-released'), context(5)).phase).to.equal('perform-echo');
    lesson.effect(echo('echo-throw-pressed'), context(5));
    const value = batch(6); value.facts.push(member(value, { kind: 'MotionCommitted', eventId: 'new-arrival', actorId: 9 }));
    const input = { kind: 'begin', intentId: 'fresh-input', worldId: 'world', generation: 1, batchId: value.batchId, actorId: 9, sourceEventIds: ['new-arrival'] };
    lesson.observe({ batch: value, intents: [input], context: context(6) });
    expect(lesson.effect(echo('echo-throw-released'), context(6)).phase).to.equal('observe-echo-tail');
    const complete = lesson.observe({ batch: batch(7), intents: [], context: context(7) });
    expect(complete.phase).to.equal('physical-evidence-observed');
    expect(complete.journey).to.include({ physicalTravelTicks: 3, audioDelaySeconds: 0.24, addedEchoSemanticOnsets: 0 });
    expect(complete.changed.map(value => value.intentId)).to.deep.equal(['dyad:0', 'dyad:1', 'fresh-input']);
  });
  it('declines timer-only replies and rejects a deliberately source-less echo note', () => {
    const lesson = create(); expect(lesson.observe(arrival()).phase).to.equal('observe-baseline');
    lesson.observe({ batch: switched(), intents: [], context: context(1) });
    const timed = arrival(); timed.intents.forEach(intent => { intent.responseDescriptor.timedSequence = true; });
    expect(lesson.observe(timed).phase).to.equal('observe-baseline');
    lesson.observe(arrival()); lesson.effect(echo('echo-throw-pressed'), context(5));
    expect(() => lesson.observe({ batch: batch(6), intents: [{ kind: 'begin', actorId: 7, sourceEventIds: [] }], context: context(6) })).to.throw('physical cause');
  });
  it('keeps actual timing policy while permitting revision-only and explicit finite-release admission changes', () => {
    const first = physicalLessonPolicy(graph, releaseGesture);
    expect(physicalLessonPolicy(graph, { ...releaseGesture, revision: 2, paused: true, finiteBurstCount: 2 })).to.equal(first);
    expect(physicalLessonPolicy(graph, { ...releaseGesture, spreadTicks: 4 })).not.to.equal(first);
  });
});
