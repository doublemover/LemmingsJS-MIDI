import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';
import { Game } from '../js/game/Game.js';

// minimal global for logging


describe('Game.queueCommand', function() {
  useGlobalLemmings({ game: { showDebug: false } });

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
