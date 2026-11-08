import { validateAudioAssetRef } from '../../app/midi-ui/AudioAssetRef.js';
import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

const finite = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
export function validateImpulseResponseDescriptor(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['schema', 'asset', 'layout', 'predelaySeconds', 'normalizationMode', 'referenceGain01', 'maximumLinearGain', 'latency'].includes(key)) ||
      value.schema !== 'lemmings-impulse-response/v1' || !['mono', 'stereo', 'true-stereo'].includes(value.layout) || !finite(value.predelaySeconds, 0, 0.1) ||
      !['none', 'native-rms'].includes(value.normalizationMode) || !finite(value.referenceGain01, 0, 2) || !finite(value.maximumLinearGain, 0, 16) ||
      value.latency !== 'unknown-native-implementation') throw new TypeError('Invalid or unsupported native impulse-response descriptor.');
  const asset = validateAudioAssetRef(value.asset), channels = value.layout === 'mono' ? 1 : value.layout === 'stereo' ? 2 : 4;
  if (asset.kind !== 'impulse-response' || asset.channels !== channels || asset.loopMarkers) throw new TypeError('Impulse layout differs from its encoded asset or declares an unsupported loop.');
  const result = { schema: value.schema, asset, layout: value.layout, predelaySeconds: value.predelaySeconds, normalizationMode: value.normalizationMode,
    referenceGain01: value.referenceGain01, maximumLinearGain: value.maximumLinearGain, latency: 'unknown-native-implementation' };
  canonicalDataText(result, { maxBytes: 8192, maxNodes: 256 }); return freezeData(result);
}
