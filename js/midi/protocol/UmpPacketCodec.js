import { scaleMidiResolution } from './MidiProtocolLowering.js';

export const UMP_CODEC_VERSION = 'lemmings-ump-v1';
export const UMP_WORD_COUNTS = Object.freeze([1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]);
const CV = Object.freeze(['registeredPerNoteController', 'assignablePerNoteController', 'registeredController', 'assignableController', 'relativeRegisteredController', 'relativeAssignableController', 'perNotePitchBend', null, 'noteOff', 'noteOn', 'polyPressure', 'controlChange', 'programChange', 'channelPressure', 'pitchBend', 'perNoteManagement']);
const UTILITY = Object.freeze(['noop', 'jrClock', 'jrTimestamp', 'deltaClockstampTicksPerQuarter', 'deltaClockstamp']);
const SYSTEM = Object.freeze({ 241: ['quarterFrame', 1], 242: ['songPosition', 2], 243: ['songSelect', 1], 246: ['tuneRequest', 0], 248: ['clock', 0], 250: ['start', 0], 251: ['continue', 0], 252: ['stop', 0], 254: ['activeSense', 0], 255: ['reset', 0] });
const STREAM = Object.freeze({ 0: 'endpointDiscovery', 1: 'endpointInfo', 2: 'deviceIdentity', 3: 'endpointName', 4: 'productInstanceId', 5: 'streamConfigurationRequest', 6: 'streamConfigurationNotify', 16: 'functionBlockDiscovery', 17: 'functionBlockInfo', 18: 'functionBlockName', 32: 'startOfClip', 33: 'endOfClip' });
const FLEX_SETUP = Object.freeze({ 0: 'tempo', 1: 'timeSignature', 2: 'metronome', 5: 'keySignature', 6: 'chordName' });
const bad = (code, message, offset = null) => Object.assign(new Error(message), { name: 'UmpCodecError', code, wordOffset: offset });
const uint = (value, bits, label) => {
  if (!Number.isInteger(bits) || bits < 1 || bits > 32 || !Number.isInteger(value) || value < 0 || value >= 2 ** bits) throw bad('invalid-field', `Invalid ${label || 'unsigned ' + bits + '-bit value'}.`);
  return value;
};
const zero = (value, label) => { if (value !== 0) throw bad('reserved-bits', 'Nonzero reserved ' + label + '.'); };
const bytesOf = words => words.flatMap(word => [word >>> 24, (word >>> 16) & 255, (word >>> 8) & 255, word & 255]);
const pad = (bytes, first) => { if (bytes.slice(first).some(value => value !== 0)) throw bad('reserved-padding', 'Unused UMP payload bytes must be zero.'); };
const value = (number, bits, sourceBits = bits, signed = false) => Object.freeze({ value: number, bits, sourceBits, signed, precision: sourceBits < bits ? 'promoted' : 'source-resolution' });
const packet = (words, fields) => Object.freeze({ schema: UMP_CODEC_VERSION, messageType: words[0] >>> 28, words: Object.freeze(words), wordCount: words.length, known: true, dispatchable: true, ...fields });
const unknown = (words, reason, fields = {}) => packet(words, { kind: 'unknown', known: false, dispatchable: false, reason, ...fields });
const arrayWords = (input, maximum) => {
  if (!Array.isArray(input) && !(input instanceof Uint32Array) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1048576 || input.length > maximum) throw bad('word-capacity', 'UMP input exceeds its declared word bound.');
  if (typeof SharedArrayBuffer === 'function' && input.buffer instanceof SharedArrayBuffer) throw bad('shared-input', 'UMP words require an owned stable snapshot.');
  const words = Array.from(input); for (const word of words) uint(word, 32, 'UMP word'); return words;
};

