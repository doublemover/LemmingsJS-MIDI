import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { Level } from '../js/level/Level.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingManager } from '../js/lemmings/LemmingManager.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import '../js/LemmingsBootstrap.js';

const spriteStub = {
  getAnimation() {
    return { frames: [], getFrame() { return {}; } };
  }
};
const maskStub = {
  GetMask() {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, at() { return 0; } };
  }
};
const triggerStub = { trigger() { return 0; }, removeByOwner() {} };
const particleStub = {};

class DummyAction {
  constructor(name = 'dummy') { this.name = name; }
  getActionName() { return this.name; }
  triggerLemAction(lem) { lem.setAction(this); return true; }
  process() { return LemmingStateType.NO_STATE_TYPE; }
  draw() {}
}
class BashAction extends DummyAction {}
class BlockAction extends DummyAction {}
class DigAction extends DummyAction {}
class MineAction extends DummyAction {}

const actionKeys = [
  'ActionWalkSystem','ActionFallSystem','ActionJumpSystem','ActionDiggSystem',
  'ActionExitingSystem','ActionFloatingSystem','ActionBlockerSystem',
  'ActionMineSystem','ActionClimbSystem','ActionHoistSystem','ActionBashSystem',
  'ActionBuildSystem','ActionShrugSystem','ActionExplodingSystem','ActionOhNoSystem',
  'ActionSplatterSystem','ActionDrowningSystem','ActionFryingSystem','ActionCountdownSystem'
];

const originals = {};

const makeManager = () => {
  const level = new Level(32, 32);
  level.entrances = [{ x: 0, y: 0 }];
  level.releaseCount = 2;
  level.releaseRate = 99;
  const gvc = new GameVictoryCondition(level);
  const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);
  return { manager, gvc, level };
};

