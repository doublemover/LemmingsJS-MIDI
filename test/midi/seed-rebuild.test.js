import { expect } from 'chai';
import { planSoundSeedRebuild } from '../../js/midi/content/SoundSeedRebuildPlan.js';
import { createSoundSeedRebuildOwner } from '../../js/app/midi-ui/SoundSeedRebuildOwner.js';
import { createOwnedSoundSeedSource } from '../../js/app/midi-ui/OwnedSoundSeedSource.js';
import { analyzeSoundSeedWindow } from '../../js/app/resources/SoundSeedWindowAnalysis.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';

const hash = 'a'.repeat(64), receipt = letter => ({ definitionHash: letter.repeat(64), engineRequirement: { engineId: 'worklet-sine', engineVersion: 1, artifactHash: letter.repeat(64), parameterSchemaHash: 'd'.repeat(64) } });
const artifact = (budget, manifest, amplitude) => {
  const pcm = new Uint8Array(manifest.frames * 8), view = new DataView(pcm.buffer); view.setFloat32(256 * 8, amplitude, true); view.setFloat32(256 * 8 + 4, amplitude / 2, true);
  const bytes = encodeOwnedAudioWav(pcm, manifest.frames, manifest.sampleRate, manifest);
  return prepareExportArtifact({ bytes, immutableSourceRef: 'render-' + manifest.definitionHash, formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'render.wav', budgetAdapter: budget });
};
const make = async () => {
  const budget = createResourceBudget(), base = { schema: 'lemmings-causal-audio-render/v1', takeId: 'take-a', takeRevision: 4, sourceCanonicalHash: hash, frames: 4096, sampleRate: 48000,
    timelineZeroSourceFrame: 0, tap: 'source-dry', tail: { mode: 'exact-crop', truncated: false }, ...receipt('b') };
  const parent = artifact(budget, base, 0.4), source = createOwnedSoundSeedSource({ artifact: parent, manifest: base, resourceBudget: budget }), window = await source.readWindow({ firstFrame: 128, endFrame: 640 });
  const result = await analyzeSoundSeedWindow({ ...window.value, fades: { inFrames: 0, outFrames: 0 } }, { estimatedPeakBytes: 64 * 1048576, yieldControl: async () => {} });
  await window.release().completion; await source.dispose().completion;
  const frozen = prepareExportArtifact({ bytes: result.value.bytes, immutableSourceRef: result.value.assetHash, formatVersion: result.value.manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'seed.wav', budgetAdapter: budget });
  const seed = { artifact: frozen, manifest: result.value.manifest, metadata: () => ({ assetReady: frozen.metadata().retained, assetHash: result.value.assetHash }) };
  const manifest = { ...base, ...receipt('c') }, replacement = { artifact: artifact(budget, manifest, 0.7), manifest };
  return { budget, seed, replacement, parent, async dispose() { for (const value of [parent, frozen, replacement.artifact]) { value.discard(); await value.digest(); } } };
};
const rejects = async (promise, text) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.message).to.include(text); };

