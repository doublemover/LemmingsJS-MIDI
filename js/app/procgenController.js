import { Lemming } from '../lemmings/Lemming.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { SoundEventTypes } from '../game/SoundEvents.js';

class ProcgenController {
  constructor({ view, game, level, options = {} }) {
    this.view = view || null;
    this.game = game || null;
    this.level = level || null;
    this._tickHandler = null;
    this._running = false;
    this._cameraX = 0;
    this._groundEndX = 0;
    this._groundTopY = 0;
    this._segmentColorIndex = 0;
    this._colorTransition = {
      from: 1,
      to: 1,
      remaining: 0,
      total: 0,
      current: 1,
      step: 0
    };
    this._sustainBaseY = 0;
    this._sustainRemaining = 0;
    this._builderCursorId = 0;
    this._seenFalls = new Set();
    this._soundHandler = null;
    this._builderBurst = null;
    this._cameraTargetX = null;
    this._lastSecond = null;
    this._bombCheckElapsed = 0;
    this._bombChance = 0.01;
    this._nukeElapsed = 0;
    this._terrainPlan = { mode: 'flat', remaining: 0 };
    this._pendingDrop = false;

    this.groundHeight = Number.isFinite(options.groundHeight) ? options.groundHeight : 4;
    this.groundColorIndex = Number.isFinite(options.groundColorIndex) ? options.groundColorIndex : 1;
    this.initialGroundWidth = Number.isFinite(options.initialGroundWidth) ? options.initialGroundWidth : 120;
    this.segmentMinWidth = Number.isFinite(options.segmentMinWidth) ? options.segmentMinWidth : 2;
    this.segmentMaxWidth = Number.isFinite(options.segmentMaxWidth) ? options.segmentMaxWidth : 6;
    this.extendThreshold = Number.isFinite(options.extendThreshold) ? options.extendThreshold : 4;
    this.lookAhead = Number.isFinite(options.lookAhead) ? options.lookAhead : 20;
    this.followLerp = Number.isFinite(options.followLerp) ? options.followLerp : 0.12;
    this.maxStepUp = Number.isFinite(options.maxStepUp) ? options.maxStepUp : 3;
    this.maxDrop = Number.isFinite(options.maxDrop) ? options.maxDrop : (Lemming.LEM_MAX_FALLING - 1);
  }

  start() {
    if (this._running) return;
    if (!this.game || !this.level) return;
    this._running = true;
    this._initGround();
    const stage = this.view?.stage || null;
    if (stage?.gameImgProps?.viewPoint) {
      this._cameraX = stage.gameImgProps.viewPoint.x || 0;
    }
    this._bindTimer();
    this._bindSoundEvents();
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    this._unbindTimer();
    this._unbindSoundEvents();
  }

