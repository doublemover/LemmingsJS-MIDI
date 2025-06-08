import '../js/MapObject.js';
import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
before(function(){class StageStub{constructor(){}getGameDisplay(){return{};}getGuiDisplay(){return{};}updateStageSize(){}setCursorSprite(){}clear(){}startFadeOut(){}startOverlayFade(){}}class KeyboardShortcutsStub{constructor(){}dispose(){}}Lemmings.Stage=StageStub;Lemmings.KeyboardShortcuts=KeyboardShortcutsStub;global.window=globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};global.document=globalThis.document={visibilityState:'visible',hasFocus(){return true;},createElement(){return {appendChild(){},options:[],remove(){}};},addEventListener(){},removeEventListener(){}};});
import '../js/Lemming.js';
after(function(){delete global.window;delete global.document;delete Lemmings.Stage;delete Lemmings.KeyboardShortcuts;});


describe('benchMeasureExtras', function() {
  it('resolves with extra count based on spawns', async function() {
    const { GameView } = await import('../js/GameView.js');
    Lemmings.Stage = class { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} };
    Lemmings.KeyboardShortcuts = class { constructor(){} dispose(){} };
    const timer = {
      speedFactor: 1,
      benchStartupFrames: 0,
      benchStableFactor: 1,
      TIME_PER_FRAME_MS: 60,
      _time: 0,
      handler: null,
      eachGameSecond: {
        on(h) { timer.handler = h; },
        off() { timer.handler = null; },
        trigger() { if (timer.handler) timer.handler(); }
      },
      getGameTime() { return this._time; },
      suspend() {}
    };
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
    if (!timer.handler) throw new Error('handler not set');
    for (let i = 0; i < 3; i++) {
      lm.spawnTotal += 10;
      timer._time = i + 1;
      timer.eachGameSecond.trigger();
    }
    timer.speedFactor = 0.9;
    timer.eachGameSecond.trigger();
    const extras = await promise;
    expect(extras).to.be.above(0);
    expect(view.extraLemmings).to.equal(extras);
  });
});
