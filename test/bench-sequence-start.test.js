import '../js/level/MapObject.js';
import { expect } from 'chai';
import { Lemmings, setDependency, clearDependency } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';

import '../js/lemmings/Lemming.js';
before(function(){
  class StageStub { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} }
  class KeyboardShortcutsStub { constructor(){} dispose(){} }
  setDependency('Stage', StageStub);
  setDependency('KeyboardShortcuts', KeyboardShortcutsStub);
  global.window = globalThis.window = { setTimeout, clearTimeout, addEventListener(){}, removeEventListener(){} };
  global.document = globalThis.document = { visibilityState:'visible', hasFocus(){return true;}, createElement(){ return { appendChild(){}, options:[], remove(){} }; }, addEventListener(){}, removeEventListener(){} };
});

after(function(){
  delete global.window;
  delete global.document;
  clearDependency('Stage');
  clearDependency('KeyboardShortcuts');
});

describe('benchSequenceStart', function() {
  it('computes extras and starts bench with first count', async function() {
    const { GameView } = await import('../js/game/GameView.js');
    setDependency('Stage', class { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} });
    setDependency('KeyboardShortcuts', class { constructor(){} dispose(){} });
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
