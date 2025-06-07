import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/GameStateTypes.js';
import { Game } from '../js/Game.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';
import '../js/GameResult.js';

// minimal environment
globalThis.lemmings = { game: { showDebug: false } };

describe('Game victory condition', function () {
  function makeGame(release, needPct, time = 60) {
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
    g.gameTimer = {
      getGameLeftTime() { return time; },
      getGameTicks() { return 100; }
    };
    g.commandManager = { serialize() { return 'replay'; } };
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

  it('continues running while lemmings remain and time left', function () {
    const game = makeGame(10, 50);
    const vc = game.gameVictoryCondition;
    vc.leftCount = 2;
    vc.outCount = 1;
    vc.survivorCount = 2;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);
  });

  it('fails due to time even if percentage not met', function () {
    const game = makeGame(10, 50, 0); // need 5
    const vc = game.gameVictoryCondition;
    vc.leftCount = 2;
    vc.outCount = 0;
    vc.survivorCount = 4;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.FAILED_OUT_OF_TIME);
  });

  it('succeeds when time expires but required percentage reached', function () {
    const game = makeGame(10, 50, 0); // need 5
    const vc = game.gameVictoryCondition;
    vc.leftCount = 2;
    vc.outCount = 1;
    vc.survivorCount = 5;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.SUCCEEDED);
  });

  it('remains running with unlimited time even at zero timer', function () {
    const game = makeGame(10, 50, 0);
    lemmings.endless = true;
    const vc = game.gameVictoryCondition;
    vc.leftCount = 1;
    vc.outCount = 1;
    vc.survivorCount = 0;
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.RUNNING);
    lemmings.endless = false;
  });

  it('succeeds immediately when a level has no lemmings', function () {
    const game = makeGame(0, 0);
    const vc = game.gameVictoryCondition;
    expect(vc.getReleaseCount()).to.equal(0);
    expect(game.getGameState()).to.equal(Lemmings.GameStateTypes.SUCCEEDED);
  });

  it('emits GameResult on game end', function () {
    const game = makeGame(10, 50);
    const vc = game.gameVictoryCondition;
    vc.leftCount = 0;
    vc.outCount = 0;
    vc.survivorCount = 5;
    let result;
    game.onGameEnd.on(r => { result = r; });
    game.checkForGameOver();
    expect(result).to.be.an.instanceOf(Lemmings.GameResult);
    expect(result.state).to.equal(Lemmings.GameStateTypes.SUCCEEDED);
    expect(result.survivors).to.equal(5);
    expect(result.survivorPercentage).to.equal(50);
    expect(result.duration).to.equal(100);
    expect(result.replay).to.equal('replay');
  });
});
