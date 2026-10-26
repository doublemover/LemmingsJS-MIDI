import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { SOUND_SEED_GRAFT_BODIES } from './SoundSeedGraftRecipe.js';
import { prepareTextureExciter, TEXTURE_EXCITER_KINDS } from './TextureExciter.js';
import { prepareTextureBodyGraftDescriptor, TEXTURE_BODY_REVISION } from './TextureBodyProfile.js';
import { canonicalDataText, freezeData, hashData, hashDataText } from '../../core/CanonicalData.js';

const quantity = (value, unit) => ({ value, unit });
const component = (id, parameters) => ({ id, role: id, parameters });
const macro = (id, name, parameter, low, high, unit, default01) => ({ id, name, mode: 'onset-only', default01, smoothingMs: 10, perceptualDirection: name + ' follows the declared new-voice equation; existing bodies retain their onset state.',
  targets: [{ parameter, minimum: quantity(low, unit), maximum: quantity(high, unit), curve: 'linear', composition: 'replace', clamp: true }] });

export async function createTextureBodyGraftRecipe({ manifest, assetHash, byteLength, pitch, graftBody = 'tin', modalFit = null, textureKind = 'sand-drag', traversalBinding } = {}) {
  const fail = message => { throw new TypeError('Texture body: ' + message); };
  if (pitch?.mode !== 'pitched' || !Number.isFinite(pitch.rootCents) || pitch.rootCents < 2400 || pitch.rootCents > 9600) fail('Declare body tuning independently of the unpitched spatial exciter.');
  traversalBinding = validateTextureBodyTravelBinding(traversalBinding);
  const texture = prepareTextureExciter({ kind: textureKind }), base = await createSoundSeedRecipe({ manifest, assetHash, byteLength, transform: 'hammer-seed', pitch: { mode: 'unpitched' } }), rootHz = 440 * 2 ** ((pitch.rootCents - 6900) / 1200);
  if (rootHz < 20 || rootHz > 2000) fail('The declared body root exceeds this owned source range.');
  let body = SOUND_SEED_GRAFT_BODIES[graftBody];
  if (graftBody === 'fitted') {
    const modes = modalFit?.estimate?.modes;
    if (!Array.isArray(modes) || !modes.length || modes.length > 8 || !/^[a-f0-9]{64}$/.test(modalFit.parentAssetHash) || typeof modalFit.recipe?.algorithmRevision !== 'string' || modes.some(mode => !Number.isFinite(mode.frequencyHz) || !Number.isFinite(mode.t60Seconds) || mode.t60Seconds < 0.03 || mode.t60Seconds > 2.5 || !Number.isFinite(mode.amplitude) || mode.amplitude < 0)) fail('Select a reviewed finite 1–8-mode fit and its exact material/algorithm ancestry.');
    body = { name: 'Selected fitted modal body', revision: modalFit.recipe.algorithmRevision, ratios: modes.map(mode => mode.frequencyHz / rootHz), t60: modes.map(mode => mode.t60Seconds), gains: modes.map(mode => mode.amplitude), analysis: { parentAssetHash: modalFit.parentAssetHash, recipe: modalFit.recipe, estimate: modalFit.estimate } };
  }
  if (!body || body.ratios.some(ratio => ratio < 0.125 || ratio > 16 || ratio * rootHz >= 44100 * 0.4) || body.gains.reduce((sum, gain) => sum + Math.abs(gain), 0) < 1e-10) fail('The body/reference exceeds the declared three-rate domain or has no observation.');
  const bodyHash = await hashData(body), textureHash = await hashData(texture), longest = Math.max(...body.t60), gainReference = Math.max(1, ...body.gains);
  const observation = { revision: 'texture-body-authored-signed-ab-v1', gainsA: body.gains.map(gain => gain / gainReference), gainsB: body.gains.map((gain, index) => gain / gainReference * (index % 2 ? -1 : 0.7)), normalization: 'common-maximum-gain-then-max(1,sum-per-mode-max-abs-A-B)', geometry: 'authored-weights;not-a-measured-pickup-field' };
  const graft = prepareTextureBodyGraftDescriptor({ exciterRef: { port: 'observed-spatial-texture-audio-excitation', contentHash: textureHash, revision: texture.revision }, bodyRef: { port: 'linear-modal-audio-input', contentHash: bodyHash, revision: body.revision, modeCount: body.ratios.length },
    observationRef: { port: 'signed-modal-audio-observation', contentHash: await hashData(observation), revision: observation.revision }, excitationCalibration: { reference: 'owned-texture-filtered-peak-contract-v1', inputPeakBound: 1, injection: '(1-r)/(2*sqrt(2))', observationGain: 0.4, failure: 'stop-body-input-and-retain-tail', acousticCalibration: 'unqualified-relative-audio-model' } });
  const contract = freezeData({ ...base.contract, transform: 'texture-body-graft', pitchDeclaration: { mode: 'declared-body-root', rootCents: pitch.rootCents }, texture, body, observation, graft, traversalBinding,
    sourceMaterialRole: 'body-fit-and-regeneration-ancestry-only;frozen-audio-not-played', releasePolicy: 'positive-body-decay-under-explicit-four-second-owned-release-envelope;final-owner-cutoff', warnings: ['Spatial excitation is original, not a reconstruction of the frozen seed. BODY changes intrinsic modal T60; the separate four-second release envelope remains explicit. Numerical, spectral, device and listening qualification is pending.'] });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), source = structuredClone(base.source), recipe = source.recipes[0], id = 'texture.body.' + contractHash.slice(0, 24);
  source.pack.id = id; source.pack.name = (textureKind === 'sand-drag' && graftBody === 'tin' ? 'Tin pollen' : TEXTURE_EXCITER_KINDS.includes(textureKind) ? textureKind : 'Texture') + ' → ' + body.name; recipe.id = id; recipe.name = source.pack.name; recipe.engine = { id: 'worklet-texture', version: 1 }; delete recipe.sampleMap; recipe.sampleRefs = [];
  recipe.tags = ['procedural-texture', 'texture-body-graft', 'observed-travel', 'private-modal-body', 'unqualified-content']; recipe.dependencies = [assetHash, contractHash]; recipe.voicePolicy = { maxVoices: 8, steal: 'reject' };
  const parameters = { textureBodySeconds: quantity(texture.bodySeconds, 's'), graftModeCount: quantity(body.ratios.length, 'count'), graftMix01: quantity(0.7, 'normalized'), graftT60Seconds: quantity(longest, 's'), graftDamping01: quantity(0, 'normalized'), graftExcite01: quantity(1, 'normalized'), graftPickup01: quantity(0.5, 'normalized') };
  for (let index = 0; index < body.ratios.length; index++) {
    parameters['graftMode' + index + 'Ratio'] = quantity(body.ratios[index], 'ratio'); parameters['graftMode' + index + 'T60Scale'] = quantity(body.t60[index] / longest, 'ratio'); parameters['graftMode' + index + 'PickupA'] = quantity(observation.gainsA[index], 'dimensionless'); parameters['graftMode' + index + 'PickupB'] = quantity(observation.gainsB[index], 'dimensionless');
  }
  recipe.components = [component('exciter', { textureKind: quantity(texture.kindIndex, 'enum'), roughnessPerPixel: quantity(texture.roughnessPerPixel, 'inverse-world-pixel'), dragSlope: quantity(texture.dragSlope, 'normalized'), shade01: quantity(texture.shade01, 'normalized'), textureScope: quantity(0, 'enum'), textureAxis: quantity(traversalBinding.orientation === 'signedX' ? 0 : 1, 'enum'), textureRequireSegments: quantity(0, 'enum') }), component('resonator', parameters),
    component('envelope', { attackSeconds: quantity(0.005, 's'), decaySeconds: quantity(0, 's'), sustain01: quantity(1, 'ratio'), releaseSeconds: quantity(4, 's') }), component('output', { gain01: quantity(0.6, 'amplitude-linear'), pan01: quantity(0, 'normalized') })];
  recipe.macros = [macro('excite', 'EXCITE', 'graftExcite01', 0, 1, 'normalized', 1), macro('body', 'BODY', 'graftT60Seconds', Math.max(0.02, longest * 0.4), longest, 's', 1), macro('damp', 'DAMP', 'graftDamping01', 0, 0.8, 'normalized', 0), macro('mix', 'MIX', 'graftMix01', 0, 1, 'normalized', 0.7)];
  const invariants = ['one-canonical-source', 'motion-gated-spatial-exciter', 'positive-private-body-tail', 'signed-observation', 'next-onset-body-transition'];
  source.realizationGroups = [{ schema: 'lemmings-authored-sound-realizations/v1', id: id + '.realization', defaultProfileId: 'prepared', requiredInvariants: invariants, profiles: [{ id: 'prepared', recipeId: id, algorithmRevision: TEXTURE_BODY_REVISION, preservedInvariants: invariants, changedAudibleProperties: [], fallbackProfileId: null }], transitions: [], singleProfileLimit: 'One original bounded body tier; no measured cheaper alternative. Exact kernel-state cut API is awaiting PCM-equivalence qualification.' }];
  source.files[1].sha256 = contractHash; source.files[1].bytes = encoded.bytes.length;
  return freezeData({ source, contract, contractHash, contractText: encoded.text, templateRevision: TEXTURE_BODY_REVISION });
}

