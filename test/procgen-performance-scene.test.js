import { restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createPerformanceStageSession } from '../js/app/procgen/workstation/PerformanceStageSession.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { createPerformanceSceneWorldAdapter } from '../js/app/procgen/workstation/PerformanceSceneWorldAdapter.js';
import { renderPerformanceSceneRehearsal } from '../js/app/procgen/workstation/PerformanceSceneRehearsalRender.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { expect } from 'chai';
import { hashData } from '../js/core/CanonicalData.js';
import { validatePerformanceScene, derivePerformanceScene, performanceSceneHash, inspectPerformanceScene } from '../js/app/procgen/workstation/PerformanceScene.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { createPerformanceSceneRegistry } from '../js/app/procgen/workstation/PerformanceSceneRegistry.js';
import { createPerformanceSceneLoader } from '../js/app/procgen/workstation/PerformanceSceneLoader.js';
import { CAUSAL_RENDER_SINE } from '../js/app/midi-ui/CausalTakeAudioRender.js';

const h = value => value.repeat(64), pin = id => ({ id, revision: 1, hash: h('c') });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const scene = async (count = 4, density = 'sparse') => {
  const definitionHash = await hashData(CAUSAL_RENDER_SINE), reference = { schema: 'lemmings-sound-reference/v1', patchId: CAUSAL_RENDER_SINE.id, revision: 1, definitionHash, packHash: h('b'), assetHashes: [], definition: CAUSAL_RENDER_SINE,
    engineRequirement: { engineId: 'worklet-sine', engineVersion: 1, artifactHash: h('a'), parameterSchemaHash: h('d') } };
  return validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'proof.' + count + '.' + density, version: 1, title: 'Physical proof ' + count, description: 'Actual crossing observations excite pinned local voices.', sourceVersion: pin('world-source'), worldRecipeRef: pin('crossing-score'), seed: 123,
    physicalControls: [{ id: 'gap', label: 'Gate spacing', scope: 'geometry', unit: 'world-pixels', minimum: 8, maximum: 128, initial: 32, step: 1, target: 'gates.spacing' }],
    causalMappings: { version: 1, revision: 1, instruments: [{ id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6000, velocity01: 0.7, role: 'crossing', route: 'local' }] },
    patchRefs: Array.from({ length: count }, (_, i) => ({ laneId: 'lane-' + i, reference })), mix: Array.from({ length: count }, (_, i) => ({ laneId: 'lane-' + i, gain: 0.5, pan: 0, mute: false, solo: false })),
    initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null, expectedLandmarks: [{ id: 'gate', observationKind: 'MotionCommitted', sourceObjectId: 'gate:40', consequence: 'A real crossing makes one note.', help: 'Redirect an actor through this gate.' }],
    requirements: { required: [{ ...pin('MotionCommitted'), kind: 'physical-observation', description: 'Committed crossing evidence' }], optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'Project', role: 'Original physical score', source: null }],
    cost: { lanes: count, maximumVoices: count * 64, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['crossing'], density, lessonLevel: 1 });
};
const available = async dependency => ({ ...dependency, status: 'available', storage: 'installed-runtime' });

