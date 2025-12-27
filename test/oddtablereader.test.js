import { expect } from 'chai';
import { BinaryReader } from '../js/data/BinaryReader.js';
import '../js/game/SkillTypes.js';
import { OddTableReader } from '../js/data/OddTableReader.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('OddTableReader', function() {
  it('returns null for out-of-range levels', function() {
    const buf = new Uint8Array(56);
    const br = new BinaryReader(buf);
    const reader = new OddTableReader(br);
    expect(reader.getLevelProperties(-1)).to.equal(null);
    expect(reader.getLevelProperties(1)).to.equal(null);
    expect(reader.getLevelProperties(0)).to.be.ok;
  });
});
