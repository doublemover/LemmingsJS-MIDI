const integer = (value, bits) => Number.isInteger(value) && value >= 0 && value < 2 ** bits;

export function scaleMidiResolution(value, sourceBits, destinationBits, { zeroExtension = false } = {}) {
  if (!Number.isInteger(sourceBits) || !Number.isInteger(destinationBits) || sourceBits < 1 || destinationBits < 1 ||
      sourceBits > 32 || destinationBits > 32 || !integer(value, sourceBits)) throw new RangeError('Invalid MIDI resolution value');
  if (sourceBits === destinationBits) return value;
  if (sourceBits > destinationBits) {
    const divisor = 2 ** (sourceBits - destinationBits);
    return Math.min(2 ** destinationBits - 1, Math.floor((value + (zeroExtension ? divisor / 2 : 0)) / divisor));
  }
  if (sourceBits === 1) return value ? 2 ** destinationBits - 1 : 0;
  const shift = destinationBits - sourceBits;
  let result = value * 2 ** shift;
  if (zeroExtension || value <= 2 ** (sourceBits - 1)) return result;
  const repeatedBits = sourceBits - 1;
  let repeated = Math.floor((value % (2 ** repeatedBits)) * 2 ** (shift - repeatedBits));
  while (repeated) { result += repeated; repeated = Math.floor(repeated / 2 ** repeatedBits); }
  return result;
}

const freezePlan = fields => Object.freeze({ ...fields, sourceWords: Object.freeze([...(fields.sourceWords || [])]),
  messages: Object.freeze((fields.messages || []).map(data => Object.freeze(data))),
  losses: Object.freeze((fields.losses || []).map(loss => Object.freeze(loss))),
  address: fields.address ? Object.freeze(fields.address) : null });

