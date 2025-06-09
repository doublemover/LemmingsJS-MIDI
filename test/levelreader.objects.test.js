import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/SkillTypes.js';
import '../js/LevelProperties.js';
import '../js/DrawProperties.js';
import '../js/LevelElement.js';
import { LevelWriter } from '../js/LevelWriter.js';
import { LevelReader } from '../js/LevelReader.js';
import { BinaryReader } from '../js/BinaryReader.js';

// Disable verbose debug output
globalThis.lemmings = { game: { showDebug: false } };

describe('LevelReader.readLevelObjects', function() {
  it('parses objects and skips empty entries', function() {
    const props = new Lemmings.LevelProperties();
    const objects = [
      { x: 10, y: 20, id: 5, drawProperties: new Lemmings.DrawProperties(true, true, false, false) },
      null,
      { x: 30, y: 40, id: 0x000C, drawProperties: new Lemmings.DrawProperties(false, false, false, false) }
    ];
    const level = { levelProperties: props, objects };
    const buf = new LevelWriter().write(level);
    const lr = new LevelReader(new BinaryReader(buf));

    expect(lr.objects).to.have.lengthOf(2);
    expect(lr.objects[0].x).to.equal(10);
    expect(lr.objects[0].y).to.equal(20);
    expect(lr.objects[0].id).to.equal(5);
    expect(lr.objects[0].drawProperties.isUpsideDown).to.equal(true);
    expect(lr.objects[0].drawProperties.noOverwrite).to.equal(true);
    expect(lr.objects[1].id).to.equal(0x000C);
  });
});
