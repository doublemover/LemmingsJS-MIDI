import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import '../js/BitReader.js';
import '../js/BitWriter.js';
import '../js/PaletteImage.js';
import '../js/Frame.js';
import '../js/ColorPalette.js';
import '../js/ObjectImageInfo.js';
import { GroundReader } from '../js/GroundReader.js';

// Silence debug output
globalThis.lemmings = { game: { showDebug: false } };

describe('GroundReader', function() {
  it('reads palettes and detects steel', async function() {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => ({ lemmings: { 'GROUND0O.DAT': [0] } }) });
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
    const vgaT = new BinaryReader(new Uint8Array([0, 0, 0, 0]));
    const vgaO = new BinaryReader(new Uint8Array([0, 0, 0, 0, 0]));
    const gr = new GroundReader(ground, vgaT, vgaO);

    expect(gr.groundPalette.getR(0)).to.equal(4);
    expect(gr.groundPalette.getG(0)).to.equal(8);
    expect(gr.groundPalette.getB(0)).to.equal(12);
    expect(gr.colorPalette.getR(8)).to.equal(160);
    expect(gr.colorPalette.getG(8)).to.equal(200);
    expect(gr.colorPalette.getB(8)).to.equal(240);
    expect(gr.imgTerrain[0].isSteel).to.equal(true);
  });

  it('logs warnings for inconsistent object fields', function() {
    class MockLogHandler {
      constructor() { this.logged = []; }
      log(msg) { this.logged.push(msg); }
      debug() {}
    }
    const origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = MockLogHandler;
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
    new GroundReader(ground, vgaT, vgaO);

    globalThis.lemmings.game.showDebug = prev;
    const logs = ground.log.logged;
    Lemmings.LogHandler = origHandler;
    expect(logs.some(m => m.includes('unknown1 diverges'))).to.equal(true);
    expect(logs.some(m => m.includes('unknown2 should be'))).to.equal(true);
  });
});
