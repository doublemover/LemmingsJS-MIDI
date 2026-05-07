import {
  ActionDiggSystem,
  DisplayImage,
  EventHandler,
  Frame,
  GameGui,
  GamepadInputController,
  HistoryStore,
  Level,
  Mask,
  MidiEventRouter,
  MidiScheduler,
  MiniMap,
  ObjectManager,
  SkillTypes,
  Stage,
  estimateBytes,
  fileURLToPath,
  makeCanvas,
  makeContext,
  makePalette,
  measureN,
  nsToMs,
  parseArgs,
  path,
  percentile,
  setupRenderEnvironment,
  summarizeSamples,
  toNumberOrNaN,
  toPositiveInt,
  withGlobalStubs
} from './shared.js';
const makeHistoryGame = (lemmingCount) => {
  const walkAction = { name: 'walk' };
  const lemmings = new Array(lemmingCount);
  for (let i = 0; i < lemmingCount; i += 1) {
    lemmings[i] = {
      id: i,
      x: 10 + (i % 80),
      y: 20 + Math.floor(i / 80),
      lookRight: (i & 1) === 0,
      frameIndex: i & 7,
      state: 0,
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
  }
  const manager = {
    lemmings,
    activeLemmings: lemmings.slice(),
    actions: [walkAction],
    skillActions: [],
    actionTypeByAction: new Map([[walkAction, 0]]),
    selectedIndex: -1,
    spawnTotal: lemmingCount,
    releaseTickIndex: 0,
    mmTickCounter: 0,
    nextNukingLemmingsIndex: -1,
    _nukeTargets: null,
    getLemming(id) { return this.lemmings[id] || null; }
  };
  const timer = {
    speedFactor: 1,
    frameTime: 1000 / 60,
    tickIndex: 0
  };
  const skills = {
    selectedSkill: SkillTypes.BASHER,
    cheatMode: false,
    skills: [0, 20, 20, 20, 20, 20, 20, 20, 20]
  };
  const victory = {
    releaseRate: 50,
    minReleaseRate: 1,
    leftCount: lemmingCount,
    outCount: lemmingCount,
    survivorCount: 0,
    isFinalize: false
  };
  const level = {
    entrances: [],
    triggers: [],
    objects: [],
    groundMask: null,
    groundImage: null
  };
  const game = {
    level,
    finalGameState: 0,
    getLemmingManager() { return manager; },
    getGameTimer() { return timer; },
    getGameSkills() { return skills; },
    getVictoryCondition() { return victory; }
  };
  return { game, manager, timer, skills, victory };
};
const mutateHistoryLemmings = (manager, tick) => {
  const lems = manager.lemmings;
  const stride = Math.max(1, Math.floor(lems.length / 32));
  for (let i = tick % stride; i < lems.length; i += stride) {
    const lem = lems[i];
    if (!lem || lem.removed) continue;
    lem.x += ((tick + i) & 1) ? 1 : -1;
    lem.frameIndex = (lem.frameIndex + 1) & 15;
    if (((tick + i) % 17) === 0) {
      lem.lookRight = !lem.lookRight;
    }
  }
  manager.mmTickCounter += 1;
};
const runHistoryScenario = ({ lemmingCount, ticks, seekWindow, repeats }) => {
  const recordSamples = [];
  const applySamples = [];
  let lastMetrics = null;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const { game, manager, timer, skills } = makeHistoryGame(lemmingCount);
    const history = new HistoryStore({
      keyframeInterval: 60,
      enableHistoryCap: false,
      enableColdBlockCompression: false,
      enableColdBlockDedupe: false
    });
    history.game = game;
    history.timer = timer;
    history._recording = true;
    history.captureBaseline(game);
    const startRecord = process.hrtime.bigint();
    for (let tick = 0; tick < ticks; tick += 1) {
      history.beginTick(timer.tickIndex);
      mutateHistoryLemmings(manager, tick);
      if (tick > 0 && (tick % 90) === 0) {
        timer.speedFactor = timer.speedFactor === 1 ? 2 : 1;
        skills.selectedSkill = skills.selectedSkill === SkillTypes.BASHER
          ? SkillTypes.DIGGER
          : SkillTypes.BASHER;
      }
      timer.tickIndex += 1;
      history.endTick();
    }
    recordSamples.push(nsToMs(process.hrtime.bigint() - startRecord));

    const applyStartTick = Math.max(0, ticks - seekWindow);
    const startApply = process.hrtime.bigint();
    for (let tick = ticks - 1; tick >= applyStartTick; tick -= 1) {
      history.applyDeltaBackward(game, history.getDelta(tick));
    }
    for (let tick = applyStartTick; tick < ticks; tick += 1) {
      history.applyDeltaForward(game, history.getDelta(tick));
    }
    applySamples.push(nsToMs(process.hrtime.bigint() - startApply));

    if (repeat === repeats) {
      let deltaBytes = 0;
      let nonEmptyDeltas = 0;
      for (let tick = 0; tick < ticks; tick += 1) {
        const delta = history.getDelta(tick);
        if (!delta) continue;
        nonEmptyDeltas += 1;
        deltaBytes += history._packDeltaForStorage(delta).length;
      }
      let keyframeBytes = 0;
      for (const keyframe of history.keyframes) {
        if (keyframe) keyframeBytes += estimateBytes(keyframe);
      }
      lastMetrics = {
        retainedDeltaCount: history.getHistoryStats().deltaCount,
        nonEmptyDeltas,
        avgDeltaBytes: Number((deltaBytes / Math.max(1, nonEmptyDeltas)).toFixed(2)),
        keyframeBytes,
        replayHash: history.computeReplayHash()
      };
    }
  }
  const record = summarizeSamples(recordSamples.slice(1), ticks);
  const apply = summarizeSamples(applySamples.slice(1), seekWindow * 2);
  return {
    endTick: record,
    seekWindowApply: apply,
    ...lastMetrics
  };
};
const runHistoryReplayBench = ({ ticks, seekWindow, repeats }) => ({
  lemmings50: runHistoryScenario({ lemmingCount: 50, ticks, seekWindow, repeats }),
  lemmings200: runHistoryScenario({ lemmingCount: 200, ticks, seekWindow, repeats }),
  lemmings1000: runHistoryScenario({ lemmingCount: 1000, ticks, seekWindow, repeats })
});
export {
  makeHistoryGame,
  mutateHistoryLemmings,
  runHistoryScenario,
  runHistoryReplayBench
};