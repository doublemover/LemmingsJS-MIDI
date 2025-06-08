import '../js/MapObject.js';
import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import fakeTimers from '@sinonjs/fake-timers';
import '../js/Lemming.js';

before(function() {
  class StageStub { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} }
  class KeyboardShortcutsStub { constructor(){} dispose(){} }
  Lemmings.Stage = StageStub;
  Lemmings.KeyboardShortcuts = KeyboardShortcutsStub;
  global.window = globalThis.window = { setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){} };
  global.document = globalThis.document = { visibilityState:'visible', hasFocus(){return true;}, createElement(){return {appendChild(){},options:[],remove(){}};}, addEventListener(){}, removeEventListener(){} };
});

after(function() {
  delete global.window;
  delete global.document;
  delete Lemmings.Stage;
  delete Lemmings.KeyboardShortcuts;
});


describe('benchMeasureExtras', function() {
  it('resolves with extra count based on spawns', async function() {
    const { GameView } = await import('../js/GameView.js');
    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    Lemmings.Stage = class { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} };
    Lemmings.KeyboardShortcuts = class { constructor(){} dispose(){} };
    const timer = {
      speedFactor: 1,
      benchStartupFrames: 0,
      benchStableFactor: 1,
      TIME_PER_FRAME_MS: 60,
      _time: 0,
      eachGameSecond: new Lemmings.EventHandler(),
      getGameTime() { return this._time; },
      suspend() {}
    };
    const tickId = setInterval(() => {
      timer._time += 1;
      timer.eachGameSecond.trigger();
    }, 1000);

    const lm = { spawnTotal: 0, spawnCount: 0 };
    const view = new GameView();
    view.gameResources = { getLevelGroups() { return ['grp']; } };
    view.configs = [{ gametype: view.gameType, name: 'test' }];
    view.levelGroupIndex = 0;
    view.loadLevel = async () => {
      view.game = {
        level: { entrances: [{}, {}] },
        getLemmingManager: () => lm,
        getGameTimer: () => timer,
        getVictoryCondition: () => ({ getMinReleaseRate() { return 1; } })
      };
    };
    const promise = view.benchMeasureExtras();
    await Promise.resolve();
    for (let i = 0; i < 3; i++) {
      lm.spawnTotal += 10;
      clock.tick(1000);
    }
    timer.speedFactor = 0.9;
    clock.tick(1000);
    const extras = await promise;
    clearInterval(tickId);
    clock.uninstall();
    expect(extras).to.equal(7);
    expect(view.extraLemmings).to.equal(7);
  });
});
