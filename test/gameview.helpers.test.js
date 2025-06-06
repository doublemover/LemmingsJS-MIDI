import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';

// minimal GameFactory stub for constructor
class GameFactoryStub {
  constructor() {}
}

globalThis.lemmings = { game: { showDebug: false } };

function createWindow() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

describe('GameView helper methods', function () {
  beforeEach(function () {
    global.window = createWindow();
    global.history = { replaceState() {} };
    Lemmings.GameFactory = GameFactoryStub;
  });

  afterEach(function () {
    delete global.window;
    delete global.history;
  });

  it('parseNumber handles ranges and defaults', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const q1 = new URLSearchParams('');
    expect(view.parseNumber(q1, ['n'], 5, 1, 10)).to.equal(5);
    const q2 = new URLSearchParams('n=3');
    expect(view.parseNumber(q2, ['n'], 1, 1, 10)).to.equal(3);
    const q3 = new URLSearchParams('n=20');
    expect(view.parseNumber(q3, ['n'], 1, 1, 10)).to.equal(1);
    const q4 = new URLSearchParams('b=2');
    expect(view.parseNumber(q4, ['a', 'b'], 0, 1, 10, 2)).to.equal(4);
  });

  it('parseBool interprets presence and defaults', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const q1 = new URLSearchParams('');
    expect(view.parseBool(q1, ['f'], true)).to.equal(true);
    const q2 = new URLSearchParams('f=true');
    expect(view.parseBool(q2, ['f'])).to.equal(true);
    const q3 = new URLSearchParams('f=false');
    expect(view.parseBool(q3, ['f'], true)).to.equal(false);
    const q4 = new URLSearchParams('b=true');
    expect(view.parseBool(q4, ['a', 'b'])).to.equal(true);
  });

  it('strToNum converts strings to numbers', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.strToNum('5')).to.equal(5);
    expect(view.strToNum('')).to.equal(0);
    expect(view.strToNum('abc')).to.equal(0);
    expect(view.strToNum('-3')).to.equal(-3);
    expect(view.strToNum(' 8 ')).to.equal(8);
  });

  it('updateQuery writes parameters to history', async function () {
    let url = null;
    global.history.replaceState = (s, t, u) => { url = u; };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameType = 2;
    view.levelGroupIndex = 1;
    view.levelIndex = 5;
    view.gameSpeedFactor = 3;
    view.cheat = true;
    view.debug = true;
    view.bench = true;
    view.nukeAfter = 20;
    view.extraLemmings = 50;
    view.scale = 2;
    view.updateQuery();
    const params = new URLSearchParams(url.slice(1));
    expect(params.get('version')).to.equal('2');
    expect(params.get('difficulty')).to.equal('2');
    expect(params.get('level')).to.equal('6');
    expect(params.get('speed')).to.equal('3');
    expect(params.get('cheat')).to.equal('true');
    expect(params.get('debug')).to.equal('true');
    expect(params.get('bench')).to.equal('true');
    expect(params.get('nukeAfter')).to.equal('2');
    expect(params.get('extra')).to.equal('50');
    expect(params.get('scale')).to.equal('2');
    expect(params.has('endless')).to.be.false;
  });
});

describe('moveToLevel transitions', function () {
  const configs = {
    1: {
      level: {
        order: [[0], [0]],
        getGroupLength(i) { return this.order[i].length; }
      }
    },
    2: {
      level: {
        order: [[0]],
        getGroupLength(i) { return this.order[i].length; }
      }
    }
  };
  let requests;
  class GameFactoryMock {
    constructor() {}
    async getConfig(type) { return configs[type]; }
    async getGameResources(type) { requests.push(type); return {}; }
    get configReader() { return { configs: Promise.resolve([]) }; }
  }
  beforeEach(function () {
    requests = [];
    global.window = createWindow();
    global.history = { replaceState() {} };
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { TYPE1: 0, TYPE2: 1 };
    configs[1].level.order = [[0], [0]];
    configs[2].level.order = [[0]];
  });
  afterEach(function () {
    delete global.window;
    delete global.history;
  });

  it('advances to next group when level exceeds group length', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.loadLevel = async () => {};
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(1);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.levelIndex).to.equal(0);
    expect(view.gameType).to.equal(1);
    expect(requests).to.eql([]);
  });

  it('advances to next game type when past last group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.loadLevel = async () => {};
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    configs[1].level.order = [[0]]; // single group
    await view.moveToLevel(1);
    expect(view.gameType).to.equal(2);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(requests).to.eql([2]);
  });

  it('moves to previous group when level goes negative', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.loadLevel = async () => {};
    view.levelIndex = 0;
    view.levelGroupIndex = 1;
    view.gameType = 1;
    await view.moveToLevel(-1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
  });
});
