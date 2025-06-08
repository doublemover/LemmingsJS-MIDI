import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import '../js/CommandSelectSkill.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('CommandSelectSkill', function() {
  function createGame(skillReturn = true, actionReturn = true) {
    let selected;
    let reused = false;
    const gameSkills = {
      setSelectedSkill(skill) { selected = skill; return skillReturn; },
      canReuseSkill() { return true; },
      reuseSkill() { reused = true; }
    };
    const lem = {};
    const lemmingManager = {
      getSelectedLemming() { return lem; },
      doLemmingAction() { return actionReturn; }
    };
    const game = {
      getGameSkills() { return gameSkills; },
      getLemmingManager() { return lemmingManager; }
    };
    return { game, selectedRef: () => selected, reusedRef: () => reused };
  }

  it('execute changes skill and reuses when apply true', function() {
    const { game, selectedRef, reusedRef } = createGame(true, true);
    const cmd = new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.CLIMBER, true);
    const changed = cmd.execute(game);
    expect(changed).to.be.true;
    expect(selectedRef()).to.equal(Lemmings.SkillTypes.CLIMBER);
    expect(reusedRef()).to.be.true;
  });

  it('execute does not reuse when apply false', function() {
    const { game, reusedRef } = createGame(false, true);
    const cmd = new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.FLOATER, false);
    const changed = cmd.execute(game);
    expect(changed).to.be.false;
    expect(reusedRef()).to.be.false;
  });

  it('load, save, and getCommandKey round-trip', function() {
    const cmd = new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.BASHER, false);
    const saved = cmd.save();
    const other = new Lemmings.CommandSelectSkill();
    other.load(saved);
    expect(other.skill).to.equal(Lemmings.SkillTypes.BASHER);
    expect(other.apply).to.equal(false);
    expect(other.save()).to.deep.equal(saved);
    expect(other.getCommandKey()).to.equal('s');
  });
});
