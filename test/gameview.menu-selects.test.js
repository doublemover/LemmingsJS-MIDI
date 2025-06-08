import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

function createWindow() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

function createDocument() {
  return {
    createElement() { return { textContent: '', value: '' }; },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createSelect() {
  return {
    options: [],
    selectedIndex: 0,
    appendChild(o) { this.options.push(o); },
    remove(i) { this.options.splice(i, 1); }
  };
}

class KeyboardShortcutsMock { constructor() {} dispose() {} }

describe('GameView menu interactions', function() {
  beforeEach(function() {
    global.window = createWindow();
    global.document = createDocument();
    global.history = { replaceState() {} };
    this.origKeyboard = Lemmings.KeyboardShortcuts;
    this.origFactory = Lemmings.GameFactory;
    this.origGameTypes = Lemmings.GameTypes;
    this.origGameStateTypes = Lemmings.GameStateTypes;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  afterEach(function() {
    delete global.window;
    delete global.document;
    delete global.history;
    Lemmings.KeyboardShortcuts = this.origKeyboard;
    Lemmings.GameFactory = this.origFactory;
    Lemmings.GameTypes = this.origGameTypes;
    Lemmings.GameStateTypes = this.origGameStateTypes;
  });

  it('populateLevelSelect creates options from resources', async function() {
    const config = { level: { getGroupLength: () => 2 } };
    class GameResourcesMock {
      constructor() { this.calls = []; }
      async getLevel(g, i) { this.calls.push({ g, i }); return { name: `L${i}` }; }
      getLevelGroups() { return ['A', 'B']; }
    }
    class GameFactoryMock {
      async getConfig(type) { expect(type).to.equal(1); return config; }
      get configReader() { return { configs: Promise.resolve([]) }; }
    }
    Lemmings.GameFactory = GameFactoryMock;
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.gameResources = new GameResourcesMock();
    view.gameType = 1;
    view.levelGroupIndex = 0;
    view.levelIndex = 1;
    view.elementSelectLevel = createSelect();

    await view.populateLevelSelect();

    expect(view.elementSelectLevel.options.map(o => o.textContent)).to.eql(['1: L0', '2: L1']);
    expect(view.elementSelectLevel.selectedIndex).to.equal(1);
    expect(view.gameResources.calls).to.deep.equal([{ g: 0, i: 0 }, { g: 0, i: 1 }]);
  });

  it('selectLevelGroup clamps index, resets level and loads', async function() {
    class GameResourcesMock {
      getLevelGroups() { return ['G1', 'G2']; }
    }
    class GameFactoryMock {
      get configReader() { return { configs: Promise.resolve([]) }; }
    }
    Lemmings.GameFactory = GameFactoryMock;
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.gameResources = new GameResourcesMock();
    view.elementSelectLevel = createSelect();
    let populate = 0;
    view.populateLevelSelect = async () => { populate++; };
    let loaded = 0;
    view.loadLevel = () => { loaded++; };
    view.levelIndex = 1;
    await view.selectLevelGroup(5);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.levelIndex).to.equal(0);
    expect(populate).to.equal(1);
    expect(loaded).to.equal(1);
  });

  it('selectGameType fetches new resources and loads', async function() {
    const configs = [ { name: 'A', gametype: 3 }, { name: 'B', gametype: 7 } ];
    const newResources = { getLevelGroups: () => ['X', 'Y'] };
    let request = null;
    class GameFactoryMock {
      async getGameResources(t) { request = t; return newResources; }
      get configReader() { return { configs: Promise.resolve(configs) }; }
    }
    Lemmings.GameFactory = GameFactoryMock;
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.configs = configs;
    view.elementSelectLevelGroup = createSelect();
    let populate = 0;
    view.populateLevelSelect = async () => { populate++; };
    let loaded = 0;
    view.loadLevel = () => { loaded++; };

    await view.selectGameType(1);
    expect(view.gameType).to.equal(7);
    expect(request).to.equal(7);
    expect(view.gameResources).to.equal(newResources);
    expect(view.elementSelectLevelGroup.options.map(o => o.textContent)).to.eql(['1 - X', '2 - Y']);
    expect(view.elementSelectLevelGroup.selectedIndex).to.equal(0);
    expect(populate).to.equal(1);
    expect(loaded).to.equal(1);
  });

  it('selectLevel updates index and loads', async function() {
    class GameFactoryMock { get configReader() { return { configs: Promise.resolve([]) }; } }
    Lemmings.GameFactory = GameFactoryMock;
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let loaded = 0;
    view.loadLevel = () => { loaded++; };
    view.selectLevel(2);
    expect(view.levelIndex).to.equal(2);
    expect(loaded).to.equal(1);
  });
});
