import { expect } from 'chai';
import { readFileSync } from 'fs';

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { PackFilePart } from '../js/PackFilePart.js';
import { UnpackFilePart } from '../js/UnpackFilePart.js';
import { FileContainer } from '../js/FileContainer.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('PackFilePart', function () {
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
});
