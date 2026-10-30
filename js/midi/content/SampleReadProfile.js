import { freezeData } from '../../core/CanonicalData.js';
export const SAMPLE_READ_BANK_ID = 'sample-read-v1';
export const SAMPLE_READ_TAPS = 128, SAMPLE_READ_PHASES = 128, SAMPLE_READ_RATE_STEPS = 8, SAMPLE_READ_LEVELS = 19, SAMPLE_READ_QUANTIZATION = 16777216;
export const SAMPLE_READ_TABLE_SAMPLES = SAMPLE_READ_TAPS * (SAMPLE_READ_PHASES + 1) * SAMPLE_READ_LEVELS;
export const SAMPLE_READ_PROFILE = freezeData({ revision: 'owned-sample-blackman-sinc128-phase128-rate8-v1', bankId: SAMPLE_READ_BANK_ID, taps: SAMPLE_READ_TAPS,
  phases: SAMPLE_READ_PHASES, rateLevels: SAMPLE_READ_LEVELS, maximumDerivative: 4, coefficientQuantization: 'signed-grid-2^-24-with-exact-row-DC-repair;not-signal-bit-depth',
  interpolation: 'convex-bilinear-phase-and-log-rate-coefficients', cutoff: '0.4/source-derivative-bound;two-lookahead-rate-rows',
  coefficientBytes: SAMPLE_READ_TABLE_SAMPLES * 4, processingLatencyFrames: 0, latencyScope: 'immutable-random-access-material;no-lookahead-physical-events',
  maximumSourceSamplesPerStereoRead: SAMPLE_READ_TAPS * 2, workingHeapEstimateBytes: 32768,
  boundaryPolicies: ['clamp', 'zero', 'wrap', 'reflect'], qualification: 'original-coefficients;awaiting-spectral-seam-cost-and-listening-measurements' });
