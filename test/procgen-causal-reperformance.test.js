import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from '../js/app/procgen/workstation/CausalTake.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createCausalReperformance } from '../js/app/procgen/workstation/CausalReperformance.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { inspectProcgenCheckpoint, hashProcgenPhysicsCheckpoint, migrateProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';

const sourceVersions = { generator: 'procgen-workstation-1', worldCheckpoint: 2, physicalBatch: 1, physicalMusic: 1, numericCanonicalization: 'finite-f64-minus-zero-v1' };
const mapping = { version: 1, revision: 1, instruments: [
  { id: 'brick', sourceKind: 'TerrainWorkCommitted', pitchCents: 6000, velocity01: 1, role: 'builder', route: 'local' },
  { id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6200, velocity01: 0.5, role: 'travel', route: 'local' }
] };

describe('isolated causal re-performance and checkpoint provenance', function() {
  this.timeout(60000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = () => new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42, assists: false });
  const record = async ({ ticks = 40, unknownInput = false, forgedCheckpoint = false, final = true } = {}) => {
    const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage }), world = make();
    let bpm = 120;
    const clock = createProcgenPhysicalScoreClock(), engine = createCausalMusicEngine({ getGraph: () => mapping, scoreTimeline: clock, traceLimit: 0 });
    const actor = world.actors[1]; actor.y = world.surfaceAt(1, actor.x); actor.setAction(world.actions[State.WALKING]);
    world.actors[0].y = world.laneHeight - 1; world.actors[0].setAction(world.actions[State.FALLING]);
    const snapshot = () => ({ world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: clock.snapshot(), replay: { version: 1, bpm, scoreTimeline: true } });
    const initialCheckpoint = snapshot(), assetRefs = initialCheckpoint.world.assets;
    const recorder = await createCausalTakeRecorder({ journal, takeId: 'take:reperform', documentId: 'doc:reperform', mapping,
      sourceVersions, assetRefs, initialCheckpoint, boundaryState: { voices: [], timeline: null } });
    const command = { id: 'builder:recorded', kind: 'assign-worker', origin: 'manual', target: { generation: world.generation, actorId: actor.id }, parameters: { workerKind: 'builders' } };
    recorder.recordIntervention(command, world.enqueueIntervention(command), { tick: 0, generation: 1 });
    world.soundEvents.onBatch.on(batch => { clock.observe(batch, { bpm }); recorder.recordCommittedBatch({ batch, intents: engine.processBatch(batch) }); });
    for (let tick = 1; tick <= ticks; tick++) {
      world.step(tick % 3 ? 1000 : 9000);
      const boundary = { tick: world.tickIndex, generation: world.generation };
      if (tick === 10) { bpm = 90; recorder.recordTimeline({ version: 1, kind: 'tempo', bpm }, boundary); }
      if (tick === 12) { world.timer.speedFactor = 6; recorder.recordInput({ version: 1, kind: 'world-speed', speedFactor: 6 }, boundary); }
      if (tick === 13) { recorder.recordInput({ version: 1, kind: 'transport-state', playing: false }, boundary); recorder.recordInput({ version: 1, kind: 'transport-state', playing: true }, boundary); }
      if (tick === 14) recorder.recordInput(unknownInput ? { version: 1, kind: 'live-device-unknown', bytes: [0x90, 60, 1] }
        : { version: 1, kind: 'external-observation', sourceId: 'recorded-midi-port', effect: 'observation-only', timestamp: 1234.567, bytes: [0x90, 60, 1] }, boundary);
      if (tick === 20 || tick % 2500 === 0) {
        const value = snapshot();
        if (forgedCheckpoint && tick === 20) value.world.graph.owners.find(owner => owner.name === 'world').props.frontierRevision += 1;
        await recorder.checkpoint({ value, ...boundary });
      }
      if (tick % 128 === 0) await recorder.flush();
    }
    const finalCheckpoint = snapshot(), finalHash = await hashProcgenPhysicsCheckpoint(finalCheckpoint.world);
    const stopped = await recorder.stop({ ...(final ? { finalCheckpoint } : {}), boundaryState: { voices: engine.snapshot().active, timeline: clock.snapshot() } });
    const source = await journal.openTake('take:reperform');
    world.dispose();
    return { ...store, journal, source, stopped, finalHash, runtime: options => createCausalReperformance({ journal, createWorld: make, sourceVersions, assetRefs, ...options }) };
  };

  it('re-performs 10000 ticks, transfers, terrain work, tempo/speed and external inputs with exact retained state/fact/intent parity', async () => {
    const { runtime, source, finalHash, journal } = await record({ ticks: 10000 });
    const service = runtime(), first = await service.reperform({ takeId: source.takeId, executionEpoch: 'reperformance:first' });
    expect(first.receipt, JSON.stringify(first.receipt)).to.include({ compatibilityMatch: true, status: 'matched-current-runtime', exactQualified: false,
      comparedBatches: 10000, ticksExecuted: 10000, finalWorldParity: 'matched-at-captured-component-checkpoint' });
    expect(first.receipt.actualPhysicsHash).to.equal(finalHash);
    expect(first.receipt.comparedIntents).to.be.greaterThan(0);
    expect(first.receipt.executionIdentity.status).to.equal('unbound');
    expect(service.qualifiedCheckpoints().length).to.be.greaterThan(1);
    const replay = await service.reperform({ takeId: source.takeId, executionEpoch: 'reperformance:seek', retainWorld: true });
    expect(replay.receipt.compatibilityMatch).to.equal(true); expect(replay.receipt.ticksExecuted).to.equal(0);
    expect(replay.session.snapshot().world.physicalIdentity).to.deep.equal((await journal.readCheckpoint(source.checkpoints.at(-1))).world.physicalIdentity);
    replay.session.dispose(); service.dispose();
  });

  it('refuses exact active-runtime claims before world allocation even with matching source metadata', async () => {
    const { runtime, source } = await record();
    let allocations = 0;
    const service = runtime({ createWorld: () => { allocations++; return make(); } });
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'exact:refused', mode: 'exact' });
    expect(result.receipt.status).to.equal('unsupported'); expect(result.receipt.reasons).to.include('active-execution-unbound');
    expect(allocations).to.equal(0); service.dispose();
  });

  it('checks source/assets before allocation and reports unsupported external effects without querying a live device', async () => {
    const { runtime, source } = await record({ unknownInput: true });
    let allocations = 0;
    const wrong = runtime({ sourceVersions: { ...sourceVersions, generator: 'changed' }, createWorld: () => { allocations++; return make(); } });
    expect((await wrong.preflight({ takeId: source.takeId })).reasons).to.include('source-version-mismatch'); expect(allocations).to.equal(0);
    const service = runtime(), result = await service.reperform({ takeId: source.takeId, executionEpoch: 'unknown:input' });
    expect(result.receipt).to.include({ status: 'unsupported-or-incomplete', compatibilityMatch: false });
    expect(result.receipt.failure.code).to.equal('unsupported-recorded-input'); wrong.dispose(); service.dispose();
  });

  it('detects a forged component checkpoint and never promotes it to a trusted seek boundary', async () => {
    const { runtime, source } = await record({ forgedCheckpoint: true });
    const service = runtime(), result = await service.reperform({ takeId: source.takeId, executionEpoch: 'checkpoint:mismatch' });
    expect(result.receipt, JSON.stringify(result.receipt)).to.include({ status: 'mismatch', compatibilityMatch: false });
    expect(result.receipt.firstDivergence.kind).to.equal('component-checkpoint');
    expect(result.receipt.firstDivergence.tick).to.equal(20); expect(service.qualifiedCheckpoints()).to.have.length(0); service.dispose();
  });

  it('keeps the original lineage immutable while a qualified boundary supplies a separately owned branch world', async () => {
    const { runtime, source, journal } = await record();
    const service = runtime(), before = JSON.stringify(await journal.openTake(source.takeId));
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'branch:1', retainWorld: true });
    expect(result.receipt.compatibilityMatch).to.equal(true);
    const writer = await journal.branch({ parentTakeId: source.takeId, throughSequence: source.durableSequence, takeId: 'take:physical-branch' });
    const snapshot = result.session.snapshot();
    await writer.checkpoint({ value: snapshot, tick: result.session.world.tickIndex, generation: result.session.world.generation });
    const command = { id: 'branch:release-policy', kind: 'set-release-policy', origin: 'manual', target: { generation: snapshot.world.graph.owners.find(owner => owner.name === 'world').props.generation }, parameters: { spawnBeatTicks: 8 } };
    writer.append({ kind: 'intervention', tick: result.session.world.tickIndex, generation: result.session.world.generation,
      payload: { command, outcome: result.session.world.enqueueIntervention(command) } });
    await writer.stop();
    expect(JSON.stringify(await journal.openTake(source.takeId))).to.equal(before);
    expect((await journal.verify('take:physical-branch')).status).to.equal('complete');
    result.session.dispose(); service.dispose();
  });

  it('labels missing final-state evidence unknown and disposes isolated resources on cancellation', async () => {
    const { runtime, source } = await record({ final: false });
    const service = runtime();
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'no:final' });
    expect(result.receipt.compatibilityMatch).to.equal(true);
    expect(result.receipt.finalWorldParity).to.equal('unknown-no-validated-final-component-checkpoint');
    const controller = new AbortController(); let disposed = 0;
    const cancelable = runtime({ yieldEveryTicks: 1, createWorld: () => ({ world: make(), dispose() { disposed++; this.world.dispose(); } }),
      yieldControl: () => { controller.abort(); return Promise.resolve(); } });
    let error; try { await cancelable.reperform({ takeId: source.takeId, executionEpoch: 'canceled', signal: controller.signal }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('cancelled'); expect(disposed).to.equal(1); cancelable.dispose(); service.dispose();
  });

  it('separates presentation and wall time from ordered authoritative physics state and preserves migration originals', async () => {
    const world = make();
    try {
      const original = captureProcgenCheckpoint(world), changed = structuredClone(original);
      changed.scenery = { reducedMotion: true, revealProgress: 8 };
      changed.clock.eventTimeMs = 99999; changed.graph.owners.find(owner => owner.name === 'world').props.eventTimeMs = 99999;
      expect(await hashProcgenPhysicsCheckpoint(changed)).to.equal(await hashProcgenPhysicsCheckpoint(original));
      const props = changed.graph.owners.find(owner => owner.name === 'world').props;
      changed.graph.nodes[props.actors.ref].values.reverse();
      expect(await hashProcgenPhysicsCheckpoint(changed)).not.to.equal(await hashProcgenPhysicsCheckpoint(original));
      const legacy = structuredClone(original); legacy.version = 1; delete legacy.schema; delete legacy.componentCodecs; delete legacy.numericEncoding;
      const before = structuredClone(legacy), migrated = migrateProcgenCheckpoint(legacy);
      expect(legacy).to.deep.equal(before); expect(migrated.checkpoint.version).to.equal(2);
      expect(inspectProcgenCheckpoint(migrated.checkpoint).exactQualified).to.equal(false);
      const node = legacy.graph.nodes.find(entry => entry.type === 'Float64Array'); node.values[0] = null;
      expect(() => migrateProcgenCheckpoint(legacy)).to.throw('lost a floating sentinel');
    } finally { world.dispose(); }
  });
});
