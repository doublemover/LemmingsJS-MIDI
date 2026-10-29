import assert from 'node:assert/strict';
import { UMP_WORD_COUNTS, decodeUmpPacket, encodeIntent, parseWords, umpWordsToBytes, umpBytesToWords } from '../js/midi/protocol/UmpPacketCodec.js';
import { lowerMidi2ChannelVoice, scaleMidiResolution } from '../js/midi/protocol/MidiProtocolLowering.js';

export function createNativeMidiCodecCorpus(lock) {
  const cases = [], add = (name, line, check) => cases.push({ name, line, check });
  add('locked peer identity', 'I', row => {
    assert.equal(row.schema, 'lemmings-native-midi-codec-peer/v1'); assert.equal(row.deviceIO, false);
    assert.equal(row.maximumWords, 4096); assert.equal(row.maximumLineBytes, 65536);
    for (const name of ['ni_midi2', 'cmidi2', 'libremidi']) assert.equal(row[name], lock[name].revision);
  });
  add('all message type widths and typed copy', 'W', row => {
    assert.equal(row.rows.length, 16);
    const cmidi = [1, 1, 1, 2, 2, 4, 1, 1, 1, 1, 1, 1, 1, 4, 1, 4];
    const lib = [1, 1, 1, 2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    row.rows.forEach((item, type) => assert.deepEqual(item, { type, guard: UMP_WORD_COUNTS[type], ni: UMP_WORD_COUNTS[type],
      cmidi2: cmidi[type], libremidi: lib[type], libremidiIterator: lib[type], niRoundtrip: true }));
  });
  const batch = (name, words, { fail = 0, throws = 0, mutate = 0 } = {}) => {
    let packets = [], invalid = !words.length;
    try { packets = parseWords(words, { preserveUnknown: false }); } catch { invalid = true; }
    const counts = packets.map(packet => packet.wordCount), stops = [fail, throws].filter(at => at > 0 && at <= counts.length);
    const stopped = stops.length ? Math.min(...stops) : 0, accepted = invalid ? 0 : stopped ? stopped - 1 : counts.length;
    const prefix = counts.slice(0, accepted).reduce((a, b) => a + b, 0);
    add(name, `B ${fail} ${throws} ${mutate} ${words.length} ${words.map(word => word.toString(16)).join(' ')}`.trim(), row => {
      assert.equal(row.kind, 'batch'); assert.equal(row.attemptedPackets, invalid ? 0 : stopped || counts.length);
      assert.equal(row.acceptedPackets, accepted); assert.equal(row.acceptedWords, prefix);
      assert.deepEqual(row.acceptedPrefixWords, words.slice(0, prefix));
      assert.equal(row.acceptedPrefixWireHex, Buffer.from(umpWordsToBytes(words.slice(0, prefix))).toString('hex'));
      assert.deepEqual(umpBytesToWords(new Uint8Array(Buffer.from(row.acceptedPrefixWireHex, 'hex'))), words.slice(0, prefix));
      assert.deepEqual(row.callbackWordCounts, invalid ? [] : counts.slice(0, stopped || counts.length));
      assert.equal(row.failedPacketUnconfirmed, !invalid && !!stopped);
      if (invalid) assert.equal(typeof row.reason, 'string');
      else if (stopped) {
        assert.equal(row.failureWordOffset, prefix); assert.equal(row.reason, stopped === throws ? 'sender-threw' : 'sender-rejected');
      } else assert.equal(row.reason, null);
    });
  };
  const typed = (kind, group, channel, index, detail, value, attribute = 0) => {
    const intent = { group, channel, status: ['noteOn', 'controlChange', 'registeredController', 'relativeRegisteredController'][kind] };
    if (!kind) Object.assign(intent, { note: index, attributeType: detail, attributeData: attribute, velocity: { value, bits: 16 } });
    else Object.assign(intent, kind === 1 ? { controller: index } : { bank: index, index: detail },
      { controllerValue: { value: kind === 3 ? value | 0 : value, bits: 32, ...(kind === 3 ? { signed: true } : {}) } });
    const expected = encodeIntent(intent);
    add(`typed ${kind}/${group}/${channel}/${index}/${detail}/${value}/${attribute}`, `T ${kind} ${group} ${channel} ${index} ${detail} ${value} ${attribute}`, row => {
      assert.equal(row.kind, 'typed'); assert.deepEqual(row.ni, expected); assert.deepEqual(row.cmidi2, expected);
      assert.deepEqual([...umpWordsToBytes(row.ni)], [...umpWordsToBytes(expected)]);
      assert.equal(row.niWireHex, Buffer.from(umpWordsToBytes(expected)).toString('hex')); assert.equal(row.cmidi2WireHex, row.niWireHex);
      assert.deepEqual(umpBytesToWords(new Uint8Array(Buffer.from(row.niWireHex, 'hex'))), expected);
      assert.equal(decodeUmpPacket(row.ni).group, group); assert.equal(decodeUmpPacket(row.ni).channel, channel);
    });
    return expected;
  };
  for (let group = 0; group < 16; group++) for (let channel = 0; channel < 16; channel++) {
    for (const velocity of [0, 1, 511, 512, 32768, 65535]) typed(0, group, channel, (group * 16 + channel) % 128, 0, velocity);
    for (const value of [0, 0x00fc0000, 0x12345678, 0x80000000, 0xffffffff]) {
      typed(1, group, channel, 74, 0, value); typed(2, group, channel, 1, 2, value); typed(3, group, channel, 1, 2, value);
    }
  }
  for (const attribute of [1, 3, 255]) typed(0, 15, 15, 127, attribute, 1, 0xabcd);
  for (const [from, to] of [[7, 16], [7, 32], [14, 32], [16, 7], [32, 7], [32, 14]]) {
    const maximum = 2 ** from - 1, values = new Set([0, 1, 2, 2 ** (from - 1) - 1, 2 ** (from - 1), 2 ** (from - 1) + 1, maximum - 1, maximum]);
    for (let at = 0; at < 256; at++) values.add(Math.floor(maximum * at / 255));
    for (const value of values) add(`resolution ${from}/${to}/${value}`, `S ${from} ${to} ${value}`, row => {
      assert.equal(row.kind, 'scale'); assert.equal(row.value, scaleMidiResolution(value, from, to));
    });
  }
  const complete = [0, 0x00101234, 0x10f80000, 0x21903c7f, 0x30030102, 0x03000000, 0x41923c00, 0x12340000,
    0x50010100, 0, 0, 0, 0xd0100000, 50000000, 0, 0, 0xf0000101, 0x1f, 0, 0];
  batch('mixed packet widths', complete); batch('caller mutation cannot change validated snapshot', complete, { mutate: 1 });
  const golden = [[0x00200001], [0x00300060], [0x004abcde], [0x1ff20102], [0x2fc07f00],
    [0x30060102, 0x03040506], [0x30160102, 0x03040506], [0x30260102, 0x03040506], [0x30360102, 0x03040506],
    [0x500e0001, 0x02030405, 0x06070809, 0x0a0b0c0d], [0x51800002, 0x00010000, 0x00010002, 0x00030004],
    [0x5190ffff, 0x12345678, 0x90abcdef, 0xff00ff00], [0xdf100000, 50000000, 0, 0],
    [0xd0100001, 0x04021800, 0, 0], [0xd0000100, 0x41424300, 0, 0],
    [0xf0000101, 0x1f, 0, 0], [0xf0034142, 0x43444546, 0x4748494a, 0x4b4c4d00], [0xf0200000, 0, 0, 0], [0xf0210000, 0, 0, 0]];
  for (let at = 0; at < golden.length; at++) batch('literal supported family ' + at, golden[at]);
  const count = parseWords(complete, { preserveUnknown: false }).length;
  for (let at = 1; at <= count; at++) {
    batch('later sender error ' + at, complete, { fail: at }); batch('later sender exception ' + at, complete, { throws: at });
  }
  batch('empty batch', []); batch('maximum bounded batch', Array(4096).fill(0));
  for (let type = 0; type < 16; type++) {
    const packet = [(type * 0x10000000) >>> 0, ...Array(UMP_WORD_COUNTS[type] - 1).fill(0)];
    batch('type framing ' + type, [0x20903c7f, ...packet]);
    for (let cut = 1; cut < packet.length; cut++) batch(`truncated tail ${type}/${cut}`, [0x20903c7f, ...packet.slice(0, cut)]);
  }
  let state = 0x6d696469;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  for (let at = 0; at < 2048; at++) {
    const word = random(), width = UMP_WORD_COUNTS[word >>> 28], packet = [word, ...Array.from({ length: width - 1 }, random)];
    batch('seeded whole-batch admission ' + at, [0x20903c7f, ...packet]);
  }
  for (const velocity of [0, 1, 511, 512, 65535]) add('peer note lowering boundary ' + velocity, `L 0 ${velocity}`, row => {
    assert.equal(row.kind, 'lower'); assert.equal(row.niWord & 255, Math.max(1, velocity >>> 9));
    assert.deepEqual(row.cmidi2Bytes, [0x90, 60, velocity >>> 9]);
    const plan = lowerMidi2ChannelVoice([0x40903c00, velocity * 65536], { groupMap: { 0: 'preserve' } });
    assert.equal(plan.ok, true); assert.equal(plan.messages[0][2], Math.max(1, velocity >>> 9));
  });
  for (const value of [0x12345678, 0x00fc0000, 0xffffffff]) add('peer parameter lowering boundary ' + value, `L 1 ${value}`, row => {
    assert.equal(row.niWord, null);
    assert.deepEqual(row.cmidi2Bytes, [0xb0, 101, 0, 0xb0, 100, 0, 0xb0, 6, value >>> 25, 0xb0, 38, value >>> 18 & 127]);
  });
  for (const command of ['B 0 0 0 1 -1', 'B 0 0 0 1 100000000', 'B 0 0 0 1 0 extra', 'B 0 0 0 4097',
    'B 0 0 0 2 20903c7f', 'T 0 16 0 0 0 0 0', 'T 3 0 0 0 0 4294967296 0', 'S 32 0 0', 'S 7 16 128', 'unknown']) {
    add('malformed protocol ' + command, command, row => assert.deepEqual(row, { kind: 'error', reason: 'invalid-command' }));
  }
  return cases;
}
