import { expect } from 'chai';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createSoundSeedAnalysisOwner } from '../../js/app/midi-ui/SoundSeedAnalysisOwner.js';
import { createSoundSeedDerivedOwner } from '../../js/app/midi-ui/SoundSeedDerivedOwner.js';
import { createSoundSeedInstrumentOwner } from '../../js/app/midi-ui/SoundSeedInstrumentOwner.js';
import { createSoundSeedRebuildOwner } from '../../js/app/midi-ui/SoundSeedRebuildOwner.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { planSoundSeedRebuild } from '../../js/midi/content/SoundSeedRebuildPlan.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';

const refused = async (promise, message) => { let error; try { await promise; } catch (caught) { error = caught; } expect(error?.message).to.include(message); return error; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = async () => {
  const budget = createResourceBudget(), artifacts = [], owners = [], calls = []; let before = async () => {}, revision = 1, applied = 0;
  const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'e'.repeat(64) }]);
  const jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'rebuild-ownership-fixture' }), async kernel(kind, input, options) {
    calls.push(kind); await before(kind, input);
    if (kind !== 'compile-sound-content') return runBackgroundJobKernel(kind, input, { ...options, yieldControl: async () => {} });
    const result = await compileSoundContent(input, { targets: descriptors.map(descriptor => ({ descriptor })) });
    const value = { pack: result.prepared.pack, contentHash: result.prepared.contentHash };
    const encoded = canonicalDataText(input); return { value, inputBytes: encoded.bytes.length, nodes: encoded.nodes, retainedBytes: canonicalDataText(value).bytes.length * 4 };
  } });
  const source = (amplitude, change = {}) => {
    const manifest = { schema: 'lemmings-causal-audio-render/v1', operation: 'sound-only-revoice', takeId: 'shared-take', takeRevision: 4, sourceCanonicalHash: 'a'.repeat(64),
      frames: 4096, sampleRate: 48000, channels: 2, sampleFormat: 'ieee-float32-le', timelineZeroSourceFrame: 0, tap: 'source-dry', tail: { mode: 'exact-crop', truncated: false },
      definitionHash: (amplitude === 0.3 ? 'b' : 'c').repeat(64), engineRequirement: { engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'd'.repeat(64), parameterSchemaHash: 'f'.repeat(64) }, ...change };
    const pcm = new Uint8Array(manifest.frames * 8), samples = new DataView(pcm.buffer);
    for (let frame = 0; frame < manifest.frames; frame++) { const value = amplitude * Math.exp(-Math.log(1000) * frame / 48000 / 0.08) * Math.cos(2 * Math.PI * 750 * frame / 48000);
      samples.setFloat32(frame * 8, value, true); samples.setFloat32(frame * 8 + 4, value * 0.7, true); }
    const bytes = encodeOwnedAudioWav(pcm, manifest.frames, manifest.sampleRate, manifest), artifact = prepareExportArtifact({ bytes,
      immutableSourceRef: 'same-visible-source-label', formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'revoice.wav', budgetAdapter: budget });
    artifacts.push(artifact); return { artifact, manifest };
  };
  const own = owner => { owners.push(owner); return owner; }, audio = { createSession() {}, getAudioContext() {} }, getCatalog = async () => ({ descriptors });
  const analysis = own(createSoundSeedAnalysisOwner({ resourceBudget: budget, jobs })), original = source(0.3), replacement = source(0.5);
  await analysis.selectSource(original); await analysis.prepare({ firstFrame: 0, endFrame: 4096, fades: { inFrames: 0, outFrames: 0 } }); const seed = analysis.candidate();
  const rebuild = () => own(createSoundSeedRebuildOwner({ resourceBudget: budget, jobs, audio, getCatalog, getTargetIdentity: () => ({ projectId: 'selected-project', laneId: 'lane-a', revision }), onApply: () => { applied++; } }));
  return { budget, jobs, calls, source, seed, replacement, original, rebuild, own, getCatalog, audio,
    setBefore(value) { before = value; }, changeTarget() { revision++; }, applied: () => applied,
    async dispose() { before = async () => {}; for (const owner of owners.reverse()) { const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); }
      jobs.dispose(); for (const artifact of artifacts) { artifact.discard(); await artifact.digest(); } expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
};

