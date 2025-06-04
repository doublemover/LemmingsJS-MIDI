import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';

globalThis.lemmings = Lemmings;

describe('BitReader', function() {
  it('reads reversed bytes and tracks checksum', function() {
    const bytes = new Uint8Array([0xAA, 0x55]);
    const bin = new BinaryReader(bytes);
    const reader = new BitReader(bin, 0, bin.length);

    const first = reader.read(8); // expect 0xAA = reverse(0x55)
    expect(first).to.equal(0xAA);

    const second = reader.read(8); // expect 0x55 = reverse(0xAA)
    expect(second).to.equal(0x55);

    expect(reader.getCurrentChecksum()).to.equal(0xFF);
    expect(reader.eof()).to.equal(true);
  });
});
