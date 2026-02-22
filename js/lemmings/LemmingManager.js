import { COUNTER_LIMIT } from '../core/constants.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { ActionBashSystem } from '../actions/ActionBashSystem.js';
import { ActionBlockerSystem } from '../actions/ActionBlockerSystem.js';
import { ActionBuildSystem } from '../actions/ActionBuildSystem.js';
import { ActionClimbSystem } from '../actions/ActionClimbSystem.js';
import { ActionCountdownSystem } from '../actions/ActionCountdownSystem.js';
import { ActionDiggSystem } from '../actions/ActionDiggSystem.js';
import { ActionDrowningSystem } from '../actions/ActionDrowningSystem.js';
import { ActionExitingSystem } from '../actions/ActionExitingSystem.js';
import { ActionExplodingSystem } from '../actions/ActionExplodingSystem.js';
import { ActionFallSystem } from '../actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../actions/ActionFloatingSystem.js';
import { ActionFryingSystem } from '../actions/ActionFryingSystem.js';
import { ActionHoistSystem } from '../actions/ActionHoistSystem.js';
import { ActionJumpSystem } from '../actions/ActionJumpSystem.js';
import { ActionMineSystem } from '../actions/ActionMineSystem.js';
import { ActionOhNoSystem } from '../actions/ActionOhNoSystem.js';
import { ActionShrugSystem } from '../actions/ActionShrugSystem.js';
import { ActionSplatterSystem } from '../actions/ActionSplatterSystem.js';
import { ActionWalkSystem } from '../actions/ActionWalkSystem.js';
import { Lemming } from './Lemming.js';
import { LemmingStateType } from './LemmingStateType.js';
import { BaseLogger, LogHandler } from '../util/LogHandler.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { getAppContext, getDependency } from '../core/dependencies.js';

const canMeasurePerformance = () => (typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof performance.measure === 'function');

const TICK_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'LemmingManager',
    trackGroup: 'Game State',
    color: 'tertiary-dark',
    tooltipText: 'tick'
  })
});

const RENDER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'LemmingManager',
    trackGroup: 'Render',
    color: 'tertiary-dark',
    tooltipText: 'render'
  })
});

const getApp = () => getAppContext();
const isBenchMode = (app) => app?.bench || app?.bench2 || app?.benchReverse;

