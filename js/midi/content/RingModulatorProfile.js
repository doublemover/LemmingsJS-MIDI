import { NONLINEAR_FILTER_TABLES } from './NonlinearFilterTables.js';
import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const RING_MODULATOR_REVISION = 'owned-stereo-ring-polyphase2-v1';
export function prepareRingModulatorProfile(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype ||
      Object.keys(raw).some(key => !['donorLayout', 'drive01', 'highpassHz', 'outputTrim01'].includes(key))) throw new TypeError('Invalid ring modulator definition.');
  const parameters = { donorLayout: 'audioStereo', drive01: 1, highpassHz: 100, outputTrim01: 1, ...raw };
  if (!['audioMono', 'audioStereo'].includes(parameters.donorLayout) || !Number.isFinite(parameters.drive01) || parameters.drive01 < 0 || parameters.drive01 > 2 ||
      !Number.isFinite(parameters.highpassHz) || parameters.highpassHz < 20 || parameters.highpassHz > 400 ||
      !Number.isFinite(parameters.outputTrim01) || parameters.outputTrim01 < 0 || parameters.outputTrim01 > 1) throw new RangeError('Ring modulation exceeds its admitted drive, highpass or trim.');
  const filter = NONLINEAR_FILTER_TABLES.find(entry => entry.factor === 2), historyFrames = 17, filterFrames = filter.coefficients.length;
  const maximumLinearGain = 4 * filter.l1 * filter.l1 * parameters.outputTrim01;
  return freezeData({ revision: RING_MODULATOR_REVISION, parameters, sampleRate, internalSampleRate: sampleRate * 2, filter, historyFrames, filterFrames,
    stateBytes: (historyFrames * 4 + filterFrames * 2 + 8) * 8, processingLatencyFrames: filter.filterPairGroupDelayFrames,
    maximumTailFrames: Math.ceil(sampleRate * Math.log(1e9) / (2 * Math.PI * parameters.highpassHz)) + 32,
    maximumLinearGain, maximumOutputAmplitude: maximumLinearGain * 32, stateBound: 512,
    donorPolicy: 'bipolar-amplitude-clamped-after-fixed-drive;no-AGC', interpolation: 'two-independent-polyphase-zero-insertion-FIR-inputs',
    decimation: 'shared-original-FIR-phase-zero', highpass: 'independent-one-pole-donor-and-carrier',
    phasePolicy: 'declared-FIR-delay-plus-frequency-dependent-highpass', missingSource: 'zero-input-with-owned-filter-memory-drain',
    qualification: 'implementation-awaiting-sideband-alias-latency-cost-and-listening-qualification' });
}
export const ringModulatorIdentity = profile => canonicalDataText({ revision: profile.revision, sampleRate: profile.sampleRate,
  parameters: profile.parameters, filterHash: profile.filter.coefficientHash, coefficients: profile.filter.coefficients }).text;
