import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';

function createWindow() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

globalThis.lemmings = { game: { showDebug: false } };

describe('GameView.moveToLevel conditional paths', function () {
  const configs = {
    1: { level: { order: [[0], [0]], getGroupLength(i) { return this.order[i].length; } } },
    2: { level: { order: [[0]], getGroupLength(i) { return this.order[i].length; } } },
    3: { level: { order: [[0]], getGroupLength(i) { return this.order[i].length; } } }
  };
  let requests;
  class GameFactoryMock {
    async getConfig(type) { return configs[type]; }
    async getGameResources(type) { requests.push(type); return {}; }
    get configReader() { return { configs: Promise.resolve([]) }; }
  }
  beforeEach(function () {
    requests = [];
    global.window = createWindow();
    global.history = { replaceState() {} };
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { TYPE1: 0, TYPE2: 1, TYPE3: 2 };
  });
  afterEach(function () {
    delete global.window;
    delete global.history;
  });

  it('ignores backward move from first level of first group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(-1);
    expect(view.levelIndex).to.equal(0);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.gameType).to.equal(1);
    expect(calls).to.equal(0);
    expect(requests).to.eql([]);
  });

  it('increments gameType when past last group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    configs[1].level.order = [[0]];
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(1);
    expect(view.gameType).to.equal(2);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(calls).to.equal(1);
    expect(requests).to.eql([2]);
  });

  it('resets invalid game type to default', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 3;
    await view.moveToLevel(0);
    expect(view.gameType).to.equal(1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(calls).to.equal(1);
    expect(requests).to.eql([1]);
  });
});
