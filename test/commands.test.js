import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/commands/CommandNuke.js';
import '../js/commands/CommandReleaseRateIncrease.js';
import '../js/commands/CommandReleaseRateDecrease.js';
import '../js/commands/CommandLemmingsAction.js';
import '../js/commands/CommandSelectSkill.js';

// minimal global for logging
useGlobalLemmings({ game: { showDebug: false } });

const withSoundEvents = (soundEvents, fn) => {
  const game = globalThis.lemmings.game;
  const hadProp = Object.prototype.hasOwnProperty.call(game, 'soundEvents');
  const prev = game.soundEvents;
  game.soundEvents = soundEvents;
  try {
    return fn();
  } finally {
    if (hadProp) {
      game.soundEvents = prev;
    } else {
      delete game.soundEvents;
    }
  }
};

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

  it('CommandNuke fails when nuking already in progress', function() {
    const lemMgr = {
      isNuking() { return true; },
      doNukeAllLemmings() { throw new Error('should not be called'); }
    };
    const gvc = { doNuke() { throw new Error('should not be called'); } };
    const game = {
      getLemmingManager() { return lemMgr; },
      getVictoryCondition() { return gvc; }
    };
    const cmd = new Lemmings.CommandNuke();
    const result = cmd.execute(game);
    expect(result).to.be.false;
  });

  it('CommandNuke returns false when no victory condition is present', function() {
    const lemMgr = { isNuking() { return false; } };
    const game = {
      getLemmingManager() { return lemMgr; },
      getVictoryCondition() { return undefined; }
    };
    const cmd = new Lemmings.CommandNuke();
    const result = cmd.execute(game);
    expect(result).to.be.false;
  });

  it('CommandNuke returns false when no lemming manager is present', function() {
    const gvc = { doNuke() { throw new Error('should not be called'); } };
    const game = {
      getLemmingManager() { return undefined; },
      getVictoryCondition() { return gvc; }
    };
    const cmd = new Lemmings.CommandNuke();
    const result = cmd.execute(game);
    expect(result).to.be.false;
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

  it('CommandLemmingsAction handles missing dependencies and failed actions', function() {
    const cmd = new Lemmings.CommandLemmingsAction(1);
    const gameNoMgr = { getLemmingManager() { return null; }, getGameSkills() { return {}; } };
    expect(cmd.execute(gameNoMgr)).to.equal(false);

    const gameNoSkills = { getLemmingManager() { return {}; }, getGameSkills() { return null; } };
    expect(cmd.execute(gameNoSkills)).to.equal(false);

    const gameNoLem = {
      getLemmingManager() { return { getLemming() { return null; } }; },
      getGameSkills() {
        return { getSelectedSkill() { return 'skill'; }, canReuseSkill() { return true; } };
      }
    };
    expect(cmd.execute(gameNoLem)).to.equal(false);

    const gameFailAction = {
      getLemmingManager() {
        return { getLemming() { return { id: 2 }; }, doLemmingAction() { return false; } };
      },
      getGameSkills() {
        return {
          getSelectedSkill() { return 'skill'; },
          canReuseSkill() { return true; },
          reuseSkill() { return true; }
        };
      }
    };
    expect(cmd.execute(gameFailAction)).to.equal(false);

    const gameFailReuse = {
      getLemmingManager() {
        return { getLemming() { return { id: 3 }; }, doLemmingAction() { return true; } };
      },
      getGameSkills() {
        return {
          getSelectedSkill() { return 'skill'; },
          canReuseSkill() { return true; },
          reuseSkill() { return false; }
        };
      }
    };
    expect(cmd.execute(gameFailReuse)).to.equal(false);
  });

  it('CommandLemmingsAction emits sfx on success', function() {
    let called = null;
    withSoundEvents({
      emitSfx(type, id, payload) { called = { type, id, payload }; }
    }, () => {
      const game = {
        getLemmingManager() {
          return {
            getLemming() { return { id: 7, x: 1, y: 2 }; },
            doLemmingAction() { return true; }
          };
        },
        getGameSkills() {
          return {
            getSelectedSkill() { return 'skill'; },
            canReuseSkill() { return true; },
            reuseSkill() { return true; }
          };
        }
      };
      const cmd = new Lemmings.CommandLemmingsAction(7);
      expect(cmd.execute(game)).to.equal(true);
      expect(called).to.be.an('object');
    });
  });

  it('CommandSelectSkill applies selection and optional action', function() {
    const calls = [];
    withSoundEvents({
      emitSfx(type, id, payload) { calls.push({ type, id, payload }); }
    }, () => {
      const lem = { id: 1, x: 2, y: 3 };
      const skills = {
        setSelectedSkill() { return true; },
        canReuseSkill() { return true; },
        reuseSkill() { return true; }
      };
      const lemMgr = {
        getSelectedLemming() { return lem; },
        doLemmingAction() { return true; }
      };
      const game = {
        getGameSkills() { return skills; },
        getLemmingManager() { return lemMgr; }
      };
      const cmd = new Lemmings.CommandSelectSkill(5, true);
      expect(cmd.execute(game)).to.equal(true);
      expect(calls.length).to.equal(2);

      const noApply = new Lemmings.CommandSelectSkill(2, false);
      expect(noApply.execute(game)).to.equal(true);
    });
  });

  it('CommandSelectSkill handles missing skills and action failures', function() {
    const cmd = new Lemmings.CommandSelectSkill(1, true);
    expect(cmd.execute({ getGameSkills() { return null; } })).to.equal(false);

    const skills = { setSelectedSkill() { return false; } };
    const game = {
      getGameSkills() { return skills; },
      getLemmingManager() { return null; }
    };
    expect(cmd.execute(game)).to.equal(false);

    const lem = { id: 2 };
    const gameFail = {
      getGameSkills() {
        return {
          setSelectedSkill() { return true; },
          canReuseSkill() { return false; },
          reuseSkill() { return false; }
        };
      },
      getLemmingManager() {
        return {
          getSelectedLemming() { return lem; },
          doLemmingAction() { return false; }
        };
      }
    };
    expect(cmd.execute(gameFail)).to.equal(true);
  });

  it('command metadata helpers return defaults', function() {
    const nuke = new Lemmings.CommandNuke();
    nuke.load();
    expect(nuke.save()).to.deep.equal([]);
    expect(nuke.getCommandKey()).to.equal('n');

    const inc = new Lemmings.CommandReleaseRateIncrease(1);
    inc.load();
    expect(inc.save()).to.deep.equal([]);
    expect(inc.getCommandKey()).to.equal('i');

    const dec = new Lemmings.CommandReleaseRateDecrease(1);
    dec.load();
    expect(dec.save()).to.deep.equal([]);
    expect(dec.getCommandKey()).to.equal('d');

    const select = new Lemmings.CommandSelectSkill();
    select.load([3, 0]);
    expect(select.save()).to.deep.equal([3, 0]);
    expect(select.getCommandKey()).to.equal('s');
  });

  it('release rate commands return false without victory condition', function() {
    const game = { getVictoryCondition() { return null; } };
    const inc = new Lemmings.CommandReleaseRateIncrease(1);
    const dec = new Lemmings.CommandReleaseRateDecrease(1);
    expect(inc.execute(game)).to.equal(false);
    expect(dec.execute(game)).to.equal(false);
  });
});
