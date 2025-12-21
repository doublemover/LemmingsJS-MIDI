import { BaseLogger } from '../util/LogHandler.js';
import { CommandLemmingsAction } from './CommandLemmingsAction.js';
import { CommandNuke } from './CommandNuke.js';
import { CommandReleaseRateDecrease } from './CommandReleaseRateDecrease.js';
import { CommandReleaseRateIncrease } from './CommandReleaseRateIncrease.js';
import { CommandSelectSkill } from './CommandSelectSkill.js';

class CommandManager extends BaseLogger {
  constructor(game, gameTimer) {
    super();
    if (game == null || gameTimer == null) {
      this.log.log('error! game/timer is null');
      return;
    }
    this.game = game;
    this.gameTimer = gameTimer;
    this.runCommands = {};
    this.loggedCommads = {};
    this.once = true;

    // Remove previous tickListener if any
    if (this._tickListener) {
      this.gameTimer.onBeforeGameTick.off(this._tickListener);
    }
    this._tickListener = (tick) => {
      if (this.once) {
        this.once = false;
      }
      const command = this.runCommands[tick];
      if (!command) return;
      this.queueCommand(command);
    };
    this.gameTimer.onBeforeGameTick.on(this._tickListener);
  }

  setGame(game) {
    if (game == null) return;
    this.game = game;
    this.runCommands = {};
    this.loggedCommads = {};
  }

  loadReplay(replayString) {
    let parts = replayString.split('&');
    for (let i = 0; i < parts.length; i++) {
      let commandStr = parts[i].split('=', 2);
      if (commandStr.length != 2) continue;
      let tick = parseInt(commandStr[0], 10);
      const cmd = this.parseCommand(commandStr[1]);
      if (cmd) this.runCommands[tick] = cmd;
    }
  }

  commandFactory(type) {
    switch (type.toLowerCase()) {
    case 'l': return new CommandLemmingsAction();
    case 'n': return new CommandNuke();
    case 's': return new CommandSelectSkill();
    case 'i': return new CommandReleaseRateIncrease();
    case 'd': return new CommandReleaseRateDecrease();
    default: return null;
    }
  }

  parseCommand(valuesStr) {
    if (valuesStr.length < 1) return;
    const newCommand = this.commandFactory(valuesStr.substr(0, 1));
    if (!newCommand) return null;
    const values = valuesStr.substr(1).split(':');
    newCommand.load(values.map(Number));
    return newCommand;
  }

  queueCommand(newCommand) {
    const currentTick = this.gameTimer?.getGameTicks();
    if (currentTick == null) return;

    let ok = false;
    if (typeof newCommand.execute === 'function') {
      ok = newCommand.execute(this.game);
    }

    if (ok) {
      this.loggedCommads[currentTick] = newCommand;
    }
  }

  serialize() {
    let result = [];
    Object.keys(this.loggedCommads).forEach((key) => {
      let command = this.loggedCommads[+key];
      result.push(key + '=' + command.getCommandKey() + command.save().join(':'));
    });
    return result.join('&');
  }

  dispose() {
    if (this._tickListener && this.gameTimer?.onBeforeGameTick) {
      this.gameTimer.onBeforeGameTick.off(this._tickListener);
      this._tickListener = null;
    }
    if (this.gameTimer && this.gameTimer.onBeforeGameTick && this.gameTimer.onBeforeGameTick.dispose)
      this.gameTimer.onBeforeGameTick.dispose();
    this.game = null;
    this.gameTimer = null;
    this.log = null;
    this.runCommands = {};
    this.loggedCommads = {};
  }
}
export { CommandManager };
