import { expect } from 'chai';
import { readFileSync } from 'fs';
import { BinaryReader } from '../js/BinaryReader.js';
import { FileContainer } from '../js/FileContainer.js';
import '../js/SkillTypes.js';
import '../js/LevelProperties.js';
import '../js/Range.js';
import '../js/LevelElement.js';
import '../js/DrawProperties.js';
import { LevelReader } from '../js/LevelReader.js';
import { LevelWriter } from '../js/LevelWriter.js';

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
});