export function decodeUmpPacket(input, { preserveUnknown = true } = {}) {
  const words = arrayWords(input, 4);
  if (!words.length || words.length !== UMP_WORD_COUNTS[words[0] >>> 28]) throw bad('packet-length', 'UMP message type and complete packet width differ.');
  const [first, second] = words, type = first >>> 28, group = (first >>> 24) & 15, opcode = (first >>> 20) & 15, channel = (first >>> 16) & 15, index = (first >>> 8) & 255, detail = first & 255;
  let result;
  if (type === 0) {
    zero(group, 'utility group');
    if (!UTILITY[opcode]) result = unknown(words, 'unsupported-utility-status', { status: opcode });
    else {
      if (opcode !== 4) zero(first & 0x000f0000, 'utility status');
      if (opcode === 0) zero(first & 0xfffff, 'no-op payload');
      result = packet(words, { kind: 'utility', status: UTILITY[opcode], data: opcode === 4 ? first & 0xfffff : first & 65535 });
    }
  } else if (type === 1) {
    const status = (first >>> 16) & 255, definition = SYSTEM[status];
    if (!definition) result = unknown(words, 'unsupported-system-status', { group, status });
    else {
      uint(index, 7, 'system data'); uint(detail, 7, 'system data'); if (definition[1] < 2) zero(detail, 'system data 2'); if (!definition[1]) zero(index, 'system data 1');
      result = packet(words, { kind: 'system', protocol: 'midi1', group, status: definition[0], data: Object.freeze([index, detail].slice(0, definition[1])) });
    }
  } else if (type === 2) {
    if (opcode < 8 || opcode > 14) result = unknown(words, 'unsupported-midi1-status', { group, channel, status: opcode });
    else {
      uint(index, 7, 'MIDI1 data'); uint(detail, 7, 'MIDI1 data'); if ([12, 13].includes(opcode)) zero(detail, 'MIDI1 data 2');
      result = packet(words, { kind: 'midi1-channel-voice', protocol: 'midi1', group, channel, status: CV[opcode], data: Object.freeze([index, detail].slice(0, [12, 13].includes(opcode) ? 1 : 2)),
        zeroVelocityNoteOff: opcode === 9 && detail === 0, sourceResolution: opcode === 14 ? 14 : 7 });
    }
  } else if (type === 4) {
    if (!CV[opcode]) result = unknown(words, 'unsupported-midi2-status', { group, channel, status: opcode });
    else {
      let fields = { status: CV[opcode] };
      if (opcode === 0 || opcode === 1) { uint(index, 7, 'per-note note'); fields = { ...fields, note: index, controller: detail, controllerValue: value(second, 32) }; }
      else if (opcode >= 2 && opcode <= 5) {
        uint(index, 7, 'parameter bank'); uint(detail, 7, 'parameter index');
        fields = { ...fields, bank: index, index: detail, controllerValue: value(opcode >= 4 && second >= 0x80000000 ? second - 0x100000000 : second, 32, 32, opcode >= 4), semantics: opcode >= 4 ? 'relative-nonreplaceable' : 'absolute' };
      } else if (opcode === 8 || opcode === 9) {
        uint(index, 7, 'note'); if (!detail) zero(second & 65535, 'note attribute');
        fields = { ...fields, note: index, velocity: value(second >>> 16, 16), attributeType: detail, attributeData: second & 65535, zeroVelocityNoteOff: false };
      } else if (opcode === 12) {
        zero(index, 'program index'); zero(detail & 254, 'program flags'); zero(second & 0x00ff0000, 'program payload'); uint(second >>> 24, 7, 'program'); uint((second >>> 8) & 255, 7, 'bank MSB'); uint(second & 255, 7, 'bank LSB');
        if (!(detail & 1)) zero(second & 65535, 'absent program bank');
        fields = { ...fields, program: second >>> 24, bankValid: !!(detail & 1), bankMSB: (second >>> 8) & 127, bankLSB: second & 127 };
      } else if (opcode === 15) {
        uint(index, 7, 'managed note'); zero(detail & 252, 'per-note-management flags'); zero(second, 'per-note-management payload');
        fields = { ...fields, note: index, reset: !!(detail & 1), detach: !!(detail & 2) };
      } else {
        zero(detail, 'channel-voice detail'); if ([13, 14].includes(opcode)) zero(index, 'channel-wide index'); else uint(index, 7, 'channel-voice index');
        fields = { ...fields, ...([6, 10].includes(opcode) ? { note: index } : opcode === 11 ? { controller: index } : {}), controllerValue: value(second, 32), ...([6, 14].includes(opcode) ? { center: 0x80000000 } : {}) };
      }
      result = packet(words, { kind: 'midi2-channel-voice', protocol: 'midi2', group, channel, ...fields });
    }
  } else if (type === 3 || type === 5 && opcode <= 3) {
    if (opcode > 3) result = unknown(words, 'unsupported-data64-status', { group, status: opcode });
    else {
      const bytes = bytesOf(words), count = (first >>> 16) & 15, sysex8 = type === 5;
      if (sysex8 ? count < 1 || count > 14 : count > 6) throw bad('sysex-length', 'SysEx UMP payload count is invalid.');
      const firstByte = sysex8 ? 3 : 2, length = sysex8 ? count - 1 : count, payload = bytes.slice(firstByte, firstByte + length);
      if (!sysex8) for (const byte of payload) uint(byte, 7, 'SysEx7 payload'); pad(bytes, firstByte + length);
      result = packet(words, { kind: sysex8 ? 'sysex8' : 'sysex7', group, format: opcode, ...(sysex8 ? { streamId: index } : {}), payload: Object.freeze(payload) });
    }
  } else if (type === 5 && [8, 9].includes(opcode)) {
    const bytes = bytesOf(words), dataSetId = channel;
    result = packet(words, opcode === 8 ? { kind: 'mixed-data-set-header', group, dataSetId, validBytes: index * 256 + detail,
      chunks: bytes[4] * 256 + bytes[5], chunkIndex: bytes[6] * 256 + bytes[7], manufacturerId: bytes[8] * 256 + bytes[9], deviceId: bytes[10] * 256 + bytes[11], subId1: bytes[12] * 256 + bytes[13], subId2: bytes[14] * 256 + bytes[15] }
      : { kind: 'mixed-data-set-payload', group, dataSetId, payload: Object.freeze(bytes.slice(2)) });
  } else if (type === 5) result = unknown(words, 'unsupported-data128-status', { group, status: opcode });
  else if (type === 13) {
    const format = (first >>> 22) & 3, address = (first >>> 20) & 3, bank = index, status = detail;
    if (address > 1) throw bad('flex-address', 'Reserved Flex Data addressing mode.'); if (address === 1) zero(channel, 'group-addressed Flex channel');
    const known = bank === 0 ? Object.hasOwn(FLEX_SETUP, status) : bank === 1 ? status <= 12 : bank === 2 && status <= 4;
    if (bank === 0 && format !== 0) throw bad('flex-format', 'Setup/performance Flex Data must be complete.');
    if (bank === 0 && status === 0) { if (!second) throw bad('tempo-zero', 'A Flex tempo must be nonzero.'); zero(words[2] | words[3], 'tempo payload'); }
    if (bank === 0 && status === 1) { zero(second & 255, 'time-signature payload'); zero(words[2] | words[3], 'time-signature padding'); }
    result = packet(words, { kind: 'flex-data', group, format, address: address ? 'group' : 'channel', ...(address ? {} : { channel }), bank, status,
      ...(bank === 0 && FLEX_SETUP[status] ? { subtype: FLEX_SETUP[status] } : {}), payload: Object.freeze(bytesOf(words).slice(4)), known, dispatchable: known, ...(known ? {} : { reason: 'unsupported-flex-status' }) });
  } else if (type === 15) {
    const format = (first >>> 26) & 3, status = (first >>> 16) & 1023, subtype = STREAM[status];
    if (subtype && ![3, 4, 18].includes(status) && format) throw bad('stream-format', 'This Stream message cannot be fragmented.');
    if ([32, 33].includes(status)) { zero(first & 65535, 'clip marker'); zero(second | words[2] | words[3], 'clip marker payload'); }
    if (status === 0) { zero(second & 0xffffffe0, 'endpoint-discovery filter'); zero(words[2] | words[3], 'endpoint-discovery payload'); }
    result = packet(words, { kind: 'stream', format, status, ...(subtype ? { subtype } : {}), payload: Object.freeze(bytesOf(words).slice(2)), known: !!subtype, dispatchable: !!subtype, ...(subtype ? {} : { reason: 'unsupported-stream-status' }) });
  } else result = unknown(words, 'reserved-message-type');
  if (!preserveUnknown && !result.known) throw bad('unsupported-packet', result.reason);
  return result;
}

