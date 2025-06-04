import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/GameStateTypes.js';
import { Game } from '../js/Game.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';

// minimal environment
globalThis.lemmings = { game: { showDebug: false } };

describe('Game victory condition', function () {
  function makeGame(release, needPct) {
    const level = {
      releaseCount: release,
      needCount: Math.floor(release * needPct / 100),
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

  it('wins when saved lemmings meet required percentage', function () {
    const game = makeGame(10, 50); // need 5
    const vc = game.gameVictoryCondition;
    vc.leftCount = 0;
    vc.outCount = 0;
    vc.survivorCount = 5;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.SUCCEEDED);
  });

  it('fails when saved lemmings are below required percentage', function () {
    const game = makeGame(10, 50); // need 5
    const vc = game.gameVictoryCondition;
    vc.leftCount = 0;
    vc.outCount = 0;
    vc.survivorCount = 4;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_LESS_LEMMINGS);
  });

  it('fails due to time even if percentage not met', function () {
    const game = makeGame(10, 50); // need 5
    game.gameTimer = { getGameLeftTime() { return 0; } };
    const vc = game.gameVictoryCondition;
    vc.leftCount = 2;
    vc.outCount = 0;
    vc.survivorCount = 4;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_OUT_OF_TIME);
  });
});
