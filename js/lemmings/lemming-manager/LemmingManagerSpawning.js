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
const lemmingManagerSpawningMethods = {
  setMiniMap(miniMap) {
    this.miniMap = miniMap;
  },

  _addActiveLemming(lem) {
    lem._activeIndex = this.activeLemmings.length;
    this.activeLemmings.push(lem);
    this._nearestGridDirty = true;
  },

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
  },

  _nearestCellKey(cx, cy) {
    return ((cy & 0xffff) << 16) | (cx & 0xffff);
  },

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
  },

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
  },

  _acquireLemming(x, y, id) {
    const pool = this._lemmingPool;
    const lem = pool.length ? pool.pop() : null;
    if (lem && typeof lem.reset === 'function') {
      lem.reset(x, y, id);
      lem.setRuntime?.(this.runtime);
      return lem;
    }
    const LemmingCtor = this._lemmingCtor;
    if (typeof LemmingCtor !== 'function') {
      throw new Error('LemmingManager requires an explicit lemming constructor.');
    }
    return new LemmingCtor(x, y, id, this.runtime);
  },

  _releaseLemming(lem) {
    if (!lem || !this._lemmingPool) return;
    if (this._lemmingPool.length >= this._maxLemmingPoolSize) return;
    this._lemmingPool.push(lem);
  },

  processNewAction(lem, newAction) {
    if (newAction === LemmingStateType.NO_STATE_TYPE) return false;
    this.setLemmingState(lem, newAction);
    return true;
  },

  _processLemmingStep(lem, tick) {
    const newAction = lem.process(this.level);
    this.processNewAction(lem, newAction);
    const triggerAction = this.runTrigger(lem, tick);
    this.processNewAction(lem, triggerAction);
  },

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
        this.minimapDots = dots;
        this.miniMap.setLiveDots(this.minimapDots, idx);
        this.miniMap.setSelectedDot(hasSelectedDot ? this._selectedMiniMapDot : null);
      }
      if (this._activeDirty) {
        this._compactActiveLemmings();
      }
      this._nearestGridDirty = true;
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('tick', {
          start: perfStart,
          detail: TICK_MEASURE_DETAIL
        });
      }
    }
  },

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
  },

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
          const soundBus = getRuntimeSoundEvents(this.runtime);
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
};
export { lemmingManagerSpawningMethods };