const integer = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Invalid Flex ' + name); return value; };
const tonic = value => integer(value, 0, 7, 'tonic');
const accidental = value => integer(value, -2, 2, 'chord accidental');
const signedNibble = value => value & 8 ? value - 16 : value;
const word = bytes => ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
const header = (scope, bank, status, format = 0) => {
  integer(scope?.group, 0, 15, 'group'); if (!['group', 'channel'].includes(scope.address)) throw new RangeError('Choose explicit Flex group or channel scope');
  const channel = scope.address === 'group' ? 0 : integer(scope.channel, 0, 15, 'channel');
  return (0xd0000000 | scope.group << 24 | format << 22 | (scope.address === 'group' ? 1 : 0) << 20 | channel << 16 | bank << 8 | status) >>> 0;
};
const alteration = value => {
  const type = integer(value?.type ?? 0, 0, 4, 'alteration type'), degree = integer(value?.degree ?? 0, type ? 1 : 0, type ? 15 : 0, 'alteration degree');
  return type << 4 | degree;
};
const alterations = (values = [], maximum) => { if (!Array.isArray(values) || values.length > maximum) throw new RangeError('Flex chord alteration capacity'); return Array.from({ length: maximum }, (_, index) => alteration(values[index])); };
export const FLEX_CHORD_TYPES = Object.freeze(['No chord', 'Major', 'Major sixth', 'Major seventh', 'Major ninth', 'Major eleventh', 'Major thirteenth', 'Minor', 'Minor sixth', 'Minor seventh', 'Minor ninth', 'Minor eleventh', 'Minor thirteenth', 'Dominant seventh', 'Dominant ninth', 'Dominant eleventh', 'Dominant thirteenth', 'Augmented', 'Augmented seventh', 'Diminished', 'Diminished seventh', 'Half diminished', 'Minor major', 'Pedal', 'Power', 'Suspended second', 'Suspended fourth', 'Seventh suspended fourth']);
export function encodeFlexScoreValue(kind, value, scope) {
  let words;
  if (kind === 'tempo') {
    const units = value.tenNanosecondsPerQuarter ?? Math.round(6000000000 / value.bpm); integer(units, 1, 0xffffffff, 'tempo');
    if (value.bpm != null && (!Number.isFinite(value.bpm) || value.bpm <= 0)) throw new RangeError('Invalid Flex tempo');
    if (scope.address !== 'group') throw new RangeError('Flex tempo requires group scope'); words = [header(scope, 0, 0), units, 0, 0];
  } else if (kind === 'meter') {
    const numerator = integer(value.numerator, 1, 256, 'meter numerator'), exponent = value.denominatorExponent ?? Math.log2(value.denominator);
    integer(exponent, 0, 255, 'meter denominator exponent'); const thirtySeconds = integer(value.thirtySecondsPerQuarter ?? 8, 1, 255, '32nd notes per quarter');
    if (scope.address !== 'group') throw new RangeError('Flex meter requires group scope'); words = [header(scope, 0, 1), ((numerator % 256) << 24 | exponent << 16 | thirtySeconds << 8) >>> 0, 0, 0];
  } else if (kind === 'key') {
    const count = integer(value.accidentals, -8, 7, 'key accidentals'), note = tonic(value.tonic);
    words = [header(scope, 0, 5), ((count & 15) << 28 | note << 24) >>> 0, 0, 0];
  } else if (kind === 'chord') {
    const type = integer(value.type, 0, 27, 'chord type'), note = tonic(value.tonic), count = accidental(value.accidental ?? 0), changes = alterations(value.alterations, 4), bassChanges = alterations(value.bass?.alterations, 2);
    if (type === 0 ? note !== 0 || count !== 0 || changes.some(Boolean) : note === 0) throw new RangeError('Flex chord tonic and type disagree');
    const bassNote = value.bass ? tonic(value.bass.tonic) : 0, bassAccidental = value.bass ? value.bass.accidental ?? 0 : -8, bassType = integer(value.bass?.type ?? 0, 0, 27, 'bass chord type');
    if (bassAccidental === -8 ? bassNote !== 0 : !bassNote) throw new RangeError('Flex bass tonic and accidental disagree');
    if (bassAccidental !== -8) accidental(bassAccidental);
    words = [header(scope, 0, 6), word([((count & 15) << 4) | note, type, changes[0], changes[1]]), word([changes[2], changes[3], 0, 0]), word([((bassAccidental & 15) << 4) | bassNote, bassType, bassChanges[0], bassChanges[1]])];
  } else throw new RangeError('Unsupported score context kind');
  return Object.freeze(words);
}
export function encodeFlexText(text, scope, { bank = 1, status = 0 } = {}) {
  if (typeof text !== 'string' || text.includes('\0') || text.startsWith('\ufeff') || /[\ud800-\udfff]/u.test(text)) throw new RangeError('Flex text requires valid Unicode without NUL or BOM');
  if (!(bank === 1 && Number.isInteger(status) && status >= 0 && status <= 12 || bank === 2 && status === 0)) throw new RangeError('Unsupported plain Flex text status');
  if (bank === 1 && [1, 3].includes(status) && scope.address !== 'group') throw new RangeError('Project and Clip names require group scope');
  if (bank === 1 && status === 11 && !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(text)) throw new RangeError('Recording date requires ISO 8601');
  const bytes = new TextEncoder().encode(text); if (bytes.length > 384) throw new RangeError('Flex text exceeds 32 packets / 384 UTF-8 bytes');
  const count = Math.max(1, Math.ceil(bytes.length / 12)), output = [];
  for (let index = 0; index < count; index++) {
    const payload = new Uint8Array(12); payload.set(bytes.subarray(index * 12, (index + 1) * 12));
    output.push(Object.freeze([header(scope, bank, status, count === 1 ? 0 : index === 0 ? 1 : index === count - 1 ? 3 : 2), word(payload.subarray(0, 4)), word(payload.subarray(4, 8)), word(payload.subarray(8, 12))]));
  }
  return Object.freeze(output);
}
export function decodeFlexScoreValue(words, { bank, status, address }) {
  if (bank !== 0 || ![0, 1, 5, 6].includes(status)) return null;
  const bytes = words.slice(1).flatMap(value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255]);
  let kind, value;
  if (status === 0) { kind = 'tempo'; value = { tenNanosecondsPerQuarter: words[1] }; }
  else if (status === 1) { kind = 'meter'; value = { numerator: bytes[0] || 256, denominatorExponent: bytes[1], thirtySecondsPerQuarter: bytes[2] }; }
  else if (status === 5) { kind = 'key'; value = { accidentals: signedNibble(bytes[0] >>> 4), tonic: bytes[0] & 15 }; }
  else {
    const change = byte => ({ type: byte >>> 4, degree: byte & 15 });
    kind = 'chord'; value = { accidental: signedNibble(bytes[0] >>> 4), tonic: bytes[0] & 15, type: bytes[1], alterations: [bytes[2], bytes[3], bytes[4], bytes[5]].map(change),
      bass: { accidental: signedNibble(bytes[8] >>> 4), tonic: bytes[8] & 15, type: bytes[9], alterations: [bytes[10], bytes[11]].map(change) } };
  }
  const encoded = encodeFlexScoreValue(kind, value, { group: words[0] >>> 24 & 15, address, channel: words[0] >>> 16 & 15 });
  if (encoded.some((word, index) => word !== words[index])) throw new RangeError('Reserved or malformed Flex score data');
  const freeze = value => { if (!value || typeof value !== 'object') return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); };
  return Object.freeze({ kind, value: freeze(value) });
}
export function flexScoreToMidi1(kind, value, { textType = 1 } = {}) {
  if (kind !== 'text') encodeFlexScoreValue(kind, value, { group: 0, address: 'group' }); else encodeFlexText(value.text, { group: 0, address: 'group' });
  const variable = size => { const bytes = [size & 127]; while ((size >>= 7)) bytes.unshift((size & 127) | 128); return bytes; };
  if (kind === 'tempo') { const raw = value.tenNanosecondsPerQuarter ?? Math.round(6000000000 / value.bpm), micros = Math.round(raw / 100); if (micros < 1 || micros > 0xffffff) return Object.freeze({ supported: false, loss: 'SMF-tempo-range' }); return Object.freeze({ supported: true, bytes: Object.freeze([255, 81, 3, micros >>> 16, micros >>> 8 & 255, micros & 255]), loss: raw % 100 ? '10ns-to-microsecond-tempo-quantization' : null }); }
  if (kind === 'meter') { const exponent = value.denominatorExponent ?? Math.log2(value.denominator); if (value.numerator > 255) return Object.freeze({ supported: false, loss: 'SMF-meter-numerator-range' }); return Object.freeze({ supported: true, bytes: Object.freeze([255, 88, 4, value.numerator, exponent, 24, value.thirtySecondsPerQuarter ?? 8]), loss: null }); }
  if (kind === 'text') { integer(textType, 1, 7, 'SMF text type'); const bytes = new TextEncoder().encode(value.text); if (bytes.length > 384) throw new RangeError('SMF context text capacity'); return Object.freeze({ supported: true, bytes: Object.freeze([255, textType, ...variable(bytes.length), ...bytes]), loss: 'Flex-address-and-text-class-not-representable-in-SMF' }); }
  return Object.freeze({ supported: false, loss: kind === 'key' ? 'Flex-tonic-mode-does-not-unambiguously-select-SMF-major-minor' : 'Flex-chord-has-no-standard-SMF1-equivalent' });
}
