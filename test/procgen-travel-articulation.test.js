import { expect } from 'chai';
import { createTravelAccumulator, validateArticulationField } from '../js/app/procgen/workstation/TravelAccumulator.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const field = extra => ({ spacingPixels: 4, metric: 'endpoint-chord', orientation: 'signedX', lifetimeScope: 'actorJourney', ...extra });
const source = (tick, from, to, extra = {}) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: `world:1:${tick}:0`,
  completeness: { status: 'complete', dropped: 0 }, facts: [{ kind: 'MotionCommitted', eventId: `motion:${tick}`, causalSequence: tick,
    actorId: 7, actionInstanceId: '7:action:1', action: 'walk', laneId: 0, positionBefore: { x: from, y: 10 },
    positionAfter: { x: to, y: 10 }, precision: 'endpoint', ...extra }] });
const consume = (accumulator, batch, config = field()) => accumulator.consume(batch, batch.facts[0], 'texture', config);
const graph = articulation => ({ version: 1, revision: 1, instruments: [{ id: 'texture', sourceKind: 'MotionCommitted',
  articulation, pitchCents: 6000, velocity01: 0.75, role: 'texture', route: 'local' }] });

describe('physical travel articulation', () => {
  it('plays six distance attacks over 24 pixels and no attacks during six idle ticks', () => {
    const engine = createCausalMusicEngine({ getGraph: () => graph(field()) });
    const output = [...engine.processBatch(source(1, 0, 24))];
    for (let tick = 2; tick <= 7; tick++) output.push(...engine.processBatch(source(tick, 24, 24)));
    expect(output.filter(intent => intent.kind === 'begin')).to.have.length(6);
    expect(output.filter(intent => intent.kind === 'begin').map(intent => intent.articulationState.crossing.position.x)).to.deep.equal([4, 8, 12, 16, 20, 24]);
    expect(output.every(intent => Object.keys(intent.expression).length === 0)).to.equal(true);
    expect(engine.snapshot().travel.entries[0]).to.include({ pathDistancePixels: 24, signedDistancePixels: 24 });
  });

  it('keeps threshold positions invariant under straight segment subdivision', () => {
    const whole = createTravelAccumulator(), parts = createTravelAccumulator();
    const all = consume(whole, source(1, 0, 8)).crossings.map(value => value.position);
    const split = [];
    for (let x = 0; x < 8; x++) split.push(...consume(parts, source(x + 1, x, x + 1)).crossings.map(value => value.position));
    expect(split).to.deep.equal(all);
    expect(whole.snapshot().entries[0].pathDistancePixels).to.equal(parts.snapshot().entries[0].pathDistancePixels);
  });

  it('tracks signed projection separately from path length and wall-turn epochs', () => {
    const accumulator = createTravelAccumulator(), config = field({ phaseMode: 'direction-reversing' });
    consume(accumulator, source(1, 0, 8), config);
    accumulator.observeLifecycle(source(2, 8, 8), { kind: 'DirectionChanged', actorId: 7 });
    const idle = consume(accumulator, source(2, 8, 8), config);
    expect(idle.crossings).to.have.length(0);
    const reverse = consume(accumulator, source(3, 8, 0), config);
    expect(reverse.state).to.include({ pathDistancePixels: 16, signedDistancePixels: 0, directionEpoch: 1 });
    expect(reverse.crossings.map(value => value.position.x)).to.deep.equal([4, 0]);
  });

  it('continues actor journeys across real action changes and resets action scopes', () => {
    const journey = createTravelAccumulator(), action = createTravelAccumulator();
    consume(journey, source(1, 0, 3)); consume(action, source(1, 0, 3), field({ lifetimeScope: 'actionInstance' }));
    const exit = { kind: 'ActionExited', actorId: 7, actionInstanceId: '7:action:1' };
    journey.observeLifecycle(source(2, 3, 5), exit); action.observeLifecycle(source(2, 3, 5), exit);
    const next = source(2, 3, 5, { action: 'falling', actionInstanceId: '7:action:2' });
    expect(consume(journey, next).crossings).to.have.length(1);
    expect(consume(action, next, field({ lifetimeScope: 'actionInstance' })).crossings).to.have.length(0);
    expect(journey.snapshot().entries[0].pathDistancePixels).to.equal(5);
    expect(action.snapshot().entries[0].pathDistancePixels).to.equal(2);
  });

  it('restores phase without inventing travel and bounds threshold fanout transactionally', () => {
    const accumulator = createTravelAccumulator({ maxCrossingsPerFact: 4 });
    consume(accumulator, source(1, 0, 3));
    const saved = accumulator.snapshot(), resumed = createTravelAccumulator({ maxCrossingsPerFact: 4 });
    resumed.restore(JSON.parse(JSON.stringify(saved)));
    expect(consume(resumed, source(2, 3, 3)).crossings).to.have.length(0);
    expect(consume(resumed, source(3, 3, 4)).crossings).to.have.length(1);
    const before = resumed.snapshot();
    expect(consume(resumed, source(4, 4, 104)).reason).to.equal('travel-crossing-budget');
    expect(resumed.snapshot()).to.deep.equal(before);
    expect(consume(resumed, source(5, 1000, 1001)).status).to.equal('discontinuity');
    expect(resumed.snapshot().entries[0].pathDistancePixels).to.equal(4);
    expect(() => validateArticulationField(field({ spacingPixels: 0.00001 }))).to.throw();
    expect(() => resumed.restore({ version: 1, entries: [{ ...saved.entries[0], pathDistancePixels: NaN }] })).to.throw();
  });

  it('requires qualified contact coverage and exact segment evidence explicitly', () => {
    const accumulator = createTravelAccumulator();
    expect(consume(accumulator, source(1, 0, 8), field({ metric: 'segment-path' })).reason).to.equal('required-segment-path-evidence');
    const contactField = field({ lifetimeScope: 'contactSpan', phaseMode: 'contact-stroke' });
    const touching = source(1, 0, 3, { contactSpanId: 'touch:1', physicalPayload: { contactObserved: true } });
    consume(accumulator, touching, contactField);
    expect(consume(accumulator, source(2, 3, 8, { contactSpanId: 'touch:1' }), contactField).reason).to.equal('unknown-contact-coverage');
    expect(accumulator.snapshot().entries).to.have.length(0);
  });

  it('publishes real builder coordinate writes as three pixels, rather than its endpoint chord', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0], batches = [];
    actor.x = 40; actor.y = 80; actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 15;
    world.hasGroundAt = () => false;
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.step();
    const motions = batches[0].facts.filter(fact => fact.kind === 'MotionCommitted');
    expect(motions.map(fact => [fact.positionAfter.x, fact.positionAfter.y])).to.deep.equal([[40, 79], [41, 79], [42, 79]]);
    expect(motions.reduce((sum, fact) => sum + fact.physicalPayload.displacementPixels, 0)).to.equal(3);
    expect(Math.hypot(actor.x - 40, actor.y - 80)).to.equal(Math.sqrt(5));
    const accumulator = createTravelAccumulator();
    const config = field({ metric: 'segment-path', spacingPixels: 1 });
    expect(motions.flatMap(fact => accumulator.consume(batches[0], fact, 'texture', config).crossings)).to.have.length(3);
    world.dispose();
  });

  it('preserves a held journey through action changes and checkpoints phase updates', () => {
    const current = graph(field({ sustain: true, spacingPixels: 100 }));
    const engine = createCausalMusicEngine({ getGraph: () => current });
    expect(engine.processBatch(source(1, 0, 1)).map(intent => intent.kind)).to.deep.equal(['begin']);
    const saved = engine.snapshot(), restored = createCausalMusicEngine({ getGraph: () => current });
    restored.restore(saved);
    const next = source(2, 1, 2, { actionInstanceId: '7:action:2', action: 'falling' });
    next.facts[0].causalSequence = 3;
    next.facts.unshift({ kind: 'ActionExited', actorId: 7, actionInstanceId: '7:action:1', eventId: 'exit:2', causalSequence: 2 });
    const updates = restored.processBatch(next);
    expect(updates.map(intent => intent.kind)).to.deep.equal(['update']);
    expect(updates[0].articulationState.pathDistancePixels).to.equal(2); expect(updates[0].expression).to.deep.equal({});
  });
});
