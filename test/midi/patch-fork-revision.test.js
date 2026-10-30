import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { generatePatchNeighborhood } from '../../js/midi/content/PatchNeighborhood.js';
import { revisePatchCandidate } from '../../js/midi/content/PatchForkRevision.js';
import { validatePatchForkProvenance } from '../../js/midi/content/PatchForkProvenance.js';
import { prepareSoundContentPack } from '../../js/midi/content/SoundContentPack.js';
import { resolveSoundContentReference } from '../../js/midi/content/SoundContentReference.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createSoundContentReader, borrowSoundContentStage } from '../../js/app/midi-ui/SoundContentReader.js';
import { createSoundContentArchiver } from '../../js/app/midi-ui/SoundContentArchive.js';
import { stagePreparedSoundContent } from '../../js/app/midi-ui/SoundContentPreparedStage.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';

const refusal = async (promise, code) => { let error; try { await promise; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); if (code) expect(error.code).to.equal(code); return error; };
describe('immutable explicit sound candidate revisions', function() {
  this.timeout(15000);
  let parent, root, descriptor;
  before(async () => {
    descriptor = (await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: 'a'.repeat(64) }]))[0];
    const source = JSON.parse(await readFile(new URL('../../content/sounds/fm-forge.json', import.meta.url), 'utf8'));
    const compiled = await compileSoundContent(source, { targets: [{ descriptor }] }), patch = compiled.prepared.patches.find(entry => entry.archivedDefinition.id === 'forge.glass-rivet');
    parent = { prepared: compiled.prepared, descriptor, reference: { schema: 'lemmings-sound-reference/v1', packHash: compiled.prepared.contentHash,
      patchId: patch.archivedDefinition.id, revision: patch.archivedDefinition.revision, definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: [], definition: patch.archivedDefinition } };
    root = (await generatePatchNeighborhood({ ...parent, seed: 7, count: 1 })).candidates[0]; expect(root.state).to.equal('compiled');
  });
  const edit = options => revisePatchCandidate({ candidate: root, descriptor, ...options });
  it('retains an immutable parent and deterministic full v15 name/macro revision', async () => {
    const before = JSON.stringify(root), options = { name: 'Kept glass with firmer edge', macroDefaults: { hardness: 0.65 } };
    const first = await edit(options), repeated = await edit(options);
    expect(repeated).to.deep.equal(first); expect(first.reference.revision).to.equal(2); expect(first.id).not.to.equal(root.id); expect(first.name).to.equal(options.name);
    expect(first.compiled.compilerRevision).to.equal('typed-recipes-v15'); expect(first.fork.parentReference).to.deep.equal(root.reference); expect(first.fork.neighborhood).to.deep.equal(root.provenance);
    expect(first.reference.definition.macros.find(macro => macro.id === 'hardness').default01).to.equal(0.65);
    expect(first.reference.definition.parameters).to.deep.equal(root.reference.definition.parameters);
    expect(first.reference.definition.sampleRefs).to.deep.equal(root.reference.definition.sampleRefs); expect(first.reference.definition.causalBindings).to.deep.equal(root.reference.definition.causalBindings);
    expect(first.reference.engineRequirement).to.deep.equal(root.reference.engineRequirement); expect(first.qualification).to.equal('compiled-data-not-render-qualified');
    expect(JSON.stringify(root)).to.equal(before);
  });
  it('preserves a user name and marks a name-only revision as render-input equivalent', async () => {
    const named = await edit({ name: 'My exact glass' }); expect(named.duplicateLike).to.equal(true);
    expect(named.compiled.artifacts[0].renderKey).to.equal(root.compiled.artifacts[0].renderKey); expect(named.fork.changes.macros).to.deep.equal([]);
    const altered = await revisePatchCandidate({ candidate: named, descriptor, macroDefaults: { hardness: 0.7 } });
    expect(altered.name).to.equal('My exact glass'); expect(altered.reference.revision).to.equal(3); expect(altered.fork.parentReference.definitionHash).to.equal(named.reference.definitionHash);
    expect(altered.fork.neighborhood).to.deep.equal(root.provenance); expect(JSON.stringify(altered.fork).length).to.be.lessThan(131072);
  });
  it('gives different edits of the same old pin distinct branch identities without version collisions', async () => {
    const first = await edit({ macroDefaults: { hardness: 0.6 } }), second = await edit({ macroDefaults: { hardness: 0.8 } });
    expect(first.reference.revision).to.equal(2); expect(second.reference.revision).to.equal(2); expect(first.id).not.to.equal(second.id);
    expect(first.compiled.prepared.pack.id).not.to.equal(second.compiled.prepared.pack.id);
  });
  it('admits both macro endpoints without altering target ranges or changing any other macro', async () => {
    for (const value of [0, 1]) {
      const changed = await edit({ macroDefaults: { hardness: value } }), macros = changed.reference.definition.macros;
      for (const macro of root.reference.definition.macros) expect(macros.find(entry => entry.id === macro.id)).to.deep.equal(macro.id === 'hardness' ? { ...macro, default01: value } : macro);
    }
  });
  it('rejects unknown/unsafe input and no-op edits before publication', async () => {
    for (const options of [{ name: '' }, { name: ' '.repeat(4) }, { name: 'x'.repeat(161) }, { macroDefaults: { missing: 0.5 } },
      { macroDefaults: { hardness: NaN } }, { macroDefaults: { hardness: -0.1 } }, { macroDefaults: [] }]) await refusal(edit(options), 'invalid-fork-input');
    await refusal(edit({}), 'invalid-fork-revision');
  });
  it('retains macro and parameter locks while permitting an explicit name revision', async () => {
    for (const locks of [{ macros: ['hardness'] }, { parameters: ['indexStart'] }]) {
      const locked = (await generatePatchNeighborhood({ ...parent, seed: 4, count: 1, locks })).candidates[0], before = JSON.stringify(locked);
      await refusal(revisePatchCandidate({ candidate: locked, descriptor, macroDefaults: { hardness: 0.7 } }), 'invalid-fork-revision');
      const named = await revisePatchCandidate({ candidate: locked, descriptor, name: 'Locked source · named fork' });
      expect(named.reference.definition.macros).to.deep.equal(locked.reference.definition.macros); expect(named.fork.neighborhood.locks).to.deep.equal(locked.provenance.locks);
      expect(JSON.stringify(locked)).to.equal(before);
    }
  });
  it('rejects modified prior-definition bytes and unavailable parent pack identity', async () => {
    const definition = structuredClone(root.reference.definition); definition.parameters.indexStart += 0.01;
    await refusal(revisePatchCandidate({ candidate: { ...root, reference: { ...root.reference, definition } }, descriptor, name: 'Changed bytes' }), 'invalid-fork-revision');
    await refusal(revisePatchCandidate({ candidate: { ...root, reference: { ...root.reference, packHash: 'f'.repeat(64) } }, descriptor, name: 'Wrong pack' }), 'invalid-recipe');
  });
  it('rejects hidden parameter, material, mapping, voice-policy or macro-curve changes in a revision receipt', async () => {
    const revised = await edit({ macroDefaults: { hardness: 0.65 } });
    for (const mutate of [value => { value.parameters.attackSeconds += 0.01; }, value => { value.mix.gain01 = 0.01; }, value => { value.voicePolicy.maxVoices = value.voicePolicy.maxVoices === 1 ? 2 : 1; },
      value => { const target = value.macros[0].targets[0]; target.curve = target.curve === 'step' ? 'linear' : 'step'; }, value => { value.sampleRefs.push({ id: 'unexpected' }); }, value => { value.causalBindings = [{}]; }]) {
      const changed = structuredClone(revised.reference.definition); mutate(changed);
      await refusal(validatePatchForkProvenance(revised.fork, { definition: changed, engineRequirement: revised.reference.engineRequirement }), 'invalid-fork-revision');
    }
  });
  it('rejects malformed parent/change/engine receipts on saved import', async () => {
    const revised = await edit({ name: 'Exact receipt' });
    for (const mutate of [value => { value.parentReference.definitionHash = 'a'.repeat(64); }, value => { value.revision++; }, value => { value.changes.macros = [null]; },
      value => { value.unknown = true; }, value => { value.changes.name.previous = 'Wrong prior name'; }]) {
      const changed = structuredClone(revised.fork); mutate(changed); await refusal(validatePatchForkProvenance(changed, { definition: revised.reference.definition }));
    }
    await refusal(validatePatchForkProvenance(revised.fork, { definition: revised.reference.definition, engineRequirement: { ...revised.reference.engineRequirement, artifactHash: 'f'.repeat(64) } }), 'invalid-fork-revision');
  });
  it('reopens the complete v15 fork offline with exact missing-engine behavior and no generator call', async () => {
    const revised = await edit({ name: 'Saved exact fork', macroDefaults: { hardness: 0.65 } }), saved = JSON.stringify(revised.compiled.prepared.pack);
    const opened = await prepareSoundContentPack(JSON.parse(saved), { engineDescriptors: [descriptor] });
    expect(opened.contentHash).to.equal(revised.reference.packHash); expect(opened.patches[0].archivedDefinition).to.deep.equal(revised.reference.definition);
    const unavailable = await prepareSoundContentPack(JSON.parse(saved)); expect(unavailable.patches[0].state).to.equal('engine-unavailable');
    expect(unavailable.patches[0].archivedDefinition).to.deep.equal(revised.reference.definition);
    expect((await resolveSoundContentReference(revised.reference, { engineDescriptors: [descriptor], availableHashes: [] })).status).to.equal('ready');
  });
  it('stages the exact v15 reference through real archive/reader ownership without rewriting its hash', async () => {
    const revised = await edit({ name: 'Canonical kept revision' }), budget = createResourceBudget(), admission = createBackgroundWorkerAdmission();
    const jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} }), reader = createSoundContentReader({ resourceBudget: budget, jobs }), archiver = createSoundContentArchiver({ resourceBudget: budget, jobs }); let stage;
    try {
      stage = await stagePreparedSoundContent({ prepared: revised.compiled.prepared, reader, archiver, engineDescriptors: [descriptor] }); expect(stage.metadata().contentHash).to.equal(revised.reference.packHash);
      const loan = borrowSoundContentStage(stage); expect(loan.prepared.pack.compilation.artifacts[0].fork).to.deep.equal(revised.fork); loan.release();
    } finally { stage?.discard(); await reader.dispose()?.completion; await archiver.dispose()?.completion; await jobs.dispose(); admission.dispose(); }
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('refuses canceled and stale compile completion without mutating the old candidate', async () => {
    const controller = new AbortController(); controller.abort(); expect((await refusal(edit({ name: 'Canceled', signal: controller.signal }))).name).to.equal('AbortError');
    await refusal(edit({ name: 'Stale', isCurrent: () => false }), 'stale-source');
    let current = true; const before = JSON.stringify(root);
    await refusal(edit({ name: 'Changed during compile', isCurrent: () => current, compile: async (...args) => { const result = await compileSoundContent(...args); current = false; return result; } }), 'stale-source');
    expect(JSON.stringify(root)).to.equal(before);
  });
});
