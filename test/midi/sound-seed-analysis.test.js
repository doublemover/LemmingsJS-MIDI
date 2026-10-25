import { expect } from 'chai';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact, prepareReplayableExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createOwnedSoundSeedSource } from '../../js/app/midi-ui/OwnedSoundSeedSource.js';
import { analyzeSoundSeedWindow } from '../../js/app/resources/SoundSeedWindowAnalysis.js';
import { createSoundSeedAnalysisOwner } from '../../js/app/midi-ui/SoundSeedAnalysisOwner.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const fixture = (budget, { gaps = [], impulse = 128, amplitude = 1, streaming = false } = {}) => {
  const frames = 4096, pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer); view.setFloat32(impulse * 8, amplitude, true); view.setFloat32(impulse * 8 + 4, -amplitude, true);
  const manifest = { schema: 'lemmings-master-pcm/v1', timelineFrames: frames, sampleRate: 48000, sourceStartFrame: 10000, endFrameExclusive: 10000 + frames,
    channels: 2, state: gaps.length ? 'Partial' : 'Ready', terminalAcknowledged: true, gaps, tap: 'post-protection-shared-browser-master', nativeRetirement: 'complete' };
  const bytes = encodeOwnedAudioWav(pcm, frames, 48000, manifest), fields = { immutableSourceRef: 'captured-fixture', formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'fixture.wav' };
  const artifact = streaming ? prepareReplayableExportArtifact({ ...fields, byteLength: bytes.length, openChunks: async function* () {
    for (let start = 0; start < bytes.length; start += 37) yield bytes.slice(start, Math.min(bytes.length, start + 37));
  } }) : prepareExportArtifact({ ...fields, bytes, budgetAdapter: budget });
  let readers = 0;
  const ownedArtifact = streaming ? Object.freeze({ ...artifact, borrow() {
    if (readers) throw new Error('The capture already has one reader.'); const loan = artifact.borrow(); readers++; loan.settlement.then(() => { readers--; }); return loan;
  } }) : artifact;
  return { artifact: ownedArtifact, manifest, bytes };
};
const analyze = (window, fades = {}) => analyzeSoundSeedWindow({ ...window.value, fades }, { estimatedPeakBytes: window.value.pcm.length * 10 + 32 * 1048576, yieldControl: async () => {} });
const discard = async artifact => { artifact.discard(); await artifact.digest(); };

