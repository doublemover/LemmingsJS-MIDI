import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { BitReader } from '../js/BitReader.js';
import { BitWriter } from '../js/BitWriter.js';
import { FileContainer } from '../js/FileContainer.js';
import { LevelReader } from '../js/LevelReader.js';
import '../js/LogHandler.js';
import '../js/SkillTypes.js';
import '../js/LevelProperties.js';
import '../js/DrawProperties.js';
import '../js/LevelElement.js';
import '../js/Range.js';
import '../js/UnpackFilePart.js';

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
