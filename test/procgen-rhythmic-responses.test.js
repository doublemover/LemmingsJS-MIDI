import { expect } from 'chai';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createRhythmicResponses, validateRhythmicResponse } from '../js/app/procgen/workstation/physical/RhythmicResponses.js';
import { validatePickupGate } from '../js/app/procgen/workstation/physical/PickupGates.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const input = (id, sourceKind, response, extra = {}) => ({ id, sourceKind, response, pitchCents: 6000, velocity01: 0.75, role: 'instrument', route: 'local', ...extra });
const batch = (tick, facts, actors = []) => ({ version: 1, worldId: 'scene', generation: 1, tick, batchId: `scene:1:${tick}`, completeness: { status: 'complete', dropped: 0 },
  facts: facts.map((fact, i) => ({ eventId: `fact:${tick}:${i}`, causalSequence: tick * 100 + i, actorId: 7, laneId: 0, ...fact })),
  snapshot: { tick, generation: 1, revision: `1:${tick}`, actors: actors.map(actor => ({ laneId: 0, y: 0, ...actor })) } });
const environment = { membership: () => ({ status: 'complete', includes: true }), routeCoordinate: () => null };

describe('physical rhythmic response interpretation', () => {
  it('requires an explicit supported material-change policy and preserves the existing either default', () => {
    for (const workChangePolicy of ['solid', 'appearance', 'either']) expect(validateRhythmicResponse({ type: 'workCycle', workChangePolicy }, 'WorkResponse').workChangePolicy).to.equal(workChangePolicy);
    expect(validateRhythmicResponse({ type: 'workCycle' }, 'WorkResponse').workChangePolicy).to.equal('either');
    for (const workChangePolicy of ['energy', '', 0, {}, []]) expect(() => validateRhythmicResponse({ type: 'workCycle', workChangePolicy }, 'WorkResponse')).to.throw('change policy');
  });
  it('bounds and validates optional named flight landing and terminal gestures', () => {
    const value = validateRhythmicResponse({ type: 'flightArc', landingGesture: 'soft-landing', terminalGestures: { 'unsafe-fall': 'fatal', 'out-of-world': 'lost' } }, 'FlightArc');
    expect(value.landingGesture).to.equal('soft-landing'); expect(value.terminalGestures).to.deep.equal({ 'unsafe-fall': 'fatal', 'out-of-world': 'lost' });
    for (const changes of [{ landingGesture: '' }, { terminalGestures: [] }, { terminalGestures: { 'unsafe-fall': 1 } }, { terminalGestures: Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['reason' + index, 'gesture'])) }]) expect(() => validateRhythmicResponse({ type: 'flightArc', ...changes }, 'FlightArc')).to.throw('articulation');
  });
  it('preserves exact 6:12 arrival intervals, real gaps and separately typed distance evidence', () => {
    const pickup = validatePickupGate({ id: 'arrival', geometry: { kind: 'segment', points: [{ x: 40, y: -10 }, { x: 40, y: 10 }] } });
    const graph = { version: 1, revision: 1, pickups: [pickup], instruments: [input('crowd', 'CrowdArrival', { type: 'crowdInterval', pickupId: 'arrival', intervalToGate: 0.5 })] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }); const notes = [];
    for (const tick of [1, 7, 19]) notes.push(...engine.processBatch(batch(tick, [{ kind: 'MotionCommitted', positionBefore: { x: 39, y: 0 }, positionAfter: { x: 41, y: 0 } }], [{ actorId: 7, x: 41 }])).filter(intent => intent.kind === 'begin'));
    expect(notes.map(note => note.responseDescriptor.intervalTicks)).to.deep.equal([null, 6, 12]); expect(notes.map(note => note.responseGateTicks)).to.deep.equal([undefined, 3, 6]);
    expect(engine.processBatch(batch(20, [], [{ actorId: 7, x: 41 }]))).to.have.length(0);
  });
  it('never silently substitutes Euclidean distance for an unknown route', () => {
    const instrument = input('crowd', 'CrowdArrival', validateRhythmicResponse({ type: 'crowdInterval', pickupId: 'gate', metric: 'route-distance', routeId: 'u' }, 'CrowdArrival'));
    const responses = createRhythmicResponses(); responses.configure([instrument]);
    const source = batch(1, [], [{ actorId: 7, x: 10 }]);
    const result = responses.expand(source, [{ kind: 'PickupCrossing', actorId: 7, laneId: 0, gateId: 'gate', fraction: 1, direction: 'positive', eventId: 'motion:7', sourceEventIds: ['motion:7'] }], environment);
    expect(result.facts).to.have.length(0); expect(responses.diagnostics().descriptors[0].metricStatus).to.equal('unknown');
  });
  it('joins three dig operations only for the explicitly selected phase grouping', () => {
    const facts = Array.from({ length: 3 }, (_, i) => ({ kind: 'TerrainWorkCommitted', workVersion: 2, actionInstanceId: 'dig:7', operationKind: 'dig', phase: 0, cycleOrdinal: 0, operationOrdinal: i, outcome: 'changed', physicalPayload: { changedSolidCells: 9, changedAppearanceCells: 9 } }));
    const graph = { version: 1, revision: 1, instruments: [input('operations', 'WorkResponse', { type: 'workCycle', mode: 'operation' }), input('phase', 'WorkResponse', { type: 'workCycle', mode: 'action-phase' })] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }), notes = engine.processBatch(batch(1, facts, [{ actorId: 7, x: 0 }])).filter(intent => intent.kind === 'begin');
    expect(notes.filter(note => note.mappingId === 'operations')).to.have.length(3); const grouped = notes.find(note => note.mappingId === 'phase');
    expect(grouped.sourceEventIds).to.have.length(3); expect(grouped.responseDescriptor).to.include({ changedCells: 27, operations: 3, phase: 0 });
  });
  it('distinguishes protected work, zero occupancy addition and a warning without extra attacks', () => {
    const graph = { version: 1, revision: 1, instruments: [input('attempt', 'WorkResponse', { type: 'workCycle', includeZeroWork: true, includeObstruction: true, materialResponse: { 'last-bricks': 'warning', steel: 'steel' } }), input('success', 'WorkResponse', { type: 'workCycle', mode: 'successful-mutation' })] };
    const engine = createCausalMusicEngine({ getGraph: () => graph });
    const notes = engine.processBatch(batch(1, [{ kind: 'TerrainWorkCommitted', workVersion: 2, actionInstanceId: 'build:7', operationKind: 'build', phase: 9, cycleOrdinal: 9, warning: 'last-bricks', outcome: 'no-change', physicalPayload: { changedSolidCells: 0, changedAppearanceCells: 0 } }], [{ actorId: 7, x: 0 }])).filter(intent => intent.kind === 'begin');
    expect(notes).to.have.length(1); expect(notes[0].sampleGesture).to.equal('warning');
  });
  it('owns a scraped action once and releases it at the actual interrupted instance', () => {
    const graph = { version: 1, revision: 1, instruments: [input('scrape', 'WorkResponse', { type: 'workCycle', mode: 'scrape' })] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    const work = { kind: 'TerrainWorkCommitted', actionInstanceId: 'bash:7', operationKind: 'bash', phase: 3, cycleOrdinal: 0, physicalPayload: { changedSolidCells: 12 } };
    const first = engine.processBatch(batch(1, [work], [{ actorId: 7, x: 0 }])); expect(first.map(intent => intent.kind)).to.deep.equal(['begin']);
    expect(engine.processBatch(batch(2, [work], [{ actorId: 7, x: 0 }]))).to.have.length(0);
    const ending = engine.processBatch(batch(3, [{ kind: 'ActionExited', actorId: 7, actionInstanceId: 'bash:7' }], [{ actorId: 7, x: 0 }])); expect(ending.map(intent => intent.kind)).to.deep.equal(['end']); expect(ending[0].voiceId).to.equal(first[0].voiceId);
  });
  it('makes one blocker contact produce independently named walker and blocker roles', () => {
    const graph = { version: 1, revision: 1, instruments: [input('mirror', 'RicochetResponse', { type: 'ricochet', mode: 'mirror', intervals: [700] })] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    const contact = { kind: 'ContactResolved', contactId: '7:8:1:blocker', causeKind: 'blocker', otherActorId: 8, otherLaneId: 1, incomingDirection: 'left' };
    const notes = engine.processBatch(batch(1, [contact], [{ actorId: 7, x: 0 }, { actorId: 8, x: 0, laneId: 1 }])).filter(intent => intent.kind === 'begin');
    expect(notes.map(note => note.actorId)).to.deep.equal([8, 7]); expect(new Set(notes.map(note => note.voiceId)).size).to.equal(2); expect(notes.every(note => note.sourceEventIds[0] === 'fact:1:0')).to.equal(true);
    expect(notes.map(note => note.pitch.cents).sort()).to.deep.equal([5300, 6700]);
  });
  it('rejects malformed restored blocker action ownership before changing its counters', () => {
    const instrument = input('mirror', 'RicochetResponse', validateRhythmicResponse({ type: 'ricochet' }, 'RicochetResponse')), responses = createRhythmicResponses(); responses.configure([instrument]);
    const facts = batch(2, [{ kind: 'ContactResolved', contactId: 'actual:contact2', causeKind: 'blocker', otherActorId: 8, otherActionInstanceId: '8:action:2', incomingDirection: 'right' }], [{ actorId: 7, x: 0 }, { actorId: 8, x: 0 }]); responses.expand(facts, facts.facts, environment);
    const before = responses.snapshot(), changed = JSON.parse(JSON.stringify(before)); changed.states[0][1].actionInstanceId = {};
    expect(() => responses.restore(changed)).to.throw('estimator state'); expect(responses.snapshot()).to.deep.equal(before);
  });
  it('keeps fall-to-float expression under one arc and ends fatal falls without requiring LAND SFX', () => {
    const graph = { version: 1, revision: 1, instruments: [input('arc', 'FlightArc', { type: 'flightArc', landingStrike: true, terminalStrike: false })] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    const start = { kind: 'FlightArcStarted', arcId: '7:flight:1', actionInstanceId: 'fall:7', startTick: 1, startPosition: { x: 0, y: 0 }, source: 'action-transition', peakY: 0, travelPixels: 0, verticalDisplacementPixels: 0 };
    const first = engine.processBatch(batch(1, [start], [{ actorId: 7, x: 0 }])); expect(first.map(intent => intent.kind)).to.deep.equal(['begin']);
    const floating = { ...start, kind: 'FlightArcUpdated', actionInstanceId: 'float:7', parachutePhase: 4, verticalDisplacementPixels: 16, travelPixels: 18 };
    const updates = engine.processBatch(batch(2, [{ kind: 'ActionExited', actionInstanceId: 'fall:7' }, floating], [{ actorId: 7, x: 0, y: 16 }])); expect(updates.map(intent => intent.kind)).to.deep.equal(['update']); expect(updates[0].voiceId).to.equal(first[0].voiceId);
    const restored = createCausalMusicEngine({ getGraph: () => graph }); restored.restore(engine.snapshot());
    const terminal = batch(3, [{ ...floating, kind: 'FlightArcEnded', terminationReason: 'unsafe-fall' }, { kind: 'ActorTerminated', terminationReason: 'unsafe-fall' }]);
    expect(restored.processBatch(terminal)).to.deep.equal(engine.processBatch(terminal)); expect(engine.diagnostics().activeVoices).to.equal(0);
  });
  it('derives cycle phases and flight geometry from real action processing without changing its tables', async () => {
    const masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ laneCount: 2, masks, assists: false });
    world.baseGroundAt = (_x, y) => Math.floor(y / world.laneHeight) === 0 ? y % world.laneHeight >= 82 ? 1 : 0 : 1;
    const builder = world.actors[0], miner = world.actors[1]; builder.x = miner.x = 80; builder.y = 80; miner.y = world.laneHeight + 80;
    builder.setAction(world.actions[State.BUILDING]); miner.setAction(world.actions[State.MINING]); const facts = [];
    world.soundEvents.onBatch.on(value => facts.push(...value.facts)); for (let tick = 0; tick < 192; tick++) world.step();
    const build = facts.filter(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === 'build');
    expect(build.slice(0, 3).map(fact => fact.phase)).to.deep.equal([9, 9, 9]); expect(build.slice(0, 3).map(fact => fact.cycleOrdinal)).to.deep.equal([0, 1, 2]);
    const cycles = facts.filter(fact => fact.kind === 'ActionCycleCompleted'); expect(cycles.filter(fact => fact.actorId === builder.id).every(fact => fact.cycleLengthFrames === 16)).to.equal(true);
    expect(cycles.filter(fact => fact.actorId === miner.id).every(fact => fact.cycleLengthFrames === 24)).to.equal(true); world.dispose();
  });
});
