import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const ENVELOPE_MAPPING_REVISION = 'owned-envelope-gain-map-v1';
const defaults = Object.freeze({ mapping: 'decibel-attenuation', polarity: -1, depth01: 1, neutral01: 1, depthDb: 12, neutralDb: 0 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function prepareEnvelopeMappingProfile(raw = {}) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !Object.hasOwn(defaults, key))) throw new TypeError('Invalid envelope gain mapping.');
  const values = { ...defaults, ...raw };
  if (!['linear-amplitude', 'decibel-attenuation'].includes(values.mapping)) throw new TypeError('Unknown envelope mapping unit.');
  const fields = values.mapping === 'linear-amplitude' ? ['mapping', 'polarity', 'depth01', 'neutral01'] : ['mapping', 'polarity', 'depthDb', 'neutralDb'];
  if (Object.keys(raw).some(key => !fields.includes(key))) throw new TypeError('Envelope mapping mixes amplitude and decibel fields.');
  const p = Object.fromEntries(fields.map(key => [key, values[key]]));
  if (!['linear-amplitude', 'decibel-attenuation'].includes(p.mapping) || ![-1, 1].includes(p.polarity) || (p.mapping === 'linear-amplitude' ? !finite(p.depth01, 0, 1) || !finite(p.neutral01, 0, 1) : !finite(p.depthDb, 0, 60) || !finite(p.neutralDb, -60, 0))) throw new RangeError('Envelope gain mapping exceeds its amplitude or decibel domain.');
  return freezeData({ revision: ENVELOPE_MAPPING_REVISION, parameters: p, stateBytes: 8, lookupBytes: p.mapping === 'decibel-attenuation' ? 1025 * 4 : 0,
    processingLatencyFrames: 0, maximumTailFrames: 0, inputUnit: 'normalized-envelope-zero-to-one', outputUnit: 'linear-amplitude-zero-to-one',
    coefficientPolicy: 'fixed-authored-depth-and-neutral; 1025-point-float32-lookup-with-linear-interpolation-for-dB',
    missingSource: 'envelope-release-to-authored-neutral', qualification: 'implementation-awaiting-response-and-cost-qualification' });
}
export const envelopeMappingIdentity = (profile, sampleRate) => canonicalDataText({ revision: profile.revision, sampleRate, parameters: profile.parameters }).text;
