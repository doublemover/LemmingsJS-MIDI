import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';
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
import { canonicalDataText, hashData } from '../../js/core/CanonicalData.js';

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
  it('keeps the finite warp between its exact source/component and later modal estimate', async () => {
    const f = await make(), originalHash = f.seed.metadata().assetHash, recipe = { algorithmRevision: 'direct-core-buffered-finite-warp-bake-v1', parentAssetHash: originalHash, coreArtifactHash: OWNED_STRETCH_CORE.wasmSha256, coreConfigurationHash: 'e'.repeat(64), options: { rateRatio: 0.75, pitchRatio: 2, outputRate: 96000 }, bodyFrames: Math.ceil(f.seed.manifest.frames * 2 / 0.75), tailFrames: 256 }, warp = { schema: 'lemmings-seed-warp-result/v1', parentAssetHash: originalHash, recipe, recipeHash: await hashData(recipe), components: [{ kind: 'warped-seed', assetHash: 'd'.repeat(64) }] };
    const plan = await planSoundSeedRebuild({ ...f, warp, selectedMaterial: 'warped-seed' }); expect(plan.state).to.equal('rebuildable'); expect(plan.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'warp', 'patch']); expect(plan.warpOptions).to.deep.equal(recipe.options); expect(plan.warpParentMaterial).to.equal('original'); expect(plan.warpInputs.coreArtifactHash).to.equal(OWNED_STRETCH_CORE.wasmSha256);
    const modal = { parentAssetHash: 'd'.repeat(64), recipe: { algorithmRevision: 'coarse-local-stereo-decay-fit-v1', observationFrames: 512, fftSize: 1024, maxModes: 4, frequencyRange: [80, 6000], amplitudeT60Range: [0.02, 2], manualModes: [] } }, fitted = await planSoundSeedRebuild({ ...f, warp, modal, selectedMaterial: 'modal-reconstruction' }); expect(fitted.state).to.equal('rebuildable'); expect(fitted.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'warp', 'modal', 'patch']); expect(fitted.nodes.find(node => node.id === 'modal').parents).to.deep.equal(['warp']);
    const bad = { ...warp, recipe: { ...recipe, coreArtifactHash: 'f'.repeat(64) } }; expect((await planSoundSeedRebuild({ ...f, warp: bad, selectedMaterial: 'warped-seed' })).state).to.equal('unavailable'); expect((await planSoundSeedRebuild({ ...f, selectedMaterial: 'warped-seed' })).state).to.equal('unavailable'); expect(f.seed.metadata().assetHash).to.equal(originalHash); await f.dispose();
  });
  it('plans a three-parent composition and fitted graft in dependency order without rewriting the frozen original', async () => {
    const f = await make(), originalHash = f.seed.metadata().assetHash;
    const components = { parentAssetHash: originalHash, recipe: { algorithmRevision: 'linked-stereo-median-masks-v1', fftSize: 512, medianWidths: { temporalFrames: 3, frequencyBins: 3 }, maskMargins: { sustained: 2, transient: 2 } },
      components: ['transient-like', 'sustained-like', 'residual'].map((kind, index) => ({ kind, assetHash: String(index + 1).repeat(64) })) };
    const componentAssetHashes = Object.fromEntries(components.components.map(entry => [entry.kind, entry.assetHash]));
    const composition = { parentAssetHash: originalHash, components: [{ kind: 'component-composition', assetHash: 'f'.repeat(64) }], recipe: { algorithmRevision: 'aligned-printed-component-branches-v1', decompositionRevision: components.recipe.algorithmRevision,
      decompositionRecipeHash: await hashData(components.recipe), componentAssetHashes, options: { residualGain: 0.25, transientDrive: 2 } } };
    const modal = { parentAssetHash: 'f'.repeat(64), recipe: { algorithmRevision: 'coarse-local-stereo-decay-fit-v1', observationFrames: 512, fftSize: 1024, maxModes: 4, frequencyRange: [80, 6000], amplitudeT60Range: [0.02, 2], manualModes: [] } };
    const plan = await planSoundSeedRebuild({ ...f, components, composition, modal, selectedMaterial: 'component-composition', transform: 'feedforward-graft', graftBody: 'fitted', pitch: { mode: 'pitched', rootCents: 6000 } });
    expect(plan.state).to.equal('rebuildable'); expect(plan.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'components', 'composition', 'modal', 'patch']);
    expect(plan.nodes.at(-1).parents).to.deep.equal(['composition', 'modal']); expect(plan.modalParentMaterial).to.equal('component-composition');
    expect(plan.compositionOptions).to.deep.equal(composition.recipe.options); expect(plan.compositionInputs.componentAssetHashes).to.deep.equal(componentAssetHashes);
    const warpRecipe = { algorithmRevision: 'direct-core-buffered-finite-warp-bake-v1', parentAssetHash: composition.components[0].assetHash, coreArtifactHash: OWNED_STRETCH_CORE.wasmSha256, coreConfigurationHash: 'e'.repeat(64), options: { rateRatio: 1, pitchRatio: 1, outputRate: 48000 }, bodyFrames: f.seed.manifest.frames, tailFrames: 64 }, warp = { schema: 'lemmings-seed-warp-result/v1', parentAssetHash: warpRecipe.parentAssetHash, recipe: warpRecipe, recipeHash: await hashData(warpRecipe), components: [{ kind: 'warped-seed', assetHash: 'd'.repeat(64) }] };
    const warped = await planSoundSeedRebuild({ ...f, components, composition, warp, modal: { ...modal, parentAssetHash: 'd'.repeat(64) }, selectedMaterial: 'warped-seed', transform: 'feedforward-graft', graftBody: 'fitted', pitch: { mode: 'pitched', rootCents: 6000 } }); expect(warped.state).to.equal('rebuildable'); expect(warped.nodes.map(node => node.id)).to.deep.equal(['source', 'region', 'components', 'composition', 'warp', 'modal', 'patch']); expect(warped.nodes.find(node => node.id === 'warp').parents).to.deep.equal(['composition']); expect(warped.nodes.find(node => node.id === 'modal').parents).to.deep.equal(['warp']);
    const wrong = structuredClone(composition); wrong.recipe.componentAssetHashes.residual = 'e'.repeat(64);
    const blocked = await planSoundSeedRebuild({ ...f, components, composition: wrong, selectedMaterial: 'component-composition' }); expect(blocked.state).to.equal('unavailable'); expect(blocked.blockers.some(entry => entry.node === 'composition')).to.equal(true);
    expect(f.seed.metadata().assetHash).to.equal(originalHash); await f.dispose();
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
