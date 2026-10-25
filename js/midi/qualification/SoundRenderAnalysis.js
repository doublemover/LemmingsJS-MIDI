const fail = message => { throw new TypeError('Sound measurement: ' + message); };
const limit = 64 * 1048576;
function spectrum(samples, first, size) {
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  for (let i = 0; i < size; i++) real[i] = (Number.isFinite(samples[first + i]) ? samples[first + i] : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) { let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { const value = real[i]; real[i] = real[j]; real[j] = value; } }
  for (let width = 2; width <= size; width <<= 1) { const angle = -2 * Math.PI / width;
    for (let first = 0; first < size; first += width) for (let j = 0; j < width / 2; j++) {
      const at = first + j, other = at + width / 2, cosine = Math.cos(angle * j), sine = Math.sin(angle * j);
      const r = real[other] * cosine - imaginary[other] * sine, im = real[other] * sine + imaginary[other] * cosine;
      real[other] = real[at] - r; imaginary[other] = imaginary[at] - im; real[at] += r; imaginary[at] += im;
    }
  }
  return real.subarray(0, size / 2).map((value, i) => value * value + imaginary[i] * imaginary[i]);
}
export function measureSoundRender(planes, sampleRate, { fundamentalHz = null, silenceAmplitude = 1e-5 } = {}) {
  if (!Array.isArray(planes) || !planes.length || planes.length > 2 || ![44100, 48000, 96000].includes(sampleRate) ||
      planes.some(p => !(p instanceof Float32Array) || p.length !== planes[0].length) || !planes[0].length || planes[0].length * planes.length * 4 > limit ||
      fundamentalHz != null && (!Number.isFinite(fundamentalHz) || fundamentalHz <= 0 || fundamentalHz >= sampleRate / 2) || !Number.isFinite(silenceAmplitude) || silenceAmplitude <= 0) fail('invalid bounded PCM layout.');
  const frames = planes[0].length, windowFrames = Math.max(1, Math.round(sampleRate / 100)), envelope = [];
  let peak = 0, sum = 0, squared = 0, nonfinite = 0, clipped = 0, silent = 0, maximumDelta = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (const plane of planes) { const value = plane[frame]; if (!Number.isFinite(value)) { nonfinite++; continue; }
      const abs = Math.abs(value); peak = Math.max(peak, abs); sum += value; squared += value * value; if (abs >= 1) clipped++; if (abs < silenceAmplitude) silent++;
      if (frame && Number.isFinite(plane[frame - 1])) maximumDelta = Math.max(maximumDelta, Math.abs(value - plane[frame - 1]));
    }
  }
  const samples = frames * planes.length, rms = Math.sqrt(squared / samples);
  for (let first = 0; first < frames; first += windowFrames) { let square = 0, count = 0;
    for (const plane of planes) for (let i = first; i < Math.min(frames, first + windowFrames); i++) if (Number.isFinite(plane[i])) { square += plane[i] ** 2; count++; }
    envelope.push(Math.sqrt(square / Math.max(1, count)));
  }
  let peakWindow = 0, attackSlope = 0, audibleAttackEstimate = 0, lastAttack = -100;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] > envelope[peakWindow]) peakWindow = i;
    attackSlope = Math.max(attackSlope, (envelope[i] - (envelope[i - 1] || 0)) * sampleRate / windowFrames);
    if (envelope[i] > Math.max(silenceAmplitude * 8, (envelope[i - 1] || 0) * 2) && i - lastAttack > 2) { audibleAttackEstimate++; lastAttack = i; }
  }
  let decayLast = peakWindow; for (let i = peakWindow; i < envelope.length; i++) if (envelope[i] > envelope[peakWindow] * 0.001) decayLast = i;
  const shape = Array.from({ length: 64 }, (_, i) => { const a = Math.floor(i * envelope.length / 64), b = Math.max(a + 1, Math.floor((i + 1) * envelope.length / 64)); let sum = 0;
    for (let j = a; j < Math.min(b, envelope.length); j++) sum += envelope[j]; return rms > 0 ? sum / (b - a) / rms : 0; });
  const spectralBands = new Float64Array(32), slices = [], size = 2048, sliceCount = Math.min(32, Math.max(1, Math.ceil(frames / size)));
  let spectralWeight = 0, frequencyWeight = 0;
  for (let slice = 0; slice < sliceCount; slice++) {
    const first = Math.round(slice * Math.max(0, frames - size) / Math.max(1, sliceCount - 1)), power = new Float64Array(size / 2);
    for (const plane of planes) { const channel = spectrum(plane, first, size); for (let i = 0; i < power.length; i++) power[i] += channel[i] / planes.length; }
    let total = 0, centroid = 0;
    for (let bin = 1; bin < power.length; bin++) { const hz = bin * sampleRate / size, value = power[bin]; total += value; centroid += hz * value;
      const normalized = hz / (fundamentalHz || 440), band = Math.max(0, Math.min(31, Math.floor((Math.log2(normalized) + 4) * 4))); spectralBands[band] += value; }
    spectralWeight += total; frequencyWeight += centroid;
    slices.push({ firstFrame: first, centroidHz: total ? centroid / total : null, power: total });
  }
  return Object.freeze({ schema: 'lemmings-sound-measurement/v1', sampleRate, channels: planes.length, frames, samples, peak, rms, dc: sum / samples, nonfiniteSamples: nonfinite,
    clippedSamples: clipped, silenceFraction: silent / samples, silenceAmplitude, maximumDelta, attackSlopeAmplitudePerSecond: attackSlope,
    peakWindowSeconds: peakWindow * windowFrames / sampleRate, decay60Seconds: envelope[peakWindow] > silenceAmplitude ? (decayLast - peakWindow) * windowFrames / sampleRate : null,
    decayCensored: decayLast === envelope.length - 1, spectralCentroidHz: spectralWeight ? frequencyWeight / spectralWeight : null, spectralSlices: slices,
    audibleAttackEstimate, attackEstimator: '10ms-energy-rise-6dB-30ms-refractory-not-logical-onset-count',
    normalizedFeatures: { pitchReferenceHz: fundamentalHz, pitchNormalization: fundamentalHz ? 'declared-fundamental-relative-bands' : 'unsupported-no-pitch-reference',
      levelNormalization: 'unit-rms-envelope-unit-power-spectrum', envelope: shape, spectrum: [...spectralBands].map(value => spectralWeight ? value / spectralWeight : 0) },
    interpretation: 'digital-measurement-not-speaker-output-or-listening-assessment' });
}
const cosine = (a, b) => { let aa = 0, bb = 0, ab = 0; for (let i = 0; i < a.length; i++) { aa += a[i] ** 2; bb += b[i] ** 2; ab += a[i] * b[i]; } return aa && bb ? Math.max(0, Math.min(2, 1 - ab / Math.sqrt(aa * bb))) : null; };
export function compareSoundFeatures(a, b, { spectralDistance = 0.015, envelopeDistance = 0.015 } = {}) {
  if (a?.schema !== 'lemmings-sound-measurement/v1' || b?.schema !== a.schema || [spectralDistance, envelopeDistance].some(value => !Number.isFinite(value) || value < 0 || value > 1)) fail('incompatible feature comparison.');
  if (a.nonfiniteSamples || b.nonfiniteSamples || !a.rms || !b.rms || a.spectralCentroidHz == null || b.spectralCentroidHz == null) return { status: 'unsupported', reason: 'nonfinite-or-silent-render', nearDuplicate: false };
  const spectrumDistance = cosine(a.normalizedFeatures.spectrum, b.normalizedFeatures.spectrum), temporalDistance = cosine(a.normalizedFeatures.envelope, b.normalizedFeatures.envelope);
  return { status: 'review-required', nearDuplicate: spectrumDistance <= spectralDistance && temporalDistance <= envelopeDistance,
    spectrumDistance, temporalDistance, levelDifferenceDb: 20 * Math.log10(a.rms / b.rms), tolerance: { spectralDistance, envelopeDistance },
    interpretation: 'candidate-for-human-review-not-proof-of-equivalence-or-musical-quality' };
}
export function matchSoundLevels(a, b, { peakCeiling = 0.8 } = {}) {
  if (!Number.isFinite(peakCeiling) || peakCeiling <= 0 || peakCeiling >= 1 || [a, b].some(value => !value?.rms || !value?.peak || value.nonfiniteSamples)) fail('level matching needs finite non-silent measured PCM.');
  const targetRms = Math.min(a.rms, b.rms, peakCeiling * a.rms / a.peak, peakCeiling * b.rms / b.peak);
  return Object.freeze({ targetRms, gainA: targetRms / a.rms, gainB: targetRms / b.rms, peakCeiling, method: 'pair-relative-rms-match-no-master-loudness-target', rawMeasurementsRetained: true });
}
