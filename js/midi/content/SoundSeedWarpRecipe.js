import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { validateBufferedWarpPlan } from './BufferedWarpPlan.js';
import { canonicalDataText, cloneMutableData, freezeData, hashDataText } from '../../core/CanonicalData.js';

export async function createSoundSeedWarpRecipe({ manifest, assetHash, byteLength, warpPlan: raw, pitch } = {}) {
  const plan = validateBufferedWarpPlan(raw);
  if (plan.assetHash !== assetHash || plan.sourceRate !== manifest?.sampleRate || plan.sourceFrames !== manifest.frames || plan.sourceFrameRegion[0] !== 0 || plan.sourceFrameRegion[1] !== manifest.frames || pitch?.mode !== 'pitched' || pitch.rootCents !== plan.rootPitch.cents)
    throw new TypeError('A streaming instrument needs the exact prepared frozen seed and its declared material root.');
  const base = await createSoundSeedRecipe({ manifest, assetHash, byteLength, transform: 'hammer-seed', pitch });
  const contract = freezeData({ ...base.contract, algorithmRevision: 'frozen-streaming-warp-recipe-v1', transform: 'streaming-warp', warpPlan: plan, loop: plan.loop,
    warnings: [...base.contract.warnings, 'One experimental owned streaming voice. Fixed prepared sample rate and starting rate/pitch matrix; unavailable notes are refused, never retuned silently.'],
    realization: 'live-processing-worker-and-owned-output-gate;finite-WAV-bake-is-a-separate-derived-asset' });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), recipeId = 'seed.warp.' + contractHash.slice(0, 24), source = cloneMutableData(base.source);
  source.pack.id = recipeId; source.pack.name = 'Streaming WarpVoice seed';
  const recipe = source.recipes[0]; recipe.id = recipeId; recipe.name = source.pack.name; recipe.tags = ['sound-seed', 'streaming-warp', 'baked-ancestry', 'pitched', 'experimental']; recipe.engine.id = 'worklet-warp';
  recipe.warpPlan = plan; delete recipe.sampleMap; recipe.macros = []; recipe.voicePolicy.maxVoices = 1; recipe.dependencies = [assetHash, contractHash];
  recipe.components = [{ id: 'exciter', role: 'exciter', parameters: { maximumHoldSeconds: { value: 8, unit: 's' } } }, { id: 'envelope', role: 'envelope', parameters: { attackSeconds: { value: 0.003, unit: 's' }, releaseSeconds: { value: 0.04, unit: 's' } } }, { id: 'output', role: 'output', parameters: { gain01: { value: 0.4, unit: 'amplitude-linear' }, pan01: { value: 0, unit: 'normalized' } } }];
  const data = source.files.find(file => file.kind === 'generated-data'); data.sha256 = contractHash; data.bytes = encoded.bytes.length;
  recipe.rights.modifications = ['frozen-streaming-warp-recipe-v1']; data.rights.modifications = ['frozen-streaming-warp-recipe-v1'];
  return freezeData({ contract, contractHash, contractText: encoded.text, source });
}
