import { COUNTER_LIMIT } from './core/constants.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';
import { ActionBashSystem } from './ActionBashSystem.js';
import { ActionBlockerSystem } from './ActionBlockerSystem.js';
import { ActionBuildSystem } from './ActionBuildSystem.js';
import { ActionClimbSystem } from './ActionClimbSystem.js';
import { ActionCountdownSystem } from './ActionCountdownSystem.js';
import { ActionDiggSystem } from './ActionDiggSystem.js';
import { ActionDrowningSystem } from './ActionDrowningSystem.js';
import { ActionExitingSystem } from './ActionExitingSystem.js';
import { ActionExplodingSystem } from './ActionExplodingSystem.js';
import { ActionFallSystem } from './ActionFallSystem.js';
import { ActionFloatingSystem } from './ActionFloatingSystem.js';
import { ActionFryingSystem } from './ActionFryingSystem.js';
import { ActionHoistSystem } from './ActionHoistSystem.js';
import { ActionJumpSystem } from './ActionJumpSystem.js';
import { ActionMineSystem } from './ActionMineSystem.js';
import { ActionOhNoSystem } from './ActionOhNoSystem.js';
import { ActionShrugSystem } from './ActionShrugSystem.js';
import { ActionSplatterSystem } from './ActionSplatterSystem.js';
import { ActionWalkSystem } from './ActionWalkSystem.js';
import { Lemming } from './Lemming.js';
import { LemmingStateType } from './LemmingStateType.js';
import { BaseLogger, LogHandler, withPerformance } from './LogHandler.js';
import { SkillTypes } from './SkillTypes.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getDependency } from './core/dependencies.js';

