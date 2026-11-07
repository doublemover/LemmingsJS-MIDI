import { expect } from 'chai';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createMemoryLessonObservation } from '../js/app/procgen/workstation/PhysicalMemoryLesson.js';

const hash = value => value.repeat(64), mappingId = 'memory-travel';
const graph = { version: 1, revision: 1, instruments: [{ id: mappingId, sourceKind: 'MotionCommitted', sourceLanes: [0],
  articulation: { spacingPixels: 1000000, metric: 'axis-projection', orientation: 'signedX', lifetimeScope: 'actorJourney', phaseMode: 'direction-reversing', sustain: true },
  pitchCents: 6000, velocity01: 0.6, role: 'texture', route: 'local' }] };
const releaseGesture = { finiteBurstCount: 1, paused: false };
const source = { assists: false, graph, releaseGesture, soundIdentity: hash('d'),
  soundReferences: [{ laneId: 'memory-lane', definitionHash: hash('d'), packHash: hash('e') }] };
const seed = { kind: 'saved-seed-applied', transform: 'motion-body-graft', durable: true, assetHash: hash('f'), definitionHash: hash('d'), packHash: hash('e'),
  laneId: 'memory-lane', assetHashes: [hash('f')], sourceRegionFrames: [0, 2048],
  traversalBinding: { schema: 'lemmings-sample-traversal/v1', revision: 1, mappingId, lifetimeScope: 'actorJourney', metric: 'axis-projection', orientation: 'signedX',
    mode: 'tape-footpath', originPixels: 0, framesPerWorldPixel: 1, requiredPrecision: 'committed-coordinate-write', discontinuityPolicy: 'end-voice', timing: 'completed-tick-equal-segments-v1' } };
const packet = (tick, from, to, actorId = 7) => {
  const batchId = 'world:1:' + tick + ':0', eventId = batchId + ':motion';
  return { version: 1, worldId: 'world', generation: 1, tick, batchId, completeness: { status: 'complete', dropped: 0 },
    facts: from === to ? [] : [{ kind: 'MotionCommitted', eventId, batchId, worldId: 'world', generation: 1, actorId, laneId: 0,
      action: 'walk', actionInstanceId: 'walk:7', causalSequence: tick, precision: 'tick', positionBefore: { x: from, y: 10 }, positionAfter: { x: to, y: 10 },
      physicalPayload: { displacementPixels: Math.abs(to - from), pathEvidence: 'committed-coordinate-write' } }],
    snapshot: { actors: [{ actorId, x: to, y: 10, spawnTick: 0 }] } };
};
const ready = () => {
  const observer = createMemoryLessonObservation({ definition: { success: { kind: 'move-memory', mappingIds: [mappingId], minimumTravelPixels: 16 } }, ...source });
  observer.material(seed, source); observer.predictNext('Outbound increases the source coordinate; real rest holds it and return decreases it.');
  const engine = createCausalMusicEngine({ getGraph: () => graph });
  return { observer, engine, observe(batch) { const intents = engine.processBatch(batch); return { state: observer.observe({ batch, intents, context: source }), intents }; } };
};

describe('physical frozen-memory lesson', () => {
  it('uses actual production travel intents for outbound, a complete stationary tick and same-voice return', () => {
    const lesson = ready(), outbound = lesson.observe(packet(1, 0, 16));
    expect(outbound.state.phase).to.equal('await-memory-rest'); expect(outbound.intents.filter(intent => intent.kind === 'begin')).to.have.length(1);
    const rest = lesson.observe(packet(2, 16, 16));
    expect(rest.state.phase).to.equal('observe-memory-return'); expect(rest.state.journey.restObserved).to.equal(true);
    const returned = lesson.observe(packet(3, 16, 8));
    expect(returned.state.phase).to.equal('physical-evidence-observed'); expect(returned.intents.filter(intent => intent.kind === 'begin')).to.have.length(0);
    expect(returned.state.changed[0].voiceId).to.equal(outbound.state.baseline[0].voiceId);
    expect(returned.state.journey).to.include({ requestedSourceFrame: 8, declaredMetric: 'axis-projection', orientation: 'signedX' });
  });
  it('requires stationary physical evidence and cannot replace the original voice with a second onset', () => {
    const lesson = ready(); lesson.observe(packet(1, 0, 16));
    expect(lesson.observe(packet(2, 16, 8)).state.phase).to.equal('await-memory-rest');
    const fresh = ready(); fresh.observe(packet(1, 0, 16)); fresh.observe(packet(2, 16, 16));
    const batch = packet(3, 16, 8), intents = fresh.engine.processBatch(batch);
    expect(intents.some(intent => intent.kind === 'update')).to.equal(true);
    expect(() => fresh.observer.observe({ batch, context: source, intents: intents.map(intent => intent.kind === 'update' ? { ...intent, kind: 'begin' } : intent) })).to.throw('second onset');
  });
});
