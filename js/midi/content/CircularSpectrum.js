import { freezeData } from '../../core/CanonicalData.js';

export const CIRCULAR_SPECTRUM_REVISION = 'original-octave-circular-spectrum-v1';
export const CIRCULAR_PARTIAL_CAPACITY = 10;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error(message), { name: 'CircularSpectrumError', code: 'circular-spectrum-unavailable' }); };
export function resolveCircularSpectrum(raw = {}, sampleRate, referenceRatio = 1) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['periodRatio', 'referenceFrequencyHz', 'frequencyCenterHz', 'spectralWidthOctaves', 'bandLowHz', 'bandHighHz', 'partialCountCap', 'weight01'].includes(key)) || ![44100, 48000, 96000].includes(sampleRate) || !finite(referenceRatio, 1 / 16, 16)) fail('Circular spectrum requires an explicit output rate and bounded reference transposition.');
  const p = { periodRatio: 2, referenceFrequencyHz: 55, frequencyCenterHz: 700, spectralWidthOctaves: 1.2, bandLowHz: 80, bandHighHz: 8000, partialCountCap: 10, weight01: 1, ...raw };
  if (p.periodRatio !== 2 || !finite(p.referenceFrequencyHz, 1, 20000) || !finite(p.frequencyCenterHz, 20, 20000) || !finite(p.spectralWidthOctaves, 0.25, 3) ||
      !finite(p.bandLowHz, 20, 10000) || !finite(p.bandHighHz, p.bandLowHz * 2, 20000) || !Number.isInteger(p.partialCountCap) || !finite(p.partialCountCap, 8, CIRCULAR_PARTIAL_CAPACITY) || !finite(p.weight01, 0, 1)) fail('The initial circular lattice supports only octave periods, positive resolved references and eight to ten bounded partial slots.');
  const referenceFrequencyHz = p.referenceFrequencyHz * referenceRatio, high = Math.min(p.bandHighHz, sampleRate * 0.4), low = p.bandLowHz;
  if (high < low * 2 || p.frequencyCenterHz <= low || p.frequencyCenterHz >= high) fail('The circular active band is unavailable at this output rate.');
  const minimumIndex = Math.floor(Math.log2(low / referenceFrequencyHz)) - 1, maximumIndex = minimumIndex + p.partialCountCap - 1;
  if (p.partialCountCap < Math.ceil(Math.log2(high / low)) + 3 || maximumIndex < Math.ceil(Math.log2(high / referenceFrequencyHz))) fail('The active circular band and its silent phase-recycling guards exceed the authored partial cap.');
  return freezeData({ revision: CIRCULAR_SPECTRUM_REVISION, ...p, sampleRate, authoredReferenceFrequencyHz: p.referenceFrequencyHz, referenceFrequencyHz,
    resolvedBandLowHz: low, resolvedBandHighHz: high, minimumIndex, maximumIndex,
    envelope: 'amplitude-Gaussian;log2-frequency-standard-deviation-in-octaves', normalization: 'convex-ramped-partial-amplitudes;sum-absolute-gains-at-most-0.8-times-weight',
    bandEdge: 'zero-outside-active-band;quarter-octave-cosine-tapers', phasePolicy: 'preserve-active-slot-phase;recycle-only-silent-outer-guards',
    quality: 'implementation-awaiting-frequency-wrap-spectral-cost-and-listening-qualification' });
}

export function circularSpectrumParameters(parameters) {
  return { periodRatio: parameters.circularPeriodRatio, referenceFrequencyHz: parameters.circularReferenceHz, frequencyCenterHz: parameters.circularCenterHz,
    spectralWidthOctaves: parameters.circularWidthOctaves, bandLowHz: parameters.circularLowHz, bandHighHz: parameters.circularHighHz,
    partialCountCap: parameters.circularPartialCap, weight01: parameters.circularWeight01 };
}

export function circularSpectrumWeight(recipe, frequency) {
  if (!Number.isFinite(frequency) || frequency <= recipe.resolvedBandLowHz || frequency >= recipe.resolvedBandHighHz) return 0;
  const z = Math.log2(frequency / recipe.frequencyCenterHz) / recipe.spectralWidthOctaves;
  const edge = Math.min(1, Math.log2(frequency / recipe.resolvedBandLowHz) * 4, Math.log2(recipe.resolvedBandHighHz / frequency) * 4);
  return Math.exp(-0.5 * z * z) * (0.5 - 0.5 * Math.cos(Math.PI * edge));
}