describe('versioned physical scene content and complete dependency closure', () => {
  for (const lanes of [4, 8]) for (const density of ['sparse', 'medium', 'dense']) it('pins ' + lanes + ' lanes with ' + density + ' authored admission bounds', async () => {
    const value = await scene(lanes, density), proof = await checkPerformanceSceneRequirements(value, { resolveDependency: available });
    expect(proof.status).to.equal('ready'); expect(proof.dependencies.filter(entry => entry.dependency.kind === 'engine')).to.have.length(1); expect(proof.cost.lanes).to.equal(lanes); expect(proof.acousticReceipt).to.equal(false);
    expect(() => validatePerformanceScene({ ...value, initialTransport: { ...value.initialTransport, playing: true } })).to.throw();
  });
  it('keeps missing optional material separate from required missing assets and embedded playable ancestry', async () => {
    const value = await scene(), dependency = { ...pin('source-lineage'), kind: 'asset', description: 'Original take for optional rebuilding' };
    const optional = validatePerformanceScene({ ...value, requirements: { ...value.requirements, optional: [dependency] } });
    const proof = await checkPerformanceSceneRequirements(optional, { resolveDependency: async entry => entry.id === dependency.id ? { status: 'unavailable' } : { ...entry, status: 'available', storage: 'frozen-derived-pcm' } });
    expect(proof.status).to.equal('ready'); expect(proof.missingOptional).to.have.length(1); expect(proof.dependencies[0].regeneration).to.equal('not-proven');
    const wrong = await checkPerformanceSceneRequirements(value, { resolveDependency: async entry => ({ ...entry, status: 'available', hash: h('f'), storage: 'embedded' }) }); expect(wrong.status).to.equal('unavailable');
  });
  it('requires an explicit named approximation and hashes its changed behavior', async () => {
    const value = await scene(), original = { ...pin('body-quality'), kind: 'quality-profile', description: 'Full shared body' }, approximation = { ...pin('reduced-body-quality'), kind: 'quality-profile', description: 'Reduced modal body' };
    const variant = validatePerformanceScene({ ...value, requirements: { ...value.requirements, substitutableWithNamedApproximation: [{ requirement: original, approximation, variantId: 'reduced-body', label: 'Reduced body', changedBehavior: 'Fewer body modes; same strikes, different timbre.' }] } });
    const resolveDependency = async entry => entry.id === original.id ? { status: 'unavailable' } : available(entry);
    expect((await checkPerformanceSceneRequirements(variant, { resolveDependency })).status).to.equal('unavailable');
    const proof = await checkPerformanceSceneRequirements(variant, { resolveDependency, variants: ['reduced-body'] }); expect(proof.status).to.equal('ready'); expect(proof.changedBehavior[0].variantId).to.equal('reduced-body');
  });
  it('retains exact derived parent identity and metadata-only future versions without allowing overwrite', async () => {
    const value = await scene(), derived = await derivePerformanceScene(value, { id: 'user.score', version: 1, title: 'My score', overrides: { seed: 45 } }), registry = createPerformanceSceneRegistry();
    expect(derived.parent.hash).to.equal(await performanceSceneHash(value)); expect(value.seed).to.equal(123); await registry.register(value); await registry.register(derived);
    const future = { schema: 'lemmings-performance-scene/v999', id: 'future', version: 2, title: 'Future score' }; await registry.register(future); expect(inspectPerformanceScene(future).supported).to.equal(false);
    expect(registry.page({ limit: 2 }).nextOffset).to.equal(2); expect(registry.page({ mechanism: 'crossing' }).total).to.equal(2);
    let error; try { await registry.register({ ...value, seed: 999 }); } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error);
  });
});

describe('scene candidates fence live state and own late resources', () => {
  const setup = async ({ wait = null, confirmation = async () => true } = {}) => {
    let base = 'doc:1:routes:1', mutations = 0, retired = 0; const entered = deferred();
    const loader = createPerformanceSceneLoader({ getBaseIdentity: () => base, resolveDependency: available, beforeCommit: confirmation,
      prepareCandidate: async ({ preflight, baseIdentity, isCurrent }) => { entered.resolve(); if (wait) await wait.promise; return { sceneHash: preflight.sceneHash, variants: preflight.variants, baseIdentity,
        admission: { status: 'admitted', world: true, sound: true, mapping: true }, commit({ isCurrent: fence }) { fence(); if (!isCurrent()) throw new Error('stale'); mutations++; return { status: 'committed', sceneHash: preflight.sceneHash, baseIdentity, policy: 'stopped-replacement', transportPlaying: false, externalOutputEnabledByScene: false, recordingArmedByScene: false, localAudioEnabledByScene: false }; }, retire() { retired++; return { outcome: 'complete' }; } }; } });
    loader.select(await scene()); return { loader, entered, setBase(value) { base = value; }, mutations: () => mutations, retired: () => retired };
  };
  it('prepares without touching the live world and adopts only a fenced paused candidate', async () => {
    const f = await setup(); await f.loader.prepare(); expect(f.mutations()).to.equal(0); expect(f.loader.state().phase).to.equal('ready'); await f.loader.apply(); expect(f.mutations()).to.equal(1); expect(f.retired()).to.equal(1); expect(f.loader.state().phase).to.equal('active'); await f.loader.dispose();
  });
  it('rejects edits and output routing changes during final confirmation without overwriting them', async () => {
    const confirmation = deferred(), f = await setup({ confirmation: () => confirmation.promise }); await f.loader.prepare(); const apply = f.loader.apply(); f.setBase('doc:2:routes:2'); confirmation.resolve(true);
    let error; try { await apply; } catch (caught) { error = caught; } expect(error.code).to.equal('stale-scene-operation'); expect(f.mutations()).to.equal(0); await f.loader.dispose(); expect(f.retired()).to.equal(1);
  });
  it('retires a late canceled candidate and preserves the newer scene selection', async () => {
    const wait = deferred(), f = await setup({ wait }); const loading = f.loader.prepare();
    await f.entered.promise;
    f.loader.select(await scene(8)); wait.resolve(); let error; try { await loading; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); expect(f.mutations()).to.equal(0); expect(f.loader.state().selection.id).to.include('.8.'); expect(f.retired()).to.equal(1); await f.loader.dispose();
  });
});


