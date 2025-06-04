import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { Game } from '../js/Game.js';

// minimal global for logging
globalThis.lemmings = { game: { showDebug: false } };

describe('Game.queueCommand', function() {
  it('forwards commands to CommandManager', function() {
    let received = null;
    const manager = { queueCommand(cmd) { received = cmd; } };
    const game = new Game({});
    game.commandManager = manager;
    const cmd = {};
    game.queueCommand(cmd);
    expect(received).to.equal(cmd);
  });
});
