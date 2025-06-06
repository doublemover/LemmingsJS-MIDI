import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/CommandLemmingsAction.js';
import '../js/CommandNuke.js';
import '../js/CommandReleaseRateDecrease.js';
import '../js/CommandReleaseRateIncrease.js';

// minimal global for logging
globalThis.lemmings = { game: { showDebug: false } };

describe('CommandLemmingsAction', function() {
  function makeGame(opts = {}) {
    return {
      getLemmingManager: () => opts.lemmingManager,
      getGameSkills: () => opts.gameSkills
    };
  }

  it('fails without managers', function() {
    const cmd = new Lemmings.CommandLemmingsAction(1);
    expect(cmd.execute(makeGame())).to.be.false;
  });

  it('fails when no lemming found', function() {
    const cmd = new Lemmings.CommandLemmingsAction(1);
    const game = makeGame({
      lemmingManager: { getLemming() { return null; } },
      gameSkills: {}
    });
    expect(cmd.execute(game)).to.be.false;
  });

  it('fails when skill cannot be reused', function() {
    const cmd = new Lemmings.CommandLemmingsAction(1);
    const game = makeGame({
      lemmingManager: { getLemming() { return {}; } },
      gameSkills: {
        getSelectedSkill() { return 'S'; },
        canReuseSkill() { return false; }
      }
    });
    expect(cmd.execute(game)).to.be.false;
  });

  it('fails when action is rejected', function() {
    const lem = {};
    const cmd = new Lemmings.CommandLemmingsAction(1);
    const game = makeGame({
      lemmingManager: {
        getLemming() { return lem; },
        doLemmingAction() { return false; }
      },
      gameSkills: {
        getSelectedSkill() { return 'S'; },
        canReuseSkill() { return true; }
      }
    });
    expect(cmd.execute(game)).to.be.false;
  });

  it('applies skill and reuses it', function() {
    const lem = {};
    let reused = false;
    const cmd = new Lemmings.CommandLemmingsAction(2);
    const game = makeGame({
      lemmingManager: {
        getLemming(id) { return id === 2 ? lem : null; },
        doLemmingAction(l, skill) { return l === lem && skill === 'S'; }
      },
      gameSkills: {
        getSelectedSkill() { return 'S'; },
        canReuseSkill() { return true; },
        reuseSkill() { reused = true; return true; }
      }
    });
    expect(cmd.execute(game)).to.be.true;
    expect(reused).to.be.true;
  });
});

describe('CommandNuke', function() {
  function makeGame(opts = {}) {
    return {
      getLemmingManager: () => opts.lemmingManager,
      getVictoryCondition: () => opts.victory
    };
  }

  it('fails without managers', function() {
    const cmd = new Lemmings.CommandNuke();
    expect(cmd.execute(makeGame())).to.be.false;
  });

  it('fails when already nuking', function() {
    const cmd = new Lemmings.CommandNuke();
    const lm = { isNuking: () => true };
    const vc = {};
    expect(cmd.execute(makeGame({ lemmingManager: lm, victory: vc }))).to.be.false;
  });

  it('nukes when allowed', function() {
    let nuked = false;
    const cmd = new Lemmings.CommandNuke();
    const lm = {
      isNuking: () => false,
      doNukeAllLemmings() { nuked = true; }
    };
    const vc = {
      doNuke() { nuked = nuked && true; }
    };
    expect(cmd.execute(makeGame({ lemmingManager: lm, victory: vc }))).to.be.true;
    expect(nuked).to.be.true;
  });
});

describe('CommandReleaseRateDecrease', function() {
  function makeGame(vc) {
    return { getVictoryCondition: () => vc };
  }

  it('fails when missing victory condition', function() {
    const cmd = new Lemmings.CommandReleaseRateDecrease(2);
    expect(cmd.execute(makeGame(null))).to.be.false;
  });

  it('changes release rate negatively', function() {
    let value = 0;
    const vc = { changeReleaseRate(n) { value += n; return true; } };
    const cmd = new Lemmings.CommandReleaseRateDecrease(3);
    expect(cmd.execute(makeGame(vc))).to.be.true;
    expect(value).to.equal(-3);
  });
});

describe('CommandReleaseRateIncrease', function() {
  function makeGame(vc) {
    return { getVictoryCondition: () => vc };
  }

  it('fails when missing victory condition', function() {
    const cmd = new Lemmings.CommandReleaseRateIncrease(2);
    expect(cmd.execute(makeGame(null))).to.be.false;
  });

  it('changes release rate positively', function() {
    let value = 0;
    const vc = { changeReleaseRate(n) { value += n; return false; } };
    const cmd = new Lemmings.CommandReleaseRateIncrease(5);
    expect(cmd.execute(makeGame(vc))).to.be.false;
    expect(value).to.equal(5);
  });
});
