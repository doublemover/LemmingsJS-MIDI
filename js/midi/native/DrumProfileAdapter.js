import { validatePercussionIntentPolicy } from '../content/PercussionRoleIntent.js';

export const DRUM_PROFILE_ID = Object.freeze([0x7e, 0x20, 3, 1, 1]);
const names = [
  'high-q', 'slap', 'scratch-push', 'scratch-pull', 'sticks', 'square-click', 'metronome-click', 'metronome-bell',
  'acoustic-bass-drum', 'bass-drum', 'side-stick', 'acoustic-snare', 'hand-clap', 'electric-snare', 'low-floor-tom', 'closed-hi-hat',
  'high-floor-tom', 'pedal-hi-hat', 'low-tom', 'open-hi-hat', 'low-mid-tom', 'high-mid-tom', 'crash-cymbal', 'high-tom', 'ride-cymbal',
  'chinese-cymbal', 'ride-bell', 'tambourine', 'splash-cymbal', 'cowbell', 'crash-cymbal-2', 'vibra-slap', 'ride-cymbal-2',
  'high-bongo', 'low-bongo', 'mute-high-conga', 'open-high-conga', 'low-conga', 'high-timbale', 'low-timbale', 'high-agogo', 'low-agogo',
  'cabasa', 'maracas', 'short-whistle', 'long-whistle', 'short-guiro', 'long-guiro', 'claves', 'high-wood-block', 'low-wood-block',
  'mute-cuica', 'open-cuica', 'mute-triangle', 'open-triangle', 'shaker', 'jingle-bell', 'bell-tree', 'castanets', 'mute-surdo', 'open-surdo', 'applause'
];
const mes = new Map([[42, 1], [44, 1], [46, 1], [71, 2], [72, 2], [73, 3], [74, 3], [78, 4], [79, 4], [80, 5], [81, 5], [86, 6], [87, 6], [29, 7], [30, 7]]);
export const DEFAULT_DRUM_ROLES = Object.freeze(names.map((instrumentRole, index) => Object.freeze({ instrumentRole, note: index + 27, mutuallyExclusiveSet: mes.get(index + 27) || null })));
const byRole = new Map(DEFAULT_DRUM_ROLES.map(row => [row.instrumentRole, row]));
export function decodeDrumFeatures(data) {
  if (!Array.isArray(data) || data.length < 10 || data.length > 20 || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 127) || data[0] & 124 || data[9] & 64 || data.slice(10).some(Boolean)) throw new Error('Malformed Default Drum Note Map features');
  return Object.freeze({ perNoteControllers: !!(data[0] & 1), keyBasedControllers: !!(data[0] & 2),
    availableNotes: Object.freeze(DEFAULT_DRUM_ROLES.filter(row => data[1 + Math.floor((row.note - 27) / 7)] & 1 << (row.note - 27) % 7).map(row => row.note)),
    interpretation: 'M2-125-v1.0-table-11-first-ten-bytes-zero-extension-only' });
}
export function createDrumMapBinding(record, policy, { groupMask, group, channel, protocol } = {}) {
  const intent = validatePercussionIntentPolicy(policy);
  if (!Number.isInteger(group) || !(groupMask & 1 << group) || !Number.isInteger(channel) || channel < 0 || channel > 15 || !['midi2', 'midi1-in-ump'].includes(protocol)) throw new Error('Choose an explicitly granted drum group, channel and protocol');
  const qualified = intent.map.kind === 'profile-default';
  if (qualified && (!record || !['7e20030101', '7e2003017f'].includes(record.id) || !record.enabled || record.freshness !== 'current' || record.group !== group || record.scope !== channel || record.channels !== 1 || !record.drumFeatures)) throw new Error('Read current drum profile allocation and sound-availability details on this exact channel');
  const used = [intent.instrumentRole, ...intent.actions.map(row => row.instrumentRole)];
  const mapping = intent.map.kind === 'custom' ? intent.map.notes.map(row => Object.freeze({ ...row, mutuallyExclusiveSet: null })) : DEFAULT_DRUM_ROLES;
  for (const role of used) {
    const row = mapping.find(row => row.instrumentRole === role);
    if (!row || qualified && !record.drumFeatures.availableNotes.includes(row.note)) throw new Error('The selected receiver/map has no available ' + role + ' sound');
  }
  return Object.freeze({ schema: 'lemmings-native-drum-map/v1', policy: intent, policySignature: JSON.stringify(intent), group, channel, protocol,
    mapping: Object.freeze(mapping), profile: qualified ? record.profile : null, profileRecord: qualified ? record : null,
    qualification: qualified ? 'receiver-reported-M2-125-v1.0' : 'user-selected-unverified-' + intent.map.kind,
    mutuallyExclusiveBehavior: qualified ? 'profile-defined-seven-sets' : 'unverified-no-inferred-choke', overlapPolicy: 'refuse-same-note',
    addresses: Object.freeze([Object.freeze({ group, channel })]), independentSameNoteVoices: false });
}
export function resolvePercussionHit(binding, hit) {
  if (!binding || hit?.schema !== 'lemmings-percussion-hit/v1') throw new Error('An authored percussion role and explicitly reviewed native drum map are required');
  const row = binding.mapping.find(row => row.instrumentRole === hit.instrumentRole);
  if (!row || binding.profileRecord && !binding.profileRecord.drumFeatures.availableNotes.includes(row.note)) throw new Error('This drum role is unavailable in the accepted map');
  if (hit.articulation !== 'default') throw new Error('This note-map binding does not define the requested articulation; select its distinct instrument role');
  return Object.freeze({ note: row.note, instrumentRole: row.instrumentRole, mutuallyExclusiveSet: binding.profile ? row.mutuallyExclusiveSet : null,
    qualification: binding.qualification, velocity01: hit.velocity01, releaseVelocity01: hit.releaseVelocity01 });
}
export const defaultDrumRole = role => byRole.get(role) || null;
