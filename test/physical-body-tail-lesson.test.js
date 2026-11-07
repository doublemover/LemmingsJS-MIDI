import { expect } from 'chai';
import { createBodyTailLessonObservation } from '../js/app/procgen/workstation/PhysicalBodyTailLesson.js';

const graph = { version: 1, revision: 1, instruments: [{ id: 'strike', sourceKind: 'ContactSpanBegan' }] }, releaseGesture = { finiteBurstCount: 1 };
const context = () => ({ assists: false, graph, releaseGesture, soundIdentity: 'exact-patch',
  preparedBodyResidency: [{ surfaceId: 'skin', bodyInstanceId: 'owned-body:1', graphDefinitionHash: 'a'.repeat(64), active: true, quarantined: false }] });
const packet = (tick, kind, actorId = 7) => {
  const batchId = 'world:1:' + tick + ':0', eventId = batchId + ':fact';
  const fact = { kind, actorId, worldId: 'world', generation: 1, batchId, eventId };
  return { batch: { worldId: 'world', generation: 1, tick, batchId, facts: [fact], snapshot: { actors: kind === 'ActorTerminated' ? [] : [{ actorId }] } },
    intents: kind === 'ContactSpanBegan' ? [{ kind: 'begin', intentId: 'original-strike', voiceId: 'finite-exciter', actorId, worldId: 'world',
      generation: 1, batchId, mappingId: 'strike', physicalSourceKind: kind, sourceEventIds: [eventId] }] : [], context: context() };
};
const create = () => createBodyTailLessonObservation({ definition: { success: { kind: 'body-outlives-actor', mappingIds: ['strike'], surfaceId: 'skin' } }, ...context() });
describe('shared-body residency lesson', () => {
  it('retains the original strike identity after actual striker termination without inventing another onset', () => {
    const lesson = create(); expect(lesson.observe(packet(1, 'ContactSpanBegan')).phase).to.equal('remove-striker');
    const state = lesson.observe(packet(2, 'ActorTerminated'));
    expect(state.phase).to.equal('physical-evidence-observed'); expect(state.journey).to.include({ retainedAfterActor: true, addedSemanticOnsets: 0, bodyInstanceId: 'owned-body:1' });
    expect(state.changed[0]).to.include({ intentId: 'original-strike', actorTerminationTick: 2, evidenceRole: 'original-strike-with-retained-body;not-a-new-onset' });
    expect(state.journey.tailPcm).to.include('unmeasured');
    expect(lesson.observe(packet(2, 'ActorTerminated')).changed).to.have.length(1);
  });
  it('requires the original body and actual striker terminal fact, not another actor or a replacement body', () => {
    const lesson = create(); lesson.observe(packet(1, 'ContactSpanBegan'));
    expect(lesson.observe(packet(2, 'ActorTerminated', 9)).phase).to.equal('remove-striker');
    const replaced = packet(3, 'ActorTerminated'); replaced.context.preparedBodyResidency[0].bodyInstanceId = 'owned-body:2';
    expect(lesson.observe(replaced).phase).to.equal('remove-striker');
    const missing = create(), strike = packet(1, 'ContactSpanBegan'); strike.context.preparedBodyResidency = [];
    expect(missing.observe(strike).baseline).to.have.length(0);
  });
});
