import { freezeData } from '../../core/CanonicalData.js';

export const FEEDFORWARD_GRAFT_REVISION = 'finite-audio-modal-body-template-v1';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

export function prepareFeedforwardGraftDescriptor({ exciterRef, bodyRef, observationRef, excitationCalibration, ownerPolicy = 'actor-voice' } = {}) {
  const fail = message => { throw new TypeError('Instrument graft: ' + message); };
  if (exciterRef?.port !== 'finite-stereo-audio-excitation') fail('This template consumes finite audio excitation; detector envelopes, parameter modulation and sealed feedback ports are incompatible.');
  if (bodyRef?.port !== 'linear-modal-audio-input' || observationRef?.port !== 'signed-modal-audio-observation') fail('The body and pickup must expose the declared feed-forward linear audio ports.');
  if (!hash(exciterRef.assetHash) || !hash(bodyRef.contentHash) || !hash(observationRef.contentHash) || typeof bodyRef.revision !== 'string' || typeof observationRef.revision !== 'string' ||
      !Number.isInteger(bodyRef.modeCount) || bodyRef.modeCount < 1 || bodyRef.modeCount > 8 || ownerPolicy !== 'actor-voice') fail('This prepared tier requires exact component identities, 1–8 modes and private actor-voice ownership. Shared surfaces use their separate owner.');
  if (!finite(excitationCalibration?.energyBudget, 1e-9, 1000000) || !finite(excitationCalibration.supportSeconds, 0.001, 0.5) || excitationCalibration.reference !== 'copied-seed-rms-with-explicit-runtime-energy-cap-v1') fail('Excitation needs explicit finite-support energy calibration.');
  return freezeData({ schema: 'lemmings-instrument-graft/v1', templateId: 'finite-sample-into-modal-body', templateRevision: FEEDFORWARD_GRAFT_REVISION,
    exciterRef, bodyRef, observationRef, excitationCalibration, ownerPolicy,
    portCompatibility: 'one-way-audio-excitation;no-detector-or-feedback-relabeling', articulationPolicy: 'one-semantic-source;finite-exciter;independent-body-tail;fixed-body-tuning-per-onset',
    transition: 'next-onset-only;existing-voice-keeps-its-prepared-body', maximumTailSeconds: 4, maximumLogicalVoices: 2,
    requiredCapabilities: ['samples', 'advancedSampleMaps', 'feedforwardSampleBody', 'ownedGates'],
    cost: { sampleLayers: 1, releaseSampleLayers: 0, complexModalStatesPerVoice: bodyRef.modeCount * 2, coefficientPreparation: 'at-onset', calibration: 'declared-relative-cost;not-measured-cpu' },
    qualification: 'bounded-original-template;listening-and-device-profile-not-qualified' });
}
