import { expect } from 'chai';
import { writeFile } from 'node:fs/promises';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ActionCountdownSystem } from '../js/actions/ActionCountdownSystem.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createPhysicalPlaybackFixture } from './support/physical-playback.js';
import { withFakeClockAndPerformance } from './support/timers.js';

const observations = [];
const graphFor = (policy = {}) => ({ version: 1, revision: 1, instruments: [{ id: 'action-owner', sourceKind: 'ActionEntered', route: 'local', role: 'held', pitchCents: 6000, velocity01: .7,
  actionVoicePolicy: { matchActions: ['falling', 'floating', 'walking', 'climbing', 'blocking'], ...policy } }] });
const flat = world => {
  for (let x = 20; x <= 180; x++) { for (let y = 8; y < 176; y++) world.clearGroundAt(x, y); world.setGroundAt(x, 176); world.setGroundAt(x, 177); }
};
const block = (world, actor = world.actors[0]) => { actor.x = 40; actor.y = 175; actor.setAction(world.actions[State.BLOCKING]); return actor; };
const count = (f, kind) => f.intents.filter(intent => intent.kind === kind).length;
const voices = f => f.playback.engine.snapshot().active;
const noteCount = (f, kind) => f.calls.filter(call => call.type === kind).length;
const retire = async f => { const receipt = await f.close(); expect(receipt.outcome).to.equal('complete'); expect(f.midi.diagnostics().ownedVoices).to.equal(0); expect(noteCount(f, 'noteOn')).to.equal(noteCount(f, 'noteOff')); };