describe('reviewed derived-branch ownership and real analysis closure', function() {
  this.timeout(30000);
  it('binds complete replacement bytes and manifest, refusing same-label substitutions before scheduling work', async () => {
    const f = await fixture();
    try {
      const plan = await planSoundSeedRebuild(f), owner = f.rebuild(), before = f.calls.length;
      expect(plan.replacementSource.sha256).to.equal(await f.replacement.artifact.digest());
      const changed = f.source(0.7);
      await refused(owner.prepare({ plan, replacement: changed }), 'reviewed plan');
      await refused(owner.prepare({ plan, replacement: { ...f.replacement, manifest: { ...f.replacement.manifest, printedFx: 'changed' } } }), 'reviewed plan');
      expect(f.calls).to.have.length(before); expect(owner.state().summary).to.equal(null); expect(f.seed.metadata().assetReady).to.equal(true);
    } finally { await f.dispose(); }
  });
  it('keeps partial coverage, unknown bytes and incompatible realizations explicit while frozen material remains readable', async () => {
    const f = await fixture();
    try {
      const missingDigest = { ...f.replacement, artifact: { ...f.replacement.artifact, digest: async () => null } };
      expect((await planSoundSeedRebuild({ ...f, replacement: missingDigest })).blockers.some(entry => entry.reason.includes('verified digest'))).to.equal(true);
      for (const change of [{ operation: 'reinterpretation' }, { channels: 1 }, { sampleFormat: 'pcm16' }, { takeRevision: 5 }, { frames: 2048 }, { sampleRate: 96000 }, { tap: 'audition-output' }]) {
        const plan = await planSoundSeedRebuild({ ...f, replacement: { ...f.replacement, manifest: { ...f.replacement.manifest, ...change } } }); expect(plan.state).to.equal('unavailable');
      }
      const partial = { ...f.seed, manifest: { ...f.seed.manifest, coverage: { status: 'partial', gaps: [{ firstFrame: 100, endFrame: 200 }] } } };
      expect((await planSoundSeedRebuild({ ...f, seed: partial })).blockers.some(entry => entry.node === 'region')).to.equal(true);
      const loan = f.seed.artifact.borrow(); expect(loan.blob.size).to.equal(f.seed.artifact.metadata().byteLength); loan.release(); expect(f.applied()).to.equal(0);
    } finally { await f.dispose(); }
  });
  it('rebuilds a real seed→fit→graft closure reproducibly while both project references and the frozen branch remain exact', async () => {
    const f = await fixture();
    try {
      const fit = f.own(createSoundSeedDerivedOwner({ resourceBudget: f.budget, jobs: f.jobs, kind: 'body-fit' }));
      await fit.prepare(f.seed, { options: { observationFrames: 4096, fftSize: 4096, maxModes: 2, manualModes: [{ id: 'selected-body', frequencyHz: 750, t60Seconds: 0.08, pinned: true }] } });
      const originalInstrument = f.own(createSoundSeedInstrumentOwner({ resourceBudget: f.budget, jobs: f.jobs, audio: f.audio, getCatalog: f.getCatalog, onApply() { throw new Error('Unselected project must remain unchanged'); } }));
      const recipe = { transform: 'feedforward-graft', graftBody: 'fitted', pitch: { mode: 'pitched', rootCents: 6000 }, modalFit: fit.state().analysis };
      await originalInstrument.prepare(f.seed, recipe);
      const originalHash = await f.seed.artifact.digest(), oldFitHash = await fit.component('modal-reconstruction').artifact.digest(), oldInstrument = originalInstrument.state();
      const projects = [{ id: 'selected-project', revision: 1, patch: oldInstrument.contentHash }, { id: 'unselected-project', revision: 7, patch: oldInstrument.contentHash }], before = structuredClone(projects);
      const plan = await planSoundSeedRebuild({ ...f, ...recipe, modal: fit.state().analysis }), owner = f.rebuild();
      expect(plan.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'modal', 'patch']);
      const first = await owner.prepare({ plan, replacement: f.replacement }), second = await owner.prepare({ plan, replacement: f.replacement });
      expect(second.contentHash).to.equal(first.contentHash); expect(second.newRegionAssetHash).to.equal(first.newRegionAssetHash); expect(second.contentHash).not.to.equal(oldInstrument.contentHash);
      expect(second.replacementSource).to.deep.equal(plan.replacementSource); expect(second.qualification).to.include('no-cross-build-byte-equivalence-claim');
      expect(await f.seed.artifact.digest()).to.equal(originalHash); expect(await fit.component('modal-reconstruction').artifact.digest()).to.equal(oldFitHash);
      expect(originalInstrument.state()).to.deep.equal(oldInstrument); expect(projects).to.deep.equal(before); expect(f.applied()).to.equal(0);
      expect(f.calls.filter(kind => kind === 'fit-sound-seed-modes')).to.have.length(3);
    } finally { await f.dispose(); }
  });
  it('retains the last complete branch after analysis failure, quota exhaustion and an unavailable fitted parent', async () => {
    const f = await fixture();
    try {
      const plan = await planSoundSeedRebuild(f), owner = f.rebuild(), good = await owner.prepare({ plan, replacement: f.replacement });
      f.setBefore(async kind => { if (kind === 'analyze-sound-seed-window') throw new Error('injected analysis failure'); });
      await refused(owner.prepare({ plan, replacement: f.replacement }), 'injected analysis failure'); expect(owner.state().summary).to.deep.equal(good);
      f.setBefore(async () => {}); const token = {}, bytes = f.budget.diagnostics().limitBytes - f.budget.diagnostics().accountedBytes;
      f.budget.reserve({ token, owner: 'fixture-pressure', category: 'other', bytes });
      try { await refused(owner.prepare({ plan, replacement: f.replacement }), 'available'); expect(owner.state().summary).to.deep.equal(good); }
      finally { f.budget.release({ token, owner: 'fixture-pressure' }); }
      const missing = await planSoundSeedRebuild({ ...f, transform: 'feedforward-graft', graftBody: 'fitted' });
      expect(missing.blockers.some(entry => entry.node === 'modal')).to.equal(true); await refused(owner.prepare({ plan: missing, replacement: f.replacement }), 'rebuildable');
      expect(owner.state().summary).to.deep.equal(good); expect(f.seed.metadata().assetReady).to.equal(true); expect(f.applied()).to.equal(0);
    } finally { await f.dispose(); }
  });
  it('cancels before child owners exist and rejects retired review actions without scheduling storage or Apply', async () => {
    const f = await fixture();
    try {
      const plan = await planSoundSeedRebuild(f), owner = f.rebuild(), pending = owner.prepare({ plan, replacement: f.replacement });
      owner.cancel(); await refused(pending, 'canceled'); expect(owner.state().summary).to.equal(null);
      let current = true; const good = await owner.prepare({ plan, replacement: f.replacement, isCurrent: () => current });
      const before = f.calls.length; current = false; expect(owner.state().targetCurrent).to.equal(false);
      await refused(owner.install(), 'target changed'); await refused(owner.apply(), 'target changed');
      expect(f.calls).to.have.length(before); expect(owner.state().summary).to.deep.equal(good); expect(f.applied()).to.equal(0);
    } finally { await f.dispose(); }
  });
  for (const mode of ['cancel', 'stale']) it('retires a slow ' + mode + ' completion without replacing the last complete branch', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    try {
      const plan = await planSoundSeedRebuild(f), owner = f.rebuild(), good = await owner.prepare({ plan, replacement: f.replacement });
      f.setBefore(async kind => { if (kind === 'analyze-sound-seed-window') { entered.resolve(); await release.promise; } });
      const pending = owner.prepare({ plan, replacement: f.replacement }); await entered.promise;
      if (mode === 'cancel') owner.cancel(); else f.changeTarget(); release.resolve();
      await refused(pending, mode === 'cancel' ? 'canceled' : 'no longer belongs'); expect(owner.state().summary).to.deep.equal(good); expect(owner.state().unknownRetirement).to.equal(0);
      expect(f.seed.metadata().assetReady).to.equal(true); expect(f.replacement.artifact.metadata().activeLeases).to.equal(0); expect(f.applied()).to.equal(0);
      await refused(owner.apply(), mode === 'stale' ? 'target changed' : 'Commit this staged pack');
    } finally { release.resolve(); await f.dispose(); }
  });
});
