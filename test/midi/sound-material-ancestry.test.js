import { expect } from 'chai';
import { createSoundMaterialProvider } from '../../js/app/midi-ui/SoundMaterialProvider.js';
import { createTextureBodyGraftRecipe, createTextureBodyTravelBinding } from '../../js/midi/content/TextureBodyGraftRecipe.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createLaneInstrumentPreparation } from '../../js/app/midi-ui/LaneInstrumentPreparation.js';

const refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
async function fixture() {
  const actor = { id: 'material-travel', sourceKind: 'MotionCommitted', route: 'local', articulation: { sustain: true, lifetimeScope: 'actorJourney', metric: 'axis-projection', orientation: 'signedX', phaseMode: 'direction-reversing' } }, recipe = await createTextureBodyGraftRecipe({ originalBody: 'tin', graftBody: 'tin', pitch: { mode: 'pitched', rootCents: 6000 }, traversalBinding: createTextureBodyTravelBinding(actor) }), descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-texture', engineVersion: 1, artifactHash: 'd'.repeat(64) }]), compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), prepared = compiled.prepared, patch = prepared.patches[0];
  const reference = { schema: 'lemmings-sound-reference/v1', packHash: prepared.contentHash, patchId: patch.definition.id, revision: patch.definition.revision, definitionHash: patch.definitionHash, definition: patch.archivedDefinition, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies }, payloads = new Map([[recipe.originalModelFile.sha256, recipe.originalModelFile.text], [recipe.contractHash, recipe.contractText]]);
  return { recipe, prepared, reference, payloads, descriptors };
}
function providerFor(f, { mutate = false, unknownReader = false, waitForAsset = null } = {}) {
  const budget = createResourceBudget(); let packs = 0, assets = 0, hashesRead = [];
  const provider = createSoundMaterialProvider({ resourceBudget: budget, registry: {
    async loadPack() { packs++; return { prepared: f.prepared, release() { packs--; } }; },
    async loadAsset(hash) { await waitForAsset?.(); const text = f.payloads.get(hash); if (text === undefined) return null; assets++; hashesRead.push(hash); return { blob: new Blob([mutate ? '!' + text.slice(1) : text]), release() { if (unknownReader) throw new Error('Unacknowledged model reader'); assets--; } }; }
  }, jobs: { compute() { throw new Error('Generated-data ancestry must not be decoded or sent to a WAV job.'); } }, getContext() { throw new Error('Data-only graft preparation must not open audio.'); } });
  return { budget, provider, counts: () => ({ packs, assets, hashesRead }) };
}

describe('sound ancestry bytes separate from playable PCM (authored unrun)', () => {
  it('verifies complete original model and contract bytes while producing zero decoded sample pins', async () => {
    const f = await fixture(), { provider, budget, counts } = providerFor(f), material = await provider.acquire({ reference: f.reference, engineDescriptors: f.descriptors }); expect(material.assets).to.deep.equal([]); expect(new Set(material.availableHashes)).to.deep.equal(new Set(f.reference.assetHashes)); expect(material.verification.playbackSampleHashes).to.deep.equal([]); expect(new Set(material.verification.dataOnlyHashes)).to.deep.equal(new Set(f.payloads.keys())); expect(counts().packs).to.equal(0); expect(counts().assets).to.equal(0); expect(counts().hashesRead).to.have.length(2);
    const released = material.release(); await released.completion; expect(released.outcome).to.equal('complete'); const retired = provider.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects altered data bytes, missing closure members and absent ancestry payload without publishing availability', async () => {
    const f = await fixture();
    for (const kind of ['corrupt', 'missing-bytes', 'missing-manifest']) {
      const payloads = new Map(f.payloads), prepared = kind === 'missing-manifest' ? { ...f.prepared, pack: { ...f.prepared.pack, files: f.prepared.pack.files.filter(file => file.sha256 !== f.recipe.originalModelFile.sha256) } } : f.prepared; if (kind === 'missing-bytes') payloads.delete(f.recipe.originalModelFile.sha256);
      const { provider, budget, counts } = providerFor({ ...f, payloads, prepared }, { mutate: kind === 'corrupt' }), error = await refused(() => provider.acquire({ reference: f.reference, engineDescriptors: f.descriptors })); expect(error.code).to.equal(kind === 'corrupt' ? 'content-mismatch' : 'asset-missing'); expect(counts().packs).to.equal(0); expect(counts().assets).to.equal(0); const retired = provider.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
    }
  });
  it('prepares a data-backed procedural lane with zero PCM pins while retaining its exact immutable reference', async () => {
    const f = await fixture(), { provider, budget } = providerFor(f), calls = [], backend = { async prepare(resolution, assets) { calls.push({ resolution, assets }); return { status: 'ready' }; }, dispose() {} }, routed = { canAssign: () => true, retain: () => null, assign(...args) { calls.push(args); return { status: 'assigned' }; } }, owner = createLaneInstrumentPreparation({ resourceBudget: budget, getMaterialProvider: () => provider, getCatalog: async () => ({ state: 'bound-application-engines', descriptors: f.descriptors }), routed, session: { createInstrumentBackend() { throw new Error('Use the owned texture renderer.'); }, async createWorkletInstrumentBackend({ engineId }) { expect(engineId).to.equal('worklet-texture'); return backend; } } });
    const candidate = await owner.prepare('lane-a', f.reference); expect(calls[0].assets).to.deep.equal([]); expect(calls[0].resolution.patch.engineId).to.equal('worklet-texture'); expect(provider.diagnostics().loans).to.equal(0); expect(candidate.reference.definitionHash).to.equal(f.reference.definitionHash); candidate.commit(); expect(calls[1][0]).to.equal('lane-a'); expect(calls[1][3].macroIds).to.deep.equal(['excite', 'body', 'damp', 'mix'].sort());
    await owner.dispose().completion; const retired = provider.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('joins a canceled in-flight ancestry reader before releasing its reservation', async () => {
    const f = await fixture(); let allow, started; const gate = new Promise(resolve => { allow = resolve; }), beginning = new Promise(resolve => { started = resolve; }), { provider, budget, counts } = providerFor(f, { waitForAsset: () => { started(); return gate; } }), controller = new AbortController(), pending = provider.acquire({ reference: f.reference, signal: controller.signal }).catch(error => error); await beginning; controller.abort(); allow(); expect((await pending).name).to.equal('AbortError'); expect(counts().packs).to.equal(0); expect(counts().assets).to.equal(0); const retired = provider.dispose(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains unresolved model-reader ownership and charges instead of treating a rejected release as successful disposal', async () => {
    const f = await fixture(), { provider, budget } = providerFor(f, { unknownReader: true }), error = await refused(() => provider.acquire({ reference: f.reference })); expect(error.retirement).to.exist; expect(provider.diagnostics().faults).to.be.greaterThan(0); const retired = provider.dispose(); await retired.completion; expect(retired.outcome).not.to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
