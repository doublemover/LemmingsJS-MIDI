import { expect } from 'chai';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';

describe('HistoryStore', function() {
  it('captures lemming deltas and can replay them', function() {
    const timer = { tickIndex: 0, speedFactor: 1, frameTime: 60 };
    const walkAction = { name: 'walk' };
    const bomberAction = { name: 'bomber' };
    const lemming = {
      id: 0,
      x: 5,
      y: 6,
      lookRight: true,
      frameIndex: 0,
      state: 1,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    };
    const skillActions = [];
    skillActions[SkillTypes.BOMBER] = bomberAction;
    const manager = {
      lemmings: [lemming],
      activeLemmings: [lemming],
      _activeDirty: false,
      actions: [walkAction],
      skillActions,
      actionTypeByAction: new Map([[walkAction, 0]]),
      selectedIndex: -1,
      spawnTotal: 1,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: null
    };
    const skills = { selectedSkill: 0, cheatMode: false, skills: [1] };
    const victory = {
      releaseRate: 1,
      minReleaseRate: 1,
      leftCount: 1,
      outCount: 0,
      survivorCount: 0,
      isFinalize: false
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => skills,
      getVictoryCondition: () => victory
    };

    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    manager.lemmings[0].x = 10;
    manager.lemmings[0].y = 12;
    manager.selectedIndex = 0;
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.deltas.get(0);
    expect(delta).to.be.ok;

    history.applyDeltaBackward(game, delta);
    expect(manager.lemmings[0].x).to.equal(5);
    expect(manager.lemmings[0].y).to.equal(6);
    expect(manager.selectedIndex).to.equal(-1);

    history.applyDeltaForward(game, delta);
    expect(manager.lemmings[0].x).to.equal(10);
    expect(manager.lemmings[0].y).to.equal(12);
    expect(manager.selectedIndex).to.equal(0);
  });

  it('truncates future history unless preservation is enabled', function() {
    const history = new HistoryStore({ keyframeInterval: 5 });
    history.deltas.set(0, { tick: 0 });
    history.deltas.set(2, { tick: 2 });
    history.keyframes.set(0, { tickIndex: 0 });
    history.keyframes.set(2, { tickIndex: 2 });

    history.truncateAfter(0);
    expect(history.deltas.has(2)).to.equal(false);
    expect(history.keyframes.has(2)).to.equal(false);

    history.deltas.set(2, { tick: 2 });
    history.keyframes.set(2, { tickIndex: 2 });
    history.setPreserveFutureHistory(true);
    history.truncateAfter(0);
    expect(history.deltas.has(2)).to.equal(true);
    expect(history.keyframes.has(2)).to.equal(true);
  });
});