class LemmingManager extends BaseLogger {
  #mmTickCounter = 0;
  #releaseTickIndex = 0;
  constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
    super();
    const endMeasure = this.startMeasure('LemmingManager constructor', {
      track: 'LemmingManager',
      trackGroup: 'Game State',
      color: 'primary',
      tooltipText: 'LemmingManager constructor'
    });
    const app = getApp();
    try {
      if (!isBenchMode(app) && (app?.extraLemmings | 0) === 0) {
        this.lemmings = new Array(gameVictoryCondition.getReleaseCount());
        this.lemmings.length = 0;
      } else {
        this.lemmings = [];
      }
      this.activeLemmings = [];
      this._activeDirty = false;
      this.minimapDots = new Uint8Array(0);
      this.spawnTotal = 0;
      this.selectedIndex = -1;
      const maxDots = (gameVictoryCondition.getReleaseCount() +
          (app?.extraLemmings | 0)) * 2;
      this._minimapDotBuffer = new Uint8Array(maxDots);
      this.minimapDots = this._minimapDotBuffer.subarray(0, 0);
      this._mmVisited = new Uint16Array(65536);
      this._mmVisitStamp = 1;
      this._selectedMiniMapDot = [0, 0];
      if (!LemmingManager.log) {
        LemmingManager.log = this.log;
      }
      this.level = level;
      this.triggerManager = triggerManager;
      this.gameVictoryCondition = gameVictoryCondition;
      this.actions = [];
      this.skillActions = [];
      this.logging = LemmingManager.log;
      this.miniMap = null;
      this.nextNukingLemmingsIndex = -1;
      this._nukeTargets = null;
      this._nukeScratch = [];
      this._nearestCellShift = 4;
      this._nearestGrid = new Map();
      this._nearestGridPool = [];
      this._nearestGridDirty = true;
      this._lemmingPool = [];
      const releaseCount = Math.max(1, gameVictoryCondition.getReleaseCount() || 0);
      this._maxLemmingPoolSize = Math.max(64, releaseCount * 4);

      const WalkSystem = getDependency('ActionWalkSystem', ActionWalkSystem);
      const FallSystem = getDependency('ActionFallSystem', ActionFallSystem);
      const JumpSystem = getDependency('ActionJumpSystem', ActionJumpSystem);
      const DiggSystem = getDependency('ActionDiggSystem', ActionDiggSystem);
      const ExitSystem = getDependency('ActionExitingSystem', ActionExitingSystem);
      const FloatSystem = getDependency('ActionFloatingSystem', ActionFloatingSystem);
      const BlockSystem = getDependency('ActionBlockerSystem', ActionBlockerSystem);
      const MineSystem = getDependency('ActionMineSystem', ActionMineSystem);
      const ClimbSystem = getDependency('ActionClimbSystem', ActionClimbSystem);
      const HoistSystem = getDependency('ActionHoistSystem', ActionHoistSystem);
      const BashSystem = getDependency('ActionBashSystem', ActionBashSystem);
      const BuildSystem = getDependency('ActionBuildSystem', ActionBuildSystem);
      const ShrugSystem = getDependency('ActionShrugSystem', ActionShrugSystem);
      const ExplodeSystem = getDependency('ActionExplodingSystem', ActionExplodingSystem);
      const OhNoSystem = getDependency('ActionOhNoSystem', ActionOhNoSystem);
      const SplatterSystem = getDependency('ActionSplatterSystem', ActionSplatterSystem);
      const DrownSystem = getDependency('ActionDrowningSystem', ActionDrowningSystem);
      const FrySystem = getDependency('ActionFryingSystem', ActionFryingSystem);
      const CountdownSystem = getDependency('ActionCountdownSystem', ActionCountdownSystem);

      this.actions[LemmingStateType.WALKING]    = new WalkSystem(lemmingsSprite);
      this.actions[LemmingStateType.FALLING]    = new FallSystem(lemmingsSprite);
      this.actions[LemmingStateType.JUMPING]    = new JumpSystem(lemmingsSprite);
      this.actions[LemmingStateType.DIGGING]    = new DiggSystem(lemmingsSprite);
      this.actions[LemmingStateType.EXITING]    = new ExitSystem(lemmingsSprite, gameVictoryCondition);
      this.actions[LemmingStateType.FLOATING]   = new FloatSystem(lemmingsSprite);
      this.actions[LemmingStateType.BLOCKING]   = new BlockSystem(lemmingsSprite, triggerManager);
      this.actions[LemmingStateType.MINING]     = new MineSystem(lemmingsSprite, masks);
      this.actions[LemmingStateType.CLIMBING]   = new ClimbSystem(lemmingsSprite);
      this.actions[LemmingStateType.HOISTING]   = new HoistSystem(lemmingsSprite);
      this.actions[LemmingStateType.BASHING]    = new BashSystem(lemmingsSprite, masks);
      this.actions[LemmingStateType.BUILDING]   = new BuildSystem(lemmingsSprite);
      this.actions[LemmingStateType.SHRUG]      = new ShrugSystem(lemmingsSprite);
      this.actions[LemmingStateType.EXPLODING]  = new ExplodeSystem(lemmingsSprite, masks, triggerManager, particleTable);
      this.actions[LemmingStateType.OHNO]       = new OhNoSystem(lemmingsSprite);
      this.actions[LemmingStateType.SPLATTING]  = new SplatterSystem(lemmingsSprite);
      this.actions[LemmingStateType.DROWNING]   = new DrownSystem(lemmingsSprite);
      this.actions[LemmingStateType.FRYING]     = new FrySystem(lemmingsSprite);

      this.skillActions[SkillTypes.DIGGER]  = this.actions[LemmingStateType.DIGGING];
      this.skillActions[SkillTypes.FLOATER] = this.actions[LemmingStateType.FLOATING];
      this.skillActions[SkillTypes.BLOCKER] = this.actions[LemmingStateType.BLOCKING];
      this.skillActions[SkillTypes.MINER]   = this.actions[LemmingStateType.MINING];
      this.skillActions[SkillTypes.CLIMBER] = this.actions[LemmingStateType.CLIMBING];
      this.skillActions[SkillTypes.BASHER]  = this.actions[LemmingStateType.BASHING];
      this.skillActions[SkillTypes.BUILDER] = this.actions[LemmingStateType.BUILDING];
      this.skillActions[SkillTypes.BOMBER]  = new CountdownSystem(masks);
      this.countdownAction = this.skillActions[SkillTypes.BOMBER];

      this.actionTypeByAction = new Map();
      for (let i = 0; i < this.actions.length; i++) {
        const action = this.actions[i];
        if (action) this.actionTypeByAction.set(action, i);
      }

      this._actionTypes = {
        blocker: BlockSystem,
        basher: BashSystem,
        builder: BuildSystem,
        climber: ClimbSystem,
        digger: DiggSystem,
        floater: FloatSystem,
        miner: MineSystem
      };
      const maxSkillType = SkillTypes.DIGGER;
      this._canApplyWhileFalling = new Uint8Array(maxSkillType + 1);
      this._canApplyWhileFalling[SkillTypes.FLOATER] = 1;
      this._canApplyWhileFalling[SkillTypes.CLIMBER] = 1;
      this._canApplyWhileFalling[SkillTypes.BOMBER] = 1;
      this._canApplyWhileFalling[SkillTypes.BUILDER] = 1;
      this._redundantActionBySkill = new Array(maxSkillType + 1);
      this._redundantActionBySkill[SkillTypes.BASHER] = this._actionTypes.basher;
      this._redundantActionBySkill[SkillTypes.BLOCKER] = this._actionTypes.blocker;
      this._redundantActionBySkill[SkillTypes.DIGGER] = this._actionTypes.digger;
      this._redundantActionBySkill[SkillTypes.MINER] = this._actionTypes.miner;
      this._keepBlockerWallBySkill = new Uint8Array(maxSkillType + 1);
      this._keepBlockerWallBySkill[SkillTypes.BOMBER] = 1;
      this._keepBlockerWallBySkill[SkillTypes.CLIMBER] = 1;
      this._keepBlockerWallBySkill[SkillTypes.FLOATER] = 1;
      this._lemmingCtor = getDependency('Lemming', Lemming);

      this.releaseTickIndex = this.gameVictoryCondition.getCurrentReleaseRate() - 30;
    } finally {
      endMeasure();
    }
  }

  get mmTickCounter() { return this.#mmTickCounter; }
  set mmTickCounter(v) {
    if (v >= COUNTER_LIMIT) {
      console.warn('mmTickCounter wrapped, resetting to 0');
      this.#mmTickCounter = 0;
    } else {
      this.#mmTickCounter = v;
    }
  }

  get releaseTickIndex() { return this.#releaseTickIndex; }
  set releaseTickIndex(v) {
    if (v >= COUNTER_LIMIT) {
      console.warn('releaseTickIndex wrapped, resetting to 0');
      this.#releaseTickIndex = 0;
    } else {
      this.#releaseTickIndex = v;
    }
  }

  setMiniMap(miniMap) {
    this.miniMap = miniMap;
  }

  _addActiveLemming(lem) {
    lem._activeIndex = this.activeLemmings.length;
    this.activeLemmings.push(lem);
    this._nearestGridDirty = true;
  }

  _compactActiveLemmings() {
    const lems = this.activeLemmings;
    let write = 0;
    for (let i = 0; i < lems.length; i++) {
      const lem = lems[i];
      if (lem.removed) continue;
      lem._activeIndex = write;
      lems[write++] = lem;
    }
    lems.length = write;
    this._activeDirty = false;
    this._nearestGridDirty = true;
  }

  _nearestCellKey(cx, cy) {
    return ((cy & 0xffff) << 16) | (cx & 0xffff);
  }

  _rebuildNearestGrid() {
    if (!this._nearestGridDirty) return;
    const grid = this._nearestGrid;
    const pool = this._nearestGridPool;
    for (const list of grid.values()) {
      list.length = 0;
      pool.push(list);
    }
    grid.clear();
    const shift = this._nearestCellShift;
    const lems = this.activeLemmings;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed || lem.disabled) continue;
      const cx = lem.x >> shift;
      const cy = lem.y >> shift;
      const key = this._nearestCellKey(cx, cy);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = pool.pop() || [];
        grid.set(key, bucket);
      }
      bucket.push(lem);
    }
    this._nearestGridDirty = false;
  }

  _findNearestInBucket(bucket, x, y, best, bestDist) {
    for (let i = 0; i < bucket.length; i += 1) {
      const lem = bucket[i];
      if (!lem || lem.removed) continue;
      const dist = lem.getClickDistance(x, y);
      if (dist >= 0 && dist < bestDist) {
        bestDist = dist;
        best = lem;
      }
    }
    return { best, bestDist };
  }

  _acquireLemming(x, y, id) {
    const pool = this._lemmingPool;
    const lem = pool.length ? pool.pop() : null;
    if (lem && typeof lem.reset === 'function') {
      lem.reset(x, y, id);
      return lem;
    }
    const LemmingCtor = this._lemmingCtor;
    if (typeof LemmingCtor !== 'function') {
      throw new Error('LemmingManager requires an explicit lemming constructor.');
    }
    return new LemmingCtor(x, y, id);
  }

  _releaseLemming(lem) {
    if (!lem || !this._lemmingPool) return;
    if (this._lemmingPool.length >= this._maxLemmingPoolSize) return;
    this._lemmingPool.push(lem);
  }

  processNewAction(lem, newAction) {
    if (newAction === LemmingStateType.NO_STATE_TYPE) return false;
    this.setLemmingState(lem, newAction);
    return true;
  }

  /**
   * Run one simulation step for a single lemming.
   * Super lemming levels invoke this twice per tick to match classic speed.
   */
  _processLemmingStep(lem, tick) {
    const newAction = lem.process(this.level);
    this.processNewAction(lem, newAction);
    const triggerAction = this.runTrigger(lem, tick);
    this.processNewAction(lem, triggerAction);
  }

  tick() {
    const app = getApp();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      this.addNewLemmings();
      const lems = this.activeLemmings;
      const count = lems.length;
      const tick = this.triggerManager?.gameTimer?.getGameTicks?.() ?? null;
      const stepsPerTick = this.level?.isSuperLemming ? 2 : 1;
      if (this.isNuking()) {
        this._nukeNextLemming();
      }
      for (let i = 0; i < lems.length; i += 1) {
        const lem = lems[i];
        for (let step = 0; step < stepsPerTick; step += 1) {
          if (lem.removed && lem.action !== this.actions[LemmingStateType.EXPLODING]) break;
          this._processLemmingStep(lem, tick);
        }
      }
      const sel = this.getSelectedLemming();
      if (!sel || sel.removed || sel.disabled) this.selectedIndex = -1;
      if (isBenchMode(app)) {
        app.laggedOut = count;
      }
      if (this.miniMap && ((++this.mmTickCounter % 10) === 0)) {
        const lemsCount = lems.length;
        if (this._minimapDotBuffer.length < lemsCount * 2) {
          this._minimapDotBuffer = new Uint8Array(lemsCount * 2);
        }
        const dots = this._minimapDotBuffer;
        const visited = this._mmVisited;
        let visitStamp = (this._mmVisitStamp + 1) & 0xffff;
        if (visitStamp === 0) {
          visited.fill(0);
          visitStamp = 1;
        }
        this._mmVisitStamp = visitStamp;
        const scaleX = this.miniMap.scaleX;
        const scaleY = this.miniMap.scaleY;
        let idx = 0;
        let hasSelectedDot = false;
        for (let i = 0; i < lems.length; i += 1) {
          const lem = lems[i];
          if (lem.removed || lem.disabled) continue;
          const x = (lem.x * scaleX) | 0;
          const y = (lem.y * scaleY) | 0;
          if (lem.id === this.selectedIndex) {
            this._selectedMiniMapDot[0] = x;
            this._selectedMiniMapDot[1] = y;
            hasSelectedDot = true;
          }
          const key = (y << 8) | x;
          if (visited[key] === visitStamp) continue;
          visited[key] = visitStamp;
          dots[idx++] = x;
          dots[idx++] = y;
        }
        this.minimapDots = dots.subarray(0, idx);
        this.miniMap.setLiveDots(this.minimapDots);
        this.miniMap.setSelectedDot(hasSelectedDot ? this._selectedMiniMapDot : null);
      }
      if (this._activeDirty) {
        this._compactActiveLemmings();
      }
      this._nearestGridDirty = true;
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('tick', {
            start: perfStart,
            detail: TICK_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }

  addLemming(x, y) {
    const app = getApp();
    const startingLemLength = this.lemmings.length;
    const lem = this._acquireLemming(x, y, startingLemLength);
    if (isBenchMode(app)) {
      lem.lookRight = Math.random() < 0.5;
    }
    this.setLemmingState(lem, LemmingStateType.FALLING);
    this.lemmings.push(lem);
    this._addActiveLemming(lem);
    this.spawnTotal += 1;

    const extraCount = app?.extraLemmings | 0;
    if (extraCount > 0) {
      const action = this.actions[LemmingStateType.FALLING];
      const extras = new Array(extraCount);
      for (let i = 0; i < extraCount; i++) {
        const extra = this._acquireLemming(
          x,
          y,
          startingLemLength + 1 + i
        );
        if (isBenchMode(app)) {
          extra.lookRight = Math.random() < 0.5;
        }
        extra.setAction(action);
        extras[i] = extra;
        this._addActiveLemming(extra);
      }
      Array.prototype.push.apply(this.lemmings, extras);
      this.spawnTotal += extraCount;
    }
    this._nearestGridDirty = true;
  }

  addNewLemmings() {
    const app = getApp();
    const endless = app?.endless === true;
    if (app?.bench === true || app?.bench2 === true || app?.benchReverse === true) { // if bench is enabled just keep spawning lems by skipping gameVictoryCondition check
            
    } else {
      if (!endless && this.gameVictoryCondition.getLeftCount() <= 0) return;
    }
    if (++this.releaseTickIndex >= (104 - this.gameVictoryCondition.getCurrentReleaseRate())) {
      this.releaseTickIndex = 0;
      const entrances = this.level.entrances;
      for (let i = 0, l = entrances.length; i < l; i++) {
        const entrance = entrances[i];
        const spawnX = entrance.x + 24;
        const spawnY = entrance.y + 14;
        if (!entrance._opened) {
          entrance._opened = true;
          const soundBus = getSoundBus();
          soundBus?.emitSfx?.(
            SoundEventTypes.ENTRANCE_OPEN,
            SoundEffectIds.ENTRANCE_OPEN,
            {
              entranceIndex: i,
              x: spawnX,
              y: spawnY
            }
          );
        }
        this.addLemming(spawnX, spawnY);
        this.gameVictoryCondition.releaseOne();
      }
    }
  }

  runTrigger(lem, tickOverride = null) {
    if (lem.isRemoved() || lem.isDisabled()) {
      // this.lemmings.splice(this.lemmings.indexOf(lem), 1);
      return LemmingStateType.NO_STATE_TYPE;
    }
    const triggerType = this.triggerManager.trigger(lem.x, lem.y, lem, tickOverride);
    switch (triggerType) {
    case TriggerTypes.NO_TRIGGER:
    case TriggerTypes.DISABLED:
      return LemmingStateType.NO_STATE_TYPE;
    case TriggerTypes.DROWN:
      lem.lastTriggerType = triggerType;
      return LemmingStateType.DROWNING;
    case TriggerTypes.EXIT_LEVEL:
      lem.lastTriggerType = triggerType;
      return LemmingStateType.EXITING;
    case TriggerTypes.KILL:
      lem.lastTriggerType = triggerType;
      return LemmingStateType.SPLATTING;
    case TriggerTypes.FRYING:
      lem.lastTriggerType = triggerType;
      return LemmingStateType.FRYING;
    case TriggerTypes.UNKNOWN_2:
    case TriggerTypes.UNKNOWN_3:
    case TriggerTypes.TRAP:
      lem.lastTriggerType = triggerType;
      return LemmingStateType.SPLATTING;
    case TriggerTypes.BLOCKER_LEFT:
      if (lem.lookRight) lem.lookRight = false;
      return LemmingStateType.NO_STATE_TYPE;
    case TriggerTypes.BLOCKER_RIGHT:
      if (!lem.lookRight) lem.lookRight = true;
      return LemmingStateType.NO_STATE_TYPE;
    default:
      this.logging.log('unknown trigger type: ' + triggerType);
      return LemmingStateType.NO_STATE_TYPE;
    }
  }

  render(gameDisplay) {
    const app = getApp();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      const stage = gameDisplay?.stage;
      const view = stage?.getGameViewRect?.();
      let minX = -Infinity;
      let maxX = Infinity;
      let minY = -Infinity;
      let maxY = Infinity;
      if (view) {
        const pad = 16;
        minX = view.x - pad;
        maxX = view.x + view.w + pad;
        minY = view.y - pad;
        maxY = view.y + view.h + pad;
      }
      const lems = this.activeLemmings;
      for (let i = 0; i < lems.length; i += 1) {
        const lem = lems[i];
        if (lem.removed) continue;
        if (lem.x < minX || lem.x > maxX || lem.y < minY || lem.y > maxY) continue;
        lem.render(gameDisplay);
      }
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('render', {
            start: perfStart,
            detail: RENDER_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }

  renderDebug(gameDisplay) {
    const stage = gameDisplay?.stage;
    const view = stage?.getGameViewRect?.();
    let minX = -Infinity;
    let maxX = Infinity;
    let minY = -Infinity;
    let maxY = Infinity;
    if (view) {
      const pad = 16;
      minX = view.x - pad;
      maxX = view.x + view.w + pad;
      minY = view.y - pad;
      maxY = view.y + view.h + pad;
    }
    const lems = this.activeLemmings;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (lem.removed) continue;
      if (lem.x < minX || lem.x > maxX || lem.y < minY || lem.y > maxY) continue;
      lem.renderDebug(gameDisplay);
    }
  }

  getLemming(id) {
    return this.lemmings[id] ?? null;
  }

  getSelectedLemming() {
    const lem = this.getLemming(this.selectedIndex);
    if (!lem || lem.removed || lem.disabled) return null;
    return lem;
  }

  setSelectedLemming(lem) {
    this.selectedIndex = lem?.id ?? -1;
  }

  getLemmings() {
    return this.activeLemmings;
  }

  getLemmingAt(x, y, radius = 6) {
    return this.getNearestLemming(x, y);
  }

  getNearestLemming(x, y) {
    this._rebuildNearestGrid();
    const shift = this._nearestCellShift;
    const cx = x >> shift;
    const cy = y >> shift;

    let best = null;
    let bestDist = Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = this._nearestCellKey(cx + dx, cy + dy);
        const bucket = this._nearestGrid.get(key);
        if (!bucket?.length) continue;
        ({ best, bestDist } = this._findNearestInBucket(bucket, x, y, best, bestDist));
      }
    }
    if (best) return best;

    const lems = this.activeLemmings;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed) continue;
      const dist = lem.getClickDistance(x, y);
      if (dist >= 0 && dist < bestDist) {
        bestDist = dist;
        best = lem;
      }
    }
    return best;
  }

  getLemmingsInMask(mask, x, y) {
    const out = [];
    const lems = this.activeLemmings;
    const left = x + mask.offsetX;
    const right = left + mask.width;
    const top = y + mask.offsetY;
    const bottom = top + mask.height;
    for (let i = 0; i < lems.length; i += 1) {
      const val = lems[i];
      if (val.removed) continue;
      const lx = val.x;
      const ly = val.y;
      if (lx > left && lx < right && ly > top && ly < bottom) out.push(val);
    }
    return out;
  }

  setLemmingState(lem, stateType) {
    if (lem.countdown > 0) {
      const lethal =
            stateType === LemmingStateType.DROWNING   ||
            stateType === LemmingStateType.SPLATTING  ||
            stateType === LemmingStateType.FRYING;
      if (lethal) {
        lem.countdown = 0;
        lem.countdownAction = null;
      }
    }
    if (stateType === LemmingStateType.OUT_OF_LEVEL) {
      this.removeOne(lem);
      return;
    }
    const actionSystem = this.actions[stateType];
    if (!actionSystem) {
      this.removeOne(lem);
      this.logging.log(lem.id + ' Action: Error not an action: ' + LemmingStateType[stateType]);
      return;
    } else {
      const app = getApp();
      if (this.activeLemmings.length <= 50 && (app?.gameSpeedFactor ?? 1) <= 1) {
        this.logging.debug(lem.id + ' Action: ' + actionSystem.getActionName());
      }
    }
    if (stateType === LemmingStateType.EXPLODING) {
      lem.hasExploded = true;
    }
    lem.setAction(actionSystem);
  }

  doLemmingAction(lem, skillType) {
    if (!lem) {
      return false;
    }
    const actionSystem = this.skillActions[skillType];
    if (!actionSystem) {
      this.logging.log(lem.id + ' Unknown Action: ' + skillType);
      return false;
    }
    if (lem.action === this.actions[LemmingStateType.FALLING]) {
      if (!this._canApplyWhileFalling?.[skillType]) {
        return false;
      }
    }
    const redundant = this._redundantActionBySkill?.[skillType] ?? null;
    const alreadyDoingIt =
        redundant && (lem.action instanceof redundant);
    if (alreadyDoingIt) {
      return false;
    }
    const wasBlocking = this._actionTypes?.blocker
      ? (lem.action instanceof this._actionTypes.blocker)
      : false;
    const ok = actionSystem.triggerLemAction(lem);
    if (ok && wasBlocking) {
      if (!this._keepBlockerWallBySkill?.[skillType]) {
        this.triggerManager.removeByOwner(lem);
      }
    }
    return ok;
  }

  isNuking() { return this.nextNukingLemmingsIndex >= 0; }
  doNukeAllLemmings() {
    const scratch = this._nukeScratch;
    let count = 0;
    const lems = this.activeLemmings;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed || lem.disabled) continue;
      scratch[count] = lem;
      count += 1;
    }
    scratch.length = count;
    this._nukeTargets = scratch;
    this.nextNukingLemmingsIndex = count ? 0 : -1;
  }

  _nukeNextLemming() {
    const lems = this._nukeTargets || [];
    const count = lems.length;
    if (count <= 0) return;
    if (this.nextNukingLemmingsIndex >= count) {
      this.nextNukingLemmingsIndex = -1;
      this._nukeTargets = null;
      return;
    }
    let attempts = 0;
    while (attempts < count && this.nextNukingLemmingsIndex >= 0) {
      const idx = this.nextNukingLemmingsIndex;
      if (idx >= count) {
        this.nextNukingLemmingsIndex = -1;
        this._nukeTargets = null;
        return;
      }
      const lem = lems[idx];
      let applied = false;
      if (lem && !lem.removed && !lem.disabled) {
        applied = this.doLemmingAction(lem, SkillTypes.BOMBER);
      }
      if (idx + 1 >= count) {
        this.nextNukingLemmingsIndex = -1;
        this._nukeTargets = null;
      } else {
        this.nextNukingLemmingsIndex = idx + 1;
      }
      if (applied) break;
      attempts++;
    }
  }

  removeOne(lem) {
    if (!lem || lem.removed) return;
    if (this.miniMap &&
            lem.action !== this.actions[LemmingStateType.EXITING]) {
      this.miniMap.addDeath(lem.x, lem.y);
    }
    const lemId = lem.id;
    lem.remove();
    this._releaseLemming(lem);
    if (lemId !== null && lemId !== undefined) this.lemmings[lemId] = null;
    this._activeDirty = true;
    this._nearestGridDirty = true;
    this.gameVictoryCondition.removeOne();
  }

  cycleSelection(dir = 1) {
    const lems = this.activeLemmings;
    if (!lems?.length) return null;
    const total = lems.length;
    const current = this.getSelectedLemming();
    let idx = current?._activeIndex ?? 0;
    for (let i = 0; i < total; i++) {
      idx = (idx + dir + total) % total;
      const lem = lems[idx];
      if (!lem.removed && !lem.disabled) {
        this.setSelectedLemming(lem);
        return lem;
      }
    }
    this.selectedIndex = -1;
    return null;
  }

  dispose() {
    const start = performance.now();
    if (this.lemmings) this.lemmings.length = 0;
    if (this.activeLemmings) this.activeLemmings.length = 0;
    if (this.minimapDots) this.minimapDots = new Uint8Array(0);
    this._minimapDotBuffer = null;
    this._mmVisited = null;
    this._mmVisitStamp = null;
    this.level = null;
    this.triggerManager = null;
    this.gameVictoryCondition = null;
    this.skillActions.length = 0;
    this.#releaseTickIndex = null;
    const Handler = getDependency('LogHandler', LogHandler);
    this.logging = new Handler('LemmingManager');
    this.miniMap = null;
    this.#mmTickCounter = null;
    this.nextNukingLemmingsIndex = null;
    this._nukeTargets = null;
    this._nukeScratch = null;
    this._nearestGrid = null;
    this._nearestGridPool = null;
    if (this._lemmingPool) this._lemmingPool.length = 0;
    this._lemmingPool = null;
    this._maxLemmingPoolSize = null;
    this.selectedIndex = null;
    const app = getApp();
    if ((app?.performanceAPI === true || app?.perfMetrics === true) &&
            typeof performance !== 'undefined' &&
            typeof performance.measure === 'function') {
      performance.measure('LemmingManager Dispose', {
        start,
        detail: {
          devtools: {
            track: 'LemmingManager',
            trackGroup: 'Game State',
            color: 'error',
            tooltipText: 'LemmingManager Dispose'
          }
        }
      });
    }
  }
}

export { LemmingManager };
