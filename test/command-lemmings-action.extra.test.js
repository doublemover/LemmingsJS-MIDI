import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { CommandLemmingsAction } from '../js/commands/CommandLemmingsAction.js';

// minimal global
useGlobalLemmings({ game: { showDebug: false } });

describe('CommandLemmingsAction extras', function() {
  it('serializes and deserializes correctly', function() {
    const cmd = new CommandLemmingsAction(5);
    const saved = cmd.save();
    expect(saved[0]).to.equal(5);

    const other = new CommandLemmingsAction(0);
    other.load([7]);
    expect(other.lemmingId).to.equal(7);
  });

  it('returns command key and executes', function() {
    let acted = 0;
    const lem = { id: 1 };
    const lemMgr = {
      getLemming() { return lem; },
      doLemmingAction() { acted++; return true; }
    };
    const skills = {
      getSelectedSkill() { return 'skill'; },
      canReuseSkill() { return true; },
      reuseSkill() { return true; }
    };
    const game = {
      getLemmingManager() { return lemMgr; },
      getGameSkills() { return skills; }
    };
    const cmd = new CommandLemmingsAction(1);
    expect(cmd.getCommandKey()).to.equal('l');
    expect(cmd.execute(game)).to.be.true;
    expect(acted).to.equal(1);
  });
});
