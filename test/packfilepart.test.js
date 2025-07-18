import { expect } from 'chai';
import { readFileSync } from 'fs';

import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { PackFilePart } from '../js/PackFilePart.js';
import { UnpackFilePart } from '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';
import { randomFillSync } from 'crypto';

globalThis.lemmings = { game: { showDebug: false } };

describe('PackFilePart', function () {
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

  it('compresses and decompresses a short byte array', function () {
    const arr = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = roundTrip(arr);
    expect(Array.from(result)).to.eql(Array.from(arr));
  });

  it('round-trips first chunk of LEVEL000.DAT', function () {
    const dat = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const container = new FileContainer(new BinaryReader(new Uint8Array(dat)));
    const part = container.getPart(0);
    const original = part.data.slice(0, part.length);
    const result = roundTrip(original);
    expect(Array.from(result)).to.eql(Array.from(original));
  });

  it('recompresses a chunk and produces a consistent stream', function () {
    const dat = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const container = new FileContainer(new BinaryReader(new Uint8Array(dat)));
    const unpacked = container.getPart(0);
    const bytes = unpacked.data.slice(0, unpacked.length);

    const packed = PackFilePart.pack(bytes);

    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = bytes.length;
    const out = part.unpack();
    const result = out.data.slice(0, out.length);

    expect(Array.from(result)).to.eql(Array.from(bytes));

    const calc = packed.byteArray.reduce((a, b) => a ^ b, 0);
    expect(calc).to.equal(packed.checksum);
    expect(part.initialBufferLen).to.equal(packed.initialBits);
  });

  it('handles short raw blocks', function () {
    const arr = Uint8Array.from([1,2,3,4,5,6,7,8]);
    const result = roundTrip(arr);
    expect(Array.from(result)).to.eql(Array.from(arr));
  });

  it('handles short references of length 2-4', function () {
    const cases = [
      Uint8Array.from([1,2,1,2]),
      Uint8Array.from([1,2,3,1,2,3]),
      Uint8Array.from([1,2,3,4,1,2,3,4])
    ];
    for (const arr of cases) {
      const result = roundTrip(arr);
      expect(Array.from(result)).to.eql(Array.from(arr));
    }
  });

  it('handles generic references', function () {
    const arr = Uint8Array.from([1,2,3,4,5,6,1,2,3,4,5,6]);
    const result = roundTrip(arr);
    expect(Array.from(result)).to.eql(Array.from(arr));
  });

  it('handles large raw blocks', function () {
    const arr = Uint8Array.from({length:300}, (_,i)=>i%256);
    const result = roundTrip(arr);
    expect(Array.from(result)).to.eql(Array.from(arr));
  });

  it('compresses and decompresses >4KB of random data', function () {
    const arr = new Uint8Array(5000);
    randomFillSync(arr);
    const packed = PackFilePart.pack(arr);
    expect(packed.initialBits).to.equal(8);
    const br = new BinaryReader(packed.byteArray);
    const part = new UnpackFilePart(br);
    part.offset = 0;
    part.compressedSize = br.length;
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = arr.length;
    const out = part.unpack();
    const result = out.data.slice(0, out.length);
    expect(Array.from(result)).to.eql(Array.from(arr));
  });
});
