import { expect } from 'chai';
import { decomposeSoundSeed } from '../../js/app/resources/SeedDecomposition.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createSoundSeedDerivedOwner } from '../../js/app/midi-ui/SoundSeedDerivedOwner.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { planSoundSourceComparison } from '../../js/app/midi-ui/SoundSourceComparison.js';

const fixture = (kind, frames = 8192) => {
  const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer), sampleRate = 48000;
  for (let frame = 0; frame < frames; frame++) {
    const tone = Math.sin(2 * Math.PI * 750 * frame / sampleRate) * 0.3, value = kind === 'silence' ? 0 : kind === 'impulse' ? frame === 1234 ? 0.75 : 0 : tone + (kind === 'mixed' && frame === 1234 ? 0.5 : 0);
    view.setFloat32(frame * 8, value, true); view.setFloat32(frame * 8 + 4, kind === 'anti-phase' ? -value : value * 0.5, true);
  }
  const manifest = { schema: 'lemmings-sound-seed/v1', frames, sampleRate, tap: 'fixture-frozen-source', bakedEffects: 'none-declared', bakedCausePolicy: 'old-events-are-baked-ancestry-only',
    coverage: { status: 'known-material', gaps: [], frameDomain: 'seed-local-output-frames' }, ancestry: [{ completeParentArtifactHash: 'b'.repeat(64) }] };
  return { pcm, originBytes: canonicalDataText(manifest).bytes, manifest, source: { formatVersion: manifest.schema, sourceFrames: frames, sampleRate, immutableSourceRef: 'a'.repeat(64) }, firstFrame: 0, endFrame: frames, sampleRate, generation: 1 };
};
const input = f => Object.fromEntries(Object.entries(f).filter(([key]) => key !== 'manifest'));
const analyze = f => decomposeSoundSeed(input(f), { estimatedPeakBytes: 256 * 1048576, yieldControl: async () => {} });
const samples = artifact => new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset + 56, artifact.manifest.frames * 8);
const rejection = async (promise, text) => { let error; try { await promise; } catch (caught) { error = caught; } expect(error?.message).to.include(text); };

describe('linked stereo seed decomposition (runtime qualification deferred)', () => {
  for (const kind of ['silence', 'impulse', 'sine', 'mixed', 'anti-phase']) it('retains exact frame alignment and a measured neutral complement for ' + kind, async () => {
    const source = fixture(kind), result = (await analyze(source)).value;
    expect(result.components.map(component => component.kind)).to.deep.equal(['transient-like', 'sustained-like', 'residual']);
    expect(result.recipe).to.include({ fftSize: 2048, hopFrames: 512, observationFrames: 8192, outputDelayFrames: 0 });
    expect(result.recipe.outputCropFrames).to.deep.equal([0, 8192]); expect(result.reconstruction.maximumAbsoluteError).to.be.lessThan(1e-6);
    const views = result.components.map(samples), original = new DataView(source.pcm.buffer), recombined = samples(result.recombined);
    for (let frame = 0; frame < source.endFrame; frame++) for (let channel = 0; channel < 2; channel++) {
      const at = frame * 8 + channel * 4, sum = views.reduce((value, view) => value + view.getFloat32(at, true), 0);
      expect(Math.abs(sum - original.getFloat32(at, true))).to.be.lessThan(1e-6); expect(Math.abs(recombined.getFloat32(at, true) - original.getFloat32(at, true))).to.be.lessThan(1e-6);
      if (kind === 'anti-phase') for (const view of views) expect(Math.abs(view.getFloat32(frame * 8, true) + view.getFloat32(frame * 8 + 4, true))).to.be.lessThan(1e-6);
    }
    for (const component of [...result.components, result.recombined]) {
      expect(component.manifest.ancestry.at(-1).completeParentArtifactHash).to.equal('a'.repeat(64));
      expect(component.manifest.frames).to.equal(source.endFrame); expect(component.manifest.physicalTakeEvidence).to.equal(false);
      expect(component.waveform.minMax.every(Number.isFinite)).to.equal(true);
    }
  });
  it('rejects insufficient workspace, invalid masks and stale generations', async () => {
    const source = fixture('sine');
    await rejection(decomposeSoundSeed(input(source), { estimatedPeakBytes: 4096 }), 'workspace');
    await rejection(decomposeSoundSeed({ ...input(source), options: { sustainedMargin: 0.5 } }, { estimatedPeakBytes: 256 * 1048576 }), 'mask margin');
    let current = true;
    await rejection(decomposeSoundSeed(input(source), { estimatedPeakBytes: 256 * 1048576, current: () => current, yieldControl: async () => { current = false; } }), 'generation changed');
    const gap = fixture('impulse'); gap.manifest.coverage.status = 'missing-source-region'; gap.originBytes = canonicalDataText(gap.manifest).bytes;
    await rejection(analyze(gap), 'complete frozen material');
  });
  it('preserves a previous derived result on cancellation and retires source, component and waveform reservations', async () => {
    const budget = createResourceBudget(), source = fixture('mixed'), bytes = encodeOwnedAudioWav(source.pcm, source.endFrame, source.sampleRate, source.manifest);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const artifact = prepareExportArtifact({ bytes, immutableSourceRef: hash, formatVersion: source.manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'fixture.wav', budgetAdapter: budget });
    const candidate = { artifact, manifest: source.manifest, metadata: () => ({ assetReady: artifact.metadata().retained, assetHash: hash }) };
    const jobs = { async compute(spec) {
      let phase = 'computed'; const prepared = await spec.prepareInput();
      try { const result = await decomposeSoundSeed(prepared, { estimatedPeakBytes: spec.estimatedPeakBytes, signal: spec.signal, current: spec.isCurrent, yieldControl: async () => {} }); await spec.releasePreparedInput();
        return { value: result.value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { phase = 'released'; }, retirementState: () => ({ phase }) };
      } catch (error) { await spec.releasePreparedInput(); error.backgroundRetirement = { phase: 'canceled' }; throw error; }
    } };
    const owner = createSoundSeedDerivedOwner({ resourceBudget: budget, jobs }); await owner.prepare(candidate);
    const previous = owner.component('sustained-like').metadata().assetHash; expect(owner.component('neutral-recombined').metadata().assetReady).to.equal(true);
    await rejection(owner.prepare(candidate, { isCurrent: () => false }), 'generation changed'); expect(owner.component('sustained-like').metadata().assetHash).to.equal(previous);
    expect(artifact.metadata().activeLeases).to.equal(0); const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete');
    artifact.discard(); await artifact.digest(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('plans dry component comparison at source rate independently from the new instrument controls', () => {
    const ref = { kind: 'sample', contentHash: 'a'.repeat(64), bytes: 1000, frames: 10000, sourceSampleRate: 48000 }, pin = { ref, isActive: () => true };
    const plan = planSoundSourceComparison({ engineId: 'worklet-sample', parameters: { sampleLowpassHz: 250 }, sampleRefs: [{ sha256: ref.contentHash, bytes: ref.bytes }] }, pin, 'original');
    expect(plan.source.rateRatio).to.equal(1); expect(plan.source.onsetFrame).to.equal(0); expect(plan.resolution.patch.engineId).to.equal('native-sample');
  });
});
