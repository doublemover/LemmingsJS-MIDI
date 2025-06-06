import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { OddTableReader } from '../js/OddTableReader.js';
import '../js/SkillTypes.js';
import '../js/LevelProperties.js';
import '../js/LogHandler.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('OddTableReader', function () {
  it('parses level properties from an ODDTABLE buffer', function () {
    const encodeWord = (n) => [(n >> 8) & 0xff, n & 0xff];
    const words = [
      5,   // releaseRate
      20,  // releaseCount
      10,  // needCount
      3,   // timeLimit
      1, 2, 3, 4, 5, 6, 7, 8 // skills
    ];
    const bytes = [];
    for (const w of words) bytes.push(...encodeWord(w));
    const name = 'Test Level';
    for (let i = 0; i < 32; i++) bytes.push(name.charCodeAt(i) || 0);

    const reader = new BinaryReader(new Uint8Array(bytes));
    const odd = new OddTableReader(reader);

    const props = odd.getLevelProperties(0);
    expect(props.releaseRate).to.equal(5);
    expect(props.skills[Lemmings.SkillTypes.CLIMBER]).to.equal(1);
    expect(props.skills[Lemmings.SkillTypes.DIGGER]).to.equal(8);
    expect(props.levelName.replace(/\x00+$/, '')).to.equal('Test Level');
  });
});
