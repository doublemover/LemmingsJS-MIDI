import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const VOCODER_BANK_REVISION = 'owned-configurable-biquad-vocoder-v1';
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fields = ['bands', 'lowHz', 'highHz', 'bandwidthRatio', 'donorLayout', 'stereoLink', 'referenceAmplitude', 'attackSeconds', 'releaseSeconds', 'depth01', 'baseline01', 'wetTrim01', 'dry01', 'bandGains'];
const fingerprint = bands => {
  const bytes = new Uint8Array(bands.length * 32), view = new DataView(bytes.buffer); let at = 0;
  for (const band of bands) for (const coefficient of band.coefficients) { view.setFloat64(at, coefficient, true); at += 8; }
  let hash = 0xcbf29ce484222325n; for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
};
export function prepareVocoderBankProfile(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !fields.includes(key))) throw new TypeError('Invalid configurable vocoder fields or rate.');
  const p = { bands: 16, lowHz: 120, highHz: 6000, bandwidthRatio: 1, donorLayout: 'audioStereo', stereoLink: 'mean-power', referenceAmplitude: 0.25,
    attackSeconds: 0.004, releaseSeconds: 0.08, depth01: 0.7, baseline01: 0.1, wetTrim01: 0.25, dry01: 0, ...raw };
  if (![8, 12, 16, 32].includes(p.bands)) throw new RangeError('Unsupported bounded vocoder band count.');
  if (raw.bandGains !== undefined && (!Array.isArray(raw.bandGains) || raw.bandGains.length !== p.bands)) throw new TypeError('Vocoder band gains must match the prepared bank.');
  p.bandGains = raw.bandGains === undefined ? Array(p.bands).fill(1) : raw.bandGains.slice();
  if (![8, 12, 16, 32].includes(p.bands) || !finite(p.lowHz, 80, 2000) || !finite(p.highHz, p.lowHz * 2, 12000) || !finite(p.bandwidthRatio, 0.5, 2) ||
      !['audioMono', 'audioStereo'].includes(p.donorLayout) || !['maximum', 'mean-power'].includes(p.stereoLink) || !finite(p.referenceAmplitude, 0.001, 32) ||
      !finite(p.attackSeconds, 0, 0.1) || !finite(p.releaseSeconds, 0, 1.2) || !finite(p.depth01, 0, 1) || !finite(p.baseline01, 0, 1) || p.baseline01 + p.depth01 > 1 ||
      !finite(p.wetTrim01, 0, 0.5) || !finite(p.dry01, 0, 1) || !Array.isArray(p.bandGains) || p.bandGains.length !== p.bands || p.bandGains.some(value => !finite(value, 0, 1))) throw new RangeError('Vocoder bank exceeds its bounded topology, envelope or gain domain.');
  const ratio = (p.highHz / p.lowHz) ** (1 / p.bands), bands = []; let maximumFilterTail = 0, summedBound = 0;
  for (let i = 0; i < p.bands; i++) {
    const centerHz = p.lowHz * ratio ** (i + 0.5), nominalBandwidthHz = centerHz * (Math.sqrt(ratio) - 1 / Math.sqrt(ratio)) * p.bandwidthRatio, q = centerHz / nominalBandwidthHz;
    if (!finite(q, 1, 24) || centerHz + nominalBandwidthHz / 2 >= sampleRate * 0.4) throw new RangeError('Vocoder center/bandwidth is outside its sample-rate-aware safe domain.');
    const omega = 2 * Math.PI * centerHz / sampleRate, alpha = Math.sin(omega) / (2 * q), b0 = alpha / (1 + alpha), b2 = -b0, a1 = -2 * Math.cos(omega) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
    if (Math.min(1 - a2, 1 + a1 + a2, 1 - a1 + a2) <= 1e-8 || a2 <= 0 || a1 * a1 >= 4 * a2) throw new RangeError('Vocoder poles fail the admitted stable complex-pair domain.');
    const radius = Math.sqrt(a2), cosine = -a1 / (2 * radius), sine = Math.sqrt(1 - cosine * cosine);
    const amplitude = Math.hypot((a2 - 1) * cosine / sine, a2 + 1);
    const absoluteImpulseSumBound = b0 * (1 + Math.abs(a1) + amplitude / (1 - radius));
    const stateBound = 32 * (Math.abs(b2) + (1 + Math.abs(a1) + Math.abs(a2)) * absoluteImpulseSumBound) * 1.000001;
    const filterTailFrames = Math.ceil(Math.log(1e-9) / Math.log(radius)); maximumFilterTail = Math.max(maximumFilterTail, filterTailFrames); summedBound += absoluteImpulseSumBound * p.bandGains[i];
    bands.push({ centerHz, nominalBandwidthHz, q, coefficients: [b0, b2, a1, a2], poleRadius: radius, absoluteImpulseSumBound, stateBound, filterTailFrames });
  }
  const sumScale = 1 / Math.sqrt(p.bands), maximumLinearGain = p.dry01 + p.wetTrim01 * sumScale * summedBound;
  const maximumTailFrames = 2 * maximumFilterTail + Math.ceil(p.releaseSeconds * sampleRate * Math.log(1e9));
  if (!Number.isFinite(maximumLinearGain) || maximumLinearGain > 8 || maximumTailFrames > sampleRate * 30) throw new RangeError('Vocoder sum or complete release exceeds the bounded profile.');
  return freezeData({ revision: VOCODER_BANK_REVISION, sampleRate, parameters: p, bands, coefficientFingerprint: fingerprint(bands),
    stateBytes: p.bands * 13 * 8, filterCount: p.bands * (p.donorLayout === 'audioMono' ? 3 : 4), followerCount: p.bands, coefficientFingerprintAlgorithm: 'FNV1a64-binary64-LE-state-compatibility-only;full-bank-bound-by-SHA256-graph-identity', processingLatencyFrames: 0, lookaheadFrames: 0, maximumTailFrames, maximumLinearGain, maximumOutputAmplitude: maximumLinearGain * 32, sumScale,
    attackCoefficient: p.attackSeconds === 0 ? 0 : Math.exp(-1 / (p.attackSeconds * sampleRate)), releaseCoefficient: p.releaseSeconds === 0 ? 0 : Math.exp(-1 / (p.releaseSeconds * sampleRate)),
    realization: 'RBJ-constant-zero-dB-peak-bandpass-transposed-direct-form-II-binary64', coefficientOrder: 'b0,b2,a1,a2;b1=0;a0=1',
    frequencyDomain: 'geometric-cell-centres-with-explicit-nominal-bandwidth-and-digital-coefficients',
    latencyPolicy: 'reactive-no-lookahead;frequency-dependent-filter-phase-not-compensated', envelopeConvention: 'linked-filtered-amplitude-one-pole-1-over-e',
    normalization: 'fixed-reference-donor;constant-peak-carrier-filters;one-over-sqrt-band-count;authored-fixed-trim;no-AGC',
    calibrationReference: 'unit-peak-sine-at-each-centre;overlapping-bank-response-awaiting-measurement', missingDonor: 'zero-input-filter-decay-and-envelope-release-to-authored-baseline',
    qualification: 'implementation-awaiting-band-sweep-levelmatched-listening-and-device-cost-qualification' });
}
export const vocoderBankIdentity = profile => canonicalDataText({ revision: profile.revision, sampleRate: profile.sampleRate, parameters: profile.parameters, coefficientFingerprint: profile.coefficientFingerprint }).text;
export const vocoderRealizationKey = profile => canonicalDataText({ revision: profile.revision, sampleRate: profile.sampleRate, bands: profile.bands, sumScale: profile.sumScale }).text;
