import { expect } from 'chai';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { sceneRecipeShareIdentity, resolveSceneRecipeShare } from '../js/app/procgen/workstation/ProcgenSceneRecipeShare.js';
import { materializePerformanceSceneProject } from '../js/app/procgen/workstation/PerformanceSceneProject.js';
import { parseProcgenStartupIntent, resolveProcgenStartupIntent, loadProcgenStartupSource } from '../js/app/procgen/workstation/ProcgenStartupIntent.js';
import { createProcgenRecipeShareDescriptor } from '../js/app/procgen/ProcgenUrlConfig.js';

const fixture = async () => {
  const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
  const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: 'b'.repeat(64) }, descriptors }) });
  const row = catalog.registry.findSupported({ id: 'crossing-corridors.4' }), origin = await catalog.origin(catalog.registry.resolve(row));
  const options = { url: 'https://example.test/app/procgen.html?outputId=private&debug=1#recovery-private', sceneOrigin: origin, includeCamera: false };
  const descriptor = createProcgenRecipeShareDescriptor(options), intent = parseProcgenStartupIntent(new URL(descriptor.url).search);
  return { catalog, origin, options, descriptor, intent };
};
const failure = async operation => { try { await operation(); } catch (error) { return error; } throw new Error('Expected an explicit refusal'); };