export function createTextureBodyTravelBinding(instrument) {
  const a = instrument?.articulation;
  if (instrument?.route !== 'local' || instrument.sourceKind !== 'MotionCommitted' || !a?.sustain || a.lifetimeScope !== 'actorJourney' || a.metric !== 'axis-projection' || !['signedX', 'signedY'].includes(a.orientation) || a.phaseMode !== 'direction-reversing') throw new TypeError('Choose an actual sustained local signed-axis journey mapping.');
  return freezeData({ schema: 'lemmings-texture-body-travel-binding/v1', mappingId: instrument.id, lifetimeScope: 'actorJourney', metric: a.metric, orientation: a.orientation, requiredPrecision: 'endpoint-chord' });
}

export function validateTextureBodyTravelBinding(binding) {
  if (!binding || Object.getPrototypeOf(binding) !== Object.prototype || Object.keys(binding).some(key => !['schema', 'mappingId', 'lifetimeScope', 'metric', 'orientation', 'requiredPrecision'].includes(key)) || binding.schema !== 'lemmings-texture-body-travel-binding/v1' || typeof binding.mappingId !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(binding.mappingId) || binding.lifetimeScope !== 'actorJourney' || binding.metric !== 'axis-projection' || !['signedX', 'signedY'].includes(binding.orientation) || binding.requiredPrecision !== 'endpoint-chord') throw new TypeError('Choose the exact supported signed-axis texture journey binding.');
  return freezeData({ ...binding });
}
