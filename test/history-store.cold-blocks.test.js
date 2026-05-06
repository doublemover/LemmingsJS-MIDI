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

describe('HistoryStore cold blocks', function() {
  it('binds before tick handlers when timers provide hooks', function() {
    const timer = {
      tickIndex: 0,
      speedFactor: 1,
      frameTime: 60,
      onBeforeGameTick: new EventHandler(),
      onGameTick: new EventHandler()
    };
    const manager = { lemmings: [], actions: [], skillActions: [] };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore();
    history.attach(game, { captureBaseline: true });
    timer.onBeforeGameTick.trigger(3);
    expect(history._currentTick).to.equal(3);
  });

  it('applies keyframes without nuke targets arrays', function() {
    const { history, game, manager } = createHistoryFixture();
    history.applyKeyframe(game, {
      lemmingManagerState: { nukeTargets: null }
    });
    expect(manager._nukeTargets).to.equal(null);
  });

  it('applies minimap keyframe defaults', function() {
    const { history, game, manager } = createHistoryFixture();
    manager.miniMap = {
      deadDots: new Uint8Array([1, 2]),
      deadTTLs: new Uint8Array([3]),
      deadCount: 1
    };
    history.applyKeyframe(game, {
      minimapState: { deadDots: null, deadTTLs: null, deadCount: undefined }
    });
    expect(manager.miniMap.deadDots).to.have.length(0);
    expect(manager.miniMap.deadTTLs).to.have.length(0);
    expect(manager.miniMap.deadCount).to.equal(0);
  });

  it('skips applyKeyframe when inputs are missing', function() {
    const history = new HistoryStore();
    history.applyKeyframe(null, { lemmingState: {} });
    history.applyKeyframe({ getLemmingManager: () => ({}) }, null);
  });

  it('initializes missing lemming arrays during keyframe apply', function() {
    const history = new HistoryStore();
    const manager = {
      actions: [],
      skillActions: [],
      _lemmingCtor: function ReplayCtor(x, y, id) {
        this.x = x;
        this.y = y;
        this.id = id;
      }
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 2;
    lemmingState.y[0] = 3;
    lemmingState.actionType[0] = -1;
    history.applyKeyframe(game, { lemmingState });
    expect(Array.isArray(manager.lemmings)).to.equal(true);
    expect(manager.lemmings[0]).to.be.ok;
  });

  it('applies keyframe action and entrance fallbacks', function() {
    const { history, game, manager, walkAction } = createHistoryFixture();
    game.level.entrances = undefined;
    manager.actions = [walkAction];

    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 1;
    lemmingState.y[0] = 2;
    lemmingState.actionType[0] = -1;

    history.applyKeyframe(game, {
      lemmingState,
      lemmingManagerState: { nukeTargets: [NaN] },
      entranceOpened: new Uint8Array(0)
    });

    expect(manager.lemmings[0].action).to.equal(null);
    expect(manager._nukeTargets).to.eql([]);
  });

  it('constructs lemmings from keyframes without skill actions', function() {
    const history = new HistoryStore();
    const ctorCalls = [];
    const LemCtor = function(x, y, id) {
      this.id = id;
      this.x = x;
      this.y = y;
      ctorCalls.push([x, y, id]);
    };
    const manager = { lemmings: [], actions: [], _lemmingCtor: LemCtor };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 4;
    lemmingState.y[0] = 5;
    lemmingState.actionType[0] = -1;
    history.applyKeyframe(game, { lemmingState });
    expect(manager.lemmings[0]).to.be.ok;
    expect(ctorCalls).to.have.length(1);

    manager._lemmingCtor = null;
    manager.lemmings = [];
    lemmingState.x[0] = 7;
    lemmingState.y[0] = 8;
    expect(() => history.applyKeyframe(game, { lemmingState })).to.throw(
      /manager\._acquireLemming\(\) or manager\._lemmingCtor/
    );
  });

  it('compacts cold delta blocks and resolves sentinel-backed deltas', function() {
    const { history, timer } = createHistoryFixture();
    history.configureRetention({
      deltaBlockSizeTicks: 4,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 64,
      enableColdBlockCompression: true
    });

    for (let tick = 0; tick < 10; tick += 1) {
      recordTick(history, timer, tick, null, tick + 1);
    }

    const stats = history.getHistoryStats();
    expect(stats.coldBlockCount).to.be.greaterThan(0);
    const coldTick = 0;
    expect(history.deltas[coldTick]).to.equal(1);
    const delta = history.getDelta(coldTick);
    expect(delta).to.be.ok;
    expect(delta.tick).to.equal(coldTick);
  });

  it('throttles cold compaction work per sweep budget', function() {
    const history = new HistoryStore({
      deltaBlockSizeTicks: 1,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 1,
      enableColdBlockCompression: true
    });
    seedHistory(history, { deltas: [0, 1, 2, 3, 4, 5] });

    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.equal(1);
    expect(history.deltas[0]).to.equal(1);
    expect(history.deltas[5]).to.not.equal(1);

    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.equal(2);

    history._maybeCompactDeltaBlocks();
    history._maybeCompactDeltaBlocks();
    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.equal(5);
    expect(history.deltas[4]).to.equal(1);
    expect(history.deltas[5]).to.not.equal(1);
  });

  it('runs compaction sweeps only on configured interval ticks', function() {
    const history = new HistoryStore({
      deltaBlockSizeTicks: 1,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 3,
      coldCompactionMaxBlocksPerSweep: 64,
      enableColdBlockCompression: true
    });
    seedHistory(history, { deltas: [0, 1, 2, 3, 4] });

    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.equal(0);

    history._setDelta(5, history._allocDelta(5));
    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.equal(0);

    history._setDelta(6, history._allocDelta(6));
    history._maybeCompactDeltaBlocks();
    expect(history._coldBlockCount).to.be.greaterThan(0);
    expect(history.deltas[0]).to.equal(1);
  });

  it('deduplicates identical cold block payloads by hash', function() {
    const { history, timer } = createHistoryFixture();
    history.configureRetention({
      deltaBlockSizeTicks: 2,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 64,
      enableColdBlockCompression: true,
      enableColdBlockDedupe: true
    });

    for (let tick = 0; tick < 10; tick += 1) {
      recordTick(history, timer, tick, null, tick + 1);
    }

    const uniqueBuckets = Array.from(history._coldBlockStore.values());
    expect(uniqueBuckets.length).to.be.greaterThan(0);
    const hasSharedRef = uniqueBuckets.some(bucket => bucket.some(entry => entry.refs > 1));
    expect(hasSharedRef).to.equal(true);
  });

  it('keeps distinct bytes when hash buckets collide during dedupe', function() {
    const history = new HistoryStore({ enableColdBlockDedupe: true });
    const storeKey = 'raw:deadbeef:4';
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([4, 3, 2, 1]);
    const retainedA = history._retainColdBytes(storeKey, a);
    const retainedB = history._retainColdBytes(storeKey, b);
    expect(retainedA).to.equal(a);
    expect(retainedB).to.equal(b);
    expect(retainedA).to.not.equal(retainedB);
    expect(history._coldBlockStore.get(storeKey)).to.have.length(2);
    expect(history._coldBlockBytes).to.equal(a.length + b.length);
  });

  it('preserves replay hash across cold-block thaw and decode', function() {
    const { history, timer, manager } = createHistoryFixture();
    history.configureRetention({
      deltaBlockSizeTicks: 3,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 64,
      enableColdBlockCompression: true
    });

    for (let tick = 0; tick < 9; tick += 1) {
      recordTick(history, timer, tick, () => {
        manager.lemmings[0].x = 10 + (tick % 3);
        manager.lemmings[0].frameIndex = tick % 5;
      }, tick + 1);
    }

    const before = history.computeReplayHash();
    for (const start of history._deltaBlocks.keys()) {
      history._thawDeltaBlock(start);
    }
    const after = history.computeReplayHash();
    expect(before).to.be.a('string');
    expect(after).to.equal(before);
  });

  it('preserves replay hash across long-session cold decode and thaw cycles', function() {
    const { history, timer, manager, skills, victory, game } = createHistoryFixture();
    history.configureRetention({
      deltaBlockSizeTicks: 8,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 128,
      enableColdBlockCompression: true
    });

    for (let tick = 0; tick < 240; tick += 1) {
      recordTick(history, timer, tick, () => {
        manager.lemmings[0].x = 10 + (tick % 17);
        manager.lemmings[0].y = 20 + (tick % 9);
        manager.lemmings[0].frameIndex = tick % 8;
        manager.lemmings[0].lookRight = (tick % 2) === 0;
        skills.selectedSkill = tick % 2;
        skills.skills[0] = 1 + (tick % 3);
        victory.leftCount = Math.max(0, 200 - tick);
        game.finalGameState = tick % 4;
      }, tick + 1);
    }

    const baseline = history.computeReplayHash();
    expect(baseline).to.be.a('string');

    for (let tick = history.maxDeltaTick; tick >= history.minDeltaTick; tick -= 3) {
      const delta = history.getDelta(tick);
      expect(delta).to.be.ok;
    }
    const afterDecode = history.computeReplayHash();
    expect(afterDecode).to.equal(baseline);

    for (const start of Array.from(history._deltaBlocks.keys())) {
      history._thawDeltaBlock(start);
    }
    history._maybeCompactDeltaBlocks();
    const afterThaw = history.computeReplayHash();
    expect(afterThaw).to.equal(baseline);
  });

  it('preserves replay hash during randomized cold block seek/decode cycles', function() {
    const { history, timer, manager, skills, victory, game } = createHistoryFixture();
    history.configureRetention({
      deltaBlockSizeTicks: 6,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: 64,
      enableColdBlockCompression: true,
      enableColdBlockDedupe: true
    });

    for (let tick = 0; tick < 300; tick += 1) {
      recordTick(history, timer, tick, () => {
        if ((tick % 4) === 0) {
          manager.lemmings[0].x = 16 + (tick % 19);
          manager.lemmings[0].y = 22 + (tick % 11);
          manager.lemmings[0].frameIndex = tick % 6;
          manager.lemmings[0].lookRight = (tick % 2) === 0;
          skills.selectedSkill = tick % 2;
          skills.skills[0] = 1 + (tick % 4);
          victory.leftCount = Math.max(0, 240 - tick);
          game.finalGameState = tick % 5;
        }
      }, tick + 1);
    }

    const baseline = history.computeReplayHash();
    expect(baseline).to.be.a('string');
    let seed = 0x1234abcd;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const minTick = history.minDeltaTick;
    const maxTick = history.maxDeltaTick;
    for (let i = 0; i < 480; i += 1) {
      const range = (maxTick - minTick + 1);
      const tick = minTick + (next() % range);
      history.getDelta(tick);
      if ((i % 7) === 0) {
        history._maybeCompactDeltaBlocks();
      }
      if ((i % 11) === 0) {
        const starts = Array.from(history._deltaBlocks.keys());
        if (starts.length) {
          const pick = starts[next() % starts.length];
          history._thawDeltaBlock(pick);
        }
      }
      if ((i % 40) === 0) {
        expect(history.computeReplayHash()).to.equal(baseline);
      }
    }

    const after = history.computeReplayHash();
    expect(after).to.equal(baseline);
  });
});
