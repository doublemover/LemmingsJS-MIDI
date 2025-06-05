import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import '../js/CommandSelectSkill.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('CommandSelectSkill', function() {
  it('reuses skill on selected lemming when possible', function() {
    let reused = false;
    const gameSkills = {
      setSelectedSkill() { return true; },
      canReuseSkill() { return true; },
      reuseSkill() { reused = true; }
    };
    const lem = {};
    const lemmingManager = {
      getSelectedLemming() { return lem; },
      doLemmingAction(l, skill) { return l === lem; }
    };
    const game = {
      getGameSkills() { return gameSkills; },
      getLemmingManager() { return lemmingManager; }
    };
    const cmd = new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.CLIMBER);
    cmd.execute(game);
    expect(reused).to.be.true;
  });

  it('fails gracefully when action cannot be applied', function() {
    let reused = false;
    const gameSkills = {
      setSelectedSkill() { return true; },
      canReuseSkill() { return true; },
      reuseSkill() { reused = true; }
    };
    const lem = {};
    const lemmingManager = {
      getSelectedLemming() { return lem; },
      doLemmingAction() { return false; }
    };
    const game = {
      getGameSkills() { return gameSkills; },
      getLemmingManager() { return lemmingManager; }
    };
    const cmd = new Lemmings.CommandSelectSkill(Lemmings.SkillTypes.FLOATER);
    cmd.execute(game);
    expect(reused).to.be.false;
  });
});
