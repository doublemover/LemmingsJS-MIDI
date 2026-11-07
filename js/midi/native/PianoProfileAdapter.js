import { validatePianoPerformancePolicy, validatePianoPartControls } from '../content/PianoPerformanceIntent.js';
import { encodeIntent } from '../protocol/UmpPacketCodec.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';

export const PIANO_PROFILE_ID = Object.freeze([0x7e, 0x20, 0, 1, 1]);
export function decodePianoFeatures(data) {
  if (!Array.isArray(data) || data.length !== 31 || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 127) || data[0] & 120 ||
      data[14] & 64 || data[16] & 112 || data[19] & 120 || data[20] & 126 || data[25] > data[26]) throw new Error('Malformed Piano Profile target0x40 details');
  const receiver = data[13], flags = data.slice(13, 22);
  return Object.freeze({ sender: !!(data[0] & 1), toneGenerator: !!(data[0] & 2), reproducingUnit: !!(data[0] & 4),
    keyVelocity: !!(receiver & 1), noteOffVelocity: !!(receiver & 2), continuousSustain: !!(receiver & 4), sostenuto: !!(receiver & 8), unaCorda: !!(receiver & 16), continuousUnaCorda: !!(receiver & 32),
    scaleTuning: !!(data[15] & 4), scaleTonic: !!(data[15] & 8), receiverFeatureBytes: Object.freeze(flags), senderFeatureBytes: Object.freeze(data.slice(1, 10)),
    pianoSizeMillimeters: data[22] | data[23] << 7, highestDampedNote: data[24], lowestNote: data[25], highestNote: data[26],
    minimumRenderingDelayRaw: data[27] | data[28] << 7, currentRenderingDelayRaw: data[29] | data[30] << 7, interpretation: 'M2-126-v1.0-2026-07-08-target0x40' });
}
export function createPianoProfileBinding(record, policy, { group, channel, groupMask, protocol, cleanupVersion } = {}) {
  const requested = validatePianoPerformancePolicy(policy), features = record?.pianoFeatures;
  if (!record || record.id !== '7e20000101' || !record.enabled || record.freshness !== 'current' || record.channels !== 1 || record.group !== group || record.scope !== channel ||
      !(groupMask & 1 << group) || !['midi2', 'midi1-in-ump'].includes(protocol) || cleanupVersion !== 1 || !features || !features.toneGenerator && !features.reproducingUnit) throw new Error('Read a current receiving Piano Profile on this channel using a companion with owned-pedal cleanup');
  if (requested.releaseVelocity01 != null && !features.noteOffVelocity) throw new Error('The piano did not report variable Note Off velocity support');
  if (requested.tuning && (!features.scaleTuning || !features.scaleTonic)) throw new Error('The piano did not report scale tuning and tonic support');
  return Object.freeze({ schema: 'lemmings-native-piano-profile/v1', profile: record.profile, record, policy: requested, policySignature: JSON.stringify(requested), features, group, channel, protocol,
    addresses: Object.freeze([Object.freeze({ group, channel })]), qualification: 'receiver-reported-Piano-Profile-local-engine-unqualified' });
}
export function pianoControllerWords(route, controller, value) {
  if (route.protocol === 'midi2') return encodeIntent({ group: route.group, channel: route.channel, status: 'controlChange', controller, controllerValue: { value, bits: 32 } });
  return Object.freeze([(0x20000000 | route.group << 24 | 11 << 20 | route.channel << 16 | controller << 8 | scaleMidiResolution(value, 32, 7)) >>> 0]);
}
export function pianoTuningWords(route, binding) {
  const tuning = binding.policy.tuning; if (!tuning) return Object.freeze([]);
  const words = [], tonicRange = (tuning.tonic + 3) % 12 + 1;
  for (const [index, value] of [[2, tuning.temperament * 0x08000000], [3, tonicRange * 0x10000000 + 0x08000000]]) {
    if (route.protocol === 'midi2') words.push(...encodeIntent({ group: route.group, channel: route.channel, status: 'registeredController', bank: 65, index, controllerValue: { value, bits: 32 } }));
    else { const fourteen = scaleMidiResolution(value, 32, 14); for (const [controller, data] of [[101, 65], [100, index], [6, fourteen >> 7], [38, fourteen & 127], [101, 127], [100, 127]]) words.push((0x20000000 | route.group << 24 | 11 << 20 | route.channel << 16 | controller << 8 | data) >>> 0); }
  }
  return Object.freeze(words);
}
export function pianoNoteWords(route, binding, intent, note, pitch, ending = false) {
  if (note < binding.features.lowestNote || note > binding.features.highestNote) throw new Error('This piano does not report the requested note as playable');
  const performance = intent.pianoPerformance; if (!performance || performance.mappingRevision !== 'M2-126-v1.0-2026-07-08' || Math.abs(pitch - note) > 1e-9) throw new Error('This piano route needs an authored profile dynamic and a qualified integral note; no unverified pitch attribute is inferred');
  const velocity = ending ? binding.policy.releaseVelocity01 == null ? 0x8000 : Math.round(binding.policy.releaseVelocity01 * 65535) : performance.hammerVelocity;
  if (route.protocol === 'midi2') return encodeIntent({ group: route.group, channel: route.channel, status: ending ? 'noteOff' : 'noteOn', note, velocity: { value: velocity, bits: 16 } });
  const scaled = ending ? scaleMidiResolution(velocity, 16, 7) : Math.max(1, scaleMidiResolution(velocity, 16, 7));
  return Object.freeze([(0x20000000 | route.group << 24 | (ending ? 8 : 9) << 20 | route.channel << 16 | note << 8 | scaled) >>> 0]);
}
export function pianoPedalValues(binding, controls, source) {
  const requested = validatePianoPartControls(controls), features = binding.features;
  if (requested.sostenuto01 > 0 && !features.sostenuto || requested.unaCorda01 > 0 && !features.unaCorda) throw new Error('The receiver did not report this optional pedal');
  const sustain = requested.sustain01 ?? source;
  return Object.freeze({ sustain01: features.continuousSustain ? sustain : sustain >= 0.5 ? 1 : 0,
    sostenuto01: (requested.sostenuto01 ?? 0) >= 0.5 ? 1 : 0, unaCorda01: features.continuousUnaCorda ? requested.unaCorda01 ?? 0 : (requested.unaCorda01 ?? 0) >= 0.5 ? 1 : 0 });
}
