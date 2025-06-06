import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/CommandNuke.js';
import '../js/CommandReleaseRateIncrease.js';
import '../js/CommandReleaseRateDecrease.js';
import '../js/CommandLemmingsAction.js';

// minimal global for logging
globalThis.lemmings = { game: { showDebug: false } };

describe('Commands', function() {
  it('CommandNuke triggers doNukeAllLemmings and doNuke once', function() {
    let nukedAll = 0;
    let nuked = 0;
    const lemMgr = {
      isNuking() { return false; },
      doNukeAllLemmings() { nukedAll++; }
    };
    const gvc = { doNuke() { nuked++; } };
    const game = {
      getLemmingManager() { return lemMgr; },
      getVictoryCondition() { return gvc; }
    };
    const cmd = new Lemmings.CommandNuke();
    const result = cmd.execute(game);
    expect(result).to.be.true;
    expect(nukedAll).to.equal(1);
    expect(nuked).to.equal(1);
  });

  it('CommandReleaseRateIncrease and Decrease forward values', function() {
    const calls = [];
    const gvc = { changeReleaseRate(n) { calls.push(n); return true; } };
    const game = { getVictoryCondition() { return gvc; } };

    const inc = new Lemmings.CommandReleaseRateIncrease(2);
    const dec = new Lemmings.CommandReleaseRateDecrease(3);
    expect(inc.execute(game)).to.be.true;
    expect(dec.execute(game)).to.be.true;
    expect(calls).to.deep.equal([2, -3]);
  });

  it('CommandLemmingsAction applies a skill when available and fails gracefully otherwise', function() {
    const lem = { id: 1 };
    let actions = 0;
    let reused = 0;
    const lemMgr = {
      getLemming(id) { return lem; },
      doLemmingAction(l, skill) { actions++; return true; }
    };
    const skills = {
      getSelectedSkill() { return 'skill'; },
      canReuseSkill() { return true; },
      reuseSkill() { reused++; return true; }
    };
    const game = {
      getLemmingManager() { return lemMgr; },
      getGameSkills() { return skills; }
    };
    const cmd = new Lemmings.CommandLemmingsAction(1);
    expect(cmd.execute(game)).to.be.true;
    expect(actions).to.equal(1);
    expect(reused).to.equal(1);

    skills.canReuseSkill = () => false;
    const fail = new Lemmings.CommandLemmingsAction(1);
    expect(fail.execute(game)).to.be.false;
    expect(actions).to.equal(1);
    expect(reused).to.equal(1);
  });
});
