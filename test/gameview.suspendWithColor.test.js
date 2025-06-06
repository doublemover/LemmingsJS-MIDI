import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import fakeTimers from '@sinonjs/fake-timers';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() {
    this.guiImgProps = { x: 10, y: 20, viewPoint: { scale: 2 } };
  }
  getGameDisplay() { return {}; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  startFadeOut() {}
  startOverlayFade(color, rect) { this.called = { color, rect }; }
}
class GameFactoryMock {
  async getGame() { return {}; }
  async getGameResources() { return {}; }
  get configReader() { return { configs: Promise.resolve([]) }; }
}

describe('GameView suspendWithColor', function() {
  let origStage;
  let origKeyboard;
  let origFactory;
  before(function() {
    global.window = { location: { search: '' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
    origStage = Lemmings.Stage;
    origKeyboard = Lemmings.KeyboardShortcuts;
    origFactory = Lemmings.GameFactory;
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });
  after(function() {
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.KeyboardShortcuts = origKeyboard;
    Lemmings.GameFactory = origFactory;
  });

  it('passes pause button rect in bench mode', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.bench = true;
    view.gameCanvas = {};
    view.game = { getGameTimer() { return { suspend() {}, continue() {} }; } };
    const stage = view.stage;

    view.suspendWithColor('red');

    const expected = {
      x: stage.guiImgProps.x + 160 * stage.guiImgProps.viewPoint.scale,
      y: stage.guiImgProps.y + 32 * stage.guiImgProps.viewPoint.scale,
      width: 16 * stage.guiImgProps.viewPoint.scale,
      height: 10 * stage.guiImgProps.viewPoint.scale
    };
    expect(stage.called.rect).to.deep.equal(expected);
  });

  it('resumes timer after overlay fade', async function() {
    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    const timer = { suspendCalled: 0, continueCalled: 0, suspend() { this.suspendCalled++; }, continue() { this.continueCalled++; } };
    view.game = { getGameTimer() { return timer; } };

    view.suspendWithColor('red');
    expect(timer.suspendCalled).to.equal(1);
    clock.tick(2000);
    expect(timer.continueCalled).to.equal(1);
    clock.uninstall();
  });
});
