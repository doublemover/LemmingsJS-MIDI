import { expect } from 'chai';
import { composeSeedComponents, prepareSeedComponentComposition, SEED_COMPONENT_KINDS } from '../../js/app/resources/SeedComponentComposition.js';
import { decomposeSoundSeed } from '../../js/app/resources/SeedDecomposition.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createSoundSeedDerivedOwner } from '../../js/app/midi-ui/SoundSeedDerivedOwner.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fixture = async () => {
  const frames = 1024, sampleRate = 48000, pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer);
  for (let frame = 0; frame < frames; frame++) { const value = Math.sin(frame * 0.13) * 0.2 + (frame === 500 ? 0.4 : 0); view.setFloat32(frame * 8, value, true); view.setFloat32(frame * 8 + 4, -value * 0.6, true); }
  const manifest = { schema: 'lemmings-sound-seed/v1', frames, sampleRate, tap: 'source-dry', bakedEffects: 'original-printed-FX', bakedCausePolicy: 'ancestry-only', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: 'b'.repeat(64) }] };
  const bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, manifest), assetHash = await digest(bytes);
  return { bytes, manifest, assetHash, input: { pcm, originBytes: canonicalDataText(manifest).bytes, source: { formatVersion: manifest.schema, sourceFrames: frames, sampleRate, immutableSourceRef: assetHash }, firstFrame: 0, endFrame: frames, sampleRate, generation: 1 } };
};
const analyze = async input => (await decomposeSoundSeed({ ...input, options: { fftSize: 512, temporalWidth: 3, frequencyWidth: 3 } }, { estimatedPeakBytes: 128 * 1048576, yieldControl: async () => {} })).value;
const compositionInput = (input, analyzed, options = {}) => ({ ...input, options, componentInputs: analyzed.components.map(entry => ({
  pcm: entry.bytes.slice(56, 56 + input.pcm.length), originBytes: canonicalDataText(entry.manifest).bytes,
  source: { formatVersion: entry.manifest.schema, sourceFrames: entry.manifest.frames, sampleRate: entry.manifest.sampleRate, immutableSourceRef: entry.assetHash },
  firstFrame: 0, endFrame: entry.manifest.frames, sampleRate: entry.manifest.sampleRate, generation: input.generation
})) });
const compose = input => composeSeedComponents(input, { estimatedPeakBytes: 128 * 1048576, yieldControl: async () => {} });
const rejects = async (promise, fragment) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.message).to.include(fragment); };