export function lowerMidi2ChannelVoice(words, policy = {}, context = {}) {
  const sourceWords = words?.length === 2 ? [words[0], words[1]] : [];
  const base = { sourceWords, sourceProtocol: 'midi2', destinationProtocol: 'midi1', mode: 'midi1-shared-expression' };
  const reject = (reason, losses = []) => freezePlan({ ...base, ok: false, reason, losses, messages: [] });
  if (sourceWords.length !== 2 || !sourceWords.every(word => integer(word, 32)) || sourceWords[0] >>> 28 !== 4) return reject('invalid-midi2-channel-packet');
  const [first, value] = sourceWords, group = (first >>> 24) & 15, opcode = (first >>> 20) & 15;
  const sourceChannel = ((first >>> 16) & 15) + 1, index = (first >>> 8) & 255, detail = first & 255;
  if (!policy.groupMap || !Object.prototype.hasOwnProperty.call(policy.groupMap, group)) return reject('unmapped-group');
  const mapping = policy.groupMap[group];
  const channel = mapping === 'preserve' ? sourceChannel : typeof mapping === 'object' ? mapping?.channels?.[sourceChannel] : mapping;
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return reject('unmapped-channel');
  const status = channel - 1, losses = [], messages = [];
  const address = { group, sourceChannel, channel, noteIndex: index };
  if (context.ownedAddress && [8, 0xa, 6].includes(opcode) && context.ownedAddress.channel !== channel) return reject('owned-address-mismatch');
  const precision = (field, from, to, original, lowered) => {
    if (scaleMidiResolution(lowered, to, from) !== original) losses.push({ field, reason: 'reduced-resolution', sourceBits: from, destinationBits: to });
  };
  const accept = extra => freezePlan({ ...base, ok: true, reason: null, address, losses, messages, ...extra });
  if (opcode === 8 || opcode === 9) {
    if (!integer(index, 7)) return reject('invalid-note-index');
    if (!detail && (value & 65535)) return reject('reserved-attribute-data');
    if (detail && detail !== 3 && policy.attributePolicy !== 'omit') return reject('unsupported-note-attribute', [{ field: 'attribute', reason: 'unavailable' }]);
    let note = index, soundingPitch = context.soundingPitch;
    if (opcode === 9 && detail === 3) soundingPitch = (value & 65535) / 512;
    if (opcode === 8 && context.ownedAddress) note = context.ownedAddress.note;
    else if (opcode === 8 && policy.requireOwnedReleases !== false) return reject('unowned-voice');
    else if (opcode === 9 && Number.isFinite(soundingPitch)) {
      if (soundingPitch < 0 || soundingPitch >= 128) return reject('pitch-out-of-range');
      note = Math.min(127, Math.round(soundingPitch));
      if (note !== soundingPitch) {
        if (policy.pitchPolicy !== 'round') return reject('fractional-pitch-unavailable', [{ field: 'pitch', reason: 'unavailable' }]);
        losses.push({ field: 'pitch', reason: 'rounded-pitch', source: soundingPitch, destination: note });
      }
    } else if (opcode === 9 && policy.noteIndexMode === 'rotating') return reject('sounding-pitch-required');
    const velocity16 = value >>> 16, velocity = Math.max(opcode === 9 ? 1 : 0, scaleMidiResolution(velocity16, 16, 7));
    precision('velocity', 16, 7, velocity16, velocity);
    if (detail && detail !== 3) losses.push({ field: 'attribute', reason: 'omitted-by-policy', attributeType: detail });
    if (opcode === 9 && context.conflictingVoice) {
      if (policy.samePitchPolicy !== 'retrigger') return reject('voice-address-collision', [{ field: 'voice-isolation', reason: 'unavailable' }]);
      messages.push([0x80 | status, note, 64]); losses.push({ field: 'voice-isolation', reason: 'previous-voice-retriggered' });
    }
    messages.push([(opcode === 9 ? 0x90 : 0x80) | status, note, velocity]);
    return accept({ action: opcode === 9 ? 'begin' : 'end', note, soundingPitch: soundingPitch ?? note });
  }
  if (opcode === 0xa || opcode === 0xb || opcode === 0xd) {
    if ((opcode === 0xa || opcode === 0xb) && !integer(index, 7)) return reject('invalid-controller-address');
    if (detail !== 0 || opcode === 0xd && index) return reject('reserved-bits-set');
    if (opcode === 0xb && [0, 6, 32, 38, 88, 98, 99, 100, 101].includes(index)) return reject('compound-controller-requires-semantic-message');
    const lowered = scaleMidiResolution(value, 32, 7); precision('controller', 32, 7, value, lowered);
    if (opcode === 0xa) {
      const note = context.ownedAddress?.note;
      if (!Number.isInteger(note)) return reject('unowned-voice');
      messages.push([0xa0 | status, note, lowered]);
    } else if (opcode === 0xb) messages.push([0xb0 | status, index, lowered]);
    else messages.push([0xd0 | status, lowered]);
    return accept({ action: 'control' });
  }
  if (opcode === 0xe || opcode === 6) {
    if (opcode === 6 && !integer(index, 7)) return reject('invalid-note-index');
    if (detail || opcode === 0xe && index) return reject('reserved-bits-set');
    if (opcode === 6 && policy.perNotePolicy !== 'shared-channel') return reject('per-note-pitch-unavailable', [{ field: 'per-note-pitch', reason: 'unavailable' }]);
    if (opcode === 6 && !context.ownedAddress) return reject('unowned-voice');
    if (opcode === 6) losses.push({ field: 'per-note-pitch', reason: 'shared-channel-approximation' });
    const bend = scaleMidiResolution(value, 32, 14); precision('pitch-bend', 32, 14, value, bend);
    messages.push([0xe0 | status, bend & 127, bend >> 7]); return accept({ action: 'control' });
  }
  if (opcode === 2 || opcode === 3) {
    if (!integer(index, 7) || !integer(detail, 7)) return reject('invalid-parameter-address');
    if (opcode === 2 && index === 0 && detail === 7) return reject('per-note-sensitivity-unavailable');
    const parameter = index * 128 + detail;
    if (opcode === 2 && Array.isArray(policy.supportedRegisteredControllers) && !policy.supportedRegisteredControllers.includes(parameter)) return reject('registered-controller-unavailable');
    const packed = opcode === 2 && index === 0 && [0, 2, 3, 4, 6].includes(detail);
    const parameterValue = packed ? value >>> 18 : scaleMidiResolution(value, 32, 14, { zeroExtension: opcode === 2 && index === 0 && detail <= 31 });
    const msb = parameterValue >> 7, lsb = packed && detail !== 0 ? 0 : parameterValue & 127;
    const high = opcode === 2 ? 101 : 99, low = opcode === 2 ? 100 : 98;
    for (const [cc, data] of [[high, index], [low, detail], [6, msb], [38, lsb]]) messages.push([0xb0 | status, cc, data]);
    if (policy.nullParameterAfterWrite !== false) for (const cc of [high, low]) messages.push([0xb0 | status, cc, 127]);
    losses.push({ field: 'parameter', reason: 'reduced-resolution', sourceBits: 32, destinationBits: packed && detail !== 0 ? 7 : 14 });
    return accept({ action: 'control' });
  }
  if (opcode === 0xc) {
    if (index || detail & 254 || value & 0x80808080 || value & 0x00ff0000) return reject('reserved-bits-set');
    const program = value >>> 24, msb = (value >>> 8) & 127, lsb = value & 127;
    if (detail & 1) messages.push([0xb0 | status, 0, msb], [0xb0 | status, 32, lsb]);
    else if (msb || lsb) return reject('bank-without-valid-flag');
    messages.push([0xc0 | status, program]); return accept({ action: 'control' });
  }
  return reject([4, 5].includes(opcode) ? 'relative-controller-unavailable' : 'per-note-message-unavailable');
}
