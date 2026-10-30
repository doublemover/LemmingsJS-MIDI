import { expect } from 'chai';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from '../js/app/procgen/workstation/CausalTake.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createCausalReperformance } from '../js/app/procgen/workstation/CausalReperformance.js';
import { createCausalPhysicalBranch } from '../js/app/procgen/workstation/CausalPhysicalBranch.js';
import { createCausalTakeWorkbench } from '../js/app/procgen/workstation/CausalTakeWorkbench.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { finalizationEvidence } from '../js/app/procgen/workstation/CausalJournalValidation.js';
import { hashJournalData } from '../js/app/procgen/workstation/CausalJournalCanonical.js';

const versions = { generator: 'procgen-workstation-2', worldCheckpoint: 2, physicalMusic: 1, physicalBatch: 1 };
const graph = revision => ({ version: 1, revision, instruments: [
  { id: 'gate', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6000 + revision, velocity01: 1, role: 'travel', route: 'local' }
] });

describe('replay-qualified physical branch orchestration', function() {
  this.timeout(30000);
  let masks; const jobOwners = [];
  afterEach(() => { for (const jobs of jobOwners.splice(0)) jobs.dispose(); });
  before(async () => { masks = await loadProcgenMasks(); });
  const make = () => new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42, assists: false });
  const fixture = async ({ futureGap = false, checkpointAtFork = false } = {}) => {
    const store = createMemoryCausalStore(), control = { blocked: false }, jobs = createTestBackgroundJobs(); jobOwners.push(jobs);
    const storage = { ...store.storage, commitCausalTake: args => control.blocked ? Promise.reject(new Error('Storage suspended')) : store.storage.commitCausalTake(args) };
    const budget = createResourceBudget({ limitBytes: 256 * 1048576 }), journal = createProcgenCausalJournal({ storage, resourceBudget: budget, jobs });
    const world = make(), clock = createProcgenPhysicalScoreClock(); let currentGraph = graph(1), fork = null;
    for (const actor of world.actors) { actor.y = world.surfaceAt(actor.laneIndex, actor.x); actor.setAction(world.actions[State.WALKING]); }
    const engine = createCausalMusicEngine({ getGraph: () => currentGraph, scoreTimeline: clock });
    const snapshot = () => ({ world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: clock.snapshot(), replay: { version: 1, bpm: 120, scoreTimeline: true } });
    const initial = snapshot(), recorder = await createCausalTakeRecorder({ journal, takeId: 'take:parent', takeName: 'Original parent', documentId: 'doc:branch',
      sourceVersions: versions, assetRefs: initial.world.assets, initialCheckpoint: initial, mapping: currentGraph, boundaryState: { voices: [], timeline: null } });
    world.soundEvents.onBatch.on(batch => { clock.observe(batch, { bpm: 120 }); recorder.recordCommittedBatch({ batch, intents: engine.processBatch(batch) }); });
    for (let tick = 1; tick <= 20; tick++) {
      world.step();
      if (tick === 6) { fork = recorder.mark({ name: 'Fork here' }, { tick, generation: 1 }).lastSequence;
        if (checkpointAtFork) await recorder.checkpoint({ value: snapshot(), tick, generation: 1 });
      }
      if (tick === 10) { currentGraph = graph(9); world.configurePhysicalAuthoring(currentGraph); recorder.recordMapping(currentGraph, { tick, generation: 1 }); }
    }
    if (futureGap) recorder.markGap({ kind: 'physical-facts', firstTick: 15, lastTick: 15, generation: 1, reason: 'future-only-gap' });
    await recorder.stop({ finalCheckpoint: snapshot(), boundaryState: { voices: engine.snapshot().active, timeline: clock.snapshot() } }); world.dispose();
    const reperformance = createCausalReperformance({ journal, createWorld: make, sourceVersions: versions, assetRefs: initial.world.assets, resourceBudget: budget });
    return { ...store, journal, control, budget, fork, reperformance,
      open: options => createCausalPhysicalBranch({ journal, reperformance, parentTakeId: 'take:parent', throughSequence: fork,
        takeId: 'take:branch', takeName: 'Alternate route', executionEpoch: 'branch:execution:1', ...options }) };
  };

  it('compares and steps an isolated workbench branch while preserving the original take', async () => {
    const { journal, budget, fork } = await fixture(), parent = await journal.openTake('take:parent'), original = JSON.stringify(parent), states = [];
    const workbench = createCausalTakeWorkbench({ journal, createWorld: make, resourceBudget: budget,
      getRuntimeIdentity: () => ({ sourceVersions: versions, assetRefs: parent.assetRefs }), onState: state => states.push(state.phase) });
    expect((await workbench.open({ takeId: parent.takeId, throughSequence: fork })).receipt.compatibilityMatch).to.equal(true);
    const branch = await workbench.open({ takeId: parent.takeId, throughSequence: fork, branchTakeId: 'take:workbench', takeName: 'Workbench branch' });
    expect(branch).to.include({ phase: 'branch-paused', audio: false, hardware: false }); expect(branch.active.tick).to.equal(6);
    expect((await workbench.advance({ ticks: 3 })).tick).to.equal(9);
    const finished = await workbench.finish(); expect(finished.takeId).to.equal('take:workbench'); expect(workbench.state().active).to.equal(null);
    expect(JSON.stringify(await journal.openTake(parent.takeId))).to.equal(original);
    expect((await journal.verify('take:workbench')).verifiedThroughSequence).to.be.greaterThan(fork);
    expect(states).to.include.members(['comparing', 'preparing-branch', 'stepping', 'saving-branch']); await workbench.dispose();
  });
  it('retains qualified seek checkpoints only for the same immutable take, runtime versions, assets and live-world owner', async () => {
    const { journal, budget } = await fixture(), parent = await journal.openTake('take:parent'), original = JSON.stringify(parent);
    let liveWorld = {}, sourceVersions = versions;
    const workbench = createCausalTakeWorkbench({ journal, createWorld: make, resourceBudget: budget,
      getRuntimeIdentity: () => ({ sourceVersions, assetRefs: parent.assetRefs, liveWorld }) });
    try {
      const first = await workbench.open({ takeId: parent.takeId }); expect(first.receipt.ticksExecuted).to.equal(20); expect(first.checkpointCache.entries).to.be.greaterThan(0);
      const again = await workbench.open({ takeId: parent.takeId }); expect(again.receipt.ticksExecuted).to.equal(0); expect(again.receipt.actualPhysicsHash).to.equal(first.receipt.actualPhysicsHash);
      expect(again.receipt.continuationStateSchema).to.equal(1); expect(again.receipt.actualContinuationHash).to.equal(first.receipt.actualContinuationHash);
      liveWorld = {}; expect((await workbench.open({ takeId: parent.takeId })).receipt.ticksExecuted).to.equal(20);
      sourceVersions = { ...versions, physicalMusic: 99 }; expect((await workbench.open({ takeId: parent.takeId })).phase).to.equal('unsupported'); expect(workbench.state().checkpointCache.entries).to.equal(0);
      expect(JSON.stringify(await journal.openTake(parent.takeId))).to.equal(original);
    } finally { await workbench.dispose(); await journal.releaseQualifications().completion; }
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('retains bounded source failure diagnostics and clears them after a repaired source succeeds', async () => {
    const { journal, budget, chunks } = await fixture(), parent = await journal.openTake('take:parent');
    const workbench = createCausalTakeWorkbench({ journal, createWorld: make, resourceBudget: budget,
      getRuntimeIdentity: () => ({ sourceVersions: versions, assetRefs: parent.assetRefs }) });
    const passed = await workbench.open({ takeId: parent.takeId }); expect(passed.receipt.compatibilityMatch).to.equal(true);
    const chunk = chunks.get(parent.chunks[0].id), original = chunk.canonical; chunk.canonical = original.replace('physical-batch', 'physical-botch');
    let failure; try { await workbench.open({ takeId: parent.takeId }); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(Error); expect(workbench.state()).to.include({ phase: 'failed', busy: false });
    expect(workbench.state().failure).to.include({ code: 'content-mismatch', sourceId: chunk.id, firstSequence: chunk.firstSequence });
    expect(workbench.state().receipt).to.equal(passed.receipt); chunk.canonical = original;
    const repaired = await workbench.open({ takeId: parent.takeId }); expect(repaired.receipt.compatibilityMatch).to.equal(true); expect(repaired.failure).to.equal(null);
    await workbench.dispose(); await journal.releaseQualifications().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('reuses a replay-proved marker in a fresh branch world while preserving its source', async () => {
    const { journal, budget, fork, reperformance, open } = await fixture({ checkpointAtFork: true });
    const parent = JSON.stringify(await journal.openTake('take:parent'));
    const compared = await reperformance.reperform({ takeId: 'take:parent', throughSequence: fork, executionEpoch: 'qualify:marker' });
    expect(compared.receipt, JSON.stringify(compared.receipt)).to.include({ compatibilityMatch: true, ticksExecuted: 6 });
    const result = await open(); expect(result.receipt, JSON.stringify(result.receipt)).to.include({ status: 'validated-by-current-runtime-reperformance', ticksExecuted: 0, fromCheckpointSequence: fork, tick: 6, exactQualified: false });
    expect((await result.branch.advance({ ticks: 2 })).tick).to.equal(8); expect((await result.branch.stop()).complete).to.equal(true);
    await result.branch.dispose(); expect(JSON.stringify(await journal.openTake('take:parent'))).to.equal(parent);
    await reperformance.dispose().completion; await journal.releaseQualifications().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('invalidates retained checkpoint proof when finalization evidence changes without changing source chunks', async () => {
    const { journal, budget, manifests } = await fixture(), parent = await journal.openTake('take:parent');
    const workbench = createCausalTakeWorkbench({ journal, createWorld: make, resourceBudget: budget,
      getRuntimeIdentity: () => ({ sourceVersions: versions, assetRefs: parent.assetRefs }) });
    expect((await workbench.open({ takeId: parent.takeId })).receipt.ticksExecuted).to.equal(20);
    expect((await workbench.open({ takeId: parent.takeId })).receipt).to.include({ ticksExecuted: 0, tick: 20 });
    const manifest = manifests.get(parent.takeId); manifest.stopReason = 'replaced-finalization-evidence';
    manifest.finalizationHash = await hashJournalData(finalizationEvidence(manifest), { maxBytes: 8 * 1048576 });
    const compared = await workbench.open({ takeId: parent.takeId }); expect(compared.receipt).to.include({ compatibilityMatch: true, ticksExecuted: 20 });
    expect(compared.receipt.artifactIntegrity.finalizationHash).to.equal(manifest.finalizationHash);
    await workbench.dispose(); await journal.releaseQualifications().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('starts paused from a replayed marker, clips future gaps/revisions and replays the continued branch without altering its parent', async () => {
    const { journal, reperformance, fork, open, budget } = await fixture({ futureGap: true });
    const before = JSON.stringify(await journal.openTake('take:parent')), result = await open(), branch = result.branch;
    expect(result.receipt).to.include({ status: 'validated-by-current-runtime-reperformance', exactQualified: false, throughSequence: fork, tick: 6 });
    expect(branch.status()).to.include({ phase: 'paused', tick: 6, completedBatches: 0 });
    expect(branch.status().inspection.hardware).to.equal(false);
    expect(branch.setMapping(graph(2)).status).to.equal('accepted');
    expect(branch.setTempo(90).status).to.equal('accepted'); expect(branch.setSpeed(6).status).to.equal('accepted');
    expect(branch.enqueueIntervention({ id: 'branch:builder', kind: 'assign-worker', origin: 'manual', target: { generation: 1, actorId: 1 }, parameters: { workerKind: 'builders' } }).recording.status).to.equal('accepted');
    const advanced = await branch.advance({ ticks: 5 }); expect(advanced).to.include({ phase: 'paused', tick: 11, completedBatches: 5 });
    await branch.checkpoint(); const receipt = await branch.stop(); expect(receipt.complete).to.equal(true);
    const manifest = await journal.openTake('take:branch');
    expect(manifest.prefix.boundaryQualification.sourceTakeId).to.equal('take:parent');
    expect(manifest.coverage.sourceRange).to.include({ firstTick: 1, lastTick: 11 });
    expect(manifest.coverage.gaps.some(gap => gap.reason === 'future-only-gap')).to.equal(false);
    expect(manifest.coverage.mappingRevisions).to.deep.equal([1, 2]);
    expect(manifest.checkpoints.some(checkpoint => checkpoint.sequence === fork)).to.equal(true);
    expect(JSON.stringify(await journal.openTake('take:parent'))).to.equal(before);
    await branch.dispose();
    await journal.releaseQualifications().completion;
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    const replayed = await reperformance.reperform({ takeId: 'take:branch', executionEpoch: 'branch:replay:2' });
    expect(replayed.receipt, JSON.stringify(replayed.receipt)).to.include({ compatibilityMatch: true, finalWorldParity: 'matched-at-captured-component-checkpoint' });
    reperformance.dispose();
  });

  it('can fork again without recovering abandoned original or first-branch suffix records', async () => {
    const { journal, reperformance, open } = await fixture();
    const first = (await open()).branch; await first.advance({ ticks: 4 });
    const secondFork = first.mark({ name: 'Second fork' }).lastSequence;
    await first.advance({ ticks: 3 }); await first.stop(); await first.dispose();
    const second = await createCausalPhysicalBranch({ journal, reperformance, parentTakeId: 'take:branch', throughSequence: secondFork,
      takeId: 'take:grandchild', takeName: 'Grandchild', executionEpoch: 'branch:execution:2' });
    expect(second.branch.status().tick).to.equal(10);
    await second.branch.advance({ ticks: 1 }); await second.branch.stop(); await second.branch.dispose();
    const rows = await journal.query({ takeId: 'take:grandchild', kinds: ['physical-batch'], limit: 100 });
    expect(rows.records.map(record => record.tick)).to.deep.equal(Array.from({ length: 11 }, (_, index) => index + 1));
    const verified = await reperformance.reperform({ takeId: 'take:grandchild', executionEpoch: 'grandchild:verify' });
    expect(verified.receipt.compatibilityMatch).to.equal(true); reperformance.dispose();
  });

  it('keeps a canceled advance at its last committed boundary and does not invent a failed source tick', async () => {
    const { open, reperformance, journal } = await fixture(), controller = new AbortController();
    const { branch } = await open({ maxAdvanceTicks: 8, yieldEveryTicks: 2, yieldControl: () => { controller.abort(); return Promise.resolve(); } });
    let error; try { await branch.advance({ ticks: 8, signal: controller.signal }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('cancelled'); expect(branch.status()).to.include({ phase: 'paused', tick: 8 });
    expect((await branch.stop()).complete).to.equal(true); await branch.dispose();
    const rows = await journal.query({ takeId: 'take:branch', kinds: ['physical-batch'], limit: 100 });
    expect(rows.records.at(-1).tick).to.equal(8); reperformance.dispose();
  });

  it('retains undurable branch ownership until an explicit discard and reopens only the verified prefix', async () => {
    const { open, reperformance, control, budget, journal } = await fixture(), { branch } = await open();
    await branch.flush(); control.blocked = true;
    await branch.advance({ ticks: 1 }); try { await branch.flush(); } catch { /* Injected durable-store failure. */ }
    expect((await branch.stop()).complete).to.equal(false);
    let error; try { await branch.dispose(); } catch (failure) { error = failure; }
    expect(error.code).to.equal('undurable-branch-tail'); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    control.blocked = false;
    await branch.dispose({ discardPendingReason: 'explicit-test-discard-of-undurable-tail' });
    await journal.releaseQualifications().completion;
    expect(budget.diagnostics().accountedBytes).to.equal(0); control.blocked = false;
    const reopened = await journal.openTake('take:branch'); expect(reopened.effectiveStatus).to.equal('partial');
    expect((await journal.verify('take:branch')).verifiedThroughSequence).to.equal(reopened.durableSequence); reperformance.dispose();
  });

  it('refuses exact-mode activation and a branch boundary inside a physical/intent pair', async () => {
    const { open, reperformance, manifests } = await fixture();
    const exact = await open({ mode: 'exact' }); expect(exact.branch).to.equal(null); expect(exact.receipt.reasons).to.include('active-execution-unbound');
    expect(manifests.has('take:branch')).to.equal(false);
    const incomplete = await open({ throughSequence: 1 }); expect(incomplete.branch).to.equal(null);
    expect(incomplete.receipt.failure.code).to.equal('incomplete-branch-boundary'); expect(manifests.has('take:branch')).to.equal(false); reperformance.dispose();
  });

  it('cancels an owned branch on runtime retirement without capturing disposal as a performed voice end', async () => {
    const { open, reperformance, journal, budget } = await fixture();
    const { branch } = await open({ maxAdvanceTicks: 8, yieldEveryTicks: 2, yieldControl: () => { reperformance.dispose(); return Promise.resolve(); } });
    let error; try { await branch.advance({ ticks: 8 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('cancelled'); expect(branch.status().tick).to.equal(8);
    expect((await branch.stop()).complete).to.equal(true); await branch.dispose();
    await journal.releaseQualifications().completion;
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    const rows = await journal.query({ takeId: 'take:branch', kinds: ['physical-batch'], limit: 100 });
    expect(rows.records.at(-1).tick).to.equal(8);
    expect(rows.records.at(-1).payload.snapshot.status).not.to.equal('terminal');
  });
});
