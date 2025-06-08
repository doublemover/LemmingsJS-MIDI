import { expect } from 'chai';
import { GameGui } from '../js/GameGui.js';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';

class DisplayImageStub {
  constructor() { this.calls = []; this.worldDataSize = { width: 0, height: 0 }; }
  drawFrame(frame, x, y) { this.calls.push({ op: 'drawFrame', frame, x, y }); }
  drawFrameCovered(frame, x, y) { this.calls.push({ op: 'drawFrameCovered', frame, x, y }); }
}

const stubSprites = {
  getPanelSprite() { return { width: 0, height: 0, getData() { return [0]; } }; },
  getNumberSpriteLeft(n) { return 'L' + n; },
  getNumberSpriteRight(n) { return 'R' + n; },
  getNumberSpriteEmpty() { return 'E'; },
  getLetterSprite(ch) { return 'ch-' + ch; }
};

const stubSkills = { onCountChanged: { on() {} }, onSelectionChanged: { on() {} } };
const stubTimer = { eachGameSecond: { on() {} }, isRunning() { return true; }, speedFactor: 1 };
const stubVC = { getCurrentReleaseRate() { return 0; }, getMinReleaseRate() { return 0; }, getMaxReleaseRate() { return 99; }, setCurrentReleaseRate() {}, getOutCount() { return 0; }, getSurvivorPercentage() { return 0; } };

describe('GameGui draw helpers', function() {
  function makeGui() {
    return new GameGui({}, stubSprites, stubSkills, stubTimer, stubVC);
  }

  it('drawNumber draws left and right digits', function() {
    const gui = makeGui();
    const disp = new DisplayImageStub();
    gui.drawNumber(disp, 42, 0, 0);
    expect(disp.calls[0]).to.deep.equal({ op: 'drawFrameCovered', frame: 'L4', x: 0, y: 0 });
    expect(disp.calls[1]).to.deep.equal({ op: 'drawFrame', frame: 'R2', x: 0, y: 0 });
  });

  it('drawNumber uses empty sprite for zero', function() {
    const gui = makeGui();
    const disp = new DisplayImageStub();
    gui.drawNumber(disp, 0, 1, 2);
    expect(disp.calls[0]).to.deep.equal({ op: 'drawFrame', frame: 'E', x: 1, y: 2 });
  });

  it('drawGreenString draws each letter', function() {
    const gui = makeGui();
    const disp = new DisplayImageStub();
    gui.drawGreenString(disp, 'AB', 0, 0);
    expect(disp.calls).to.deep.equal([
      { op: 'drawFrameCovered', frame: 'ch-A', x: 0, y: 0 },
      { op: 'drawFrameCovered', frame: 'ch-B', x: 0, y: 0 }
    ]);
  });

  it('skill/idx mappings round trip', function() {
    const gui = makeGui();
    for (const key of Object.keys(Lemmings.SkillTypes)) {
      const skill = Lemmings.SkillTypes[key];
      if (skill === Lemmings.SkillTypes.UNKNOWN) continue;
      const idx = gui.getPanelIndexBySkill(skill);
      expect(gui.getSkillByPanelIndex(idx)).to.equal(skill);
    }
    expect(gui.getSkillByPanelIndex(0)).to.equal(Lemmings.SkillTypes.UNKNOWN);
  });
});
