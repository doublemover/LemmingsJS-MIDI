import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
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
    const br = new BinaryReader(packed.data);
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
    const br = new BinaryReader(packed.data);
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
});
