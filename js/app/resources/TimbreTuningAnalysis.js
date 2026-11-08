import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { verifyTimbreTuningSet, timbreTuningIdentity } from '../../midi/content/TimbreTuningSet.js';

export const TIMBRE_ROUGHNESS_MODEL = 'sethares-min-amplitude-total-pair-v1';
export const predictedSineBeatHz = (left, right) => {
  if (![left, right].every(value => Number.isFinite(value) && value > 0 && value <= 96000)) throw new Error('Predicted beats require two positive bounded sine frequencies in Hz.');
  return Math.abs(right - left);
};
export function timbrePairRoughness(leftHz, rightHz, leftAmplitude, rightAmplitude) {
  const scale = 0.24 / (0.0207 * Math.min(leftHz, rightHz) + 18.96), distance = scale * Math.abs(rightHz - leftHz);
  return Math.min(leftAmplitude, rightAmplitude) * 5 * (Math.exp(-3.51 * distance) - Math.exp(-5.75 * distance));
}
export async function analyzeTimbreTuningSet(input, { signal, current = () => true, onProgress = () => {}, yieldControl = () => Promise.resolve() } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) throw new Error('The spectrum/tuning analysis source changed.'); };
  check(); const set = await verifyTimbreTuningSet(input.set), scan = input.scan, windows = input.windows, registers = input.registerHz, sampleRate = input.sampleRate, bypass = input.bypass === true;
  if (Object.keys(input).some(key => !['set', 'scan', 'windows', 'registerHz', 'sampleRate', 'bypass'].includes(key)) || !scan || Object.keys(scan).some(key => !['minimumRatio', 'maximumRatio', 'points'].includes(key)) ||
      !Number.isFinite(scan.minimumRatio) || scan.minimumRatio < 0.5 || !Number.isFinite(scan.maximumRatio) || scan.maximumRatio <= scan.minimumRatio || scan.maximumRatio > 4 ||
      !Number.isSafeInteger(scan.points) || scan.points < 3 || scan.points > 513 || ![44100, 48000, 96000].includes(sampleRate) ||
      !Array.isArray(registers) || !registers.length || registers.length > 4 || registers.some(hz => !Number.isFinite(hz) || hz < set.registerDomain.minimumHz || hz > set.registerDomain.maximumHz) ||
      !Array.isArray(windows) || !windows.length || windows.length > 3 || new Set(windows.map(window => window.id)).size !== windows.length ||
      windows.some(window => !window || typeof window.id !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(window.id) || Object.keys(window).some(key => !['id', 'startSeconds', 'endSeconds', 'samples'].includes(key)) ||
        !Number.isFinite(window.startSeconds) || window.startSeconds < 0 || !Number.isFinite(window.endSeconds) || window.endSeconds < window.startSeconds || window.endSeconds > 8 || !Number.isSafeInteger(window.samples) || window.samples < 1 || window.samples > 8)) throw new Error('Choose a bounded interval grid, declared register and up to three explicit source-second windows.');
  const partialCount = set.partialRatios.length, pairCount = partialCount * 2 * (partialCount * 2 - 1) / 2,
    workPairs = scan.points * registers.length * windows.reduce((sum, window) => sum + window.samples, 0) * pairCount;
  if (workPairs > 8000000) throw new Error('The complete selected interval/register/window grid exceeds the eight-million pair-evaluation profile.');
  const setHash = await hashData(timbreTuningIdentity(set)), request = { scan, windows, registerHz: registers, sampleRate, bypass }, requestHash = await hashData({ setHash, ...request }), curves = [], exclusions = [], coincidences = [];
  const frequencies = new Float64Array(partialCount * 2), amplitudes = new Float64Array(partialCount * 2), enabled = set.partialProvenance.map((item, index) => item.kind === 'disabled' ? 0 : set.partialGains[index]);
  const mixture = (root, interval, seconds) => {
    for (let voice = 0; voice < 2; voice++) for (let index = 0; index < partialCount; index++) {
      const at = voice * partialCount + index, hz = root * (voice ? interval : 1) * set.partialRatios[index], taper = Math.max(0, Math.min(1, (sampleRate * 0.4 - hz) / (sampleRate * 0.04)));
      frequencies[at] = hz; amplitudes[at] = enabled[index] * Math.exp(-Math.log(1000) * seconds / set.partialT60Seconds[index]) * taper;
    }
    let value = 0; for (let left = 0; left < frequencies.length; left++) for (let right = left + 1; right < frequencies.length; right++) value += timbrePairRoughness(frequencies[left], frequencies[right], amplitudes[left], amplitudes[right]);
    return value;
  };
  if (!bypass) for (const root of registers) for (const window of windows) {
    const points = [];
    for (let index = 0; index < scan.points; index++) {
      check(); const ratio = scan.minimumRatio * (scan.maximumRatio / scan.minimumRatio) ** (index / (scan.points - 1)); let total = 0;
      for (let snapshot = 0; snapshot < window.samples; snapshot++) total += mixture(root, ratio, window.samples === 1 ? (window.startSeconds + window.endSeconds) / 2 : window.startSeconds + (window.endSeconds - window.startSeconds) * snapshot / (window.samples - 1));
      points.push({ ratio, cents: 1200 * Math.log2(ratio), modeledRoughness: total / window.samples });
      if (index % 8 === 0) { onProgress({ phase: 'bounded-declared-spectrum-roughness', registerHz: root, windowId: window.id, completed: index + 1, total: scan.points }); await yieldControl(); }
    }
    curves.push({ registerHz: root, window, points });
  }
  for (const root of registers) for (const ratio of set.degreeRatios) {
    const pairs = [];
    for (let left = 0; left < partialCount; left++) for (let right = 0; right < partialCount; right++) {
      const aHz = root * set.partialRatios[left], bHz = root * ratio * set.partialRatios[right]; if (!enabled[left] || !enabled[right] || Math.max(aHz, bHz) >= sampleRate * 0.4) continue;
      pairs.push({ leftPartial: left, rightPartial: right, aHz, bHz, predictedDifferenceHz: predictedSineBeatHz(aHz, bHz), exactCoincidence: aHz === bHz, source: 'declared-frequency-prediction;not-a-measured-beat-estimate' });
    }
    pairs.sort((a, b) => a.predictedDifferenceHz - b.predictedDifferenceHz || a.leftPartial - b.leftPartial || a.rightPartial - b.rightPartial);
    coincidences.push({ registerHz: root, ratio, pairs: pairs.slice(0, 32), omittedPairs: Math.max(0, pairs.length - 32) });
  }
  for (const root of registers) for (let index = 0; index < partialCount; index++) {
    const frequencyHz = root * set.partialRatios[index];
    if (!enabled[index] || frequencyHz > sampleRate * 0.36) exclusions.push({ registerHz: root, partial: index, frequencyHz, reason: !enabled[index] ? 'disabled-or-zero-authored-gain' : frequencyHz >= sampleRate * 0.4 ? 'renderer-cutoff' : 'renderer-upper-band-taper' });
  }
  check(); const result = { schema: 'lemmings-timbre-tuning-analysis/v1', model: TIMBRE_ROUGHNESS_MODEL, status: bypass ? 'bypassed' : 'modeled-declared-spectrum', setHash, requestHash, request, curves, coincidences, exclusions,
    work: { pairEvaluations: bypass ? 0 : workPairs, maximumPairEvaluations: 8000000, intervalGrid: 'logarithmic', outputThread: 'owned-offline-background-worker' },
    assumptions: { amplitude: 'declared-linear-partial-gain;independent-exponential-T60;renderer-Nyquist-taper', windows: 'arithmetic-mean-of-explicit-source-second-snapshots',
      pairAggregation: 'all-unordered-pairs-of-two-combined-partial-lists;minimum-amplitude-weight', ordinate: 'relative-model-quantity;not-percent-pleasantness-or-musicality',
      excluded: 'no-loudness-hearing-calibration;no-selected-source-table-color-or-shared-ADSR;no-measured-spectrum-or-beats;no-listener-preference-prediction',
      references: ['https://sethares.engr.wisc.edu/consemi.html', 'https://sethares.engr.wisc.edu/comprog.html'] }, acousticReceipt: false };
  const resultHash = await hashData(result, { maxBytes: 2 * 1048576, maxNodes: 100000 }); check();
  return freezeData({ ...result, resultHash, receipt: { model: TIMBRE_ROUGHNESS_MODEL, setHash, requestHash, resultHash } });
}
