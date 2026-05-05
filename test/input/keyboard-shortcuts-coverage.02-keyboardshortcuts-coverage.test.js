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

  it('keeps zoom input active when the first frame has no elapsed time', function() {
    const { view } = createFixture();
    const shortcuts = new KeyboardShortcuts(view);
    shortcuts.zoom.dir = 1;
    shortcuts._startLoop();

    const firstFrame = globals.rafCallbacks.shift();
    firstFrame(0);
    expect(view.stage.redraws).to.equal(0);
    expect(globals.rafCallbacks).to.have.lengthOf(1);

    globals.rafCallbacks.shift()(16.666);
    expect(view.stage.redraws).to.be.greaterThan(0);
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
