import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { PackFilePart } from '../js/PackFilePart.js';
import { UnpackFilePart } from '../js/UnpackFilePart.js';

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
    Lemmings.LogHandler = MockLogHandler;
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
    Lemmings.LogHandler = origLog;
    expect(part.log.logged.some(m => m.includes('Checksum mismatch'))).to.be.true;
  });

  it('returns a new reader when unpack() is called twice with bad checksum', function () {
    const origLog = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
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
    Lemmings.LogHandler = origLog;
    expect(first).to.not.equal(second);
    expect(part.log.logged.some(m => m.includes('Checksum mismatch'))).to.be.true;
  });

  it('logs debug on checksum match', function () {
    const origLog = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
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
    Lemmings.LogHandler = origLog;
    expect(part.log.debugged.some(m => m.includes('done!'))).to.be.true;
  });

  it('skips validation when checksum is zero', function () {
    const origLog = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
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
    Lemmings.LogHandler = origLog;
    expect(part.log.debugged.some(m => m.includes('skipping checksum'))).to.be.true;
  });
});
