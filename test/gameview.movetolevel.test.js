import { expect } from 'chai';
import { setDependency, resetDependencies } from './helpers/lemmings.js';
import { GameView } from '../js/game/GameView.js';

describe('GameView moveToLevel', function() {
  const originalWindow = globalThis.window;
  const originalLemmings = globalThis.lemmings;

  const makeConfig = (lengths) => ({
    level: {
      order: lengths.map((len) => new Array(len)),
      getGroupLength(index) {
        return this.order[index]?.length ?? 0;
      }
    }
  });

  const configs = {
    1: makeConfig([4, 5]),
    2: makeConfig([3]),
    6: makeConfig([2, 3])
  };

  beforeEach(function() {
    setDependency('GameFactory', class {
      constructor() {}
      async getConfig(gameType) {
        return configs[gameType];
      }
      async getGameResources(gameType) {
        return { gameType };
      }
    });
    setDependency('KeyboardShortcuts', class { constructor() {} });
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.lemmings = originalLemmings;
  });

  it('wraps to the previous pack last level when backing up from pack start', async function() {
    const view = new GameView();
    view.gameType = 2;
    view.levelGroupIndex = 0;
    view.levelIndex = 0;
    view.loadLevel = async () => {};

    await view.moveToLevel(-1);

    expect(view.gameType).to.equal(1);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.levelIndex).to.equal(4);
  });

  it('uses the previous group length when moving back across groups', async function() {
    const view = new GameView();
    view.gameType = 1;
    view.levelGroupIndex = 1;
    view.levelIndex = 0;
    view.loadLevel = async () => {};

    await view.moveToLevel(-1);

    expect(view.gameType).to.equal(1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(3);
  });

  it('wraps to pack 1 when advancing past the last pack level', async function() {
    const view = new GameView();
    view.gameType = 6;
    view.levelGroupIndex = 1;
    view.levelIndex = 2;
    view.loadLevel = async () => {};

    await view.moveToLevel(1);

    expect(view.gameType).to.equal(1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
  });
});
