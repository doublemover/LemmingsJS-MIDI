import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import { HistoryStore, __test__ } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { runScenarioTable } from './support/scenario-table.js';
import {
  createHistoryFixture,
  createStubTimer,
  recordTick,
  runHistoryOps,
  scenario,
  seedHistory
} from './support/history-fixtures.js';

describe('HistoryStore diffing', function() {
  it('truncates before gaps and clears keyframes', function() {
    const history = new HistoryStore({ keyframeInterval: 2 });
    seedHistory(history, { deltas: [0, 2], keyframes: [0, 1] });

    history._truncateBefore(1);
    expect(history.minDeltaTick).to.equal(2);

    history._truncateBefore(5);
    expect(history.minDeltaTick).to.equal(null);

    const history2 = new HistoryStore({ keyframeInterval: 2 });
    seedHistory(history2, { deltas: [0], keyframes: [0, 1] });
    history2._truncateBefore(2);
    expect(history2.keyframeTicks).to.have.length(0);
  });

  it('warns and caps history spans', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2,
      historyWarnTicks: 2
    });
    seedHistory(history, { deltas: [0, 1, 2, 3], keyframes: [1] });

    let warned = 0;
    const restoreConsole = withConsoleStub({ warn: () => { warned += 1; } });
    try {
      history._maybeWarnHistory();
      history._maybeWarnHistory();
    } finally {
      restoreConsole();
    }
    expect(warned).to.equal(1);

    history._enforceHistoryCap();
    expect(history.minDeltaTick).to.equal(1);
  });

  it('skips history caps when a keyframe is before the minimum tick', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    seedHistory(history, { deltas: [5, 6, 7], keyframes: [0] });

    history._enforceHistoryCap();
    expect(history.minDeltaTick).to.equal(5);
  });

  it('captures keyframes with ground data when dirty', function() {
    const { history, game } = createHistoryFixture();
    history._groundDirty = true;
    game.level.groundMask.mask[0] = 1;
    game.level.groundImage[0] = 5;

    const frame = history._captureKeyframe(game, 0);
    expect(frame.groundMask[0]).to.equal(1);
    expect(frame.groundImage[0]).to.equal(5);
  });

  it('diffs lemming adds, removals, and changes', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const manager = {
      lemmings: [
        {
          id: 0,
          x: 1,
          y: 2,
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
        },
        {
          id: 1,
          x: 3,
          y: 4,
          lookRight: false,
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
        }
      ],
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map()
    };

    history._captureLemmingState(manager);
    const delta = history._allocDelta(0);

    manager.lemmings[0] = null;
    manager.lemmings[1].x = 10;
    manager.lemmings.push({
      id: 2,
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
      lastTriggerType: 2,
      action: walkAction,
      countdownAction: null
    });

    history._diffLemmings(manager, delta);
    expect(delta.lemRemoved).to.have.length(1);
    expect(delta.lemAdded).to.have.length(1);
    expect(delta.lemChanges.ids).to.include(1);
  });

  it('removes lemmings beyond the current length', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const manager = {
      lemmings: [
        { id: 0, x: 1, y: 2, lookRight: true, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null },
        { id: 1, x: 3, y: 4, lookRight: false, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null },
        { id: 2, x: 5, y: 6, lookRight: true, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null }
      ],
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map()
    };

    history._captureLemmingState(manager);
    manager.lemmings.length = 1;
    const delta = history._allocDelta(0);
    history._diffLemmings(manager, delta);
    expect(delta.lemRemoved).to.have.length(2);
  });

  it('skips lemming diffs when values match', function() {
    const history = new HistoryStore();
    const delta = history._allocDelta(0);
    const store = new Int32Array(1);
    history._diffLemmingField(delta, 0, 0, 1, 1, store);
    expect(delta.lemChanges.ids).to.have.length(0);
  });
});