  _bindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.on) return;
    this._tickHandler = () => this._onTick();
    timer.onGameTick.on(this._tickHandler);
  }

  _unbindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.off || !this._tickHandler) return;
    timer.onGameTick.off(this._tickHandler);
    this._tickHandler = null;
  }

  _bindSoundEvents() {
    if (this._soundHandler) return;
    const bus = this.game?.soundEvents;
    if (!bus?.onEvent?.on) return;
    this._soundHandler = event => {
      if (event?.type !== SoundEventTypes.LEMMING_FELL_OFF &&
          event?.type !== SoundEventTypes.LEMMING_SPLAT) {
        return;
      }
      const lemmingId = event?.lemmingId;
      if (this._seenFalls.has(lemmingId)) return;
      this._seenFalls.add(lemmingId);
      const originX = Number.isFinite(event?.x) ? event.x : null;
      this._scheduleBuilderBurst(originX);
    };
    bus.onEvent.on(this._soundHandler);
  }

  _unbindSoundEvents() {
    const bus = this.game?.soundEvents;
    if (bus?.onEvent?.off && this._soundHandler) {
      bus.onEvent.off(this._soundHandler);
    }
    this._soundHandler = null;
  }

  _initGround() {
    const entrance = this.level?.entrances?.[0] || null;
    const entranceX = Number.isFinite(entrance?.x) ? entrance.x : 0;
    const startX = Math.max(0, entranceX - Math.floor(this.initialGroundWidth / 4));
    this._groundTopY = Math.max(0, (this.level?.height ?? 0) - this.groundHeight);
    this._segmentColorIndex = this.groundColorIndex;
    this._colorTransition = {
      from: this._segmentColorIndex,
      to: this._segmentColorIndex,
      remaining: 0,
      total: 0,
      current: this._segmentColorIndex,
      step: 0
    };
    this._sustainBaseY = this._groundTopY;
    this._sustainRemaining = 0;
    this._paintGround(startX, this.initialGroundWidth, this._groundTopY, this._segmentColorIndex);
    this._groundEndX = Math.max(this._groundEndX, startX + this.initialGroundWidth);
  }

  _onTick() {
    if (!this._running) return;
    this._updateTimers();
    const follow = this._getFollowLemming();
    const followX = Number.isFinite(follow?.x) ? follow.x : null;
    const guideX = Number.isFinite(followX) ? followX : this._getRightmostX();
    if (!Number.isFinite(guideX)) return;
    this._ensureGround(guideX);
    this._processBuilderBurst();
    this._updateCamera(Number.isFinite(followX) ? followX : guideX);
  }

  _updateTimers() {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? null;
    if (!Number.isFinite(tick)) return;
    const seconds = Math.floor(tick / 17.5);
    if (this._lastSecond == null) {
      this._lastSecond = seconds;
      return;
    }
    if (seconds <= this._lastSecond) return;
    const delta = seconds - this._lastSecond;
    this._lastSecond = seconds;
    this._bombCheckElapsed += delta;
    this._nukeElapsed += delta;
    this._maybeTriggerBomber();
    this._maybeTriggerNuke();
  }

  _maybeTriggerBomber() {
    if (this._bombCheckElapsed < 30) return;
    if (Math.random() < this._bombChance) {
      const manager = this.game?.getLemmingManager?.();
      const lems = manager?.activeLemmings || manager?.lemmings || [];
      let best = null;
      let bestX = -Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled) continue;
        if (lem.x > bestX) {
          bestX = lem.x;
          best = lem;
        }
      }
      if (best && manager?.doLemmingAction?.(best, SkillTypes.BOMBER)) {
        this._bombCheckElapsed = 0;
        this._bombChance = 0.01;
        return;
      }
    }
    if (this._bombCheckElapsed >= 10) {
      this._bombCheckElapsed = 0;
      this._bombChance = Math.min(1, this._bombChance * 2);
    }
  }

  _maybeTriggerNuke() {
    if (this._nukeElapsed < 60) return;
    if (Math.random() < 0.1) {
      const manager = this.game?.getLemmingManager?.();
      manager?.doNukeAllLemmings?.();
    }
    this._nukeElapsed = 0;
  }

  _getFollowLemming() {
    const manager = this.game?.getLemmingManager?.();
    const first = manager?.getLemming?.(0);
    if (first && Number.isFinite(first.x)) return first;
    const lems = manager?.activeLemmings || manager?.lemmings || [];
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      return lem;
    }
    return null;
  }

  getGroundExtentX() {
    return Math.max(1, Math.floor(this._groundEndX || 0));
  }

  _getRightmostX() {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.activeLemmings || manager?.lemmings || [];
    let max = null;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      if (max == null || lem.x > max) max = lem.x;
    }
    if (max == null) {
      const entrance = this.level?.entrances?.[0] || null;
      return Number.isFinite(entrance?.x) ? entrance.x : null;
    }
    return max;
  }

  _scheduleBuilderBurst(originX) {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    this._builderBurst = {
      remaining: this._randInt(1, 5),
      nextDelay: this._randInt(10, 20),
      dueTick: 0,
      originX: Number.isFinite(originX) ? originX : null,
      used: new Set()
    };
    this._builderBurst.dueTick = tick + this._builderBurst.nextDelay;
  }

  _processBuilderBurst() {
    const burst = this._builderBurst;
    if (!burst || burst.remaining <= 0) return;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    if (burst.dueTick > tick) return;
    const applied = this._applyBuilderToNextLemming(burst);
    if (applied) {
      burst.remaining -= 1;
      if (burst.remaining <= 0) {
        this._builderBurst = null;
        return;
      }
      burst.nextDelay = Math.round(burst.nextDelay * 2) + this._randInt(1, 5);
    }
    burst.dueTick = tick + burst.nextDelay;
  }

  _applyBuilderToNextLemming(burst) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return false;
    if (Number.isFinite(burst?.originX)) {
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled) continue;
        if (burst.used?.has?.(lem.id)) continue;
        const dist = Math.abs((lem.x ?? 0) - burst.originX);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (best && manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        burst.used?.add?.(best.id);
        return true;
      }
      return false;
    }
    const start = Math.max(0, this._builderCursorId);
    for (let i = 0; i < lems.length; i++) {
      const idx = (start + i) % lems.length;
      const lem = lems[idx];
      if (!lem || lem.removed || lem.disabled) continue;
      this._builderCursorId = idx + 1;
      if (manager.doLemmingAction(lem, SkillTypes.BUILDER)) {
        return true;
      }
    }
    return false;
  }

  _ensureGround(rightmostX) {
    const levelWidth = this.level?.width ?? 0;
    if (!Number.isFinite(levelWidth) || levelWidth <= 0) return;
    while (rightmostX + this.lookAhead >= this._groundEndX - this.extendThreshold) {
      if (this._groundEndX >= levelWidth) break;
      const segmentWidth = this._pickSegmentWidth();
      const nextTop = this._pickNextTopY();
      const colorIndex = this._getNextColorIndex();
      this._paintGround(this._groundEndX, segmentWidth, nextTop, colorIndex);
      this._groundTopY = nextTop;
      this._groundEndX = Math.min(levelWidth, this._groundEndX + segmentWidth);
    }
  }

  _paintGround(startX, width, topY, colorIndex) {
    if (!this.level) return;
    const levelWidth = this.level.width;
    const levelHeight = this.level.height;
    const x0 = Math.max(0, startX);
    const x1 = Math.min(levelWidth, startX + width);
    const top = Number.isFinite(topY) ? topY : levelHeight - this.groundHeight;
    const y0 = Math.max(0, Math.min(levelHeight - this.groundHeight, top));
    const y1 = Math.min(levelHeight, y0 + this.groundHeight);
    const paletteIndex = Number.isFinite(colorIndex) ? colorIndex : this.groundColorIndex;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.level.setGroundAt(x, y, paletteIndex);
      }
    }
  }

  _pickSegmentWidth() {
    const min = Math.max(2, Math.floor(this.segmentMinWidth));
    const max = Math.max(min, Math.floor(this.segmentMaxWidth));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

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
  }

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
  }

  _seedTerrainPlan() {
    const prev = this._terrainPlan?.mode || 'flat';
    let mode = 'flat';
    if (prev === 'climb') {
      mode = 'flat';
      this._pendingDrop = true;
    } else if (prev === 'flat') {
      if (this._pendingDrop) {
        const roll = Math.random();
        if (roll < 0.5) mode = 'drop-small';
        else if (roll < 0.85) mode = 'drop-medium';
        else mode = 'drop-big';
        this._pendingDrop = false;
      } else {
        const roll = Math.random();
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
  }

  _randInt(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

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
      next = Math.random() < chance ? transition.to : transition.from;
    }
    if (transition.remaining <= 0) {
      next = transition.to;
      transition.current = transition.to;
    }
    next = Math.min(maxIndex, Math.max(1, next));
    this._segmentColorIndex = next;
    return next;
  }

  _seedSustainLevel(maxTop) {
    const upRange = Math.max(8, Math.floor(this.maxStepUp * 8));
    const downRange = Math.max(12, Math.floor(this.maxDrop * 0.35));
    const delta = this._randInt(-upRange, downRange);
    const nextBase = Math.max(0, Math.min(maxTop, this._groundTopY + delta));
    this._sustainBaseY = nextBase;
    this._sustainRemaining = this._randInt(20, 200);
  }

  _updateCamera(rightmostX) {
    const stage = this.view?.stage;
    const stageImage = stage?.gameImgProps;
    if (!stage || !stageImage) return;
    const scale = stageImage.viewPoint.scale || 1;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const viewW = stageImage.canvasViewportSize.width / scale;
    if (!Number.isFinite(viewW) || viewW <= 0) return;
    const targetX = rightmostX - viewW / 2;
    if (!Number.isFinite(this._cameraX)) {
      this._cameraX = targetX;
    }
    this._cameraTargetX = targetX;
    const frameMs = this.game?.getGameTimer?.().frameTime ?? 16;
    const alpha = Math.min(1, Math.max(0.01, frameMs / 500));
    this._cameraX += (this._cameraTargetX - this._cameraX) * alpha;
    stage.applyViewport(stageImage, this._cameraX, 0, stageImage.viewPoint.scale);
  }
}

export { ProcgenController };
