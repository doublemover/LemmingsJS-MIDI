import { expect } from 'chai';
import { seedLayerDefinition, layerHashes, seedLayerPCM } from '../helpers/seedLayers.js';
import { createSoundSeedLayerRecipe } from '../../js/midi/content/SoundSeedLayerRecipe.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { prepareSeedLayerPlan } from '../../js/app/midi-ui/SeedLayerPlan.js';
import { seedLayerControlFixture } from '../../js/midi/content/SoundContentControlFixture.js';
import { hashData } from '../../js/core/CanonicalData.js';

const original = () => ({ schema: 'lemmings-sound-seed/v1', frames: 2400, sampleRate: 48000, bakedEffects: 'none-declared', coverage: { status: 'known-material', gaps: [] }, statistics: { clippedSamples: 0, silence: false },
  ancestry: [{ completeParentArtifactHash: '9'.repeat(64), takeId: 'seed-layer-fixture', takeRevision: 1, parentManifestHash: '8'.repeat(64), immutableSourceRef: 'master-layer-fixture', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-shared-browser-master' }] });
const input = async (transform = 'hammer-cloud') => {
  const patch = seedLayerDefinition(), recipe = { algorithmRevision: patch.seedLayers.decompositionRevision, parentAssetHash: patch.seedLayers.parentAssetHash, regionFrames: [0, 2400], sourceRate: 48000 }, recipeHash = await hashData(recipe);
  const decomposition = { schema: 'lemmings-seed-decomposition/v1', recipe, recipeHash, parentAssetHash: recipe.parentAssetHash, reconstruction: patch.seedLayers.reconstruction, components: patch.seedLayers.components.map(component => ({ kind: component.role, assetHash: component.assetHash })) };
  const layerMaterials = patch.seedLayers.components.map(component => ({ manifest: { ...original(), derivedTransform: { ...recipe, recipeHash, component: component.role } }, assetHash: component.assetHash, byteLength: 19264 }));
  let modalFit = null;
  if (transform === 'hollow-tool') { const modalRecipe = { algorithmRevision: 'coarse-local-stereo-decay-fit-v1', parentAssetHash: layerHashes[1] }; modalFit = { parentAssetHash: layerHashes[1], recipe: modalRecipe, recipeHash: await hashData(modalRecipe), estimate: { schema: 'lemmings-modal-estimate/v1', modes: seedLayerDefinition('hollow-tool').seedLayers.bodyFit.modes } }; }
  return { manifest: original(), assetHash: recipe.parentAssetHash, byteLength: 19264, transform, pitch: { mode: 'pitched', rootCents: 6900 }, decomposition, layerMaterials, modalFit };
};
const rejects = async (promise, message) => { let failure; try { await promise; } catch (error) { failure = error; } expect(failure?.message).to.include(message); };

describe('saved three-child sound-seed recipes (runtime and listening acceptance deferred)', () => {
  let descriptor;
  before(async () => { [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-seed-layers', engineVersion: 1, artifactHash: '7'.repeat(64) }]); });
  for (const transform of ['hammer-cloud', 'hollow-tool']) it('compiles the entire ' + transform + ' source inventory with one owned onset and explicit creative ancestry', async () => {
    const source = await input(transform), result = await createSoundSeedLayerRecipe(source), same = await createSoundSeedLayerRecipe(source);
    expect(result.contractHash).to.equal(same.contractHash); expect(result.contract.parentBackingLayers).to.equal(0); expect(result.contract.sourceCost.worstCasePerSourceUnits).to.equal(96);
    expect(result.source.files.filter(file => file.kind === 'sample').map(file => file.sha256)).to.deep.equal(layerHashes); expect(result.source.files.some(file => file.sha256 === source.assetHash)).to.equal(false);
    const compiled = await compileSoundContent(result.source, { targets: [{ descriptor }] }), patch = compiled.prepared.patches[0].definition, pcm = await seedLayerPCM(), plan = prepareSeedLayerPlan(patch, pcm.descriptor, 48000);
    expect(patch.seedLayers.family).to.equal(transform); expect(patch.sampleMap).to.equal(undefined); expect(patch.sampleRefs).to.have.length(3); expect(plan.body?.count || 0).to.equal(transform === 'hollow-tool' ? 2 : 0);
    const fixture = seedLayerControlFixture(patch); expect(fixture.physicalTakeEvidence).to.equal(false); expect(fixture.events.filter(event => event.kind === 'begin')).to.have.length(1); expect(fixture.events.filter(event => event.expression?.pitchOffsetCents != null)).to.have.length(0);
    expect(result.contract.quality).to.include(transform === 'hollow-tool' ? 'creative-modal-replacement' : 'not-transparent-time-warp');
  });
  it('declines missing components, altered analysis, wrong fitted parents and unpitched cloud roots', async () => {
    let source = await input(); source.layerMaterials.pop(); await rejects(createSoundSeedLayerRecipe(source), 'three immutable children');
    source = await input(); source.decomposition.recipe.regionFrames[1]--; await rejects(createSoundSeedLayerRecipe(source), 'exact ready linked-stereo decomposition');
    source = await input('hollow-tool'); source.modalFit.parentAssetHash = source.assetHash; await rejects(createSoundSeedLayerRecipe(source), 'exact sustained component');
    source = await input(); source.pitch = { mode: 'unpitched' }; await rejects(createSoundSeedLayerRecipe(source), 'explicit grain/body root');
  });
});