describe('installed crossing scores and the existing world candidate adapter', () => {
  const installed = async () => {
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: h('a') }]);
    const getCatalog = async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors });
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog }); return { library, getCatalog };
  };
  it('ships exact-build four/eight-lane physical scores with distinct per-corridor gates and inspectable unavailable source mode', async () => {
    const f = await installed(), page = f.library.registry.page(); expect(page.rows).to.have.length(2);
    for (const row of page.rows) {
      const value = f.library.registry.resolve(row), proof = await checkPerformanceSceneRequirements(value, { resolveDependency: f.library.resolveDependency }); expect(proof.status).to.equal('ready');
      expect(value.causalMappings.instruments.map(instrument => instrument.sourceLanes)).to.deep.equal(Array.from({ length: value.cost.lanes }, (_, index) => [index]));
      const origin = await f.library.origin(value); await verifyPerformanceSceneOrigin(origin, { sourceHash: h('b') });
      const project = createProcgenWorkstationProject({}, { seed: value.seed, sceneOrigin: origin }); expect(createProcgenWorkstationProject(project).procgen.sceneOrigin.sceneHash).to.equal(origin.sceneHash);
    }
    const unbound = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'execution-unbound' }) }); expect(unbound.available).to.equal(false); expect(unbound.registry.size()).to.equal(0);
  });
  it('compiles actual patches and authoring into an unadvanced real world before the publication fence', async () => {
    const f = await installed(), value = f.library.registry.resolve(f.library.registry.page().rows[0]), budget = createResourceBudget(), masks = await loadProcgenMasks(); let world, recipe, published = false, retired = false;
    const adapter = createPerformanceSceneWorldAdapter({ resourceBudget: budget, getCatalog: f.getCatalog, getOrigin: (scene, variants) => f.library.origin(scene, variants),
      // This component fixture exercises real patch/world owners. Boot canvas,
      // installed terrain loading and audible rendering remain browser work.
      prepareWorld: async input => { recipe = input.sceneRecipe; world = new ProcgenLaneWorld({ masks, laneCount: recipe.settings.laneCount, laneHeight: recipe.settings.laneHeight, seed: recipe.settings.seed }); world.configurePhysicalAuthoring(recipe.project.procgen.physicalGraph, []);
        return { world, isCurrent: () => !published && !retired, commit({ isCurrent }) { isCurrent(); published = true; }, retire() { retired = true; if (!published) world.dispose(); return { outcome: 'complete' }; } }; } });
    const proof = await checkPerformanceSceneRequirements(value, { resolveDependency: f.library.resolveDependency }), candidate = await adapter({ scene: value, preflight: proof, baseIdentity: 'doc:1', isCurrent: () => true });
    expect(world.tickIndex).to.equal(0); expect(published).to.equal(false); expect(candidate.admission.sourcePools['worklet-sine']).to.equal(value.cost.maximumVoices); expect(recipe.project.procgen.sceneOrigin.sceneHash).to.equal(proof.sceneHash);
    const source = await candidate.borrowRehearsalCheckpoint(); expect(source.sourceTick).to.equal(0); expect(world.tickIndex).to.equal(0); expect(source.checkpoint.seed).to.equal(value.seed);
    expect(() => candidate.commit({ policy: 'stopped-replacement', isCurrent: () => true })).to.throw('readers'); source.release(); expect(() => source.checkpoint).to.throw('retired');
    let fenced = false; const receipt = candidate.commit({ policy: 'stopped-replacement', isCurrent: () => { fenced = true; return true; } }); expect(fenced).to.equal(true); expect(published).to.equal(true); expect(receipt.transportPlaying).to.equal(false);
    const retirement = candidate.retire(); await retirement.completion; expect(retirement.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0); world.dispose();
  });
  it('pins finite practice releases before the first cohort and rehearses an actor-free control without phantom attacks', async () => {
    const descriptors = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-pluck'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))), getCatalog = async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors });
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog }), masks = await loadProcgenMasks(); expect(library.registry.page().rows.filter(row => !row.id.startsWith('dub-quarry.'))).to.have.length(8);
    for (const row of library.registry.page().rows.filter(row => ['practice.one-foot-one-sound', 'practice.space-becomes-rhythm', 'practice.quiet-control'].includes(row.id))) {
      const value = library.registry.resolve(row), origin = await library.origin(value), budget = createResourceBudget(); let original;
      const adapter = createPerformanceSceneWorldAdapter({ resourceBudget: budget, getCatalog, getOrigin: (scene, variants) => library.origin(scene, variants), prepareWorld: async ({ sceneRecipe }) => {
        original = new ProcgenLaneWorld({ masks, cohorts: true, laneCount: sceneRecipe.settings.laneCount, laneHeight: sceneRecipe.settings.laneHeight, seed: sceneRecipe.settings.seed, initialReleaseGesture: sceneRecipe.initialReleaseGesture, assists: false, stallPolicy: { secondsWithoutProgress: 1000 } });
        original.baseGroundAt = (_x, y) => y % original.laneHeight >= original.laneHeight - 16 ? 1 : 0; original.configurePhysicalAuthoring(sceneRecipe.project.procgen.physicalGraph, []);
        return { world: original, isCurrent: () => true, commit() {}, retire() { original.dispose(); return { outcome: 'complete' }; } };
      } });
      const preflight = await checkPerformanceSceneRequirements(value, { resolveDependency: library.resolveDependency }), prepared = await adapter({ scene: value, preflight, baseIdentity: 'practice-doc', isCurrent: () => true });
      expect(preflight.status).to.equal('ready'); expect(original.activeCount).to.equal(0); expect(original.population.releaseGesture).to.deep.equal(origin.recipe.initialReleaseGesture);
      const loan = await prepared.borrowRehearsalCheckpoint(), clone = new ProcgenLaneWorld({ masks, cohorts: true, laneCount: value.cost.lanes, laneHeight: 96, seed: value.seed, assists: false, stallPolicy: { secondsWithoutProgress: 1000 } });
      clone.baseGroundAt = (_x, y) => y % clone.laneHeight >= clone.laneHeight - 16 ? 1 : 0; restoreProcgenCheckpoint(clone, loan.checkpoint); loan.release();
      const facts = [], intents = [], engine = createCausalMusicEngine({ getGraph: () => value.causalMappings }); clone.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); });
      for (let tick = 0; tick < 140; tick++) clone.step();
      const births = facts.filter(fact => fact.kind === 'ActorBorn'), begins = intents.filter(intent => intent.kind === 'begin');
      if (origin.recipe.initialReleaseGesture.paused) { expect(births).to.have.length(0); expect(begins).to.have.length(0); expect(clone.activeCount).to.equal(0); }
      else { expect(births).to.have.length(value.cost.lanes); expect(begins.length).to.be.greaterThan(0); expect(births.map(fact => fact.spawnTick)).to.deep.equal(value.cost.lanes === 1 ? [1] : [1, 13]); }
      expect(original.tickIndex).to.equal(0); expect(original.activeCount).to.equal(0); clone.dispose(); const retired = prepared.retire(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
    }
  });
  it('keeps source-build mismatch unavailable instead of converting the score silently', async () => {
    const f = await installed(), value = f.library.registry.resolve(f.library.registry.page().rows[0]), origin = await f.library.origin(value); let error;
    try { await verifyPerformanceSceneOrigin(origin, { sourceHash: h('c') }); } catch (caught) { error = caught; } expect(error.code).to.equal('invalid-scene-score-recipe');
  });
  it('normalizes a frozen saved manifest without mutating the caller', async () => {
    const value = await scene(), before = JSON.stringify(value), normalized = validatePerformanceScene(value);
    expect(JSON.stringify(value)).to.equal(before); expect(normalized.initialTransport.clockSource).to.equal('internal'); expect(Object.isFrozen(normalized.causalMappings)).to.equal(true);
  });
  it('renders no onset from an empty private source and preserves the authored per-lane mix receipt', async () => {
    const f = await installed(), value = f.library.registry.resolve(f.library.registry.page().rows[0]), catalog = await f.getCatalog(), sceneHash = await performanceSceneHash(value);
    const source = { schema: 'lemmings-scene-rehearsal-source/v1', sceneHash, initialTick: 0, ticks: 1, sourceTimeMs: 0, durationSeconds: 0.08, worldId: 'private-scene-world', generation: 0, seed: value.seed, intents: [] };
    const result = await renderPerformanceSceneRehearsal({ scene: value, sceneHash, source, sampleRate: 48000 }, { descriptors: catalog.descriptors, buildId: value.sourceVersion.hash, yieldControl: async () => {} });
    expect(result.manifest.statistics.peak).to.equal(0); expect(result.manifest.lanes.every(lane => lane.begins === 0)).to.equal(true); expect(result.manifest.nextWorldAdvanced).to.equal(false); expect(result.manifest.historicalPerformanceEvidence).to.equal(false);
    expect(result.manifest.lanes.map(lane => lane.mix.pan)).to.deep.equal(value.mix.map(lane => lane.pan / 127)); expect(result.manifest.sourceHash).to.equal(await hashData(source));
    let error; try { await renderPerformanceSceneRehearsal({ scene: value, sceneHash, source, sampleRate: 48000 }, { descriptors: catalog.descriptors, buildId: h('d') }); } catch (caught) { error = caught; } expect(error.code).to.equal('scene-rehearsal-render-unavailable');
  });
});


