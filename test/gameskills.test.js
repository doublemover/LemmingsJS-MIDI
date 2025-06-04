import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import '../js/GameSkills.js';

globalThis.lemmings = { game: { showDebug: false } };

function createGameSkills(initial) {
  const level = { skills: new Array(Object.keys(Lemmings.SkillTypes).length).fill(0) };
  for (const [skill, count] of Object.entries(initial)) {
    level.skills[Lemmings.SkillTypes[skill]] = count;
  }
  const gs = Object.create(Lemmings.GameSkills.prototype);
  gs.selectedSkill = Lemmings.SkillTypes.CLIMBER;
  gs.onCountChanged = new Lemmings.EventHandler();
  gs.onSelectionChanged = new Lemmings.EventHandler();
  gs.skills = level.skills;
  gs.cheatMode = false;
  return gs;
}

describe('GameSkills', function() {
  it('decrements skill counts when used', function() {
    const gs = createGameSkills({ CLIMBER: 2 });
    let triggered = false;
    gs.onCountChanged.on(type => { if (type === Lemmings.SkillTypes.CLIMBER) triggered = true; });
    expect(gs.reuseSkill(Lemmings.SkillTypes.CLIMBER)).to.be.true;
    expect(triggered).to.be.true;
    expect(gs.getSkill(Lemmings.SkillTypes.CLIMBER)).to.equal(1);
  });

  it('does not allow reuse when count is zero', function() {
    const gs = createGameSkills({ FLOATER: 1 });
    expect(gs.reuseSkill(Lemmings.SkillTypes.FLOATER)).to.be.true;
    expect(gs.getSkill(Lemmings.SkillTypes.FLOATER)).to.equal(0);
    expect(gs.reuseSkill(Lemmings.SkillTypes.FLOATER)).to.be.false;
    expect(gs.getSkill(Lemmings.SkillTypes.FLOATER)).to.equal(0);
  });
});
