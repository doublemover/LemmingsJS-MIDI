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

  it('changeHtmlText updates innerText if element provided', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const el = { innerText: 'old' };
    view.changeHtmlText(el, 'new');
    expect(el.innerText).to.equal('new');
    view.changeHtmlText(null, 'ignored');
    expect(el.innerText).to.equal('new');
  });

  it('prefixNumbers adds numeric prefixes', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const result = view.prefixNumbers(['A', 'B']);
    expect(result).to.eql(['1 - A', '2 - B']);
  });

  it('second strToNum parses integers and invalid values', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.strToNum('10')).to.equal(10);
    expect(view.strToNum('2.6')).to.equal(2);
    expect(view.strToNum('foo')).to.equal(0);
  });

  it('clearHtmlList removes all options from a select', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const select = { options: [1, 2, 3], remove(i) { this.options.splice(i, 1); } };
    view.clearHtmlList(select);
    expect(select.options).to.have.lengthOf(0);
  });

  it('arrayToSelect populates a select element', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const select = {
      options: [],
      remove(i) { this.options.splice(i, 1); },
      appendChild(el) { this.options.push(el); }
    };
    global.document = { createElement() { return {}; } };
    view.arrayToSelect(select, ['Alice', 'Bob']);
    expect(select.options).to.have.lengthOf(2);
    expect(select.options[0].textContent).to.equal('Alice');
    expect(select.options[0].value).to.equal('0');
    expect(select.options[1].textContent).to.equal('Bob');
    expect(select.options[1].value).to.equal('1');
    delete global.document;
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

  it('setHistoryState writes URL with ? prefix', async function () {
    let url = null;
    global.history.replaceState = (s, t, u) => { url = u; };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.setHistoryState(new URLSearchParams('a=1'));
    expect(url).to.equal('?a=1');
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
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(1);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.levelIndex).to.equal(0);
    expect(view.gameType).to.equal(1);
    expect(requests).to.eql([]);
    expect(calls).to.equal(1);
  });

  it('advances to next game type when past last group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    configs[1].level.order = [[0]]; // single group
    await view.moveToLevel(1);
    expect(view.gameType).to.equal(2);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(requests).to.eql([2]);
    expect(calls).to.equal(1);
  });

  it('moves to previous group when level goes negative', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 1;
    view.gameType = 1;
    await view.moveToLevel(-1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(calls).to.equal(1);
  });

  it('ignores backward move from the first level of the first group', async function () {
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

  it('resets invalid game type and reloads resources', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let calls = 0;
    view.loadLevel = async () => { calls++; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 2; // not in GameTypes keys
    await view.moveToLevel(0);
    expect(view.gameType).to.equal(1);
    expect(view.levelGroupIndex).to.equal(0);
    expect(view.levelIndex).to.equal(0);
    expect(calls).to.equal(1);
    expect(requests).to.eql([1]);
  });
});
