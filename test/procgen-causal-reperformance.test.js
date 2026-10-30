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
import { createResourceBudget, ResourceBudgetError } from '../js/app/resources/ResourceBudget.js';
import { captureCausalPerformanceState, createCausalPerformanceState, diffCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';

const sourceVersions = { generator: 'procgen-workstation-2', worldCheckpoint: 2, physicalBatch: 1, physicalMusic: 1, numericCanonicalization: 'finite-f64-minus-zero-v1' };
const mapping = { version: 1, revision: 1, instruments: [
  { id: 'brick', sourceKind: 'TerrainWorkCommitted', pitchCents: 6000, velocity01: 1, role: 'builder', route: 'local' },
  { id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6200, velocity01: 0.5, role: 'travel', route: 'local' }
] };

describe('isolated causal re-performance and checkpoint provenance', function() {
  this.timeout(60000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = () => new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42, assists: false });
  const record = async ({ ticks = 40, unknownInput = false, forgedCheckpoint = false, forgedAuthoring = false, final = true, playbackAdmission = false, performanceInputs = false, transportClock = false, invalidTransportClock = false } = {}) => {
    playbackAdmission ||= transportClock;
    const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage }), world = make();
    let bpm = 120, playing = !playbackAdmission; const versions = { ...sourceVersions, ...(playbackAdmission ? { physicalPlaybackAdmission: 1 } : {}) };
    const performance = performanceInputs ? createCausalPerformanceState(captureCausalPerformanceState([{ id: 'lane-a', instrumentControls: { macros: { hardness: 0.2 } } }, { id: 'lane-b' }])) : null;
    const clock = createProcgenPhysicalScoreClock(), engine = createCausalMusicEngine({ getGraph: () => mapping, scoreTimeline: clock, traceLimit: 0,
      getPerformanceState: () => performance?.snapshot() || null, getOnsetControls: source => performance?.getControls(source) });
    const actor = world.actors[1]; actor.y = world.surfaceAt(1, actor.x); actor.setAction(world.actions[State.WALKING]);
    world.actors[0].y = world.laneHeight - 1; world.actors[0].setAction(world.actions[State.FALLING]);
    const snapshot = () => ({ world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: clock.snapshot(), replay: { version: playbackAdmission ? 2 : 1, bpm, scoreTimeline: true, ...(playbackAdmission ? { playing } : {}) } });
    const initialCheckpoint = snapshot(), assetRefs = initialCheckpoint.world.assets;
    const recorder = await createCausalTakeRecorder({ journal, takeId: 'take:reperform', documentId: 'doc:reperform', mapping,
      sourceVersions: versions, assetRefs, initialCheckpoint, boundaryState: { voices: [], timeline: null } });
    const command = { id: 'builder:recorded', kind: 'assign-worker', origin: 'manual', target: { generation: world.generation, actorId: actor.id }, parameters: { workerKind: 'builders' } };
    recorder.recordIntervention(command, world.enqueueIntervention(command), { tick: 0, generation: 1 });
    world.soundEvents.onBatch.on(batch => { clock.observe(batch, { bpm }); recorder.recordCommittedBatch({ batch, intents: playing ? engine.processBatch(batch) : [] }); });
    for (let tick = 1; tick <= ticks; tick++) {
      world.step(tick % 3 ? 1000 : 9000);
      const boundary = { tick: world.tickIndex, generation: world.generation };
      if (tick === 10) { bpm = 90; recorder.recordTimeline({ version: 1, kind: 'tempo', bpm }, boundary); }
      if (tick === 12) { world.timer.speedFactor = 6; recorder.recordInput({ version: 1, kind: 'world-speed', speedFactor: 6 }, boundary); }
      if (tick === 15 && performance) {
        const next = captureCausalPerformanceState([{ id: 'lane-a', instrumentControls: { macros: { hardness: 0.8 }, variationSeed: 19 } }, { id: 'lane-b' }]);
        const change = diffCausalPerformanceState(performance.snapshot(), next); expect(recorder.recordPerformance(change, boundary).status).to.equal('accepted'); performance.apply(change);
      }
      if (tick === 13) {
        if (transportClock) {
          playing = false; world.timer.speedFactor = 0; recorder.recordInput({ version: 2, kind: 'transport-state', playing: false, speedFactor: 0 }, boundary);
          playing = true; world.timer.speedFactor = 6; recorder.recordInput({ version: 2, kind: 'transport-state', playing: true, speedFactor: 6 }, boundary);
        } else { recorder.recordInput({ version: 1, kind: 'transport-state', playing: false }, boundary); recorder.recordInput({ version: 1, kind: 'transport-state', playing: true }, boundary); if (playbackAdmission) playing = true; }
      }
      if (tick === 14) recorder.recordInput(unknownInput ? { version: 1, kind: 'live-device-unknown', bytes: [0x90, 60, 1] }
        : { version: 1, kind: 'external-observation', sourceId: 'recorded-midi-port', effect: 'observation-only', timestamp: 1234.567, bytes: [0x90, 60, 1] }, boundary);
      if (tick === 20 || tick % 2500 === 0) {
        const value = snapshot();
        if (forgedCheckpoint && tick === 20) value.world.graph.owners.find(owner => owner.name === 'world').props.frontierRevision += 1;
        if (forgedAuthoring && tick === 20) { const authoring = value.world.graph.owners.find(owner => owner.name === 'world').props.physicalAuthoring; value.world.graph.nodes[authoring.ref].props.revision++; }
        await recorder.checkpoint({ value, ...boundary });
      }
      if (tick % 128 === 0) await recorder.flush();
    }
    if (transportClock) { playing = false; world.timer.speedFactor = 0; recorder.recordInput({ version: 2, kind: 'transport-state', playing: false, speedFactor: invalidTransportClock ? -1 : 0 }, { tick: world.tickIndex, generation: world.generation }); }
    const finalCheckpoint = snapshot(), finalHash = await hashProcgenPhysicsCheckpoint(finalCheckpoint.world);
    const stopped = await recorder.stop({ ...(final ? { finalCheckpoint } : {}), boundaryState: { voices: engine.snapshot().active, timeline: clock.snapshot() } });
    const source = await journal.openTake('take:reperform');
    world.dispose();
    return { ...store, journal, source, stopped, finalHash, runtime: options => createCausalReperformance({ journal, createWorld: make, sourceVersions: versions, assetRefs, ...options }) };
  };

  it('rejects a hash-valid authoring-only component mismatch that the simulation display projection omits', async () => {
    const { runtime, source } = await record({ forgedAuthoring: true }), service = runtime();
    try {
      const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'forged-authoring' });
      expect(result.receipt).to.include({ version: 2, compatibilityMatch: false, continuationStateSchema: 1 });
      expect(result.receipt.firstDivergence.kind).to.equal('component-checkpoint');
      expect(result.receipt.firstDivergence.detail.continuationMatch).to.equal(false);
      expect(result.receipt.firstDivergence.detail.firstStateDifference.path).to.include('revision');
    } finally { await service.dispose().completion; }
  });

  it('retires each query page before admitting a component checkpoint at its exact boundary', async () => {
    const { journal, source, finalHash, runtime } = await record(); let pages = 0; const checkpoints = new Set();
    const ownedJournal = { ...journal,
      async queryOwned(options) {
        const value = await journal.query(options); pages++; let released = false;
        return { get value() { if (released) throw new Error('Page retired'); return value; }, release() { if (released) return false; released = true; pages--; return true; } };
      },
      async readCheckpointOwned(ref) {
        expect(pages, 'checkpoint decoding cannot overlap retained query output').to.equal(0); checkpoints.add(ref.sequence);
        const value = await journal.readCheckpoint(ref); return { value, release: () => true };
      } };
    const service = runtime({ journal: ownedJournal }), result = await service.reperform({ takeId: source.takeId, executionEpoch: 'page-before-checkpoint', pageRecords: 1024 });
    expect(result.receipt, JSON.stringify(result.receipt)).to.include({ compatibilityMatch: true, actualPhysicsHash: finalHash, finalWorldParity: 'matched-at-captured-component-checkpoint' });
    expect([...checkpoints].sort((a, b) => a - b)).to.deep.equal(source.checkpoints.map(value => value.sequence));
    expect(result.receipt.checkpointComparisons).to.have.length(2); expect(pages).to.equal(0);
    await service.dispose().completion;
  });

  it('re-performs captured macro/seed edits and performance checkpoints at their actual physical boundaries', async () => {
    const { runtime, source } = await record({ performanceInputs: true }), service = runtime();
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'performance-inputs' });
    expect(result.receipt, JSON.stringify(result.receipt)).to.include({ compatibilityMatch: true, status: 'matched-current-runtime', exactQualified: false });
    await service.dispose().completion;
  });

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
  it('replays accepted pause/resume clock observations and a final paused checkpoint without changing legacy input semantics', async () => {
    const { runtime, source, finalHash } = await record({ transportClock: true }), service = runtime();
    try {
      const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'transport-clock:paused-final' });
      expect(result.receipt, JSON.stringify(result.receipt)).to.include({ compatibilityMatch: true, finalWorldParity: 'matched-at-captured-component-checkpoint', actualPhysicsHash: finalHash });
      expect(result.receipt.comparedIntents).to.be.greaterThan(0);
    } finally { await service.dispose().completion; }
  });
  it('refuses a correctly hashed transport observation whose physical clock is invalid', async () => {
    const { runtime, source } = await record({ transportClock: true, invalidTransportClock: true }), service = runtime();
    try {
      const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'transport-clock:invalid' });
      expect(result.receipt.status).to.equal('unsupported-or-incomplete'); expect(result.receipt.failure.code).to.equal('unsupported-recorded-input');
    } finally { await service.dispose().completion; }
  });
  it('bounds and accounts for qualified checkpoint reuse, and releases it with the replay owner', async () => {
    const { runtime, source } = await record(), budget = createResourceBudget(), service = runtime({ resourceBudget: budget, maxQualifiedCheckpoints: 1 });
    try {
      const first = await service.reperform({ takeId: source.takeId, executionEpoch: 'cache:first' }); expect(first.receipt.compatibilityMatch).to.equal(true);
      const cache = service.cacheState(); expect(cache.entries).to.equal(1); expect(cache.estimatedBytes).to.be.at.most(cache.maximumBytes);
      expect(cache.reservation.state).to.equal('reserved'); expect(budget.diagnostics().accountedBytes).to.equal(cache.reservation.declaredBytes);
      const second = await service.reperform({ takeId: source.takeId, executionEpoch: 'cache:again' }); expect(second.receipt.ticksExecuted).to.equal(0); expect(second.receipt.actualPhysicsHash).to.equal(first.receipt.actualPhysicsHash);
    } finally { await service.dispose().completion; }
    expect(budget.diagnostics().accountedBytes).to.equal(0); expect(service.cacheState().reservation.state).to.equal('released');
  });
  it('continues full replay when cache admission or its byte bound refuses an optimization', async () => {
    const { runtime, source } = await record();
    for (const small of [false, true]) {
      const budget = createResourceBudget(), adapter = { reserve(value) { if (!small && value.kind === 'qualified-replay-checkpoints') throw new ResourceBudgetError('checkpoint', value.bytes, 0); return budget.reserve(value); }, release: value => budget.release(value) };
      const service = runtime({ resourceBudget: adapter, ...(small ? { maxQualifiedCheckpointBytes: 4096 } : {}) });
      try {
        for (let run = 0; run < 2; run++) { const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'cache-refused:' + run }); expect(result.receipt.compatibilityMatch).to.equal(true); expect(result.receipt.ticksExecuted).to.equal(40); }
        expect(service.cacheState().entries).to.equal(0); expect(service.cacheState().refusals).to.be.greaterThan(0); expect(service.cacheState().reservation).to.equal(null);
      } finally { await service.dispose().completion; }
      expect(budget.diagnostics().accountedBytes).to.equal(0);
    }
  });
  it('keeps a failed cache release charged after replay retirement', async () => {
    const { runtime, source } = await record(), budget = createResourceBudget();
    const service = runtime({ resourceBudget: { reserve: value => budget.reserve(value), release: value => value.owner === 'causal-reperformance-checkpoint-cache' ? false : budget.release(value) } });
    await service.reperform({ takeId: source.takeId, executionEpoch: 'cache:unknown-release' });
    const receipt = service.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    expect(service.cacheState().reservation.state).to.equal('failed-or-unknown');
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

  it('reports the first changed physical cause and refuses a retained branch inside an unmatched intent boundary', async () => {
    const { runtime, source, journal } = await record();
    const altered = runtime({ createWorld: () => {
      const world = make(), fall = world.actions[State.FALLING], process = fall.process.bind(fall);
      fall.process = (...args) => { const result = process(...args); args[1].x += 1; return result; }; return world;
    } });
    const result = await altered.reperform({ takeId: source.takeId, executionEpoch: 'altered:action' });
    expect(result.receipt, JSON.stringify(result.receipt)).to.include({ status: 'mismatch', compatibilityMatch: false });
    expect(result.receipt.firstDivergence).to.include({ kind: 'physical-batch', tick: 1 });
    expect(result.receipt.firstDivergence.causeId).to.be.a('string');
    const row = (await journal.query({ takeId: source.takeId, kinds: ['physical-batch'], limit: 1 })).records[0];
    const ordinary = runtime(), branch = await ordinary.reperform({ takeId: source.takeId, throughSequence: row.sequence,
      executionEpoch: 'partial:boundary', retainWorld: true });
    expect(branch.session).to.equal(null); expect(branch.receipt.failure.code).to.equal('incomplete-branch-boundary'); altered.dispose(); ordinary.dispose();
  });

  it('reserves shared checkpoint workspace before allocation and retains it only through the owned replay session', async () => {
    const { runtime, source } = await record();
    const deniedBudget = createResourceBudget({ limitBytes: 4096 }); let allocations = 0;
    const denied = runtime({ resourceBudget: deniedBudget, createWorld: () => { allocations++; return make(); } });
    let error; try { await denied.reperform({ takeId: source.takeId, executionEpoch: 'resource:denied' }); } catch (failure) { error = failure; }
    expect(error.name).to.equal('ResourceBudgetError'); expect(allocations).to.equal(0); expect(deniedBudget.diagnostics().accountedBytes).to.equal(0);
    const admittedBudget = createResourceBudget({ limitBytes: 256 * 1048576 }), admitted = runtime({ resourceBudget: admittedBudget });
    const result = await admitted.reperform({ takeId: source.takeId, executionEpoch: 'resource:owned', retainWorld: true });
    expect(result.receipt.compatibilityMatch).to.equal(true); expect(admittedBudget.diagnostics().accountedBytes).to.be.greaterThan(0);
    await admitted.dispose().completion; expect(admittedBudget.diagnostics().accountedBytes).to.equal(0);
    expect(() => result.session.snapshot()).to.throw('released'); denied.dispose();
  });
  it('replays paused single-stepping and the recorded resumption of musical interpretation', async () => {
    const { runtime, source, journal } = await record({ ticks: 40, playbackAdmission: true }), service = runtime();
    const initial = await journal.readCheckpoint(source.initialCheckpoint); expect(initial.replay).to.include({ version: 2, playing: false });
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'playback-admission' });
    expect(result.receipt, JSON.stringify(result.receipt)).to.include({ compatibilityMatch: true, finalWorldParity: 'matched-at-captured-component-checkpoint' });
    expect(result.receipt.checkpointComparisons.every(checkpoint => checkpoint.replaySettingsMatch)).to.equal(true); await service.dispose().completion;
  });

  it('keeps replay workspace until an accepted asynchronous world disposer actually settles', async () => {
    const { runtime, source, journal } = await record({ ticks: 4 }), budget = createResourceBudget(); let acknowledge, disposed = 0, sources = 0;
    const ownedJournal = { ...journal, async readCheckpointOwned(ref) {
      const value = await journal.readCheckpoint(ref); sources++; let released = false;
      return { get value() { if (released) throw new Error('checkpoint retired'); return value; }, release() { if (released) return false; released = true; sources--; return true; } };
    } };
    const gate = new Promise(resolve => { acknowledge = resolve; });
    const service = runtime({ journal: ownedJournal, resourceBudget: budget, createWorld: () => { const world = make(); return { world, dispose() { disposed++; world.dispose(); return gate; } }; } });
    const result = await service.reperform({ takeId: source.takeId, executionEpoch: 'async-disposal', retainWorld: true });
    expect(result.receipt.compatibilityMatch).to.equal(true); const receipt = result.session.dispose();
    expect(disposed).to.equal(1); expect(sources).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect(receipt.state).to.equal('retiring');
    expect(() => result.session.replayState()).to.throw('retired');
    acknowledge(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(sources).to.equal(0); expect(service.cacheState().entries).to.be.greaterThan(0);
    expect(budget.diagnostics().accountedBytes).to.equal(service.cacheState().reservation.declaredBytes);
    await service.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('retires a checkpoint lease that arrives after cancellation before accepting any world', async () => {
    const { runtime, source, journal } = await record({ ticks: 4 }), budget = createResourceBudget(); let provide, entered, reads = 0, worlds = 0, sources = 0;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { provide = resolve; });
    const ownedJournal = { ...journal, async readCheckpointOwned(ref) {
      if (++reads === 2) { entered(); await gate; }
      const value = await journal.readCheckpoint(ref); sources++; let released = false;
      return { value, release() { if (released) return false; released = true; sources--; return true; } };
    } };
    const service = runtime({ journal: ownedJournal, resourceBudget: budget, createWorld: () => { worlds++; return make(); } });
    const running = service.reperform({ takeId: source.takeId, executionEpoch: 'late-checkpoint' }).catch(error => error);
    await started; const stopped = service.dispose(); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    provide(); expect((await running).code).to.equal('cancelled'); await stopped.completion;
    expect(worlds).to.equal(0); expect(sources).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('retains source/workspace accounting after a refused checkpoint release without retrying it', async () => {
    const { runtime, source, journal } = await record({ ticks: 4 }), budget = createResourceBudget(); let reads = 0, attempts = 0;
    const ownedJournal = { ...journal, async readCheckpointOwned(ref) {
      const retained = ++reads === 2, value = await journal.readCheckpoint(ref);
      return { value, release() { if (retained) { attempts++; throw new Error('checkpoint retirement refused'); } return true; } };
    } };
    const service = runtime({ journal: ownedJournal, resourceBudget: budget }), result = await service.reperform({ takeId: source.takeId, executionEpoch: 'refused-checkpoint', retainWorld: true });
    expect(result.receipt.compatibilityMatch).to.equal(true); const closed = result.session.dispose(); await closed.completion;
    expect(closed.outcome).to.equal('partial'); expect(attempts).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    const retired = service.dispose(); await retired.completion; expect(retired.outcome).to.equal('partial'); expect(attempts).to.equal(1);
  });

  it('retires a world that arrives after its replay owner was disposed without releasing the source early', async () => {
    const { runtime, source } = await record({ ticks: 4 }), budget = createResourceBudget(); let provide, entered, disposed = 0;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { provide = resolve; });
    const service = runtime({ resourceBudget: budget, createWorld: () => { entered(); return gate; } });
    const running = service.reperform({ takeId: source.takeId, executionEpoch: 'late-world' }).catch(error => error);
    await started; const retirement = service.dispose(); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    const world = make(); provide({ world, dispose() { disposed++; world.dispose(); } });
    expect((await running).code).to.equal('cancelled'); await retirement.completion;
    expect(disposed).to.equal(1); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('re-performs a mid-held capture without inventing an onset at Record or a release at Stop', async () => {
    const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage }), world = make();
    const heldGraph = { version: 1, revision: 1, instruments: [
      { id: 'held-builder', sourceKind: 'ActionEntered', action: 'building', pitchCents: 6100, velocity01: 0.7, role: 'body', route: 'local' }
    ] };
    const actor = world.actors[1]; actor.y = world.surfaceAt(1, actor.x); actor.setAction(world.actions[State.WALKING]);
    const clock = createProcgenPhysicalScoreClock(), engine = createCausalMusicEngine({ getGraph: () => heldGraph, scoreTimeline: clock });
    let recorder = null;
    world.soundEvents.onBatch.on(batch => { clock.observe(batch, { bpm: 120 }); const intents = engine.processBatch(batch);
      recorder?.recordCommittedBatch({ batch, intents }); });
    world.enqueueIntervention({ id: 'held:builder', kind: 'assign-worker', origin: 'manual', target: { generation: 1, actorId: actor.id }, parameters: { workerKind: 'builders' } });
    for (let tick = 0; tick < 3; tick++) world.step();
    expect(engine.snapshot().active).to.have.length(1);
    const snapshot = () => ({ world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: clock.snapshot(), replay: { version: 1, bpm: 120, scoreTimeline: true } });
    const initialCheckpoint = snapshot();
    recorder = await createCausalTakeRecorder({ journal, takeId: 'take:mid-held', documentId: 'doc:held', sourceVersions,
      assetRefs: initialCheckpoint.world.assets, mapping: heldGraph, initialCheckpoint, boundaryState: { voices: engine.snapshot().active, timeline: clock.snapshot() } });
    for (let tick = 0; tick < 5; tick++) world.step();
    await recorder.stop({ finalCheckpoint: snapshot(), boundaryState: { voices: engine.snapshot().active, plannedFutureEnds: [] } });
    const service = createCausalReperformance({ journal, createWorld: make, sourceVersions, assetRefs: initialCheckpoint.world.assets });
    try {
      const result = await service.reperform({ takeId: 'take:mid-held', executionEpoch: 'mid-held:replay', retainWorld: true });
      expect(result.receipt, JSON.stringify(result.receipt)).to.include({ compatibilityMatch: true, comparedIntents: 0 });
      expect(result.session.snapshot().engine.active).to.have.length(1);
      expect(result.session.snapshot().engine.active[0].voiceId).to.equal(initialCheckpoint.engine.active[0].voiceId);
      const captured = await journal.query({ takeId: 'take:mid-held', kinds: ['musical-intents'] });
      expect(captured.records.flatMap(record => record.payload.intents)).to.have.length(0); result.session.dispose();
    } finally { service.dispose(); world.dispose(); }
  });

  it('hashes logical terrain edits identically across lookup warming and cold/resident representation', async () => {
    const world = make();
    try {
      const patch = new Uint8Array(world.editChunks.chunkLength); patch.fill(2, 3, 9); patch[40] = 1;
      world.editChunks.set(0, patch);
      const resident = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
      world.editChunks.get(99999);
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world))).to.equal(resident);
      world.editChunks._pack(0);
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world))).to.equal(resident);
      world.editChunks.get(0)[40] = 2;
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world))).not.to.equal(resident);
    } finally { world.dispose(); }
  });
});
