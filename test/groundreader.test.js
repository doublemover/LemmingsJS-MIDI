import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import '../js/data/BitReader.js';
import '../js/data/BitWriter.js';
import { PaletteImage } from '../js/render/PaletteImage.js';
import '../js/render/Frame.js';
import '../js/render/ColorPalette.js';
import '../js/level/ObjectImageInfo.js';
import { GroundReader } from '../js/level/GroundReader.js';

// Silence debug output
globalThis.lemmings = { game: { showDebug: false } };

describe('GroundReader', function() {
  it('reads palettes and detects steel', async function() {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => ({ lemmings: { 'GROUND0O.DAT': [0] } }) });
    Lemmings.resetSteelSprites();
    await Lemmings.loadSteelSprites();
    globalThis.fetch = origFetch;

    const buf = new Uint8Array(1056);
    // object0 width/height
    buf[4] = 1; buf[5] = 1; // width, height
    buf[6] = 0; buf[7] = 5; // frameDataSize
    buf[9] = 4; // maskLoc low (delta 4)
    // terrain0 at offset 448
    const tOff = 28 * 16;
    buf[tOff] = 1; buf[tOff + 1] = 1; // width, height
    buf[tOff + 5] = 3; // maskLoc low (delta 3)

    // palette section
    const pal = 960 + 24; // skip EGA
    for (let i = 0; i < 8; i++) {
      buf[pal + i * 3] = 1 + i;
      buf[pal + i * 3 + 1] = 2 + i;
      buf[pal + i * 3 + 2] = 3 + i;
    }
    const cp = pal + 24;
    for (let i = 0; i < 8; i++) {
      buf[cp + i * 3] = 10 + i;
      buf[cp + i * 3 + 1] = 20 + i;
      buf[cp + i * 3 + 2] = 30 + i;
    }
    const prev = cp + 24;
    for (let i = 0; i < 8; i++) {
      buf[prev + i * 3] = 40 + i;
      buf[prev + i * 3 + 1] = 50 + i;
      buf[prev + i * 3 + 2] = 60 + i;
    }

    const ground = new BinaryReader(buf, 0, buf.length, 'GROUND0O.DAT', 'lemmings');
    const vgaT = new BinaryReader(new Uint8Array([0x80, 0, 0, 0x80]));
    const vgaO = new BinaryReader(new Uint8Array([0, 0, 0, 0, 0]));
    const gr = new GroundReader(ground, vgaT, vgaO);

    expect(gr.groundPalette.getR(0)).to.equal(4);
    expect(gr.groundPalette.getG(0)).to.equal(8);
    expect(gr.groundPalette.getB(0)).to.equal(12);
    expect(gr.colorPalette.getR(8)).to.equal(160);
    expect(gr.colorPalette.getG(8)).to.equal(200);
    expect(gr.colorPalette.getB(8)).to.equal(240);
    expect(gr.imgTerrain[0].isSteel).to.equal(true);
    expect(gr.imgTerrain[0].steelWidth).to.equal(1);
    expect(gr.imgTerrain[0].steelHeight).to.equal(1);
  });

  it('logs warnings for inconsistent object fields', function() {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }
    const origHandler = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const prev = globalThis.lemmings.game.showDebug;
    globalThis.lemmings.game.showDebug = true;

    const buf = new Uint8Array(1056);
    // object0: minimal data with mismatched unknown fields
    buf[4] = 1; buf[5] = 1; // width, height
    buf[6] = 0; buf[7] = 5; // frameDataSize
    buf[8] = 0x04; buf[9] = 0x00; // maskLoc = 0x0400? Wait big-endian -> we want 0x0400 maybe 1024; but we can set 0x04 0x00 -> 1024
    buf[10] = 0; buf[11] = 0; // unknown1 (should be 0x0400)
    buf[12] = 0; buf[13] = 0; // unknown2 (should be 0x0200)
    // rest of object0 left zero (trigger etc)

    // terrain0 to satisfy reader
    const tOff = 28 * 16;
    buf[tOff] = 1; buf[tOff + 1] = 1;
    buf[tOff + 5] = 3;

    const pal = 960 + 24;
    for (let i = 0; i < 48; i++) buf[pal + i] = 0;

    const ground = new BinaryReader(buf, 0, buf.length, 'GROUND0O.DAT', 'lemmings');
    const vgaT = new BinaryReader(new Uint8Array([0,0,0,0]));
    const vgaO = new BinaryReader(new Uint8Array([0,0,0,0,0]));
    const gr = new GroundReader(ground, vgaT, vgaO);

    globalThis.lemmings.game.showDebug = prev;
    const logs = gr.log.logged;
    setDependency('LogHandler', origHandler);
    expect(logs.some(m => m.includes('unknown1 diverges'))).to.equal(true);
    expect(logs.some(m => m.includes('unknown2 should be'))).to.equal(true);
  });

  it('returns early when ground file size is invalid', function() {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }
    const origHandler = Lemmings.LogHandler;
    setDependency('LogHandler', MockLogHandler);
    const br = new BinaryReader(new Uint8Array(10), 0, 10, 'bad.dat');
    const vgaT = new BinaryReader(new Uint8Array([0]));
    const vgaO = new BinaryReader(new Uint8Array([0]));
    const gr = new GroundReader(br, vgaT, vgaO);
    setDependency('LogHandler', origHandler);
    expect(gr.log.logged.some(m => m.includes('wrong size'))).to.equal(true);
  });

  it('loads steel sprites from disk when fetch fails', async function() {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fail'); };
    Lemmings.resetSteelSprites();
    const sprites = await Lemmings.loadSteelSprites();
    globalThis.fetch = origFetch;
    expect(sprites).to.be.an('object');
  });

  it('rethrows when fetch fails on non-file URLs', async function() {
    const origFetch = globalThis.fetch;
    const origURL = globalThis.URL;
    globalThis.fetch = async () => { throw new Error('fail'); };
    globalThis.URL = class {
      constructor() {
        this.protocol = 'http:';
        this.href = 'http://example.test/steelSprites.json';
      }
    };
    Lemmings.resetSteelSprites();
    let err = null;
    try {
      await Lemmings.loadSteelSprites();
    } catch (e) {
      err = e;
    }
    globalThis.fetch = origFetch;
    globalThis.URL = origURL;
    expect(err).to.be.instanceOf(Error);
  });

  it('logs when terrain folder name is unknown', function() {
    const buf = new Uint8Array(1056);
    const tOff = 28 * 16;
    buf[tOff] = 1;
    buf[tOff + 1] = 1;
    buf[tOff + 5] = 3;
    const pal = 960 + 24;
    for (let i = 0; i < 48; i++) buf[pal + i] = 0;
    const ground = new BinaryReader(buf, 0, buf.length, 'GROUND0O.DAT');
    const vgaT = new BinaryReader(new Uint8Array([0, 0, 0, 0]));
    const vgaO = new BinaryReader(new Uint8Array([0, 0, 0, 0, 0]));
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    new GroundReader(ground, vgaT, vgaO);
    console.log = orig;
    expect(logs.length).to.be.greaterThan(0);
  });

  it('logs when object data hits EOF', function() {
    const logs = [];
    const gr = Object.create(GroundReader.prototype);
    gr.imgObjects = new Array(16);
    gr.log = { log: msg => logs.push(msg) };
    const br = new BinaryReader(new Uint8Array(1), 0, 1, 'bad.dat', 'lemmings');
    gr._readObjectImages(br, 0, {});
    expect(logs.some(m => m.includes('unexpected EOF'))).to.equal(true);
  });

  it('logs when terrain data hits EOF', function() {
    const logs = [];
    const gr = Object.create(GroundReader.prototype);
    gr.imgTerrain = new Array(64);
    gr.log = { log: msg => logs.push(msg) };
    const br = new BinaryReader(new Uint8Array(1), 0, 1, 'bad.dat', 'lemmings');
    gr._readTerrainImages(br, 0, {});
    expect(logs.some(m => m.includes('unexpected EOF'))).to.equal(true);
  });

  it('skips missing image entries in _readImages', function() {
    const gr = Object.create(GroundReader.prototype);
    const br = new BinaryReader(new Uint8Array(0), 0, 0, 'empty.dat', 'lemmings');
    gr._readImages([null], br, 3);
  });

  it('computes steel extents from non-transparent frames', function() {
    const gr = Object.create(GroundReader.prototype);
    const img = {
      width: 2,
      height: 2,
      frameCount: 1,
      frameDataSize: 0,
      imageLoc: 0,
      maskLoc: 0,
      isSteel: true
    };
    const br = new BinaryReader(new Uint8Array(0), 0, 0, 'empty.dat', 'lemmings');
    const origProcess = PaletteImage.prototype.processImage;
    const origTransparent = PaletteImage.prototype.processTransparentData;
    const origBuffer = PaletteImage.prototype.getImageBuffer;
    PaletteImage.prototype.processImage = () => {};
    PaletteImage.prototype.processTransparentData = () => {};
    PaletteImage.prototype.getImageBuffer = () => new Uint8Array([128, 128, 128, 1]);
    try {
      gr._readImages([img], br, 3);
      expect(img.steelWidth).to.equal(2);
      expect(img.steelHeight).to.equal(2);
    } finally {
      PaletteImage.prototype.processImage = origProcess;
      PaletteImage.prototype.processTransparentData = origTransparent;
      PaletteImage.prototype.getImageBuffer = origBuffer;
    }
  });
});
