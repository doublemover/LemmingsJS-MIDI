import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import '../js/BitReader.js';
import '../js/BitWriter.js';
import '../js/PackFilePart.js';
import '../js/UnpackFilePart.js';
import '../js/FileContainer.js';
import '../js/PaletteImage.js';
import '../js/Frame.js';
import '../js/ColorPalette.js';
import { VGASpecReader } from '../js/VGASpecReader.js';

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
    Lemmings.LogHandler = MockLogHandler;
    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;

    const br = new BinaryReader(new Uint8Array(5));
    const reader = new VGASpecReader(br, 320, 40);

    globalThis.lemmings.game.showDebug = prev;
    Lemmings.LogHandler = orig;

    expect(reader.log.logged.some(m => m.includes('No FileContainer found!')))
      .to.be.true;
  });

  it('handles run-length chunks across sections', function() {
    const part = new Uint8Array(24 + 16 + 6);
    for (let i = 0; i < 8; i++) {
      part[i * 3] = 1 + i;
      part[i * 3 + 1] = 2 + i;
      part[i * 3 + 2] = 3 + i;
    }
    let pos = 24 + 16;
    part[pos++] = 0x00; // copy one byte
    part[pos++] = 0x80;
    part[pos++] = 0x80; // end first chunk
    part[pos++] = 0xFE; // repeat three times
    part[pos++] = 0x40; // plane1 first bit
    part[pos++] = 0x80; // end second chunk

    const container = buildContainer(part);
    const br = new BinaryReader(container);
    const reader = new VGASpecReader(br, 320, 80);
    const buf = reader.img.getBuffer();
    const expected1 = Lemmings.ColorPalette.colorFromRGB(8, 12, 16) >>> 0;
    const expected2 = Lemmings.ColorPalette.colorFromRGB(12, 16, 20) >>> 0;
    expect(buf[304]).to.equal(expected1);
    const row2 = 320 * 40;
    expect(buf[row2 + 304]).to.equal(expected2);
    expect(buf[row2 + 305]).to.equal(expected2);
    expect(buf[row2 + 306]).to.equal(expected2);
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
    Lemmings.LogHandler = MockLogHandler;
    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;
    const reader = new VGASpecReader(new BinaryReader(container), 320, 40);
    globalThis.lemmings.game.showDebug = prev;
    Lemmings.LogHandler = orig;
    expect(reader.log.logged.some(m => m.includes('unexpected end of file')))
      .to.be.true;
  });
});
