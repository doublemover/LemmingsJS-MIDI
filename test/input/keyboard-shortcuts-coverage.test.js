import { expect } from 'chai';
import { KeyboardShortcuts } from '../../js/input/KeyboardShortcuts.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { LemmingStateType } from '../../js/lemmings/LemmingStateType.js';

const setupGlobals = () => {
  const originals = {
    window: globalThis.window,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  const listeners = new Map();
  const rafCallbacks = [];
  let now = 0;
  globalThis.window = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    requestAnimationFrame(cb) {
      return globalThis.requestAnimationFrame(cb);
    },
    cancelAnimationFrame(id) {
      return globalThis.cancelAnimationFrame(id);
    }
  };
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = (cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  return {
    originals,
    listeners,
    rafCallbacks,
    setNow(value) { now = value; }
  };
};

const restoreGlobals = (originals) => {
  globalThis.window = originals.window;
  globalThis.performance = originals.performance;
  globalThis.requestAnimationFrame = originals.requestAnimationFrame;
  globalThis.cancelAnimationFrame = originals.cancelAnimationFrame;
};

const createFixture = () => {
  const queue = [];
  const gameGui = {
    releaseRateChanged: false,
    skillSelectionChanged: false,
    gameTimeChanged: false,
    drawSpeedChangeCalls: 0,
    drawSpeedChange() { this.drawSpeedChangeCalls += 1; }
  };
  const timer = {
    speedFactor: 1,
    toggleCalls: 0,
    toggle() { this.toggleCalls += 1; },
    isRunning() { return false; }
  };
  const skills = {
    selectedSkill: SkillTypes.CLIMBER,
    getSelectedSkill() { return this.selectedSkill; }
  };
  const manager = {
    lemmings: [],
    actions: [],
    getLemmings() { return this.lemmings; },
    getSelectedLemming() { return { id: 7 }; },
    setLemmingState(lem, state) {
      lem.action = state;
      this.setCalls = (this.setCalls || 0) + 1;
    }
  };
  const vc = {
    getCurrentReleaseRate: () => 5,
    getMinReleaseRate: () => 1,
    getMaxReleaseRate: () => 10
  };
  const timeTravel = {
    isReversing: false,
    toggleReverseCalls: 0,
    stopReverseCalls: 0,
    toggleReverse() { this.toggleReverseCalls += 1; },
    stopReverse() { this.stopReverseCalls += 1; }
  };
  const game = {
    timeTravel,
    gameGui,
    showDebug: false,
    queueCommand(cmd) { queue.push(cmd); },
    getGameTimer() { return timer; },
    getGameSkills() { return skills; },
    getLemmingManager() { return manager; },
    getVictoryCondition() { return vc; }
  };
  const stage = {
    gameImgProps: {
      viewPoint: { x: 0, y: 0, scale: 1 },
      canvasViewportSize: { width: 100, height: 50 }
    },
    _rawScale: 1,
    redraws: 0,
    applyViewport(img, x, y, rawScale) {
      img.viewPoint.x = x;
      img.viewPoint.y = y;
      img.viewPoint.scale = this.snapScale(rawScale);
    },
    redraw() { this.redraws += 1; },
    limitValue(min, value, max) {
      return Math.min(max, Math.max(min, value));
    },
    snapScale(value) { return value; }
  };
  const view = {
    game,
    stage,
    gameSpeedFactor: 1,
    levelGroupIndex: 0,
    gameType: 1,
    elementSelectLevelGroup: { options: [1, 2, 3] },
    gameResources: { getLevelGroups: () => [1, 2] },
    moveToLevelCalls: [],
    moveToLevel(idx) { this.moveToLevelCalls.push(idx); },
    selectLevelGroupCalls: [],
    selectLevelGroup(idx) { this.selectLevelGroupCalls.push(idx); },
    selectGameTypeCalls: [],
    selectGameType(idx) { this.selectGameTypeCalls.push(idx); },
    nextFrameCalls: 0,
    nextFrame() { this.nextFrameCalls += 1; },
    prevFrameCalls: 0,
    prevFrame() { this.prevFrameCalls += 1; },
    toggleEditorModeCalls: 0,
    toggleEditorMode() { this.toggleEditorModeCalls += 1; },
    shortcutOverlay: { toggles: 0, toggle() { this.toggles += 1; } },
    getMidiConfig() { return { reverse: { allNotesOffOnToggle: true } }; },
    midiRouter: {
      scheduler: {
        allNotesOffCalls: 0,
        clearQueueCalls: 0,
        allNotesOff() { this.allNotesOffCalls += 1; },
        clearQueue() { this.clearQueueCalls += 1; }
      },
      mapping: { config: { reverse: { allNotesOffOnToggle: true } } }
    }
  };

  manager.actions[LemmingStateType.EXPLODING] = 'explode';
  manager.actions[LemmingStateType.OHNO] = 'ohno';
  manager.lemmings = [
    { removed: true },
    { removed: false, hasExploded: true },
    { removed: false, hasExploded: false, countdownAction: {} },
    { removed: false, hasExploded: false, countdownAction: null, action: 'explode' },
    { removed: false, hasExploded: false, countdownAction: null, action: 'ohno' },
    { removed: false, hasExploded: false, countdownAction: null, action: null }
  ];

  return { view, game, queue, timer, skills, manager, vc, timeTravel, gameGui, stage };
};

describe('KeyboardShortcuts coverage', function() {
  let globals;

  beforeEach(function() {
    globals = setupGlobals();
  });

  afterEach(function() {
    restoreGlobals(globals.originals);
  });

  it('executes action handlers with active game state', function() {
    const { view, game, timer, skills, manager } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    const actions = shortcuts._actions;
    shortcuts._isGameplayBlocked = () => false;

    actions.releaseRateDown.down();
    actions.releaseRateUp.down();

    game.getVictoryCondition = () => ({
      getCurrentReleaseRate: () => 5,
      getMinReleaseRate: () => 1
    });
    actions.releaseRateDownMax.down();
    game.getVictoryCondition = () => ({
      getCurrentReleaseRate: () => 1,
      getMinReleaseRate: () => 1
    });
    actions.releaseRateDownMax.down();

    game.getVictoryCondition = () => ({
      getCurrentReleaseRate: () => 1,
      getMaxReleaseRate: () => 5
    });
    actions.releaseRateUpMax.down();
    game.getVictoryCondition = () => ({ getCurrentReleaseRate: () => 999 });
    actions.releaseRateUpMax.down();

    [
      'selectSkillClimber',
      'selectSkillFloater',
      'selectSkillBomber',
      'selectSkillBlocker',
      'selectSkillBuilder',
      'selectSkillBasher',
      'selectSkillMiner',
      'selectSkillDigger'
    ].forEach((name) => actions[name].down());

    game.timeTravel.isReversing = true;
    actions.togglePause.down();
    game.timeTravel.isReversing = false;
    actions.togglePause.down();

    timer.isRunning = () => true;
    actions.stepForward.down();
    actions.stepBackward.down();
    timer.isRunning = () => false;
    actions.stepForward.down();
    actions.stepBackward.down();

    view.getMidiConfig = () => ({ reverse: { allNotesOffOnToggle: true } });
    actions.toggleReverse.down();
    view.getMidiConfig = null;
    view.midiRouter.mapping.config.reverse.allNotesOffOnToggle = false;
    actions.toggleReverse.down();

    actions.nuke.down();
    actions.nukeInstant.down();
    actions.restartLevel.down();

    shortcuts.pan.vx = 1;
    actions.panLeft.down();
    shortcuts.pan.vx = 0;
    actions.panLeft.down();
    actions.panLeft.up();

    shortcuts.pan.vx = -1;
    actions.panRight.down();
    shortcuts.pan.vx = 0;
    actions.panRight.down();
    actions.panRight.up();

    shortcuts.pan.vy = 1;
    actions.panUp.down();
    shortcuts.pan.vy = 0;
    actions.panUp.down();
    actions.panUp.up();

    shortcuts.pan.vy = -1;
    actions.panDown.down();
    shortcuts.pan.vy = 0;
    actions.panDown.down();
    actions.panDown.up();

    actions.panBoost.down();
    actions.panBoost.up();

    actions.zoomIn.down();
    shortcuts.zoom.dir = 1;
    actions.zoomIn.up();
    shortcuts.zoom.dir = 0;
    actions.zoomIn.up();

    actions.zoomOut.down();
    shortcuts.zoom.dir = -1;
    actions.zoomOut.up();
    shortcuts.zoom.dir = 1;
    actions.zoomOut.up();

    actions.zoomReset.down();

    skills.selectedSkill = SkillTypes.DIGGER;
    actions.cycleSkillNext.down();
    skills.selectedSkill = SkillTypes.CLIMBER;
    actions.cycleSkillPrev.down();

    manager.getSelectedLemming = () => null;
    actions.applySkillToSelected.down();
    manager.getSelectedLemming = () => ({ id: 7 });
    actions.applySkillToSelected.down();

    actions.toggleDebug.down();

    timer.speedFactor = 0.5;
    actions.speedUp.down();
    timer.speedFactor = 1.2;
    actions.speedUp.down();
    timer.speedFactor = 2;
    actions.speedDown.down();
    timer.speedFactor = 0.5;
    actions.speedDownFast.down();

    actions.levelPrev.down();
    actions.levelNext.down();

    view.levelGroupIndex = 1;
    actions.levelGroupPrev.down();
    view.levelGroupIndex = 0;
    view.gameType = 2;
    actions.levelGroupPrev.down();
    view.gameType = 1;
    actions.levelGroupPrev.down();

    view.levelGroupIndex = 0;
    actions.levelGroupNext.down();
    view.levelGroupIndex = 2;
    actions.levelGroupNext.down();
    view.elementSelectLevelGroup = null;
    actions.levelGroupNext.down();

    actions.editorToggle.down();
    view.toggleEditorMode = null;
    actions.editorToggle.down();

    actions.toggleShortcutOverlay.down();

    shortcuts.dispose();
  });

  it('covers early returns for blocked and missing game states', function() {
    const { view } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    const actions = shortcuts._actions;

    shortcuts._isGameplayBlocked = () => true;
    actions.releaseRateDown.down();
    actions.releaseRateDownMax.down();
    actions.releaseRateUp.down();
    actions.releaseRateUpMax.down();
    actions.nuke.down();
    actions.nukeInstant.down();
    actions.cycleSkillNext.down();
    actions.cycleSkillPrev.down();
    actions.applySkillToSelected.down();
    shortcuts._selectSkill(SkillTypes.CLIMBER);
    shortcuts._instantNuke();

    view.game = null;
    shortcuts._isGameplayBlocked = () => false;
    actions.releaseRateDown.down();
    actions.releaseRateDownMax.down();
    actions.releaseRateUp.down();
    actions.releaseRateUpMax.down();
    actions.togglePause.down();
    actions.toggleDebug.down();
    shortcuts._selectSkill(SkillTypes.CLIMBER);
    shortcuts._changeSpeed(1, false);

    shortcuts.dispose();
  });

  it('handles key event filtering and action dispatch', function() {
    const { view } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    shortcuts._isGameplayBlocked = () => false;
    shortcuts.keybindings.getActionsForEvent = () => ['panBoost', 'toggleDebug'];

    const prevented = [];
    const event = {
      preventDefault() { prevented.push('down'); },
      target: { tagName: 'DIV' }
    };
    shortcuts._onKeyDown(event);
    shortcuts.keybindings.getActionsForEvent = () => [];
    shortcuts._onKeyDown({
      preventDefault() {},
      target: { tagName: 'DIV' }
    });
    shortcuts._onKeyUp({ preventDefault() {} });

    shortcuts.keybindings.getActionsForEvent = () => ['panLeft'];
    shortcuts._onKeyDown({
      preventDefault() {},
      target: { tagName: 'INPUT' }
    });

    shortcuts.keybindings.getActionsForEvent = () => ['panBoost', 'toggleDebug'];
    shortcuts._onKeyUp({
      preventDefault() { prevented.push('up'); }
    });
    expect(prevented.length).to.equal(1);

    const inputEvent = {
      preventDefault() {},
      target: { tagName: 'INPUT' }
    };
    shortcuts._onKeyDown(inputEvent);

    const selectEvent = {
      target: { tagName: 'SELECT' }
    };
    expect(shortcuts._shouldIgnoreKey(selectEvent, ['toggleReverse'])).to.equal(false);
    expect(shortcuts._shouldIgnoreKey(selectEvent, ['nuke'])).to.equal(true);
    expect(shortcuts._shouldIgnoreKey({ target: { isContentEditable: true } })).to.equal(true);

    expect(shortcuts._handleAction('missing', 'down')).to.equal(false);
    expect(shortcuts._handleAction('toggleDebug', 'up')).to.equal(false);
    expect(shortcuts._handleAction('panBoost', 'down')).to.equal(false);
    expect(shortcuts._handleAction('panLeft', 'up')).to.equal(true);
    expect(shortcuts._shouldIgnoreKey({})).to.equal(false);

    shortcuts.dispose();
  });

  it('supports speed adjustments when gameGui is unavailable', function() {
    const { view, timer } = createFixture();
    view.game.gameGui = null;
    const shortcuts = new KeyboardShortcuts(view);
    timer.speedFactor = 1;
    shortcuts._isGameplayBlocked = () => false;
    const actions = shortcuts._actions;

    actions.speedUp.down();
    expect(timer.speedFactor).to.equal(2);

    actions.speedUpFast.down();
    expect(timer.speedFactor).to.equal(7);

    actions.speedDown.down();
    expect(timer.speedFactor).to.equal(6);

    actions.speedDownFast.down();
    expect(timer.speedFactor).to.equal(1);
    shortcuts.dispose();
  });

  it('ignores speed changes when game timer is unavailable', function() {
    const { view } = createFixture();
    view.game.getGameTimer = () => null;
    const shortcuts = new KeyboardShortcuts(view);
    shortcuts._isGameplayBlocked = () => false;
    const actions = shortcuts._actions;

    const before = view.gameSpeedFactor;
    expect(() => actions.speedUp.down()).to.not.throw();
    expect(() => actions.speedDown.down()).to.not.throw();
    expect(view.gameSpeedFactor).to.equal(before);
    shortcuts.dispose();
  });

  it('loads keybindings when available', async function() {
    const { view } = createFixture();
    const requested = [];
    view.gameFactory = {
      fileProvider: {
        loadString(name) {
          requested.push(name);
          return Promise.resolve(JSON.stringify({ version: 2, bindings: { toggleDebug: ['KeyZ'] } }));
        }
      }
    };
    const shortcuts = new KeyboardShortcuts(view);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(requested).to.include('keybindings.json');
    expect(requested).to.include('gamepadbindings.json');
    expect(shortcuts.keybindings.config.version).to.equal(2);
    shortcuts.dispose();
  });

  it('ignores invalid keybinding config payloads', async function() {
    const { view } = createFixture();
    view.gameFactory = {
      fileProvider: {
        loadString() {
          return Promise.resolve('{bad');
        }
      }
    };
    const shortcuts = new KeyboardShortcuts(view);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(shortcuts.keybindings.config).to.be.ok;
    shortcuts.dispose();
  });

  it('steps pan/zoom loop and handles blocked checks', function() {
    const { view, timeTravel } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    timeTravel.isReversing = true;
    expect(shortcuts._isGameplayBlocked()).to.equal(true);
    timeTravel.isReversing = false;
    expect(shortcuts._isGameplayBlocked()).to.equal(false);

    shortcuts.pan.right = true;
    shortcuts.pan.changed = true;
    shortcuts.zoom.dir = 1;
    shortcuts._startLoop();
    globals.rafCallbacks.shift()(16.666);

    shortcuts.zoom.reset = view.stage.gameImgProps.viewPoint.scale;
    shortcuts.pan.left = false;
    shortcuts.pan.right = false;
    shortcuts.pan.vx = 0;
    shortcuts.pan.vy = 0;
    shortcuts.zoom.dir = 0;
    shortcuts._step(33.333);

    view.stage = null;
    shortcuts._step(50);

    shortcuts.dispose();
  });

  it('resets zoom and formats display bindings', function() {
    const globals = setupGlobals();
    const { view } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    shortcuts.keybindings.setConfig({
      version: 1,
      bindings: { toggleDebug: ['KeyZ'] }
    });
    const bindings = shortcuts.getDisplayBindings('toggleDebug');
    expect(bindings.length).to.equal(1);

    shortcuts.zoom.reset = view.stage.gameImgProps.viewPoint.scale;
    shortcuts.zoom.v = 0;
    shortcuts.zoom.dir = 0;
    shortcuts._step(16.666);
    expect(shortcuts.zoom.reset).to.equal(null);
    expect(shortcuts.zoom.v).to.equal(0);

    shortcuts.mod.shift = true;
    shortcuts.zoom.dir = 1;
    shortcuts._step(33.333);

    shortcuts.zoom.dir = 0;
    shortcuts.zoom.reset = null;
    shortcuts.zoom.v = 0;
    shortcuts._step(50);
    shortcuts.dispose();
    restoreGlobals(globals.originals);
  });

  it('handles keyup actions and level group fallbacks', function() {
    const { view } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    view.elementSelectLevelGroup = null;
    view.selectLevelGroup = (idx) => { view.selected = idx; };
    shortcuts._actions.levelGroupNext.down();
    expect(view.selected).to.equal(1);

    shortcuts.keybindings.getActionsForEvent = () => ['panLeft'];
    let prevented = false;
    shortcuts._onKeyUp({ preventDefault() { prevented = true; } });
    expect(prevented).to.equal(true);
    shortcuts.dispose();
  });
});
