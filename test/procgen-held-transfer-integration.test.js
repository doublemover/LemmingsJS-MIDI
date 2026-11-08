import { expect } from 'chai';
import { writeFile } from 'node:fs/promises';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { compareProcgenPhysicsCheckpoints } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { captureCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { createCausalMidiSink } from '../js/app/procgen/workstation/CausalMidiSink.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createProcgenPhysicalPlayback } from '../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenLane } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createProcgenLaneProjection } from '../js/app/procgen/workstation/ProcgenLaneProjection.js';
import { makeOutput } from './support/midi-output.js';
import { withFakeClockAndPerformance } from './support/timers.js';

const qualification = [];
const policies = ['carry', 'revoice', 'releaseAndAttack', 'silentHandoff'];
const graphFor = policy => ({ version: 1, revision: 1, instruments: [{ id: 'crossing-held', sourceKind: 'ActionEntered', pitchCents: 6000, velocity01: .7, route: 'local', role: 'held',
  actionVoicePolicy: { matchActions: ['floating', 'climbing'], maximumHoldTicks: 1000 }, voiceTransfer: { policy } }] });
const worldFor = masks => new ProcgenLaneWorld({ masks, laneCount: 2, cohorts: true, assists: false, maxActors: 2, worldId: 'transfer-world' });
const prepareWorld = masks => {
  const world = worldFor(masks), down = world._spawn(0, false), up = world._spawn(1, false);
  for (let y = 0; y < world.height; y++) world.clearGroundAt(40, y);
  for (let y = 60; y <= 120; y++) world.setGroundAt(80, y);
  down.x = 40; down.y = 92; down.hasParachute = true; down.setAction(world.actions[State.FLOATING]); down.frameIndex = 0;
  up.x = 80; up.y = 98; up.canClimb = true; up.setAction(world.actions[State.CLIMBING]); up.frameIndex = 3;
  return { world, down, up };
};
const fixture = async (masks, clock, policy, { muted = false, disconnected = false } = {}) => {
  const { world, down, up } = prepareWorld(masks), calls = [], receipts = [], batches = [], intents = [], graph = graphFor(policy), timeline = createProcgenPhysicalScoreClock();
  let lanes = [createProcgenLane(0, { mode: 'physical', name: 'Origin', channel: 1, role: 'lead', externalPercussion: false, externalProgram: null }), createProcgenLane(1, { mode: 'physical', name: 'Destination', channel: 1, role: 'lead', externalPercussion: false, externalProgram: null })];
  const ports = createProcgenMidiPorts({ now: () => clock.now, schedulerConfig: { mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3, 4, 5, 6, 7], pitchBendRange: { semitones: 2 } } } });
  const output = makeOutput(Array.from({ length: 8 }, (_, index) => index + 1), calls, 'transfer-device');
  for (const [id, channel] of Object.entries(output.channels)) { channel.sendProgramChange = (value, options) => calls.push({ type: 'program', id: Number(id), value, options }); channel.sendChannelAftertouch = (value, options) => calls.push({ type: 'pressure', id: Number(id), value, options }); }
  ports.setNoteOutputs([output]); ports.setNoteOutput(output); calls.length = 0;
  const midi = createCausalMidiSink({ ports, getLanes: () => lanes, now: () => clock.now, isEnabled: () => true, maxVoices: 8 });
  const playback = createProcgenPhysicalPlayback({ audio: null, world, getGraph: () => graph, getLanes: () => lanes, scoreTimeline: timeline, now: () => clock.now, additionalOutputs: [midi], onReceipt: value => receipts.push(value) });
  await playback.ready();
  const listener = batch => { batches.push(batch); intents.push(...playback.processBatch(batch, { bpm: 120, position: timeline.observe(batch, { bpm: 120 }) })); };
  world.soundEvents.onBatch.on(listener);
  const step = () => { world.step(); clock.tick(world.timer.frameTime); return batches.at(-1); };
  step();
  clock.tick(5); expect(calls.filter(call => call.type === 'noteOn')).to.have.length(2);
  const initial = playback.engine.snapshot();
  expect(initial.active).to.have.length(2); expect(new Set(initial.active.map(row => row.voiceId)).size).to.equal(2);
  expect(intents.filter(intent => intent.kind === 'begin').every(intent => intent.pitch.cents === 6000)).to.equal(true);
  const editLane = (index, patch) => { lanes = lanes.map((lane, at) => at === index ? { ...lane, ...patch } : lane); playback.synchronizeLaneMix(); };
  if (muted) editLane(1, { mute: true });
  if (disconnected) ports.setNoteOutputs([]);
  return { world, down, up, get lanes() { return lanes; }, editLane, graph, timeline, calls, receipts, batches, intents, playback, midi, ports, initial, step,
    async dispose() { world.soundEvents.onBatch.off(listener); const stopped = playback.dispose(); await stopped.completion; ports.dispose(); const retired = world.dispose(); if (retired?.completion) await retired.completion; return stopped; } };
};

