import { expect } from 'chai';
import { GameStateTypes } from '../js/game/GameStateTypes.js';
import { GameTypes } from '../js/game/GameTypes.js';
import { MaskTypes } from '../js/render/MaskTypes.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

describe('Enums', function () {
  it('have stable numeric values', function () {
    expect(GameStateTypes.UNKNOWN).to.equal(0);
    expect(GameStateTypes.SUCCEEDED).to.equal(4);

    expect(GameTypes.UNKNOWN).to.equal(0);
    expect(GameTypes.HOLIDAY94).to.equal(6);
    expect(GameTypes.toString(999)).to.equal('UNKNOWN');
    expect(GameTypes.toString(GameTypes.LEMMINGS)).to.equal('LEMMINGS');

    expect(MaskTypes.BASHING_R).to.equal(0);
    expect(MaskTypes.NUMBERS).to.equal(5);

    expect(SkillTypes.UNKNOWN).to.equal(0);
    expect(SkillTypes.DIGGER).to.equal(8);

    expect(SpriteTypes.WALKING).to.equal(0);
    expect(SpriteTypes.OUT_OF_LEVEL).to.equal(19);

    expect(TriggerTypes.NO_TRIGGER).to.equal(0);
    expect(TriggerTypes.DISABLED).to.equal(13);
  });
});
