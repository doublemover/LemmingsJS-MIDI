import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { BitReader } from '../js/data/BitReader.js';
import { BitWriter } from '../js/data/BitWriter.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { LevelReader } from '../js/level/LevelReader.js';
import '../js/util/LogHandler.js';
import '../js/game/SkillTypes.js';
import '../js/level/LevelProperties.js';
import '../js/render/DrawProperties.js';
import '../js/level/LevelElement.js';
import '../js/util/Range.js';
import '../js/data/UnpackFilePart.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('LevelReader', function () {
  it('parses LEVEL000.DAT', function () {
    const buf = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new BinaryReader(new Uint8Array(buf));
    const fc = new FileContainer(br);
    const part = fc.getPart(0);
    const lr = new LevelReader(part);

    expect(lr.objects.length).to.be.at.most(32);
    expect(lr.terrains.length).to.be.at.most(400);
    expect(lr.steel.length).to.be.at.most(32);
    expect(lr.levelProperties.levelName.length).to.equal(32);
  });

  it('handles empty objects, terrain skips, and LemEdit steel offsets', function () {
    const buf = new Uint8Array(2048);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < 400; i++) {
      dv.setInt32(0x0120 + i * 4, -1);
    }
    const xField = 16;
    const yRaw = 300;
    const id = 5;
    const v = (xField << 16) | (yRaw << 7) | id;
    dv.setUint32(0x0124, v);

    const steelPos = 0x0760;
    buf[steelPos] = 2;
    buf[steelPos + 1] = 2;
    buf[steelPos + 2] = 0x11;
    buf[steelPos + 3] = 0;

    const br = new BinaryReader(buf);
    const lr = new LevelReader(br);
    expect(lr.objects.length).to.equal(0);
    expect(lr.terrains.length).to.equal(1);
    expect(lr.terrains[0].y).to.be.below(0);

    lr.readSteelArea(new BinaryReader(buf), true);
    expect(lr.steel.length).to.be.at.least(1);
    expect(lr.steel[0].x).to.equal(4);
    expect(lr.steel[0].width).to.equal(8);
  });
});
