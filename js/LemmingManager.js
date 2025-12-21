import { Lemmings } from './LemmingsNamespace.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';
import './LogHandler.js';
import './ActionWalkSystem.js';
import './ActionFallSystem.js';
import './ActionJumpSystem.js';
import './ActionDiggSystem.js';
import './ActionExitingSystem.js';
import './ActionFloatingSystem.js';
import './ActionBlockerSystem.js';
import './ActionMineSystem.js';
import './ActionClimbSystem.js';
import './ActionHoistSystem.js';
import './ActionBashSystem.js';
import './ActionBuildSystem.js';
import './ActionShrugSystem.js';
import './ActionExplodingSystem.js';
import './ActionOhNoSystem.js';
import './ActionSplatterSystem.js';
import './ActionDrowningSystem.js';
import './ActionFryingSystem.js';
import './ActionCountdownSystem.js';
import './LemmingStateType.js';
import './Lemming.js';
import './SpriteTypes.js';
import './MaskTypes.js';
import './LemmingsBootstrap.js';

class LemmingManager extends Lemmings.BaseLogger {
  #mmTickCounter = 0;
  #releaseTickIndex = 0;
  constructor(level, lemmingsSprite, triggerManager, gameVictoryCondition, masks, particleTable) {
    super();
    Lemmings.withPerformance(
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

        this.actions[Lemmings.LemmingStateType.WALKING]    = new Lemmings.ActionWalkSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.FALLING]    = new Lemmings.ActionFallSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.JUMPING]    = new Lemmings.ActionJumpSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.DIGGING]    = new Lemmings.ActionDiggSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.EXITING]    = new Lemmings.ActionExitingSystem(lemmingsSprite, gameVictoryCondition);
        this.actions[Lemmings.LemmingStateType.FLOATING]   = new Lemmings.ActionFloatingSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.BLOCKING]   = new Lemmings.ActionBlockerSystem(lemmingsSprite, triggerManager);
        this.actions[Lemmings.LemmingStateType.MINING]     = new Lemmings.ActionMineSystem(lemmingsSprite, masks);
        this.actions[Lemmings.LemmingStateType.CLIMBING]   = new Lemmings.ActionClimbSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.HOISTING]   = new Lemmings.ActionHoistSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.BASHING]    = new Lemmings.ActionBashSystem(lemmingsSprite, masks);
        this.actions[Lemmings.LemmingStateType.BUILDING]   = new Lemmings.ActionBuildSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.SHRUG]      = new Lemmings.ActionShrugSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.EXPLODING]  = new Lemmings.ActionExplodingSystem(lemmingsSprite, masks, triggerManager, particleTable);
        this.actions[Lemmings.LemmingStateType.OHNO]       = new Lemmings.ActionOhNoSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.SPLATTING]  = new Lemmings.ActionSplatterSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.DROWNING]   = new Lemmings.ActionDrowningSystem(lemmingsSprite);
        this.actions[Lemmings.LemmingStateType.FRYING]     = new Lemmings.ActionFryingSystem(lemmingsSprite);

        this.skillActions[Lemmings.SkillTypes.DIGGER]  = this.actions[Lemmings.LemmingStateType.DIGGING];
        this.skillActions[Lemmings.SkillTypes.FLOATER] = this.actions[Lemmings.LemmingStateType.FLOATING];
        this.skillActions[Lemmings.SkillTypes.BLOCKER] = this.actions[Lemmings.LemmingStateType.BLOCKING];
        this.skillActions[Lemmings.SkillTypes.MINER]   = this.actions[Lemmings.LemmingStateType.MINING];
        this.skillActions[Lemmings.SkillTypes.CLIMBER] = this.actions[Lemmings.LemmingStateType.CLIMBING];
        this.skillActions[Lemmings.SkillTypes.BASHER]  = this.actions[Lemmings.LemmingStateType.BASHING];
        this.skillActions[Lemmings.SkillTypes.BUILDER] = this.actions[Lemmings.LemmingStateType.BUILDING];
        this.skillActions[Lemmings.SkillTypes.BOMBER]  = new Lemmings.ActionCountdownSystem(masks);

        this.releaseTickIndex = this.gameVictoryCondition.getCurrentReleaseRate() - 30;
      })();
  }

  get mmTickCounter() { return this.#mmTickCounter; }
  set mmTickCounter(v) {
    if (v >= Lemmings.COUNTER_LIMIT) {
      console.warn('mmTickCounter wrapped, resetting to 0');
      this.#mmTickCounter = 0;
    } else {
      this.#mmTickCounter = v;
    }
  }

  get releaseTickIndex() { return this.#releaseTickIndex; }
  set releaseTickIndex(v) {
    if (v >= Lemmings.COUNTER_LIMIT) {
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
    if (newAction == Lemmings.LemmingStateType.NO_STATE_TYPE) return false;
    this.setLemmingState(lem, newAction);
    return true;
  }

  tick() {
    const tickNum = this.mmTickCounter;
    Lemmings.withPerformance(
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
          if (lem.removed && lem.action !== this.actions[Lemmings.LemmingStateType.EXPLODING]) continue;
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
    Lemmings.withPerformance(
      'addLemming',
      {
        track: 'LemmingManager',
        trackGroup: 'Game State',
        color: 'primary-light',
        tooltipText: `addLemming ${x},${y}`
      },
      () => {
        const startingLemLength = this.lemmings.length;
        const lem = new Lemmings.Lemming(x, y, startingLemLength);
        if (lemmings.bench) {
          lem.lookRight = Math.random() < 0.5;
        }
        this.setLemmingState(lem, Lemmings.LemmingStateType.FALLING);
        this.lemmings.push(lem);
        this._addActiveLemming(lem);
        this.spawnTotal += 1;

        const extraCount = lemmings.extraLemmings | 0;
        if (extraCount > 0) {
          const action = this.actions[Lemmings.LemmingStateType.FALLING];
          const extras = new Array(extraCount);
          for (let i = 0; i < extraCount; i++) {
            const extra = new Lemmings.Lemming(
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
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
    const triggerType = this.triggerManager.trigger(lem.x, lem.y, lem);
    switch (triggerType) {
    case Lemmings.TriggerTypes.NO_TRIGGER:
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    case Lemmings.TriggerTypes.DROWN:
      lem.lastTriggerType = triggerType;
      return Lemmings.LemmingStateType.DROWNING;
    case Lemmings.TriggerTypes.EXIT_LEVEL:
      lem.lastTriggerType = triggerType;
      return Lemmings.LemmingStateType.EXITING;
    case Lemmings.TriggerTypes.KILL:
      lem.lastTriggerType = triggerType;
      return Lemmings.LemmingStateType.SPLATTING;
    case Lemmings.TriggerTypes.FRYING:
      lem.lastTriggerType = triggerType;
      return Lemmings.LemmingStateType.FRYING;
    case Lemmings.TriggerTypes.TRAP:
      lem.lastTriggerType = triggerType;
      return Lemmings.LemmingStateType.SPLATTING;
    case Lemmings.TriggerTypes.BLOCKER_LEFT:
      if (lem.lookRight) lem.lookRight = false;
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    case Lemmings.TriggerTypes.BLOCKER_RIGHT:
      if (!lem.lookRight) lem.lookRight = true;
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    default:
      this.logging.log('unknown trigger type: ' + triggerType);
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
  }

  render(gameDisplay) {
    Lemmings.withPerformance(
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
    Lemmings.withPerformance(
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
                stateType === Lemmings.LemmingStateType.DROWNING   ||
                stateType === Lemmings.LemmingStateType.SPLATTING  ||
                stateType === Lemmings.LemmingStateType.FRYING;
          if (lethal) {
            lem.countdown = 0;
            lem.countdownAction = null;
          }
        }
        if (stateType == Lemmings.LemmingStateType.OUT_OF_LEVEL) {
          Lemmings.withPerformance(
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
          this.logging.log(lem.id + ' Action: Error not an action: ' + Lemmings.LemmingStateType[stateType]);
          return;
        } else {
          if (this.activeLemmings.length <= 50 && (lemmings?.gameSpeedFactor ?? 1) <= 1) {
            this.logging.debug(lem.id + ' Action: ' + actionSystem.getActionName());
          }
        }
        if (stateType === Lemmings.LemmingStateType.EXPLODING) {
          lem.hasExploded = true;
        }
        lem.setAction(actionSystem);
      })();
  }

  doLemmingAction(lem, skillType) {
    return Lemmings.withPerformance(
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
          [Lemmings.SkillTypes.FLOATER]: Lemmings.ActionFloatingSystem,
          [Lemmings.SkillTypes.CLIMBER]: Lemmings.ActionClimbSystem,
          [Lemmings.SkillTypes.BOMBER]: this.skillActions[Lemmings.SkillTypes.BOMBER],
          [Lemmings.SkillTypes.BUILDER]: Lemmings.ActionBuildSystem
        };
        if (lem.action == this.actions[Lemmings.LemmingStateType.FALLING]) {
          if (!canApplyWhileFalling[skillType]) {
            return false;
          }
        }
        const redundant = {
          [Lemmings.SkillTypes.BASHER]: Lemmings.ActionBashSystem,
          [Lemmings.SkillTypes.BLOCKER]: Lemmings.ActionBlockerSystem,
          [Lemmings.SkillTypes.DIGGER]: Lemmings.ActionDiggSystem,
          [Lemmings.SkillTypes.MINER]: Lemmings.ActionMineSystem
        };
        const alreadyDoingIt =
            redundant[skillType] && (lem.action instanceof redundant[skillType]);
        if (alreadyDoingIt) {
          return false;
        }
        const wasBlocking = (lem.action instanceof Lemmings.ActionBlockerSystem);
        const ok = actionSystem.triggerLemAction(lem);
        if (ok && wasBlocking) {
          const keepWall =
                skillType === Lemmings.SkillTypes.BOMBER ||
                skillType === Lemmings.SkillTypes.CLIMBER ||
                skillType === Lemmings.SkillTypes.FLOATER;
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
        applied = this.doLemmingAction(lem, Lemmings.SkillTypes.BOMBER);
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
            lem.action !== this.actions[Lemmings.LemmingStateType.EXITING]) {
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
    this.logging = new Lemmings.LogHandler('LemmingManager');
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

Lemmings.LemmingManager = LemmingManager;
export { LemmingManager };
