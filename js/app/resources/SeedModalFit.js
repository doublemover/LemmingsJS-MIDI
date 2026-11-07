import { OwnedRadix2FFT } from '../midi-ui/worklet/OwnedRadix2FFT.js';
import { inspectSeedDerivedInput, encodeSeedDerivedAudio, seedDerivedFailure } from './SoundSeedDerivedAudio.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';

export const SEED_MODAL_FIT_REVISION = 'coarse-local-stereo-decay-fit-v1';
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fitLine = points => {
  const n = points.length, meanX = points.reduce((sum, point) => sum + point[0], 0) / n, meanY = points.reduce((sum, point) => sum + point[1], 0) / n;
  let xx = 0, xy = 0, yy = 0;
  for (const [x, y] of points) { xx += (x - meanX) ** 2; xy += (x - meanX) * (y - meanY); yy += (y - meanY) ** 2; }
  const slope = xx > 0 ? xy / xx : 0;
  return { slope, intercept: meanY - slope * meanX, rSquared: xx && yy ? Math.max(0, Math.min(1, xy * xy / (xx * yy))) : 0 };
};

export async function fitSoundSeedModes(input, { estimatedPeakBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) seedDerivedFailure('Modal fit generation changed.'); };
  check(); const source = inspectSeedDerivedInput(input, ['options']), { sampleRate, frames, sample } = source, options = input.options ?? {};
  const observationFrames = options.observationFrames ?? Math.min(frames, 65536), fftSize = options.fftSize ?? 2 ** Math.ceil(Math.log2(Math.max(512, observationFrames))),
    maxModes = options.maxModes ?? 8, minimumHz = options.minimumHz ?? 40, maximumHz = options.maximumHz ?? Math.min(12000, sampleRate * 0.4),
    minimumT60 = options.minimumT60 ?? 0.03, maximumT60 = options.maximumT60 ?? 8, manualModes = options.manualModes ?? null, pinnedModes = options.pinnedModes ?? [];
  const validModes = (modes, allowEmpty) => Array.isArray(modes) && (allowEmpty || modes.length > 0) && modes.length <= maxModes && new Set(modes.map(mode => mode?.id)).size === modes.length && modes.every(mode => mode && Object.keys(mode).every(key => ['id', 'frequencyHz', 't60Seconds', 'pinned'].includes(key)) && typeof mode.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(mode.id) && finite(mode.frequencyHz, minimumHz, maximumHz) && finite(mode.t60Seconds, minimumT60, maximumT60) && typeof mode.pinned === 'boolean');
  if (Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key => !['observationFrames', 'fftSize', 'maxModes', 'minimumHz', 'maximumHz', 'minimumT60', 'maximumT60', 'manualModes', 'pinnedModes'].includes(key)) ||
      !integer(observationFrames, 512, Math.min(frames, 65536)) || !integer(fftSize, observationFrames, 65536) || (fftSize & (fftSize - 1)) || !integer(maxModes, 1, 8) ||
      !finite(minimumHz, 20, sampleRate * 0.4) || !finite(maximumHz, minimumHz + 1, Math.min(20000, sampleRate * 0.4)) || !finite(minimumT60, 0.02, 1) || !finite(maximumT60, minimumT60, 8) ||
      (manualModes !== null && !validModes(manualModes, false) || !validModes(pinnedModes, true) || pinnedModes.some(mode => !mode.pinned))) seedDerivedFailure('Modal analysis needs bounded observation/FFT, register, amplitude T60 and mode-selection parameters.');
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 64 * 1048576 + input.pcm.length * 16 || estimatedPeakBytes > 512 * 1048576) seedDerivedFailure('The modal fit exceeds its admitted observation and reconstruction workspace.');
  const fft = new OwnedRadix2FFT(fftSize, { offlineMaximumSize: 65536 }), real = new Float64Array(fftSize), imaginary = new Float64Array(fftSize), power = new Float64Array(fftSize / 2 + 1);
  let sourceSquares = 0, clippedSamples = 0;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) { const value = sample(frame, channel); sourceSquares += value * value; clippedSamples += Number(Math.abs(value) > 1); }
  for (let channel = 0; channel < 2; channel++) {
    check(); real.fill(0); imaginary.fill(0);
    for (let frame = 0; frame < observationFrames; frame++) real[frame] = sample(frame, channel) * (0.5 - 0.5 * Math.cos(2 * Math.PI * frame / (observationFrames - 1)));
    fft.transform(real, imaginary); for (let bin = 0; bin < power.length; bin++) power[bin] += real[bin] ** 2 + imaginary[bin] ** 2;
    await yieldControl();
  }
  const firstBin = Math.max(2, Math.ceil(minimumHz * fftSize / sampleRate)), lastBin = Math.min(power.length - 3, Math.floor(maximumHz * fftSize / sampleRate)), peaks = [];
  let peakPower = 0; for (let bin = firstBin; bin <= lastBin; bin++) peakPower = Math.max(peakPower, power[bin]);
  for (let bin = firstBin; bin <= lastBin; bin++) if (power[bin] >= peakPower * 1e-3 && power[bin] > 1e-16 && power[bin] > power[bin - 1] && power[bin] >= power[bin + 1]) {
    const a = Math.log(Math.max(1e-30, power[bin - 1])), b = Math.log(power[bin]), c = Math.log(Math.max(1e-30, power[bin + 1])), denominator = a - 2 * b + c,
      correction = denominator ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator)) : 0;
    peaks.push({ frequencyHz: (bin + correction) * sampleRate / fftSize, power: power[bin], bin });
  }
  peaks.sort((a, b) => b.power - a.power || a.frequencyHz - b.frequencyHz);
  const selectedPeaks = [], resolutionHz = 2 * sampleRate / observationFrames;
  for (const peak of peaks) if (selectedPeaks.length < maxModes && selectedPeaks.every(other => Math.abs(other.frequencyHz - peak.frequencyHz) >= resolutionHz)) selectedPeaks.push(peak);
  const trackFrames = Math.max(256, Math.min(8192, 2 ** Math.floor(Math.log2(frames / 4)))), trackHop = trackFrames / 2;
  const trackWindow = Float64Array.from({ length: trackFrames }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (trackFrames - 1)));
  const track = async frequencyHz => {
    const observations = [], step = 2 * Math.PI * frequencyHz / sampleRate, c = Math.cos(step), s = Math.sin(step);
    for (let first = 0; first + trackFrames <= frames; first += trackHop) {
      check(); let cosine = Math.cos(step * first), sine = Math.sin(step * first), lReal = 0, lImaginary = 0, rReal = 0, rImaginary = 0;
      for (let index = 0; index < trackFrames; index++) {
        const weight = trackWindow[index], l = sample(first + index, 0) * weight, r = sample(first + index, 1) * weight;
        lReal += l * cosine; lImaginary -= l * sine; rReal += r * cosine; rImaginary -= r * sine;
        const next = cosine * c - sine * s; sine = sine * c + cosine * s; cosine = next;
      }
      observations.push({ seconds: (first + trackFrames / 2) / sampleRate, amplitude: 4 * Math.sqrt((lReal ** 2 + lImaginary ** 2 + rReal ** 2 + rImaginary ** 2) / 2) / trackFrames,
        leftPhase: Math.atan2(lImaginary, lReal), rightPhase: Math.atan2(rImaginary, rReal), leftPower: lReal ** 2 + lImaginary ** 2, rightPower: rReal ** 2 + rImaginary ** 2 });
      if (!(observations.length % 8)) await yieldControl();
    }
    return observations;
  };
  const automatic = selectedPeaks.filter(peak => pinnedModes.every(mode => Math.abs(mode.frequencyHz - peak.frequencyHz) >= resolutionHz)).slice(0, maxModes - pinnedModes.length);
  const usedIds = new Set(pinnedModes.map(mode => mode.id));
  const candidates = manualModes ?? [...pinnedModes, ...automatic.map(peak => { let id = 'mode-bin-' + peak.bin; while (usedIds.has(id)) id += '-a'; usedIds.add(id); return { id, frequencyHz: peak.frequencyHz, pinned: false }; })], modes = [], declined = [];
  for (const candidate of candidates) {
    check(); const manuallySpecified = manualModes !== null || candidate.pinned; let frequencyHz = candidate.frequencyHz, observations = await track(frequencyHz);
    if (!manuallySpecified && observations.length >= 4) {
      const useLeft = observations.reduce((sum, row) => sum + row.leftPower - row.rightPower, 0) >= 0; let last = null, unwrapped = 0;
      const phaseFloor = Math.max(...observations.map(row => row.amplitude)) * 0.001;
      const phasePoints = observations.filter(row => row.amplitude > phaseFloor).map(row => { const phase = useLeft ? row.leftPhase : row.rightPhase;
        if (last !== null) { let delta = phase - last; while (delta > Math.PI) delta -= 2 * Math.PI; while (delta < -Math.PI) delta += 2 * Math.PI; unwrapped += delta; } else unwrapped = phase; last = phase; return [row.seconds, unwrapped]; });
      const correction = fitLine(phasePoints).slope / (2 * Math.PI);
      if (finite(correction, -sampleRate / fftSize, sampleRate / fftSize) && finite(frequencyHz + correction, minimumHz, maximumHz)) { frequencyHz += correction; observations = await track(frequencyHz); }
    }
    const largest = Math.max(0, ...observations.map(row => row.amplitude)), points = observations.filter(row => row.amplitude > Math.max(1e-10, largest * 0.001)).map(row => [row.seconds, Math.log(row.amplitude)]), decay = points.length >= 4 ? fitLine(points) : null;
    const inferredT60 = decay && decay.slope < 0 ? -Math.log(1000) / decay.slope : null, t60Seconds = manuallySpecified ? candidate.t60Seconds : inferredT60;
    if (!finite(t60Seconds, minimumT60, maximumT60) || !manuallySpecified && (!decay || decay.rSquared < 0.65)) { declined.push({ id: candidate.id, frequencyHz, reason: !decay ? 'insufficient-observed-decay' : decay.slope >= 0 ? 'nondecaying-or-growing-track' : !finite(t60Seconds, minimumT60, maximumT60) ? 'decay-outside-declared-T60-range' : 'ambiguous-or-nonexponential-track', observedRSquared: decay?.rSquared ?? null }); continue; }
    const step = 2 * Math.PI * frequencyHz / sampleRate, cosineStep = Math.cos(step), sineStep = Math.sin(step), damping = Math.exp(-Math.log(1000) / (t60Seconds * sampleRate));
    let cosine = 1, sine = 0, envelope = 1, cc = 0, ss = 0, cs = 0, lc = 0, ls = 0, rc = 0, rs = 0;
    for (let first = 0; first < frames; first += 16384) {
      check(); for (let frame = first; frame < Math.min(frames, first + 16384); frame++) {
        const a = cosine * envelope, b = sine * envelope; cc += a * a; ss += b * b; cs += a * b; lc += sample(frame, 0) * a; ls += sample(frame, 0) * b; rc += sample(frame, 1) * a; rs += sample(frame, 1) * b;
        const next = cosine * cosineStep - sine * sineStep; sine = sine * cosineStep + cosine * sineStep; cosine = next; envelope *= damping;
      } await yieldControl();
    }
    const determinant = cc * ss - cs * cs;
    if (!Number.isFinite(determinant) || determinant <= 1e-12) { declined.push({ id: candidate.id, frequencyHz, reason: 'ill-conditioned-mode-basis', observedRSquared: decay?.rSquared ?? null }); continue; }
    const leftCos = (lc * ss - ls * cs) / determinant, leftSin = (ls * cc - lc * cs) / determinant, rightCos = (rc * ss - rs * cs) / determinant, rightSin = (rs * cc - rc * cs) / determinant;
    const duration = frames / sampleRate, decayObservedT60Fraction = duration / t60Seconds;
    modes.push({ id: candidate.id, frequencyHz, t60Seconds, amplitude: Math.sqrt((leftCos ** 2 + leftSin ** 2 + rightCos ** 2 + rightSin ** 2) / 2),
      channels: [{ amplitude: Math.hypot(leftCos, leftSin), phase: Math.atan2(-leftSin, leftCos) }, { amplitude: Math.hypot(rightCos, rightSin), phase: Math.atan2(-rightSin, rightCos) }],
      coefficients: [leftCos, leftSin, rightCos, rightSin], confidence: { level: manuallySpecified ? 'manual-selection;not-inferred-certainty' : clippedSamples || decayObservedT60Fraction < 0.15 ? 'low' : decay.rSquared >= 0.95 ? 'moderate-baseline-estimate' : 'low',
        amplitudeDecayRSquared: decay?.rSquared ?? null, observedT60Fraction: decayObservedT60Fraction, minimumResolvableSeparationHz: resolutionHz,
        closeModes: 'not-guaranteed-resolved-below-observation-resolution', physicalMaterialInference: false }, pinned: candidate.pinned, fitRegion: [source.firstFrame, source.endFrame] });
    onProgress({ phase: 'local-frequency-and-amplitude-decay-fit', completedUnits: modes.length + declined.length, totalUnits: candidates.length });
  }
  const reconstruction = new Float64Array(frames * 2);
  for (const mode of modes) {
    const step = 2 * Math.PI * mode.frequencyHz / sampleRate, c = Math.cos(step), s = Math.sin(step), damping = Math.exp(-Math.log(1000) / (mode.t60Seconds * sampleRate)); let cosine = 1, sine = 0, envelope = 1;
    for (let first = 0; first < frames; first += 16384) {
      check(); for (let frame = first; frame < Math.min(frames, first + 16384); frame++) { reconstruction[frame * 2] += envelope * (mode.coefficients[0] * cosine + mode.coefficients[1] * sine); reconstruction[frame * 2 + 1] += envelope * (mode.coefficients[2] * cosine + mode.coefficients[3] * sine);
        const next = cosine * c - sine * s; sine = sine * c + cosine * s; cosine = next; envelope *= damping; } await yieldControl();
    }
  }
  const pcm = [new Uint8Array(frames * 8), new Uint8Array(frames * 8)], views = pcm.map(bytes => new DataView(bytes.buffer)); let residualSquares = 0, maximumError = 0;
  for (let first = 0; first < frames; first += 16384) {
    check(); for (let frame = first; frame < Math.min(frames, first + 16384); frame++) for (let channel = 0; channel < 2; channel++) { const value = Math.fround(reconstruction[frame * 2 + channel]), original = sample(frame, channel), residual = Math.fround(original - value);
      views[0].setFloat32(frame * 8 + channel * 4, value, true); views[1].setFloat32(frame * 8 + channel * 4, residual, true); residualSquares += residual * residual; maximumError = Math.max(maximumError, Math.abs(value + residual - original)); } await yieldControl();
  }
  const recipe = freezeData({ algorithmRevision: SEED_MODAL_FIT_REVISION, parentAssetHash: source.source.immutableSourceRef, regionFrames: [source.firstFrame, source.endFrame], sourceRate: sampleRate,
    observationFrames, fftSize, zeroPaddingFrames: fftSize - observationFrames, observationWindow: 'symmetric-Hann', observationSeconds: observationFrames / sampleRate, resolutionHz,
    localTrackFrames: trackFrames, localTrackHopFrames: trackHop, frequencyRange: [minimumHz, maximumHz], amplitudeT60Range: [minimumT60, maximumT60], maxModes, manualModes, pinnedModes,
    outputDelayFrames: 0, outputCropFrames: [0, frames], solver: 'coarse-log-parabolic-peaks;local-phase-slope;log-amplitude-decay;stereo-two-basis-least-squares',
    rootPitch: 'not-inferred', modelMeaning: 'editable-damped-sinusoid-approximation;not-material-or-geometry-identification' });
  const recipeHash = await hashData(recipe), components = [];
  for (let index = 0; index < 2; index++) { const kind = index ? 'modal-residual' : 'modal-reconstruction'; components.push({ kind, ...await encodeSeedDerivedAudio(pcm[index], source, { ...recipe, recipeHash, component: kind }, { check, yieldControl }) }); }
  const spectrumBlock = Math.max(1, Math.ceil(power.length / 2048)), decibels = [];
  for (let first = 0; first < power.length; first += spectrumBlock) { let maximum = 0; for (let bin = first; bin < Math.min(power.length, first + spectrumBlock); bin++) maximum = Math.max(maximum, power[bin]); decibels.push(peakPower ? Math.max(-120, 10 * Math.log10(Math.max(1e-30, maximum / peakPower))) : -120); }
  check(); const estimate = freezeData({ schema: 'lemmings-modal-estimate/v1', status: modes.length ? 'baseline-estimate;manual-review-required' : 'declined', spectrum: { decibels, frequencyStepHz: spectrumBlock * sampleRate / fftSize, reference: 'maximum-linked-stereo-power-in-declared-register', observationFrames, fftSize }, modes: modes.map(({ coefficients, ...mode }) => mode), declined,
    clippedSamples, silence: sourceSquares < 1e-16, modelRmsError: Math.sqrt(residualSquares / (frames * 2)), relativeModelRmsError: sourceSquares ? Math.sqrt(residualSquares / sourceSquares) : 0,
    neutralComplementMaximumError: maximumError, qualification: 'numerical-baseline-unqualified;no-root-or-perceptual-accuracy-claim' });
  return { value: { schema: 'lemmings-seed-modal-fit/v1', generation: source.generation, recipe, recipeHash, components, estimate, reconstruction: { maximumAbsoluteError: maximumError, rmsError: estimate.modelRmsError, comparedFrames: frames, channels: 2, evidence: 'model-plus-actual-residual;model-error-is-reported-separately' } },
    inputBytes: input.pcm.length + input.originBytes.length, nodes: 8192, retainedBytes: components.reduce((sum, entry) => sum + entry.bytes.length + entry.waveform.minMax.byteLength, 1048576) };
}
