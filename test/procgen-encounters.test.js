import { expect } from 'chai';
import { createEncounterObserver, validateEncounterDomain } from '../js/app/procgen/workstation/physical/Encounters.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { graphCaptureRequirements } from '../js/app/procgen/workstation/CausalTake.js';
const region = { x1: -100, y1: -100, x2: 1000, y2: 1000 };
const definition = extra => ({ id: 'meeting', revision: 1, kind: 'proximity', region, enterRadius: 4, exitRadius: 6, ...extra });
const environment = { membership: () => ({ status: 'complete', includes: true }), routeCoordinate: () => null };
const domain = { ensembles: [], pickups: [{ id: 'gate' }], routes: [{ id: 'route' }] };
const observer = extra => { const result = createEncounterObserver(); result.configure(validateEncounterDomain({ encounters: [definition(extra)] }, domain)); return result; };
const actor = (actorId, x, y = 0) => ({ actorId, laneId: 0, x, y, actionInstanceId: `walk:${actorId}` });
const batch = (tick, actors, facts) => ({ version: 1, batchId: `b:${tick}`, worldId: 'world', generation: 1, tick,
  snapshot: { tick, generation: 1, revision: tick, actors }, completeness: { status: 'complete', dropped: 0 },
  facts: facts.map((fact, index) => ({ laneId: 0, eventId: `fact:${tick}:${index}`, causalSequence: tick * 10000 + index, ...fact })) });