export function parseWords(input, { maximumWords = 4096, preserveUnknown = true } = {}) {
  const words = arrayWords(input, maximumWords), result = [];
  for (let at = 0; at < words.length;) {
    const count = UMP_WORD_COUNTS[words[at] >>> 28];
    if (at + count > words.length) throw bad('truncated-packet', 'A complete UMP batch cannot end inside a packet.', at);
    try { result.push(decodeUmpPacket(words.slice(at, at + count), { preserveUnknown })); }
    catch (error) { error.wordOffset = at; throw error; } at += count;
  }
  return Object.freeze(result);
}
export function validatePacket(words, options) {
  try { return Object.freeze({ valid: true, packet: decodeUmpPacket(words, { preserveUnknown: false, ...options }) }); }
  catch (error) { return Object.freeze({ valid: false, error: Object.freeze({ code: error.code || 'invalid-packet', message: error.message }) }); }
}

export function umpWordsToBytes(input, { maximumWords = 4096 } = {}) {
  const words = arrayWords(input, maximumWords); parseWords(words, { maximumWords });
  const bytes = new Uint8Array(words.length * 4), view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word, false)); return bytes;
}
export function umpBytesToWords(input, { maximumWords = 4096 } = {}) {
  if (!(input instanceof Uint8Array) || input.byteLength % 4 || input.byteLength > maximumWords * 4) throw bad('wire-length', 'UMP wire bytes require complete big-endian words.');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength), words = [];
  for (let index = 0; index < input.byteLength; index += 4) words.push(view.getUint32(index, false));
  parseWords(words, { maximumWords }); return Object.freeze(words);
}

