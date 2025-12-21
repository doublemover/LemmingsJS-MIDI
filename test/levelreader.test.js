import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings } from './helpers/lemmings.js';
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

globalThis.lemmings = { game: { showDebug: false } };

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
});
