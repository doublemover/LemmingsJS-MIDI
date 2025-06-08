import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';

// stub KeyboardShortcuts to avoid DOM access
class KeyboardShortcutsMock { constructor() {} dispose() {} }

function createWindow(search = '') {
  return {
    location: { search },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

globalThis.lemmings = { game: { showDebug: false } };

describe('GameView.applyQuery and updateQuery', function () {
  beforeEach(function () {
    global.history = { replaceState() {} };
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
  });

  afterEach(function () {
    delete global.window;
    delete global.history;
  });

  it('parses cheat/debug flags and rounds speed factor', async function () {
    global.window = createWindow('?cheat=true&debug=true&speed=2.6');
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.cheatEnabled).to.equal(true);
    expect(view.debug).to.equal(true);
    expect(view.gameSpeedFactor).to.equal(3);
  });

  it('updateQuery writes short flag names when shortcut enabled', async function () {
    global.window = createWindow('?cheat=true&debug=true&speed=2.6');
    let url = null;
    global.history.replaceState = (s, t, u) => { url = u; };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.shortcut = true;
    view.updateQuery();
    const params = new URLSearchParams(url.slice(1));
    expect(params.get('c')).to.equal('true');
    expect(params.get('dbg')).to.equal('true');
    expect(params.get('s')).to.equal('3');
    expect(params.has('cheat')).to.be.false;
  });

  it('updateQuery uses long flag names by default', async function () {
    global.window = createWindow('?cheat=true&debug=true&speed=2.6');
    let url = null;
    global.history.replaceState = (s, t, u) => { url = u; };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.updateQuery();
    const params = new URLSearchParams(url.slice(1));
    expect(params.get('cheat')).to.equal('true');
    expect(params.get('debug')).to.equal('true');
    expect(params.get('speed')).to.equal('3');
    expect(params.has('c')).to.be.false;
  });
});

describe('GameView.moveToLevel offsets', function () {
  class GameFactoryMock {
    async getConfig() {
      return { level: { order: [[0, 0]], getGroupLength(i) { return this.order[i].length; } } };
    }
    async getGameResources() { return {}; }
    get configReader() { return { configs: Promise.resolve([]) }; }
  }

  beforeEach(function () {
    global.window = createWindow();
    global.history = { replaceState() {} };
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
  });

  afterEach(function () {
    delete global.window;
    delete global.history;
  });

  it('ignores negative offset at start of first group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    view.loadLevel = async () => { throw new Error('loadLevel called'); };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(-1);
    expect(view.levelIndex).to.equal(0);
  });

  it('advances to next level within group', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameFactory = new GameFactoryMock();
    let called = false;
    view.loadLevel = async () => { called = true; };
    view.levelIndex = 0;
    view.levelGroupIndex = 0;
    view.gameType = 1;
    await view.moveToLevel(1);
    expect(called).to.equal(true);
    expect(view.levelIndex).to.equal(1);
  });
});
