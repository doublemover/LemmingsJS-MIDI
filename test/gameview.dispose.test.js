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

class KeyboardShortcutsMock {
  constructor() { this.disposeCalled = 0; }
  dispose() { this.disposeCalled++; }
}

class StageMock {
  constructor() { this.disposeCalled = 0; }
  updateStageSize() {}
  dispose() { this.disposeCalled++; }
}

class GameFactoryStub {
  constructor() {}
}

describe('GameView.dispose', function() {
  before(function() {
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryStub;
  });

  it('removes listeners and disposes stage and shortcuts', async function() {
    const win = createWindowStub();
    global.window = win;
    global.history = { replaceState() {} };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const canvas = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
    };
    view.gameCanvas = canvas;
    const stage = view.stage;
    const shortcuts = view.shortcuts;
    const resizeHandler = win.addCalls.find(e => e[0] === 'resize')[1];
    const orientHandler = win.addCalls.find(e => e[0] === 'orientationchange')[1];
    expect(resizeHandler).to.equal(orientHandler);

    view.dispose();

    expect(win.removeCalls).to.deep.include.members([
      ['resize', resizeHandler],
      ['orientationchange', orientHandler]
    ]);
    expect(stage.disposeCalled).to.equal(1);
    expect(shortcuts.disposeCalled).to.equal(1);
    delete global.window;
    delete global.history;
  });

  it('cleans up pre-registered stage listeners', async function() {
    const win = createWindowStub();
    global.window = win;
    global.history = { replaceState() {} };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const stage = new StageMock();
    const shortcuts = new KeyboardShortcutsMock();
    view.stage = stage;
    view.shortcuts = shortcuts;
    view._stageResize = () => {};
    win.addEventListener('resize', view._stageResize);
    win.addEventListener('orientationchange', view._stageResize);
    const resizeHandler = view._stageResize;

    view.dispose();

    expect(win.removeCalls).to.deep.include.members([
      ['resize', resizeHandler],
      ['orientationchange', resizeHandler]
    ]);
    expect(stage.disposeCalled).to.equal(1);
    expect(shortcuts.disposeCalled).to.equal(1);
    expect(view.stage).to.equal(null);
    expect(view.shortcuts).to.equal(null);
    delete global.window;
    delete global.history;
  });
});
