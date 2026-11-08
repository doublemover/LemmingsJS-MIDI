import { encodeIntent, normalizedUmpPitchBend } from '../protocol/UmpPacketCodec.js';

export const MPE_PROFILE_ID = Object.freeze([0x7e, 0x31, 0, 1, 1]);
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const midi1 = (route, status, index, value = 0) => [(0x20000000 | route.group << 24 | status << 20 | route.channel << 16 | index << 8 | value) >>> 0];
const cc = (route, controller, value) => route.protocol === 'midi2' ?
  encodeIntent({ group: route.group, channel: route.channel, status: 'controlChange', controller, controllerValue: { value: Math.round(value * 0xffffffff), bits: 32 } }) :
  midi1(route, 11, controller, Math.round(value * 127));
const rpn = (route, bank, index, value14, value32) => route.protocol === 'midi2' ?
  encodeIntent({ group: route.group, channel: route.channel, status: 'registeredController', bank, index, controllerValue: { value: value32, bits: 32 } }) :
  [...midi1(route, 11, 101, bank), ...midi1(route, 11, 100, index), ...midi1(route, 11, 6, value14 >> 7), ...midi1(route, 11, 38, value14 & 127),
    ...midi1(route, 11, 101, 127), ...midi1(route, 11, 100, 127)];
export function decodeMpeFeatures(data) {
  if (!Array.isArray(data) || data.length !== 4 || data[0] & ~1 || ![0, 1].includes(data[1]) || ![0, 1, 2].includes(data[2]) || ![0, 1, 2].includes(data[3])) throw new Error('Malformed MPE optional-feature declaration');
  return Object.freeze({ responseNotifications: !!(data[0] & 1), pitchBend: !!data[1], pressure: data[2], thirdAxis: data[3] });
}
export function createMpeProfileBinding(record, { groupMask, protocol, pressureForm = 'classic', thirdAxisForm = 'classic' }) {
  if (record?.id !== '7e31000101' || record.enabled !== true || record.freshness !== 'current' || record.scope < 0 || record.scope > 15 ||
      !Number.isInteger(record.channels) || record.channels < 2 || record.channels > 256 || !record.mpeFeatures ||
      !['midi2', 'midi1-in-ump'].includes(protocol) || !['classic', 'bipolar'].includes(pressureForm) || !['classic', 'bipolar'].includes(thirdAxisForm)) throw new Error('Read MPE allocation and optional features after the receiver enables this profile');
  if (pressureForm === 'bipolar' && record.mpeFeatures.pressure !== 2 || thirdAxisForm === 'bipolar' && record.mpeFeatures.thirdAxis !== 2) throw new Error('Receiver did not declare the selected bipolar expression form');
  const first = record.group * 16 + record.scope, last = first + record.channels;
  if (last > 256) throw new Error('Accepted MPE allocation exceeds the endpoint');
  const addresses = [];
  for (let value = first; value < last; value++) {
    const group = value >> 4, channel = value & 15;
    if (!(groupMask & 1 << group)) throw new Error('Grant every group in the accepted MPE allocation explicitly');
    addresses.push(Object.freeze({ group, channel }));
  }
  return Object.freeze({ schema: 'lemmings-ci-mpe-binding/v1', profile: MPE_PROFILE_ID, specification: 'M2-120-v2.0.3', profileRevision: record.revision,
    connectionEpoch: record.connectionEpoch, ciEpoch: record.ciEpoch, peerMuid: record.peerMuid, group: record.group, scope: record.scope, protocol,
    manager: addresses[0], members: Object.freeze(addresses.slice(1)), addresses: Object.freeze(addresses), channels: record.channels, bendRangeHcu: 48,
    pressureForm, thirdAxisForm, features: record.mpeFeatures, nativePerNoteControllers: false, channelResponse: record.mpeChannelResponse || 'unknown',
    capacityPolicy: 'one-owned-active-note-per-member-refuse-overflow' });
}
export function mpePitchWords(route, binding, semitones) {
  if (!Number.isFinite(semitones) || Math.abs(semitones) > binding.bendRangeHcu) throw new Error('Pitch exceeds the shared MPE bend range');
  if (!binding.features.pitchBend) { if (semitones) throw new Error('Receiver did not declare MPE pitch bend'); return []; }
  const normalized = semitones / binding.bendRangeHcu;
  if (route.protocol === 'midi2') return encodeIntent({ group: route.group, channel: route.channel, status: 'pitchBend', controllerValue: normalizedUmpPitchBend(normalized) });
  const value = Math.round(8192 + normalized * (normalized < 0 ? 8192 : 8191));
  return midi1(route, 14, value & 127, value >> 7);
}
export function mpeAxisWords(route, binding, axis, value) {
  if (!unit(value) || !['pressure01', 'timbre01'].includes(axis)) throw new Error('Invalid MPE expression axis');
  const pressure = axis === 'pressure01', supported = binding.features[pressure ? 'pressure' : 'thirdAxis'];
  if (!supported) return null;
  const form = pressure ? binding.pressureForm : binding.thirdAxisForm;
  if (form === 'bipolar') return rpn(route, 32, pressure ? 32 : 33, Math.round(8192 + value * 8191), Math.round(0x80000000 + value * 0x7fffffff));
  if (!pressure) return cc(route, 74, value);
  return route.protocol === 'midi2' ? encodeIntent({ group: route.group, channel: route.channel, status: 'channelPressure', controllerValue: { value: Math.round(value * 0xffffffff), bits: 32 } }) : midi1(route, 13, Math.round(value * 127));
}
export function mpeManagerSetup(route, binding, gain = 1) {
  if (!unit(gain)) throw new Error('Invalid MPE cohort gain');
  const manager = { ...route, ...binding.manager };
  return [...rpn(manager, 0, 0, 48 << 7, 48 * 0x2000000), ...mpePitchWords(manager, binding, 0), ...cc(manager, 11, gain)];
}
export function mpeManagerGainWords(route, binding, gain) {
  if (!unit(gain)) throw new Error('MPE cohort gain must be between zero and one');
  return cc({ ...route, ...binding.manager }, 11, gain);
}
