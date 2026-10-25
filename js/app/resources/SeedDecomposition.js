import { OwnedRadix2FFT } from '../midi-ui/worklet/OwnedRadix2FFT.js';
import { inspectSeedDerivedInput, encodeSeedDerivedAudio, seedDerivedFailure } from './SoundSeedDerivedAudio.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';

export const SEED_DECOMPOSITION_REVISION = 'linked-stereo-median-masks-v1';
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

export async function decomposeSoundSeed(input, { estimatedPeakBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) seedDerivedFailure('Seed decomposition generation changed.'); };
  check(); const source = inspectSeedDerivedInput(input, ['options']), { frames, sampleRate, sample } = source;
  const options = input.options ?? {}, size = options.fftSize ?? 2048, temporalWidth = options.temporalWidth ?? 17, frequencyWidth = options.frequencyWidth ?? 17,
    sustainedMargin = options.sustainedMargin ?? 2, transientMargin = options.transientMargin ?? 2;
  if (Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key => !['fftSize', 'temporalWidth', 'frequencyWidth', 'sustainedMargin', 'transientMargin'].includes(key)) ||
      ![512, 1024, 2048].includes(size) || !integer(temporalWidth, 3, 31) || !(temporalWidth & 1) || !integer(frequencyWidth, 3, 31) || !(frequencyWidth & 1) ||
      !Number.isFinite(sustainedMargin) || sustainedMargin < 1 || sustainedMargin > 8 || !Number.isFinite(transientMargin) || transientMargin < 1 || transientMargin > 8) seedDerivedFailure('Unsupported bounded FFT, median width or mask margin.');
  const hop = size / 4, count = Math.ceil(frames / hop) + 1, bins = size / 2 + 1, cells = count * bins;
  const requiredBytes = 32 * 1048576 + input.pcm.length * 16 + cells * 12;
  if (cells > 2100000 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < requiredBytes || estimatedPeakBytes > 512 * 1048576) seedDerivedFailure('The decomposition exceeds its admitted matrix/frame workspace.');
  const fft = new OwnedRadix2FFT(size), real = new Float64Array(size), imaginary = new Float64Array(size), window = new Float64Array(size), magnitudes = new Float32Array(cells), sustained = new Float32Array(cells), transient = new Float32Array(cells), scratch = new Float32Array(Math.max(temporalWidth, frequencyWidth));
  for (let index = 0; index < size; index++) window[index] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * index / size));
  const load = (time, channel) => {
    const start = time * hop - size / 2; imaginary.fill(0);
    for (let index = 0; index < size; index++) { const frame = start + index; real[index] = (frame >= 0 && frame < frames ? sample(frame, channel) : 0) * window[index]; }
    fft.transform(real, imaginary);
  };
  for (let time = 0; time < count; time++) {
    check();
    for (let channel = 0; channel < 2; channel++) { load(time, channel); for (let bin = 0; bin < bins; bin++) magnitudes[time * bins + bin] += (real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) / 2; }
    for (let bin = 0; bin < bins; bin++) magnitudes[time * bins + bin] = Math.sqrt(magnitudes[time * bins + bin]);
    if (!(time % 8)) { onProgress({ phase: 'linked-stereo-spectrogram', completedUnits: time, totalUnits: count }); await yieldControl(); }
  }
  const median = width => {
    // An in-place bounded insertion sort avoids a new JS object per spectral bin.
    for (let at = 1; at < width; at++) { const value = scratch[at]; let before = at - 1; while (before >= 0 && scratch[before] > value) { scratch[before + 1] = scratch[before]; before--; } scratch[before + 1] = value; }
    return scratch[Math.floor(width / 2)];
  };
  for (let time = 0; time < count; time++) {
    check();
    for (let bin = 0; bin < bins; bin++) {
      for (let index = 0; index < temporalWidth; index++) scratch[index] = magnitudes[Math.max(0, Math.min(count - 1, time + index - (temporalWidth - 1) / 2)) * bins + bin];
      const h = median(temporalWidth);
      for (let index = 0; index < frequencyWidth; index++) scratch[index] = magnitudes[time * bins + Math.max(0, Math.min(bins - 1, bin + index - (frequencyWidth - 1) / 2))];
      const p = median(frequencyWidth), hh = h * h, pp = p * p, at = time * bins + bin;
      if (hh || pp) { sustained[at] = hh / (hh + sustainedMargin * sustainedMargin * pp); transient[at] = pp / (pp + transientMargin * transientMargin * hh); }
    }
    if (!(time % 4)) { onProgress({ phase: 'median-component-masks', completedUnits: time, totalUnits: count }); await yieldControl(); }
  }
  const outputs = [new Float64Array(frames * 2), new Float64Array(frames * 2)], weights = new Float64Array(frames), savedReal = new Float64Array(size), savedImaginary = new Float64Array(size);
  for (let time = 0; time < count; time++) {
    check(); const start = time * hop - size / 2;
    for (let index = 0; index < size; index++) { const frame = start + index; if (frame >= 0 && frame < frames) weights[frame] += window[index] * window[index]; }
    for (let channel = 0; channel < 2; channel++) {
      load(time, channel); savedReal.set(real); savedImaginary.set(imaginary);
      for (let component = 0; component < 2; component++) {
        const mask = component ? sustained : transient;
        for (let bin = 0; bin < size; bin++) { const mirrored = bin <= size / 2 ? bin : size - bin, gain = mask[time * bins + mirrored]; real[bin] = savedReal[bin] * gain; imaginary[bin] = savedImaginary[bin] * gain; }
        fft.transform(real, imaginary, true);
        for (let index = 0; index < size; index++) { const frame = start + index; if (frame >= 0 && frame < frames) outputs[component][frame * 2 + channel] += real[index] * window[index]; }
      }
    }
    if (!(time % 8)) { onProgress({ phase: 'phase-preserving-component-synthesis', completedUnits: time, totalUnits: count }); await yieldControl(); }
  }
  const pcm = Array.from({ length: 4 }, () => new Uint8Array(frames * 8)), views = pcm.map(bytes => new DataView(bytes.buffer));
  let squares = 0, maximumError = 0, errorSquares = 0;
  for (let first = 0; first < frames; first += 16384) {
    check();
    for (let frame = first; frame < Math.min(frames, first + 16384); frame++) for (let channel = 0; channel < 2; channel++) {
      if (weights[frame] < 1e-12) seedDerivedFailure('The declared overlap-add window left an uncovered source frame.');
      const original = sample(frame, channel), transientValue = Math.fround(outputs[0][frame * 2 + channel] / weights[frame]), sustainedValue = Math.fround(outputs[1][frame * 2 + channel] / weights[frame]), residual = Math.fround(original - transientValue - sustainedValue);
      const difference = transientValue + sustainedValue + residual - original; maximumError = Math.max(maximumError, Math.abs(difference)); errorSquares += difference * difference; squares += original * original;
      views[0].setFloat32(frame * 8 + channel * 4, transientValue, true); views[1].setFloat32(frame * 8 + channel * 4, sustainedValue, true); views[2].setFloat32(frame * 8 + channel * 4, residual, true); views[3].setFloat32(frame * 8 + channel * 4, Math.fround(transientValue + sustainedValue + residual), true);
    }
    await yieldControl();
  }
  const recipe = freezeData({ algorithmRevision: SEED_DECOMPOSITION_REVISION, parentAssetHash: source.source.immutableSourceRef, regionFrames: [source.firstFrame, source.endFrame], sourceRate: sampleRate,
    fftSize: size, hopFrames: hop, observationFrames: frames, window: 'periodic-square-root-Hann', centerPaddingFrames: size / 2, boundary: 'zero-padding', outputDelayFrames: 0, outputCropFrames: [0, frames],
    medianWidths: { temporalFrames: temporalWidth, frequencyBins: frequencyWidth }, medianBoundary: 'nearest-edge-replication', maskMargins: { sustained: sustainedMargin, transient: transientMargin },
    maskPower: 2, stereoMask: 'linked-root-mean-channel-spectral-power;identical-real-masks-for-both-complex-spectra', residual: 'actual-time-domain-complement-after-Float32-component-quantization', normalization: 'none' });
  const recipeHash = await hashData(recipe), components = [];
  for (let index = 0; index < 4; index++) { check(); const kind = ['transient-like', 'sustained-like', 'residual', 'neutral-recombined'][index]; components.push({ kind, ...await encodeSeedDerivedAudio(pcm[index], source, { ...recipe, recipeHash, component: kind }, { check, yieldControl }) }); }
  check(); const reconstruction = { comparedFrames: frames, channels: 2, maximumAbsoluteError: maximumError, rmsError: Math.sqrt(errorSquares / (frames * 2)), sourceRms: Math.sqrt(squares / (frames * 2)),
    relativeRmsError: squares ? Math.sqrt(errorSquares / squares) : 0, evidence: 'measured-neutral-Float32-sum-after-declared-crop;not-perceptual-source-isolation' };
  return { value: { schema: 'lemmings-seed-decomposition/v1', generation: source.generation, recipe, recipeHash, components: components.slice(0, 3), recombined: components[3], reconstruction }, inputBytes: input.pcm.length + input.originBytes.length, nodes: 4096,
    retainedBytes: components.reduce((sum, component) => sum + component.bytes.length + component.waveform.minMax.byteLength, 262144) };
}
