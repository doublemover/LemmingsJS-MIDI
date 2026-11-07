import { validateOrganRotaryPolicy, validateOrganRotaryControls } from '../content/OrganRotaryIntent.js';
import { encodeIntent } from '../protocol/UmpPacketCodec.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';
export const DRAWBAR_PROFILE_IDS = Object.freeze(['7e20010101', '7e20010102', '7e2001017f']);
export const ROTARY_PROFILE_ID = Object.freeze([0x7e, 0x22, 0, 1, 1]);
export const DRAWBAR_VALUES = Object.freeze([0x0e38e38e, 0x2aaaaaab, 0x471c71c7, 0x638e38e4, 0x80000000, 0x9c71c71d, 0xb8e38e39, 0xd5555556, 0xf1c71c72]);
export function decodeDrawbarFeatures(data) {
  if (!Array.isArray(data) || data.length !== 1 || !Number.isInteger(data[0]) || data[0] < 0 || data[0] & ~31) throw new Error('Malformed drawbar-organ optional features');
  return Object.freeze({ softTab: !!(data[0] & 1), vibratoChorus: !!(data[0] & 2), percussion: !!(data[0] & 4), keyClick: !!(data[0] & 8), leakage: !!(data[0] & 16) });
}
export function profileRegisteredWords(route, bank, index, value) {
  if (route.protocol === 'midi2') return encodeIntent({ group: route.group, channel: route.channel, status: 'registeredController', bank, index, controllerValue: { value, bits: 32 } });
  const fourteen = scaleMidiResolution(value, 32, 14), words = [];
  for (const [controller, data] of [[101, bank], [100, index], [6, fourteen >> 7], [38, fourteen & 127], [101, 127], [100, 127]]) words.push((0x20000000 | route.group << 24 | 11 << 20 | route.channel << 16 | controller << 8 | data) >>> 0);
  return Object.freeze(words);
}
export function createOrganRotaryBinding(organ, rotary, policy, { group, channel, groupMask, protocol, optionalRotary = [] } = {}) {
  const requested = validateOrganRotaryPolicy(policy), valid = record => record && record.enabled && record.freshness === 'current' && record.channels === 1 && record.group === group && record.scope === channel;
  const needsOrgan = requested.profiles !== 'rotary', needsRotary = requested.profiles !== 'organ';
  if (!(groupMask & 1 << group) || !['midi2', 'midi1-in-ump'].includes(protocol) || needsOrgan && (!valid(organ) || !DRAWBAR_PROFILE_IDS.includes(organ.id) || !organ.organFeatures) ||
      needsRotary && (!valid(rotary) || rotary.id !== '7e22000101')) throw new Error('Read and enable the required independent organ/rotary profiles on this exact channel');
  return Object.freeze({ schema: 'lemmings-native-organ-rotary/v1', policy: requested, policySignature: JSON.stringify(requested), organ: needsOrgan ? organ : null, rotary: needsRotary ? rotary : null,
    group, channel, protocol, optionalRotary: Object.freeze([...optionalRotary]), addresses: Object.freeze([Object.freeze({ group, channel })]), controlOnly: requested.routeMode === 'parallel-control',
    qualification: 'independent-receiver-reported-M2-121-v1.0.2-and-M2-122-v1.0.2' });
}
export function organRotaryValues(binding, controls, { density01 = null, circulationRadiansPerSecond = null } = {}) {
  const requested = validateOrganRotaryControls(controls), values = {};
  if (binding.organ) {
    let bars = requested.drawbars;
    if (!bars && binding.policy.drawbarSource === 'represented-actor-density' && density01 != null) bars = binding.policy.minimumDrawbars.map((minimum, index) => Math.max(0, Math.min(8, Math.round(minimum + density01 * (binding.policy.maximumDrawbars[index] - minimum)))));
    if (bars) bars.forEach((setting, index) => { values['64:' + (48 + index)] = DRAWBAR_VALUES[setting]; });
    if (requested.percussion != null) { if (!binding.organ.organFeatures.percussion) throw new Error('Organ percussion is unsupported'); values['64:59'] = requested.percussion ? 0xffffffff : 0; }
    if (requested.keyClick01 != null) { if (!binding.organ.organFeatures.keyClick) throw new Error('Organ key click is unsupported'); values['64:64'] = Math.round(requested.keyClick01 * 0xffffffff); }
    if (requested.leakage01 != null) { if (!binding.organ.organFeatures.leakage) throw new Error('Organ leakage is unsupported'); values['64:65'] = Math.round(requested.leakage01 * 0xffffffff); }
  }
  if (binding.rotary) {
    const fast = requested.rotaryFast ?? (binding.policy.rotarySource === 'cohort-circulation' && circulationRadiansPerSecond != null ? Math.abs(circulationRadiansPerSecond) >= binding.policy.fullRotationRadiansPerSecond / 2 : null);
    if (fast != null) values['96:32'] = fast ? 0xffffffff : 0;
    if (requested.rotaryBrake != null) { if (!binding.optionalRotary.includes(34)) throw new Error('Rotary brake support has not been declared by current controller metadata'); values['96:34'] = requested.rotaryBrake ? 0xffffffff : 0; }
    if (requested.acceleration01 != null) { if (![39, 41].every(index => binding.optionalRotary.includes(index))) throw new Error('Independent rotary acceleration controls have not been declared'); values['96:39'] = values['96:41'] = Math.round(requested.acceleration01 * 0xffffffff); }
  }
  return Object.freeze(values);
}
export function measureOrganFormation(contributors, tick) {
  const actors = new Map(); let represented = 0;
  for (const row of contributors.values()) { if (row.actorId != null && !actors.has(row.actorId)) actors.set(row.actorId, row); represented = Math.max(represented, row.representedCount || 0); }
  const density01 = Math.min(1, Math.log2(Math.max(actors.size, represented) + 1) / 8), positions = [...actors.values()].filter(row => row.position);
  if (positions.length < 2 || positions.length !== actors.size) return Object.freeze({ density01, circulationRadiansPerSecond: null, positionEvidence: 'insufficient-current-actor-positions', actorCount: actors.size, representedCount: represented });
  let x = 0, y = 0; for (const row of positions) { x += row.position.x; y += row.position.y; } x /= positions.length; y /= positions.length;
  let cross = 0, radiusSquared = 0;
  for (const row of positions) { const dx = row.position.x - x, dy = row.position.y - y, velocity = row.tick === tick ? row.velocity : null; radiusSquared += dx * dx + dy * dy; if (velocity) cross += dx * velocity.y - dy * velocity.x; }
  return Object.freeze({ density01, circulationRadiansPerSecond: radiusSquared > 1e-9 ? cross / radiusSquared : 0, positionEvidence: 'completed-position-and-displacement-facts', actorCount: actors.size, representedCount: represented });
}
