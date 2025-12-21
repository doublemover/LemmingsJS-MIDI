import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings } from './helpers/lemmings.js';
import '../js/util/LogHandler.js';
import '../js/game/SkillTypes.js';
import '../js/level/LevelProperties.js';
import '../js/render/DrawProperties.js';
import '../js/level/LevelElement.js';
import '../js/util/Range.js';
import '../js/data/BitReader.js';
import '../js/data/BitWriter.js';
import '../js/data/UnpackFilePart.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { BitReader } from '../js/data/BitReader.js';
import { BitWriter } from '../js/data/BitWriter.js';
import { UnpackFilePart } from '../js/data/UnpackFilePart.js';
import { FileContainer } from '../js/data/FileContainer.js';
import '../js/game/SkillTypes.js';
import '../js/level/LevelProperties.js';
import '../js/util/Range.js';
import '../js/level/LevelElement.js';
import '../js/render/DrawProperties.js';
import { LevelReader } from '../js/level/LevelReader.js';
import { LevelWriter } from '../js/level/LevelWriter.js';
import '../js/level/LevelProperties.js';
import '../js/level/LevelElement.js';
import '../js/render/DrawProperties.js';
import '../js/util/Range.js';
import '../js/game/SkillTypes.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('LevelWriter', function() {
  it('round-trips a level without changes', function() {
    const buf = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new BinaryReader(new Uint8Array(buf));
    const fc = new FileContainer(br);
    const part = fc.getPart(0);
    const lr = new LevelReader(part);
    const writer = new LevelWriter();
    const out = writer.write(lr);

    const lr2 = new LevelReader(new BinaryReader(out));
    expect(lr2.levelProperties.releaseRate).to.equal(lr.levelProperties.releaseRate);
    expect(lr2.levelProperties.releaseCount).to.equal(lr.levelProperties.releaseCount);
    expect(lr2.levelProperties.needCount).to.equal(lr.levelProperties.needCount);
    expect(lr2.levelProperties.timeLimit).to.equal(lr.levelProperties.timeLimit);
    expect(lr2.screenPositionX).to.equal(lr.screenPositionX);
    expect(lr2.graphicSet1).to.equal(lr.graphicSet1);
    expect(lr2.graphicSet2).to.equal(lr.graphicSet2);
    expect(lr2.isSuperLemming).to.equal(lr.isSuperLemming);
    expect(lr2.objects.length).to.equal(lr.objects.length);
    expect(lr2.terrains.length).to.equal(lr.terrains.length);
    expect(lr2.steel.length).to.equal(lr.steel.length);
    expect(lr2.levelProperties.levelName).to.equal(lr.levelProperties.levelName);
  });

  it('writes and reads an empty level', function() {
    const level = { levelProperties: new Lemmings.LevelProperties() };
    const writer = new LevelWriter();
    const out = writer.write(level);

    const lr = new LevelReader(new BinaryReader(out));
    expect(lr.levelProperties.releaseRate).to.equal(0);
    expect(lr.levelProperties.releaseCount).to.equal(0);
    expect(lr.levelProperties.needCount).to.equal(0);
    expect(lr.levelProperties.timeLimit).to.equal(0);
    expect(lr.screenPositionX).to.equal(0);
    expect(lr.graphicSet1).to.equal(0);
    expect(lr.graphicSet2).to.equal(0);
    expect(lr.isSuperLemming).to.equal(false);
    expect(lr.objects.length).to.equal(0);
    expect(lr.terrains.length).to.equal(0);
    expect(lr.steel.length).to.equal(0);
    expect(lr.levelProperties.levelName).to.equal('\x00'.repeat(32));
  });
});