const motions = (before, after) => before.map((value, index) => ({ kind: 'MotionCommitted', actorId: value.actorId, positionBefore: value, positionAfter: after[index] }));
const run = (target, value, physical = environment) => target.observe(value, value.facts, physical);
const began = result => result.facts.filter(fact => fact.kind === 'EncounterBegan');
describe('completed physical encounters and rendezvous', () => {
  it('recognizes relative swept crossing without an overlapping endpoint or rigid-body contact', () => {
    const before = [actor(1, 0), actor(2, 20)], after = [actor(1, 20), actor(2, 0)];
    const result = run(observer({ participants: { oppositeDirectionOnly: true } }), batch(1, after, motions(before, after)));
    expect(began(result)).to.have.length(1); expect(began(result)[0]).to.include({ fraction: 0.5, distancePixels: 0 });
    expect(result.responses).to.have.length(2); expect(result.responses.every(fact => fact.sourceEventIds.length === 2)).to.equal(true);
    expect(result.facts.some(fact => fact.kind === 'ContactResolved')).to.equal(false);
  });
  it('owns one lingering episode and requires separation before a new attack', () => {
    const target = observer(), actors = [actor(1, 0), actor(2, 1)]; let count = 0;
    for (let tick = 1; tick <= 100; tick++) count += began(run(target, batch(tick, actors, motions(actors, actors)))).length;
    expect(count).to.equal(1);
    const separated = [actor(1, 0), actor(2, 20)]; expect(run(target, batch(101, separated, motions(actors, separated))).facts.filter(value => value.kind === 'EncounterEnded')).to.have.length(1);
    expect(began(run(target, batch(102, actors, motions(separated, actors))))).to.have.length(1);
  });
  it('keeps deterministic nearest pairs and bounded density rather than N squared notes', () => {
    const actors = Array.from({ length: 512 }, (_, i) => actor(i + 1, 1)), value = batch(1, actors, motions(actors, actors));
    const a = run(observer(), value), b = run(observer(), { ...value, snapshot: { ...value.snapshot, actors: [...actors].reverse() } });
    expect(a).to.deep.equal(b); expect(began(a)).to.have.length(1); expect(began(a)[0]).to.include({ participantCount: 512, exactContainedPairs: 130816, aggregation: 'same-radius-cell-density' });
    expect(a.responses).to.have.length(8); expect(a.completeness.status).to.equal('censored'); expect(a.completeness.diagnostics[0].crossCellPairs).to.equal('not-expanded');
  });
  it('groups actual arrivals, checkpoints an open window without freezing it, and recognizes at the deadline', () => {
    const a = observer({ kind: 'rendezvous', pickupId: 'gate', groupingToleranceTicks: 2 }), actors = [actor(1, 0), actor(2, 0), actor(3, 0)];
    const crossing = id => ({ kind: 'PickupCrossing', gateId: 'gate', actorId: id, fraction: 1 });
    expect(run(a, batch(1, actors, [crossing(1)])).responses).to.have.length(0);
    const checkpoint = a.snapshot(), b = observer({ kind: 'rendezvous', pickupId: 'gate', groupingToleranceTicks: 2 }); b.restore(checkpoint);
    expect(run(a, batch(2, actors, [crossing(2)]))).to.deep.equal(run(b, batch(2, actors, [crossing(2)])));
    const result = run(a, batch(3, actors, [crossing(3)])); expect(result).to.deep.equal(run(b, batch(3, actors, [crossing(3)])));
    expect(result.facts[0]).to.include({ kind: 'RendezvousCompleted', recognitionTick: 3, participantCount: 3 });
    expect(result.facts[0].arrivalTimes.map(value => value.sourceTick)).to.deep.equal([1, 2, 3]); expect(result.responses).to.have.length(3);
    expect(checkpoint.rendezvous[0][1].arrivals).to.have.length(1);
  });
  it('does not admit a late arrival into the preceding rendezvous window', () => {
    const a = observer({ kind: 'rendezvous', pickupId: 'gate', groupingToleranceTicks: 1 }), actors = [actor(1, 0), actor(2, 0), actor(3, 0)];
    run(a, batch(1, actors, [{ kind: 'PickupCrossing', gateId: 'gate', actorId: 1, fraction: 0.1 }]));
    const result = run(a, batch(2, actors, [2, 3].map(actorId => ({ kind: 'PickupCrossing', gateId: 'gate', actorId, fraction: 0.9 }))));
    expect(result.facts).to.have.length(0); expect(a.snapshot().rendezvous[0][1].arrivals.map(value => value.actorId)).to.deep.equal([2, 3]);
  });
  it('does not substitute straight-line proximity for unknown route distance or incomplete membership', () => {
    const actors = [actor(1, 0), actor(2, 0)], value = batch(1, actors, motions(actors, actors));
    const result = run(observer({ distanceMetric: 'route-distance', routeId: 'route' }), value);
    expect(result.responses).to.have.length(0); expect(result.completeness.status).to.equal('censored');
    expect(run(observer(), value, { ...environment, membership: () => ({ status: 'unknown' }) }).responses).to.have.length(0);
  });
  it('ends removed actors and never inherits an episode across generation identity', () => {
    const a = observer(), actors = [actor(1, 0), actor(2, 1)]; run(a, batch(1, actors, motions(actors, actors)));
    expect(run(a, batch(2, [actors[0]], [])).facts[0].reason).to.equal('actor-removed');
    expect(began(run(a, { ...batch(3, actors, motions(actors, actors)), generation: 2 }))).to.have.length(1);
  });
  it('roots a duet through the causal engine and preserves its portable state and exact capture requirements', () => {
    const graph = { version: 1, revision: 1, encounters: [definition()], instruments: [{ id: 'duet', sourceKind: 'EncounterResponse', encounterId: 'meeting', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'duet' }] };
    const a = createCausalMusicEngine({ getGraph: () => graph }), actors = [actor(1, 0), actor(2, 1)], notes = a.processBatch(batch(1, actors, motions(actors, actors))).filter(value => value.kind === 'begin');
    expect(notes.map(value => value.pitch.cents)).to.deep.equal([6000, 6700]); expect(notes.every(value => value.responseGateTicks === 4 && value.sourceEventIds.length === 2)).to.equal(true);
    expect(a.physicalAnalysis().facts[0].kind).to.equal('EncounterBegan');
    const b = createCausalMusicEngine({ getGraph: () => graph }); b.restore(a.snapshot()); expect(b.processBatch(batch(2, actors, []))).to.deep.equal(a.processBatch(batch(2, actors, [])));
    const required = graphCaptureRequirements(graph); expect(required.some(value => value.kind === 'encounters' && value.type === 'state')).to.equal(true); expect(required.some(value => value.kind === 'EncounterResponse' && value.type === 'fact')).to.equal(false);
  });
  it('requires physical pitch memories for exchange and rejects malformed nested checkpoint arrivals atomically', () => {
    const target = observer({ response: { kind: 'intervalExchange', statePolicy: 'exchange-memory' } }), actors = [actor(1, 0), actor(2, 1)];
    expect(run(target, batch(1, actors, motions(actors, actors))).responses).to.have.length(0);
    const a = observer({ kind: 'rendezvous', pickupId: 'gate' }); run(a, batch(1, actors, [{ kind: 'PickupCrossing', gateId: 'gate', actorId: 1, fraction: 1 }]));
    const before = a.snapshot(), corrupt = JSON.parse(JSON.stringify(before)); corrupt.rendezvous[0][1].arrivals[0].time = 100000;
    expect(() => a.restore(corrupt)).to.throw(); expect(a.snapshot()).to.deep.equal(before);
  });
});
