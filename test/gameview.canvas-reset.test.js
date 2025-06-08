import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

function createWindowStub() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addCalls: [],
    removeCalls: [],
    addEventListener(type, handler) { this.addCalls.push([type, handler]); },
    removeEventListener(type, handler) { this.removeCalls.push([type, handler]); }
  };
}

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() { this.disposeCalled = 0; }
  updateStageSize() {}
  dispose() { this.disposeCalled++; }
}
class GameFactoryStub { constructor() {} }

describe('GameView canvas reset', function() {
  before(function() {
    this.origStage = Lemmings.Stage;
    this.origKeyboard = Lemmings.KeyboardShortcuts;
    this.origFactory = Lemmings.GameFactory;
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryStub;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  after(function() {
    delete global.lemmings;
    Lemmings.Stage = this.origStage;
    Lemmings.KeyboardShortcuts = this.origKeyboard;
    Lemmings.GameFactory = this.origFactory;
  });

  it('disposes old stage and listeners when canvas replaced', async function() {
    const win = createWindowStub();
    global.window = win;
    global.history = { replaceState() {} };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();

    const canvas1 = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
    };
    view.gameCanvas = canvas1;
    const stage1 = view.stage;
    const resize1 = win.addCalls.find(e => e[0] === 'resize')[1];

    const canvas2 = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 20, height: 20 }; }
    };
    view.gameCanvas = canvas2;
    const stage2 = view.stage;
    const resize2 = win.addCalls.find((e, i) => e[0] === 'resize' && i >= 1)[1];

    expect(stage1.disposeCalled).to.equal(1);
    expect(win.removeCalls).to.deep.include.members([
      ['resize', resize1],
      ['orientationchange', resize1]
    ]);
    expect(stage2).to.not.equal(stage1);
    const resizeCalls = win.addCalls.filter(c => c[0] === 'resize');
    const orientCalls = win.addCalls.filter(c => c[0] === 'orientationchange');
    expect(resizeCalls).to.have.lengthOf(2);
    expect(orientCalls).to.have.lengthOf(2);
    expect(resizeCalls[1][1]).to.not.equal(resize1);
    expect(orientCalls[1][1]).to.not.equal(resize1);

    delete global.window;
    delete global.history;
  });
});
