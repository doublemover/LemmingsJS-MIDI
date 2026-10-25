import { expect } from 'chai';
import { createPhysicalFeedbackState, validatePhysicalFeedbackState, evaluatePhysicalFeedback, createPhysicalFeedbackController, applyRecordedPhysicalFeedback } from '../js/app/procgen/workstation/physical/PhysicalFeedback.js';
import { validatePhysicalFeedback, planPhysicalFeedback } from '../js/app/procgen/workstation/physical/PhysicalFeedbackSchema.js';
import { validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { subscribeProcgenCommittedBoundary } from '../js/app/procgen/ProcgenCommittedBoundary.js';
const rule = extra => ({ id: 'answer', revision: 1, source: { kind: 'ActorBorn' }, target: { version: 1, kind: 'source-actor' }, command: { kind: 'assign-worker', parameters: { workerKind: 'builders' } }, fuel: 4, refractoryTicks: 1, ...extra });
const graph = extra => validateCausalInstrumentGraph({ version: 1, revision: 1, instruments: [], feedback: { version: 1, conductors: [rule()], layers: [], ...extra } });
const batch = (tick, facts = [], actors = [{ actorId: 1, laneId: 0, x: 10, y: 20 }]) => ({ version: 1, batchId: `b:${tick}`, worldId: 'test', generation: 1, tick, completeness: { status: 'complete' }, snapshot: { tick, generation: 1, actors, cohorts: [] }, facts: facts.map((fact, index) => ({ eventId: `e:${tick}:${index}`, causalSequence: tick * 10000 + index, actorId: 1, laneId: 0, ...fact })) });
describe('causal physical conductors and intervention layers', () => {
  it('admits only typed bounded future physical commands, never arbitrary output or teleportation', () => {
    for (const command of ['send-midi', 'teleport', 'nuke-all', 'terrain-edit']) expect(() => graph({ conductors: [rule({ command: { kind: command, parameters: {} } })] })).to.throw();
    expect(() => graph({ conductors: [rule({ eligibilityTicks: 601 })] })).to.throw(); expect(() => graph({ conductors: [rule({ refractoryTicks: 0 })] })).to.throw();
    const value = graph(), result = evaluatePhysicalFeedback({}, value, batch(1, [{ kind: 'ActorBorn' }]), null, createPhysicalFeedbackState('epoch', 1), { live: true });
    expect(result.commands).to.have.length(1); expect(result.commands[0]).to.include({ applyAtTick: 2, origin: 'conductor' }); expect(result.commands[0].causality.parentCauseIds).to.deep.equal(['e:1:0']); expect(result.state.rules[0].fuel).to.equal(3); expect(planPhysicalFeedback(value.feedback).maximumProposalsPerEpoch).to.equal(4);
  });
  it('roots threshold predicates in every counted physical event and resets windows across gaps', () => {
    const g = graph({ conductors: [rule({ threshold: 2, windowTicks: 3 })] }); let state = createPhysicalFeedbackState('epoch', 1);
    state = evaluatePhysicalFeedback({}, g, batch(1, [{ kind: 'ActorBorn' }]), null, state).state;
    const second = evaluatePhysicalFeedback({}, g, batch(2, [{ kind: 'ActorBorn' }]), null, state); expect(second.commands[0].causality.parentCauseIds).to.deep.equal(['e:1:0', 'e:2:0']);
    expect(evaluatePhysicalFeedback({}, g, batch(4, [{ kind: 'ActorBorn' }]), null, state).commands).to.have.length(0);
  });
  it('uses bounded crowd density explicitly rather than pretending one aggregate is many facts', () => {
    const g = graph({ conductors: [rule({ source: { kind: 'EncounterBegan', measure: 'participants' }, threshold: 32 })] }), source = batch(1, [{ kind: 'MotionCommitted' }]), analysis = { batchId: source.batchId, completeness: { status: 'complete' }, facts: [{ kind: 'EncounterBegan', observationId: 'encounter:1', actorId: 1, eventId: 'e:1:0', sourceEventIds: ['e:1:0'], participantCount: 1024 }] };
    expect(evaluatePhysicalFeedback({}, g, source, analysis, createPhysicalFeedbackState('epoch', 1)).commands).to.have.length(1);
  });
  it('rejects reciprocal ancestry and consumes fuel instead of recursively applying a same-tick action', () => {
    const first = evaluatePhysicalFeedback({}, graph(), batch(1, [{ kind: 'ActorBorn' }]), null, createPhysicalFeedbackState('epoch', 1), { live: true });
    const next = evaluatePhysicalFeedback({}, graph(), batch(2, [{ kind: 'ActorBorn', parentCauseIds: [first.commands[0].id] }]), null, first.state, { live: true });
    expect(next.commands).to.have.length(0); expect(next.state.rules[0].fuel).to.equal(2); expect(next.state.trace.at(-1).reason).to.equal('unknown-or-cyclic-ancestry');
  });
  it('caps repeated actors, rule fuel, total source work and state storage independently', () => {
    let state = createPhysicalFeedbackState('epoch', 1); const g = graph({ conductors: [rule({ fuel: 256 })] }); let count = 0;
    for (let tick = 1; tick <= 100; tick++) { const result = evaluatePhysicalFeedback({}, g, batch(tick, [{ kind: 'ActorBorn' }]), null, state); state = result.state; count += result.commands.length; }
    expect(count).to.equal(16); expect(state.actorCounts).to.deep.equal([[1, 16]]); expect(() => validatePhysicalFeedbackState({ ...state, seen: Array(4097).fill('anchor') })).to.throw();
  });
  it('binds actual gate occurrences and cohort roles, and never substitutes a nearby surviving actor', () => {
    const feedback = validatePhysicalFeedback({ version: 1, layers: [{ id: 'entrance', revision: 1, rules: [rule({ source: { kind: 'PickupCrossing', pickupId: 'gate' }, target: { version: 1, kind: 'cohort-rank', rank: 1 } })] }] }, { pickups: [{ id: 'gate' }] });
    const value = batch(1, [{ kind: 'MotionCommitted' }], [{ actorId: 1, x: 10, y: 20, birthCohortId: 'cohort' }, { actorId: 2, x: 11, y: 20, birthCohortId: 'cohort' }]); value.snapshot.cohorts = [{ id: 'cohort', generation: 1, status: 'complete', slots: [{ actorId: 2, status: 'admitted' }, { actorId: 1, status: 'admitted' }] }];
    const analysis = { batchId: value.batchId, facts: [{ kind: 'PickupCrossing', gateId: 'gate', actorId: 1, observationId: 'gate:cross:1', sourceEventIds: ['e:1:0'] }], completeness: { status: 'complete' } };
    const result = evaluatePhysicalFeedback({}, { feedback }, value, analysis, createPhysicalFeedbackState('epoch', 1)); expect(result.commands[0].target.actorId).to.equal(2);
    value.snapshot.actors.pop(); const stale = evaluatePhysicalFeedback({}, { feedback }, value, analysis, createPhysicalFeedbackState('epoch', 1)); expect(stale.commands).to.have.length(0); expect(stale.state.trace.at(-1).reason).to.equal('stale-or-unresolved-target');
  });
});
describe('real-world feedback command ownership and exact command replay', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const ready = () => { const w = new ProcgenLaneWorld({ masks, seed: 42, assists: false, workerLimits: { builders: 1, diggers: 1 } }), actor = w.actors[0]; actor.y = w.surfaceAt(0, actor.x); actor.setAction(w.actions[State.WALKING]); return w; };
  const connect = (world, records, options = {}) => { const controller = createPhysicalFeedbackController({ world, getGraph: () => graph(), recordInput: (input, boundary) => { records.push({ input, boundary }); return { status: 'accepted' }; }, ...options }); world.soundEvents.onBatch.on(batch => controller.observe(batch, null)); return controller; };
  it('dry run cannot change the world; explicit live arming proposes next tick and actual bricks cite acceptance', () => {
    const w = ready(), records = [], c = connect(w, records), facts = []; w.soundEvents.onBatch.on(batch => facts.push(...batch.facts)); w.step(); expect(w.interventionState.pending).to.have.length(0); expect(c.diagnostics().latest.proposals).to.have.length(1); expect(records).to.have.length(0); c.dispose(); w.dispose();
    const live = ready(), log = [], controller = connect(live, log), events = []; live.soundEvents.onBatch.on(batch => events.push(...batch.facts)); controller.arm({ epoch: 'live:test' }); live.step(); const command = live.interventionState.pending[0]; expect(command.applyAtTick).to.equal(2); expect(live.stats.builds).to.equal(0); live.step(); expect(live.stats.builds).to.equal(1); for (let i = 0; i < 10; i++) live.step();
    const accepted = events.find(event => event.kind === 'CommandApplied' && event.commandId === command.id), brick = events.find(event => event.kind === 'TerrainWorkCommitted'); expect(accepted.causality.parentCauseIds).to.include(events.find(event => event.kind === 'ActorBorn').eventId); expect(brick.parentCauseIds).to.include(command.id); controller.dispose(); live.dispose();
  });
  it('manual commands keep priority; rejected feedback does not create a fabricated worker action', () => {
    const w = ready(), log = [], c = connect(w, log), facts = []; w.soundEvents.onBatch.on(batch => facts.push(...batch.facts)); c.arm({ epoch: 'priority' }); w.step(); const feedback = w.interventionState.pending[0];
    w.enqueueIntervention({ id: 'manual-first', kind: 'assign-worker', origin: 'manual', target: { generation: w.generation, actorId: w.actors[0].id }, parameters: { workerKind: 'builders' } }); w.step(); const rejected = facts.find(fact => fact.commandId === feedback.id && fact.kind === 'CommandRejected'); expect(rejected.reason).to.equal('conflicting-command'); expect(facts.filter(fact => fact.kind === 'ActionEntered' && fact.action === 'building')).to.have.length(1); c.dispose(); w.dispose();
  });
  it('replays the recorded commands and state without reevaluating rules, independent of renderer time', () => {
    const a = ready(), b = ready(), checkpoint = captureProcgenCheckpoint(a); restoreProcgenCheckpoint(b, checkpoint); const log = [], c = connect(a, log), factsA = [], factsB = []; a.soundEvents.onBatch.on(batch => factsA.push(batch)); b.soundEvents.onBatch.on(batch => factsB.push(batch)); c.arm({ epoch: 'exact' });
    let consumed = 0; for (let tick = 0; tick < 20; tick++) { while (consumed < log.length && log[consumed].boundary.tick === b.tickIndex) applyRecordedPhysicalFeedback(b, log[consumed++].input); a.step(tick * 3); b.step(100000 + tick * 100); }
    while (consumed < log.length) applyRecordedPhysicalFeedback(b, log[consumed++].input); expect(factsB).to.deep.equal(factsA); expect(b.physicalFeedback).to.deep.equal(a.physicalFeedback); expect(b.interventionState).to.deep.equal(a.interventionState); c.dispose(); a.dispose(); b.dispose();
  });
  it('does not publish a proposal when the journal refuses, and disarm cancels only its pending commands', () => {
    const w = ready(); let accept = true; const c = connect(w, [], { recordInput: () => ({ status: accept ? 'accepted' : 'rejected' }) }); c.arm({ epoch: 'refusal' }); accept = false; w.step(); expect(w.interventionState.pending).to.have.length(0); expect(c.diagnostics().armed).to.equal(false); accept = true; c.dispose(); w.dispose();
    const live = ready(), controller = connect(live, []); controller.arm({ epoch: 'cancel' }); live.step(); live.enqueueIntervention({ id: 'manual-survives', kind: 'set-release-policy', origin: 'manual', target: { generation: live.generation }, parameters: { spawnSpreadTicks: 2 } }); controller.disarm(); expect(live.interventionState.pending.map(value => value.id)).to.deep.equal(['manual-survives']); controller.dispose(); live.dispose();
  });
  it('retains a human command receipt for explicit anchored capture without inferring time proximity', () => {
    const w = ready(), log = [], c = connect(w, log); w.enqueueIntervention({ id: 'played-once', kind: 'assign-worker', origin: 'live-controller', target: { generation: w.generation, actorId: w.actors[0].id }, parameters: { workerKind: 'builders' } }); w.step(); w.step(); expect(c.diagnostics().capturableCommands[0].commandId).to.equal('played-once');
    expect(() => c.capture({ commandId: 'played-once', layerId: 'capture', anchor: { kind: 'PickupCrossing', pickupId: 'missing' }, binding: { version: 1, kind: 'source-actor' } })).to.throw('Unresolved'); expect(w.interventionState.pending).to.have.length(0); c.dispose(); w.dispose();
  });
  it('preserves original target identity through bounded eligibility waits and expires without substitution', () => {
    const w = new ProcgenLaneWorld({ masks, seed: 42, assists: false }), log = [], g = graph({ conductors: [rule({ eligibilityTicks: 2 })] }), c = connect(w, log, { getGraph: () => g }), facts = []; w.soundEvents.onBatch.on(value => facts.push(...value.facts)); c.arm({ epoch: 'wait' }); for (let i = 0; i < 5; i++) w.step();
    expect(facts.some(value => value.kind === 'CommandWaiting')).to.equal(true); expect(facts.some(value => value.kind === 'CommandRejected' && value.status === 'expired')).to.equal(true); expect(w.stats.builds).to.equal(0); c.dispose(); w.dispose();
  });
  it('publishes after the physical tick without permitting reentrant simulation', () => {
    const w = ready(); let called = false; const off = subscribeProcgenCommittedBoundary(w, () => { called = true; expect(w._stepping).to.equal(false); expect(() => w.step()).to.throw('reentered'); }); w.step(); expect(called).to.equal(true); off(); w.dispose();
  });
});
