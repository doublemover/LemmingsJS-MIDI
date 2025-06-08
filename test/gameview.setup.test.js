import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

function createDocumentStub() {
  return {
    createElement() { return { textContent: '', value: '' }; },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createSelect() {
  return {
    options: [],
    selectedIndex: -1,
    remove(idx) { this.options.splice(idx, 1); },
    appendChild(el) { this.options.push(el); }
  };
}

describe('GameView setup', function() {
  before(function() {
    global.document = createDocumentStub();
    global.window = { location:{ search:'' }, setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){} };
    global.history = { replaceState() {} };
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  after(function() {
    delete global.document;
    delete global.window;
    delete global.history;
  });

  it('populates selects and runs bench sequence', async function() {
    const configs = [
      { name: 'alpha', gametype: 1, level: { order: [['a'], ['b']], getGroupLength(i){ return this.order[i].length; } } },
      { name: 'beta', gametype: 2, level: { order: [['a']], getGroupLength(i){ return this.order[i].length; } } }
    ];
    class GameFactoryMock {
      constructor() { this.configReader = { configs: Promise.resolve(configs) }; }
      async getConfig(type) { return configs.find(c => c.gametype === type); }
      async getGameResources(type) { return { getLevelGroups: () => ['g1', 'g2'] }; }
    }
    Lemmings.GameFactory = GameFactoryMock;

    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.applyQuery = () => { view.gameType = 1; view.levelGroupIndex = 0; };
    let populateCalled = 0; view.populateLevelSelect = async () => { populateCalled++; };
    let loadCalled = 0; view.loadLevel = async () => { loadCalled++; };
    let benchCalled = 0; view.benchSequenceStart = async () => { benchCalled++; };
    view.elementSelectGameType = createSelect();
    view.elementSelectLevelGroup = createSelect();
    view.elementSelectLevel = createSelect();
    view.benchSequence = true;

    await view.setup();

    expect(populateCalled).to.equal(1);
    expect(loadCalled).to.equal(1);
    expect(benchCalled).to.equal(1);
    expect(view.elementSelectGameType.options.length).to.equal(configs.length);
    expect(view.elementSelectLevelGroup.options.length).to.equal(2);
  });

  it('skips bench sequence when flag disabled', async function() {
    const configs = [
      { name: 'alpha', gametype: 1, level: { order: [['a'], ['b']], getGroupLength(i){ return this.order[i].length; } } },
      { name: 'beta', gametype: 2, level: { order: [['a']], getGroupLength(i){ return this.order[i].length; } } }
    ];
    class GameFactoryMock {
      constructor() { this.configReader = { configs: Promise.resolve(configs) }; }
      async getConfig(type) { return configs.find(c => c.gametype === type); }
      async getGameResources(type) { return { getLevelGroups: () => ['g1', 'g2'] }; }
    }
    Lemmings.GameFactory = GameFactoryMock;

    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.applyQuery = () => { view.gameType = 1; view.levelGroupIndex = 0; };
    let populateCalled = 0; view.populateLevelSelect = async () => { populateCalled++; };
    let loadCalled = 0; view.loadLevel = async () => { loadCalled++; };
    let benchCalled = 0; view.benchSequenceStart = async () => { benchCalled++; };
    view.elementSelectGameType = createSelect();
    view.elementSelectLevelGroup = createSelect();
    view.elementSelectLevel = createSelect();
    view.benchSequence = false;

    await view.setup();

    expect(populateCalled).to.equal(1);
    expect(loadCalled).to.equal(1);
    expect(benchCalled).to.equal(0);
    expect(view.elementSelectGameType.options.length).to.equal(configs.length);
    expect(view.elementSelectLevelGroup.options.length).to.equal(2);
  });
});
