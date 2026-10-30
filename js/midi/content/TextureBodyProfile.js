import { freezeData } from '../../core/CanonicalData.js';

export const TEXTURE_BODY_REVISION = 'observed-spatial-texture-private-modal-body-v1';
export const TEXTURE_BODY_FIELDS = Object.freeze({ count: 40, mix: 41, t60: 42, damp: 43, excite: 44, pickup: 45, modes: 46 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

export function validTextureBodyCommand(command, frequency, sampleRate) {
  if (!command || ![44100, 48000, 96000].includes(sampleRate)) return false;
  const n = command[40]; if (!Number.isInteger(n) || n < 0 || n > 8) return false; if (!n) return true;
  if (!finite(frequency, 20, 2000) || !finite(command[41], 0, 1) || !finite(command[42], 0.02, 2.5) || !finite(command[43], 0, 1) || !finite(command[44], 0, 1) || !finite(command[45], 0, 1)) return false;
  let observation = 0;
  for (let index = 0; index < n; index++) {
    const at = 46 + index * 4;
    if (!finite(command[at], 0.125, 16) || frequency * command[at] >= sampleRate * 0.4 || !finite(command[at + 1], 0.01, 1) || !finite(command[at + 2], -1, 1) || !finite(command[at + 3], -1, 1)) return false;
    observation += Math.max(Math.abs(command[at + 2]), Math.abs(command[at + 3]));
  }
  return observation > 1e-10;
}

export function textureBodyCommandFields(parameters) {
  const fields = { 40: parameters.graftModeCount ?? 0, 41: parameters.graftMix01 ?? 0.7, 42: parameters.graftT60Seconds ?? 0.7, 43: parameters.graftDamping01 ?? 0, 44: parameters.graftExcite01 ?? 1, 45: parameters.graftPickup01 ?? 0.5 };
  for (let index = 0; index < 8; index++) {
    const at = 46 + index * 4; fields[at] = parameters['graftMode' + index + 'Ratio'] ?? index + 1; fields[at + 1] = parameters['graftMode' + index + 'T60Scale'] ?? 1;
    fields[at + 2] = parameters['graftMode' + index + 'PickupA'] ?? 0.125; fields[at + 3] = parameters['graftMode' + index + 'PickupB'] ?? 0.125;
  }
  return fields;
}

export function prepareTextureBodyGraftDescriptor({ exciterRef, bodyRef, observationRef, excitationCalibration, ownerPolicy = 'actor-voice' } = {}) {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (exciterRef?.port !== 'observed-spatial-texture-audio-excitation' || !hash(exciterRef.contentHash) || bodyRef?.port !== 'linear-modal-audio-input' || !hash(bodyRef.contentHash) || observationRef?.port !== 'signed-modal-audio-observation' || !hash(observationRef.contentHash) ||
      typeof bodyRef.revision !== 'string' || typeof observationRef.revision !== 'string' || !Number.isInteger(bodyRef.modeCount) || bodyRef.modeCount < 1 || bodyRef.modeCount > 8 || ownerPolicy !== 'actor-voice' || excitationCalibration?.reference !== 'owned-texture-filtered-peak-contract-v1' || excitationCalibration.inputPeakBound !== 1)
    throw new TypeError('Texture graft requires exact spatial audio, linear body and signed observation ports with the owned peak contract. Detector and sealed feedback ports are incompatible.');
  return freezeData({ schema: 'lemmings-instrument-graft/v1', templateId: 'spatial-texture-into-private-modal-body', templateRevision: TEXTURE_BODY_REVISION, exciterRef, bodyRef, observationRef, excitationCalibration, ownerPolicy,
    portCompatibility: 'one-way-audio;sealed-feedback-and-detector-ports-rejected', articulationPolicy: 'one-source;observed-motion-only-input;private-body-tail;onset-body-tuning', transition: 'next-onset-only;existing-voices-retain-body', maximumTailSeconds: 4,
    requiredCapabilities: ['proceduralTextures', 'canonicalTextureTravel', 'feedforwardTextureBody', 'ownedGates'], maximumLogicalVoices: 8,
    qualification: 'original-relative-audio-model;numerical-device-and-listening-qualification-pending' });
}
