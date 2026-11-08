import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
export const SAMPLE_CURSOR_REVISION = 'owned-observed-sample-cursor-v1';
export const SAMPLE_CURSOR_DISCONTINUITIES = Object.freeze(['continuous', 'seek', 'restore', 'topology-rebind']);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function acceptsSampleCursorSegment(p, frontier, first, end, from, to, sequence, discontinuity = 'continuous') {
  const maximum = p.maximumCoordinateSourceFrames, multiplier = p.interpolation === 'smoothstep' ? 1.5 : 1;
  return !frontier.released && integer(first, frontier.frame, Number.MAX_SAFE_INTEGER) && integer(end, first + 1, Number.MAX_SAFE_INTEGER) && end - first <= p.sampleRate * 2 &&
    integer(sequence, frontier.lastSequence + 1, Number.MAX_SAFE_INTEGER) && finite(from, -maximum, maximum) && finite(to, -maximum, maximum) && SAMPLE_CURSOR_DISCONTINUITIES.includes(discontinuity) &&
    (discontinuity === 'continuous' || first >= frontier.lastSeekFrame + p.slewFrames) && first >= frontier.lastEndFrame &&
    (discontinuity !== 'continuous' || Math.abs(from - frontier.lastEndPosition) <= 1e-7) && Math.abs(to - from) * p.sourceToDecoded / (end - first) * multiplier <= p.maximumReadDerivative && frontier.length < p.capacity;
}
export function prepareSampleCursorProfile(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['sampleRate', 'sourceSampleRate', 'decodedSampleRate', 'sourceFrames', 'decodedFrames', 'regionStartFrame', 'regionEndFrame', 'capacity', 'slewSeconds', 'maximumReadDerivative', 'boundary', 'interpolation', 'bankHash', 'mapRevision'].includes(key))) throw new TypeError('Invalid sample cursor profile.');
  const p = { capacity: 128, slewSeconds: 0.01, maximumReadDerivative: 4, boundary: 'stop', interpolation: 'smoothstep', ...raw };
  if (!integer(p.sampleRate, 8000, 192000) || !integer(p.sourceSampleRate, 8000, 192000) || !integer(p.decodedSampleRate, 8000, 192000) || !integer(p.sourceFrames, 2, 8000000) || !integer(p.decodedFrames, 2, 4194304) || Math.abs(p.decodedFrames - p.sourceFrames * p.decodedSampleRate / p.sourceSampleRate) > 1 || !integer(p.regionStartFrame, 0, p.sourceFrames - 2) || !integer(p.regionEndFrame, p.regionStartFrame + 2, p.sourceFrames) || !integer(p.capacity, 2, 128) || !finite(p.slewSeconds, 0.005, 0.02) || !finite(p.maximumReadDerivative, 0.25, 4) || !['stop', 'wrap', 'reflect'].includes(p.boundary) || !['linear', 'smoothstep'].includes(p.interpolation) || typeof p.bankHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.bankHash) || !integer(p.mapRevision, 1, 2147483647)) throw new RangeError('Sample cursor source/output units, region or bounded queue are invalid.');
  const sourceToDecoded = p.decodedSampleRate / p.sourceSampleRate, decodedStart = p.regionStartFrame * sourceToDecoded, decodedEnd = Math.min(p.decodedFrames, p.regionEndFrame * sourceToDecoded);
  if (decodedEnd - decodedStart < 2) throw new RangeError('The selected region has fewer than two decoded frames.');
  return freezeData({ revision: SAMPLE_CURSOR_REVISION, ...p, parameters: p, sourceToDecoded, decodedStart, decodedEnd, slewFrames: Math.ceil(p.sampleRate * p.slewSeconds), queueWidth: 7,
    stateBytes: p.capacity * 7 * 8 + 21 * 8, transferBytes: 4096 + p.capacity * 7 * 8 + 21 * 8, maximumCoordinateSourceFrames: 1073741824,
    derivativeDomain: 'unwrapped-decoded-source-coordinate-per-output-frame;boundary-remap-is-separate', endpointDomain: 'original-source-frames',
    timing: 'explicit-monotonic-output-frame-segments;no-extrapolation-or-private-distance-accumulator',
    interpolationPolicy: p.interpolation === 'smoothstep' ? 'exact-endpoints;zero-endpoint-velocity-per-segment;maximum-derivative-1.5-times-mean' : 'exact-endpoints;piecewise-linear-velocity',
    restPolicy: 'hold-cursor-and-fade-to-zero;no-held-sample-DC', reflectionDomain: 'decoded-sample-centers;period-twice-region-span-minus-one-decoded-frame', qualification: 'implementation-awaiting-reader-and-physical-trace-qualification' });
}
export const sampleCursorIdentity = profile => canonicalDataText(profile).text;
