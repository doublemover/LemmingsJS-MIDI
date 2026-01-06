import { expect } from 'chai';
import { Lemmings, setDependency, useGlobalLemmings, withShowDebug } from './helpers/lemmings.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import '../js/data/BitReader.js';
import '../js/data/BitWriter.js';
import '../js/data/PackFilePart.js';
import '../js/data/UnpackFilePart.js';
import '../js/data/FileContainer.js';
import '../js/render/PaletteImage.js';
import '../js/render/Frame.js';
import '../js/render/ColorPalette.js';
import { VGASpecReader } from '../js/data/VGASpecReader.js';

useGlobalLemmings({ game: { showDebug: false } });

class MockLogHandler {
  constructor() { this.logged = []; }
  log(msg) { this.logged.push(msg); }
  debug() {}
}

const withMockLogHandler = (fn) => {
  const orig = Lemmings.LogHandler;
  setDependency('LogHandler', MockLogHandler);
  try {
    return withShowDebug(true, fn);
  } finally {
    setDependency('LogHandler', orig);
  }
};

describe('VGASpecReader', function() {
  it('decodes image and palettes', function() {
    const part = new Uint8Array(24 + 16 + 3);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 1 + i;
      part[i * 3 + 1] = 2 + i;
      part[i * 3 + 2] = 3 + i;
    }
    let pos = 24 + 16;
    part[pos++] = 0x00; // copy one byte
    part[pos++] = 0x80; // plane0 first bit set
    part[pos++] = 128;  // end chunk

    const packed = Lemmings.PackFilePart.pack(part);
    const size = packed.byteArray.length + 10;
    const header = new Uint8Array([
      packed.initialBits,
      packed.checksum,
      0, 0,
      (part.length >> 8) & 0xff,
      part.length & 0xff,
      0, 0,
      (size >> 8) & 0xff,
      size & 0xff
    ]);
    const container = new Uint8Array(size);
    container.set(header, 0);
    container.set(packed.byteArray, 10);
    const br = new BinaryReader(container);
    const reader = new VGASpecReader(br, 320, 40);

    expect(reader.groundPalette.getR(0)).to.equal(4);
    expect(reader.groundPalette.getG(0)).to.equal(8);
    expect(reader.groundPalette.getB(0)).to.equal(12);
    const color = reader.img.getBuffer()[304];
    const expected = Lemmings.ColorPalette.colorFromRGB(8, 12, 16) >>> 0;
    expect(color).to.equal(expected);
  });

  function buildContainer(part) {
    const packed = Lemmings.PackFilePart.pack(part);
    const size = packed.byteArray.length + 10;
    const header = new Uint8Array([
      packed.initialBits,
      packed.checksum,
      0, 0,
      (part.length >> 8) & 0xff,
      part.length & 0xff,
      0, 0,
      (size >> 8) & 0xff,
      size & 0xff
    ]);
    const container = new Uint8Array(size);
    container.set(header, 0);
    container.set(packed.byteArray, 10);
    return container;
  }

  it('logs when the file container is missing', function() {
    const logs = withMockLogHandler(() => {
      const br = new BinaryReader(new Uint8Array(5));
      const reader = new VGASpecReader(br, 320, 40);
      return reader.log.logged;
    });

    expect(logs.some(m => m.includes('No FileContainer found!')))
      .to.be.true;
  });


  it('logs when palette data ends prematurely', function() {
    const part = new Uint8Array(24);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 1 + i;
      part[i * 3 + 1] = 2 + i;
      part[i * 3 + 2] = 3 + i;
    }
    const container = buildContainer(part);
    const logs = withMockLogHandler(() => {
      const reader = new VGASpecReader(new BinaryReader(container), 320, 40);
      return reader.log.logged;
    });
    expect(logs.some(m => m.includes('unexpected end of file')))
      .to.be.true;
  });

  it('handles repeat runs and exposes dimensions', function() {
    const repeats = 301;
    const part = new Uint8Array(24 + 16 + repeats * 2);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 2;
      part[i * 3 + 1] = 4;
      part[i * 3 + 2] = 6;
    }
    let pos = 24 + 16;
    for (let i = 0; i < repeats; i++) {
      part[pos++] = 129; // repeat run (257 - 129 = 128)
      part[pos++] = 1;
    }
    const container = buildContainer(part);
    const reader = new VGASpecReader(new BinaryReader(container), 320, 40);
    expect(reader.width).to.equal(320);
    expect(reader.height).to.equal(40);
  });

  it('returns early on copy overflow', function() {
    const runs = 301;
    const bytesPerRun = 129;
    const part = new Uint8Array(40 + runs * bytesPerRun);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 1;
      part[i * 3 + 1] = 2;
      part[i * 3 + 2] = 3;
    }
    let pos = 40;
    for (let i = 0; i < runs; i++) {
      part[pos++] = 127;
      for (let j = 0; j < 128; j++) {
        part[pos++] = 0;
      }
    }
    const container = buildContainer(part);
    const reader = new VGASpecReader(new BinaryReader(container), 320, 40);
    expect(reader.width).to.equal(320);
  });
});