describe('explicit printed seed component composition (runtime acceptance deferred)', () => {
  it('preserves the exact neutral PCM sum and separates creative output, source ancestry and branch processing', async () => {
    const f = await fixture(), analyzed = await analyze(f.input), input = compositionInput(f.input, analyzed), neutral = (await compose(input)).value;
    const output = neutral.components[0];
    expect(output.bytes.slice(56, 56 + f.input.pcm.length)).to.deep.equal(analyzed.recombined.bytes.slice(56, 56 + f.input.pcm.length));
    expect(neutral.recipe.mode).to.equal('neutral-recombination'); expect(neutral.recipe.semanticOnsetsAdded).to.equal(0);
    expect(output.manifest.bakedEffects).to.equal(f.manifest.bakedEffects); expect(neutral.reconstruction.maximumAbsoluteError).to.be.lessThan(1e-6);
    const creative = (await compose({ ...input, options: { solo: 'transient-like', transientGain: 0.5, outputGain: 0.5 } })).value, originalTransient = new DataView(input.componentInputs[0].pcm.buffer), printed = new DataView(creative.components[0].bytes.buffer, 56);
    for (let frame = 0; frame < f.manifest.frames; frame++) for (let channel = 0; channel < 2; channel++) expect(printed.getFloat32(frame * 8 + channel * 4, true)).to.equal(Math.fround(originalTransient.getFloat32(frame * 8 + channel * 4, true) * 0.25));
    expect(creative.recipe.parentPrintedEffects).to.equal('original-printed-FX'); expect(creative.components[0].manifest.bakedEffects).to.include('printed-component-composition');
    expect(creative.reconstruction).to.deep.equal(neutral.reconstruction); expect(creative.recipe.creativeDifference.rmsDifference).to.be.greaterThan(0);
    expect(creative.recipe.componentAssetHashes).to.deep.equal(Object.fromEntries(analyzed.components.map(entry => [entry.kind, entry.assetHash])));
    expect((await compose(input)).value.components[0].assetHash).to.equal(output.assetHash);
  });
  it('records causal filter crop/terminal state, makes mute silent and rejects hidden option or rate changes', async () => {
    const f = await fixture(), input = compositionInput(f.input, await analyze(f.input));
    const filtered = (await compose({ ...input, options: { transientDrive: 2, sustainedLowpassHz: 1000, residualHighpassHz: 100 } })).value;
    expect(filtered.recipe.filterTail).to.include({ truncationPossible: true, policy: 'cropped-at-exact-frozen-end;extend-source-selection-explicitly' }); expect(filtered.recipe.filterTail.terminalState).to.have.length(6);
    const muted = (await compose({ ...input, options: { transientGain: 0, sustainedGain: 0, residualGain: 0 } })).value;
    expect(muted.components[0].manifest.statistics.peak).to.equal(0); expect(muted.reconstruction.sourceRms).to.be.greaterThan(0);
    expect(() => prepareSeedComponentComposition({ limiter: true })).to.throw('bounded explicit');
    expect(() => prepareSeedComponentComposition({ sustainedLowpassHz: 6000 }, 8000)).to.throw('source-rate domain');
  });
  it('declines mixed analysis parents, shifted crops, missing branches and stale work without repairing alignment', async () => {
    const f = await fixture(), input = compositionInput(f.input, await analyze(f.input));
    await rejects(compose({ ...input, componentInputs: input.componentInputs.slice(1) }), 'all three');
    const changed = structuredClone(input), origin = JSON.parse(new TextDecoder().decode(changed.componentInputs[1].originBytes)); origin.derivedTransform.outputDelayFrames = 1; changed.componentInputs[1].originBytes = canonicalDataText(origin).bytes;
    await rejects(compose(changed), 'delay or exact crop');
    const reordered = { ...input, componentInputs: [...input.componentInputs].reverse() }; await rejects(compose(reordered), 'delay or exact crop');
    let current = true; await rejects(composeSeedComponents(input, { estimatedPeakBytes: 128 * 1048576, current: () => current, yieldControl: async () => { current = false; } }), 'generation changed');
    await rejects(composeSeedComponents(input, { estimatedPeakBytes: 1024 }), 'admitted input/output');
  });
  it('owns all four input windows and preserves the last composition through canceled preparation', async () => {
    const f = await fixture(), budget = createResourceBudget(), artifact = prepareExportArtifact({ bytes: f.bytes, immutableSourceRef: f.assetHash, formatVersion: f.manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'seed.wav', budgetAdapter: budget });
    const parent = { artifact, manifest: f.manifest, metadata: () => ({ assetReady: artifact.metadata().retained, assetHash: f.assetHash }) };
    const jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) });
    const decomposed = createSoundSeedDerivedOwner({ resourceBudget: budget, jobs }), composed = createSoundSeedDerivedOwner({ resourceBudget: budget, jobs, kind: 'composition' });
    await decomposed.prepare(parent, { options: { fftSize: 512, temporalWidth: 3, frequencyWidth: 3 } });
    const componentCandidates = SEED_COMPONENT_KINDS.map(kind => decomposed.component(kind)); await composed.prepare(parent, { componentCandidates });
    const previous = composed.component('component-composition').metadata().assetHash;
    await rejects(composed.prepare(parent, { componentCandidates, isCurrent: () => false }), 'generation changed'); expect(composed.component('component-composition').metadata().assetHash).to.equal(previous);
    for (const candidate of [parent, ...componentCandidates]) expect(candidate.artifact.metadata().activeLeases).to.equal(0);
    for (const owner of [composed, decomposed]) { const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); }
    jobs.dispose(); artifact.discard(); await artifact.digest(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
