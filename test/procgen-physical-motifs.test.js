import { expect } from 'chai';
import { createPhysicalMotifObserver, validatePhysicalMotifs } from '../js/app/procgen/workstation/physical/PhysicalMotifs.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
const graph = { ensembles: [], pickups: [{ id: 'gate' }], routes: [], encounters: [{ id: 'meeting' }] };
const actors = [1, 2].map(actorId => ({ actorId, laneId: 0, x: actorId, y: 0, actionInstanceId: `action:${actorId}`, birthCohortId: 'cohort:1' }));
const environment = { membership: () => ({ status: 'complete', includes: true }) };
const event = (kind, actorId = 1, extra = {}) => ({ kind, actorId, actionInstanceId: `action:${actorId}`, ...extra });
const definition = extra => ({ id: 'phrase', revision: 1, roles: [{ id: 'leader', distinctFrom: ['follower'] }, { id: 'follower' }], clauses: [
  { role: 'leader', predicate: { kind: 'TerrainWorkCommitted', operationKind: 'build' } },
  { role: 'follower', predicate: { kind: 'FlightArcStarted' }, withinTicks: 12 },
  { role: 'leader', predicate: { kind: 'RendezvousCompleted', encounterId: 'meeting' }, withinTicks: 24 }
], expiryTicks: 48, ...extra });
const batch = (tick, facts = []) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: `b:${tick}`, terrainRevisionAfter: 0, completeness: { status: 'complete', dropped: 0 }, snapshot: { actors, revision: tick }, facts: facts.map((fact, index) => ({ eventId: `e:${tick}:${index}`, causalSequence: tick * 100 + index, laneId: 0, ...fact })) });
const setup = extra => { const result = createPhysicalMotifObserver(); result.configure(validatePhysicalMotifs({ motifs: [definition(extra)] }, graph), graph); return result; };
const run = (target, tick, facts = [], coverage = { encounters: 'complete' }) => { const b = batch(tick, facts); return target.observe(b, b.facts, environment, coverage); };
const strike = () => event('TerrainWorkCommitted', 1, { operationKind: 'build' });
describe('finite physical motif recognition', () => {
  it('recognizes strike, another actor falling, and reunion once with exact roots at recognition time', () => {
    const target = setup(), outputs = [];
    for (let tick = 1; tick <= 30; tick++) outputs.push(...run(target, tick, tick === 1 ? [strike()] : tick === 10 ? [event('FlightArcStarted', 2)] : tick === 20 ? [event('RendezvousCompleted', 1, { encounterId: 'meeting', participants: [1, 2] })] : []).facts);
    expect(outputs).to.have.length(1); expect(outputs[0]).to.include({ recognitionTick: 20, fraction: 1, kind: 'MotifCompleted' }); expect(outputs[0].sourceEventIds).to.deep.equal(['e:1:0', 'e:10:0', 'e:20:0']);
  });
  it('cannot satisfy distinct actor roles with one actor and cannot backfill an expired phrase', () => {
    for (const [fallActor, fallTick] of [[1, 2], [2, 15]]) {
      const target = setup(); let completed = 0;
      for (let tick = 1; tick <= 50; tick++) completed += run(target, tick, tick === 1 ? [strike()] : tick === fallTick ? [event('FlightArcStarted', fallActor)] : tick === 20 ? [event('RendezvousCompleted', 1, { encounterId: 'meeting', participants: [1, 2] })] : []).facts.length;
      expect(completed).to.equal(0); expect(target.diagnostics().partials).to.equal(0);
    }
  });
  it('applies deterministic first, last and all anchor overlap semantics', () => {
    for (const [overlapPolicy, expected] of [['first', ['e:1:0']], ['last', ['e:2:0']], ['all', ['e:1:0', 'e:2:0']]]) {
      const target = setup({ overlapPolicy, clauses: definition().clauses.slice(0, 2) }); run(target, 1, [strike()]); run(target, 2, [strike()]);
      expect(run(target, 3, [event('FlightArcStarted', 2)]).facts.map(fact => fact.sourceEventIds[0])).to.deep.equal(expected);
    }
  });
  it('matches conjunction in either order but consumes one physical observation only once', () => {
    const target = setup({ mode: 'conjunction', clauses: definition().clauses.slice(0, 2) });
    expect(run(target, 1, [event('FlightArcStarted', 2)]).facts).to.have.length(0);
    expect(run(target, 2, [strike()]).facts).to.have.length(1);
    const sameKind = setup({ mode: 'conjunction', clauses: [{ role: 'leader', predicate: { kind: 'MotionCommitted' } }, { role: 'follower', predicate: { kind: 'MotionCommitted' } }] });
    expect(run(sameKind, 1, [event('MotionCommitted')]).facts).to.have.length(0);
  });
  it('requires a complete absence interval and rejects a forbidden event exactly at its deadline', () => {
    const clauses = [definition().clauses[0], { kind: 'absence', role: 'leader', predicate: { kind: 'ContactResolved' }, durationTicks: 3 }];
    const complete = setup({ clauses }), censored = setup({ clauses }), forbidden = setup({ clauses });
    for (const target of [complete, censored, forbidden]) run(target, 1, [strike()]);
    run(complete, 2); run(complete, 3); expect(run(complete, 4).facts[0].absenceIntervals).to.deep.equal([{ firstTick: 1, lastTick: 4, predicate: 'ContactResolved', coverage: 'complete' }]);
    const missing = batch(2); missing.completeness.status = 'incomplete'; censored.observe(missing, [], environment); run(censored, 3); expect(run(censored, 4).facts).to.have.length(0);
    run(forbidden, 2); run(forbidden, 3); expect(run(forbidden, 4, [event('ContactResolved')]).facts).to.have.length(0);
    expect(censored.diagnostics().trace.some(value => value.status === 'censored')).to.equal(true);
  });
  it('checkpoints role bindings and repeat progress without freezing live state', () => {
    const recipe = { roles: [{ id: 'leader' }], clauses: [{ kind: 'repeat', count: 3, role: 'leader', predicate: { kind: 'PickupCrossing', pickupId: 'gate' } }] }, a = setup(recipe);
    const crossing = event('PickupCrossing', 1, { gateId: 'gate' }); run(a, 1, [crossing]); const checkpoint = a.snapshot(), b = setup(recipe); b.restore(checkpoint);
    expect(run(a, 2, [crossing])).to.deep.equal(run(b, 2, [crossing])); expect(run(a, 3, [crossing])).to.deep.equal(run(b, 3, [crossing])); expect(checkpoint.partials[0][1][0].used).to.have.length(1);
  });
  it('censors relationship-dependent absence when dense aggregation or unknown membership prevents proof', () => {
    const target = setup({ roles: [{ id: 'leader' }], clauses: [definition().clauses[0], { kind: 'absence', role: 'leader', predicate: { kind: 'EncounterBegan', encounterId: 'meeting' }, durationTicks: 2 }] });
    run(target, 1, [strike()]); expect(run(target, 2, [], { encounters: 'censored' }).completeness.status).to.equal('censored'); expect(run(target, 3).facts).to.have.length(0);
  });
  it('is invariant to input enumeration and never restores impossible completed partials', () => {
    const a = setup({ mode: 'conjunction', clauses: definition().clauses.slice(0, 2) }), b = setup({ mode: 'conjunction', clauses: definition().clauses.slice(0, 2) }), value = batch(1, [strike(), event('FlightArcStarted', 2)]);
    expect(a.observe(value, value.facts, environment)).to.deep.equal(b.observe(value, [...value.facts].reverse(), environment));
    const target = setup(); run(target, 1, [strike()]); const before = target.snapshot(), corrupt = JSON.parse(JSON.stringify(before)); corrupt.partials[0][1][0].done = [true, true, true];
    expect(() => target.restore(corrupt)).to.throw(); expect(target.snapshot()).to.deep.equal(before);
  });
  it('integrates explicit harmony responses without inventing pre-recognition onsets', () => {
    const motif = definition({ clauses: definition().clauses.slice(0, 2), completionMapping: { kind: 'harmony', intervals: [0, 700], velocityScale: 0.5 } });
    const graph = { version: 1, revision: 1, motifs: [motif], instruments: [{ id: 'answer', sourceKind: 'MotifResponse', motifId: 'phrase', pitchCents: 6000, velocity01: 0.8, role: 'response', route: 'local' }] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    expect(engine.processBatch(batch(1, [strike()]))).to.have.length(0); const notes = engine.processBatch(batch(2, [event('FlightArcStarted', 2)])).filter(value => value.kind === 'begin');
    expect(notes.map(value => value.pitch.cents)).to.deep.equal([6000, 6700]); expect(notes.every(value => value.scoreTime.simTick === 2 && value.velocity01 === 0.4)).to.equal(true);
  });
});
