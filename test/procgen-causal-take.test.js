import { expect } from 'chai';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder, planCausalReinterpretation, querySoundOnlyRevoice, compareCausalRecords } from '../js/app/procgen/workstation/CausalTake.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

const graph = (sourceKind = 'MotionCommitted', extra = {}) => ({ version: 1, revision: 1, instruments: [
  { id: 'instrument', sourceKind, pitchCents: 6012.3456789, velocity01: 0.75, role: 'physical', route: 'local',
    ...(sourceKind === 'MotionCommitted' ? { gateX: 40 } : {}), ...extra }
] });
const metadata = (takeId, mapping = graph()) => ({ takeId, documentId: 'doc:physical',
  sourceVersions: { generator: 'procgen-workstation-1', project: 2 }, assetRefs: [], mapping,
  initialCheckpoint: { world: { tick: 0 } }, boundaryState: { voices: [], travel: { entries: [] }, contactSpans: [] } });
const physical = (tick, extra = {}) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: `world:1:${tick}:0`,
  sourceTimeMs: tick * 60, tickDurationMs: 20, completeness: { status: 'complete', dropped: 0 }, facts: [{ kind: 'MotionCommitted',
    actorId: 7, eventId: `cause:${tick}`, causalSequence: tick, actionInstanceId: '7:action:1', precision: 'endpoint',
    positionBefore: { x: tick - 1, y: 10 }, positionAfter: { x: tick, y: 10 }, physicalPayload: { pathEvidence: 'endpoint-chord' }, ...extra }] });
const setup = () => {
  const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage });
  return { ...store, journal };
};

