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

  it('ignores counts when cheat mode is enabled', function() {
    const gs = createGameSkills({ BOMBER: 1 });
    gs.cheatMode = true;
    const before = gs.getSkill(Lemmings.SkillTypes.BOMBER);
    expect(gs.canReuseSkill(Lemmings.SkillTypes.BOMBER)).to.be.true;
    expect(gs.reuseSkill(Lemmings.SkillTypes.BOMBER)).to.be.true;
    expect(gs.getSkill(Lemmings.SkillTypes.BOMBER)).to.equal(before);
  });

  it('cheat() sets all skills to Infinity', function() {
    const gs = createGameSkills({});
    const triggered = [];
    gs.onCountChanged.on(idx => triggered.push(idx));
    gs.cheat();
    expect(gs.cheatMode).to.be.true;
    for (let i = 0; i < gs.skills.length; i++) {
      expect(gs.skills[i]).to.equal(Infinity);
    }
    expect(triggered).to.deep.equal([...Array(gs.skills.length).keys()]);
  });

  it('caps displayed skill counts at 99', function() {
    const gs = createGameSkills({ CLIMBER: Infinity });
    expect(gs.getSkill(Lemmings.SkillTypes.CLIMBER)).to.equal(99);
  });

  it('auto-selects next available skill when current runs out', function() {
    const gs = createGameSkills({ CLIMBER: 1, FLOATER: 2 });
    gs.setSelectedSkill(Lemmings.SkillTypes.CLIMBER);
    gs.reuseSkill(Lemmings.SkillTypes.CLIMBER);
    expect(gs.getSkill(Lemmings.SkillTypes.CLIMBER)).to.equal(0);
    expect(gs.getSelectedSkill()).to.equal(Lemmings.SkillTypes.FLOATER);
  });
});
