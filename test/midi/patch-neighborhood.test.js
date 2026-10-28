import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { compileSoundContent, createResolvedPatchRecipeSource } from '../../js/midi/content/SoundContentCompiler.js';
import { generatePatchNeighborhood } from '../../js/midi/content/PatchNeighborhood.js';
import { revisePatchCandidate } from '../../js/midi/content/PatchForkRevision.js';
import { AUTHORED_PATCH_NEIGHBORHOODS } from '../../js/midi/content/AuthoredPatchNeighborhoods.js';
import { validatePatchNeighborhoodProvenance } from '../../js/midi/content/PatchNeighborhoodProvenance.js';
import { prepareSoundContentPack } from '../../js/midi/content/SoundContentPack.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { resolveSoundContentReference } from '../../js/midi/content/SoundContentReference.js';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { hashDataText } from '../../js/core/CanonicalData.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createSoundContentReader, borrowSoundContentStage } from '../../js/app/midi-ui/SoundContentReader.js';
import { createSoundContentArchiver } from '../../js/app/midi-ui/SoundContentArchive.js';
import { stagePreparedSoundContent } from '../../js/app/midi-ui/SoundContentPreparedStage.js';

const rejected = async (promise, code) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.code).to.equal(code); return error; };
const referenceFor = prepared => { const patch = prepared.patches.find(entry => entry.state === 'definition-admitted'); return {
  schema: 'lemmings-sound-reference/v1', packHash: prepared.contentHash, patchId: patch.archivedDefinition.id, revision: patch.archivedDefinition.revision,
  definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: prepared.pack.files.map(file => file.sha256), definition: patch.archivedDefinition }; };