describe('real physical action voices and production output ownership', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  after(async () => { if (process.env.LEMMINGS_ACTION_RECEIPT) await writeFile(process.env.LEMMINGS_ACTION_RECEIPT, JSON.stringify({ schema: 'lemmings-action-voice-qualification/v1', observations, scope: 'Actual shared action systems and completed world batches through the physical playback and MIDI scheduler, virtual adapter and controlled time. No receiver/acoustic claim.' }, null, 2) + '\n'); });
  it('holds a real blocker for1000ticks with one begin and one bounded safety end', () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['blocking'], maximumHoldTicks: 1000 }) });
    try {
      flat(f.world); const actor = block(f.world); f.step(1000);
      expect(actor.action).to.equal(f.world.actions[State.BLOCKING]); expect(count(f, 'begin')).to.equal(1); expect(count(f, 'end')).to.equal(0); expect(count(f, 'update')).to.equal(0); expect(noteCount(f, 'noteOn')).to.equal(1);
      f.step(2); expect(count(f, 'end')).to.equal(1); expect(f.intents.at(-1)).to.include({ terminationReason: 'maximum-hold', actorId: actor.id }); expect(voices(f)).to.have.length(0);
      observations.push({ kind: 'blocker', ticks: f.world.tickIndex, begins: count(f, 'begin'), updates: count(f, 'update'), ends: count(f, 'end'), terminationReason: f.intents.at(-1).terminationReason });
      await retire(f);
    } finally { await f.close(); }
  }));
  for (const transitionPolicy of ['release', 'legato', 'crossfade']) it('follows natural fall→float→walk under ' + transitionPolicy, () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ transitionPolicy }) });
    try {
      flat(f.world); const actor = f.world.actors[0]; actor.x = 40; actor.y = 20; actor.hasParachute = true; actor.setAction(f.world.actions[State.FALLING]);
      for (let tick = 0; tick < 180 && actor.action !== f.world.actions[State.WALKING]; tick++) f.step();
      expect(actor.action).to.equal(f.world.actions[State.WALKING]);
      const entries = f.batches.flatMap(batch => batch.facts).filter(fact => fact.kind === 'ActionEntered'); expect(entries.map(fact => fact.action)).to.deep.equal(['falling', 'floating', 'walk']);
      expect(new Set(entries.map(fact => fact.actionInstanceId)).size).to.equal(3); expect(count(f, 'begin')).to.equal(transitionPolicy === 'legato' ? 1 : 3); expect(count(f, 'end')).to.equal(transitionPolicy === 'legato' ? 0 : 2);
      expect(voices(f)).to.have.length(1); const survivor = voices(f)[0]; expect(survivor.actionInstanceId).to.equal(entries.at(-1).actionInstanceId);
      if (transitionPolicy === 'legato') { expect(survivor.voiceId).to.equal(f.intents[0].voiceId); expect(count(f, 'update')).to.equal(2); }
      actor.removed = true; f.step(); clock.tick(24); expect(voices(f)).to.have.length(0); expect(f.midi.diagnostics().ownedVoices).to.equal(0);
      expect(f.receipts.some(receipt => receipt.reason === 'late-attack' || receipt.reason === 'stale-expression')).to.equal(false);
      observations.push({ kind: 'natural-transitions', transitionPolicy, actions: entries.map(fact => ({ action: fact.action, actionInstanceId: fact.actionInstanceId, eventId: fact.eventId })), begins: count(f, 'begin'), ends: count(f, 'end'), midiOwned: 0 }); await retire(f);
    } finally { await f.close(); }
  }));
  it('keeps two actual same-pitch climbers independently expressive when one is removed', () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['climbing'], updateEveryTicks: 2, expressionDeadband: .01, expressionMappings: [{ source: 'actionPhase', target: 'pressure01', scale: .1 }] }) });
    try {
      flat(f.world); const actors = [f.world.actors[0], f.world._spawn(0, false)];
      actors.forEach((actor, index) => { actor.x = 80 + index * 40; actor.y = 160; actor.canClimb = true; for (let y = 20; y <= 176; y++) f.world.setGroundAt(actor.x, y); actor.setAction(f.world.actions[State.CLIMBING]); });
      f.step(10); const begins = f.intents.filter(intent => intent.kind === 'begin'); expect(begins).to.have.length(2); expect(begins.every(intent => intent.pitch.cents === 6000)).to.equal(true);
      const channels = f.calls.filter(call => call.type === 'noteOn').map(call => call.id); expect(new Set(channels).size).to.equal(2); expect(count(f, 'update')).to.be.within(4, 10);
      for (const channel of channels) expect(f.calls.some(call => call.type === 'pressure' && call.id === channel)).to.equal(true);
      actors[0].removed = true; f.step(2); expect(voices(f).map(row => row.actorId)).to.deep.equal([actors[1].id]); expect(f.midi.diagnostics().ownedVoices).to.equal(1);
      expect(f.calls.filter(call => call.type === 'noteOff').map(call => call.id)).to.deep.equal([channels[0]]); expect(f.intents.filter(intent => intent.kind === 'end').map(intent => intent.voiceId)).to.deep.equal([begins[0].voiceId]);
      observations.push({ kind: 'same-pitch-climbers', actorIds: actors.map(actor => actor.id), voiceIds: begins.map(intent => intent.voiceId), channels, survivingActor: actors[1].id, heldAfterPeerRemoval: 1 }); await retire(f);
    } finally { await f.close(); }
  }));
  it('rejects an actual skill command on a falling actor without admitting a worker voice', () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['building'] }) });
    try {
      flat(f.world); const actor = f.world.actors[0]; actor.y = 20;
      expect(f.world.enqueueIntervention({ id: 'failed-builder', kind: 'assign-worker', target: { generation: 1, actorId: actor.id }, origin: 'manual', parameters: { workerKind: 'builders' } }).status).to.equal('queued');
      f.step(); const receipt = f.batches[0].facts.find(fact => fact.commandId === 'failed-builder' && fact.kind === 'CommandRejected'); expect(receipt.status).to.equal('rejected'); expect(count(f, 'begin')).to.equal(0); expect(noteCount(f, 'noteOn')).to.equal(0);
      observations.push({ kind: 'failed-assignment', reason: receipt.reason, begins: 0, noteOns: 0 }); await retire(f);
    } finally { await f.close(); }
  }));
  it('admits an actual walk motion through its canonical action policy without rewriting the source action', () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['walking'], beginCondition: 'motion' }) });
    try {
      flat(f.world); const actor = f.world.actors[0]; actor.x = 40; actor.y = 176; actor.setAction(f.world.actions[State.WALKING]); f.step(3);
      expect(count(f, 'begin')).to.equal(1); expect(noteCount(f, 'noteOn')).to.equal(1); const facts = f.batches.flatMap(batch => batch.facts);
      expect(facts.find(fact => fact.kind === 'ActionEntered').action).to.equal('walk'); expect(facts.some(fact => fact.kind === 'MotionCommitted' && fact.action === 'walk')).to.equal(true);
      expect(f.intents[0].sourceEventIds).to.have.length(2); observations.push({ kind: 'motion-admission', producerAction: 'walk', configuredAction: 'walking', begins: 1, sourceEventIds: f.intents[0].sourceEventIds }); await retire(f);
    } finally { await f.close(); }
  }));
  it('restores an already held action silently until a future physical entry, without reattacking history', () => withFakeClockAndPerformance(async clock => {
    const graph = graphFor({ matchActions: ['blocking'] }), f = await createPhysicalPlaybackFixture({ masks, clock, graph }); let resumed;
    try {
      flat(f.world); block(f.world); f.step(3); const checkpoint = captureProcgenCheckpoint(f.world), causal = f.playback.engine.snapshot(), timelineState = f.timeline.snapshot();
      const world = new ProcgenLaneWorld({ masks, laneHeight: 192, assists: false, worldId: 'held-actions' }); restoreProcgenCheckpoint(world, structuredClone(checkpoint)); const timeline = createProcgenPhysicalScoreClock(); timeline.restore(timelineState);
      resumed = await createPhysicalPlaybackFixture({ masks, clock, graph, world, timeline }); resumed.playback.engine.restore(structuredClone(causal));
      f.step(3); resumed.step(3); expect(resumed.batches).to.deep.equal(f.batches.slice(-3)); expect(resumed.playback.engine.snapshot()).to.deep.equal(f.playback.engine.snapshot()); expect(noteCount(resumed, 'noteOn')).to.equal(0); expect(voices(resumed)).to.have.length(1); expect(resumed.midi.diagnostics().ownedVoices).to.equal(0);
      world.actors[0].setAction(world.actions[State.BLOCKING]); resumed.step(2); expect(noteCount(resumed, 'noteOn')).to.equal(1); expect(count(resumed, 'begin')).to.equal(1);
      observations.push({ kind: 'held-restore', identicalBatches: 3, identicalCausalState: true, historicalReattacks: 0, futureEntryAttacks: 1, policy: 'Semantic continuation is restored; output remains silent until a new physical begin. No historical begin is replayed.' }); await retire(resumed); await retire(f);
    } finally { await resumed?.close(); await f.close(); }
  }));
  it('retires the old identity before shared Lemming object reuse', () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['blocking'] }) });
    try {
      flat(f.world); const actor = block(f.world); f.step(2); const original = f.intents[0]; expect(noteCount(f, 'noteOn')).to.equal(1);
      actor.reset(40, 175, f.world.nextActorId++); actor._musicPositionId = actor.id; actor.laneIndex = 0; actor.spawnLaneIndex = 0; actor.failureReason = null; actor.setAction(f.world.actions[State.BLOCKING]); f.step(2);
      expect(actor.id).not.to.equal(original.actorId); expect(voices(f)).to.have.length(1); expect(voices(f)[0].actorId).to.equal(actor.id); expect(f.intents.filter(intent => intent.kind === 'end' && intent.voiceId === original.voiceId)).to.have.length(1); expect(f.midi.diagnostics().ownedVoices).to.equal(1);
      const recycled = f.intents.find(intent => intent.kind === 'begin' && intent.actorId === actor.id); expect(recycled.voiceId).not.to.equal(original.voiceId);
      observations.push({ kind: 'pooled-object-reuse', identities: [original, recycled].map(({ actorId, voiceId, generation }) => ({ actorId, voiceId, generation })), oldEnds: 1, heldReusedObject: 1 }); await retire(f);
    } finally { await f.close(); }
  }));
  it('retires a real cohort cascade at the completed generation boundary before a fresh actor begins', () => withFakeClockAndPerformance(async clock => {
    const world = new ProcgenLaneWorld({ masks, laneHeight: 192, assists: false, cohorts: true, maxActors: 1, worldId: 'generation-actions', stallPolicy: { secondsWithoutProgress: 0, baseSpawnAllowance: 1, maxSpawnAllowance: 1, transitSafetyFactor: 0, workGraceSeconds: 0, pendingWorkGraceSeconds: 0 } });
    world._spawn(0, false);
    const f = await createPhysicalPlaybackFixture({ masks, clock, world, graph: graphFor({ matchActions: ['blocking', 'ohno', 'exploding'], transitionPolicy: 'legato' }) });
    try {
      flat(world); const actor = block(world); actor.x = 36;
      for (let tick = 0; tick < 200 && world.generation === 1; tick++) f.step();
      expect(world.generation, JSON.stringify(world.stall.snapshot(world.tickIndex))).to.equal(2); clock.tick(24); const original = f.intents.find(intent => intent.kind === 'begin'); expect(original.actorId).to.equal(actor.id);
      expect(f.batches.some(batch => batch.terminalGenerationTransition?.to === 2)).to.equal(true); expect(f.intents.filter(intent => intent.kind === 'end' && intent.voiceId === original.voiceId)).to.have.length(1); expect(f.midi.diagnostics().ownedVoices).to.equal(0);
      flat(world); const fresh = world._spawn(0, false); block(world, fresh); f.step(2);
      expect(voices(f)).to.have.length(1); expect(voices(f)[0]).to.include({ actorId: fresh.id, generation: 2 }); expect(fresh.id).not.to.equal(original.actorId); expect(voices(f)[0].voiceId).not.to.equal(original.voiceId);
      observations.push({ kind: 'completed-generation-reset', original: { actorId: original.actorId, voiceId: original.voiceId }, fresh: { actorId: fresh.id, voiceId: voices(f)[0].voiceId }, generation: world.generation, originalEnds: 1, oldOwned: 0 }); await retire(f);
    } finally { await f.close(); }
  }));
  for (const sameActionReentry of ['restart', 'legato']) it('separates countdown overlay and same-action ' + sameActionReentry, () => withFakeClockAndPerformance(async clock => {
    const f = await createPhysicalPlaybackFixture({ masks, clock, graph: graphFor({ matchActions: ['blocking'], transitionPolicy: 'legato', sameActionReentry }) });
    try {
      flat(f.world); const actor = block(f.world); f.step(); const first = f.intents[0];
      actor.setCountDown(new ActionCountdownSystem(masks)); f.step(4); expect(count(f, 'begin')).to.equal(1); expect(count(f, 'end')).to.equal(0); expect(voices(f)[0].voiceId).to.equal(first.voiceId);
      actor.setAction(f.world.actions[State.BLOCKING]); f.step(); expect(count(f, 'begin')).to.equal(sameActionReentry === 'restart' ? 2 : 1); expect(count(f, 'end')).to.equal(sameActionReentry === 'restart' ? 1 : 0);
      f.step(75); clock.tick(24); expect(actor.action).to.equal(f.world.actions[State.OHNO]); expect(voices(f)).to.have.length(0); expect(f.midi.diagnostics().ownedVoices).to.equal(0);
      observations.push({ kind: 'overlay-reentry-terminal', sameActionReentry, begins: count(f, 'begin'), ends: count(f, 'end'), countdownReattacks: 0, terminalAction: actor.action.actionName }); await retire(f);
    } finally { await f.close(); }
  }));
});
