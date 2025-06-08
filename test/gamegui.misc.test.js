import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SkillTypes.js';
import { GameGui } from '../js/GameGui.js';

const stubSprites = {
  getPanelSprite() { return { width: 0, height: 0, getData() { return [0]; } }; },
  getNumberSpriteEmpty() { return {}; },
  getLetterSprite() { return {}; },
  getNumberSpriteLeft() { return {}; },
  getNumberSpriteRight() { return {}; }
};

const stubSkills = { onCountChanged: { on() {} }, onSelectionChanged: { on() {} }, getSkill() { return 1; } };
const stubTimer = { eachGameSecond: { on() {} }, isRunning() { return true; }, speedFactor: 1 };
const stubVC = { getCurrentReleaseRate() { return 0; }, getMinReleaseRate() { return 0; }, getMaxReleaseRate() { return 99; }, setCurrentReleaseRate() {}, getOutCount() { return 0; }, getSurvivorPercentage() { return 0; } };

describe('GameGui mapping helpers', function() {
  it('converts between skills and panel indices', function() {
    const gui = new GameGui({}, stubSprites, stubSkills, stubTimer, stubVC);
    for (const skill of [Lemmings.SkillTypes.CLIMBER, Lemmings.SkillTypes.DIGGER]) {
      const idx = gui.getPanelIndexBySkill(skill);
      expect(gui.getSkillByPanelIndex(idx)).to.equal(skill);
    }
    expect(gui.getSkillByPanelIndex(99)).to.equal(Lemmings.SkillTypes.UNKNOWN);
  });
});
