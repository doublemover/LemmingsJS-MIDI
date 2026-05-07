import { HistoryStore } from '../../js/game/HistoryStore.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';

const createStubTimer = () => ({
  tickIndex: 0,
  speedFactor: 1,
  frameTime: 60,
  onBeforeGameTick: { on() {}, off() {} },
  onGameTick: { on() {}, off() {} }
});


const createHistoryFixture = () => {
  const timer = createStubTimer();
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
    _nukeTargets: null,
    miniMap: null,
    _lemmingCtor: function ReplayCtor(x, y, id) {
      this.x = x;
      this.y = y;
      this.id = id;
    },
    getLemming: (id) => manager.lemmings[id] ?? null
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
  const level = {
    entrances: [{ _opened: false }],
    groundMask: { mask: new Uint8Array(4) },
    groundImage: new Uint8ClampedArray(16),
    objects: [],
    triggers: []
  };
  const triggerManager = {
    _triggers: new Set(),
    add(trigger) { this._triggers.add(trigger); },
    removeByOwner(owner) {
      for (const trig of Array.from(this._triggers)) {
        if (trig.owner === owner) this._triggers.delete(trig);
      }
    }
  };
  const game = {
    level,
    triggerManager,
    finalGameState: 0,
    getLemmingManager: () => manager,
    getGameTimer: () => timer,
    getGameSkills: () => skills,
    getVictoryCondition: () => victory
  };
  const history = new HistoryStore({ keyframeInterval: 5 });
  history.attach(game, { captureBaseline: true });
  return {
    history,
    game,
    timer,
    manager,
    skills,
    victory,
    level,
    triggerManager,
    lemming,
    walkAction,
    bomberAction
  };
};

const recordTick = (history, timer, tickIndex, mutate, nextTick = tickIndex + 1) => {
  history.beginTick(tickIndex);
  if (mutate) mutate();
  if (timer) timer.tickIndex = nextTick;
  history.endTick();
};

const runHistoryOps = (history, ops) => {
  for (const [method, ...args] of ops) {
    history[method](...args);
  }
};

const scenario = (history, timer) => {
  const api = {
    tick(tickIndex, { ops = null, mutate = null, nextTick } = {}) {
      recordTick(history, timer, tickIndex, () => {
        if (ops && ops.length) runHistoryOps(history, ops);
        if (mutate) mutate();
      }, nextTick);
      return api;
    }
  };
  return api;
};

const seedHistory = (history, { deltas = [], keyframes = [] } = {}) => {
  for (const tick of deltas) {
    history._setDelta(tick, history._allocDelta(tick));
  }
  for (const tick of keyframes) {
    history._setKeyframe(tick, { tickIndex: tick });
  }
};

export {
  createHistoryFixture,
  createStubTimer,
  recordTick,
  runHistoryOps,
  scenario,
  seedHistory
};
