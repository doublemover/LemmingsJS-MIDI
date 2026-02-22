import { expect } from 'chai';
import { DummyAction, withActionStubs } from './helpers/lemming-actions.js';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { makeManager as makeLemmingManager } from './helpers/lemming-manager.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import '../js/LemmingsBootstrap.js';

class BashAction extends DummyAction {}
class BlockAction extends DummyAction {}
class DigAction extends DummyAction {}
class MineAction extends DummyAction {}

const makeManager = () => (
  makeLemmingManager({ width: 32, height: 32, releaseCount: 2, releaseRate: 99 })
);

describe('LemmingManager coverage', function() {
  useGlobalLemmings({ bench: false, extraLemmings: 0, game: { showDebug: false } });

  beforeEach(function() {
    this._restoreActions = withActionStubs({
      ActionBashSystem: BashAction,
      ActionBlockerSystem: BlockAction,
      ActionDiggSystem: DigAction,
      ActionMineSystem: MineAction
    });
  });

  afterEach(function() {
    this._restoreActions();
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

  it('skips removed lemmings in mask queries', function() {
    const { manager } = makeManager();
    const active = new Lemming(1, 1, 0);
    const removed = new Lemming(1, 1, 1);
    removed.removed = true;
    manager.activeLemmings = [active, removed];
    const mask = { offsetX: 0, offsetY: 0, width: 2, height: 2 };
    const hits = manager.getLemmingsInMask(mask, 0, 0);
    expect(hits).to.eql([active]);
  });

  it('clears invalid selections during tick', function() {
    const { manager } = makeManager();
    manager.triggerManager.trigger = () => TriggerTypes.NO_TRIGGER;
    manager.releaseTickIndex = -1;
    const removed = {
      removed: true,
      disabled: false,
      action: null,
      process() { return LemmingStateType.NO_STATE_TYPE; },
      setAction() {},
      isRemoved() { return this.removed; },
      isDisabled() { return this.disabled; },
      x: 0,
      y: 0,
      id: 1
    };
    manager.activeLemmings = [removed];
    manager.selectedIndex = removed.id;
    manager.tick();
    expect(manager.selectedIndex).to.equal(-1);
  });

  it('updates minimap dots while de-duplicating positions', function() {
    const { manager } = makeManager();
    manager.triggerManager.trigger = () => TriggerTypes.NO_TRIGGER;
    manager.releaseTickIndex = -1;
    manager._minimapDotBuffer = new Uint8Array(0);
    manager.mmTickCounter = 9;
    manager.miniMap = {
      scaleX: 1,
      scaleY: 1,
      setLiveDots(arr) { this.dots = arr; },
      setSelectedDot(dot) { this.sel = dot; }
    };
    const makeLem = (id) => ({
      removed: false,
      disabled: false,
      action: manager.actions[LemmingStateType.WALKING],
      process() { return LemmingStateType.NO_STATE_TYPE; },
      setAction() {},
      isRemoved() { return this.removed; },
      isDisabled() { return this.disabled; },
      x: 2,
      y: 2,
      id
    });
    const lemA = makeLem(1);
    const lemB = makeLem(2);
    manager.activeLemmings = [lemA, lemB];
    manager.lemmings = [lemA, lemB];
    manager.selectedIndex = lemA.id;
    manager.tick();
    expect(manager.miniMap.dots.length).to.equal(2);
    expect(manager.miniMap.sel).to.eql([2, 2]);
    expect(manager.selectedIndex).to.equal(lemA.id);
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

  it('clears countdown when lethal state is applied', function() {
    const { manager } = makeManager();
    const states = [
      LemmingStateType.DROWNING,
      LemmingStateType.SPLATTING,
      LemmingStateType.FRYING
    ];
    for (const state of states) {
      const lem = new Lemming(1, 1, 0);
      lem.countdown = 3;
      lem.countdownAction = {};
      manager.setLemmingState(lem, state);
      expect(lem.countdown).to.equal(0);
      expect(lem.countdownAction).to.equal(null);
    }
  });

  it('maps trigger results to exit, kill, and trap states', function() {
    const { manager } = makeManager();
    const lem = new Lemming(1, 1, 0);
    const cases = [
      [TriggerTypes.EXIT_LEVEL, LemmingStateType.EXITING],
      [TriggerTypes.KILL, LemmingStateType.SPLATTING],
      [TriggerTypes.FRYING, LemmingStateType.FRYING],
      [TriggerTypes.UNKNOWN_2, LemmingStateType.SPLATTING],
      [TriggerTypes.UNKNOWN_3, LemmingStateType.SPLATTING],
      [TriggerTypes.TRAP, LemmingStateType.SPLATTING]
    ];
    for (const [triggerType, expected] of cases) {
      manager.triggerManager.trigger = () => triggerType;
      const state = manager.runTrigger(lem);
      expect(state).to.equal(expected);
      expect(lem.lastTriggerType).to.equal(triggerType);
    }
  });

  it('uses a custom lemming constructor when provided', function() {
    const { manager } = makeManager();
    class CustomLemming extends Lemming {
      constructor(x, y, id) {
        super(x, y, id);
        this.custom = true;
      }
    }
    manager._lemmingCtor = CustomLemming;
    manager.addLemming(3, 3);
    expect(manager.lemmings[0].custom).to.equal(true);
  });

  it('requires an explicit lemming constructor', function() {
    const { manager } = makeManager();
    manager._lemmingCtor = null;
    expect(() => manager.addLemming(1, 1)).to.throw(/explicit lemming constructor/);
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

  it('handles missing blocker action types when applying skills', function() {
    const { manager } = makeManager();
    const lem = new Lemming(1, 1, 0);
    lem.setAction(manager.actions[LemmingStateType.WALKING]);
    manager._actionTypes = {};
    expect(manager.doLemmingAction(lem, SkillTypes.DIGGER)).to.equal(true);
  });

  it('marks nuke as inactive when no eligible targets exist', function() {
    const { manager } = makeManager();
    manager.activeLemmings = [
      { removed: true, disabled: false },
      { removed: false, disabled: true }
    ];
    manager.doNukeAllLemmings();
    expect(manager.nextNukingLemmingsIndex).to.equal(-1);
    expect(manager._nukeTargets).to.eql([]);
  });

  it('sets nuke index when targets exist', function() {
    const { manager } = makeManager();
    manager.activeLemmings = [{ removed: false, disabled: false }];
    manager.doNukeAllLemmings();
    expect(manager.nextNukingLemmingsIndex).to.equal(0);
    expect(manager._nukeTargets.length).to.equal(1);
  });

  it('handles nuke bounds checks and fallback targets', function() {
    const { manager } = makeManager();
    manager._nukeTargets = null;
    manager._nukeNextLemming();

    manager._nukeTargets = [new Lemming(1, 1, 0)];
    manager.nextNukingLemmingsIndex = 1;
    manager._nukeNextLemming();
    expect(manager.nextNukingLemmingsIndex).to.equal(-1);
    expect(manager._nukeTargets).to.equal(null);

    const lems = [new Lemming(1, 1, 0)];
    manager._nukeTargets = lems;
    let reads = 0;
    Object.defineProperty(manager, 'nextNukingLemmingsIndex', {
      get() {
        reads += 1;
        return reads === 1 ? 0 : 1;
      },
      set(value) {
        this._nukeIndexValue = value;
      },
      configurable: true
    });
    manager._nukeNextLemming();
    delete manager.nextNukingLemmingsIndex;
  });

  it('cycles selection from the start when nothing is selected', function() {
    const { manager } = makeManager();
    const lemA = new Lemming(1, 1, 0);
    const lemB = new Lemming(2, 2, 1);
    manager.activeLemmings = [lemA, lemB];
    manager.selectedIndex = -1;
    const selected = manager.cycleSelection(1);
    expect(selected).to.equal(lemB);
  });

  it('returns null when no lemmings are active', function() {
    const { manager } = makeManager();
    manager.activeLemmings = [];
    expect(manager.cycleSelection()).to.equal(null);
  });

  it('cycles selection from the current active index', function() {
    const { manager } = makeManager();
    const lemA = new Lemming(1, 1, 0);
    const lemB = new Lemming(2, 2, 1);
    lemA._activeIndex = 0;
    lemB._activeIndex = 1;
    manager.activeLemmings = [lemA, lemB];
    manager.lemmings = [lemA, lemB];
    manager.setSelectedLemming(lemA);
    const selected = manager.cycleSelection(1);
    expect(selected).to.equal(lemB);
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
