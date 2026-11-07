import { NATIVE_OSCILLATOR_PARAMETERS, NATIVE_FM_PARAMETERS, NATIVE_MODAL_PARAMETERS, NATIVE_SAMPLE_FIELDS } from './NativeInstrumentSchema.js';
import { planNativeFmSource } from './NativeFmSource.js';
import { planNativeModalSource } from './NativeModalSource.js';

export const NATIVE_OFFLINE_SOURCE_IDS = Object.freeze(['native-oscillator', 'native-fm', 'native-modal', 'native-sample']);
const profiles = new Map();
for (const [id, schema, voices, planOnset] of [
  ['native-oscillator', NATIVE_OSCILLATOR_PARAMETERS, 64, null], ['native-fm', NATIVE_FM_PARAMETERS, 32, planNativeFmSource],
  ['native-modal', NATIVE_MODAL_PARAMETERS, 16, planNativeModalSource]
]) profiles.set(id, Object.freeze({ id, native: true, fields: Object.freeze(Object.fromEntries(Object.entries(schema).map(([name, spec]) => [name, Object.freeze([spec.min, spec.max, spec.default])]))),
  parameters: Object.freeze(Object.values(schema)), voices, extended: true, requiresPCM: false, minHz: 0.1, maxHz: 40000, bendCents: id === 'native-oscillator' ? 24000 : 1200,
  offlineRender: true, controlReferenceRender: true, planOnset, liveIds: Object.freeze([]), acceptsParameters: () => true, acceptsOnset: () => true,
  beginFields: () => ({}), writeUpdate: () => 0, sourceBytes: () => 0 }));

profiles.set('native-sample', Object.freeze({ id: 'native-sample', native: true, fields: NATIVE_SAMPLE_FIELDS, voices: 64, extended: false, requiresPCM: false, requiresNativeAssets: true,
  minHz: 0, maxHz: Infinity, bendCents: 24000, offlineRender: true, controlReferenceRender: true, liveIds: Object.freeze([]),
  acceptsParameters: () => true, acceptsOnset: () => true, beginFields: () => ({}), writeUpdate: () => 0, sourceBytes: () => 0 }));

export function getNativeOfflineProfile(id) {
  const profile = profiles.get(id); if (!profile) throw new Error('Unavailable native offline source.'); return profile;
}
