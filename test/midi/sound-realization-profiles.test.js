import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent, reviewSoundContentChanges } from '../../js/midi/content/SoundContentCompiler.js';
import { prepareSoundContentPack } from '../../js/midi/content/SoundContentPack.js';
import { compileSoundRealizationGroups, planAuthoredSoundRealization, SOUND_REALIZATION_SCHEMA } from '../../js/midi/content/SoundRealizationProfiles.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createSoundContentArchiver } from '../../js/app/midi-ui/SoundContentArchive.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';

const rejects = async (promise, fragment) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.message).to.include(fragment); };
const author = (recipeId, id, fallbackProfileId = null, changedAudibleProperties = []) => ({ id, recipeId, algorithmRevision: 'native-oscillator-authored-v1', preservedInvariants: ['one-owned-source', 'same-pitch-interface'], changedAudibleProperties, fallbackProfileId });
const group = () => ({ schema: SOUND_REALIZATION_SCHEMA, id: 'fixture.triangle-profiles', defaultProfileId: 'original', requiredInvariants: ['one-owned-source', 'same-pitch-interface'], profiles: [
  author('foundation.soft-triangle', 'original', 'quieter'), author('foundation.quieter-triangle', 'quieter', null, ['Explicitly lower output gain; no automatic level matching or CPU claim.'])
], transitions: [{ from: 'original', to: 'quieter', boundary: 'next-onset-only', overlapPolicy: 'old-tail-plus-new-charged-separately' }], singleProfileLimit: null });

describe('authored sound realization profiles (runtime qualification deferred)', () => {
  let source, targets;
  before(async () => {
    source = JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8'));
    source.recipes.push({ id: 'foundation.quieter-triangle', revision: 1, extends: 'foundation.soft-triangle', name: 'Explicitly quieter triangle', components: [{ id: 'output', role: 'output', parameters: { gain01: { value: 0.25, unit: 'amplitude-linear' } } }] });
    targets = (await describeNativeInstrumentEngines(['native-oscillator', 'native-sample', 'worklet-sine'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })))).map(descriptor => ({ descriptor }));
  });
  const compile = raw => compileSoundContent(raw, { targets });
  it('pins real alternatives while keeping requests, prepared sound, effective admission and evidence distinct', async () => {
    const legacy = await compile(source), built = await compile({ ...source, realizationGroups: [group()] });
    expect(legacy.compilerRevision).to.equal('typed-recipes-v12'); expect(built.compilerRevision).to.equal('typed-recipes-v13');
    const compiled = built.realizationGroups[0], selected = compiled.profiles.find(profile => profile.id === 'quieter');
    expect(compiled.profiles).to.have.length(2); expect(selected.patchIdentity).to.equal('foundation.quieter-triangle@1');
    expect(selected.renderKey).to.equal(built.artifacts.find(artifact => artifact.id === 'foundation.quieter-triangle').renderKey);
    expect(selected.qualification).to.include({ automaticAdmission: false, measuredDeviceCost: false, listening: false, numericalEquivalence: false });
    const request = planAuthoredSoundRealization(compiled, 'quieter'); expect(request).to.include({ requestedProfileId: 'quieter', preparedProfileId: null, effectiveAdmittedProfileId: null, modifiesPhysicalScore: false, status: 'requires-explicit-patch-preparation' });
    expect(legacy.artifacts.map(artifact => artifact.renderKey)).to.deep.equal(built.artifacts.map(artifact => artifact.renderKey)); expect(legacy.prepared.contentHash).not.to.equal(built.prepared.contentHash);
    expect(reviewSoundContentChanges(legacy, built).find(change => change.id === 'foundation.soft-triangle')).to.include({ state: 'render-equivalent', realizationChanged: true });
  });
  it('rejects missing invariants, undeclared sound differences, cycles and unsupported transition shortcuts', async () => {
    for (const mutate of [g => { g.profiles[1].preservedInvariants.pop(); }, g => { g.profiles[1].changedAudibleProperties = []; }, g => { g.profiles[1].fallbackProfileId = 'original'; },
      g => { g.transitions[0].boundary = 'mid-voice-crossfade'; }, g => { g.transitions[0].overlapPolicy = 'free'; }, g => { g.profiles[1].recipeId = 'missing'; }]) {
      const authored = group(); mutate(authored); await rejects(compile({ ...source, realizationGroups: [authored] }), 'realizationGroups');
    }
    const result = await compile(source), inventory = result.prepared.patches.map(patch => ({ definition: patch.definition, engineRequirement: patch.engineRequirement, artifact: result.artifacts.find(artifact => artifact.id === patch.definition.id) }));
    const foreign = structuredClone(inventory); foreign.find(entry => entry.definition.id === 'foundation.quieter-triangle').definition.parameters.maxBendCents = 200;
    await rejects(compileSoundRealizationGroups([group()], foreign), 'semantic input');
  });
  it('rederives imported profile hashes, dimensions and evidence state from the archived actual definitions', async () => {
    const result = await compile({ ...source, realizationGroups: [group()] });
    for (const mutate of [g => { g.profiles[0].qualification.automaticAdmission = true; }, g => { g.profiles[0].structuralDimensions.modeCount = 1; }, g => { g.profiles[0].definitionHash = 'e'.repeat(64); }, g => { g.profiles[0].engineRequirement.artifactHash = 'f'.repeat(64); }]) {
      const pack = structuredClone(result.prepared.pack); mutate(pack.compilation.realizationGroups[0]); await rejects(prepareSoundContentPack(pack, { engineDescriptors: targets.map(target => target.descriptor) }), 'realizations differ');
    }
    const reread = await prepareSoundContentPack(result.prepared.pack, { engineDescriptors: targets.map(target => target.descriptor) }); expect(reread.contentHash).to.equal(result.prepared.contentHash);
  });
  it('does not export a group that advertises an absent alternative', async () => {
    const result = await compile({ ...source, realizationGroups: [group()] }), budget = createResourceBudget(), jobs = createTestBackgroundJobs(), archive = createSoundContentArchiver({ resourceBudget: budget, jobs });
    const exported = await archive.prepareExport({ prepared: result.prepared, selection: ['foundation.soft-triangle@3'], mode: 'reference-only' }), loan = exported.artifact.borrow();
    const bytes = new Uint8Array(await loan.blob.arrayBuffer()), length = new DataView(bytes.buffer).getUint32(8, false), header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
    expect(header.pack.compilation.realizationGroups).to.deep.equal([]); expect(header.pack.patches).to.have.length(1);
    loan.release(); exported.artifact.discard(); await exported.artifact.digest(); archive.dispose(); jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