export function promoteUmpValue(input, destinationBits) {
  if (!input || typeof input !== 'object') throw bad('resolution-required', 'A typed source value is required.');
  uint(input.value, input.bits, 'source value');
  if (!Number.isInteger(input.bits) || input.bits < 1 || input.bits > 32 || !Number.isInteger(input.sourceBits ?? input.bits) || (input.sourceBits ?? input.bits) < 1 || (input.sourceBits ?? input.bits) > input.bits) throw bad('resolution-required', 'Invalid original MIDI resolution.');
  return value(scaleMidiResolution(input.value, input.bits, destinationBits), destinationBits, Math.min(input.sourceBits ?? input.bits, destinationBits));
}

export function encodeIntent(input) {
  if (!input || typeof input !== 'object') throw bad('invalid-intent', 'A typed wire intent is required.');
  const group = uint(input.group, 4, 'group'), channel = uint(input.channel, 4, 'channel'), opcode = CV.indexOf(input.status);
  if (opcode < 0 || opcode === 7) throw bad('unsupported-intent', 'Unknown MIDI2 channel voice intent.');
  let index = 0, detail = 0, data = 0;
  if ([8, 9].includes(opcode)) {
    index = uint(input.note, 7, 'note'); detail = uint(input.attributeType ?? 0, 8, 'attribute type');
    const velocity = promoteUmpValue(input.velocity, 16).value; data = velocity * 65536 + uint(input.attributeData ?? 0, 16, 'attribute data');
  } else if (opcode === 12) {
    detail = input.bankValid === true ? 1 : 0; data = uint(input.program, 7, 'program') * 16777216 + uint(input.bankMSB ?? 0, 7, 'bank MSB') * 256 + uint(input.bankLSB ?? 0, 7, 'bank LSB');
  } else if (opcode === 15) { index = uint(input.note, 7, 'managed note'); detail = (input.reset === true ? 1 : 0) | (input.detach === true ? 2 : 0); }
  else {
    if ([0, 1, 6, 10].includes(opcode)) index = uint(input.note, 7, 'note');
    if ([0, 1].includes(opcode)) detail = uint(input.controller, 8, 'per-note controller');
    if (opcode >= 2 && opcode <= 5) { index = uint(input.bank, 7, 'parameter bank'); detail = uint(input.index, 7, 'parameter index'); }
    if (opcode === 11) index = uint(input.controller, 7, 'controller');
    if (opcode === 4 || opcode === 5) {
      if (input.controllerValue?.signed !== true || input.controllerValue.bits !== 32 || !Number.isInteger(input.controllerValue.value) || input.controllerValue.value < -2147483648 || input.controllerValue.value > 2147483647) throw bad('relative-value', 'Relative controllers require a signed 32-bit increment.');
      data = input.controllerValue.value >>> 0;
    } else data = promoteUmpValue(input.controllerValue, 32).value;
  }
  const words = [(0x40000000 + group * 16777216 + opcode * 1048576 + channel * 65536 + index * 256 + detail) >>> 0, data >>> 0];
  decodeUmpPacket(words, { preserveUnknown: false }); return Object.freeze(words);
}

export function encodeIntentReceipt(input) {
  const words = encodeIntent(input), original = input.velocity || input.controllerValue;
  return Object.freeze({ schema: 'ump-encoding-receipt/v1', words, wireFormat: 'ump-host-words', protocol: 'midi2',
    sourceResolution: original ? Object.freeze({ bits: original.bits, originalBits: original.sourceBits ?? original.bits, signed: original.signed === true }) : null,
    publication: 'encoded-not-submitted' });
}
export function normalizedUmpPitchBend(normalized) {
  if (!Number.isFinite(normalized) || normalized < -1 || normalized > 1) throw bad('pitch-range', 'Normalized pitch bend must be in [-1, 1].');
  return value(Math.round(0x80000000 + normalized * (normalized < 0 ? 0x80000000 : 0x7fffffff)), 32);
}