class LemmingManager extends BaseLogger {
  #mmTickCounter = 0;
  #releaseTickIndex = 0;
  constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
    super();
    withPerformance(
      'LemmingManager constructor',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'primary',
        tooltipText: 'LemmingManager constructor'
      },
      () => {
        if (!lemmings.bench && (lemmings.extraLemmings | 0) === 0) {
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
          (lemmings.extraLemmings | 0)) * 2;
        this._minimapDotBuffer = new Uint8Array(maxDots);
        this.minimapDots = this._minimapDotBuffer.subarray(0, 0);
        this._mmVisited = new Uint8Array(65536);
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

        this._actionTypes = {
          blocker: BlockSystem,
          basher: BashSystem,
          builder: BuildSystem,
          climber: ClimbSystem,
          digger: DiggSystem,
          floater: FloatSystem,
          miner: MineSystem
        };
        this._lemmingCtor = getDependency('Lemming', Lemming);

        this.releaseTickIndex = this.gameVictoryCondition.getCurrentReleaseRate() - 30;
      })();
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
  }

  processNewAction(lem, newAction) {
    if (newAction == LemmingStateType.NO_STATE_TYPE) return false;
    this.setLemmingState(lem, newAction);
    return true;
  }

  tick() {
    const tickNum = this.mmTickCounter;
    withPerformance(
      'tick',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'tertiary-dark',
        tooltipText: `tick ${tickNum}`
      },
      () => {
        this.addNewLemmings();
        const lems = this.activeLemmings;
        const count = lems.length;
        if (this.isNuking()) {
          this._nukeNextLemming();
        }
        for (const lem of lems) {
          if (lem.removed && lem.action !== this.actions[LemmingStateType.EXPLODING]) continue;
          const newAction = lem.process(this.level);
          this.processNewAction(lem, newAction);
          const triggerAction = this.runTrigger(lem);
          this.processNewAction(lem, triggerAction);
        }
        const sel = this.getSelectedLemming();
        if (!sel || sel.removed || sel.disabled) this.selectedIndex = -1;
        if (lemmings.bench) {
          lemmings.laggedOut = count;
        }
        if (this.miniMap && ((++this.mmTickCounter % 10) === 0)) {
          const lemsCount = lems.length;
          if (this._minimapDotBuffer.length < lemsCount * 2) {
            this._minimapDotBuffer = new Uint8Array(lemsCount * 2);
          }
          const dots = this._minimapDotBuffer;
          const visited = this._mmVisited;
          visited.fill(0);
          const scaleX = this.miniMap.scaleX;
          const scaleY = this.miniMap.scaleY;
          let idx = 0;
          let selDot = null;
          for (const lem of lems) {
            if (lem.removed || lem.disabled) continue;
            const x = (lem.x * scaleX) | 0;
            const y = (lem.y * scaleY) | 0;
            if (lem.id === this.selectedIndex) selDot = [x, y];
            const key = (y << 8) | x;
            if (visited[key]) continue;
            visited[key] = 1;
            dots[idx++] = x;
            dots[idx++] = y;
          }
          this.minimapDots = dots.subarray(0, idx);
          this.miniMap.setLiveDots(this.minimapDots);
          this.miniMap.setSelectedDot(selDot);
        }
        if (this._activeDirty) {
          this._compactActiveLemmings();
        }
      })();
  }

  addLemming(x, y) {
    withPerformance(
      'addLemming',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'primary-light',
        tooltipText: `addLemming ${x},${y}`
      },
      () => {
        const startingLemLength = this.lemmings.length;
        const LemmingCtor = this._lemmingCtor || Lemming;
        const lem = new LemmingCtor(x, y, startingLemLength);
        if (lemmings.bench) {
          lem.lookRight = Math.random() < 0.5;
        }
        this.setLemmingState(lem, LemmingStateType.FALLING);
        this.lemmings.push(lem);
        this._addActiveLemming(lem);
        this.spawnTotal += 1;

        const extraCount = lemmings.extraLemmings | 0;
        if (extraCount > 0) {
          const action = this.actions[LemmingStateType.FALLING];
          const extras = new Array(extraCount);
          for (let i = 0; i < extraCount; i++) {
            const extra = new LemmingCtor(
              x,
              y,
              startingLemLength + 1 + i
            );
            if (lemmings.bench) {
              extra.lookRight = Math.random() < 0.5;
            }
            extra.setAction(action);
            extras[i] = extra;
            this._addActiveLemming(extra);
          }
          Array.prototype.push.apply(this.lemmings, extras);
          this.spawnTotal += extraCount;
        }
      })();
  }

  addNewLemmings() {
    const endless = lemmings?.endless === true;
    if (lemmings.bench == true) { // if bench is enabled just keep spawning lems by skipping gameVictoryCondition check
            
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

  runTrigger(lem) {
    if (lem.isRemoved() || lem.isDisabled()) {
      // this.lemmings.splice(this.lemmings.indexOf(lem), 1);
      return LemmingStateType.NO_STATE_TYPE;
    }
    const triggerType = this.triggerManager.trigger(lem.x, lem.y, lem);
    switch (triggerType) {
    case TriggerTypes.NO_TRIGGER:
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
    withPerformance(
      'render',
      {
        track: 'LemmingManager',
        trackGroup: 'Render',
        color: 'tertiary-dark',
        tooltipText: 'render'
      },
      () => {
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
        for (const lem of this.activeLemmings) {
          if (lem.removed) continue;
          if (lem.x < minX || lem.x > maxX || lem.y < minY || lem.y > maxY) continue;
          lem.render(gameDisplay);
        }
      })();
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
    for (const lem of this.activeLemmings) {
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
    let best = null;
    let bestDist = Infinity;
    for (const lem of this.activeLemmings) {
      if (lem.removed) continue;
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
    for (const val of lems) {
      if (val.removed) continue;
      const lx = val.x;
      const ly = val.y;
      if (lx > left && lx < right && ly > top && ly < bottom) out.push(val);
    }
    return out;
  }

  setLemmingState(lem, stateType) {
    withPerformance(
      'setLemmingState',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'secondary-light',
        tooltipText: `setLemmingState ${lem.id}`
      },
      () => {
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
        if (stateType == LemmingStateType.OUT_OF_LEVEL) {
          withPerformance(
            'removeOne',
            {
              track: 'LemmingManager',
              trackGroup: 'Game State',
              color: 'secondary-dark',
              tooltipText: `removeOne ${lem.id}`
            },
            () => {
              this.removeOne(lem);
            }
          )();
          return;
        }
        const actionSystem = this.actions[stateType];
        if (!actionSystem) {
          this.removeOne(lem);
          this.logging.log(lem.id + ' Action: Error not an action: ' + LemmingStateType[stateType]);
          return;
        } else {
          if (this.activeLemmings.length <= 50 && (lemmings?.gameSpeedFactor ?? 1) <= 1) {
            this.logging.debug(lem.id + ' Action: ' + actionSystem.getActionName());
          }
        }
        if (stateType === LemmingStateType.EXPLODING) {
          lem.hasExploded = true;
        }
        lem.setAction(actionSystem);
      })();
  }

  doLemmingAction(lem, skillType) {
    return withPerformance(
      'doLemmingAction',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'secondary-dark',
        tooltipText: `doLemmingAction ${skillType}`
      },
      () => {
        if (!lem) {
          return false;
        }
        const actionSystem = this.skillActions[skillType];
        if (!actionSystem) {
          this.logging.log(lem.id + ' Unknown Action: ' + skillType);
          return false;
        }
        const canApplyWhileFalling = {
          [SkillTypes.FLOATER]: this._actionTypes?.floater,
          [SkillTypes.CLIMBER]: this._actionTypes?.climber,
          [SkillTypes.BOMBER]: this.skillActions[SkillTypes.BOMBER],
          [SkillTypes.BUILDER]: this._actionTypes?.builder
        };
        if (lem.action == this.actions[LemmingStateType.FALLING]) {
          if (!canApplyWhileFalling[skillType]) {
            return false;
          }
        }
        const redundant = {
          [SkillTypes.BASHER]: this._actionTypes?.basher,
          [SkillTypes.BLOCKER]: this._actionTypes?.blocker,
          [SkillTypes.DIGGER]: this._actionTypes?.digger,
          [SkillTypes.MINER]: this._actionTypes?.miner
        };
        const alreadyDoingIt =
            redundant[skillType] && (lem.action instanceof redundant[skillType]);
        if (alreadyDoingIt) {
          return false;
        }
        const wasBlocking = this._actionTypes?.blocker
          ? (lem.action instanceof this._actionTypes.blocker)
          : false;
        const ok = actionSystem.triggerLemAction(lem);
        if (ok && wasBlocking) {
          const keepWall =
                skillType === SkillTypes.BOMBER ||
                skillType === SkillTypes.CLIMBER ||
                skillType === SkillTypes.FLOATER;
          if (!keepWall) {
            this.triggerManager.removeByOwner(lem);
          }
        }
        const result = ok;
        return result;
      }).call(this);
  }

  isNuking() { return this.nextNukingLemmingsIndex >= 0; }
  doNukeAllLemmings() {
    const targets = this.activeLemmings.filter(lem => lem && !lem.removed && !lem.disabled);
    this._nukeTargets = targets;
    this.nextNukingLemmingsIndex = targets.length ? 0 : -1;
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
    if (this.miniMap &&
            lem.action !== this.actions[LemmingStateType.EXITING]) {
      this.miniMap.addDeath(lem.x, lem.y);
    }
    const lemId = lem.id;
    lem.remove();
    if (lemId !== null && lemId !== undefined) this.lemmings[lemId] = null;
    this._activeDirty = true;
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
    this.selectedIndex = null;
    if (typeof lemmings !== 'undefined' &&
            lemmings.perfMetrics === true &&
            lemmings.debug === true &&
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
