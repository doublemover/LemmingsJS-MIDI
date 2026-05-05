import {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
} from './ProcgenControllerShared.js';
const procgenTerrainPlanningMethods = {
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
    this.stamper.stamp(decor, destX, destY);
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
    if (this._gapScanStart <= 0) return;
    if (this._gapScanStart < 256 && this._gapScanStart < (this._gaps.length >> 1)) return;
    this._gaps.splice(0, this._gapScanStart);
    this._gapScanStart = 0;
  },

  _collectActiveLemmingIds() {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
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
    this._pruneGapQueue();
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