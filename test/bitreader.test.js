import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';

globalThis.lemmings = Lemmings;

describe('BitReader', function() {
  it('reads reversed bytes and tracks checksum', function() {
    const bin = new BinaryReader(new Uint8Array([0xAA, 0x55]));
    const reader = new BitReader(bin, 0, bin.length);

    // first read should reverse last byte (0x55 -> 0xAA)
    const first = reader.read(8);
    expect(first).to.equal(0xAA);

    // second read should reverse previous byte (0xAA -> 0x55)
    const second = reader.read(8);
    expect(second).to.equal(0x55);

    // checksum should equal XOR of consumed bytes (0x55 ^ 0xAA = 0xFF)
    expect(reader.getCurrentChecksum()).to.equal(0xFF);

    // should report EOF after all bits consumed
    expect(reader.eof()).to.equal(true);
  });
});
