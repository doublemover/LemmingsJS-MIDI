import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/GameStateTypes.js';
import { Game } from '../js/Game.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';

globalThis.lemmings = Lemmings;

function makeGame() {
  const level = {
    releaseCount: 1,
    needCount: 1,
    releaseRate: 1,
    timeLimit: 5,
    triggers: [],
    objects: [],
    colorPalette: 0
  };
  const g = new Game({});
  g.gameVictoryCondition = new GameVictoryCondition(level);
  g.gameTimer = { getGameLeftTime() { return 60; } };
  return g;
}

describe('bench mode game continues', function() {
  beforeEach(function() {
    lemmings.bench = true;
    lemmings.endless = false;
  });

  it('returns RUNNING when all lemmings removed', function() {
    const game = makeGame();
    const vc = game.gameVictoryCondition;
    vc.leftCount = 0;
    vc.outCount = 0;
    vc.survivorCount = 0;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);
    game.checkForGameOver();
    expect(game.finalGameState).to.equal(Lemmings.GameStateTypes.UNKNOWN);
  });
});
