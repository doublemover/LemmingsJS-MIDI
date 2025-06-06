import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';
import '../js/CommandSelectSkill.js';
import '../js/CommandLemmingsAction.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import fakeTimers from '@sinonjs/fake-timers';

globalThis.lemmings = { game: { showDebug: false } };

describe('KeyboardShortcuts', function() {
  function createStubCanvas(width = 800, height = 600) {
    const ctx = {
      canvas: { width, height },
      fillRect() {},
      drawImage() {},
      putImageData() {}
    };
    return {
      width,
      height,
      getContext() { return ctx; },
      addEventListener() {},
      removeEventListener() {}
    };
  }

  function createDocumentStub() {
    return {
      createElement() {
        const ctx = {
          canvas: {},
          fillRect() {},
          drawImage() {},
          putImageData() {},
          createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
        };
        return {
          width: 0,
          height: 0,
          getContext() { ctx.canvas = this; return ctx; }
        };
      }
    };
  }
  function createShortcuts(timer, manager, lemMgr = null) {

    const lm = lemMgr || { getSelectedLemming() { return { id: 1 }; }, setSelectedLemming() {} };
    const game = {
      commandManager: manager,
      gameGui: { drawSpeedChange() {}, skillSelectionChanged: false },
      getGameTimer() { return timer; },
      queueCommand(cmd) { manager.queueCommand(cmd); },
      getGameSkills() { return { getSelectedSkill() { return Lemmings.SkillTypes.CLIMBER; }, setSelectedSkill() {} }; },
      getLemmingManager() {
        return lemMgr || { getSelectedLemming() { return { id: 1 }; }, setSelectedLemming() {} };
      }
    };
    const view = { game, nextFrame() {}, prevFrame() {} };
    global.window = { addEventListener() {}, removeEventListener() {} };
    return new KeyboardShortcuts(view);
  }

  it('queues skill selection command', function() {
    const log = [];
    const manager = { queueCommand(cmd) { log.push(cmd); } };
    const timer = { speedFactor: 1 };
    const ks = createShortcuts(timer, manager);

    const evt = { code: 'Digit3', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(log).to.have.lengthOf(1);
    expect(log[0]).to.be.instanceOf(Lemmings.CommandSelectSkill);
    expect(log[0].skill).to.equal(Lemmings.SkillTypes.CLIMBER);
  });

  it('adjusts speed with Minus key', function() {
    const manager = { queueCommand() {} };
    const timer = { speedFactor: 2 };
    const ks = createShortcuts(timer, manager);

    const evt = { code: 'Minus', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(timer.speedFactor).to.be.below(2);
  });

  it('cycles skill with Tab without applying', function() {
    const log = [];
    const manager = { queueCommand(cmd) { log.push(cmd); } };
    const timer = { speedFactor: 1 };
    const ks = createShortcuts(timer, manager);

    const evt = { code: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(log).to.have.lengthOf(1);
    expect(log[0]).to.be.instanceOf(Lemmings.CommandSelectSkill);
    expect(log[0].apply).to.be.false;
  });

  it('cycles skill backward with Shift+Tab', function() {
    const log = [];
    const manager = { queueCommand(cmd) { log.push(cmd); } };
    const timer = { speedFactor: 1 };
    const ks = createShortcuts(timer, manager);

    const evt = { code: 'Tab', shiftKey: true, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(log).to.have.lengthOf(1);
    expect(log[0]).to.be.instanceOf(Lemmings.CommandSelectSkill);
    expect(log[0].apply).to.be.false;
  });

  it('assigns skill with KeyK', function() {
    const log = [];
    const manager = { queueCommand(cmd) { log.push(cmd); } };
    const timer = { speedFactor: 1 };
    const ks = createShortcuts(timer, manager);

    const evt = { code: 'KeyK', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(log).to.have.lengthOf(1);
    expect(log[0]).to.be.instanceOf(Lemmings.CommandLemmingsAction);
  });

  it('ignores KeyN for lemming selection', function() {
    const manager = { queueCommand() {} };
    let selected = 'foo';
    const lemMgr = { setSelectedLemming(arg) { selected = arg; } };
    const timer = { speedFactor: 1 };
    const ks = createShortcuts(timer, manager, lemMgr);

    const evt = { code: 'KeyN', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(selected).to.equal('foo');
  });

  it('steps forward one tick with BracketRight when paused', function() {
    let count = 0;
    const timer = {
      speedFactor: 1,
      isRunning() { return false; },
      tick() { count++; }
    };
    const ks = createShortcuts(timer, { queueCommand() {} });
    ks.view.nextFrame = () => { timer.tick(); };
    const evt = { code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(count).to.equal(1);
  });

  it('steps backward one tick with BracketLeft when paused', function() {
    let count = 0;
    const timer = {
      speedFactor: 1,
      isRunning() { return false; },
      tick(arg) { count += arg; }
    };
    const ks = createShortcuts(timer, { queueCommand() {} });
    ks.view.prevFrame = () => { timer.tick(-1); };
    const evt = { code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    expect(count).to.equal(-1);
  });

  it('pans right when ArrowRight held', function() {
    global.document = createDocumentStub();
    const canvas = createStubCanvas();
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};
    stage.redraw = () => {};
    stage.updateViewPoint = (img, dx, dy) => {
      img.viewPoint.x += dx / img.viewPoint.scale;
      img.viewPoint.y += dy / img.viewPoint.scale;
    };
    stage.getGameDisplay().initSize(1000, 1000);

    const timer = { speedFactor: 1, isRunning() { return true; } };
    const game = {
      commandManager: { queueCommand() {} },
      gameGui: {},
      getGameTimer() { return timer; },
      queueCommand() {},
      getGameSkills() { return { getSelectedSkill() { return Lemmings.SkillTypes.CLIMBER; }, setSelectedSkill() {} }; },
      getLemmingManager() { return { getSelectedLemming() { return { id: 1 }; }, setSelectedLemming() {} }; }
    };
    let raf;
    const win = globalThis;
    const origRAF = win.requestAnimationFrame;
    const origCancel = win.cancelAnimationFrame;
    win.addEventListener = () => {};
    win.removeEventListener = () => {};
    win.requestAnimationFrame = (cb) => { raf = cb; return 1; };
    win.cancelAnimationFrame = () => {};
    global.window = win;
    const view = { game, stage, nextFrame() {}, prevFrame() {} };
    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });

    const ks = new KeyboardShortcuts(view);
    const startX = stage.gameImgProps.viewPoint.x;

    const evt = { code: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    ks._onKeyDown(evt);
    clock.tick(16);
    raf(clock.now);
    expect(stage.gameImgProps.viewPoint.x).to.be.greaterThan(startX);
    clock.uninstall();
    win.requestAnimationFrame = origRAF;
    win.cancelAnimationFrame = origCancel;
    delete global.document;
    delete global.window;
  });
});
