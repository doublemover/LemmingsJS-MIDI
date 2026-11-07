import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const SPECTRAL_FREEZE_REVISION = 'owned-radix2-stft-freeze-v2-window-evidence';
export function prepareSpectralFreezeProfile(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype ||
      Object.keys(raw).some(key => !['fftSize', 'thawSeconds', 'maximumHoldSeconds', 'pitchRatio', 'blur01', 'dampingHz'].includes(key))) throw new TypeError('Invalid spectral freeze profile.');
  const p = { fftSize: 1024, thawSeconds: 0.15, maximumHoldSeconds: 12, pitchRatio: 1, blur01: 0, dampingHz: 12000, ...raw };
  if (![512, 1024, 2048].includes(p.fftSize) || ![p.thawSeconds, p.maximumHoldSeconds, p.pitchRatio, p.blur01, p.dampingHz].every(Number.isFinite) ||
      p.thawSeconds < 0.02 || p.thawSeconds > 2 || p.maximumHoldSeconds < 0.1 || p.maximumHoldSeconds > 30 || p.pitchRatio < 0.5 || p.pitchRatio > 2 ||
      p.blur01 < 0 || p.blur01 > 1 || p.dampingHz < 1000 || p.dampingHz > sampleRate * 0.45) throw new RangeError('Spectral window, hold, resynthesis or damping exceeds its prepared domain.');
  const n = p.fftSize, bins = n / 2 + 1;
  return freezeData({ revision: SPECTRAL_FREEZE_REVISION, sampleRate, parameters: p, hopFrames: n / 4, bins,
    stateBytes: (8 * n + 10 * bins + 4) * 8 + n * 4 + 131072, captureTransportBytes: 131072, maximumUnacknowledgedCaptures: 4, processingLatencyFrames: n,
    maximumTailFrames: Math.ceil((p.maximumHoldSeconds + p.thawSeconds) * sampleRate) + n * 2,
    maximumLinearGain: 2, maximumOutputAmplitude: 64, gainBoundDomain: 'bounded-history-input-peak;not-a-frozen-output-energy-bound',
    windowId: 'periodic-sqrt-hann', overlapNormalization: 0.5,
    phaseMode: 'per-channel-instantaneous-frequency;conjugate-symmetric-real-resynthesis',
    capturePolicy: 'next-global-hop-after-request-and-complete-connected-input-window',
    latencyPolicy: 'causal-N-frame-overlap-add;dry-preservation-is-an-explicit-host-choice',
    captureNormalization: 'attenuate-only-spectral-L1-bound-to-half-window-input-peak;no-silence-boost',
    storagePolicy: 'bounded-spectral-and-overlap-state;no-source-PCM-archive',
    qualification: 'implementation-awaiting-identity-latency-spectral-cost-and-listening-qualification' });
}
export const spectralFreezeIdentity = profile => canonicalDataText({ revision: profile.revision, sampleRate: profile.sampleRate, parameters: profile.parameters,
  hopFrames: profile.hopFrames, windowId: profile.windowId, overlapNormalization: profile.overlapNormalization, phaseMode: profile.phaseMode }).text;
