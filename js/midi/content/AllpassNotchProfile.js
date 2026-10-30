import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const ALLPASS_NOTCH_REVISION = 'owned-eight-stage-normalized-lattice-v1';
export function allpassLatticeCoefficient(frequencyHz, sampleRate) {
  const tangent = Math.tan(Math.PI * frequencyHz / sampleRate), reflection = (tangent - 1) / (tangent + 1);
  return [reflection, Math.sqrt(Math.max(0, 1 - reflection * reflection))];
}
export function prepareAllpassNotchProfile(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype ||
      Object.keys(raw).some(key => !['baseFrequencyHz', 'ratio', 'feedback', 'feedbackMaximum', 'wet01', 'maximumSlewHzPerSample'].includes(key))) throw new TypeError('Invalid allpass notch profile.');
  const p = { baseFrequencyHz: 640, ratio: 1.6, feedback: 0.1, feedbackMaximum: 0.25, wet01: 1, maximumSlewHzPerSample: 4, ...raw };
  if (![p.baseFrequencyHz, p.ratio, p.feedback, p.feedbackMaximum, p.wet01, p.maximumSlewHzPerSample].every(Number.isFinite) || p.baseFrequencyHz < 160 || p.baseFrequencyHz > 1600 ||
      p.ratio < 1.1 || p.ratio > 2 || p.feedbackMaximum < 0 || p.feedbackMaximum > 0.25 || Math.abs(p.feedback) > p.feedbackMaximum ||
      p.wet01 < 0 || p.wet01 > 1 || p.maximumSlewHzPerSample < 0.001 || p.maximumSlewHzPerSample > 8) throw new RangeError('Allpass frequency, slew, mix or feedback exceeds its bounded profile.');
  const coefficients = Array.from({ length: 4 }, (_, index) => allpassLatticeCoefficient(p.baseFrequencyHz * p.ratio ** index, sampleRate));
  return freezeData({ revision: ALLPASS_NOTCH_REVISION, sampleRate, parameters: p, coefficients, stateBytes: 26 * 8,
    stageCount: 8, pairedFrequencies: 4, channelCount: 2, processingLatencyFrames: 0, maximumTailFrames: sampleRate * 2,
    maximumLinearGain: 1 + 1 / (1 - p.feedbackMaximum), gainBoundDomain: 'induced-L2-energy;not-an-instantaneous-peak-bound',
    maximumOutputAmplitude: 64, stateAmplitudeFaultBound: 1024,
    realization: 'y=k*x+sqrt(1-k*k)*s;nextS=sqrt(1-k*k)*x-k*s;two-stages-per-frequency',
    energyPolicy: 'each-time-varying-scattering-matrix-is-orthogonal;one-sample-owned-feedback',
    phasePolicy: 'frequency-dependent-allpass-phase;no-claimed-fixed-group-delay-or-lookahead',
    tailPolicy: 'hard-owned-two-second-ceiling;release-decay-qualification-pending',
    qualification: 'implementation-awaiting-notch-modulation-sideband-cost-and-listening-qualification' });
}
export const allpassNotchIdentity = p => canonicalDataText({ revision: p.revision, sampleRate: p.sampleRate, parameters: p.parameters, coefficients: p.coefficients }).text;
