import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
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

globalThis.lemmings = { game: { showDebug: false } };

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
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }
    const orig = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;

    const br = new BinaryReader(new Uint8Array(5));
    const reader = new VGASpecReader(br, 320, 40);

    globalThis.lemmings.game.showDebug = prev;
    setDependency('LogHandler', orig);

    expect(reader.log.logged.some(m => m.includes('No FileContainer found!')))
      .to.be.true;
  });


  it('logs when palette data ends prematurely', function() {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }
    const part = new Uint8Array(24);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 1 + i;
      part[i * 3 + 1] = 2 + i;
      part[i * 3 + 2] = 3 + i;
    }
    const container = buildContainer(part);
    const orig = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;
    const reader = new VGASpecReader(new BinaryReader(container), 320, 40);
    globalThis.lemmings.game.showDebug = prev;
    setDependency('LogHandler', orig);
    expect(reader.log.logged.some(m => m.includes('unexpected end of file')))
      .to.be.true;
  });
});