describe('pinned original authored scene recipe sharing', function() {
  this.timeout(15000);
  it('round-trips only exact scene identity and optional presentation, excluding local state and overrides', async () => {
    const f = await fixture(), target = new URL(f.descriptor.url);
    expect([...target.searchParams.keys()]).to.deep.equal(['recipe', 'sceneId', 'sceneRevision', 'sceneHash', 'sourceHash', 'scoreHash']);
    expect(target.hash).to.equal(''); expect(f.descriptor.scene).to.include({ id: 'crossing-corridors.4', version: 1 });
    expect(f.descriptor.sourceCompatibility).to.equal('requires-pinned-build-and-assets');
    expect(f.intent.sceneRecipe).to.deep.equal(sceneRecipeShareIdentity(f.origin));
    const framed = createProcgenRecipeShareDescriptor({ ...f.options, includeCamera: true, camera: { cameraX: 12, cameraY: 8, scale: 2, follow: false } });
    expect(framed.recipeIdentity).to.equal(f.descriptor.recipeIdentity); expect(framed.camera).to.deep.equal({ cameraX: 12, cameraY: 8, scale: 2, follow: false });
  });
  it('uses the same materialized authored project with clean or unrelated saved preferences and stays stopped and unarmed', async () => {
    const f = await fixture(), source = await loadProcgenStartupSource(f.intent, { getSceneCatalog: async () => f.catalog });
    try {
      const clean = resolveProcgenStartupIntent({ intent: f.intent, sceneRecipe: source.sceneRecipe });
      const occupied = resolveProcgenStartupIntent({ intent: f.intent, sceneRecipe: source.sceneRecipe, saved: { project: { private: true }, transport: { gameSpeed: 0.5 } },
        legacySettings: { laneCount: 2, speed: 0.5, outputId: 'private' } });
      expect({ ...occupied, project: null }).to.deep.equal({ ...clean, project: null });
      const portable = value => ({ ...value, createdAt: null, updatedAt: null });
      expect(portable(occupied.project)).to.deep.equal(portable(clean.project)); expect(portable(clean.project)).to.deep.equal(portable(source.sceneRecipe.project));
      expect(clean.worldOptions).to.deep.equal(source.sceneRecipe.settings); expect(clean.transport).to.include({ playing: false, clockSource: 'internal', linked: true });
      expect(clean.sourceIdentity).to.deep.equal(f.intent.sceneRecipe); expect(clean.project.procgen.lanes.every(lane => lane.outputId === null)).to.equal(true);
      expect(clean.provenance.seed).to.equal('scene-recipe'); expect(source.sceneSelection.preflight.status).to.equal('ready');
    } finally { source.release(); }
    expect(() => source.sceneRecipe).to.throw('retired');
  });
  it('refuses unresolved or substituted identities before producing a startup plan', async () => {
    const f = await fixture();
    expect(() => resolveProcgenStartupIntent({ intent: f.intent })).to.throw('verified source and asset preflight');
    for (const key of ['hash', 'sourceHash', 'recipeHash']) {
      const identity = { ...f.intent.sceneRecipe, [key]: 'f'.repeat(64) };
      expect((await failure(() => resolveSceneRecipeShare(identity, { catalog: f.catalog }))).code).to.equal('scene-recipe-unavailable');
    }
    expect((await failure(() => resolveSceneRecipeShare({ ...f.intent.sceneRecipe, version: 2 }, { catalog: f.catalog }))).message).to.include('not installed');
    const changed = materializePerformanceSceneProject(f.origin);
    expect(() => resolveProcgenStartupIntent({ intent: { ...f.intent, sceneRecipe: { ...f.intent.sceneRecipe, hash: 'f'.repeat(64) } }, sceneRecipe: changed })).to.throw('verified source');
  });
  it('retains an exact later scene revision and derives all project semantics from its original score', async () => {
    const f = await fixture(); await f.catalog.registry.register({ ...f.origin.manifest, version: 2 });
    const scene = f.catalog.registry.resolve(f.catalog.registry.findSupported({ id: f.origin.manifest.id, version: 2 }));
    const origin = await f.catalog.origin(scene), descriptor = createProcgenRecipeShareDescriptor({ ...f.options, sceneOrigin: origin });
    const intent = parseProcgenStartupIntent(new URL(descriptor.url).search), source = await loadProcgenStartupSource(intent, { getSceneCatalog: async () => f.catalog });
    try {
      const plan = resolveProcgenStartupIntent({ intent, sceneRecipe: { ...source.sceneRecipe, settings: { speed: 0.5 }, project: { private: true }, transport: { playing: true } } });
      expect(plan.sourceRevision).to.equal(2); expect(plan.project.procgen.lanes).to.have.length(4);
      expect(plan.worldOptions.speed).to.equal(origin.recipe.settings.speed); expect(plan.transport.playing).to.equal(false);
    } finally { source.release(); }
  });
  it('checks all required scene dependencies and never treats missing assets as an approximate seed recipe', async () => {
    const f = await fixture(), catalog = { ...f.catalog, resolveDependency: async dependency => dependency.kind === 'engine' ? { status: 'unavailable', reason: 'Missing pinned engine' } : f.catalog.resolveDependency(dependency) };
    const error = await failure(() => loadProcgenStartupSource(f.intent, { getSceneCatalog: async () => catalog }));
    expect(error).to.include({ code: 'scene-recipe-unavailable' }); expect(error.message).to.include('Missing pinned engine');
    expect((await failure(() => resolveSceneRecipeShare(f.intent.sceneRecipe, { catalog: { available: false } }))).message).to.include('catalog is unavailable');
  });
  it('rejects duplicates, incomplete hashes, unknown recipe versions and generator overrides without truncation', async () => {
    const f = await fixture(), target = new URL(f.descriptor.url);
    for (const key of ['seed', 'lanes', 'speed', 'preset', 'decoration']) { const changed = new URL(target); changed.searchParams.set(key, '1'); expect(() => parseProcgenStartupIntent(changed.search)).to.throw('conflicts'); }
    for (const key of ['sceneId', 'sceneRevision', 'sceneHash', 'sourceHash', 'scoreHash']) {
      const missing = new URL(target); missing.searchParams.delete(key); expect(() => parseProcgenStartupIntent(missing.search)).to.throw();
      const duplicate = new URL(target); duplicate.searchParams.append(key, duplicate.searchParams.get(key)); expect(() => parseProcgenStartupIntent(duplicate.search)).to.throw('Duplicate startup');
    }
    const badRevision = new URL(target); badRevision.searchParams.set('sceneRevision', '1.0'); expect(() => parseProcgenStartupIntent(badRevision.search)).to.throw('revision');
    const oversized = new URL(target); oversized.searchParams.set('unrelated', 'x'.repeat(2048)); expect(() => parseProcgenStartupIntent(oversized.search)).to.throw('supported size');
  });
  it('cancels and fences a late catalog before materializing or publishing an incoming scene', async () => {
    const f = await fixture(), controller = new AbortController(); let complete, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const work = loadProcgenStartupSource(f.intent, { signal: controller.signal, getSceneCatalog: () => { entered(); return new Promise(resolve => { complete = resolve; }); } });
    await ready; controller.abort(new Error('Incoming scene canceled')); expect((await failure(() => work)).message).to.equal('Incoming scene canceled');
    complete(f.catalog); await new Promise(resolve => setTimeout(resolve, 0));
    const recovered = await loadProcgenStartupSource(f.intent, { getSceneCatalog: async () => f.catalog });
    expect(recovered.sceneSelection.identity).to.deep.equal(f.intent.sceneRecipe); recovered.release();
  });
});
