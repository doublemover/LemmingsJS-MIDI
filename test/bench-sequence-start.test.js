import '../js/MapObject.js';
import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

import '../js/Lemming.js';
before(function(){
  class StageStub { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} }
  class KeyboardShortcutsStub { constructor(){} dispose(){} }
  Lemmings.Stage = StageStub;
  Lemmings.KeyboardShortcuts = KeyboardShortcutsStub;
  global.window = globalThis.window = { setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){} };
  global.document = globalThis.document = { visibilityState:'visible', hasFocus(){return true;}, createElement(){ return { appendChild(){}, options:[], remove(){} }; }, addEventListener(){}, removeEventListener(){} };
});

after(function(){
  delete global.window;
  delete global.document;
  delete Lemmings.Stage;
  delete Lemmings.KeyboardShortcuts;
});

describe('benchSequenceStart', function() {
  it('computes extras and starts bench with first count', async function() {
    const { GameView } = await import('../js/GameView.js');
    Lemmings.Stage = class { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} };
    Lemmings.KeyboardShortcuts = class { constructor(){} dispose(){} };
    const view = new GameView();
    let called = 0;
    view.benchMeasureExtras = async () => 4;
    view.benchStart = async cnt => { called = cnt; };
    view.gameResources = { getLevelGroups() { return ['grp']; } };
    view.configs = [{ gametype: view.gameType, name: 'test' }];
    view.levelGroupIndex = 0;
    await view.benchSequenceStart();
    expect(called).to.equal(50);
    expect(view.extraLemmings).to.equal(4);
    expect(Lemmings.extraLemmings).to.equal(4);
    expect(view._benchBaseEntrances).to.equal(null);
    expect(view._benchEntrancePool).to.equal(null);
  });
});
