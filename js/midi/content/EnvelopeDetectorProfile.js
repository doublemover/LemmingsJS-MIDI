import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const ENVELOPE_DETECTOR_REVISION = 'owned-linked-envelope-v1';
const defaults = Object.freeze({ kind: 'peak', inputLayout: 'audioStereo', attackSeconds: 0.003, releaseSeconds: 0.15,
  windowFrames: 1, stereoLink: 'maximum', referenceAmplitude: 1 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function prepareEnvelopeDetectorProfile(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !Object.hasOwn(defaults, key))) throw new TypeError('Invalid envelope detector definition.');
  const p = { ...defaults, ...raw };
  if (!['peak', 'rms'].includes(p.kind) || !['audioMono', 'audioStereo'].includes(p.inputLayout) || !['maximum', 'mean-power'].includes(p.stereoLink) ||
      !finite(p.attackSeconds, 0, 0.25) || !finite(p.releaseSeconds, 0, 1.4) || !Number.isSafeInteger(p.windowFrames) || p.windowFrames < 1 || p.windowFrames > 4096 ||
      p.kind === 'peak' && p.windowFrames !== 1 || !finite(p.referenceAmplitude, 0.001, 32)) throw new RangeError('Envelope detector exceeds its bounded time, window or amplitude domain.');
  return freezeData({ revision: ENVELOPE_DETECTOR_REVISION, sampleRate, parameters: p, stateBytes: p.windowFrames * 8,
    attackCoefficient: p.attackSeconds === 0 ? 0 : Math.exp(-1 / (p.attackSeconds * sampleRate)),
    releaseCoefficient: p.releaseSeconds === 0 ? 0 : Math.exp(-1 / (p.releaseSeconds * sampleRate)),
    processingLatencyFrames: 0, lookaheadFrames: 0, analysisWindowFrames: p.windowFrames,
    nominalWindowCentreAgeFrames: p.kind === 'rms' ? (p.windowFrames - 1) / 2 : 0,
    maximumTailFrames: p.windowFrames + Math.ceil(p.releaseSeconds * sampleRate * Math.log(1e9)),
    timeConvention: 'one-pole-amplitude-time-constant-1-over-e; trailing-RMS-window; reactive-no-lookahead',
    normalization: 'fixed-reference-amplitude-clamped-zero-to-one', stereoEnergy: 'link-powers-before-square-root-no-antiphase-cancellation',
    missingSource: 'zero-input-with-window-drain-and-release-to-zero', qualification: 'implementation-awaiting-step-RMS-and-cost-qualification' });
}
export const envelopeDetectorIdentity = profile => canonicalDataText({ revision: profile.revision, sampleRate: profile.sampleRate, parameters: profile.parameters }).text;
