import { SEED_LAYER_SCHEMA, SEED_LAYER_REVISION, SEED_LAYER_ROLES } from '../../js/midi/content/SeedLayerProfile.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { createOwnedPcmSetDescriptor } from '../../js/app/resources/OwnedPcmSetVerification.js';

export const layerHashes = ['a', 'b', 'c'].map(letter => letter.repeat(64));
export function seedLayerDefinition(family = 'hammer-cloud') {
  const parameters = Object.fromEntries(Object.entries(getOwnedSourceProfile('worklet-seed-layers').fields).map(([key, values]) => [key, values[2]]));
  parameters.rootHz = 440; parameters.grainMilliseconds = 20; parameters.densityHz = 48;
  return { schemaVersion: 2, id: 'seed-layer-fixture', revision: 1, name: 'Layer fixture', author: 'Fixture', tags: ['test'], engineId: 'worklet-seed-layers', engineVersion: 1, parameters,
    modulations: [], macros: [], causalBindings: [], sampleRefs: layerHashes.map((sha256, index) => ({ id: 'layer-' + index, sha256, bytes: 19264, required: true })), voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.8, pan01: 0 },
    seedLayers: { schema: SEED_LAYER_SCHEMA, revision: SEED_LAYER_REVISION, family, parentAssetHash: 'd'.repeat(64), decompositionRevision: 'linked-stereo-median-masks-v1', decompositionRecipeHash: 'e'.repeat(64), parentRegionFrames: [0, 2400],
      components: layerHashes.map((assetHash, index) => ({ role: SEED_LAYER_ROLES[index], assetHash, sourceFrames: 2400, sourceRate: 48000, channels: 2 })),
      reconstruction: { comparedFrames: 2400, channels: 2, maximumAbsoluteError: 0, rmsError: 0, sourceRms: 0.2, relativeRmsError: 0, evidence: 'measured-neutral-Float32-sum-after-declared-crop;not-perceptual-source-isolation' }, motionBinding: family === 'bowed-scrap' ? { schema: 'lemmings-sample-traversal/v1', revision: 1, mappingId: 'bowed-contact', lifetimeScope: 'contactSpan', metric: 'endpoint-chord', orientation: 'unsigned', mode: 'one-way-rubbing', originPixels: 0, framesPerWorldPixel: 100, requiredPrecision: 'endpoint-chord', discontinuityPolicy: 'end-voice', timing: 'completed-tick-equal-segments-v1' } : null,
      bodyFit: family === 'hollow-tool' ? { parentAssetHash: layerHashes[1], recipeHash: 'f'.repeat(64), algorithmRevision: 'coarse-local-stereo-decay-fit-v1', referenceHz: 440, modes: [{ frequencyHz: 440, t60Seconds: 0.08, amplitude: 0.6 }, { frequencyHz: 700, t60Seconds: 0.06, amplitude: 0.4 }] } : null } };
}
export async function seedLayerPCM() {
  const banks = layerHashes.map((assetHash, index) => {
    const left = Float32Array.from({ length: 2400 }, (_, frame) => Math.sin(frame * (index + 1) * 0.08) * 0.1), right = Float32Array.from(left, value => -value);
    return { planes: [left, right], descriptor: { schema: 'lemmings-owned-pcm-bank/v1', assetHash, pcmHash: assetHash, bankHash: assetHash, format: 'float32-planar-le', sourceFrames: 2400, sourceSampleRate: 48000, frames: 2400, sampleRate: 48000, channels: 2, bytes: 19200,
      decoderVersion: 'synthetic-layer-fixture-v1', peak: 0.1, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' } };
  });
  return { descriptor: await createOwnedPcmSetDescriptor(banks.map(bank => bank.descriptor)), banks };
}
