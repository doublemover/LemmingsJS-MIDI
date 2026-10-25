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