describe('immutable sound-seed source windows and waveform analysis (deferred runtime fixtures)', () => {
  for (const streaming of [false, true]) it('reads exact stereo frame windows from ' + (streaming ? 'replayable capture chunks' : 'a prepared render Blob') + ' and waits for accepted readers', async () => {
    const budget = createResourceBudget(), f = fixture(budget, { streaming }), source = createOwnedSoundSeedSource({ ...f, resourceBudget: budget });
    const window = await source.readWindow({ firstFrame: 100, endFrame: 600 }), raw = window.value.pcm.slice();
    const second = await source.readWindow({ firstFrame: 600, endFrame: 700 }); await second.release().completion;
    const result = await analyze(window, { inFrames: 50, outFrames: 50, law: 'linear' });
    expect(result.value.manifest.statistics).to.include({ rawPeak: 1, stereoCorrelation: -1, silence: false, clippedSamples: 0 });
    expect(result.value.manifest.statistics.peak).to.be.closeTo(28 / 50, 1e-6); expect(window.value.pcm).to.deep.equal(raw);
    expect(result.value.waveform).to.include({ firstParentFrame: 100, endParentFrame: 600, stage: 'raw-source-window-before-baked-fades' });
    const level = result.value.waveform.levels[0]; expect(level.minMax[28 * 4 + 1]).to.equal(1); expect(level.minMax[28 * 4 + 2]).to.equal(-1);
    expect(result.value.manifest.ancestry[0]).to.include({ firstFrame: 100, endFrame: 600, parentTimelineOriginFrame: 10000 });
    const stopped = source.dispose(); await Promise.resolve(); expect(stopped.state).to.equal('retiring');
    await window.release().completion; await stopped.completion; expect(stopped.outcome).to.equal('complete'); await discard(f.artifact);
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('keeps missing source frames explicit through nested sampling while admitting a clean subregion', async () => {
    const budget = createResourceBudget(), f = fixture(budget, { gaps: [{ firstFrame: 10128, lastFrame: 10160, reason: 'transfer-buffer-pressure' }], impulse: 256 });
    const source = createOwnedSoundSeedSource({ ...f, resourceBudget: budget }), window = await source.readWindow({ firstFrame: 100, endFrame: 300 }), first = await analyze(window);
    expect(first.value.manifest.coverage).to.include({ status: 'missing-source-region', frameDomain: 'seed-local-output-frames' });
    expect(first.value.manifest.coverage.gaps[0]).to.include({ firstFrame: 28, endFrame: 60 });
    const asset = prepareExportArtifact({ bytes: first.value.bytes, immutableSourceRef: first.value.assetHash, formatVersion: first.value.manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'frozen.wav', budgetAdapter: budget });
    const frozen = createOwnedSoundSeedSource({ artifact: asset, manifest: first.value.manifest, resourceBudget: budget });
    const bad = await frozen.readWindow({ firstFrame: 20, endFrame: 80 }), nested = await analyze(bad);
    expect(nested.value.manifest.coverage.status).to.equal('missing-source-region'); expect(nested.value.manifest.coverage.gaps[0]).to.include({ firstFrame: 8, endFrame: 40 });
    expect(nested.value.manifest.ancestry).to.have.length(2); await bad.release().completion;
    const good = await frozen.readWindow({ firstFrame: 80, endFrame: 180 }), clean = await analyze(good); expect(clean.value.manifest.coverage.status).to.equal('known-material');
    await good.release().completion; await frozen.dispose().completion; await window.release().completion; await source.dispose().completion;
    await discard(asset); await discard(f.artifact); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('reports clipping without hidden normalization and refuses empty or excessive regions before reading', async () => {
    const budget = createResourceBudget(), f = fixture(budget, { amplitude: 2 }), source = createOwnedSoundSeedSource({ ...f, resourceBudget: budget });
    let rejected; try { await source.readWindow({ firstFrame: 100, endFrame: 100 }); } catch (error) { rejected = error; } expect(rejected).to.be.instanceOf(Error);
    const window = await source.readWindow({ firstFrame: 0, endFrame: 256 }), result = await analyze(window);
    expect(result.value.manifest.statistics).to.include({ peak: 2, clippedSamples: 2 }); expect(result.value.manifest.normalization).to.equal('none');
    await window.release().completion; await source.dispose().completion; await discard(f.artifact); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains independent asset, analysis and durability readiness through nested owner preparation', async () => {
    const budget = createResourceBudget(), f = fixture(budget), jobs = { async compute(spec) {
      const input = await spec.prepareInput(); let phase = 'computed';
      try { const result = await analyzeSoundSeedWindow(input, { estimatedPeakBytes: spec.estimatedPeakBytes, signal: spec.signal, current: spec.isCurrent, yieldControl: async () => {} });
        await spec.releasePreparedInput(); return { value: result.value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { phase = 'released'; }, retirementState: () => ({ phase }) };
      } catch (error) { await spec.releasePreparedInput(); error.backgroundRetirement = { phase: 'canceled' }; throw error; }
    } };
    const owner = createSoundSeedAnalysisOwner({ resourceBudget: budget, jobs }); await owner.selectSource(f);
    const a = await owner.prepare({ firstFrame: 100, endFrame: 600 }); expect(a.metadata()).to.include({ assetReady: true, compiledPatchReady: false, audibleAuditionReady: false, durable: false });
    let bins = 0; a.withWaveform(wave => { bins = wave.levels[0].bins; }); expect(bins).to.equal(500);
    await owner.selectSource({ artifact: a.artifact, manifest: a.manifest }); await discard(f.artifact);
    const b = await owner.prepare({ firstFrame: 10, endFrame: 200 }); expect(b.manifest.ancestry).to.have.length(2);
    expect(b.metadata()).to.include({ frames: 190, assetReady: true, durable: false });
    const stopped = owner.dispose(); await stopped.completion; expect(stopped.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
