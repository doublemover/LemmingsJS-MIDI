import { expect } from 'chai';
import { createSoundSeedRecipe } from '../../js/midi/content/SoundSeedRecipe.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { prepareOwnedSamplePlan } from '../../js/app/midi-ui/OwnedSamplePlan.js';
import { createOwnedPcmSetDescriptor } from '../../js/app/resources/OwnedPcmSetVerification.js';
import { createSoundSeedInstrumentOwner } from '../../js/app/midi-ui/SoundSeedInstrumentOwner.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';

const h = 'a'.repeat(64), parent = 'b'.repeat(64);
const origin = () => ({ schema: 'lemmings-sound-seed/v1', frames: 24000, sampleRate: 48000, bakedEffects: 'all-original-master-effects-and-protection',
  coverage: { status: 'known-material', gaps: [] }, statistics: { clippedSamples: 0, silence: false }, ancestry: [{ completeParentArtifactHash: parent, takeId: 'take-a', takeRevision: 4,
    parentManifestHash: 'c'.repeat(64), immutableSourceRef: 'master-a', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-shared-browser-master' }] });
const rejected = async (promise, text) => { let caught; try { await promise; } catch (error) { caught = error; } expect(caught?.message).to.include(text); };

describe('frozen sound-seed recipes and instrument preparation (runtime acceptance deferred)', () => {
  let descriptors;
  before(async () => { descriptors = await describeNativeInstrumentEngines(['worklet-sample', 'worklet-granular'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'd'.repeat(64) }))); });
  const compile = source => compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
  it('compiles fixed-rate hammer and phrase seeds with playable PCM independent from raw ancestors', async () => {
    for (const transform of ['hammer-seed', 'route-relic']) {
      const first = await createSoundSeedRecipe({ manifest: origin(), assetHash: h, byteLength: 200000, transform });
      const same = await createSoundSeedRecipe({ manifest: origin(), assetHash: h, byteLength: 200000, transform });
      expect(first.contractHash).to.equal(same.contractHash); expect(first.contract.pitchDeclaration).to.deep.equal({ mode: 'unpitched' });
      expect(first.source.files.every(file => file.parents.length === 0)).to.equal(true);
      const output = await compile(first.source), patch = output.prepared.patches[0].definition;
      expect(patch.engineId).to.equal('worklet-sample'); expect(patch.sampleMap.zones[0]).to.include({ pitchTracking: 'fixed', loop: null });
      expect(patch.macros.map(macro => macro.id)).to.deep.equal(['body', 'grain-edge', 'damp'].sort());
      expect(first.contract.warnings.join(' ')).to.include('printed'); expect(output.prepared.pack.files.some(file => file.sha256 === parent)).to.equal(false);
      const bank = { schema: 'lemmings-owned-pcm-bank/v1', assetHash: h, pcmHash: h, bankHash: h, format: 'float32-planar-le', sourceFrames: 24000, sourceSampleRate: 48000,
        frames: 24000, sampleRate: 48000, channels: 2, bytes: 24000 * 8, decoderVersion: 'fixture', peak: 0.5, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' };
      const plan = prepareOwnedSamplePlan(patch, await createOwnedPcmSetDescriptor([bank]), 48000);
      for (const cents of [3600, 6000, 8400]) expect(plan.select({ version: 1, kind: 'begin', generation: 1, onsetId: 'new-' + cents, pitch: { cents }, velocity01: 0.7 }).readDerivative).to.equal(1);
      expect(first.contract.newOnsets).to.include('old-events-are-baked-ancestry-only');
    }
  });
  it('keeps granular root and control ranges explicit and binds recipe identity to transform and pitch', async () => {
    const options = { manifest: origin(), assetHash: h, byteLength: 200000, transform: 'ice-dust', pitch: { mode: 'pitched', rootCents: 6000 } };
    const first = await createSoundSeedRecipe(options), output = await compile(first.source);
    expect(output.prepared.patches[0].definition.engineId).to.equal('worklet-granular');
    expect(output.prepared.patches[0].definition.parameters).to.include({ densityHz: 16, grainMilliseconds: 65 });
    expect(output.prepared.patches[0].definition.macros).to.have.length(4);
    expect((await createSoundSeedRecipe({ ...options, pitch: { mode: 'pitched', rootCents: 6100 } })).contractHash).not.to.equal(first.contractHash);
    await rejected(createSoundSeedRecipe({ ...options, pitch: { mode: 'unpitched' } }), 'requires a declared root');
    await rejected(createSoundSeedRecipe({ ...options, manifest: { ...origin(), coverage: { status: 'missing-source-region', gaps: [] } } }), 'coverage');
  });
  it('verifies a private seed pack, fences stale compilation and retires its artifact readers', async () => {
    const budget = createResourceBudget(), manifest = origin(), bytes = encodeOwnedAudioWav(new Uint8Array(manifest.frames * 8), manifest.frames, manifest.sampleRate, manifest);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const artifact = prepareExportArtifact({ bytes, immutableSourceRef: hash, formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'seed.wav', budgetAdapter: budget });
    const candidate = { artifact, manifest, metadata: () => ({ assetReady: artifact.metadata().retained, assetHash: hash }) };
    const jobs = { async compute(request) {
      const input = await request.prepareInput(); let value;
      if (request.kind === 'compile-sound-content') { const result = await compile(input); value = { pack: result.prepared.pack, contentHash: result.prepared.contentHash }; }
      else if (request.kind === 'parse-json') value = JSON.parse(input);
      else if (request.kind === 'encode-canonical-json') value = canonicalDataText(input).text;
      else if (request.kind === 'asset-hash') { const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (digest !== request.expectedInputHash) throw new Error('fixture hash mismatch'); value = digest; }
      else throw new Error('Unexpected fixture job ' + request.kind);
      let released = false; return { value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { released = true; }, retirementState: () => ({ phase: released ? 'released' : 'retained' }) };
    } };
    let applies = 0;
    const owner = createSoundSeedInstrumentOwner({ resourceBudget: budget, jobs, audio: { createSession() {}, getAudioContext() {} }, getCatalog: async () => ({ descriptors }), onApply: () => { applies++; } });
    await owner.prepare(candidate, { transform: 'hammer-seed' }); expect(owner.state()).to.include({ compiledPatchReady: true, audibleAuditionReady: false, durable: false });
    await rejected(owner.install({ isCurrent: () => false }), 'installation target changed'); await rejected(owner.apply({ isCurrent: () => false }), 'application target changed');
    const previous = owner.state().patchIdentity;
    await rejected(owner.prepare(candidate, { transform: 'route-relic', isCurrent: () => false }), 'draft changed');
    expect(owner.state().patchIdentity).to.equal(previous); await rejected(owner.apply(), 'Commit this staged pack'); expect(applies).to.equal(0);
    expect(artifact.metadata().activeLeases).to.equal(0); const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete');
    artifact.discard(); await artifact.digest(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
