import {
  HAZARD_TRIGGER_TYPES,
  Lemming
} from './ProcgenControllerShared.js';

const DEAD_FRONTIER_ACTIONS = new Set([
  'drowning',
  'exiting',
  'exploding',
  'frying',
  'oh-no',
  'splatter'
]);
const STATIONARY_FRONTIER_ACTIONS = new Set(['blocking', 'countdown']);
const AIRBORNE_FRONTIER_ACTIONS = new Set(['falling', 'floating', 'jump']);
const ASSIGNABLE_ACTIONS = new Set(['', 'walk', 'walking']);

const procgenTerrainPlanningMethods = {
  _getProcgenTick() {
    const timer = this.game?.getGameTimer?.();
    return timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
  },

  _getProcgenLemmings() {
    const manager = this.game?.getLemmingManager?.();
    if (Array.isArray(manager?.activeLemmings)) return manager.activeLemmings;
    if (Array.isArray(manager?.lemmings)) return manager.lemmings;
    return [];
  },

  _getLemmingActionName(lem) {
    return lem?.action?.getActionName?.() || '';
  },

  _isAssignableAction(lem) {
    return ASSIGNABLE_ACTIONS.has(this._getLemmingActionName(lem));
  },

  _isLiveFrontierLemming(lem) {
    if (!lem || lem.removed || lem.disabled) return false;
    if (lem.isRemoved?.() === true || lem.isDisabled?.() === true) return false;
    return Number.isFinite(lem.x) && Number.isFinite(lem.y);
  },

  _trackFrontierLemming(lem, tick) {
    if (!Number.isFinite(lem?.id)) return null;
    if (!this._frontierLemmingState) this._frontierLemmingState = new Map();
    const previous = this._frontierLemmingState.get(lem.id) || null;
    const previousTick = Number.isFinite(previous?.lastSeenTick) ? previous.lastSeenTick : tick - 1;
    const sameTick = previous && previousTick === tick;
    const tickDelta = sameTick ? 0 : Math.max(1, tick - previousTick);
    const velocityDivisor = Math.max(1, tick - previousTick);
    const previousX = Number.isFinite(previous?.x) ? previous.x : lem.x;
    const previousY = Number.isFinite(previous?.y) ? previous.y : lem.y;
    const dx = lem.x - previousX;
    const dy = lem.y - previousY;
    const moved = Math.abs(dx) + Math.abs(dy);
    const bestX = Math.max(Number.isFinite(previous?.bestX) ? previous.bestX : lem.x, lem.x);
    const madeRightwardProgress = !previous || lem.x > bestX - 0.5;
    let stallTicks = Number.isFinite(previous?.stallTicks) ? previous.stallTicks : 0;
    if (sameTick) {
      stallTicks = Number.isFinite(previous?.stallTicks) ? previous.stallTicks : 0;
    } else if (moved < 0.5) {
      stallTicks += tickDelta;
    } else {
      stallTicks = Math.max(0, stallTicks - tickDelta);
    }
    let flipCount = Number.isFinite(previous?.flipCount) ? previous.flipCount : 0;
    if (previous && previous.lookRight !== lem.lookRight && Math.abs(dx) < 8) {
      flipCount += 1;
    } else if (!sameTick && moved > 2) {
      flipCount = Math.max(0, flipCount - 1);
    }
    const state = {
      id: lem.id,
      x: lem.x,
      y: lem.y,
      lookRight: !!lem.lookRight,
      actionName: this._getLemmingActionName(lem),
      lastSeenTick: tick,
      lastProgressTick: madeRightwardProgress
        ? tick
        : (Number.isFinite(previous?.lastProgressTick) ? previous.lastProgressTick : tick),
      bestX,
      stallTicks,
      flipCount,
      velocityX: dx / velocityDivisor,
      velocityY: dy / velocityDivisor
    };
    this._frontierLemmingState.set(lem.id, state);
    return state;
  },

  _evaluateFrontierViability(lem, tracker) {
    if (!this._isLiveFrontierLemming(lem)) {
      return { viable: false, reason: 'inactive', penalty: Infinity };
    }
    const actionName = this._getLemmingActionName(lem);
    if (DEAD_FRONTIER_ACTIONS.has(actionName)) {
      return { viable: false, reason: 'dead-action', penalty: Infinity };
    }
    if (STATIONARY_FRONTIER_ACTIONS.has(actionName)) {
      return { viable: false, reason: 'stationary-action', penalty: Infinity };
    }
    const levelWidth = this.level?.width ?? Infinity;
    const levelHeight = this.level?.height ?? Infinity;
    if (lem.x < 0 || lem.x >= levelWidth || lem.y < Lemming.LEM_MIN_Y || lem.y >= levelHeight + 6) {
      return { viable: false, reason: 'out-of-level', penalty: Infinity };
    }
    if (actionName === 'falling' && !lem.hasParachute) {
      const fallDistance = Number.isFinite(lem.state) ? lem.state : 0;
      const maxSafeFall = Math.min(this.maxDrop, Lemming.LEM_MAX_FALLING);
      if (fallDistance > maxSafeFall) {
        return { viable: false, reason: 'falling-lethal', penalty: Infinity };
      }
    }
    const airborne = AIRBORNE_FRONTIER_ACTIONS.has(actionName);
    if (!airborne && tracker) {
      if (tracker.stallTicks >= this.frontierStuckTicks) {
        return { viable: false, reason: 'stuck', penalty: Infinity };
      }
      if (tracker.flipCount >= this.frontierTurnaroundLimit) {
        return { viable: false, reason: 'turnaround-stuck', penalty: Infinity };
      }
    }
    let penalty = 0;
    let reason = actionName || 'live';
    if (!lem.lookRight) {
      penalty += this.frontierTurnaroundPenalty;
      reason = `${reason}:turnaround`;
    }
    if (actionName === 'falling' && !lem.hasParachute) {
      penalty += 4;
    }
    return { viable: true, reason, actionName, penalty };
  },

  _getFrontierFallbackX() {
    const entrance = this.level?.entrances?.[0] || null;
    if (Number.isFinite(entrance?.x)) return entrance.x;
    if (Number.isFinite(this.entranceX)) return this.entranceX;
    return null;
  },

  _selectFrontierState({ force = false, requireRight = false } = {}) {
    const tick = this._getProcgenTick();
    if (!force && !requireRight && this._frontierState && this._frontierCacheTick === tick) {
      if (!this._frontierState.lemming || this._isLiveFrontierLemming(this._frontierState.lemming)) {
        return this._frontierState;
      }
    }
    const lems = this._getProcgenLemmings();
    const activeIds = new Set();
    let best = null;
    let bestTracker = null;
    let bestViability = null;
    let bestScore = -Infinity;
    let liveCount = 0;
    let viableCount = 0;
    let rightMovingCount = 0;
    let rightmostX = null;
    for (const lem of lems) {
      if (!this._isLiveFrontierLemming(lem)) continue;
      liveCount += 1;
      if (Number.isFinite(lem.id)) activeIds.add(lem.id);
      const tracker = this._trackFrontierLemming(lem, tick);
      const viability = this._evaluateFrontierViability(lem, tracker);
      if (!viability.viable) continue;
      viableCount += 1;
      if (lem.lookRight) rightMovingCount += 1;
      if (rightmostX == null || lem.x > rightmostX) rightmostX = lem.x;
      if (requireRight && !lem.lookRight) continue;
      const score = lem.x - viability.penalty;
      if (score > bestScore || (score === bestScore && (!best || lem.x > best.x))) {
        best = lem;
        bestTracker = tracker;
        bestViability = viability;
        bestScore = score;
      }
    }
    const fallbackX = best ? best.x : this._getFrontierFallbackX();
    const state = {
      tick,
      lemming: best,
      id: best?.id ?? null,
      x: Number.isFinite(fallbackX) ? fallbackX : null,
      y: Number.isFinite(best?.y) ? best.y : null,
      lookRight: best ? !!best.lookRight : null,
      actionName: bestViability?.actionName ?? null,
      reason: bestViability?.reason ?? (liveCount ? 'no-viable-lemming' : 'no-live-lemming'),
      velocityX: bestTracker?.velocityX ?? 0,
      velocityY: bestTracker?.velocityY ?? 0,
      liveCount,
      viableCount,
      rightMovingCount,
      rightmostX
    };
    this._pruneFrontierTrackingState(activeIds, tick);
    if (!requireRight) {
      this._frontierState = state;
      this._frontierCacheTick = tick;
      this._frontier = state;
      this._getLookaheadState(state);
    }
    return state;
  },

  _getFrontierState(options = {}) {
    return this._selectFrontierState(options || {});
  },

  _getFrontierLemming({ requireRight = false } = {}) {
    return this._selectFrontierState({ requireRight }).lemming;
  },

  _getFollowLemming() {
    return this._getFrontierLemming();
  },

  _isViableFrontierLemming(lem, { requireRight = false } = {}) {
    if (requireRight && !lem?.lookRight) return false;
    const tick = this._getProcgenTick();
    const tracker = this._trackFrontierLemming(lem, tick);
    return this._evaluateFrontierViability(lem, tracker).viable;
  },

  _getFrontierSummary() {
    const state = this._getFrontierState({ force: true });
    return {
      id: state.id,
      x: state.lemming ? state.x : null,
      y: state.y,
      lookRight: state.lookRight,
      action: state.actionName,
      reason: state.reason,
      tick: state.tick,
      velocityX: state.velocityX,
      liveCount: state.liveCount,
      viableCount: state.viableCount,
      rightMovingCount: state.rightMovingCount,
      rightmostX: state.rightmostX
    };
  },

  _getLookaheadState(frontierOrX = null) {
    const frontierX = Number.isFinite(frontierOrX)
      ? frontierOrX
      : (Number.isFinite(frontierOrX?.x) ? frontierOrX.x : this._frontierState?.x);
    const velocityX = Math.max(0, Number.isFinite(frontierOrX?.velocityX)
      ? frontierOrX.velocityX
      : (this._frontierState?.velocityX ?? 0));
    const min = Math.max(1, Math.floor(this.lookAheadMin ?? this.lookAhead ?? 1));
    const max = Math.max(min, Math.floor(this.lookAheadMax ?? this.lookAhead ?? min));
    const speedBonus = Math.ceil(velocityX * (this.lookAheadSpeedTicks ?? 0));
    const range = Math.max(0, max - min);
    const previousVariation = this._lookaheadState?.variation;
    const variation = Number.isFinite(previousVariation)
      ? Math.max(0, Math.min(range, Math.floor(previousVariation)))
      : this._randInt(0, range);
    const distance = Math.max(min, Math.min(max, min + speedBonus + variation));
    const generatedEndX = Number.isFinite(this._groundEndX) ? this._groundEndX : null;
    const groundAhead = Number.isFinite(frontierX) && Number.isFinite(generatedEndX)
      ? generatedEndX - frontierX
      : null;
    const threshold = Math.max(0, Math.floor(this.extendThreshold || 0));
    const state = {
      distance,
      min,
      max,
      threshold,
      groundAhead,
      distanceToGeneratedEnd: groundAhead,
      generatedEndX,
      variation,
      due: Number.isFinite(groundAhead) ? groundAhead <= distance + threshold : false
    };
    this.lookAhead = distance;
    this._lookAheadDistance = distance;
    this._lookAheadThreshold = threshold;
    this._lookaheadState = state;
    return state;
  },

  _getLookaheadTarget() {
    return this._getLookaheadState(this._frontierState).distance;
  },

  _refreshLookaheadTarget() {
    if (this._lookaheadState) {
      this._lookaheadState = { ...this._lookaheadState, variation: Number.NaN };
    }
    return this._getLookaheadState(this._frontierState).distance;
  },

  _needsGroundForFrontier(frontierX) {
    if (!Number.isFinite(frontierX)) return false;
    return this._getLookaheadState(frontierX).due;
  },

  getDebugState() {
    const frontier = this._getFrontierSummary();
    const lookahead = this._getLookaheadState(this._frontierState);
    return {
      version: 1,
      selectedTheme: this._getSelectedTheme?.() ?? this.assets?.styleName ?? null,
      seed: this._rngSeed ?? null,
      generatedEndX: Number.isFinite(this._groundEndX) ? Math.max(0, Math.floor(this._groundEndX)) : 0,
      frontier,
      lookahead: {
        distance: lookahead.distance,
        min: lookahead.min,
        max: lookahead.max,
        threshold: lookahead.threshold,
        extendThreshold: lookahead.threshold,
        groundAhead: lookahead.groundAhead,
        distanceToGeneratedEnd: lookahead.distanceToGeneratedEnd,
        variation: lookahead.variation,
        due: lookahead.due,
        levelWidth: this.level?.width ?? null
      },
      recentChunks: (this._recentChunks || []).map(chunk => ({ ...chunk })),
      recentCertificates: (this._recentCertificates || []).map(entry => ({ ...entry })),
      recentPieces: (this._recentPieces || []).map(piece => ({
        ...piece,
        bounds: piece.bounds ? { ...piece.bounds } : null
      })),
      recentAssists: (this._recentAssists || []).map(assist => ({
        ...assist,
        lemming: assist.lemming ? { ...assist.lemming } : null,
        scan: assist.scan ? {
          direction: assist.scan.direction,
          gap: assist.scan.gap ? { ...assist.scan.gap } : null,
          wall: assist.scan.wall ? { ...assist.scan.wall } : null,
          hazard: assist.scan.hazard ? { ...assist.scan.hazard } : null
        } : null
      })),
      certificatePolicy: {
        scope: 'local-tactical',
        solvabilityClaim: 'none',
        fullLevelSolvability: false
      },
      trackingSizes: this._getTrackingSizes()
    };
  },

  _getTrackingSizes() {
    const scanCacheSizes = {};
    for (const [key, value] of Object.entries(this._scanCache || {})) {
      scanCacheSizes[key] = value?.size ?? 0;
    }
    return {
      gaps: this._gaps?.length ?? 0,
      gapScanStart: this._gapScanStart ?? 0,
      seenFalls: this._seenFalls?.size ?? 0,
      aiCooldowns: this._aiLemmingCooldown?.size ?? 0,
      aiStalls: this._aiStallState?.size ?? 0,
      frontier: this._frontierLemmingState?.size ?? 0,
      hazardTriggers: this._hazardTriggers?.length ?? 0,
      recentChunks: this._recentChunks?.length ?? 0,
      recentCertificates: this._recentCertificates?.length ?? 0,
      recentPieces: this._recentPieces?.length ?? 0,
      recentAssists: this._recentAssists?.length ?? 0,
      recentDecor: this._recentDecor?.length ?? 0,
      scanCache: scanCacheSizes
    };
  },

  _getStructurePlan() {
    if (!this._structurePlan || this._structurePlan.remaining <= 0) {
      this._structurePlan = this._seedStructurePlan();
    }
    return this._structurePlan;
  },

  _seedStructurePlan() {
    const roll = this._rand();
    let type = 'flat';
    if (roll < 0.25) type = 'steps-up';
    else if (roll < 0.5) type = 'steps-down';
    else if (roll < 0.65) type = 'shelf';
    else if (roll < 0.8) type = 'pillar';
    else type = 'staircase';
    const length = type === 'staircase'
      ? this._randInt(4, 10)
      : this._randInt(2, 6);
    return {
      type,
      remaining: length,
      step: this._randInt(1, Math.max(2, this.maxStepUp)),
      surface: null,
      direction: this._rand() < 0.5 ? -1 : 1,
      turnAt: Math.max(1, Math.floor(length / 2))
    };
  },

  _nextSurfaceY(plan, baseSurfaceY) {
    if (!plan) return baseSurfaceY;
    const levelHeight = this.level?.height ?? 0;
    const maxSurface = Math.max(0, levelHeight - 1);
    if (!Number.isFinite(plan.surface)) {
      plan.surface = baseSurfaceY;
    }
    let surface = plan.surface;
    if (plan.type === 'steps-up') {
      surface -= plan.step;
    } else if (plan.type === 'steps-down') {
      surface += plan.step;
    } else if (plan.type === 'shelf') {
      surface += this._randInt(-2, 2);
    } else if (plan.type === 'pillar') {
      surface += this._randInt(-1, 1);
    } else if (plan.type === 'staircase') {
      surface += plan.step * plan.direction;
      if (plan.remaining <= plan.turnAt) {
        plan.direction = -plan.direction;
      }
    }
    plan.remaining -= 1;
    if (plan.remaining <= 0) {
      this._structurePlan = null;
    }
    plan.surface = surface;
    return Math.max(0, Math.min(maxSurface, surface));
  },

  _clampSurfaceForEntrance(surfaceY, piece, cursorX) {
    if (!Number.isFinite(this.entranceY) || !Number.isFinite(this.entranceX)) {
      return surfaceY;
    }
    if (!piece?.bounds) return surfaceY;
    const span = Math.max(80, piece.bounds.width * 2);
    if (Math.abs(cursorX - this.entranceX) > span) return surfaceY;
    const clearance = Math.max(12, this.entranceClearance);
    const minSurface = this.entranceY + clearance;
    return Math.max(surfaceY, minSurface);
  },

  _placeDecoration(baseX, baseY, basePiece) {
    if (!this.assets || !this.stamper) return;
    const decor = this.assets.pickDecorPiece(32);
    if (!decor?.bounds) return;
    const offsetX = basePiece?.bounds?.minX ?? 0;
    const destX = baseX + offsetX + this._randInt(-4, 6);
    const raise = this._randInt(6, 22);
    const destY = baseY - decor.bounds.height - raise;
    if (this._overlapsRecentDecor(destX, destY, decor)) return;
    const rect = this.stamper.stamp(decor, destX, destY);
    this._trackGeneratedPiece(decor, destX, destY, 'decor', rect);
    this._trackDecorPlacement(destX, destY, decor);
  },

  _overlapsRecentDecor(destX, destY, decor) {
    const rect = {
      x: destX + decor.bounds.minX,
      y: destY + decor.bounds.minY,
      w: decor.bounds.width,
      h: decor.bounds.height
    };
    for (const other of this._recentDecor) {
      if (!other) continue;
      const xOverlap = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
      const yOverlap = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
      if (xOverlap > 2 && yOverlap > 2) {
        return true;
      }
      const centerDx = Math.abs((rect.x + rect.w / 2) - (other.x + other.w / 2));
      const centerDy = Math.abs((rect.y + rect.h / 2) - (other.y + other.h / 2));
      if (centerDx < 24 && centerDy < 36) {
        return true;
      }
    }
    return false;
  },

  _trackDecorPlacement(destX, destY, decor) {
    this._recentDecor.push({
      x: destX + decor.bounds.minX,
      y: destY + decor.bounds.minY,
      w: decor.bounds.width,
      h: decor.bounds.height
    });
    if (this._recentDecor.length > 40) {
      this._recentDecor.splice(0, this._recentDecor.length - 40);
    }
  },

  _advanceGapScanCursor(referenceX = null) {
    const anchorX = Number.isFinite(referenceX)
      ? referenceX
      : (Number.isFinite(this._cameraX) ? this._cameraX : this._getRightmostX());
    if (!Number.isFinite(anchorX)) return;
    const cutoff = anchorX - 200;
    while (this._gapScanStart < this._gaps.length) {
      const gap = this._gaps[this._gapScanStart];
      if (!gap || !Number.isFinite(gap.x) || !Number.isFinite(gap.width)) {
        this._gapScanStart += 1;
        continue;
      }
      if ((gap.x + gap.width) <= cutoff) {
        this._gapScanStart += 1;
        continue;
      }
      break;
    }
  },

  _pruneGapQueue(referenceX = null) {
    this._advanceGapScanCursor(referenceX);
    if (this._gapScanStart <= 0) {
      this._capGapQueue();
      return;
    }
    if (this._gapScanStart < 256 && this._gapScanStart < (this._gaps.length >> 1)) {
      this._capGapQueue();
      return;
    }
    this._gaps.splice(0, this._gapScanStart);
    this._gapScanStart = 0;
    this._capGapQueue();
  },

  _capGapQueue() {
    const limit = Math.max(1, Math.floor(this.gapTrackingLimit ?? 256));
    if (!Array.isArray(this._gaps) || this._gaps.length <= limit) return;
    const removeCount = this._gaps.length - limit;
    this._gaps.splice(0, removeCount);
    this._gapScanStart = Math.max(0, this._gapScanStart - removeCount);
  },

  _collectActiveLemmingIds() {
    const lems = this._getProcgenLemmings();
    const ids = new Set();
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed || lem.disabled) continue;
      if (!Number.isFinite(lem.id)) continue;
      ids.add(lem.id);
    }
    return ids;
  },

  _pruneTrackingState(tick) {
    const activeIds = this._collectActiveLemmingIds();
    for (const [id, untilTick] of this._aiLemmingCooldown) {
      if (activeIds.has(id) && (!Number.isFinite(tick) || untilTick >= tick - 120)) continue;
      this._aiLemmingCooldown.delete(id);
    }
    for (const id of this._aiStallState.keys()) {
      if (activeIds.has(id)) continue;
      this._aiStallState.delete(id);
    }
    const minSeenTick = Number.isFinite(tick) ? tick - this.fallEventMemoryTicks : -Infinity;
    for (const [id, seenTick] of this._seenFalls) {
      if (activeIds.has(id)) continue;
      if (Number.isFinite(seenTick) && seenTick >= minSeenTick) continue;
      this._seenFalls.delete(id);
    }
    this._pruneFrontierTrackingState(activeIds, tick);
    const maxTracked = Math.max(activeIds.size, Math.floor(this.frontierMaxTrackedLemmings ?? 128));
    this._pruneMapToLimit(this._aiLemmingCooldown, maxTracked, activeIds, value => value);
    this._pruneMapToLimit(this._aiStallState, maxTracked, activeIds, value => value?.lastSeenTick ?? 0);
    this._pruneMapToLimit(this._seenFalls, maxTracked, activeIds, value => value);
    this._pruneGapQueue();
    this._pruneGeneratedTracking();
  },

  _pruneFrontierTrackingState(activeIds = new Set(), tick = null) {
    if (!this._frontierLemmingState) return;
    const staleBefore = Number.isFinite(tick)
      ? tick - Math.max(this.fallEventMemoryTicks, this.frontierStuckTicks * 2)
      : -Infinity;
    for (const [id, state] of this._frontierLemmingState) {
      if (activeIds.has(id)) continue;
      if (Number.isFinite(state?.lastSeenTick) && state.lastSeenTick >= staleBefore) continue;
      this._frontierLemmingState.delete(id);
    }
    const maxTracked = Math.max(activeIds.size, Math.floor(this.frontierMaxTrackedLemmings ?? 128));
    this._pruneMapToLimit(this._frontierLemmingState, maxTracked, activeIds, value => value?.lastSeenTick ?? 0);
  },

  _pruneMapToLimit(map, limit, activeIds = new Set(), getSortValue = value => value) {
    if (!map || typeof map.size !== 'number') return;
    const maxSize = Math.max(0, Math.floor(limit));
    if (map.size <= maxSize) return;
    if (maxSize === 0) {
      map.clear();
      return;
    }
    const entries = [];
    for (const [key, value] of map) {
      entries.push({
        key,
        active: activeIds.has(key),
        sort: Number(getSortValue(value)) || 0
      });
    }
    entries.sort((a, b) => {
      if (a.active !== b.active) return a.active ? 1 : -1;
      return a.sort - b.sort;
    });
    for (const entry of entries) {
      if (map.size <= maxSize) break;
      if (entry.active && map.size <= activeIds.size) break;
      map.delete(entry.key);
    }
  },

  _rebuildHazardIndex(tick = null) {
    const triggers = this.level?.triggers;
    this._hazardTriggerSource = triggers || null;
    this._hazardTriggers = [];
    this._hazardTriggerSourceSize = Array.isArray(triggers) ? triggers.length : 0;
    this._hazardIndexLastRefreshTick = Number.isFinite(tick) ? tick : 0;
    if (!Array.isArray(triggers) || triggers.length === 0) return;
    for (const trigger of triggers) {
      if (!trigger || !HAZARD_TRIGGER_TYPES.has(trigger.type)) continue;
      const x1 = Math.min(trigger.x1, trigger.x2);
      const x2 = Math.max(trigger.x1, trigger.x2);
      const y1 = Math.min(trigger.y1, trigger.y2);
      const y2 = Math.max(trigger.y1, trigger.y2);
      this._hazardTriggers.push({
        x1,
        x2,
        y1,
        y2,
        type: trigger.type
      });
    }
    this._hazardTriggers.sort((a, b) => a.x1 - b.x1);
  },

  _pickSegmentWidth() {
    const min = Math.max(2, Math.floor(this.segmentMinWidth));
    const max = Math.max(min, Math.floor(this.segmentMaxWidth));
    return min + Math.floor(this._rand() * (max - min + 1));
  },

  _pickGapWidth() {
    const min = Math.max(2, Math.floor(this.gapMinWidth));
    const max = Math.max(min, Math.floor(this.gapMaxWidth));
    return min + Math.floor(this._rand() * (max - min + 1));
  },

  _shouldInsertGap() {
    if (this._gapCooldown > 0) {
      this._gapCooldown -= 1;
      return false;
    }
    if (this._rand() > this.gapChance) return false;
    return true;
  },

  _pickNextTopY() {
    const levelHeight = this.level?.height ?? 0;
    const maxTop = Math.max(0, levelHeight - this.groundHeight);
    if (this._sustainRemaining <= 0) {
      this._seedSustainLevel(maxTop);
    }
    const delta = this._nextElevationDelta();
    let next = this._groundTopY + delta;
    const offset = this._groundTopY - this._sustainBaseY;
    if (offset !== 0) {
      const biasStep = Math.min(3, Math.ceil(Math.abs(offset) / 8));
      next += offset > 0 ? -biasStep : biasStep;
    }
    this._sustainRemaining -= 1;
    return Math.max(0, Math.min(maxTop, next));
  },

  _nextElevationDelta() {
    if (!this._terrainPlan || this._terrainPlan.remaining <= 0) {
      this._seedTerrainPlan();
    }
    const mode = this._terrainPlan.mode;
    const up = Math.max(1, Math.floor(this.maxStepUp));
    const down = Math.max(1, Math.floor(this.maxDrop));
    let delta = 0;
    if (mode === 'climb') {
      delta = -this._randInt(1, up);
    } else if (mode === 'drop-small') {
      delta = this._randInt(1, Math.min(4, down));
    } else if (mode === 'drop-medium') {
      delta = this._randInt(Math.min(5, down), Math.min(14, down));
    } else if (mode === 'drop-big') {
      const minBig = Math.max(6, Math.floor(down * 0.7));
      delta = this._randInt(minBig, down);
    } else {
      delta = this._randInt(-1, 1);
    }
    this._terrainPlan.remaining -= 1;
    return delta;
  },

  _seedTerrainPlan() {
    const prev = this._terrainPlan?.mode || 'flat';
    let mode = 'flat';
    if (prev === 'climb') {
      mode = 'flat';
      this._pendingDrop = true;
    } else if (prev === 'flat') {
      if (this._pendingDrop) {
        const roll = this._rand();
        if (roll < 0.5) mode = 'drop-small';
        else if (roll < 0.85) mode = 'drop-medium';
        else mode = 'drop-big';
        this._pendingDrop = false;
      } else {
        const roll = this._rand();
        if (roll < 0.5) mode = 'climb';
        else if (roll < 0.75) mode = 'drop-small';
        else if (roll < 0.92) mode = 'drop-medium';
        else mode = 'drop-big';
      }
    } else {
      mode = 'flat';
    }
    const lengths = {
      climb: this._randInt(4, 10),
      flat: this._randInt(8, 18),
      'drop-small': this._randInt(3, 8),
      'drop-medium': this._randInt(2, 4),
      'drop-big': 1
    };
    this._terrainPlan = {
      mode,
      remaining: lengths[mode] || 3
    };
  },

  _rand() {
    const value = this._rng?.();
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 0.9999999999999999;
    return value;
  },

  _randInt(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(this._rand() * (hi - lo + 1));
  },

  _getNextColorIndex() {
    const maxIndex = 15;
    const base = Number.isFinite(this.groundColorIndex) && this.groundColorIndex > 0
      ? this.groundColorIndex
      : 1;
    if (!Number.isFinite(this._segmentColorIndex) || this._segmentColorIndex <= 0) {
      this._segmentColorIndex = base;
    }
    if (!this._colorTransition || this._colorTransition.remaining <= 0) {
      const target = this._randInt(1, maxIndex);
      const to = target === this._segmentColorIndex ? ((target % maxIndex) + 1) : target;
      const total = this._randInt(10, 300);
      const step = total > 0 ? (to - this._segmentColorIndex) / total : 0;
      this._colorTransition = {
        from: this._segmentColorIndex,
        to,
        total,
        remaining: total,
        current: this._segmentColorIndex,
        step
      };
    }
    const transition = this._colorTransition;
    transition.current += transition.step;
    transition.remaining -= 1;
    const progress = transition.total > 0
      ? (transition.total - transition.remaining) / transition.total
      : 1;
    let next = transition.from;
    if (transition.from !== transition.to) {
      const chance = Math.min(1, Math.max(0, progress));
      next = this._rand() < chance ? transition.to : transition.from;
    }
    if (transition.remaining <= 0) {
      next = transition.to;
      transition.current = transition.to;
    }
    next = Math.min(maxIndex, Math.max(1, next));
    this._segmentColorIndex = next;
    return next;
  },

  _seedSustainLevel(maxTop) {
    const upRange = Math.max(8, Math.floor(this.maxStepUp * 8));
    const downRange = Math.max(12, Math.floor(this.maxDrop * 0.35));
    const delta = this._randInt(-upRange, downRange);
    const nextBase = Math.max(0, Math.min(maxTop, this._groundTopY + delta));
    this._sustainBaseY = nextBase;
    this._sustainRemaining = this._randInt(20, 200);
  }
};
export { procgenTerrainPlanningMethods };
