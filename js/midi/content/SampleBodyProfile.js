import { freezeData } from '../../core/CanonicalData.js';

export const SAMPLE_BODY_REVISION = 'finite-or-observed-motion-modal-feedforward-v2';
export const SAMPLE_BODY_STATE_OFFSET = 48;
export const SAMPLE_BODY_CONTROL_SCALARS = 20;
export const SAMPLE_BODY_MODE_STRIDE = 8;
export const SAMPLE_BODY_MAX_MODES = 8;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fail = message => { throw new TypeError('Sample body: ' + message); };

export function prepareSampleBodyProfile(parameters = {}, sampleRate) {
  const count = parameters.graftModeCount ?? 0, excitationMode = parameters.graftExcitationMode ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > SAMPLE_BODY_MAX_MODES) fail('mode count exceeds the prepared body tier');
  if (![0, 1].includes(excitationMode) || !count && excitationMode) fail('motion excitation requires a prepared body and its explicit source contract');
  if (!count) return null;
  const energyBudget = parameters.graftEnergyBudget ?? 1, supportSeconds = parameters.graftSupportSeconds ?? 0.25;
  if (![44100, 48000, 96000].includes(sampleRate) || !finite(energyBudget, 1e-9, 1000000) || !finite(supportSeconds, 0.001, 0.5)) fail('excitation needs a declared finite energy/support calibration');
  let maximumL1 = 0;
  const modes = Array.from({ length: count }, (_, index) => {
    const ratio = parameters['graftMode' + index + 'Ratio'] ?? index + 1, t60Scale = parameters['graftMode' + index + 'T60Scale'] ?? 1,
      pickupA = parameters['graftMode' + index + 'PickupA'] ?? 1 / count, pickupB = parameters['graftMode' + index + 'PickupB'] ?? 1 / count;
    if (!finite(ratio, 0.125, 16) || !finite(t60Scale, 0.01, 1) || !finite(pickupA, -1, 1) || !finite(pickupB, -1, 1)) fail('invalid modal register, loss or signed observation weight');
    maximumL1 += Math.max(Math.abs(pickupA), Math.abs(pickupB)); return { ratio, t60Scale, pickupA, pickupB };
  });
  if (maximumL1 < 1e-10) fail('the prepared observation is silent');
  return freezeData({ revision: SAMPLE_BODY_REVISION, count, modes, maximumL1: Math.max(1, maximumL1), excitationMode, energyBudget, supportFrames: excitationMode ? 0 : Math.ceil(supportSeconds * sampleRate), sampleRate,
    dcPole: Math.exp(-2 * Math.PI * 20 / sampleRate), maximumTailFrames: sampleRate * 4, outputGain: 0.4, denormalFloor: 1e-24,
    inputPeakBound: 1, accumulatorBound: excitationMode ? 1 : energyBudget,
    policy: excitationMode ? 'next-onset-only;observed-motion-audio-excitation;independent-body-tail' : 'next-onset-only;finite-audio-excitation;independent-body-tail', observation: 'authored-signed-mode-weights;not-geometric-pickup',
    stability: excitationMode ? 'contractive-complex-rotation;injection=(1-r)/(2*sqrt(2)*owned-normalized-input-peak);DC-L1-bound=2;stereo-state-L2<=1' : 'contractive-complex-rotation;injection-sqrt(1-r^2)/sqrt(declared-input-energy);L1-bounded-observation',
    calibrationOverflow: excitationMode ? 'peak-bound-violation-stops-body-input;retain-tail-and-diagnostic;dry-path-independent' : 'cap-final-injection-and-stop-body-input;retain-tail-and-diagnostic;dry-path-independent' });
}

export function acceptsSampleBodyOnset(profile, frequency, controls) {
  if (!profile) return true;
  return finite(frequency, 0.1, profile.sampleRate * 0.4) && finite(controls.mix01, 0, 1) && finite(controls.t60Seconds, 0.02, 2.5) && finite(controls.damping01, 0, 1) &&
    finite(controls.excite01, 0, 1) && finite(controls.pickup01, 0, 1) && profile.modes.every(mode => frequency * mode.ratio < profile.sampleRate * 0.4);
}
