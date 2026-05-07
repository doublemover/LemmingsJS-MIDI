import {
  ActionBashSystem,
  ActionBlockerSystem,
  ActionBuildSystem,
  ActionClimbSystem,
  ActionCountdownSystem,
  ActionDiggSystem,
  ActionDrowningSystem,
  ActionExitingSystem,
  ActionExplodingSystem,
  ActionFallSystem,
  ActionFloatingSystem,
  ActionFryingSystem,
  ActionHoistSystem,
  ActionJumpSystem,
  ActionMineSystem,
  ActionOhNoSystem,
  ActionShrugSystem,
  ActionSplatterSystem,
  ActionWalkSystem,
  BaseLogger,
  COUNTER_LIMIT,
  Lemming,
  LemmingStateType,
  LogHandler,
  RENDER_MEASURE_DETAIL,
  SkillTypes,
  SoundEffectIds,
  SoundEventTypes,
  TICK_MEASURE_DETAIL,
  TriggerTypes,
  canMeasurePerformance,
  getApp,
  getAppContext,
  getDependency,
  getRuntimeSoundEvents,
  isBenchMode,
  recordPerformanceMeasure
} from './LemmingManagerShared.js';
import { lemmingManagerSpawningMethods } from './LemmingManagerSpawning.js';
import { lemmingManagerInteractionMethods } from './LemmingManagerInteraction.js';
class LemmingManager extends BaseLogger {
  #mmTickCounter = 0;

  #releaseTickIndex = 0;

  constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable, runtime = null) {
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
      this.runtime = runtime;
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
      for (const action of this.actions) {
        action?.setRuntime?.(runtime);
      }
      this.countdownAction?.setRuntime?.(runtime);

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

  dispose() {
    const app = getApp();
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const start = perfEnabled ? performance.now() : 0;
    if (this.lemmings) this.lemmings.length = 0;
    if (this.activeLemmings) this.activeLemmings.length = 0;
    if (this.minimapDots) this.minimapDots = new Uint8Array(0);
    this._minimapDotBuffer = null;
    this._mmVisited = null;
    this._mmVisitStamp = null;
    this.level = null;
    this.runtime = null;
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
    if (perfEnabled) {
      recordPerformanceMeasure('LemmingManager Dispose', {
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
for (const methods of [
  lemmingManagerSpawningMethods,
  lemmingManagerInteractionMethods
]) {
  Object.defineProperties(LemmingManager.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { LemmingManager };