describe('semantic causal take capture and reinterpretation', function() {
  this.timeout(15000);

  it('captures 1000 real world ticks with ordered interventions and output failures independently', async () => {
    const { journal } = setup(), masks = await loadProcgenMasks();
    const world = new ProcgenLaneWorld({ masks, seed: 42, assists: false }), mapping = graph();
    const engine = createCausalMusicEngine({ getGraph: () => mapping });
    const recorder = await createCausalTakeRecorder({ ...metadata('take:real', mapping), journal,
      initialCheckpoint: { world: captureProcgenCheckpoint(world), engine: engine.snapshot() } });
    const command = { id: 'gesture:1', kind: 'set-release-policy', origin: 'manual', target: { generation: 1 }, parameters: { spawnBeatTicks: 4 } };
    recorder.recordIntervention(command, world.enqueueIntervention(command), { tick: 0, generation: 1 });
    world.soundEvents.onBatch.on(batch => recorder.recordCommittedBatch({ batch, intents: engine.processBatch(batch),
      deliveryOutcomes: batch.tick === 20 ? [{ sinkId: 'midi', status: 'rejected', stage: 'none', reason: 'injected-drop' }] : [] }));
    try {
      for (let tick = 1; tick <= 1000; tick++) {
        world.step(tick % 4 ? 200 : 500);
        if (tick % 64 === 0) await recorder.flush();
      }
      const receipt = await recorder.stop({ boundaryState: { voices: engine.snapshot().active, plannedFutureEnds: [] } });
      expect(receipt.complete).to.equal(true);
      expect((await journal.verify('take:real')).status).to.equal('complete');
      const physicalRows = await journal.query({ takeId: 'take:real', kinds: ['physical-batch'], limit: 4096 });
      expect(physicalRows.records).to.have.length(1000);
      expect(physicalRows.records[0].payload.facts.some(fact => fact.kind === 'CommandApplied' && fact.commandId === 'gesture:1')).to.equal(true);
      const outcomes = await journal.query({ takeId: 'take:real', kinds: ['sink-outcome'] });
      expect(outcomes.records[0].payload.outcomes[0]).to.include({ status: 'rejected', reason: 'injected-drop' });
      expect((await journal.openTake('take:real')).coverage.status).to.equal('complete');
    } finally { world.dispose(); }
  });

  it('preserves immutable intent identities and source times across two sound-only patches', async () => {
    const { journal } = setup(), mapping = graph(), engine = createCausalMusicEngine({ getGraph: () => mapping });
    const recorder = await createCausalTakeRecorder({ ...metadata('take:revoice', mapping), journal });
    const batch = physical(40), intents = engine.processBatch(batch);
    recorder.recordCommittedBatch({ batch, intents }); await recorder.stop();
    const first = await querySoundOnlyRevoice({ journal, takeId: 'take:revoice', soundPatch: { id: 'bells' }, executionEpoch: 'playback:1' });
    const second = await querySoundOnlyRevoice({ journal, takeId: 'take:revoice', soundPatch: { id: 'strings' }, executionEpoch: 'playback:2' });
    expect(first.intents).to.deep.equal(intents); expect(second.intents).to.deep.equal(intents);
    expect(first.executionEpoch).not.to.equal(second.executionEpoch);
    expect(first.inspection.hardware).to.equal(false);
  });

  it('refuses new contact/path requirements not captured by the chosen graph profile', async () => {
    const { journal } = setup(), recorder = await createCausalTakeRecorder({ ...metadata('take:gate-only'), journal,
      captureProfile: { version: 1, id: 'gate-only', factKinds: ['MotionCommitted'], descriptorKinds: [], stateKinds: [] } });
    recorder.recordCommittedBatch({ batch: physical(1), intents: [] }); await recorder.stop();
    const manifest = await journal.openTake('take:gate-only');
    const contact = planCausalReinterpretation({ manifest, graph: graph('ContactSpanBegan') });
    expect(contact.supported).to.equal(false);
    expect(contact.requirements.find(item => item.kind === 'ContactSpanBegan')).to.include({ status: 'unavailable', reason: 'not-captured' });
    const path = planCausalReinterpretation({ manifest, graph: graph('MotionCommitted', { articulation: {
      spacingPixels: 4, metric: 'segment-path', lifetimeScope: 'actorJourney', orientation: 'signedX' } }) });
    expect(path.supported).to.equal(false);
    expect(path.requirements.find(item => item.kind === 'movement-path').status).to.equal('unavailable');
    expect(JSON.stringify(await journal.openTake('take:gate-only'))).to.equal(JSON.stringify(manifest));
  });

  it('records mid-held boundary inventory without inventing a new source attack or future release', async () => {
    const { journal } = setup(), masks = await loadProcgenMasks(), world = new ProcgenLaneWorld({ masks, assists: false });
    const mapping = graph('ActionEntered', { action: 'building' }), engine = createCausalMusicEngine({ getGraph: () => mapping });
    const actor = world.actors[0]; actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8;
    world.soundEvents.onBatch.on(batch => engine.processBatch(batch)); world.step();
    const boundary = { voices: engine.snapshot().active, ancestry: 'original-onset-reference-unavailable', travel: engine.snapshot().travel, contactSpans: [] };
    const recorder = await createCausalTakeRecorder({ ...metadata('take:held', mapping), journal, boundaryState: boundary,
      initialCheckpoint: { world: captureProcgenCheckpoint(world), engine: engine.snapshot() } });
    const onBatch = batch => recorder.recordCommittedBatch({ batch, intents: [] });
    world.soundEvents.onBatch.on(onBatch);
    try {
      world.step(); world.step(); await recorder.stop({ boundaryState: { voices: engine.snapshot().active, plannedFutureEnds: ['not-observed'] } });
      const manifest = await journal.openTake('take:held');
      expect(manifest.boundaryState.voices).to.have.length(1);
      expect(manifest.stopBoundaryState.voices).to.have.length(1);
      const captured = await journal.query({ takeId: 'take:held', kinds: ['musical-intents'] });
      expect(captured.records.flatMap(record => record.payload.intents)).to.have.length(0);
    } finally { world.soundEvents.onBatch.off(onBatch); world.dispose(); }
  });

  it('reports first divergent physical cause without discarding order or actor identity', () => {
    const left = [{ sequence: 1, kind: 'physical-batch', tick: 10, payload: { facts: [{ eventId: 'cause:a', actorId: 1 }, { eventId: 'cause:b', actorId: 2 }] } }];
    const right = structuredClone(left); right[0].payload.facts[1].actorId = 9;
    expect(compareCausalRecords(left, right)).to.deep.equal({ equal: false, firstDivergence: {
      sequence: 1, tick: 10, causeId: 'cause:b', expectedKind: 'physical-batch', actualKind: 'physical-batch' } });
    expect(compareCausalRecords(left, structuredClone(left))).to.deep.equal({ equal: true, comparedRecords: 1 });
  });

  it('persists an explicitly missed source boundary and cannot finalize that take as complete', async () => {
    const { journal } = setup(), recorder = await createCausalTakeRecorder({ ...metadata('take:missed-batch'), journal });
    recorder.recordCommittedBatch({ batch: physical(1), intents: [] });
    const gap = { kind: 'physical-facts', firstTick: 2, lastTick: 2, generation: 1, reason: 'batch-processing-failed' };
    expect(recorder.markGap(gap).status).to.equal('accepted');
    expect(recorder.status().coverage).to.deep.equal({ status: 'partial', gaps: [
      { kind: 'movement-path', firstTick: 1, lastTick: 1, generation: 1, reason: 'endpoint-only-evidence' }, gap
    ] });
    recorder.recordCommittedBatch({ batch: physical(3), intents: [] });
    expect((await recorder.stop()).complete).to.equal(false);
    const manifest = await journal.openTake('take:missed-batch');
    expect(manifest.coverage.status).to.equal('partial');
    const rows = await journal.query({ takeId: 'take:missed-batch', kinds: ['marker'] });
    expect(rows.records[0].payload).to.deep.equal({ type: 'coverage-gap', gap });
    expect(() => recorder.markGap({ ...gap, firstTick: -1 })).not.to.throw();
    const active = await createCausalTakeRecorder({ ...metadata('take:invalid-gap'), journal });
    expect(() => active.markGap({ ...gap, firstTick: -1 })).to.throw('coverage gap'); await active.stop();
  });

  it('closes admission synchronously and durably binds the actual final component checkpoint before stop', async () => {
    const { journal } = setup(), recorder = await createCausalTakeRecorder({ ...metadata('take:final-components'), journal });
    recorder.recordCommittedBatch({ batch: physical(1), intents: [] });
    const finalCheckpoint = { world: { tick: 1 }, engine: { version: 1, active: [] }, timeline: null, replay: { version: 1, bpm: 120, scoreTimeline: true } };
    const pending = recorder.stop({ finalCheckpoint });
    expect(recorder.recordCommittedBatch({ batch: physical(2), intents: [] })).to.include({ status: 'rejected', reason: 'take-stopped' });
    expect((await pending).complete).to.equal(true);
    const manifest = await journal.openTake('take:final-components');
    expect(manifest.checkpoints.at(-1).sequence).to.equal(manifest.durableSequence);
    expect(await journal.readCheckpoint(manifest.checkpoints.at(-1))).to.deep.equal(finalCheckpoint);
    expect((await journal.query({ takeId: manifest.takeId, kinds: ['physical-batch'] })).records).to.have.length(1);
  });

  it('reports a failed final component checkpoint as partial while preserving the durable source prefix', async () => {
    const { journal, control } = setup(), recorder = await createCausalTakeRecorder({ ...metadata('take:failed-final'), journal });
    recorder.recordCommittedBatch({ batch: physical(1), intents: [] }); await recorder.flush();
    control.failNext = true;
    const receipt = await recorder.stop({ finalCheckpoint: { world: { tick: 1 } } });
    expect(receipt).to.include({ complete: false, durableSequence: 2 });
    const manifest = await journal.openTake('take:failed-final');
    expect(manifest.coverage.gaps.some(gap => gap.reason === 'final-component-checkpoint-failed')).to.equal(true);
    expect((await journal.verify(manifest.takeId)).verifiedThroughSequence).to.equal(2);
  });
});
