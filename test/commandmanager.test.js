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
});
