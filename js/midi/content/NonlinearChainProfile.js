import { NONLINEAR_FILTER_TABLES } from './NonlinearFilterTables.js';

export const NONLINEAR_KERNEL_REVISION = 'polyphase-cubic-fold-adaa1-v1';
export const NONLINEAR_STATE_ABI = 'nonlinear-chain-binary64-le-v1';
const finite = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
const keys = (v, allowed) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).every(key => allowed.includes(key));
export function prepareNonlinearChainProfile(input = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !keys(input, ['stages', 'antialiasMode', 'oversample', 'driveDb', 'inputHighpassHz', 'outputDcBlockHz', 'outputTrim01'])) throw new TypeError('Invalid nonlinear chain fields or rate.');
  const parameters = { stages: input.stages ?? [{ shape: 'cubic', driveDb: 0, bias: 0 }], antialiasMode: input.antialiasMode ?? 'adaa1', oversample: input.oversample ?? 2,
    driveDb: input.driveDb ?? 0, inputHighpassHz: input.inputHighpassHz ?? 100, outputDcBlockHz: input.outputDcBlockHz ?? 20, outputTrim01: input.outputTrim01 ?? 1 };
  if (!['direct', 'adaa1'].includes(parameters.antialiasMode) || ![1, 2, 4].includes(parameters.oversample) || !finite(parameters.driveDb, 0, 24) || !finite(parameters.outputTrim01, 0, 1) ||
      !(parameters.inputHighpassHz === 0 || finite(parameters.inputHighpassHz, 20, 400)) || !(parameters.outputDcBlockHz === 0 || finite(parameters.outputDcBlockHz, 20, 100)) ||
      !Array.isArray(parameters.stages) || !parameters.stages.length || parameters.stages.length > 4) throw new TypeError('Nonlinear chain exceeds its bounded profile.');
  parameters.stages = Object.freeze(parameters.stages.map(stage => {
    if (!keys(stage, ['shape', 'driveDb', 'bias']) || !['cubic', 'fold'].includes(stage.shape) || !finite(stage.driveDb, 0, 12) || !finite(stage.bias, -0.25, 0.25)) throw new TypeError('Invalid nonlinear transfer stage.');
    return Object.freeze({ shape: stage.shape, driveDb: stage.driveDb, bias: stage.bias });
  })); Object.freeze(parameters);
  const filter = parameters.oversample === 1 ? null : NONLINEAR_FILTER_TABLES.find(entry => entry.factor === parameters.oversample);
  const stageCount = parameters.stages.length, inputHistoryFrames = filter ? 17 : 0, filterFrames = filter?.coefficients.length || 0;
  const stateBytes = (inputHistoryFrames * 2 + filterFrames * 2 + stageCount * 2 + 8 + 4) * 8;
  const adaaDelay = parameters.antialiasMode === 'adaa1' ? stageCount * 0.5 / parameters.oversample : 0;
  const highpassTail = (parameters.inputHighpassHz ? Math.log(1000) / (2 * Math.PI * parameters.inputHighpassHz) : 0) + (parameters.outputDcBlockHz ? Math.log(1000) / (2 * Math.PI * parameters.outputDcBlockHz) : 0);
  const last = parameters.stages.at(-1), stageCap = last.shape === 'cubic' ? 2 / 3 : 1;
  return Object.freeze({ parameters, sampleRate, internalSampleRate: sampleRate * parameters.oversample, filter, inputHistoryFrames, filterFrames, stateBytes,
    processingLatencyFrames: (filter?.filterPairGroupDelayFrames || 0) + adaaDelay, maximumTailFrames: Math.ceil(highpassTail * sampleRate) + (filter ? 32 : 0) + stageCount + 2,
    maximumOutputAmplitude: (stageCap + Math.abs(last.bias)) * (filter?.l1 || 1) * (parameters.outputDcBlockHz ? 2 : 1),
    maximumLinearGain: 10 ** (24 / 20 + parameters.stages.reduce((sum, stage) => sum + stage.driveDb, 0) / 20) * (parameters.inputHighpassHz ? 2 : 1) * (filter ? parameters.oversample * filter.l1 * filter.l1 : 1) * (parameters.outputDcBlockHz ? 2 : 1),
    revision: NONLINEAR_KERNEL_REVISION, stateAbi: NONLINEAR_STATE_ABI, precision: 'javascript-binary64-state-and-arithmetic-float32-worklet-io',
    delayConvention: 'linear-phase-fir-plus-small-signal-adaa-group-delay', phasePolicy: 'highpass-and-adaa-magnitude-remain-frequency-dependent',
    inputDomain: 'finite-input-absolute-32-stage-domain-clamped-absolute-8', dcPolicy: 'stage-bias-response-subtracted-then-explicit-output-highpass',
    interpolation: filter ? 'polyphase-zero-insertion-fir' : 'none', decimationPhase: 0, feedback: 'none-inside-this-chain',
    stageOrdering: 'input-highpass-drive-upsampler-ordered-nonlinear-stages-downsampler-dc-block-trim',
    driveSmoothing: '8ms-one-pole-linear-amplitude-at-output-rate', qualification: 'implementation-awaiting-spectral-latency-cost-and-listening-qualification' });
}

export const nonlinearChainIdentity = profile => JSON.stringify({ revision: NONLINEAR_KERNEL_REVISION, sampleRate: profile.sampleRate, parameters: profile.parameters, filterHash: profile.filter?.coefficientHash || null });
