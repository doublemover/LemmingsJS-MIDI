import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/GameResult.js';

describe('GameResult', function() {
  it('captures game state and stats', function() {
    const mockGame = {
      getGameState() { return 'state'; },
      getCommandManager() { return { serialize() { return 'replay'; } }; },
      getVictoryCondition() {
        return {
          getSurvivorPercentage() { return 75; },
          getSurvivorsCount() { return 10; }
        };
      },
      getGameTimer() { return { getGameTicks() { return 1234; } }; }
    };

    const result = new Lemmings.GameResult(mockGame);
    expect(result.state).to.equal('state');
    expect(result.replay).to.equal('replay');
    expect(result.survivorPercentage).to.equal(75);
    expect(result.survivors).to.equal(10);
    expect(result.duration).to.equal(1234);
  });
});
