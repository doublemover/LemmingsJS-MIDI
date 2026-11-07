import { expect } from 'chai';
import { setup } from '../helpers/workstation-fixture.js';
import { createMemoryCausalStore } from '../helpers/causalJournalStore.js';
import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../../scripts/bench-procgen-lanes.js';
import { createProcgenCausalJournal } from '../../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { actorTimbreControls, actorTimbreLocksFor, validateActorTimbreLock, validateActorTimbreLocks, MAX_ACTOR_TIMBRE_LOCKS, MAX_ACTOR_PATCH_LOCKS } from '../../js/midi/content/InstrumentActorLocks.js';
import { INSTRUMENT_VARIATION_ALGORITHM } from '../../js/midi/content/InstrumentIdentityVariation.js';
import { compileInstrumentPerformance, validateInstrumentControls } from '../../js/midi/content/InstrumentPerformance.js';
import { captureCausalPerformanceState, createCausalPerformanceState, diffCausalPerformanceState, validateCausalPerformanceChange } from '../../js/app/procgen/workstation/CausalPerformanceState.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenWorkstationProject } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject, reduceMidiProject } from '../../js/midi/project/MidiProject.js';

const parameters = [{ id: 'color', min: 0, max: 8, default: 2, unit: 'dimensionless', discrete: false, liveSafe: false }];
const patch = () => ({ id: 'lock-fixture', revision: 1, parameters: {}, macros: [], causalBindings: [], variation: {
  algorithmVersion: INSTRUMENT_VARIATION_ALGORITHM, seed: 731, identityScope: 'execution-birth', amount01: 1,
  targets: [{ id: 'actor-color', parameter: 'color', unit: 'ratio', composition: 'scale', amount: 0.1, factors: [{ id: 'sibling', weight: 1 }] }], eventTargets: []
} });
const identity = actorId => ({ worldId: 'ensemble', generation: 1, actorId, onsetId: 'strike-' + actorId });
const lock = (actorId = 0, options = {}) => ({ version: 1, ...identity(actorId), patchId: 'lock-fixture', patchRevision: 1, seed: 731, amount01: 1, ...options });
const savedLock = (actorId = 0, options = {}) => { const { onsetId, ...value } = lock(actorId, options); return value; };