describe('actual held actor crossing and sink ownership', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  after(async () => { if (process.env.LEMMINGS_TRANSFER_RECEIPT) await writeFile(process.env.LEMMINGS_TRANSFER_RECEIPT, JSON.stringify({ schema: 'lemmings-held-transfer-qualification/v1', scenarios: qualification, scope: 'Real physical actions/batches, causal engine, production MIDI scheduler with virtual adapters and controlled time; no hardware/acoustic claim.' }, null, 2) + '\n'); });
  for (const policy of policies) it('preserves opposite equal-pitch actors through real float/climb crossings under ' + policy, () => withFakeClockAndPerformance(async clock => {
    const f = await fixture(masks, clock, policy);
    try {
      for (let tick = 0; tick < 7; tick++) f.step();
      const transfers = f.batches.flatMap(batch => batch.facts.filter(fact => fact.kind === 'ActorLaneTransferred'));
      expect(transfers).to.have.length(2);
      expect(transfers.map(fact => [fact.actorId, fact.previousLaneId, fact.laneId])).to.have.deep.members([[f.down.id, 0, 1], [f.up.id, 1, 0]]);
      expect(f.down.spawnLaneIndex).to.equal(0); expect(f.up.spawnLaneIndex).to.equal(1); expect(f.down.laneIndex).to.equal(1); expect(f.up.laneIndex).to.equal(0);
      const originalByActor = new Map(f.initial.active.map(row => [row.actorId, row.voiceId])), active = f.playback.engine.snapshot().active;
      if (policy === 'silentHandoff') expect(active).to.have.length(0);
      else {
        expect(active).to.have.length(2); expect(new Set(active.map(row => row.voiceId)).size).to.equal(2);
        for (const row of active) { expect(row.laneId).to.equal(row.actorId === f.down.id ? 1 : 0); expect(policy === 'carry' ? row.voiceId : row.rootVoiceId).to.equal(originalByActor.get(row.actorId)); }
      }
      for (const fact of transfers) {
        const derived = f.intents.filter(intent => intent.sourceEventIds.includes(fact.eventId));
        expect(derived.map(intent => intent.kind)).to.deep.equal(policy === 'carry' ? ['update'] : policy === 'silentHandoff' ? ['end'] : ['end', 'begin']);
        expect(derived.every(intent => intent.actorId === fact.actorId && intent.onsetId && intent.voiceId)).to.equal(true);
      }
      expect(f.receipts.some(receipt => receipt.losses?.some(loss => loss.kind === 'voice-crossfade-unavailable'))).to.equal(policy === 'revoice');
      expect(f.calls.filter(call => call.type === 'noteOn')).to.have.length(policy === 'revoice' || policy === 'releaseAndAttack' ? 4 : 2);
      expect(f.receipts.some(receipt => receipt.reason === 'late-attack' || receipt.reason === 'stale-expression')).to.equal(false);
      const ownership = () => f.playback.engine.snapshot().active.map(({ actorId, voiceId, laneId }) => ({ actorId, voiceId, laneId }));
      const beforeRows = ownership(), projection = createProcgenLaneProjection({ laneCount: 2, height: 608, physicalHeight: f.world.laneHeight, laneIndices: [1, 0] });
      expect([projection.laneAt(0), projection.laneAt(607)]).to.deep.equal([1, 0]); f.step(); expect(ownership()).to.deep.equal(beforeRows);
      const stopped = await f.dispose(); expect(stopped.outcome).to.equal('complete'); expect(f.midi.diagnostics().ownedVoices).to.equal(0);
      expect(f.calls.filter(call => call.type === 'noteOn').length).to.equal(f.calls.filter(call => call.type === 'noteOff').length);
      qualification.push({ kind: 'policy', policy, transfers: transfers.map(({ actorId, previousLaneId, laneId, birthLaneId, eventId }) => ({ actorId, previousLaneId, laneId, birthLaneId, eventId })), activeOwnership: active.map(({ actorId, voiceId, laneId }) => ({ actorId, voiceId, laneId })), displayOrder: projection.laneIndices, noteOns: f.calls.filter(call => call.type === 'noteOn').length, noteOffs: f.calls.filter(call => call.type === 'noteOff').length, retirement: stopped.outcome, midiOwned: f.midi.diagnostics().ownedVoices });
    } finally { await f.dispose(); }
  }));
  for (const policy of policies) for (const cut of ['before', 'after']) it('resumes identical physical and causal ownership ' + cut + ' transfer under ' + policy, () => withFakeClockAndPerformance(async clock => {
    const f = await fixture(masks, clock, policy); let restored;
    try {
      if (cut === 'after') for (let at = 0; at < 3; at++) f.step();
      const checkpoint = captureProcgenCheckpoint(f.world), musical = f.playback.engine.snapshot(); restored = worldFor(masks); restoreProcgenCheckpoint(restored, structuredClone(checkpoint));
      const timeline = createProcgenPhysicalScoreClock(); timeline.restore(f.timeline.snapshot());
      const engine = createCausalMusicEngine({ getGraph: () => f.graph, scoreTimeline: timeline, world: restored, getPerformanceState: () => captureCausalPerformanceState(f.lanes) }); engine.restore(structuredClone(musical));
      const resumedBatches = [], resumedIntents = []; restored.soundEvents.onBatch.on(batch => { resumedBatches.push(batch); timeline.observe(batch, { bpm: 120 }); resumedIntents.push(...engine.processBatch(batch)); });
      const start = f.intents.length;
      for (let at = 0; at < 5; at++) { f.step(); restored.step(); }
      expect(resumedBatches).to.deep.equal(f.batches.slice(-5)); expect(resumedIntents).to.deep.equal(f.intents.slice(start));
      expect(engine.snapshot()).to.deep.equal(f.playback.engine.snapshot());
      const physics = await compareProcgenPhysicsCheckpoints(captureProcgenCheckpoint(f.world), captureProcgenCheckpoint(restored)); expect(physics.firstDifference).to.equal(null); expect(physics.matched).to.equal(true); qualification.push({ kind: 'checkpoint', policy, cut, tick: f.world.tickIndex, physics, identicalCompletedBatches: resumedBatches.length, identicalIntents: resumedIntents.length, identicalFullCausalSnapshot: true }); engine.dispose();
    } finally { restored?.dispose(); await f.dispose(); }
  }));
  for (const policy of policies) it('silences a muted destination without a rebound attack under ' + policy, () => withFakeClockAndPerformance(async clock => {
    const f = await fixture(masks, clock, policy, { muted: true });
    try {
      for (let at = 0; at < 7; at++) f.step();
      const transfer = f.batches.flatMap(batch => batch.facts).find(fact => fact.kind === 'ActorLaneTransferred' && fact.actorId === f.down.id);
      const derived = f.intents.filter(intent => intent.sourceEventIds.includes(transfer.eventId));
      expect(derived.map(intent => intent.kind)).to.deep.equal(['end']); expect(derived[0].terminationReason).to.equal('transfer-destination-unavailable');
      expect(derived[0]).not.to.have.property('voiceTransition');
      expect(f.playback.engine.snapshot().active.some(row => row.actorId === f.down.id)).to.equal(false);
      f.editLane(1, { mute: false }); const start = f.intents.length; for (let at = 0; at < 3; at++) f.step();
      expect(f.intents.slice(start).some(intent => intent.kind === 'begin' && intent.actorId === f.down.id)).to.equal(false);
    } finally { await f.dispose(); }
    expect(f.midi.diagnostics().ownedVoices).to.equal(0); qualification.push({ kind: 'muted-destination', policy, noReboundAttack: true, midiOwned: 0 });
  }));
  for (const policy of policies) it('retires disconnected endpoint voices through real transfer under ' + policy, () => withFakeClockAndPerformance(async clock => {
    const f = await fixture(masks, clock, policy, { disconnected: true });
    try { for (let at = 0; at < 7; at++) f.step(); expect(f.midi.diagnostics().ownedVoices).to.equal(0); if (policy !== 'silentHandoff') expect(f.receipts.some(receipt => receipt.status === 'rejected')).to.equal(true); }
    finally { await f.dispose(); }
    expect(f.ports.getOutputActivity().ownedNotes).to.equal(0); qualification.push({ kind: 'disconnected', policy, ownedNotes: 0, midiOwned: f.midi.diagnostics().ownedVoices });
  }));

  for (const patch of [{ mute: true }, { gain: 0 }, { solo: true }]) it('reconciles already held output for an immutable lane mix change ' + JSON.stringify(patch), () => withFakeClockAndPerformance(async clock => {
    const f = await fixture(masks, clock, 'carry');
    try {
      expect(f.midi.diagnostics().ownedVoices).to.equal(2);
      const target = patch.solo ? 0 : 1; f.editLane(target, patch);
      expect(f.midi.diagnostics().ownedVoices).to.equal(1);
      const notes = f.calls.filter(call => call.type === 'noteOn').length;
      f.editLane(target, patch.solo ? { solo: false } : { mute: false, gain: 1 }); clock.tick(60);
      expect(f.calls.filter(call => call.type === 'noteOn').length).to.equal(notes);
      qualification.push({ kind: 'live-mix-safety', patch, heldAfterChange: 1, reboundAttacks: 0 });
    } finally { await f.dispose(); }
    expect(f.midi.diagnostics().ownedVoices).to.equal(0);
  }));

});
