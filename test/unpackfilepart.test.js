import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { BitReader } from '../js/data/BitReader.js';
import { BitWriter } from '../js/data/BitWriter.js';
import { PackFilePart } from '../js/data/PackFilePart.js';
import { UnpackFilePart } from '../js/data/UnpackFilePart.js';

globalThis.lemmings = { game: { showDebug: false } };

class MockLogHandler {
  constructor() { this.logged = []; this.debugged = []; }
  log(msg) { this.logged.push(msg); }
  debug(msg) { this.debugged.push(msg); }
}

describe('UnpackFilePart', function () {
  function roundTrip(data) {
    const packed = PackFilePart.pack(data);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = data.length;
    const out = part.unpack();
    return out.data.slice(0, out.length);
  }

  it('unpacks short buffers packed by PackFilePart', function () {
    const samples = [
      Uint8Array.from([1, 2, 3]),
      Uint8Array.from([1, 1, 1, 1, 2, 2])
    ];
    for (const arr of samples) {
      const result = roundTrip(arr);
      expect(Array.from(result)).to.eql(Array.from(arr));
    }
  });

  it('logs a warning on checksum mismatch', function () {
    const origLog = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const arr = Uint8Array.from([9, 8, 7]);
    const packed = PackFilePart.pack(arr);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum ^ 0xFF;
    part.decompressedSize = arr.length;
    part.unpack();
    setDependency('LogHandler', origLog);
    expect(part.log.logged.some(m => m.includes('Checksum mismatch'))).to.be.true;
  });

  it('returns a new reader when unpack() is called twice with bad checksum', function () {
    const origLog = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const arr = Uint8Array.from([3, 2, 1]);
    const packed = PackFilePart.pack(arr);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum ^ 1;
    part.decompressedSize = arr.length;
    const first = part.unpack();
    const second = part.unpack();
    setDependency('LogHandler', origLog);
    expect(first).to.not.equal(second);
    expect(part.log.logged.some(m => m.includes('Checksum mismatch'))).to.be.true;
  });

  it('logs debug on checksum match', function () {
    const origLog = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const arr = Uint8Array.from([4, 5, 6]);
    const packed = PackFilePart.pack(arr);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = arr.length;
    part.unpack();
    setDependency('LogHandler', origLog);
    expect(part.log.debugged.some(m => m.includes('done!'))).to.be.true;
  });

  it('skips validation when checksum is zero', function () {
    const origLog = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const arr = Uint8Array.from([4, 5, 6]);
    const packed = PackFilePart.pack(arr);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = 0;
    part.decompressedSize = arr.length;
    part.unpack();
    setDependency('LogHandler', origLog);
    expect(part.log.debugged.some(m => m.includes('skipping checksum'))).to.be.true;
  });

  it('exposes metadata getters', function () {
    const br = new BinaryReader(new Uint8Array([1, 2, 3]));
    const part = new UnpackFilePart(br);
    part.offset = 5;
    part.initialBufferLen = 7;
    part.checksum = 9;
    part.decompressedSize = 11;
    part.compressedSize = 13;
    part.unknown0 = 15;
    part.unknown1 = 17;
    part.index = 19;
    expect(part.offset).to.equal(5);
    expect(part.initialBufferLen).to.equal(7);
    expect(part.checksum).to.equal(9);
    expect(part.decompressedSize).to.equal(11);
    expect(part.compressedSize).to.equal(13);
    expect(part.unknown0).to.equal(15);
    expect(part.unknown1).to.equal(17);
    expect(part.index).to.equal(19);
    expect(part.unpackingDone).to.equal(false);
    expect(part.fileReader).to.equal(br);
  });
});