describe('authored bounded patch neighborhoods', function() {
  this.timeout(60000);
  const parents = new Map(); let descriptors;
  before(async () => {
    descriptors = await describeNativeInstrumentEngines(['native-fm', 'native-modal', 'worklet-pluck', 'worklet-sample', 'worklet-wind', 'native-oscillator']
      .map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    for (const [file, engineId] of [['fm-forge.json', 'native-fm'], ['struck-materials.json', 'native-modal'], ['plucked-garden.json', 'worklet-pluck'], ['wind-bodies.json', 'worklet-wind']]) {
      const source = JSON.parse(await readFile(new URL('../../content/sounds/' + file, import.meta.url), 'utf8'));
      const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
      parents.set(engineId, { prepared: compiled.prepared, reference: referenceFor(compiled.prepared), descriptor: descriptors.find(entry => entry.engineId === engineId) });
    }
    const source = JSON.parse(await readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8'));
    const rights = source.recipes.find(recipe => recipe.rights).rights, material = 'b'.repeat(64);
    source.files = [{ path: 'samples/voice.wav', sha256: material, bytes: 128, mediaType: 'audio/wav', kind: 'sample', parents: [], rights: { ...rights, kind: 'derived-data' } }];
    delete source.realizationGroups;
    source.recipes = [{ id: 'circuit.single-voice', revision: 1, name: 'Circuit voice', author: 'Fixture', tags: ['test'], engine: { id: 'worklet-sample', version: 1 },
      components: [{ id: 'exciter', role: 'exciter', parameters: { sampleLowpassHz: { value: 8000, unit: 'Hz' }, sampleVelocityTone01: { value: 0.5, unit: 'normalized' } } },
        { id: 'envelope', role: 'envelope', parameters: { attackSeconds: { value: 0.005, unit: 's' } } }],
      sampleRefs: [{ id: 'material', sha256: material, bytes: 128, required: true }], sampleMap: singleSampleMap(material), dependencies: [material],
      macros: [], causalBindings: [], modulations: [], voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 }, rights }];
    const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    parents.set('worklet-sample', { prepared: compiled.prepared, reference: referenceFor(compiled.prepared), descriptor: descriptors.find(entry => entry.engineId === 'worklet-sample') });
  });
  it('authors two meaningful axes per supported family without claiming listening qualification', () => {
    expect(AUTHORED_PATCH_NEIGHBORHOODS).to.have.length(5);
    for (const neighborhood of AUTHORED_PATCH_NEIGHBORHOODS) {
      expect(neighborhood.axes).to.have.length(2); expect(neighborhood.qualification).to.include('awaiting-listening'); expect(Object.isFrozen(neighborhood.axes)).to.equal(true);
    }
  });
  for (const engineId of ['native-fm', 'native-modal', 'worklet-pluck', 'worklet-sample', 'worklet-wind']) {
    it('records a deterministic 64-seed definition corpus and exact rejections for ' + engineId, async () => {
      const parent = parents.get(engineId), before = JSON.stringify(parent), hashes = new Set(), counts = { compiled: 0, rejected: 0, duplicateLike: 0 };
      for (let seed = 0; seed < 64; seed++) {
        const first = await generatePatchNeighborhood({ ...parent, seed, count: 1 });
        const repeated = await generatePatchNeighborhood({ ...parent, seed, count: 1 });
        expect(repeated).to.deep.equal(first);
        for (const key of Object.keys(counts)) counts[key] += first.counts[key];
        const candidate = first.candidates[0];
        if (candidate.state === 'compiled') {
          hashes.add(JSON.stringify(candidate.reference.definition.parameters));
          expect(candidate.qualification).to.equal('compiled-data-not-render-qualified');
          expect(candidate.compiled.compilerRevision).to.equal('typed-recipes-v14');
          expect(candidate.reference.definition.macros).to.deep.equal(parent.reference.definition.macros);
          expect(candidate.reference.definition.causalBindings).to.deep.equal(parent.reference.definition.causalBindings);
          expect(candidate.reference.definition.voicePolicy).to.deep.equal(parent.reference.definition.voicePolicy);
          expect(candidate.reference.definition.sampleMap).to.deep.equal(parent.reference.definition.sampleMap);
          expect(candidate.reference.definition.seedLayers).to.deep.equal(parent.reference.definition.seedLayers);
          expect(candidate.compiled.prepared.pack.files).to.deep.equal(parent.prepared.pack.files);
          expect(candidate.provenance.changes.every(change => Number.isFinite(change.value))).to.equal(true);
        } else expect(candidate.reason).to.be.a('string').and.not.equal('');
      }
      expect(counts.compiled + counts.rejected).to.equal(64); expect(counts.compiled).to.equal(64); expect(hashes.size).to.equal(64);
      expect(JSON.stringify(parent)).to.equal(before);
    });
  }
  it('retains stable slots across batch sizes, bounded seed extremes and input key order', async () => {
    const parent = parents.get('native-fm');
    for (const seed of [-2147483648, 2147483647]) {
      const a = await generatePatchNeighborhood({ ...parent, seed, count: 1, coordinates: { 'glass-size': 0.2, 'hammer-hardness': -0.3 } });
      const b = await generatePatchNeighborhood({ ...parent, seed, count: 4, coordinates: { 'hammer-hardness': -0.3, 'glass-size': 0.2 } });
      expect(a.candidates[0]).to.deep.equal(b.candidates[0]); expect(a.id).to.equal(b.id);
    }
  });
  it('keeps explicit and macro-target locks bit for bit and preserves intentionally duplicate-like candidates', async () => {
    const parent = parents.get('native-fm'), macro = parent.reference.definition.macros[0];
    const batch = await generatePatchNeighborhood({ ...parent, seed: 42, locks: { parameters: ['modulatorRatio'], macros: [macro.id] } });
    expect(batch.counts.compiled).to.equal(4);
    for (const candidate of batch.candidates) for (const parameter of ['modulatorRatio', ...macro.targets.map(target => target.parameter)])
      expect(candidate.reference.definition.parameters[parameter]).to.equal(parent.reference.definition.parameters[parameter]);
    const zero = await generatePatchNeighborhood({ ...parent, amount01: 0 });
    expect(zero.counts).to.include({ compiled: 4, rejected: 0, duplicateLike: 4 });
    for (const candidate of zero.candidates) expect(candidate.reference.definition.parameters).to.deep.equal(parent.reference.definition.parameters);
  });
  it('reloads a resolved fork and provenance after the parent catalog changes without regeneration', async () => {
    const parent = parents.get('worklet-wind'), batch = await generatePatchNeighborhood({ ...parent, seed: 27, count: 1 });
    const candidate = batch.candidates[0], archive = JSON.stringify(candidate.compiled.prepared.pack), savedReference = JSON.parse(JSON.stringify(candidate.reference));
    const changed = structuredClone(parent.prepared.pack); changed.name = 'Changed catalog'; changed.version = '9.0.0';
    await prepareSoundContentPack(changed, { engineDescriptors: descriptors });
    const reopened = await prepareSoundContentPack(JSON.parse(archive), { engineDescriptors: descriptors });
    expect(reopened.contentHash).to.equal(candidate.reference.packHash);
    expect(reopened.patches[0].archivedDefinition).to.deep.equal(savedReference.definition);
    expect(reopened.pack.compilation.artifacts[0].neighborhood).to.deep.equal(candidate.provenance);
    const resolved = await resolveSoundContentReference(savedReference, { engineDescriptors: descriptors, availableHashes: savedReference.assetHashes });
    expect(resolved.status).to.equal('ready');
    expect(reopened.pack.origin.contentHash).to.equal(parent.reference.packHash);
  });
  it('rejects a lock conflicting with the authored contour without changing the parent', async () => {
    const source = structuredClone(parents.get('native-fm').prepared.pack); delete source.compilation;
    source.patches[0].definition.parameters.indexEnd = source.patches[0].definition.parameters.indexStart;
    const prepared = await prepareSoundContentPack(source, { engineDescriptors: descriptors }), reference = referenceFor(prepared), before = JSON.stringify(reference);
    const result = await generatePatchNeighborhood({ prepared, reference, descriptor: parents.get('native-fm').descriptor,
      coordinates: { 'hammer-hardness': 1 }, locks: { parameters: ['indexStart'] }, amount01: 1 });
    expect(result.counts.rejected).to.equal(4); expect(result.candidates.every(candidate => candidate.code === 'constraint-conflict')).to.equal(true);
    expect(JSON.stringify(reference)).to.equal(before);
  });
  it('keeps the generated pack hash through real archive staging when the parent has unused assets and credits', async () => {
    const parent = parents.get('worklet-sample'), pack = structuredClone(parent.prepared.pack), text = 'Unused synthetic fixture terms only.';
    const license = { id: 'unused-fixture', text, url: 'urn:fixture:unused-terms', sha256: await hashDataText(text) };
    pack.licenses.push(license); pack.files.push({ ...pack.files[0], path: 'samples/unused.bin', sha256: 'c'.repeat(64),
      rights: { ...pack.files[0].rights, licenseId: license.id, licenseUrl: license.url, licenseTextHash: license.sha256, declaredUse: 'redistributable' } });
    const prepared = await prepareSoundContentPack(pack, { engineDescriptors: descriptors });
    const batch = await generatePatchNeighborhood({ prepared, reference: referenceFor(prepared), descriptor: parent.descriptor, count: 1 });
    const candidate = batch.candidates[0]; expect(candidate.state).to.equal('compiled'); expect(candidate.compiled.prepared.pack.files).to.have.length(1);
    expect(candidate.reference.assetHashes).to.deep.equal(parent.reference.definition.sampleRefs.map(entry => entry.sha256));
    expect(candidate.compiled.prepared.pack.licenses.some(entry => entry.id === license.id)).to.equal(false);
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const reader = createSoundContentReader({ resourceBudget: budget, jobs }), archiver = createSoundContentArchiver({ resourceBudget: budget, jobs }); let stage;
    try {
      const revised = await revisePatchCandidate({ candidate, descriptor: parent.descriptor, name: 'Kept exact sample revision' });
      expect(revised.reference.definition.sampleMap).to.deep.equal(candidate.reference.definition.sampleMap);
      for (const exact of [candidate, revised]) {
        stage = await stagePreparedSoundContent({ prepared: exact.compiled.prepared, reader, archiver, engineDescriptors: descriptors });
        expect(stage.metadata().contentHash).to.equal(exact.reference.packHash);
        const loan = borrowSoundContentStage(stage); expect(loan.prepared.patches[0].definitionHash).to.equal(exact.reference.definitionHash); loan.release(); stage.discard(); stage = null;
      }
    } finally { stage?.discard(); await reader.dispose()?.completion; await archiver.dispose()?.completion; await jobs.dispose(); admission.dispose(); }
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects invalid controls, unsupported artifacts, unknown locks and compound Circuit parents before publishing', async () => {
    const parent = parents.get('native-fm');
    for (const options of [{ seed: 0.5 }, { seed: 2147483648 }, { amount01: NaN }, { count: 9 }]) await rejected(generatePatchNeighborhood({ ...parent, ...options }), 'invalid-input');
    for (const coordinates of [{ missing: 0 }, { 'glass-size': 1.1 }, []]) await rejected(generatePatchNeighborhood({ ...parent, coordinates }), 'invalid-coordinates');
    for (const locks of [{ parameters: ['missing'] }, { macros: ['missing'] }, { parameters: ['indexStart', 'indexStart'] }, { unknown: [] }]) await rejected(generatePatchNeighborhood({ ...parent, locks }), 'invalid-locks');
    await rejected(generatePatchNeighborhood({ ...parent, descriptor: { ...parent.descriptor, artifactHash: 'c'.repeat(64) } }), 'changed-parent');
    await rejected(generatePatchNeighborhood({ ...parent, neighborhoodId: 'missing' }), 'unsupported-neighborhood');
    const sample = parents.get('worklet-sample'), reference = structuredClone(sample.reference); reference.definition.sampleMap.zones.push({ ...reference.definition.sampleMap.zones[0], id: 'other' });
    await rejected(generatePatchNeighborhood({ ...sample, reference }), 'compound-parent');
  });
  it('counts compiler refusal once per slot and stops at cancellation or stale source boundaries', async () => {
    const parent = parents.get('native-modal'); let calls = 0;
    const batch = await generatePatchNeighborhood({ ...parent, count: 4, compile: async () => { calls++; throw Object.assign(new Error('Resource refused'), { code: 'pressure' }); } });
    expect(calls).to.equal(4); expect(batch.counts).to.deep.equal({ requested: 4, compiled: 0, rejected: 4, duplicateLike: 0 });
    expect(batch.candidates.map(candidate => candidate.code)).to.deep.equal(['pressure', 'pressure', 'pressure', 'pressure']);
    let selected = true;
    await rejected(generatePatchNeighborhood({ ...parent, isCurrent: () => selected, onCandidate: () => { selected = false; } }), 'stale-source');
    const controller = new AbortController(); controller.abort();
    let error; try { await generatePatchNeighborhood({ ...parent, signal: controller.signal }); } catch (failure) { error = failure; } expect(error.name).to.equal('AbortError');
  });
  it('validates retained clamping and rejects altered ancestry, changes or engine requirements on import', async () => {
    const parent = parents.get('native-modal'), batch = await generatePatchNeighborhood({ ...parent, coordinates: { 'strike-hardness': -1 }, amount01: 1, count: 1 });
    const candidate = batch.candidates[0], provenance = structuredClone(candidate.provenance);
    expect(provenance.changes.some(change => change.clamped)).to.equal(true);
    for (const mutate of [value => { value.parent.definitionHash = 'bad'; }, value => { value.seed = Infinity; }, value => { value.changes[0].value += 1; }, value => { value.engineRequirement.artifactHash = 'c'.repeat(64); }]) {
      const changed = structuredClone(provenance); mutate(changed);
      expect(() => validatePatchNeighborhoodProvenance(changed, { definition: candidate.reference.definition, engineRequirement: candidate.reference.engineRequirement })).to.throw();
    }
    const changed = structuredClone(candidate.compiled.prepared.pack); changed.origin.contentHash = 'c'.repeat(64);
    let error; try { await prepareSoundContentPack(changed, { engineDescriptors: descriptors }); } catch (failure) { error = failure; } expect(error).to.be.instanceOf(Error);
    await rejected(createResolvedPatchRecipeSource({ ...parent, candidateId: 'fork', name: 'Fork', parameters: parent.reference.definition.parameters,
      provenance: { ...provenance, parent: { ...provenance.parent, patchId: 'other' } } }), 'invalid-recipe');
  });
});