describe('saved actor identity timbre locks', () => {
  it('records lock, Undo and Redo in the actual causal journal without replacing or mutating its physical world', async () => {
    const masks = await loadProcgenMasks(), memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage, physicalOnly: true, worldFactory: () => new ProcgenLaneWorld({ masks, assists: false, seed: 7, laneCount: 1 }) });
    f.studio.bindRuntime(); const world = f.runtime.world, tick = world.tickIndex, generation = world.generation;
    try {
      const armed = await f.studio.handlers.startCausalTake(); expect(armed).to.include({ state: 'recording' });
      f.studio.dispatch({ type: 'procgen/actorTimbreLocks', locks: [savedLock(1, { worldId: world.worldId, generation })] });
      expect(f.studio.getProject().procgen.actorTimbreLocks).to.have.length(1);
      expect(await f.studio.handlers.undo()).to.equal(true); expect(f.studio.getProject().procgen.actorTimbreLocks).to.equal(undefined);
      expect(await f.studio.handlers.redo()).to.equal(true); expect(f.studio.getProject().procgen.actorTimbreLocks).to.have.length(1);
      expect(f.runtime.world).to.equal(world); expect(world.tickIndex).to.equal(tick); expect(world.generation).to.equal(generation);
      const stopped = await f.studio.stopCausalTake({ reason: 'actor-lock-history' }); expect(stopped.complete).to.equal(true);
      const journal = createProcgenCausalJournal({ storage }), result = await journal.query({ takeId: armed.takeId });
      const changes = result.records.filter(record => record.kind === 'input-observation' && record.payload.kind === 'instrument-performance');
      expect(changes.map(record => record.payload.change.actorTimbreLocks?.length)).to.deep.equal([1, 0, 1]);
      expect((await journal.verify(armed.takeId)).status).to.equal('complete');
    } finally { await f.studio.dispose().completion; world.dispose(); }
  });

  it('freezes exactly the locked half of 64 actors through reroll, lane migration, pool reuse and source restore', () => {
    const plan = compileInstrumentPerformance(patch(), parameters), actors = Array.from({ length: 64 }, (_, index) => identity(index));
    const originals = new Map(actors.map(actor => [actor.actorId, plan.resolve({}, 100, actor)]));
    const locks = validateActorTimbreLocks(actors.filter(actor => actor.actorId % 2 === 0).map(actor => savedLock(actor.actorId)));
    const restored = compileInstrumentPerformance(JSON.parse(JSON.stringify(patch())), parameters), saved = validateActorTimbreLocks(JSON.parse(JSON.stringify(locks)));
    for (const actor of [...actors].reverse()) {
      const current = { ...actor, laneId: 'migrated', audioPoolSlot: 0, onsetId: 'later-' + actor.actorId };
      const result = restored.resolve(actorTimbreControls({ variationSeed: 732 }, saved, current), 100, current);
      if (actor.actorId % 2 === 0) expect(result.values).to.deep.equal(originals.get(actor.actorId).values);
      else expect(result.values.color).not.to.equal(originals.get(actor.actorId).values.color);
      expect(result.variation).to.include({ cacheEntries: 0, physicalRandomStateConsumed: false });
      expect(result.values.color).to.be.within(0, 8);
    }
    expect(new Set(actors.map(actor => originals.get(actor.actorId).values.color)).size).to.equal(64);
  });
  it('keeps amount zero exactly at the base patch and preserves the unlocked legacy plan', () => {
    const plan = compileInstrumentPerformance(patch(), parameters), actor = identity(3), locks = validateActorTimbreLocks([savedLock(3)]);
    expect(plan.resolve(actorTimbreControls({ variationAmount01: 0 }, locks, actor), 100, actor)).to.deep.include({ values: { color: 2 }, deltas: [] });
    const controls = { variationSeed: 732 };
    expect(actorTimbreControls(controls, undefined, actor)).to.equal(controls);
    expect(plan.resolve(actorTimbreControls(controls, locks, identity(4)), 100, identity(4))).to.deep.equal(plan.resolve(controls, 100, identity(4)));
  });
  it('locks actor factors separately from event-owned strike variation and rejects foreign onset identity', () => {
    const source = patch(); source.variation.eventTargets = [{ id: 'strike', parameter: 'color', unit: 'ratio', composition: 'scale', amount: 0.05, factors: [{ id: 'strike', weight: 1 }] }];
    const plan = compileInstrumentPerformance(source, parameters), actor = identity(5), locks = validateActorTimbreLocks([savedLock(5)]);
    const first = plan.resolve(actorTimbreControls({}, locks, actor), 100, actor);
    const later = plan.resolve(actorTimbreControls({ variationSeed: 732 }, locks, actor), 100, { ...actor, onsetId: 'later-strike' });
    expect(later.deltas.find(delta => delta.origin === 'identity').requestedValue).to.equal(first.deltas.find(delta => delta.origin === 'identity').requestedValue);
    expect(later.values.color).not.to.equal(first.values.color);
    expect(() => plan.resolve({ actorTimbreLocks: locks }, 100, identity(6))).to.throw('another birth identity');
    expect(plan.resolve({ actorTimbreLocks: validateActorTimbreLocks([savedLock(5, { patchRevision: 2 })]) }, 100, actor).values).to.deep.equal(plan.resolve({}, 100, actor).values);
  });
  it('owns a bounded immutable table and reuses its per-actor index without sharing actors', () => {
    const input = [savedLock(1), savedLock(2)], locks = validateActorTimbreLocks(input); input[0].seed = 99;
    const one = actorTimbreLocksFor(locks, identity(1)), two = actorTimbreLocksFor(locks, identity(2));
    expect(one[0].seed).to.equal(731); expect(one).to.equal(actorTimbreLocksFor(locks, identity(1))); expect(one).not.to.equal(two);
    expect(Object.isFrozen(one)).to.equal(true); expect(Object.isFrozen(one[0])).to.equal(true); expect(validateActorTimbreLocks(one, 16)).to.equal(one);
    expect(actorTimbreLocksFor(locks, { ...identity(1), generation: 2 })).to.equal(null);
    expect(actorTimbreLocksFor(locks, { ...identity(1), worldId: 'another-world' })).to.equal(null);
  });
  it('rejects future schemas, malformed identities, unknown fields and excess saved or actor capacities', () => {
    for (const change of [{ version: 2 }, { generation: -1 }, { generation: 0.5 }, { actorId: null }, { actorId: '' }, { worldId: '' }, { patchId: '' },
      { patchRevision: -1 }, { seed: 1.1 }, { seed: 2147483648 }, { amount01: NaN }, { amount01: 2 }, { privateToken: 'unknown' }]) {
      expect(() => validateActorTimbreLock(savedLock(1, change))).to.throw('actor timbre lock');
    }
    expect(() => validateActorTimbreLocks([savedLock(1), savedLock(1, { seed: 99 })])).to.throw();
    expect(() => validateActorTimbreLocks(Array.from({ length: MAX_ACTOR_TIMBRE_LOCKS + 1 }, (_, actor) => savedLock(actor)))).to.throw();
    expect(() => validateActorTimbreLocks(Array.from({ length: MAX_ACTOR_PATCH_LOCKS + 1 }, (_, revision) => savedLock(1, { patchRevision: revision })))).to.throw();
    expect(() => validateActorTimbreLocks([], Infinity)).to.throw();
    expect(() => validateInstrumentControls({ actorTimbreLocks: null })).to.throw();
  });
  it('stores one canonical project table and clears it without leaving another lane-local model', () => {
    const project = createProcgenWorkstationProject(createMidiProject());
    const changed = reduceMidiProject(project, { type: 'procgen/actorTimbreLocks', locks: [savedLock(1)] });
    expect(changed.procgen.actorTimbreLocks).to.have.length(1); expect(changed.procgen.lanes).to.deep.equal(project.procgen.lanes);
    expect(createProcgenWorkstationProject(JSON.parse(JSON.stringify(changed))).procgen.actorTimbreLocks).to.deep.equal(changed.procgen.actorTimbreLocks);
    const cleared = reduceMidiProject(changed, { type: 'procgen/actorTimbreLocks', locks: [] }); expect(cleared.procgen).not.to.have.property('actorTimbreLocks');
    expect(() => createProcgenWorkstationProject(project, { lanes: [{ instrumentControls: { actorTimbreLocks: [savedLock(1)] } }] })).to.throw('belong to the project');
  });
  it('captures lock-only changes, migration and explicit clearing through the same causal performance owner', () => {
    const lanes = [{ id: 'first', instrumentControls: { variationSeed: 732 } }, { id: 'second', instrumentControls: { variationSeed: 732 } }];
    const before = captureCausalPerformanceState(lanes), after = captureCausalPerformanceState(lanes, [savedLock(1)]), provider = createCausalPerformanceState(before);
    const change = diffCausalPerformanceState(before, after); expect(change).to.deep.include({ upserts: [], removed: [] }); provider.apply(JSON.parse(JSON.stringify(change)));
    expect(provider.snapshot()).to.deep.equal(after); expect(provider.getControls(0, identity(1)).actorTimbreLocks).to.deep.equal(after.actorTimbreLocks);
    expect(provider.getControls(1, identity(1)).actorTimbreLocks).to.deep.equal(after.actorTimbreLocks); expect(provider.getControls(0, identity(2))).not.to.have.property('actorTimbreLocks');
    const retained = provider.snapshot(); expect(() => provider.apply({ version: 1, upserts: [], removed: [], actorTimbreLocks: null })).to.throw(); expect(provider.snapshot()).to.equal(retained);
    provider.apply(diffCausalPerformanceState(after, before)); expect(provider.snapshot()).to.deep.equal(before);
    expect(() => validateCausalPerformanceChange({ version: 1, upserts: [], removed: [], actorTimbreLocks: [savedLock(1), savedLock(1)] })).to.throw();
  });
  it('records only the exact onset actor locks and restores the matching performance checkpoint', () => {
    const state = captureCausalPerformanceState([{ id: 'first', instrumentControls: { variationSeed: 732 } }], [savedLock(1)]), provider = createCausalPerformanceState(state);
    const graph = { version: 1, revision: 1, instruments: [{ id: 'work', sourceKind: 'TerrainWorkCommitted', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'builder' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph, getPerformanceState: provider.snapshot, getOnsetControls: (lane, actor) => provider.getControls(lane, actor) });
    const batch = { version: 1, worldId: 'ensemble', generation: 1, tick: 1, batchId: 'ensemble:1', sourceTimeMs: 60, tickDurationMs: 60, completeness: { status: 'complete', dropped: 0 },
      facts: [{ kind: 'TerrainWorkCommitted', actorId: 1, laneId: 0, eventId: 'brick', causalSequence: 1, operationKind: 'build' }] };
    const onset = engine.processBatch(batch).find(intent => intent.kind === 'begin'); expect(onset.performanceControls.actorTimbreLocks).to.deep.equal(state.actorTimbreLocks);
    const saved = engine.snapshot(); engine.restore(JSON.parse(JSON.stringify(saved))); expect(engine.snapshot()).to.deep.equal(saved);
  });
});
