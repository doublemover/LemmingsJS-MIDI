import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';
import '../js/CommandSelectSkill.js';
import '../js/CommandLemmingsAction.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('KeyboardShortcuts', function() {
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
});