export function planCircularTravel(parameters, intent, targetFrame, sampleRate) {
  if (parameters.sourceMode !== 2) return null;
  if (!intent?.articulationState?.travel && intent?.controlFixture === true) return null;
  const o = intent?.articulationState?.travel, scope = ['actorJourney', 'contactSpan', 'actionInstance'][parameters.circularScope], orientation = parameters.circularAxis === 0 ? 'signedX' : 'signedY';
  if (!scope || ![0, 1].includes(parameters.circularAxis) || ![0, 1].includes(parameters.circularRequireSegments) || typeof intent.mappingId !== 'string' || !intent.mappingId || intent.mappingId.length > 128 || !o || typeof o.worldId !== 'string' || !o.worldId || o.worldId.length > 512 || !Number.isSafeInteger(o.actorId) || o.actorId < 0 || !Number.isSafeInteger(o.generation) || o.generation < 0 || o.schema !== 'lemmings-canonical-travel-observation/v1' || o.worldId !== intent.worldId || o.generation !== intent.generation || o.actorId !== intent.actorId || o.instrumentId !== intent.mappingId ||
      o.lifetimeScope !== scope || o.orientation !== orientation || o.metric !== 'axis-projection' || typeof o.scopeInstanceId !== 'string' || !o.scopeInstanceId || o.scopeInstanceId.length > 512 ||
      !Number.isSafeInteger(o.discontinuityEpoch) || o.discontinuityEpoch < 0 || !['endpoint-chord', 'committed-coordinate-write'].includes(o.precision) || parameters.circularRequireSegments === 1 && o.precision !== 'committed-coordinate-write' ||
      !Number.isFinite(o.from?.signedDistancePixels) || !Number.isFinite(o.to?.signedDistancePixels) || o.timing !== 'completed-tick-equal-segments-v1' || !finite(o.completedTickDurationMs, 0.001, 2000) ||
      !Number.isInteger(o.segmentCount) || !finite(o.segmentCount, 1, 128) || !Number.isInteger(o.segmentOrdinal) || !finite(o.segmentOrdinal, 0, o.segmentCount - 1) || !Number.isSafeInteger(o.sourceSequence) || o.sourceSequence < 1 ||
      typeof o.sourceEventId !== 'string' || !o.sourceEventId || o.sourceEventId.length > 512 || !intent.sourceEventIds?.includes(o.sourceEventId) || !Number.isSafeInteger(targetFrame) || targetFrame < 0 || ![44100, 48000, 96000].includes(sampleRate) || !finite(parameters.circularPixelsPerCycle, 1, 1000000)) fail('Canonical signed-axis travel does not cover this circular scope, precision or timing policy.');
  const from = parameters.circularPhaseOrigin + (o.from.signedDistancePixels - parameters.circularOriginPixels) / parameters.circularPixelsPerCycle,
    to = parameters.circularPhaseOrigin + (o.to.signedDistancePixels - parameters.circularOriginPixels) / parameters.circularPixelsPerCycle;
  const span = o.completedTickDurationMs * sampleRate / 1000, firstFrame = targetFrame + Math.round(span * o.segmentOrdinal / o.segmentCount), endFrame = targetFrame + Math.round(span * (o.segmentOrdinal + 1) / o.segmentCount);
  if (!finite(from, -1000000, 1000000) || !finite(to, -1000000, 1000000) || !Number.isSafeInteger(endFrame) || endFrame <= firstFrame || Math.abs(to - from) / (endFrame - firstFrame) * sampleRate > 4) fail('Circular travel exceeds the bounded phase or four-cycle/second interpolation domain.');
  return freezeData({ from, to, firstFrame, endFrame, sequence: o.sourceSequence, ownerIdentity: JSON.stringify([o.worldId, o.generation, o.actorId, o.instrumentId, o.scopeInstanceId, o.discontinuityEpoch]),
    receipt: { schema: 'lemmings-circular-travel-receipt/v1', rendererRevision: CIRCULAR_SPECTRUM_REVISION, mappingId: o.instrumentId, lifetimeScope: scope, scopeInstanceId: o.scopeInstanceId,
      metric: o.metric, orientation, precision: o.precision, discontinuityEpoch: o.discontinuityEpoch, sourceEventId: o.sourceEventId, pixelsPerCycle: parameters.circularPixelsPerCycle,
      originPixels: parameters.circularOriginPixels, phaseOrigin: parameters.circularPhaseOrigin, firstFrame, endFrame, firstPhaseCycles: from, endPhaseCycles: to,
      timing: o.timing, phasePolicy: 'unwrapped-canonical-distance;negative-phase-uses-floor;carrier-phase-remains-owned', acousticReceipt: false } });
}