describe('protected stage sessions consume the same prepared scene owner', () => {
  it('keeps performance and cleanup available while blocking structural edits and endpoint changes', async () => {
    let presentation = false, canceled = 0;
    const stage = createPerformanceStageSession({ getIdentity: () => 'doc:1', setPresentation: value => { presentation = value; }, applyCandidate: async () => { throw new Error('No cue prepared.'); }, cancelCandidate: async () => { canceled++; } });
    expect(stage.permitsCommand('new')).to.equal(true); stage.enter(); expect(presentation).to.equal(true);
    for (const name of ['stopOutput', 'panicOutput', 'stagePlay', 'performReleaseGesture', 'requestJunction', 'cancelExportDelivery']) expect(stage.permitsCommand(name), name).to.equal(true);
    for (const name of ['new', 'load', 'rebuild', 'undo', 'save', 'input', 'clockOutput', 'selectNativeSound']) expect(stage.permitsCommand(name), name).to.equal(false);
    expect(stage.permitsCommand('transport', [{ bpm: 130 }])).to.equal(true); expect(stage.permitsCommand('transport', [{ clockSource: 'external' }])).to.equal(false);
    expect(stage.permitsEdit({ type: 'procgen/lane', patch: { gain: 0.6, mute: true } })).to.equal(true); expect(stage.permitsEdit({ type: 'procgen/lane', patch: { worldThemeId: 'crystal' } })).to.equal(false);
    await stage.exit(); expect(presentation).to.equal(false); expect(canceled).to.equal(1); expect(stage.permitsCommand('new')).to.equal(true);
  });
  it('never publishes an unavailable or stale NEXT and retains an explicit paused resume choice', async () => {
    let candidate = { phase: 'ready', canApply: false }, publications = 0, identity = 'doc:1';
    const stage = createPerformanceStageSession({ getIdentity: () => identity, setPresentation() {}, getCandidate: () => candidate,
      applyCandidate: async () => { publications++; identity = 'doc:2'; return { status: 'committed' }; } });
    stage.enter(); expect(await stage.go()).to.equal(false); expect(publications).to.equal(0);
    candidate = { phase: 'ready', canApply: true, prepared: { preflight: { sceneHash: h('a') } } }; await stage.go(); expect(publications).to.equal(1); expect(stage.state().enteringIdentity).to.equal('doc:2'); expect(stage.state().resumeChoice).to.include('explicit-Play'); await stage.dispose();
  });
  it('exposes stale source bases as unready before a user can press GO', async () => {
    let base = 'doc:1'; const value = await scene(), loader = createPerformanceSceneLoader({ getBaseIdentity: () => base, resolveDependency: available,
      prepareCandidate: async ({ preflight, baseIdentity }) => ({ sceneHash: preflight.sceneHash, variants: preflight.variants, baseIdentity, admission: { status: 'admitted', world: true, sound: true, mapping: true }, commit() { throw new Error('Unexpected publication.'); }, retire: () => ({ outcome: 'complete' }) }) });
    loader.select(value); await loader.prepare(); expect(loader.state().canApply).to.equal(true); base = 'doc:2'; expect(loader.state().canApply).to.equal(false); await loader.dispose();
  });
});
