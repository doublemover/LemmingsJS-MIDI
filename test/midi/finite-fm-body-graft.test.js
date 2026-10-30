import { prepareGraftComparison } from '../../js/midi/content/GraftComparison.js';
import { validateInstrumentPatchV2 } from '../../js/midi/content/InstrumentPatchV2.js';
import { expect } from 'chai';
import { bakeFiniteFmExcitation, FINITE_FM_EXCITER } from '../../js/app/resources/FiniteFmExcitation.js';
import { createFiniteFmBodyGraftRecipe } from '../../js/midi/content/FiniteFmBodyGraftRecipe.js';
import { createSoundSeedInstrumentOwner } from '../../js/app/midi-ui/SoundSeedInstrumentOwner.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { inspectOwnedSoundSeedHeader, inspectOwnedSoundSeedOrigin } from '../../js/app/midi-ui/OwnedSoundSeedSource.js';
import { canonicalDataText, hashDataText } from '../../js/core/CanonicalData.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';

const h = value => value.repeat(64), digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const parent = () => ({ schema: 'lemmings-sound-seed/v1', revision: 'fixture-v1', frames: 12000, sampleRate: 32000, channels: 2, tap: 'post-protection-shared-browser-master', bakedEffects: 'all-original-master-effects-and-protection', bakedCausePolicy: 'baked-only;no-new-semantic-events', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: h('b'), takeId: 'actual-take', takeRevision: 3, parentManifestHash: h('c'), immutableSourceRef: 'master-a', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-shared-browser-master' }] });
const input = sampleRate => ({ parentManifest: parent(), parentAssetHash: h('a'), sampleRate }), options = { estimatedPeakBytes: 32 * 1048576, yieldControl: async () => {} };
const refusal = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };

describe('original finite FM excitation and ordinary body graft (qualification deferred)', function() {
  this.timeout(120000);
  for (const rate of [44100, 48000, 96000]) it('prepares exactly twelve ms with fixed peak, finite stereo and actual ancestry rate at ' + rate, async () => {
    const result = await bakeFiniteFmExcitation(input(rate), options), header = inspectOwnedSoundSeedHeader(result.bytes.subarray(0, 56), result.bytes.length), manifest = inspectOwnedSoundSeedOrigin(result.bytes.subarray(header.metadataOffset), result.manifest);
    expect(header.frames).to.equal(Math.ceil(rate * 0.012)); expect(header.sampleRate).to.equal(rate); expect(result.assetHash).to.equal(await digest(result.bytes)); expect(manifest).to.be.instanceOf(Uint8Array);
    expect(result.manifest.ancestry.at(-1)).to.include({ parentSampleRate: 32000, firstFrame: 0, endFrame: 12000 }); expect(result.manifest.derivedTransform.parentRole).to.include('parent-PCM-not-read-or-played'); expect(result.manifest.bakedEffects).to.equal('none-declared');
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset + 56, header.frames * 8); let sum = 0;
    for (let frame = 0; frame < header.frames; frame++) { const value = view.getFloat32(frame * 8, true); expect(Number.isFinite(value)).to.equal(true); expect(Math.abs(value)).to.be.at.most(FINITE_FM_EXCITER.maximumPeak); expect(value).to.equal(view.getFloat32(frame * 8 + 4, true)); sum += value; }
    expect(view.getFloat32(0, true)).to.equal(0); expect(Math.abs(view.getFloat32((header.frames - 1) * 8, true))).to.be.below(1e-12); expect(Math.abs(sum / header.frames)).to.be.below(1e-7);
  });
  it('compiles exact finite support, independent dry/body controls and positive wood loss', async () => {
    const material = await bakeFiniteFmExcitation(input(48000), options), recipe = await createFiniteFmBodyGraftRecipe({ manifest: material.manifest, assetHash: material.assetHash, byteLength: material.bytes.length, graftBody: 'wood', pitch: { mode: 'pitched', rootCents: 6000 } }), descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: h('d') }]), compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0].definition;
    expect(patch.engineId).to.equal('worklet-sample'); expect(patch.parameters).to.include({ graftSupportSeconds: 0.012, graftModeCount: 4, graftT60Seconds: 0.25, attackSeconds: 0 }); expect(patch.macros.map(macro => macro.name)).to.deep.equal(['EXCITE', 'BODY', 'DAMP', 'MIX'].sort()); expect(patch.sampleMap.zones[0]).to.include({ pitchTracking: 'fixed', loop: null }); expect(patch.sampleRefs[0].sha256).to.equal(material.assetHash); expect(recipe.contractHash).to.equal(await hashDataText(recipe.contractText)); expect(recipe.contract.exciter.parentAssetHash).to.equal(h('a')); expect(recipe.source.pack.name).to.include('Felt lightning');
    const forged = structuredClone(material.manifest); forged.derivedTransform.generator.carrierHz = 880; expect((await refusal(() => createFiniteFmBodyGraftRecipe({ manifest: forged }))).message).to.include('exact prepared');
  });
  it('compares fixed-gain dry/body readouts without changing excitation, loss or the immutable patch', async () => {
    const material = await bakeFiniteFmExcitation(input(48000), options), recipe = await createFiniteFmBodyGraftRecipe({ manifest: material.manifest, assetHash: material.assetHash, byteLength: material.bytes.length, graftBody: 'wood', pitch: { mode: 'pitched', rootCents: 6000 } }), descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: h('d') }]), compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0].definition, original = canonicalDataText(patch).text;
    for (const mode of ['exciter-only', 'body-only']) { const readout = await prepareGraftComparison(patch, mode), validated = validateInstrumentPatchV2(readout.definition, descriptors[0]); expect(validated.parameters.graftMix01).to.equal(mode === 'exciter-only' ? 0 : 1); expect(validated.parameters.graftT60Seconds).to.equal(patch.parameters.graftT60Seconds); expect(validated.parameters.graftEnergyBudget).to.equal(patch.parameters.graftEnergyBudget); expect(validated.parameters.graftSupportSeconds).to.equal(0.012); expect(validated.parameters.gain01).to.equal(patch.parameters.gain01); expect(readout.comparison.level).to.include('no-loudness-normalization'); expect(readout.comparison.originalDefinitionHash).not.to.equal(readout.comparison.definitionHash); expect(validated.macros.every(macro => macro.targets.every(target => target.parameter !== 'graftMix01'))).to.equal(true); }
    expect(canonicalDataText(patch).text).to.equal(original); expect(await refusal(() => prepareGraftComparison(patch, 'normalize'))).to.be.instanceOf(Error); expect(await refusal(() => prepareGraftComparison({ ...patch, parameters: { graftModeCount: 0 } }, 'body-only'))).to.be.instanceOf(Error);
  });
  it('rejects missing parents, unsupported rates, stale completion and cancellation', async () => {
    for (const value of [{ ...input(48000), parentAssetHash: null }, input(32000), { ...input(48000), parentManifest: { ...parent(), ancestry: [] } }]) expect(await refusal(() => bakeFiniteFmExcitation(value, options))).to.be.instanceOf(Error);
    const controller = new AbortController(); expect(await refusal(() => bakeFiniteFmExcitation(input(48000), { ...options, signal: controller.signal, yieldControl: async () => controller.abort() }))).to.be.instanceOf(Error);
    let current = true; expect((await refusal(() => bakeFiniteFmExcitation(input(48000), { ...options, current: () => current, yieldControl: async () => { current = false; } }))).message).to.include('ancestry changed');
  });
  it('uses the bounded production worker transport for material preparation', async () => {
    const jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'finite-fm-fixture' }) }); let result;
    try { result = await jobs.compute({ kind: 'bake-finite-fm-exciter', ownerId: 'finite-fm-test', ownerEpoch: 1, sourceRevision: 'parent-a', inputBytes: canonicalDataText(input(48000)).bytes.length, estimatedPeakBytes: 32 * 1048576, maxBytes: 262144, prepareInput: () => input(48000) }); expect(result.receipt).to.include({ kind: 'bake-finite-fm-exciter', method: 'dedicated-worker' }); expect(result.value.manifest.frames).to.equal(576); expect(result.value.assetHash).to.equal(await digest(result.value.bytes)); }
    finally { result?.release(); jobs.dispose(); }
  });
  it('stages a private generated pack atomically and retains the last patch on a failed preparation', async () => {
    const budget = createResourceBudget(), manifest = parent(), bytes = encodeOwnedAudioWav(new Uint8Array(manifest.frames * 8), manifest.frames, manifest.sampleRate, manifest), assetHash = await digest(bytes), artifact = prepareExportArtifact({ bytes, immutableSourceRef: assetHash, formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'parent.wav', budgetAdapter: budget }), candidate = { artifact, manifest, metadata: () => ({ assetReady: artifact.metadata().retained, assetHash }) }, descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: h('d') }]); let rejectBake = false;
    const jobs = { async compute(request) { const value = await request.prepareInput(); let output;
        if (request.kind === 'bake-finite-fm-exciter') { if (rejectBake) throw new Error('material preparation refused'); output = await bakeFiniteFmExcitation(value, options); }
        else if (request.kind === 'compile-sound-content') { const compiled = await compileSoundContent(value, { targets: descriptors.map(descriptor => ({ descriptor })) }); output = { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash }; }
        else if (request.kind === 'parse-json') output = JSON.parse(value);
        else if (request.kind === 'encode-canonical-json') output = canonicalDataText(value).text;
        else if (request.kind === 'asset-hash') { output = await digest(value); if (output !== request.expectedInputHash) throw new Error('content mismatch'); }
        else throw new Error('Unexpected fixture job ' + request.kind);
        let released = false; return { value: output, receipt: { kind: request.kind, method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { released = true; }, retirementState: () => ({ phase: released ? 'released' : 'computed' }) };
      } }, owner = createSoundSeedInstrumentOwner({ resourceBudget: budget, jobs, audio: { createSession() {}, getAudioContext() {} }, getCatalog: async () => ({ descriptors }), onApply() {} });
    try { await owner.prepare(candidate, { transform: 'finite-fm-body-graft', graftBody: 'wood', pitch: { mode: 'pitched', rootCents: 6000 } }); const ready = owner.state(); expect(ready.compiledPatchReady).to.equal(true); expect(ready.recipe.assetHash).not.to.equal(assetHash); expect(ready.recipe.exciter.parentAssetHash).to.equal(assetHash); expect(artifact.metadata().activeLeases).to.equal(0); rejectBake = true; expect((await refusal(() => owner.prepare(candidate, { transform: 'finite-fm-body-graft', graftBody: 'wood', pitch: { mode: 'pitched', rootCents: 6000 } }))).message).to.include('refused'); expect(owner.state().patchIdentity).to.equal(ready.patchIdentity); }
    finally { await owner.dispose().completion; artifact.discard(); await artifact.digest(); } expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
