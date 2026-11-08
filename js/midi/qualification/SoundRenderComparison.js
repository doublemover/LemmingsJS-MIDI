import { admitPcmChannels } from '../../app/midi-ui/PcmEvidence.js';
import { createSoundSpectrumPlan } from './SoundSpectralTransform.js';
import { measureSoundRender, compareSoundFeatures } from './SoundRenderAnalysis.js';
const db = power => Math.max(-160, 10 * Math.log10(Math.max(1e-16, power)));
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function envelope(planes, rate) {
  const width = rate / 100, result = [];
  for (let first = 0; first < planes[0].length; first += width) {
    const end = Math.min(planes[0].length, first + width); let square = 0;
    for (const plane of planes) for (let frame = first; frame < end; frame++) square += plane[frame] * plane[frame];
    result.push(Math.sqrt(square / ((end - first) * planes.length)));
  }
  return result;
}
function modulation(values) {
  const mean = average(values), index = mean ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean : null;
  if (values.length < 100 || !mean) return { state: mean ? 'insufficient-one-second-duration' : 'silent', index, frequencyHz: [], powerDb: [], largestBinHz: null };
  let size = 16; while (size < values.length) size *= 2;
  const plan = createSoundSpectrumPlan(size, { windowFrames: values.length }), power = new Float64Array(plan.bins);
  plan.writePower(Float64Array.from(values, value => value / mean - 1), 0, power);
  const frequencyHz = [], powerDb = []; let largest = -Infinity, largestBinHz = null;
  for (let bin = 1; bin < power.length; bin++) {
    const frequency = bin * 100 / size; if (frequency < 0.5 || frequency > 20) continue;
    const value = db(2 * power[bin] / (size * plan.windowSumSquares)); frequencyHz.push(frequency); powerDb.push(value);
    if (value > largest) { largest = value; largestBinHz = frequency; }
  }
  return { state: 'measured', index, frequencyHz, powerDb, largestBinHz: largest > -150 ? largestBinHz : null,
    interpretation: 'RMS-envelope variation includes note onsets, gaps and tails; the largest bin does not establish an added LFO or musical quality.' };
}
export function compareSoundRenders(a, b, { maximumColumns = 2048, frequencyBands = 128 } = {}) {
  if (!a || !b || ![44100, 48000, 96000].includes(a.sampleRate) || b.sampleRate !== a.sampleRate ||
      !Number.isSafeInteger(maximumColumns) || maximumColumns < 32 || maximumColumns > 2048 || !Number.isSafeInteger(frequencyBands) || frequencyBands < 32 || frequencyBands > 256) throw new TypeError('Invalid bounded sound comparison profile.');
  const shape = admitPcmChannels(a.planes); admitPcmChannels(b.planes, { expectedChannels: shape.channels, expectedFrames: shape.frames });
  if (shape.channels > 2 || shape.frames / a.sampleRate > 60 || shape.samples * 8 > 64 * 1048576 || a.planes.concat(b.planes).some(plane => !(plane instanceof Float32Array))) throw new RangeError('Sound comparison exceeds its sixty-second or combined64MiB float32 PCM bound.');
  const rate = a.sampleRate, size = rate === 96000 ? 4096 : 2048, last = Math.max(0, shape.frames - size);
  const hop = Math.max(size / 4, Math.ceil(last / (maximumColumns - 1))); if (hop > size) throw new RangeError('Spectral grid would leave unmeasured gaps; increase maximumColumns or shorten the clip.');
  const starts = Array.from({ length: Math.floor(last / hop) + 1 }, (_, i) => i * hop); if (starts.at(-1) !== last) starts.push(last);
  const minimumHz = 20, maximumHz = 20000, frequencyHz = Array.from({ length: frequencyBands }, (_, band) => minimumHz * (maximumHz / minimumHz) ** ((band + 0.5) / frequencyBands));
  const bands = frequencyHz.map((frequency, index) => {
    const low = Math.max(1, Math.ceil(minimumHz * (maximumHz / minimumHz) ** (index / frequencyBands) * size / rate));
    const high = Math.min(size / 2, Math.floor(minimumHz * (maximumHz / minimumHz) ** ((index + 1) / frequencyBands) * size / rate));
    const nearest = Math.max(1, Math.min(size / 2, Math.round(frequency * size / rate))); return low <= high ? [low, high] : [nearest, nearest];
  });
  const plan = createSoundSpectrumPlan(size), channel = new Float64Array(plan.bins), power = new Float64Array(plan.bins), spectra = [], centroids = [];
  for (const input of [a, b]) {
    const pixels = [], centers = [];
    for (const first of starts) {
      power.fill(0);
      for (const plane of input.planes) { plan.writePower(plane, first, channel); for (let bin = 0; bin < power.length; bin++) power[bin] += channel[bin] / shape.channels; }
      let weighted = 0, total = 0;
      for (let bin = 1; bin < power.length; bin++) { const value = power[bin] * (bin === size / 2 ? 1 : 2); total += value; weighted += value * bin * rate / size; }
      centers.push(total ? weighted / total : null);
      for (const [low, high] of bands) {
        let sum = 0; for (let bin = low; bin <= high; bin++) sum += power[bin] * (bin === size / 2 ? 1 : 2);
        pixels.push(Math.round(db(sum / ((high - low + 1) * size * plan.windowSumSquares)) * 10));
      }
    }
    spectra.push(pixels); centroids.push(centers);
  }
  let highest = -160; for (const values of spectra) for (const value of values) highest = Math.max(highest, value / 10);
  const displayMaximumDb = Math.max(-80, Math.ceil(highest / 10) * 10), displayMinimumDb = Math.max(-160, displayMaximumDb - 80);
  let difference = 0, activeCells = 0;
  for (let i = 0; i < spectra[0].length; i++) if (Math.max(spectra[0][i], spectra[1][i]) / 10 >= displayMinimumDb + 10) { difference += Math.abs(spectra[0][i] - spectra[1][i]) / 10; activeCells++; }
  const envelopeA = envelope(a.planes, rate), envelopeB = envelope(b.planes, rate), modulationA = modulation(envelopeA), modulationB = modulation(envelopeB);
  let squareA = 0, squareB = 0, product = 0, error = 0;
  for (let channel = 0; channel < shape.channels; channel++) for (let frame = 0; frame < shape.frames; frame++) {
    const x = a.planes[channel][frame], y = b.planes[channel][frame]; squareA += x * x; squareB += y * y; product += x * y; error += (x - y) ** 2;
  }
  const envelopePeak = Math.max(...envelopeA, ...envelopeB), activeThreshold = Math.max(1e-7, envelopePeak * 1e-4);
  let lastActive = -1; for (let i = 0; i < envelopeA.length; i++) if (Math.max(envelopeA[i], envelopeB[i]) >= activeThreshold) lastActive = i;
  const activeEndSeconds = lastActive < 0 ? shape.frames / rate : Math.min(shape.frames / rate, (lastActive + 1) / 100 + 0.1);
  const measuredA = measureSoundRender(a.planes, rate), measuredB = measureSoundRender(b.planes, rate);
  return { schema: 'lemmings-sound-spectral-comparison/v1', profile: { sampleRate: rate, channels: shape.channels, frames: shape.frames, durationSeconds: shape.frames / rate,
    fftSize: size, hannWindow: 'symmetric', fftResolutionHz: rate / size, hopFrames: hop, maximumColumns, columns: starts.length, frequencyBands,
    frequencyMinimumHz: minimumHz, frequencyMaximumHz: maximumHz, bandPolicy: 'mean-one-sided-window-power-per-FFT-bin;nearest-real-bin-below-grid-resolution',
    powerNormalization: 'raw-FFT-power/(fftSize*sum(window^2));double-positive-non-Nyquist-bins', encoding: 'column-major-integer-tenths-dBFS-window-mean-square-power',
    displayMinimumDb, displayMaximumDb, differenceDisplayLimitDb: 12, differenceActiveFloorDb: displayMinimumDb + 10, envelopeWindowSeconds: 0.01,
    coverage: 'first-to-last-frame-overlapping-windows;last-hop-may-be-shorter', alignment: 'same-rate-channel-count-and-length;no-time-warp-or-pitch-shift' },
  spectrogram: { firstFrames: starts, centerSeconds: starts.map(first => (first + Math.min(size, shape.frames - first) / 2) / rate), frequencyHz, a: spectra[0], b: spectra[1], centroidHz: centroids },
  display: { startSeconds: 0, activeEndSeconds, activeThresholdRms: activeThreshold, fullDurationSeconds: shape.frames / rate, silentRemainderIsRetained: true },
  envelope: { sampleRate: 100, a: envelopeA, b: envelopeB }, modulation: { a: modulationA, b: modulationB },
  measurements: { a: measuredA, b: measuredB }, summary: { normalizedPcmRmsError: squareA || squareB ? Math.sqrt(error / Math.max(squareA, squareB)) : 0,
    waveformCorrelation: squareA && squareB ? Math.max(-1, Math.min(1, product / Math.sqrt(squareA * squareB))) : null,
    meanAbsoluteActiveBandDifferenceDb: activeCells ? difference / activeCells : null, activeSpectralCells: activeCells,
    featureComparison: compareSoundFeatures(measuredA, measuredB), perceptualVerdict: 'not-inferred' },
  interpretation: 'Digital signal differences and timing/modulation observations, not a judgment of audible relatedness, musical usefulness or acoustic playback.' };
}
