import { expect } from 'chai';
import { validatePickupGate, sweptPickupCrossings, createPickupQueryPlan, createPickupGateObserver } from '../js/app/procgen/workstation/physical/PickupGates.js';
import { validateEnsembleDefinition, createEnsembleResolver } from '../js/app/procgen/workstation/physical/Ensembles.js';
import { validateRouteDefinition, createRouteCoordinateAtlas } from '../js/app/procgen/workstation/physical/RouteCoordinateAtlas.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createSimScoreTimeline } from '../js/app/procgen/workstation/SimScoreTimeline.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const gate = (id, x, extra = {}) => validatePickupGate({ id, revision: 1, geometry: { kind: 'segment', points: [{ x, y: -100 }, { x, y: 100 }] }, ...extra });
const motion = (actorId, from, to) => ({ kind: 'MotionCommitted', actorId, laneId: 0, positionBefore: { x: from, y: 0 }, positionAfter: { x: to, y: 0 } });
const batch = (tick, facts, actors = [], extra = {}) => ({ version: 1, worldId: 'scene', generation: 1, tick, batchId: `scene:1:${tick}:0`,
  completeness: { status: 'complete', dropped: 0 }, terrainRevisionBefore: 0, terrainRevisionAfter: 0,
  facts: facts.map((fact, index) => ({ ...fact, causalSequence: tick * 100 + index, eventId: `event:${tick}:${index}` })),
  snapshot: { revision: `1:${tick}`, tick, generation: 1, actors: actors.map(actor => ({ laneId: 0, y: 0, action: 'walking', ...actor })) }, ...extra });
const instrument = (id, pickupId) => ({ id, pickupId, sourceKind: 'PickupCrossing', pitchCents: 6000, velocity01: 0.8, role: 'harp', route: 'local' });

describe('world-anchored pickup geometry and ownership', () => {
  it('owns shared vertices once, rejects collinear movement and zero displacement', () => {
    const corner = validatePickupGate({ id: 'joint', geometry: { kind: 'polyline', points: [{ x: 0, y: -10 }, { x: 0, y: 0 }, { x: 10, y: 10 }] } });
    expect(sweptPickupCrossings(corner, { x: -1, y: 0 }, { x: 1, y: 0 })).to.have.length(1);
    expect(sweptPickupCrossings(gate('line', 0), { x: 0, y: 1 }, { x: 0, y: 2 })).to.have.length(0);
    expect(sweptPickupCrossings(gate('line', 0), { x: 0, y: 1 }, { x: 0, y: 1 })).to.have.length(0);
    expect(sweptPickupCrossings(gate('line', 0), { x: -1, y: 0 }, { x: 0, y: 0 })).to.have.length(1);
    expect(sweptPickupCrossings(gate('line', 0), { x: 0, y: 0 }, { x: -1, y: 0 })).to.have.length(0);
  });
  it('orders multiple crossings and maps local string position without camera input', () => {
    const graph = { version: 1, revision: 1, pickups: [gate('b', 42), gate('a', 40)], instruments: [instrument('b-note', 'b'), instrument('a-note', 'a')] };
    const engine = createCausalMusicEngine({ getGraph: () => graph, scoreTimeline: createSimScoreTimeline({ simTickOrigin: 0 }) });
    const notes = engine.processBatch(batch(1, [motion(7, 39, 43)], [{ actorId: 7, x: 43 }])).filter(intent => intent.kind === 'begin');
    expect(notes.map(note => note.mappingId)).to.deep.equal(['a-note', 'b-note']);
    expect(notes.map(note => note.scoreTime.subTick)).to.deep.equal([0.25, 0.75]);
    expect(notes.every(note => note.observation.precision === 'derived-endpoint-interpolation')).to.equal(true);
    expect(notes[0].sourceEventIds).to.deep.equal(['event:1:0']);
  });
  it('crosses both band boundaries in one tick and preserves exact occupancy lifecycle', () => {
    const band = validatePickupGate({ id: 'hold', geometry: { kind: 'band', bounds: { x1: 40, x2: 42, y1: -10, y2: 10 } }, trigger: 'occupancy' });
    let graph = { version: 1, revision: 1, pickups: [band], instruments: [instrument('hold-note', 'hold')] };
    const engine = createCausalMusicEngine({ getGraph: () => graph });
    const notes = engine.processBatch(batch(1, [motion(7, 39, 43)], [{ actorId: 7, x: 43 }]));
    expect(notes.map(note => note.kind)).to.deep.equal(['begin', 'end']); expect(notes[0].voiceId).to.equal(notes[1].voiceId);
    engine.processBatch(batch(2, [motion(7, 43, 41)], [{ actorId: 7, x: 41 }]));
    graph = { ...graph, revision: 2, pickups: [], instruments: [] };
    expect(engine.processBatch(batch(3, [], [{ actorId: 7, x: 41 }])).map(note => note.terminationReason)).to.deep.equal(['mapping-changed']);
    expect(engine.diagnostics().activeVoices).to.equal(0);
  });
  it('does not create an attack by moving geometry over a stationary actor', () => {
    let graph = { version: 1, revision: 1, pickups: [gate('a', 40)], instruments: [instrument('a-note', 'a')] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }); engine.processBatch(batch(1, [], [{ actorId: 7, x: 41 }]));
    graph = { ...graph, revision: 2, pickups: [gate('a', 42, { revision: 2 })] };
    expect(engine.processBatch(batch(2, [], [{ actorId: 7, x: 41 }]))).to.have.length(0);
  });
  it('uses local candidate chunks and refuses unbounded swept queries rather than scanning every gate', () => {
    const plan = createPickupQueryPlan(Array.from({ length: 256 }, (_, i) => gate(`gate-${i}`, i * 256)));
    expect(plan.query({ x: 1, y: 0 }, { x: 3, y: 0 }, 0).gates.length).to.be.lessThan(3);
    expect(plan.query({ x: 0, y: 0 }, { x: 1e9, y: 1e9 }, 0).status).to.equal('unknown');
    expect(() => createPickupQueryPlan([gate('huge', 0, { geometry: { kind: 'segment', points: [{ x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }] } })])).to.throw('capacity');
  });
  it('restores hysteresis and alternating polarity without changing onset identity', () => {
    const observer = createPickupGateObserver(), definition = gate('a', 40, { hysteresis: 1, directionPolicy: 'alternating' }); observer.configure([definition]);
    observer.observe(batch(1, [motion(7, 39, 41)], [{ actorId: 7, x: 41 }]));
    const restored = createPickupGateObserver(); restored.configure([definition]); restored.restore(observer.snapshot());
    const next = batch(2, [motion(7, 42, 38)], [{ actorId: 7, x: 38 }]);
    expect(restored.observe(next)).to.deep.equal(observer.observe(next));
  });
});

