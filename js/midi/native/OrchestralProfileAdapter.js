import { ORCHESTRAL_ARTICULATIONS, validateOrchestralArticulationPolicy } from '../content/OrchestralArticulationIntent.js';
import { encodeIntent } from '../protocol/UmpPacketCodec.js';

export const ORCHESTRAL_PROFILE_ID = Object.freeze([0x7e, 0x21, 1, 1, 1]);
export function decodeOrchestralFeatures(data) {
  if (!Array.isArray(data) || data.length !== 130 || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 127) || data[0] & 96 || data[1] || data.slice(2).some(count => count > 16)) throw new Error('Malformed orchestral articulation details');
  return Object.freeze({ muteType: !!(data[0] & 1), muteAmount: !!(data[0] & 2), playingPosition: !!(data[0] & 4), releaseVelocity: !!(data[0] & 8), manufacturerDiscovery: !!(data[0] & 16),
    variations: Object.freeze(data.slice(2)), interpretation: 'M2-123-v1.0-eight-standard-classifications' });
}
export function createOrchestralBinding(record, policy, { groupMask, group, channel, protocol } = {}) {
  const requested = validateOrchestralArticulationPolicy(policy), features = record?.orchestralFeatures;
  if (protocol !== 'midi2' || !record || record.id !== '7e21010101' || record.freshness !== 'current' || record.enabled !== true || record.channels !== 1 ||
      record.group !== group || record.scope !== channel || !(groupMask & 1 << group) || !features) throw new Error('Review the enabled single-channel orchestral profile, active MIDI2 protocol and current sound details on this route');
  if (requested.muteType != null && !features.muteType || requested.muteAmount01 != null && !features.muteAmount || requested.playingPosition01 != null && !features.playingPosition || requested.release.velocity01 != null && !features.releaseVelocity) throw new Error('The receiver did not report the requested optional orchestral control');
  for (const selection of [requested, ...requested.actions]) {
    const row = ORCHESTRAL_ARTICULATIONS.find(row => row.semanticId === selection.semanticId);
    if (features.variations[(row.attributeType - 16) * 16 + row.subclass] <= selection.variation) throw new Error('The receiver has no requested ' + selection.semanticId + ' variation; choose an available articulation explicitly');
  }
  return Object.freeze({ schema: 'lemmings-native-orchestral-profile/v1', profile: record.profile, record, policy: requested, policySignature: JSON.stringify(requested), group, channel, protocol, features,
    addresses: Object.freeze([Object.freeze({ group, channel })]), qualification: 'receiver-reported-M2-123-v1.0', categoryEvidence: 'authored-instrument-category-appendix-is-advisory' });
}
export function orchestralOnset(binding, intent, { group, channel, note, pitch, velocity01 }) {
  const articulation = intent.orchestralArticulation, features = binding.features;
  if (!articulation || articulation.profileMappingRevision !== 'M2-123-v1.0' || articulation.category !== binding.policy.category ||
      !ORCHESTRAL_ARTICULATIONS.some(row => row.semanticId === articulation.semanticId && row.attributeType === articulation.attributeType && row.subclass === articulation.subclass) ||
      features.variations[(articulation.attributeType - 16) * 16 + articulation.subclass] <= articulation.variation) throw new Error('A current supported semantic articulation must belong to this onset');
  if (Math.abs(pitch - note) > 1e-9) throw new Error('Microtonal pitch7.9 and orchestral articulation share one Note On attribute slot; this route has no independently qualified per-note pitch strategy');
  const words = [], control = (index, value) => words.push(...encodeIntent({ group, channel, status: 'registeredController', bank: 32, index, controllerValue: { value, bits: 32 } }));
  if (binding.policy.muteType != null) control(34, binding.policy.muteType * 0x08000000);
  if (binding.policy.muteAmount01 != null) control(35, Math.round(binding.policy.muteAmount01 * 0xffffffff));
  if (binding.policy.playingPosition01 != null) words.push(...encodeIntent({ group, channel, status: 'registeredPerNoteController', note, controller: 12, controllerValue: { value: Math.round(binding.policy.playingPosition01 * 0xffffffff), bits: 32 } }));
  const attributeData = articulation.subclass << 12 | articulation.variation << 8 | articulation.direction << 6 | (articulation.resetRoundRobin ? 8 : 0) | articulation.stringAssignment;
  words.push(...encodeIntent({ group, channel, status: 'noteOn', note, velocity: { value: Math.round(velocity01 * 65535), bits: 16 }, attributeType: articulation.attributeType, attributeData }));
  return Object.freeze({ words: Object.freeze(words), attributeType: articulation.attributeType, attributeData, semantic: articulation, qualification: binding.qualification });
}
export function orchestralRelease(binding, { group, channel, note }, articulation) {
  const release = binding.policy.release;
  return encodeIntent({ group, channel, status: 'noteOff', note, velocity: { value: release.velocity01 == null ? 0x8000 : Math.round(release.velocity01 * 65535), bits: 16 },
    ...(release.subclass == null ? {} : { attributeType: 16, attributeData: release.subclass << 12 | release.variation << 8 | (articulation?.stringAssignment || 0) }) });
}
