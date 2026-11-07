import { PROCEDURAL_IMPULSE_IDENTITIES } from './ProceduralImpulseIdentities.js';
import { validateImpulseResponseDescriptor } from './ImpulseResponseDescriptor.js';
import { DECODER_VERSION } from '../../app/midi-ui/AudioAssetRef.js';

export const ORIGINAL_IMPULSE_PRESETS = Object.freeze(PROCEDURAL_IMPULSE_IDENTITIES.map(entry => Object.freeze({ id: entry.id, name: entry.name,
  layout: entry.channels === 1 ? 'mono' : entry.channels === 2 ? 'stereo' : 'true-stereo', durationSeconds: entry.frames / entry.sampleRate })));
export function createOriginalImpulseDescriptor(id) {
  const entry = PROCEDURAL_IMPULSE_IDENTITIES.find(value => value.id === id);
  if (!entry) throw new TypeError('Unknown original convolution body.');
  return validateImpulseResponseDescriptor({ schema: 'lemmings-impulse-response/v1', asset: { contentHash: entry.sha256, path: entry.path, bytes: entry.bytes,
    mime: 'audio/wav', kind: 'impulse-response', channels: entry.channels, sourceSampleRate: entry.sampleRate, frames: entry.frames,
    licenseId: entry.licenseId, attribution: entry.attribution, decodeVersion: DECODER_VERSION },
  layout: entry.channels === 1 ? 'mono' : entry.channels === 2 ? 'stereo' : 'true-stereo', predelaySeconds: entry.predelaySeconds,
  normalizationMode: entry.normalizationMode, referenceGain01: entry.referenceGain01, maximumLinearGain: entry.maximumLinearGain, latency: 'unknown-native-implementation' });
}