describe('completed-source ensemble and route semantics', () => {
  const definition = extra => validateEnsembleDefinition({ id: 'crew', selector: { kind: 'region', bounds: { x1: 0, x2: 10, y1: -5, y2: 5 } }, membershipMode: 'fixedAtAdmission', maximumMembers: 16, ...extra });
  it('retains fixed historical identity across death, transfer and generation reuse', () => {
    const resolver = createEnsembleResolver(); resolver.configure([definition()]); resolver.observe(batch(1, [], [{ actorId: 7, x: 3 }]));
    expect(resolver.observe(batch(2, [], [{ actorId: 7, x: 20, laneId: 1 }]))[0].memberIds).to.deep.equal([7]);
    const saved = resolver.snapshot(), restored = createEnsembleResolver(); restored.configure([definition()]); restored.restore(saved);
    const future = batch(3, [], [{ actorId: 7, x: 3 }], { generation: 2 }); future.snapshot.generation = 2;
    const view = restored.observe(future)[0]; expect(view.memberIds).to.deep.equal([]); expect(view.members[0].reason).to.equal('source-identity-changed');
  });
  it('never chooses first N actors on overflow or interprets unknown route membership as empty', () => {
    const resolver = createEnsembleResolver(); resolver.configure([definition({ maximumMembers: 1 })]);
    const view = resolver.observe(batch(1, [], [{ actorId: 8, x: 1 }, { actorId: 7, x: 2 }]))[0]; expect(view.completeness.status).to.equal('capped'); expect(view.memberIds).to.deep.equal([]);
    resolver.configure([definition({ selector: { kind: 'route', routeId: 'u' }, membershipMode: 'dynamic' })]);
    expect(resolver.observe(batch(2, [], [{ actorId: 7, x: 2 }]))[0].completeness.status).to.equal('unknown');
  });
  it('requires actual entry markers rather than nearest-polyline branch guesses', () => {
    const pickups = [gate('entry', 0), gate('return', 10)], route = validateRouteDefinition({ id: 'u', revision: 1, branchId: 'lower', markers: [{ gateId: 'entry' }, { gateId: 'return' }], segments: [{ id: 'leg', path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] }, pickups);
    const atlas = createRouteCoordinateAtlas(); atlas.configure([route]); atlas.observe(batch(1, [], [{ actorId: 7, x: 3 }]), []); expect(atlas.coordinate(7, 'u')).to.equal(null);
    const crossing = { gateId: 'entry', actorId: 7, direction: 'positive', fraction: 0.5, observationId: 'entry:7', sourceEventIds: ['event:2:0'] };
    atlas.observe(batch(2, [motion(7, -1, 1)], [{ actorId: 7, x: 1 }]), [crossing]); expect(atlas.coordinate(7, 'u')).to.include({ status: 'qualified', sPixels: 1, branchId: 'lower' });
    atlas.observe(batch(3, [], [{ actorId: 7, x: 9 }]), []); expect(atlas.coordinate(7, 'u').status).not.to.equal('qualified');
  });
  it('marks a shared-entry branch ambiguous and restores exact tracker boundaries', () => {
    const pickups = [gate('entry', 0), gate('return', 10)], make = branchId => validateRouteDefinition({ id: branchId, revision: 1, branchId, markers: [{ gateId: 'entry' }, { gateId: 'return' }], segments: [{ id: 'leg', path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] }, pickups);
    const atlas = createRouteCoordinateAtlas(); atlas.configure([make('a'), make('b')]);
    atlas.observe(batch(1, [motion(7, -1, 1)], [{ actorId: 7, x: 1 }]), [{ gateId: 'entry', actorId: 7, direction: 'positive', fraction: 0.5, observationId: 'cross:7', sourceEventIds: ['event:1:0'] }]);
    expect(atlas.coordinate(7, 'a').status).to.equal('ambiguous'); const restored = createRouteCoordinateAtlas(); restored.configure([make('a'), make('b')]); restored.restore(atlas.snapshot()); expect(restored.snapshot()).to.deep.equal(atlas.snapshot());
  });
  it('records actual spread births and missed population slots without phantom members', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ laneCount: 4, masks, cohorts: true, assists: false, maxActors: 4, spawnSpreadTicks: 4 });
    world.baseGroundAt = (_x, y) => y % world.laneHeight >= 80 ? 1 : 0;
    world.soundEvents.onBatch.on(() => {}); for (let tick = 0; tick < 70; tick++) world.step();
    const cohorts = world.getCompletedPhysicalSnapshot().cohorts, first = cohorts[0]; expect(first.status).to.equal('complete');
    expect(first.slots.filter(slot => slot.status === 'admitted')).to.have.length(4); expect(cohorts[1].slots.filter(slot => slot.status === 'missed')).to.have.length(4);
    expect(new Set(first.slots.map(slot => slot.tick)).size).to.be.greaterThan(1);
    expect(world.actors[0].birthCohortId).to.equal(first.id); world.dispose();
  });
  it('uses the real 120/160-tick two-wall fixture with no pattern or rendering input', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ laneCount: 2, masks, assists: false, workstation: false });
    world.baseGroundAt = (x, y) => { const lane = Math.floor(y / world.laneHeight), local = y % world.laneHeight; return local >= 80 || local >= 65 && (x <= 20 || x >= (lane ? 101 : 81)) ? 1 : 0; };
    for (const actor of world.actors) { actor.x = 39; actor.y = actor.laneIndex * world.laneHeight + 80; actor.lookRight = true; actor.setAction(world.actions[State.WALKING]); }
    const crossings = [[], []], observer = createPickupGateObserver(); observer.configure([gate('entry', 40, { directionPolicy: 'positive', geometry: { kind: 'segment', points: [{ x: 40, y: 0 }, { x: 40, y: 2 * world.laneHeight }] } })]);
    world.soundEvents.onBatch.on(value => { for (const crossing of observer.observe(value).observations) crossings[crossing.laneId].push(value.tick); });
    for (let tick = 0; tick < 961; tick++) world.step();
    expect(crossings[0].slice(0, 5)).to.deep.equal([1, 121, 241, 361, 481]); expect(crossings[1].slice(0, 4)).to.deep.equal([1, 161, 321, 481]); world.dispose();
  });
});
