import { expect } from 'chai';
import { decodeUmpPacket, parseWords, validatePacket, encodeIntent, encodeIntentReceipt, promoteUmpValue, normalizedUmpPitchBend, umpWordsToBytes, umpBytesToWords, UMP_WORD_COUNTS } from '../../js/midi/protocol/UmpPacketCodec.js';

// Literal vectors derived from pinned ni-midi2/cmidi2 constructors; independent
// executable cross-library qualification remains deferred, not implied here.
const vectors = [
  { words: [0x40913c00, 0x00010000], kind: 'midi2-channel-voice', status: 'noteOn' },
  { words: [0x4f8f7f00, 0xffff0000], kind: 'midi2-channel-voice', status: 'noteOff' },
  { words: [0x40210203, 0x12345678], kind: 'midi2-channel-voice', status: 'registeredController' },
  { words: [0x474f0102, 0xffffffff], kind: 'midi2-channel-voice', status: 'relativeRegisteredController' },
  { words: [0x490b6607, 0x3456789a], kind: 'midi2-channel-voice', status: 'registeredPerNoteController' },
  { words: [0x4f1f25ff, 0x80000000], kind: 'midi2-channel-voice', status: 'assignablePerNoteController' },
  { words: [0x4fff2503, 0], kind: 'midi2-channel-voice', status: 'perNoteManagement' },
  { words: [0x3f030102, 0x03000000], kind: 'sysex7' },
  { words: [0x540401ff, 0xf1f20000, 0, 0], kind: 'sysex8' },
  { words: [0xd0100000, 0x02faf080, 0, 0], kind: 'flex-data', subtype: 'tempo' },
  { words: [0xf0000101, 0x1f, 0, 0], kind: 'stream', subtype: 'endpointDiscovery' },
  { words: [0xf0200000, 0, 0, 0], kind: 'stream', subtype: 'startOfClip' },
  { words: [0x0010ffff], kind: 'utility', status: 'jrClock' }
];
describe('bounded UMP packet codec foundation', () => {
  for (const vector of vectors) it('decodes literal ' + vector.words.map(value => value.toString(16)).join(' '), () => {
    const { words, ...fields } = vector, result = decodeUmpPacket(words); expect(result).to.include(fields); expect(result.words).to.deep.equal(words);
    expect(umpBytesToWords(umpWordsToBytes(words))).to.deep.equal(words);
  });
  it('uses all sixteen message-type widths without inventing groups for utility or Stream', () => {
    expect(UMP_WORD_COUNTS).to.deep.equal([1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]);
    for (const type of [6, 7, 8, 9, 10, 11, 12, 14]) {
      const words = Array.from({ length: UMP_WORD_COUNTS[type] }, (_, index) => index ? 0 : type * 0x10000000);
      expect(parseWords(words)[0]).to.include({ known: false, dispatchable: false }); expect(validatePacket(words).valid).to.equal(false);
    }
    expect(decodeUmpPacket([0x00100001])).not.to.have.property('group'); expect(decodeUmpPacket([0xf0200000, 0, 0, 0])).not.to.have.property('group');
  });
  it('never treats MIDI2 zero velocity as MIDI1 Note Off and preserves unsigned controller precision', () => {
    expect(decodeUmpPacket([0x40913c00, 0]).zeroVelocityNoteOff).to.equal(false);
    expect(decodeUmpPacket([0x20913c00]).zeroVelocityNoteOff).to.equal(true);
    expect(decodeUmpPacket([0x40b10700, 0xfedcba98]).controllerValue.value).to.equal(0xfedcba98);
    expect(decodeUmpPacket([0x474f0102, 0xffffffff]).controllerValue).to.include({ value: -1, signed: true });
  });
  it('rejects complete batches with truncated tails or malformed reserved fields instead of returning empty success', () => {
    for (const vector of vectors.filter(value => value.words.length > 1)) for (let length = 1; length < vector.words.length; length++) expect(() => parseWords([0, ...vector.words.slice(0, length)])).to.throw('inside a packet');
    for (const words of [[0x01000000], [0x20c10001], [0x40918000, 0], [0x40913c00, 1], [0x40ff3c04, 0], [0x50000000, 0, 0, 0], [0xd0300000, 1, 0, 0]]) expect(validatePacket(words).valid).to.equal(false);
    expect(() => parseWords([0xffffffff])).to.throw();
  });
  it('promotes with center alignment and retains source-resolution evidence outside the wire words', () => {
    expect(promoteUmpValue({ value: 64, bits: 7 }, 32)).to.include({ value: 0x80000000, sourceBits: 7, precision: 'promoted' });
    expect(promoteUmpValue({ value: 127, bits: 7 }, 16).value).to.equal(65535);
    expect([-1, 0, 1].map(value => normalizedUmpPitchBend(value).value)).to.deep.equal([0, 0x80000000, 0xffffffff]);
    const input = { status: 'noteOn', group: 0, channel: 1, note: 60, velocity: { value: 1, bits: 16 } };
    expect(encodeIntent(input)).to.deep.equal([0x40913c00, 0x10000]); expect(encodeIntentReceipt(input).publication).to.equal('encoded-not-submitted');
    expect(() => promoteUmpValue({ value: 1, bits: NaN }, 32)).to.throw();
  });
});
