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
const lemmingManagerInteractionMethods = {
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
  },

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
        recordPerformanceMeasure('render', {
          start: perfStart,
          detail: RENDER_MEASURE_DETAIL
        });
      }
    }
  },

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
  },

  getLemming(id) {
    return this.lemmings[id] ?? null;
  },

  getSelectedLemming() {
    const lem = this.getLemming(this.selectedIndex);
    if (!lem || lem.removed || lem.disabled) return null;
    return lem;
  },

  setSelectedLemming(lem) {
    this.selectedIndex = lem?.id ?? -1;
  },

  getLemmings() {
    return this.activeLemmings;
  },

  getLemmingAt(x, y, radius = 6) {
    return this.getNearestLemming(x, y);
  },

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
  },

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
  },

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
  },

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
  },

  isNuking() { return this.nextNukingLemmingsIndex >= 0; },

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
  },

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
  },

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
  },

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
};
export { lemmingManagerInteractionMethods };