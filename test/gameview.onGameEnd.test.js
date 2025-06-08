import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/GameStateTypes.js';
import fakeTimers from '@sinonjs/fake-timers';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() {
    this.fadeCalls = 0;
    this.guiImgProps = { x: 0, y: 0, viewPoint: { scale: 1 } };
    this.startFadeOut = () => { this.fadeCalls++; };
  }
  getGameDisplay() { return {}; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
}

describe('GameView onGameEnd', function() {
  let origStage;
  let origKeyboard;
  let clock;
  let origTimeout;
  let origClear;
  before(function() {
    global.window = { location:{ search:'' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
    origStage = Lemmings.Stage;
    origKeyboard = Lemmings.KeyboardShortcuts;
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    global.lemmings = { game: { showDebug: false } };
  });
  after(function() {
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.KeyboardShortcuts = origKeyboard;
  });
  beforeEach(function() {
    clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    origTimeout = window.setTimeout;
    origClear = window.clearTimeout;
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
  });
  afterEach(function() {
    clock.uninstall();
    window.setTimeout = origTimeout;
    window.clearTimeout = origClear;
  });

  it('moves to next level after success', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.stage = new StageMock();
    let arg = null;
    view.moveToLevel = inc => { arg = inc; };
    view.onGameEnd({ state: Lemmings.GameStateTypes.SUCCEEDED });
    expect(view.stage.fadeCalls).to.equal(1);
    clock.tick(2500);
    expect(arg).to.equal(1);
  });

  it('retries level after failure', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.stage = new StageMock();
    let arg = null;
    view.moveToLevel = inc => { arg = inc; };
    view.onGameEnd({ state: Lemmings.GameStateTypes.FAILED_OUT_OF_TIME });
    expect(view.stage.fadeCalls).to.equal(1);
    clock.tick(2500);
    expect(arg).to.equal(0);
  });
});
