import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { CommandManager } from '../js/CommandManager.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('CommandManager', function() {
  class MockTimer {
    constructor() {
      this.tick = 0;
      this.onBeforeGameTick = new Lemmings.EventHandler();
    }
    getGameTicks() { return this.tick; }
    next() {
      this.onBeforeGameTick.trigger(this.tick);
      this.tick++;
    }
  }

  const game = {
    getGameSkills() { return null; },
    getLemmingManager() { return null; },
    getVictoryCondition() { return null; }
  };

  class StubCommand {
    constructor() { this.execCount = 0; }
    execute() { this.execCount++; return true; }
    load(values) { this.values = values; }
    save() { return [this.values ? this.values[0] : 1]; }
    getCommandKey() { return 'x'; }
  }

  class TestCommandManager extends CommandManager {
    commandFactory(type) {
      if (type === 'x') return new StubCommand();
      return super.commandFactory(type);
    }
  }

  it('commandFactory creates stub commands', function() {
    const cm = new TestCommandManager(game, new MockTimer());
    const cmd = cm.commandFactory('x');
    expect(cmd).to.be.instanceOf(StubCommand);
    expect(cm.commandFactory('z')).to.equal(null);
  });

  it('parseCommand loads values correctly', function() {
    const cm = new TestCommandManager(game, new MockTimer());
    const cmd = cm.parseCommand('x2:3');
    expect(cmd).to.be.instanceOf(StubCommand);
    expect(cmd.values).to.deep.equal([2, 3]);
  });

  it('queueCommand logs command and serializes', function() {
    const timer = new MockTimer();
    timer.tick = 1;

    const cm = new TestCommandManager(game, timer);
    const cmd = new StubCommand();
    cm.queueCommand(cmd);
    expect(cmd.execCount).to.equal(1);
    expect(cm.serialize()).to.equal('1=x1');
  });

  it('loadReplay schedules commands for future ticks', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);
    cm.loadReplay('2=x5');
    timer.next();
    timer.next();
    expect(cm.serialize()).to.equal('');
    timer.next();
    expect(cm.serialize()).to.equal('2=x5');
  });

  it('handles missing gameTimer and failed commands gracefully', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);

    cm.gameTimer = null;
    const bad = new StubCommand();
    cm.queueCommand(bad);
    expect(bad.execCount).to.equal(0);

    const empty = cm.parseCommand('');
    expect(empty).to.equal(undefined);

    const failCmd = new StubCommand();
    failCmd.execute = () => false;
    cm.gameTimer = timer;
    cm.queueCommand(failCmd);
    expect(Object.keys(cm.loggedCommads)).to.have.lengthOf(0);
  });

  it('early exits when constructed without dependencies', function() {
    const cm = new TestCommandManager(null, null);
    expect(cm.game).to.equal(undefined);
    expect(cm.gameTimer).to.equal(undefined);
  });
});
