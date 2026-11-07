import { expect } from 'chai';
import { createGraftRecipeOrigin } from '../../js/midi/content/GraftRecipeOrigin.js';
import { createSoundSeedRecipe } from '../../js/midi/content/SoundSeedRecipe.js';
import { createTextureBodyGraftRecipe, createTextureBodyTravelBinding } from '../../js/midi/content/TextureBodyGraftRecipe.js';
import { createSealedBodyGraftRecipe, createSealedFrictionBodyTravelBinding } from '../../js/midi/content/SealedBodyGraftRecipe.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { hashDataText } from '../../js/core/CanonicalData.js';

const actor = { id: 'nursery-travel', sourceKind: 'MotionCommitted', route: 'local', articulation: { sustain: true, lifetimeScope: 'actorJourney', metric: 'axis-projection', orientation: 'signedX', phaseMode: 'direction-reversing' } }, pitch = { mode: 'pitched', rootCents: 6000 };
const refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };

describe('original procedural graft ancestry (authored unrun; listening qualification pending)', () => {
  it('compiles Tin pollen, Glass breath and a sealed bowed body without a fabricated PCM asset or source take', async () => {
    const recipes = [await createTextureBodyGraftRecipe({ originalBody: 'tin', graftBody: 'tin', pitch, traversalBinding: createTextureBodyTravelBinding(actor) }), await createSealedBodyGraftRecipe({ originalBody: 'glass', graftBody: 'glass', pitch }), await createSealedBodyGraftRecipe({ originalBody: 'wood', graftBody: 'wood', pitch, transform: 'sealed-friction-body-graft', traversalBinding: createSealedFrictionBodyTravelBinding(actor) })];
    const descriptors = await describeNativeInstrumentEngines(['worklet-texture', 'worklet-wind', 'worklet-friction'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'd'.repeat(64) })));
    for (const recipe of recipes) {
      const compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0].definition;
      expect(recipe.contract.schema).to.equal('lemmings-original-graft-recipe/v1'); expect(recipe.contract.sourceTakeRefs).to.deep.equal([]); expect(recipe.contract.ancestry).to.deep.equal([]); expect(recipe.contract.sourceMaterialRole).to.include('no-recorded-PCM'); expect(recipe.source.files.every(file => file.kind === 'generated-data')).to.equal(true); expect(recipe.source.files.some(file => file.mediaType === 'audio/wav')).to.equal(false);
      expect(patch.sampleRefs).to.deep.equal([]); expect(patch.macros.map(macro => macro.name)).to.deep.equal(['EXCITE', 'BODY', 'DAMP', 'MIX'].sort()); expect(patch.parameters.graftModeCount).to.be.within(4, 6); expect(recipe.originalModelFile.sha256).to.equal(await hashDataText(recipe.originalModelFile.text)); expect(recipe.source.files[0].sha256).to.equal(recipe.originalModelFile.sha256); expect(recipe.source.recipes[0].dependencies).to.deep.equal([recipe.originalModelFile.sha256, recipe.contractHash]); expect(recipe.contractHash).to.equal(await hashDataText(recipe.contractText));
    }
    expect(recipes[0].source.pack.name).to.include('Tin pollen'); expect(recipes[1].source.pack.name).to.include('Glass breath'); expect(recipes[1].contract.graft.exciterRef.port).to.equal('sealed-feedback-instrument-stereo-audio-output');
  });
  it('rejects mismatched bodies, unknown models, mixed seed/original ancestry and fitted models without real source material', async () => {
    for (const update of [{ originalBody: 'unknown' }, { originalBody: '__proto__' }, { originalBody: 'fitted' }, { originalBody: 'tin', assetHash: 'a'.repeat(64) }, { originalBody: 'tin', manifest: {} }, { originalBody: 'tin', byteLength: 128 }, { originalBody: 'tin', modalFit: {} }]) expect(await refused(() => createGraftRecipeOrigin(update))).to.be.instanceOf(Error);
    expect((await refused(() => createSealedBodyGraftRecipe({ originalBody: 'tin', graftBody: 'glass', pitch }))).message).to.include('actually rendered'); expect((await refused(() => createTextureBodyGraftRecipe({ originalBody: 'wood', pitch, traversalBinding: createTextureBodyTravelBinding(actor) }))).message).to.include('actually rendered');
  });
  it('preserves the complete legacy seed-origin result without adding original-body fields or changing its hashes', async () => {
    const options = { manifest: { schema: 'lemmings-sound-seed/v1', frames: 24000, sampleRate: 48000, bakedEffects: 'none-declared', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: 'b'.repeat(64), takeId: 'take-a', takeRevision: 1, parentManifestHash: 'c'.repeat(64), immutableSourceRef: 'master-a' }] }, assetHash: 'a'.repeat(64), byteLength: 192064 };
    expect(await createGraftRecipeOrigin(options)).to.deep.equal(await createSoundSeedRecipe({ ...options, transform: 'hammer-seed', pitch: { mode: 'unpitched' } }));
  });
});
