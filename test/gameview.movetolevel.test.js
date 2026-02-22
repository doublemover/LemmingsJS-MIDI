import { expect } from 'chai';
import { setDependency, resetDependencies, useGlobalLemmings } from './helpers/lemmings.js';
import { GameView } from '../js/game/GameView.js';

describe('GameView moveToLevel', function() {
  const originalWindow = globalThis.window;
  useGlobalLemmings({});
  const makeView = ({ gameType, levelGroupIndex, levelIndex }) => {
    const view = new GameView();
    view.gameType = gameType;
    view.levelGroupIndex = levelGroupIndex;
    view.levelIndex = levelIndex;
    view.loadLevel = async () => {};
    return view;
  };
  const expectState = (view, expected) => {
    expect(view.gameType).to.equal(expected.gameType);
    expect(view.levelGroupIndex).to.equal(expected.levelGroupIndex);
    expect(view.levelIndex).to.equal(expected.levelIndex);
  };

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
    3: makeConfig([0]),
    4: makeConfig([0, 2]),
    5: makeConfig([2, 2]),
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
  });

  const cases = [
    {
      name: 'wraps to the previous pack last level when backing up from pack start',
      start: { gameType: 2, levelGroupIndex: 0, levelIndex: 0 },
      delta: -1,
      expected: { gameType: 1, levelGroupIndex: 1, levelIndex: 4 }
    },
    {
      name: 'uses the previous group length when moving back across groups',
      start: { gameType: 1, levelGroupIndex: 1, levelIndex: 0 },
      delta: -1,
      expected: { gameType: 1, levelGroupIndex: 0, levelIndex: 3 }
    },
    {
      name: 'skips empty groups when moving forward',
      start: { gameType: 4, levelGroupIndex: 0, levelIndex: 0 },
      delta: 1,
      expected: { gameType: 4, levelGroupIndex: 1, levelIndex: 1 }
    },
    {
      name: 'wraps to pack 1 when current pack only contains empty groups',
      start: { gameType: 3, levelGroupIndex: 0, levelIndex: 0 },
      delta: 1,
      expected: { gameType: 1, levelGroupIndex: 0, levelIndex: 1 },
      setup() {
        // make gameType 3 the last valid pack so that incrementing wraps to 1
        setDependency('GameTypes', { length: 4 });
      }
    },
    {
      name: 'advances across level groups when needed',
      start: { gameType: 5, levelGroupIndex: 0, levelIndex: 1 },
      delta: 1,
      expected: { gameType: 5, levelGroupIndex: 1, levelIndex: 0 }
    },
    {
      name: 'wraps to pack 1 when advancing past the last pack level',
      start: { gameType: 6, levelGroupIndex: 1, levelIndex: 2 },
      delta: 1,
      expected: { gameType: 1, levelGroupIndex: 0, levelIndex: 0 }
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, async function() {
      if (testCase.setup) testCase.setup();
      const view = makeView(testCase.start);
      await view.moveToLevel(testCase.delta);
      expectState(view, testCase.expected);
    });
  }

  it('returns to the previous pack after crossing into the next pack boundary', async function() {
    const denseConfigs = {
      1: makeConfig([20, 20, 20, 20]),
      2: makeConfig([20, 20, 20, 20])
    };
    setDependency('GameFactory', class {
      constructor() {}
      async getConfig(gameType) {
        return denseConfigs[gameType] || makeConfig([0]);
      }
      async getGameResources(gameType) {
        return { gameType };
      }
    });
    setDependency('GameTypes', { length: 3 });

    const view = makeView({ gameType: 1, levelGroupIndex: 3, levelIndex: 19 });
    await view.moveToLevel(1);
    expectState(view, { gameType: 2, levelGroupIndex: 0, levelIndex: 0 });

    await view.moveToLevel(-1);
    expectState(view, { gameType: 1, levelGroupIndex: 3, levelIndex: 19 });
  });

  it('wraps after the last level of pack 2 and still allows moving back to pack 2', async function() {
    const denseConfigs = {
      1: makeConfig([20, 20, 20, 20]),
      2: makeConfig([20, 20, 20, 20])
    };
    setDependency('GameFactory', class {
      constructor() {}
      async getConfig(gameType) {
        return denseConfigs[gameType] || makeConfig([0]);
      }
      async getGameResources(gameType) {
        return { gameType };
      }
    });
    setDependency('GameTypes', { length: 3 });

    const view = makeView({ gameType: 2, levelGroupIndex: 3, levelIndex: 19 });
    await view.moveToLevel(1);
    expectState(view, { gameType: 1, levelGroupIndex: 0, levelIndex: 0 });

    await view.moveToLevel(-1);
    expectState(view, { gameType: 2, levelGroupIndex: 3, levelIndex: 19 });
  });
});
