import { WIND_MODEL_REVISION } from './WindModel.js';
import { FRICTION_MODEL_REVISION } from './FrictionModel.js';
import { freezeData } from '../../core/CanonicalData.js';
import { textureBodyCommandFields, validTextureBodyCommand } from './TextureBodyProfile.js';
export const SEALED_BODY_REVISION = 'intact-feedback-source-private-one-way-modal-body-v1';
export const SEALED_BODY_STATE = 144, SEALED_BODY_PARAMETERS = 38, SEALED_BODY_PACKET = 40;
export function validSealedBodyParameters(parameters, frequency = 20, rate = 48000) {
  return validTextureBodyCommand(textureBodyCommandFields(parameters), frequency, rate) && (!(parameters.graftModeCount > 0) || parameters.releaseSeconds === 4);
}
export function prepareSealedBodyGraftDescriptor({ exciterRef, bodyRef, observationRef, excitationCalibration } = {}) {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (exciterRef?.port !== 'sealed-feedback-instrument-stereo-audio-output' || !['worklet-friction', 'worklet-wind'].includes(exciterRef.engineId) || !hash(exciterRef.contentHash) || exciterRef.revision !== (exciterRef.engineId === 'worklet-wind' ? WIND_MODEL_REVISION : FRICTION_MODEL_REVISION) || bodyRef?.port !== 'linear-modal-audio-input' || !hash(bodyRef.contentHash) || !Number.isInteger(bodyRef.modeCount) || bodyRef.modeCount < 1 || bodyRef.modeCount > 8 || typeof bodyRef.revision !== 'string' || observationRef?.port !== 'signed-modal-audio-observation' || !hash(observationRef.contentHash) || typeof observationRef.revision !== 'string' || excitationCalibration?.reference !== 'intact-parent-stereo-divided-by-32-before-contracting-body-v1') throw new TypeError('Sealed graft needs the intact supported feedback instrument audio output, exact linear body/pickup and explicit calibration. Internal interaction, detector and arbitrary feedback ports are unavailable.');
  return freezeData({ schema: 'lemmings-instrument-graft/v1', templateId: 'intact-feedback-instrument-into-private-modal-body', templateRevision: SEALED_BODY_REVISION, exciterRef, bodyRef, observationRef, excitationCalibration, ownerPolicy: 'actor-voice',
    portCompatibility: 'one-way-audio-after-intact-feedback-model;no-parent-loop-modification', articulationPolicy: 'one-canonical-source;intact-parent-controls;source-end-closes-outer-input;independent-positive-body-tail', transition: 'next-onset-only;old-actors-retain-their-entire-prepared-instrument', maximumTailSeconds: 4, requiredCapabilities: ['sealedFeedbackBody', 'ownedGates', 'exactSourceStateTransfer'],
    cost: { parentModel: 'unchanged-and-counted', outerComplexStatesPerVoice: bodyRef.modeCount * 2, outerStateScalarsPerVoice: SEALED_BODY_STATE + SEALED_BODY_PARAMETERS, overlap: 'both-complete-instruments-when-an-old-voice-retains-its-tail', calibration: 'declared-relative-model;device-and-listening-unqualified' }, qualification: 'unrun-numerical-PCM-source-identity-and-listening-fixtures' });
}