describe('LemmingManager coverage', function() {
  beforeEach(function() {
    globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: false } };
    for (const key of actionKeys) originals[key] = Lemmings[key];
    for (const key of actionKeys) Lemmings[key] = DummyAction;
    setDependency('ActionBashSystem', BashAction);
    setDependency('ActionBlockerSystem', BlockAction);
    setDependency('ActionDiggSystem', DigAction);
    setDependency('ActionMineSystem', MineAction);
  });

  afterEach(function() {
    delete globalThis.lemmings;
    for (const key of actionKeys) Lemmings[key] = originals[key];
  });

  it('wraps counters and selection helpers', function() {
    const { manager } = makeManager();
    manager.mmTickCounter = COUNTER_LIMIT;
    expect(manager.mmTickCounter).to.equal(0);
    manager.releaseTickIndex = COUNTER_LIMIT;
    expect(manager.releaseTickIndex).to.equal(0);

    const lem = new Lemming(1, 1, 0);
    lem.getClickDistance = () => 0;
    manager.activeLemmings = [lem];
    manager.lemmings = [lem];
    manager.setSelectedLemming(lem);
    expect(manager.getSelectedLemming()).to.equal(lem);
    manager.setSelectedLemming(null);
    expect(manager.selectedIndex).to.equal(-1);
    lem.disabled = true;
    expect(manager.getSelectedLemming()).to.equal(null);
    expect(manager.getLemmings()).to.equal(manager.activeLemmings);
    expect(manager.getLemmingAt(1, 1)).to.equal(lem);

    const mask = { offsetX: 0, offsetY: 0, width: 2, height: 2 };
    const hits = manager.getLemmingsInMask(mask, 0, 0);
    expect(hits.length).to.equal(1);
  });

  it('renders only visible lemmings', function() {
    const { manager } = makeManager();
    let renderCount = 0;
    let debugCount = 0;
    manager.activeLemmings = [
      { removed: false, x: 2, y: 2, render() { renderCount++; }, renderDebug() { debugCount++; } },
      { removed: false, x: 100, y: 100, render() {}, renderDebug() {} },
      { removed: true, x: 2, y: 2, render() {}, renderDebug() {} }
    ];
    const display = { stage: { getGameViewRect() { return { x: 0, y: 0, w: 10, h: 10 }; } } };
    manager.render(display);
    manager.renderDebug(display);
    expect(renderCount).to.equal(1);
    expect(debugCount).to.equal(1);
  });

  it('spawns lemmings, opens entrances, and emits sound', function() {
    const { manager, gvc } = makeManager();
    let called = 0;
    globalThis.lemmings.endless = true;
    globalThis.lemmings.game.soundEvents = { emitSfx() { called++; } };
    manager.releaseTickIndex = 4;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(1);
    expect(gvc.getOutCount()).to.equal(1);
    expect(manager.level.entrances[0]._opened).to.equal(true);
    expect(called).to.equal(1);
  });

  it('handles action application branches', function() {
    const { manager } = makeManager();
    const lem = new Lemming(1, 1, 0);
    lem.setAction(manager.actions[LemmingStateType.FALLING]);
    expect(manager.doLemmingAction(lem, SkillTypes.BASHER)).to.equal(false);
    expect(manager.doLemmingAction(lem, SkillTypes.FLOATER)).to.equal(true);

    lem.setAction(new manager._actionTypes.basher());
    expect(manager.doLemmingAction(lem, SkillTypes.BASHER)).to.equal(false);
    expect(manager.doLemmingAction(null, SkillTypes.BASHER)).to.equal(false);
    expect(manager.doLemmingAction(lem, SkillTypes.UNKNOWN)).to.equal(false);

    lem.setAction(new manager._actionTypes.blocker());
    let removed = false;
    manager.triggerManager.removeByOwner = () => { removed = true; };
    expect(manager.doLemmingAction(lem, SkillTypes.DIGGER)).to.equal(true);
    expect(removed).to.equal(true);

    removed = false;
    lem.setAction(new manager._actionTypes.blocker());
    expect(manager.doLemmingAction(lem, SkillTypes.BOMBER)).to.equal(true);
    expect(removed).to.equal(false);
  });

  it('sets exploding state and logs debug actions', function() {
    const { manager } = makeManager();
    const lem = new Lemming(1, 1, 0);
    manager.activeLemmings = [lem];
    globalThis.lemmings.gameSpeedFactor = 1;
    let debugged = false;
    manager.logging.debug = () => { debugged = true; };
    manager.setLemmingState(lem, LemmingStateType.WALKING);
    expect(debugged).to.equal(true);
    manager.setLemmingState(lem, LemmingStateType.EXPLODING);
    expect(lem.hasExploded).to.equal(true);
  });

  it('ticks with minimap updates and compacts active list', function() {
    const { manager } = makeManager();
    manager.triggerManager.trigger = () => TriggerTypes.NO_TRIGGER;
    globalThis.lemmings.bench = true;
    manager.releaseTickIndex = -1;
    const exploding = manager.actions[LemmingStateType.EXPLODING];
    const calls = { processed: 0, nuked: 0 };
    manager._nukeNextLemming = () => { calls.nuked++; manager.nextNukingLemmingsIndex = -1; };
    manager.nextNukingLemmingsIndex = 0;

    const lemSkip = {
      removed: true,
      action: null,
      process() { calls.processed++; return LemmingStateType.NO_STATE_TYPE; },
      setAction() {},
      isRemoved() { return this.removed; },
      isDisabled() { return this.disabled; },
      x: 0,
      y: 0,
      disabled: false,
      id: 0
    };
    const lemExplode = {
      removed: true,
      action: exploding,
      process() { calls.processed++; return LemmingStateType.NO_STATE_TYPE; },
      setAction() {},
      isRemoved() { return this.removed; },
      isDisabled() { return this.disabled; },
      x: 1,
      y: 1,
      disabled: false,
      id: 1
    };
    const lemActive = {
      removed: false,
      action: exploding,
      process() { calls.processed++; return LemmingStateType.NO_STATE_TYPE; },
      setAction() {},
      isRemoved() { return this.removed; },
      isDisabled() { return this.disabled; },
      x: 2,
      y: 2,
      disabled: false,
      id: 2
    };
    manager.activeLemmings = [lemSkip, lemExplode, lemActive];
    manager.selectedIndex = 2;
    manager._minimapDotBuffer = new Uint8Array(0);
    manager.miniMap = {
      scaleX: 1,
      scaleY: 1,
      setLiveDots(arr) { this.dots = arr; },
      setSelectedDot(dot) { this.sel = dot; }
    };
    manager.mmTickCounter = 9;
    manager._activeDirty = true;

    manager.tick();

    expect(calls.nuked).to.equal(1);
    expect(globalThis.lemmings.laggedOut).to.equal(3);
    expect(manager.minimapDots.length).to.be.greaterThan(0);
    expect(manager.activeLemmings.length).to.equal(1);
  });

  it('disposes and records performance metrics', function() {
    const { manager } = makeManager();
    const original = globalThis.performance;
    let measured = false;
    globalThis.performance = {
      now() { return 0; },
      measure() { measured = true; }
    };
    globalThis.lemmings.perfMetrics = true;
    globalThis.lemmings.debug = true;
    manager.dispose();
    globalThis.performance = original;
    expect(measured).to.equal(true);
  });
});
