import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createSoundSeedDerivedOwner } from '../../js/app/midi-ui/SoundSeedDerivedOwner.js';
import { createSoundSeedLabView } from '../../js/app/midi-ui/SoundSeedLabView.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { inspectSeedDerivedInput, encodeSeedDerivedAudio, seedDigest } from '../../js/app/resources/SoundSeedDerivedAudio.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { hashData, canonicalDataText } from '../../js/core/CanonicalData.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';

// A mechanical ownership/workflow fixture. It deliberately replaces only the
// heavy warp DSP with a declared synthetic output; it establishes no core PCM,
// latency, pitch, device-cost or listening evidence.
const fakeWarp = async input => {
  const source = inspectSeedDerivedInput(input, ['options', 'wasmBytes']), options = input.options, bodyFrames = Math.ceil(source.frames * options.outputRate / source.sampleRate / options.rateRatio), tailFrames = 64, frames = bodyFrames + tailFrames;
  const recipe = { schema: 'lemmings-seed-warp-bake/v1', algorithmRevision: 'direct-core-buffered-finite-warp-bake-v1', parentAssetHash: source.source.immutableSourceRef, coreArtifactHash: OWNED_STRETCH_CORE.wasmSha256, coreConfigurationHash: 'e'.repeat(64), options, bodyFrames, tailFrames, preparedMaterial: { originalRate: source.sampleRate, preparedRate: options.outputRate }, qualification: 'synthetic-workflow-fixture;not-DSP-evidence' }, recipeHash = await hashData(recipe), artifact = await encodeSeedDerivedAudio(new Uint8Array(frames * 8), { ...source, frames, sampleRate: options.outputRate, parentSampleRate: source.sampleRate }, { ...recipe, recipeHash });
  return { value: { schema: 'lemmings-seed-warp-result/v1', generation: input.generation, recipe, recipeHash, components: [{ kind: 'warped-seed', ...artifact }] }, inputBytes: input.pcm.length + input.originBytes.length + input.wasmBytes.length + canonicalDataText({ ...input, pcm: null, originBytes: null, wasmBytes: null }, { maxBytes: 65536, maxNodes: 8192 }).bytes.length, nodes: 4096, retainedBytes: artifact.bytes.length + 1048576 };
};
const fixture = async () => {
  const budget = createResourceBudget(), frames = 4096, sampleRate = 48000, pcm = new Uint8Array(frames * 8); new DataView(pcm.buffer).setFloat32(32 * 8, 0.2, true);
  const manifest = { schema: 'lemmings-sound-seed/v1', frames, sampleRate, channels: 2, tap: 'fixture-seed', coverage: { status: 'known-material', gaps: [] }, bakedEffects: 'none-declared', bakedCausePolicy: 'baked-only', statistics: { peak: 0.2, rms: 0.003, silence: false, clippedSamples: 0, stereoCorrelation: null }, ancestry: [{ completeParentArtifactHash: 'b'.repeat(64), originKind: 'LIVE CAPTURE', sourceTap: 'fixture' }] }, bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, manifest), assetHash = await seedDigest(bytes), artifact = prepareExportArtifact({ bytes, immutableSourceRef: assetHash, formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'fixture.wav', budgetAdapter: budget }), coreArtifact = prepareExportArtifact({ bytes: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes), immutableSourceRef: 'synthetic-core-fixture-only', formatVersion: OWNED_STRETCH_CORE.schema, suggestedFilename: 'core.wasm', budgetAdapter: budget });
  await Promise.all([artifact.digest(), coreArtifact.digest()]); const scope = createProcgenRetirementScope(), coreMaterial = { borrow: async () => coreArtifact.borrow(), state: () => ({ ready: true, active: false, unknownRetirement: 0, error: null }), dispose() { return scope.getReceipt() || scope.retire([{ name: 'fixture-core-material', run: async () => { coreArtifact.discard(); await coreArtifact.digest(); } }]); } };
  const source = { artifact, manifest, metadata: () => ({ assetReady: artifact.metadata().retained, assetHash }) }, jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-warp-workflow-fixture' }), kernel: async (kind, input, options) => kind === 'warp-sound-seed' ? fakeWarp(input) : runBackgroundJobKernel(kind, input, options) });
  return { budget, source, jobs, coreMaterial, coreArtifact, async close() { jobs.dispose(); await coreMaterial.dispose().completion; artifact.discard(); await artifact.digest(); } };
};
const refusal = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
const until = async check => { for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Workflow did not reach its declared boundary.'); };

describe('owned finite warp material workflows (synthetic DSP fixture; acceptance deferred)', function() {
  this.timeout(120000);
  it('publishes actual output-rate/body/tail material only after input/core retirement', async () => {
    const f = await fixture(), owner = createSoundSeedDerivedOwner({ resourceBudget: f.budget, jobs: f.jobs, kind: 'warp', coreMaterial: f.coreMaterial });
    try { const summary = await owner.prepare(f.source, { options: { rateRatio: 0.75, pitchRatio: 2, outputRate: 96000 } }), candidate = owner.component('warped-seed'); expect(summary.schema).to.equal('lemmings-seed-warp-result/v1'); expect(candidate.manifest.sampleRate).to.equal(96000); expect(candidate.manifest.frames).to.equal(Math.ceil(4096 * 2 / 0.75) + 64); expect(candidate.manifest.ancestry.at(-1).parentSampleRate).to.equal(48000); expect(await candidate.artifact.digest()).to.equal(candidate.metadata().assetHash); candidate.withWaveform(wave => expect(wave.endParentFrame).to.equal(candidate.manifest.frames)); expect(f.coreArtifact.metadata().activeLeases).to.equal(0); expect(f.source.artifact.metadata().activeLeases).to.equal(0); expect(summary.evidence).to.include('quality-not-established'); }
    finally { await owner.dispose().completion; await f.close(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('preserves the previous frozen warp while a delayed completed result is canceled', async () => {
    const f = await fixture(); let gated = false, enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; }), jobs = { ...f.jobs, async compute(request) { const result = await f.jobs.compute(request); if (gated && request.kind === 'warp-sound-seed') { enter(); await gate; } return result; } }, owner = createSoundSeedDerivedOwner({ resourceBudget: f.budget, jobs, kind: 'warp', coreMaterial: f.coreMaterial });
    try { await owner.prepare(f.source, { options: { rateRatio: 1, pitchRatio: 1, outputRate: 48000 } }); const previous = owner.component('warped-seed').metadata().assetHash; gated = true; const pending = refusal(() => owner.prepare(f.source, { options: { rateRatio: 0.75, pitchRatio: 2, outputRate: 96000 } })); await entered; owner.cancel(); expect(owner.state().active).to.equal(true); expect(owner.component('warped-seed').metadata().assetHash).to.equal(previous); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); release(); expect(await pending).to.be.instanceOf(Error); expect(owner.component('warped-seed').metadata().assetHash).to.equal(previous); expect(f.coreArtifact.metadata().activeLeases).to.equal(0); }
    finally { release(); await owner.dispose().completion; await f.close(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('selects fixed-rate prepared material explicitly and fences stale controls without enabling audio', async () => {
    const f = await fixture(), dom = new JSDOM('<main id="procgenPresentationRoot"></main>', { pretendToBeVisual: true }), { window } = dom, document = window.document; let enabled = 0;
    const context = new Proxy({ measureText: value => ({ width: String(value).length * 6 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (object, property) => property in object ? object[property] : () => {} }); window.HTMLCanvasElement.prototype.getContext = () => context;
    const audio = { getAudioContext: () => null, getState: () => ({ enabled: false }), getMonitorRouteState: () => ({ mode: 'none', state: 'idle', revision: 0 }), acquireAudition() { enabled++; throw new Error('Audio was not requested.'); }, createSession() { enabled++; throw new Error('Audio was not requested.'); } }, view = createSoundSeedLabView({ document, window, audio, resourceBudget: f.budget, jobs: f.jobs, coreMaterial: f.coreMaterial, onApply() {} });
    const button = text => [...document.querySelectorAll('button')].find(element => element.textContent === text);
    try { await view.open(f.source); button('Freeze selected region').click(); await until(() => view.state().candidateDraft >= 0 && !button('Prepare finite time/pitch material').disabled); const output = document.querySelector('[aria-label="Prepared material sample rate"]'); output.value = '96000'; output.dispatchEvent(new window.Event('change')); button('Prepare finite time/pitch material').click(); await until(() => view.state().warpCurrent && !button('Use warped material · fixed-rate source').disabled); expect(view.state().warpCurrent).to.equal(true); button('Use warped material · fixed-rate source').click(); expect(view.state().derivedSelection).to.equal('warped-seed'); expect(document.querySelector('[aria-label="Pitch declaration"]').value).to.equal('unpitched'); expect(view.state().instrument.compiledPatchReady).to.equal(false); const rate = document.querySelector('[aria-label="Prepared traversal rate"]'); rate.value = '0.75'; rate.dispatchEvent(new window.Event('change')); expect(view.state().warpCurrent).to.equal(false); await until(() => button('Use warped material · fixed-rate source').disabled); expect(enabled).to.equal(0); }
    finally { await view.dispose().completion; await f.close(); window.close(); } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