describe('explicit frozen-material branch rebuilds (runtime acceptance deferred)', () => {
  it('plans an immutable matching revoice without altering old material or project references', async () => {
    const f = await make(), before = f.seed.artifact.metadata(), plan = await planSoundSeedRebuild(f);
    expect(plan.state).to.equal('rebuildable'); expect(plan.parentRegionFrames).to.deep.equal([128, 640]);
    expect(plan.sourceTake).to.deep.equal({ takeId: 'take-a', revision: 4, canonicalHash: hash }); expect(plan.oldPatchReceipt.definitionHash).to.equal('b'.repeat(64));
    expect(plan.newPatchReceipt.definitionHash).to.equal('c'.repeat(64)); expect(plan.frozenOriginal).to.include({ playable: true, projectReferences: 'preserved', deletion: 'never-part-of-rebuild' });
    expect(plan.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'patch']); expect((await planSoundSeedRebuild(f)).planHash).to.equal(plan.planHash);
    expect(f.seed.artifact.metadata().byteLength).to.equal(before.byteLength); await f.dispose(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('reports changed intent, frame, tap, rate and missing-origin prerequisites instead of silently repairing a seed', async () => {
    const f = await make();
    for (const change of [{ takeId: 'different-take' }, { sourceCanonicalHash: 'e'.repeat(64) }, { sampleRate: 96000 }, { frames: 600 }, { tap: 'shared-return' }]) {
      const plan = await planSoundSeedRebuild({ ...f, replacement: { ...f.replacement, manifest: { ...f.replacement.manifest, ...change } } }); expect(plan.state).to.equal('unavailable'); expect(plan.blockers).not.to.have.length(0);
    }
    const legacy = structuredClone(f.seed.manifest); delete legacy.ancestry.at(-1).sourcePatchReceipt;
    expect((await planSoundSeedRebuild({ ...f, seed: { ...f.seed, manifest: legacy } })).blockers.some(blocker => blocker.state === 'unknown')).to.equal(true);
    const missing = await planSoundSeedRebuild({ ...f, selectedMaterial: 'sustained-like' }); expect(missing.blockers.some(blocker => blocker.node === 'components')).to.equal(true);
    await f.dispose();
  });
  it('prepares a new isolated branch, retains the old seed and fences stale target or plan publication', async () => {
    const f = await make(), plan = await planSoundSeedRebuild(f), descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'e'.repeat(64) }]);
    const jobs = { async compute(spec) {
      const input = await spec.prepareInput(); let value;
      try {
        if (spec.kind === 'analyze-sound-seed-window') value = (await analyzeSoundSeedWindow(input, { estimatedPeakBytes: spec.estimatedPeakBytes, signal: spec.signal, current: spec.isCurrent, yieldControl: async () => {} })).value;
        else if (spec.kind === 'compile-sound-content') { const compiled = await compileSoundContent(input, { targets: descriptors.map(descriptor => ({ descriptor })) }); value = { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash }; }
        else if (spec.kind === 'parse-json') value = JSON.parse(input);
        else if (spec.kind === 'encode-canonical-json') value = canonicalDataText(input).text;
        else if (spec.kind === 'asset-hash') { value = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (value !== spec.expectedInputHash) throw new Error('Fixture payload mismatch'); }
        else throw new Error('Unexpected rebuild fixture job ' + spec.kind);
        await spec.releasePreparedInput?.(); let phase = 'computed'; return { value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { phase = 'released'; }, retirementState: () => ({ phase }) };
      } catch (error) { await spec.releasePreparedInput?.(); error.backgroundRetirement = { phase: 'canceled' }; throw error; }
    } };
    let revision = 1, applied = 0;
    const owner = createSoundSeedRebuildOwner({ audio: { createSession() {}, getAudioContext() {} }, resourceBudget: f.budget, jobs, getCatalog: async () => ({ descriptors }),
      getTargetIdentity: () => ({ revision, laneId: 'lane-a' }), onApply: () => { applied++; } });
    const branch = await owner.prepare({ plan, replacement: f.replacement }); expect(branch.originalAssetHash).to.equal(f.seed.metadata().assetHash);
    expect(branch.newSelectedAssetHash).not.to.equal(branch.originalAssetHash); expect(f.seed.metadata().assetReady).to.equal(true); expect(owner.state().instrument).to.include({ compiledPatchReady: true, durable: false });
    await rejects(owner.prepare({ plan, replacement: f.replacement, isCurrent: () => false }), 'project or rebuild plan changed');
    expect(owner.state().summary.planHash).to.equal(plan.planHash); revision++;
    await rejects(owner.apply(), 'selected target changed'); expect(applied).to.equal(0);
    const corrupted = structuredClone(plan); corrupted.fades.inFrames = 1;
    await rejects(owner.prepare({ plan: corrupted, replacement: f.replacement }), 'reviewed plan');
    const stopped = owner.dispose(); await stopped.completion; expect(stopped.outcome).to.equal('complete'); expect(f.seed.metadata().assetReady).to.equal(true);
    await f.dispose(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
