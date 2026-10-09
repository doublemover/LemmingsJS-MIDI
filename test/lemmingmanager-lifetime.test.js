import { expect } from 'chai';
import { Game } from '../js/game/Game.js';
import { createGameRuntime } from '../js/game/GameRuntime.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';
import { GameSkills } from '../js/game/GameSkills.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { HistoryStore, __test__ } from '../js/game/HistoryStore.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';
import { CommandManager } from '../js/commands/CommandManager.js';
import { CommandLemmingsAction } from '../js/commands/CommandLemmingsAction.js';
import { Level } from '../js/level/Level.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { LemmingManager } from '../js/lemmings/LemmingManager.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import * as actualDependencies from '../js/lemmings/lemming-manager/LemmingManagerShared.js';
import { clearDependency, getDependency, setDependency, getAppContext, setAppContext } from '../js/core/dependencies.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('LemmingManager bounded lifetime identities and real history', function () {
  let masks, previous, priorApp, games;
  const absent = Symbol('absent dependency');
  before(async function () { masks = await loadProcgenMasks(); });
  beforeEach(function () {
    previous = new Map(); priorApp = getAppContext(); setAppContext(null); games = [];
    for (const [key, value] of Object.entries(actualDependencies)) if (key === 'Lemming' || key.startsWith('Action') && key.endsWith('System')) {
      previous.set(key, getDependency(key, absent)); setDependency(key, value);
    }
  });
  afterEach(function () {
    try { for (const game of games) game.stop(); }
    finally {
      for (const [key, value] of previous) { if (value === absent) clearDependency(key); else setDependency(key, value); }
      setAppContext(priorApp);
    }
  });
  const makeGame = (releaseCount = 8) => {
    const game = new Game({}), level = new Level(256, 96); games.push(game);
    Object.assign(level, { needCount: releaseCount, releaseCount, releaseRate: 50, timeLimit: 10 });
    level.skills[SkillTypes.CLIMBER] = 8;
    level.groundMask.mask.fill(1, 72 * level.width);
    level.groundImage = new Uint8ClampedArray(level.width * level.height * 4);
    game.runtime = createGameRuntime(game); level.runtime = game.runtime;
    game.level = level; game.gameTimer = new GameTimer(level, { window: {}, document: {} });
    game.gameVictoryCondition = new GameVictoryCondition(level); game.skills = new GameSkills(level);
    game.commandManager = new CommandManager(game, game.gameTimer);
    game.triggerManager = new TriggerManager(game.gameTimer, level.width, level.height, 16, game.runtime);
    game.lemmingManager = new LemmingManager(level, null, game.triggerManager, game.gameVictoryCondition, masks, null, game.runtime);
    game.gameTimer.onGameTick.on(game._boundTick); game.start();
    return game;
  };
  const addActor = (game, x = 12) => {
    const manager = game.lemmingManager, id = manager._nextLemmingId;
    game.gameVictoryCondition.releaseOne(); manager.addLemming(x, 72);
    return manager.getLemming(id);
  };
  const attachHistory = (game, options = {}) => {
    game.history = new HistoryStore({ keyframeInterval: 2, ...options }); game.history.attach(game);
    game.timeTravel = new TimeTravelController(game, game.history);
    game.gameTimer.setTimeTravelController(game.timeTravel);
    return game.history;
  };

  it('keeps lookup, live processing, pool and compact retained snapshots bounded through 4096 real admissions', function () {
    const game = makeGame(4096), manager = game.lemmingManager;
    const history = attachHistory(game);
    game.timeTravel.setHistoryRetention({ historyCapTicks: 32, historyWarnTicks: 0 });
    let current = null, pooled = null;
    for (let id = 0; id < 4096; id++) {
      if (current) manager.removeOne(current);
      current = addActor(game);
      if (pooled) expect(current).to.equal(pooled);
      pooled = current;
      expect(current.id).to.equal(id);
      expect(manager.getLemming(id - 1)).to.equal(null);
      game.gameTimer.tick();
      expect(manager.lemmings).to.eql([current]);
      expect(manager.activeLemmings).to.eql([current]);
      expect(manager._lemmingById.size).to.equal(1);
      expect(history._liveLemmingSlots.size).to.equal(1);
      expect(history._lemmingState.capacity).to.be.at.most(1);
    }
    expect(manager.spawnTotal).to.equal(4096); expect(manager._nextLemmingId).to.equal(4096);
    expect(game.gameVictoryCondition.getOutCount()).to.equal(1);
    expect(manager._lemmingPool).to.have.length(0);
    const scratch = history._lemmingState;
    history.captureBaseline(game);
    expect(history._lemmingState).to.equal(scratch);
    expect(history.deltaCount).to.be.at.most(32);
    for (const tick of history.keyframeTicks) {
      const state = history.getKeyframe(tick).lemmingState;
      expect(state.layout).to.equal('live-id-slots');
      expect(state.actorIds).to.have.length(state.present.length);
      expect(state.present.length).to.be.at.most(1);
      if (state.present.length) expect(state.actorIds[0]).to.be.greaterThan(4000);
    }
    expect(new CommandLemmingsAction(0).execute(game)).to.equal(false);
    expect(current.canClimb).to.equal(false);
  });

  it('restores recorded high IDs on real seek/rewind and gives a fresh branch new lifetime IDs and stable command targets', function () {
    const game = makeGame(), manager = game.lemmingManager;
    // A high identity fixture tests allocation shape without claiming 100000 simulated admissions.
    manager._nextLemmingId = 100000;
    const first = addActor(game); game.gameTimer.tick(2);
    expect(first.action).to.equal(manager.actions[LemmingStateType.WALKING]);
    const history = attachHistory(game), originalX = first.x;
    manager.setSelectedLemming(first);
    game.commandManager.queueCommand(new CommandLemmingsAction(100000)); game.gameTimer.tick();
    expect(first.canClimb).to.equal(true);
    const climbedX = first.x;
    manager.removeOne(first); const second = addActor(game, 80); game.gameTimer.tick();
    expect(second).to.equal(first); expect(second.id).to.equal(100001);
    expect(manager.getLemming(100000)).to.equal(null);
    const decoded = history._unpackDeltaFromStorage(history._packDeltaForStorage(history.getDelta(3)), 3);
    expect(decoded.lemAdded[0].id).to.equal(100001);
    expect(decoded.lemRemoved[0].id).to.equal(100000);
    expect(decoded.lemmingManagerChanges.next.nextLemmingId).to.equal(100002);
    history._setDelta(3, decoded);
    game.timeTravel.stepBackward();
    expect(manager.getLemming(100000)).to.include({ x: climbedX, canClimb: true });
    expect(manager.getSelectedLemming()?.id).to.equal(100000);
    expect(manager.getLemming(100001)).to.equal(null);
    game.timeTravel.seekToTick(2);
    expect(manager.getLemming(100000)).to.include({ x: originalX, canClimb: false });
    game.timeTravel.seekToTick(4);
    expect(manager.getLemming(100001)?.id).to.equal(100001);
    expect(manager.getLemming(100000)).to.equal(null);
    game.timeTravel.seekToTick(2); history.truncateAfter(2); history.resume();
    const branch = addActor(game, 100);
    expect(branch.id).to.equal(100002);
    expect(new CommandLemmingsAction(100001).execute(game)).to.equal(false);
    expect(new CommandLemmingsAction(100002).execute(game)).to.equal(true);
    expect(branch.canClimb).to.equal(true);
    expect(manager.getLemming(100000).canClimb).to.equal(false);
    game.gameTimer.tick();
    expect(history.getDelta(2).lemAdded.map(actor => actor.id)).to.eql([100002]);
    game.timeTravel.seekToTick(3);
    expect(manager.getLemming(100002).canClimb).to.equal(true);
    expect(manager.lemmings).to.have.length(2);
    expect(history._lemmingState.capacity).to.equal(2);
    expect(manager._nextLemmingId).to.equal(100003);
  });

  it('loads legacy indexed snapshots into dense storage without interpreting collection slots as actor identities', function () {
    const game = makeGame(), manager = game.lemmingManager, history = new HistoryStore();
    const legacy = __test__.createLemmingState(8);
    delete legacy.layout; delete legacy.actorIds;
    legacy.present[7] = 1; legacy.x[7] = 48; legacy.y[7] = 72;
    legacy.lookRight[7] = 1; legacy.actionType[7] = LemmingStateType.WALKING;
    const frame = { lemmingState: legacy, lemmingManagerState: { spawnTotal: 8, selectedIndex: 7 } };
    history.applyKeyframe(game, frame);
    expect(manager.getLemming(7)).to.include({ id: 7, x: 48 });
    expect(manager.getSelectedLemming()?.id).to.equal(7);
    expect(manager.getLemming(0)).to.equal(null); expect(manager.lemmings).to.have.length(1);
    expect(history._lemmingState.capacity).to.equal(1);
    legacy.present[7] = 0; history.applyKeyframe(game, frame);
    expect(manager.lemmings).to.have.length(0); expect(manager._lemmingById.size).to.equal(0);
    expect(addActor(game).id).to.equal(8);
  });

  it('does not nuke a new identity through a pooled target reference and preserves missing replay target slots', function () {
    const game = makeGame(), manager = game.lemmingManager;
    const first = addActor(game); manager.doNukeAllLemmings(); manager.removeOne(first);
    const replacement = addActor(game); expect(replacement).to.equal(first);
    manager._nukeNextLemming();
    expect(replacement.countdown).to.equal(0); expect(manager.isNuking()).to.equal(false);
    const history = new HistoryStore();
    history._applyLemmingManagerState(manager, { next: { nextNukingLemmingsIndex: 1, nukeTargets: [null, replacement.id] } }, true);
    expect(manager._nukeTargets).to.eql([null, replacement]);
    manager._nukeNextLemming();
    expect(replacement.countdown).to.equal(80); expect(manager.isNuking()).to.equal(false);
  });

  it('retires actual blocker trigger owners before pooling and restores only the recorded owner on seek', function () {
    const game = makeGame(), manager = game.lemmingManager, first = addActor(game);
    const history = attachHistory(game);
    game.gameTimer.tick(2); manager.doLemmingAction(first, SkillTypes.BLOCKER); game.gameTimer.tick();
    expect(game.triggerManager._ownerTriggers.get(first)).to.have.length(2);
    const blockedTick = game.gameTimer.getGameTicks();
    let replacement;
    const replace = () => { manager.removeOne(first); replacement = addActor(game, 90); };
    game.gameTimer.onBeforeGameTick.on(replace); game.gameTimer.tick(); game.gameTimer.onBeforeGameTick.off(replace);
    expect(replacement).to.equal(first); expect(game.triggerManager._triggers.size).to.equal(0);
    expect(history.getDelta(blockedTick).triggerRemove.map(trigger => trigger.ownerId)).to.eql([0, 0]);
    game.timeTravel.seekToTick(blockedTick);
    const restored = manager.getLemming(0);
    expect(restored.action).to.equal(manager.actions[LemmingStateType.BLOCKING]);
    expect(game.triggerManager._ownerTriggers.get(restored)).to.have.length(2);
    expect([...game.triggerManager._triggers].every(trigger => trigger.owner === restored)).to.equal(true);
    game.timeTravel.seekToTick(blockedTick + 1);
    expect(manager.getLemming(0)).to.equal(null);
    expect(game.triggerManager._triggers.size).to.equal(0);
    expect(game.triggerManager._ownerTriggers.size).to.equal(0);
    expect(manager.getLemming(1).countdown).to.equal(0);
  });

  it('keeps chronological processing and nuke ownership after swap removal, compact keyframe seek and real shared digging', function () {
    const game = makeGame(), manager = game.lemmingManager;
    for (let i = 0; i < 4; i++) addActor(game);
    game.gameTimer.tick(2); const history = attachHistory(game);
    manager.removeOne(manager.getLemming(1)); addActor(game, 80); game.gameTimer.tick();
    expect(manager.lemmings.map(actor => actor.id)).to.eql([0, 3, 2, 4]);
    expect(manager.activeLemmings.map(actor => actor.id)).to.eql([0, 2, 3, 4]);
    for (const actor of manager.activeLemmings) {
      actor.x = actor.id === 0 ? 20 : 80; actor.y = 72;
      manager.setLemmingState(actor, LemmingStateType.WALKING);
      expect(manager.doLemmingAction(actor, SkillTypes.DIGGER)).to.equal(true);
    }
    history.captureReplayBaseline(game); const before = game.gameTimer.getGameTicks();
    const frame = history.getKeyframe(before);
    expect([...frame.lemmingState.actorIds]).to.eql([0, 3, 2, 4]);
    const processOrder = [], action = manager.actions[LemmingStateType.DIGGING], original = action.process;
    action.process = function (level, actor) { processOrder.push(actor.id); return original.call(this, level, actor); };
    const states = () => manager.activeLemmings.map(actor => ({ id: actor.id, x: actor.x, y: actor.y,
      state: actor.state, frame: actor.frameIndex, action: manager.actionTypeByAction.get(actor.action) }));
    try {
      game.gameTimer.tick(); expect(processOrder).to.eql([0, 2, 3, 4]);
      expect(manager.getLemming(2).action).to.equal(action);
      expect(manager.getLemming(3).action).to.equal(manager.actions[LemmingStateType.FALLING]);
      const expected = states(), ground = game.level.groundMask.mask.slice();
      expect(history.getDelta(before).groundChanges.prevMask.length).to.be.greaterThan(0);
      game.timeTravel.seekToTick(before); processOrder.length = 0;
      expect(manager.activeLemmings.map(actor => actor.id)).to.eql([0, 2, 3, 4]);
      game.gameTimer.tick(); expect(processOrder).to.eql([0, 2, 3, 4]);
      expect(states()).to.eql(expected); expect(game.level.groundMask.mask).to.eql(ground);
      manager.doNukeAllLemmings(); expect(manager._nukeTargetIds).to.eql([0, 2, 3, 4]);
      expect(manager._nukeTargets.map(actor => actor.id)).to.eql([0, 2, 3, 4]);
    } finally { action.process = original; }
  });

  it('rejects exhausted signed32 identities and an oversized extra batch without partial admissions or wrapping', function () {
    const game = makeGame(), manager = game.lemmingManager;
    manager._nextLemmingId = 0x7fffffff;
    setAppContext({ extraLemmings: 1 });
    expect(() => manager.addLemming(12, 72)).to.throw(RangeError);
    expect(manager.spawnTotal).to.equal(0); expect(manager._nextLemmingId).to.equal(0x7fffffff);
    expect(manager.lemmings).to.have.length(0);
    setAppContext(null); manager.addLemming(12, 72);
    expect(manager.getLemming(0x7fffffff)?.id).to.equal(0x7fffffff);
    try { manager.addLemming(12, 72); expect.fail('ID exhaustion must reject'); }
    catch (error) { expect(error.code).to.equal('lemming-id-exhausted'); }
    expect(manager._nextLemmingId).to.equal(0x80000000); expect(manager.lemmings).to.have.length(1);
  });
});
