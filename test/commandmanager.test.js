import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';
import { CommandManager } from '../js/commands/CommandManager.js';

useGlobalLemmings({ game: { showDebug: false } });

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
    expect(cm.commandFactory('l')).to.be.ok;
    expect(cm.commandFactory('n')).to.be.ok;
    expect(cm.commandFactory('s')).to.be.ok;
    expect(cm.commandFactory('i')).to.be.ok;
    expect(cm.commandFactory('d')).to.be.ok;
  });

  it('parseCommand loads values correctly', function() {
    const cm = new TestCommandManager(game, new MockTimer());
    const cmd = cm.parseCommand('x2:3');
    expect(cmd).to.be.instanceOf(StubCommand);
    expect(cmd.values).to.deep.equal([2, 3]);
    const unknown = cm.parseCommand('z1');
    expect(unknown).to.equal(null);
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
    cm.loadReplay('2=x5&bad&4=x6');
    timer.next();
    timer.next();
    expect(cm.serialize()).to.equal('');
    timer.next();
    expect(cm.serialize()).to.equal('2=x5');
    timer.next();
    expect(cm.serialize()).to.equal('2=x5');
    timer.next();
    expect(cm.serialize()).to.equal('2=x5&4=x6');
  });

  it('serialize concatenates multiple logged commands', function() {
    const timer = new MockTimer();
    timer.tick = 1;

    const cm = new TestCommandManager(game, timer);
    const first = new StubCommand();
    cm.queueCommand(first);
    timer.tick = 2;
    const second = new StubCommand();
    second.load([5]);
    cm.queueCommand(second);

    expect(cm.serialize()).to.equal('1=x1&2=x5');
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

    cm.queueCommand({ save() { return []; } });
  });

  it('early exits when constructed without dependencies', function() {
    const cm = new TestCommandManager(null, null);
    expect(cm.game).to.equal(undefined);
    expect(cm.gameTimer).to.equal(undefined);
  });

  it('removes a preexisting tick listener on construction', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);
    const oldListener = cm._tickListener;
    let removed = false;
    timer.onBeforeGameTick.off = function(fn) {
      if (fn === oldListener) removed = true;
      Lemmings.EventHandler.prototype.off.call(this, fn);
    };
    cm.dispose();
    const fresh = new TestCommandManager(game, timer);
    expect(removed).to.equal(true);
    expect(fresh._tickListener).to.not.equal(oldListener);
  });

  it('setGame assigns new game and clears state', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);
    cm.runCommands[1] = new StubCommand();
    cm.loggedCommads[2] = new StubCommand();
    const newGame = {};
    cm.setGame(newGame);
    expect(cm.game).to.equal(newGame);
    expect(cm.runCommands).to.deep.equal({});
    expect(cm.loggedCommads).to.deep.equal({});
  });

  it('setGame ignores null input', function() {
    const cm = new TestCommandManager(game, new MockTimer());
    const prev = cm.game;
    cm.setGame(null);
    expect(cm.game).to.equal(prev);
  });

  it('removes inherited tick listener on construction', function() {
    const timer = new MockTimer();
    let removed = false;
    TestCommandManager.prototype._tickListener = () => {};
    timer.onBeforeGameTick.off = function(fn) {
      if (fn === TestCommandManager.prototype._tickListener) removed = true;
      Lemmings.EventHandler.prototype.off.call(this, fn);
    };
    const cm = new TestCommandManager(game, timer);
    expect(removed).to.equal(true);
    delete TestCommandManager.prototype._tickListener;
    cm.dispose();
  });

  it('skips malformed replay entries', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);
    cm.loadReplay('bad-entry');
    expect(Object.keys(cm.runCommands)).to.have.lengthOf(0);
  });

  it('dispose removes tick listener and clears references', function() {
    const timer = new MockTimer();
    const cm = new TestCommandManager(game, timer);
    const listener = cm._tickListener;
    let offCalled = false;
    timer.onBeforeGameTick.off = function(fn) {
      if (fn === listener) offCalled = true;
      Lemmings.EventHandler.prototype.off.call(this, fn);
    };
    cm.dispose();
    expect(offCalled).to.equal(true);
    expect(cm._tickListener).to.equal(null);
    expect(cm.game).to.equal(null);
    expect(cm.gameTimer).to.equal(null);
    expect(cm.log).to.equal(null);
    expect(cm.runCommands).to.deep.equal({});
    expect(cm.loggedCommads).to.deep.equal({});
  });

  it('dispose does not clear unrelated before-tick listeners', function() {
    const timer = new MockTimer();
    let unrelatedCalls = 0;
    timer.onBeforeGameTick.on(() => { unrelatedCalls += 1; });
    const cm = new TestCommandManager(game, timer);

    cm.dispose();
    timer.next();

    expect(unrelatedCalls).to.equal(1);
  });
});
