import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';

globalThis.lemmings = Lemmings;

describe('BitReader', function() {
  it('reads reversed bytes and tracks checksum', function() {
    const bytes = new Uint8Array([0xAA, 0x55]);
    const bin = new BinaryReader(bytes);
    const reader = new BitReader(bin, 0, bin.length);

    const first = reader.read(8);
    expect(first).to.equal(0xAA);

    const second = reader.read(8);
    expect(second).to.equal(0x55);

    expect(reader.getCurrentChecksum()).to.equal(0xFF);
    expect(reader.eof()).to.equal(true);
  });

  it('throws for invalid bit counts without affecting checksum', function() {
    const bytes = new Uint8Array([0xAA, 0x55]);
    const bin = new BinaryReader(bytes);
    const reader = new BitReader(bin, 0, bin.length);

    expect(() => reader.read(0)).to.throw(RangeError);
    expect(() => reader.read(33)).to.throw(RangeError);

    const v1 = reader.read(8);
    expect(v1).to.equal(0xAA);
    const v2 = reader.read(8);
    expect(v2).to.equal(0x55);
    expect(reader.getCurrentChecksum()).to.equal(0xFF);
  });

  it('reads across byte boundary and errors at EOF', function() {
    const bytes = new Uint8Array([0xAA, 0x55]);
    const bin = new BinaryReader(bytes);
    const reader = new BitReader(bin, 0, bin.length, 4);

    const n1 = reader.read(4);
    expect(n1).to.equal(0x5);
    const n2 = reader.read(4);
    expect(n2).to.equal(0xA);
    expect(() => reader.read(9)).to.throw(RangeError);
    expect(reader.getCurrentChecksum()).to.equal(0xFF);
  });

  it('validates constructor arguments', function() {
    const bytes = new Uint8Array([0]);
    const bin = new BinaryReader(bytes);
    expect(() => new BitReader(bin, -1, 1)).to.throw(RangeError);
    expect(() => new BitReader(bin, 0, 0)).to.throw(RangeError);
    expect(() => new BitReader(bin, 0, 1, 9)).to.throw(RangeError);
  });
});
