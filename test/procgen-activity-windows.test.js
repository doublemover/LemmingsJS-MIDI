import { expect } from 'chai';
import { createActivityWindowObserver, validateActivityWindows } from '../js/app/procgen/workstation/physical/ActivityWindows.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenSoundEventBus } from '../js/app/procgen/ProcgenSoundEventBus.js';
import { ProcgenCrewProjects } from '../js/app/procgen/ProcgenCrewProjects.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
const actors = [1, 2].map(actorId => ({ actorId, laneId: 0, x: actorId, y: 0, action: 'walking', actionInstanceId: `walk:${actorId}` }));
const definition = extra => ({ id: 'breath', revision: 1, physicalKinds: ['ContactResolved'], timeoutTicks: 10, ...extra });
const graph = { ensembles: [{ id: 'crew' }], routes: [{ id: 'route' }], topologyRegions: [{ id: 'body' }] };
const environment = { membership: () => ({ status: 'complete', includes: true }), ensembleView: () => ({ completeness: { status: 'complete' } }), routeCoordinate: () => ({ status: 'qualified' }) };
const batch = (tick, facts = [], population = actors) => ({ version: 1, worldId: 'world', generation: 1, batchId: `b:${tick}`, tick, completeness: { status: 'complete', dropped: 0 }, snapshot: { actors: population, terrainRevision: 0, revision: tick }, facts: facts.map((fact, index) => ({ actorId: 1, laneId: 0, eventId: `e:${tick}:${index}`, causalSequence: tick * 100 + index, ...fact })) });
const setup = extra => { const observer = createActivityWindowObserver(); observer.configure(validateActivityWindows({ activityWindows: [definition(extra)] }, graph), graph); return observer; };
const run = (observer, tick, facts = [], options = {}, domain = environment) => { const b = batch(tick, facts); return observer.observe(b, b.facts, domain, options); };
describe('physical inactivity and rooted route cadence', () => {
  it('requires the declared complete crew and rejoin region without changing legacy cadence profiles', () => {
    const completionPolicy = { kind: 'crew-route', expectedCrew: 3, goalRegion: { x1: 132, x2: 208, y1: 64, y2: 112 }, intervals: [0, 400, 700] }, population = [1, 2, 3].map(actorId => ({ actorId, laneId: 0, x: 140 + actorId, y: 95, action: 'walking', actionInstanceId: 'walk:' + actorId }));
    const completion = { kind: 'RouteCompleted', completionId: 'world:crew:fixed-three', crewProjectId: 'fixed-three', positionAfter: { x: 140, y: 95 }, participants: [1, 2, 3], admittedCrew: 3, completionCoverage: 'complete', routeRevisionsUnchanged: true, prerequisiteSourceEventIds: ['opened', 'connected', 'arrived:1', 'arrived:2', 'arrived:3'] };
    for (const changed of [{}, { admittedCrew: 2, participants: [1, 2], prerequisiteSourceEventIds: ['opened', 'connected', 'arrived:1', 'arrived:2'] }, { positionAfter: { x: 120, y: 95 } }, { completionCoverage: 'incomplete' }, { routeRevisionsUnchanged: false }]) {
      const observer = setup({ completionPolicy }), b = batch(1, [{ ...completion, ...changed }], population), result = observer.observe(b, b.facts, environment);
      expect(result.responses).to.have.length(Object.keys(changed).length ? 0 : 3);
      if (!Object.keys(changed).length) { const restored = setup({ completionPolicy }); restored.restore(JSON.parse(JSON.stringify(observer.snapshot()))); const next = batch(2, [completion], population); expect(restored.observe(next, next.facts, environment).responses).to.have.length(0); }
    }
    for (const expectedCrew of [0, 65, '3', NaN]) expect(() => setup({ completionPolicy: { ...completionPolicy, expectedCrew } })).to.throw('fixed-cohort goal');
  });
  it('emits no hidden attacks in an empty or static non-voiced world', () => {
    for (const population of [[], actors]) { const graph = { version: 1, revision: 1, activityWindows: [definition()], instruments: [] }, engine = createCausalMusicEngine({ getGraph: () => graph });
      for (let tick = 1; tick <= 100; tick++) expect(engine.processBatch(batch(tick, [], population))).to.have.length(0);
      expect(engine.physicalAnalysis().facts).to.have.length(0); expect(engine.physicalAnalysis().windows[0].status).to.equal(population.length ? 'never-active' : 'empty-scope');
    }
  });
  it('crosses one ten-tick threshold during a twelve-tick gap and ends the rest on the next real cause', () => {
    const observer = setup(), facts = [];
    for (let tick = 1; tick <= 13; tick++) facts.push(...run(observer, tick, [1, 13].includes(tick) ? [{ kind: 'ContactResolved' }] : []).facts);
    expect(facts.map(value => [value.kind, value.recognitionTick])).to.deep.equal([['RestStarted', 11], ['RestEnded', 13]]);
    expect(facts[0].sourceEventIds).to.deep.equal(['e:1:0']); expect(facts[1].sourceEventIds).to.deep.equal(['e:13:0']);
    expect(observer.snapshot().states[0][1].lastCauseTick).to.equal(13);
  });
  it('does not age through wall-clock time or mistake an owned held action for empty silence', () => {
    const observer = setup(); run(observer, 1, [{ kind: 'ContactResolved' }]); const before = observer.snapshot();
    for (let poll = 0; poll < 1000; poll++) observer.diagnostics(); expect(observer.snapshot()).to.deep.equal(before);
    for (let tick = 2; tick <= 30; tick++) expect(run(observer, tick, [], { heldVoices: [{ actorId: 1, actionInstanceId: 'walk:1' }] }).facts).to.have.length(0);
    expect(observer.diagnostics().last.windows[0].status).to.equal('held-physical-action');
  });
  it('keeps unknown route, topology, capped membership and incomplete intervals separate from rests', () => {
    for (const [extra, domain] of [[{ scope: { routeId: 'route' } }, { ...environment, routeCoordinate: () => ({ status: 'unknown' }) }], [{ scope: { topologyRegionId: 'body' } }, environment], [{ scope: { ensembleId: 'crew' } }, { ...environment, membership: () => ({ status: 'censored' }), ensembleView: () => ({ completeness: { status: 'censored' } }) }]]) {
      const observer = setup(extra); for (let tick = 1; tick < 20; tick++) { const value = run(observer, tick, [], {}, domain); expect(value.facts).to.have.length(0); expect(value.windows[0].status).to.equal('unknown-coverage'); }
    }
    const observer = setup(); run(observer, 1, [{ kind: 'ContactResolved' }]); const incomplete = batch(2); incomplete.completeness.status = 'incomplete'; observer.observe(incomplete, [], environment);
    for (let tick = 3; tick < 20; tick++) expect(run(observer, tick).facts).to.have.length(0);
  });
  it('reports mute and sink rejection without deriving physical absence from either output condition', () => {
    const observer = setup(); const value = run(observer, 1, [{ kind: 'ContactResolved' }], { getLaneState: () => ({ available: false }), output: { status: 'available', lastSinkOutcome: { status: 'rejected', reason: 'capacity' } } });
    expect(value.windows[0]).to.include({ status: 'physical-activity', mutedMembers: 2 }); expect(value.windows[0].output.lastSinkOutcome.status).to.equal('rejected'); expect(value.facts).to.have.length(0);
  });
  it('owns a completed cadence across repeated receipt polls and checkpoint restoration', () => {
    const recipe = { completionPolicy: { kind: 'crew-route', intervals: [0, 700] } }, a = setup(recipe), completion = { kind: 'RouteCompleted', completionId: 'world:crew:1', crewProjectId: 'crew:1', participants: [1, 2], admittedCrew: 2, completionCoverage: 'complete', routeRevisionsUnchanged: true, prerequisiteSourceEventIds: ['opened:1', 'connected:1', 'arrived:1', 'arrived:2'] };
    const first = run(a, 1, [completion]); expect(first.responses).to.have.length(2); expect(first.responses[0].sourceEventIds).to.have.length(5);
    const b = setup(recipe); b.restore(a.snapshot()); expect(run(a, 2, [completion]).responses).to.have.length(0); expect(run(b, 2, [completion]).responses).to.have.length(0);
    const dead = setup(recipe), value = batch(1, [completion], [actors[0]]); expect(dead.observe(value, value.facts, environment).responses).to.have.length(0);
    const incomplete = setup(recipe); expect(run(incomplete, 1, [{ ...completion, completionCoverage: 'incomplete' }]).responses).to.have.length(0);
  });
  it('joins actual crew owner/open/connect/arrival facts and never rewards a failed crew', () => {
    for (const fail of [false, true]) {
      const bus = new ProcgenSoundEventBus({ getGameTime: () => 0 }, 1), published = []; bus.onBatch.on(value => published.push(value));
      const world = { worldId: 'world', generation: 1, tickIndex: 1, laneCount: 1, laneHeight: 144, terrainTileRevisions: new Map(), soundEvents: bus, actions: { [State.WALKING]: {}, [State.BLOCKING]: {} }, actors: [] };
      world.actors = [1, 2].map(id => ({ id, laneIndex: 0, x: 40 - id, y: 100, lookRight: true, action: world.actions[State.WALKING] }));
      const projects = new ProcgenCrewProjects(world, () => {}); bus.beginTick({ worldId: 'world', generation: 1, tick: 1, terrainRevisionBefore: 0 });
      for (const actor of world.actors) projects.observe(actor); const task = {}; projects.begin(world.actors[0], 'builders', task); projects.connect(0, task.crewProjectId, 64, 100, []);
      for (const actor of world.actors) { actor.x = 80; projects.observe(actor); } if (fail) { world.actors[1].terminalReason = 'drowned'; projects.retire(world.actors[1]); }
      projects.finish(0); bus.commitTick({ actors: world.actors.map(actor => ({ actorId: actor.id })) }, 0);
      const completion = published[0].facts.find(fact => fact.kind === 'RouteCompleted');
      if (fail) { expect(completion).to.equal(undefined); expect(published[0].facts.some(fact => fact.kind === 'RouteFailed')).to.equal(true); }
      else { expect(completion.completionCoverage).to.equal('complete'); expect(completion.prerequisiteSourceEventIds).to.have.length(4); expect(completion.prerequisiteSourceEventIds.every(id => published[0].facts.some(fact => fact.eventId === id))).to.equal(true); }
      projects.dispose(); bus.dispose();
    }
  });
  it('does not return an apparently admitted fact identity after producer capacity refusal', () => {
    const bus = new ProcgenSoundEventBus({ getGameTime: () => 0 }, 1); bus.onBatch.on(() => {}); bus.beginTick({ worldId: 'world', generation: 1, tick: 1, terrainRevisionBefore: 0 }); bus._maxFacts = 0;
    expect(bus.emitPhysicalFact({ kind: 'CrewRouteOpened', actorId: 1 })).to.equal(null); bus.abortTick(); bus.dispose();
  });
});
