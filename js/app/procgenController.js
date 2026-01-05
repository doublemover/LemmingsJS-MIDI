import { Lemming } from '../lemmings/Lemming.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { SoundEventTypes } from '../game/SoundEvents.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

class ProcgenController {
  constructor({ view, game, level, assets, stamper, options = {} }) {
    this.view = view || null;
    this.game = game || null;
    this.level = level || null;
    this.window = options.window || globalThis?.window;
    this.assets = assets || null;
    this.stamper = stamper || null;
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
    this._bombChance = 0.0001;
    this._nukeElapsed = 0;
    this._terrainPlan = { mode: 'flat', remaining: 0 };
    this._pendingDrop = false;
    this._gaps = [];
    this._gapCooldown = 0;
    this._structurePlan = null;
    this._aiLastDecisionTick = 0;
    this._aiDecisionInterval = 6;
    this._aiBudget = null;
    this._aiBudgetMax = null;
    this._aiBudgetRegen = null;
    this._aiLastDecision = null;
    this._aiDebug = null;
    this._aiLemmingCooldown = new Map();
    this._aiStallState = new Map();
    this._leftFallCounter = 0;
    this._splatStreak = 0;
    this._splatTarget = this._randInt(3, 10);
    this._pendingMidairBuilder = null;

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
    this.gapChance = Number.isFinite(options.gapChance) ? options.gapChance : 0.08;
    this.gapMinWidth = Number.isFinite(options.gapMinWidth) ? options.gapMinWidth : 3;
    this.gapMaxWidth = Number.isFinite(options.gapMaxWidth) ? options.gapMaxWidth : 9;
    this.gapTriggerDistance = Number.isFinite(options.gapTriggerDistance) ? options.gapTriggerDistance : 10;
    this.decorChance = Number.isFinite(options.decorChance) ? options.decorChance : 0.12;
    this.aiDecisionInterval = Number.isFinite(options.aiDecisionInterval) ? options.aiDecisionInterval : 6;
    this.aiScanAhead = Number.isFinite(options.aiScanAhead) ? options.aiScanAhead : 24;
    this.aiWallHeight = Number.isFinite(options.aiWallHeight) ? options.aiWallHeight : 10;
    this.aiHazardDistance = Number.isFinite(options.aiHazardDistance) ? options.aiHazardDistance : 18;
    this.aiFloaterDrop = Number.isFinite(options.aiFloaterDrop) ? options.aiFloaterDrop : (Lemming.LEM_MAX_FALLING - 2);
    this.aiDebugOverlay = options.aiDebugOverlay === true;
    this.aiActionCooldown = Number.isFinite(options.aiActionCooldown) ? options.aiActionCooldown : 12;
    this.entranceX = Number.isFinite(options.entranceX) ? options.entranceX : null;
    this.entranceY = Number.isFinite(options.entranceY) ? options.entranceY : null;
    this.entranceClearance = Number.isFinite(options.entranceClearance) ? options.entranceClearance : 24;
  }

  start() {
    if (this._running) return;
    if (!this.game || !this.level) return;
    this._running = true;
    this._initGround();
    this._initAiDirector();
    if (this.aiDebugOverlay) {
      this._initDebugOverlay();
    }
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
      if (event?.type === SoundEventTypes.LEMMING_SPLAT) {
        this._splatStreak += 1;
        if (this._splatStreak >= this._splatTarget && !this._pendingMidairBuilder) {
          this._pendingMidairBuilder = {
            delay: this._randInt(4, 12),
            dueTick: null,
            targetId: null
          };
          this._splatStreak = 0;
          this._splatTarget = this._randInt(3, 10);
        }
      } else {
        this._splatStreak = 0;
      }
      const originX = Number.isFinite(event?.x) ? event.x : null;
      const manager = this.game?.getLemmingManager?.();
      const lem = Number.isFinite(lemmingId) ? manager?.getLemming?.(lemmingId) : null;
      const fellLeft = lem ? !lem.lookRight : false;
      if (fellLeft) {
        this._leftFallCounter += 1;
        const isBuilder = this._leftFallCounter % 20 === 0;
        this._scheduleEdgeResponse(originX, isBuilder ? 'builder-left' : 'blocker');
      } else {
        this._scheduleBuilderBurst(originX);
      }
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
    this._processGapBridges();
    this._processMidairBuilder();
    this._updateAiDirector();
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
    this._updateAiBudget(delta);
    this._maybeTriggerBomber();
    this._maybeTriggerNuke();
  }

  _initAiDirector() {
    this._aiDecisionInterval = Math.max(1, Math.floor(this.aiDecisionInterval));
    this._aiBudgetMax = {
      builder: 8,
      floater: 6,
      bash: 4,
      mine: 2,
      dig: 3,
      blocker: 3
    };
    this._aiBudget = {
      builder: 5,
      floater: 4,
      bash: 3,
      mine: 1,
      dig: 2,
      blocker: 2
    };
    this._aiBudgetRegen = {
      builder: 1.0,
      floater: 0.8,
      bash: 0.4,
      mine: 0.2,
      dig: 0.3,
      blocker: 0.2
    };
  }

  _updateAiBudget(deltaSeconds) {
    if (!this._aiBudget || !this._aiBudgetMax || !this._aiBudgetRegen) return;
    const delta = Math.max(0, deltaSeconds);
    for (const key of Object.keys(this._aiBudget)) {
      const next = this._aiBudget[key] + this._aiBudgetRegen[key] * delta;
      this._aiBudget[key] = Math.min(this._aiBudgetMax[key], next);
    }
  }

  _updateAiDirector() {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    if (!Number.isFinite(tick)) return;
    if (tick - this._aiLastDecisionTick < this._aiDecisionInterval) return;
    this._aiLastDecisionTick = tick;

    this._applyEdgeBlockers(tick);
    this._applyBunchingAssist(tick);

    const lemming = this._getFollowLemming();
    if (!lemming) return;
    if (this._shouldSkipAiFor(lemming, tick)) return;
    const scan = this._scanAhead(lemming);
    const action = this._decideAssist(lemming, scan, tick);
    if (action) {
      this._aiLastDecision = { tick, action, scan };
    } else if (this._aiLastDecision && this._aiLastDecision.tick !== tick) {
      this._aiLastDecision = { tick, action: null, scan };
    }
    this._updateDebugOverlay();
  }

  _applyEdgeBlockers(tick) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return;
    const ground = this.level?.groundMask;
    if (!ground) return;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled || lem.lookRight) continue;
      const actionName = lem.action?.getActionName?.() || '';
      if (actionName && actionName !== 'walking') continue;
      if (this._shouldSkipAiFor(lem, tick)) continue;
      const drop = this._getDropAt(ground, Math.floor(lem.x) - 1, Math.floor(lem.y), this.maxDrop);
      if (drop > 0 && this._canSpend('blocker')) {
        if (manager.doLemmingAction(lem, SkillTypes.BLOCKER)) {
          this._noteAiAction(lem, tick, 32);
          return;
        }
        this._refundBudget('blocker');
      }
    }
  }

  _applyBunchingAssist(tick) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return;
    const levelHeight = this.level?.height ?? 0;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      const actionName = lem.action?.getActionName?.() || '';
      if (actionName && actionName !== 'walking') continue;
      if (this._shouldSkipAiFor(lem, tick)) continue;
      const key = lem.id;
      const prev = this._aiStallState.get(key) || {
        lastX: lem.x,
        lastDir: lem.lookRight,
        stallTicks: 0,
        flipCount: 0
      };
      const deltaX = Math.abs((lem.x ?? 0) - (prev.lastX ?? 0));
      const sameDir = prev.lastDir === lem.lookRight;
      let stallTicks = prev.stallTicks;
      let flipCount = prev.flipCount;
      if (deltaX < 0.5) {
        stallTicks += 1;
      } else {
        stallTicks = Math.max(0, stallTicks - 1);
      }
      if (!sameDir && deltaX < 6) {
        flipCount += 1;
      } else if (deltaX > 2) {
        flipCount = Math.max(0, flipCount - 1);
      }

      const stuck = stallTicks >= 18 || flipCount >= 3;
      if (stuck) {
        const highEnough = levelHeight > 0 && (lem.y ?? 0) < levelHeight * 0.6;
        const attempts = [];
        attempts.push({ skill: SkillTypes.BASHER, key: 'bash', cooldown: 32 });
        attempts.push({ skill: SkillTypes.BUILDER, key: 'builder', cooldown: 36 });
        if (highEnough) {
          attempts.push({ skill: SkillTypes.DIGGER, key: 'dig', cooldown: 36 });
          attempts.push({ skill: SkillTypes.MINER, key: 'mine', cooldown: 36 });
        }
        for (const option of attempts) {
          if (!this._canSpend(option.key)) continue;
          if (manager.doLemmingAction(lem, option.skill)) {
            this._noteAiAction(lem, tick, option.cooldown);
            stallTicks = 0;
            flipCount = 0;
            break;
          }
          this._refundBudget(option.key);
        }
      }

      this._aiStallState.set(key, {
        lastX: lem.x,
        lastDir: lem.lookRight,
        stallTicks,
        flipCount
      });
    }
  }

  _scanAhead(lemming) {
    const ground = this.level?.groundMask;
    if (!ground) return null;
    const x0 = Math.floor(lemming.x);
    const y0 = Math.floor(lemming.y);
    const scanAhead = Math.max(6, Math.floor(this.aiScanAhead));
    const levelHeight = this.level?.height ?? 0;
    const maxDrop = Math.min(this.maxDrop, levelHeight);
    const dir = lemming.lookRight ? 1 : -1;
    let gap = null;
    let wall = null;
    for (let dx = 1; dx <= scanAhead; dx++) {
      const testX = x0 + dx * dir;
      const drop = this._getDropAt(ground, testX, y0, maxDrop);
      if (drop > 0 && !gap) {
        const gapWidth = this._measureGapWidth(ground, testX, y0, scanAhead, dir);
        gap = { dx, drop, width: gapWidth };
      }
      const wallHeight = this._getWallHeight(ground, testX, y0, this.aiWallHeight, dir);
      if (wallHeight > 0 && !wall) {
        wall = { dx, height: wallHeight };
      }
      if (gap && wall) break;
    }
    const hazard = this._findHazardAhead(x0, y0, scanAhead, dir);
    return { gap, wall, hazard, direction: dir };
  }

  _getDropAt(ground, x, y, maxDrop) {
    const height = this.level?.height ?? 0;
    const top = y + 1;
    if (top < 0 || top >= height) return 0;
    const available = Math.max(1, Math.min(maxDrop + 2, height - top));
    const depth = ground.getColumnGapDepth(x, top, available);
    if (depth <= 1) return 0;
    return depth - 1;
  }

  _measureGapWidth(ground, startX, y, scanAhead, dir) {
    let width = 0;
    for (let dx = 0; dx <= scanAhead; dx++) {
      const drop = this._getDropAt(ground, startX + dx * dir, y, this.maxDrop);
      if (drop <= 0) break;
      width += 1;
      if (width >= scanAhead) break;
    }
    return width;
  }

  _getWallHeight(ground, x, y, maxHeight, dir) {
    const height = Math.max(1, Math.floor(maxHeight));
    let wall = 0;
    for (let dy = 1; dy <= height; dy++) {
      if (ground.hasGroundAt(x, y - dy)) wall = dy;
    }
    return wall;
  }

  _findHazardAhead(x, y, scanAhead, dir) {
    const triggers = this.level?.triggers;
    if (!Array.isArray(triggers) || triggers.length === 0) return null;
    const hazardSet = new Set([
      TriggerTypes.TRAP,
      TriggerTypes.DROWN,
      TriggerTypes.KILL,
      TriggerTypes.FRYING
    ]);
    const maxDx = Math.max(1, Math.floor(scanAhead));
    for (let dx = 1; dx <= maxDx; dx++) {
      const px = x + dx * dir;
      for (const trigger of triggers) {
        if (!trigger || !hazardSet.has(trigger.type)) continue;
        if (px >= trigger.x1 && px <= trigger.x2 && y >= trigger.y1 && y <= trigger.y2) {
          return { dx, type: trigger.type };
        }
      }
    }
    return null;
  }

  _decideAssist(lemming, scan, tick) {
    if (!scan) return null;
    const manager = this.game?.getLemmingManager?.();
    if (!manager) return null;
    const actionName = lemming.action?.getActionName?.() || '';
    if (actionName && actionName !== 'walking') return null;
    const skillOrder = [];
    if (scan.direction === -1 && scan.gap && scan.gap.dx <= 2) {
      skillOrder.push({ skill: SkillTypes.BLOCKER, key: 'blocker', cooldown: 40 });
    }
    if (scan.hazard && scan.hazard.dx <= this.aiHazardDistance) {
      skillOrder.push({ skill: SkillTypes.BLOCKER, key: 'blocker' });
    }
    if (scan.gap && scan.gap.width >= 2 && scan.gap.width <= 8) {
      skillOrder.push({ skill: SkillTypes.BUILDER, key: 'builder', cooldown: 48 });
    }
    if (scan.gap && scan.gap.drop >= this.aiFloaterDrop) {
      skillOrder.push({ skill: SkillTypes.FLOATER, key: 'floater' });
    }
    if (scan.wall && scan.wall.height >= 6) {
      skillOrder.push({ skill: SkillTypes.BASHER, key: 'bash' });
      skillOrder.push({ skill: SkillTypes.DIGGER, key: 'dig' });
      if (scan.wall.height >= this.aiWallHeight + 4 || Math.random() < 0.15) {
        skillOrder.push({ skill: SkillTypes.MINER, key: 'mine' });
      }
    }
    if (!skillOrder.length) return null;
    for (const option of skillOrder) {
      if (!this._canSpend(option.key)) continue;
      if (manager.doLemmingAction(lemming, option.skill)) {
        this._noteAiAction(lemming, tick, option.cooldown);
        return option.key;
      }
      this._refundBudget(option.key);
    }
    return null;
  }

  _shouldSkipAiFor(lemming, tick) {
    if (!lemming || !Number.isFinite(tick)) return true;
    const last = this._aiLemmingCooldown.get(lemming.id);
    if (Number.isFinite(last) && tick < last) return true;
    return false;
  }

  _noteAiAction(lemming, tick, extraCooldown = 0) {
    const cooldown = Math.max(this.aiActionCooldown, extraCooldown || 0);
    this._aiLemmingCooldown.set(lemming.id, tick + cooldown);
  }

  _canSpend(key) {
    if (!this._aiBudget || !this._aiBudgetMax) return false;
    if (!Object.prototype.hasOwnProperty.call(this._aiBudget, key)) return false;
    if (this._aiBudget[key] < 1) return false;
    this._aiBudget[key] -= 1;
    return true;
  }

  _refundBudget(key) {
    if (!this._aiBudget || !this._aiBudgetMax) return;
    if (!Object.prototype.hasOwnProperty.call(this._aiBudget, key)) return;
    this._aiBudget[key] = Math.min(this._aiBudgetMax[key], this._aiBudget[key] + 1);
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
    if (Math.random() < 0.001) {
      const manager = this.game?.getLemmingManager?.();
      manager?.doNukeAllLemmings?.();
    }
    this._nukeElapsed = 0;
  }

  _getFollowLemming() {
    const manager = this.game?.getLemmingManager?.();
    const first = manager?.getLemming?.(0);
    if (first && Number.isFinite(first.x) && first.lookRight) return first;
    const lems = manager?.activeLemmings || manager?.lemmings || [];
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
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
      if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
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
      edgeX: Number.isFinite(originX) ? originX : null,
      edgeAction: null,
      used: new Set()
    };
    this._builderBurst.dueTick = tick + this._builderBurst.nextDelay;
  }

  _scheduleEdgeResponse(edgeX, edgeAction) {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    this._builderBurst = {
      remaining: 1,
      nextDelay: this._randInt(6, 14),
      dueTick: tick + this._randInt(6, 14),
      originX: Number.isFinite(edgeX) ? edgeX : null,
      edgeX: Number.isFinite(edgeX) ? edgeX : null,
      edgeAction: edgeAction || 'blocker',
      used: new Set()
    };
  }

  _processBuilderBurst() {
    const burst = this._builderBurst;
    if (!burst || burst.remaining <= 0) return;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    if (burst.dueTick > tick) return;
    if (burst.edgeAction) {
      const handled = this._applyEdgeResponse(burst, tick);
      burst.remaining -= handled ? 1 : 0;
      if (burst.remaining <= 0) {
        this._builderBurst = null;
      } else {
        burst.dueTick = tick + burst.nextDelay;
      }
      return;
    }
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

  _applyEdgeResponse(burst, tick) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length || !Number.isFinite(burst.edgeX)) return false;
    const edgeX = burst.edgeX + (burst.edgeAction === 'blocker' ? 2 : 0);
    let best = null;
    let bestDist = Infinity;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      if (this._shouldSkipAiFor(lem, tick)) continue;
      const actionName = lem.action?.getActionName?.() || '';
      if (actionName && actionName !== 'walking') continue;
      if (burst.edgeAction === 'builder-left' && lem.lookRight) continue;
      if (burst.edgeAction === 'blocker' && lem.lookRight) continue;
      const dist = Math.abs((lem.x ?? 0) - edgeX);
      if (dist < bestDist) {
        bestDist = dist;
        best = lem;
      }
    }
    if (!best) return false;
    const skill = burst.edgeAction === 'builder-left' ? SkillTypes.BUILDER : SkillTypes.BLOCKER;
    const key = burst.edgeAction === 'builder-left' ? 'builder' : 'blocker';
    if (!this._canSpend(key)) return false;
    if (manager.doLemmingAction(best, skill)) {
      this._noteAiAction(best, tick, burst.edgeAction === 'builder-left' ? 48 : 32);
      return true;
    }
    this._refundBudget(key);
    return false;
  }

  _processGapBridges() {
    if (!this._gaps.length) return;
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return;
    const follow = this._getFollowLemming();
    const leadId = follow?.id ?? null;
    const leadX = Number.isFinite(follow?.x) ? follow.x : null;
    for (const gap of this._gaps) {
      if (!gap || gap.assigned) continue;
      if (!Number.isFinite(gap.x) || !Number.isFinite(gap.width)) continue;
      const triggerX = gap.x - this.gapTriggerDistance;
      if (Number.isFinite(leadX) && leadX < triggerX) continue;
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
        const actionName = lem.action?.getActionName?.() || '';
        if (actionName && actionName !== 'walking') continue;
        const dist = Math.abs((lem.x ?? 0) - gap.x);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (!best) continue;
      if (leadId != null && best.id !== leadId && Number.isFinite(leadX)) {
        if (best.x < leadX - 8) continue;
      }
      if (manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        const timer = this.game?.getGameTimer?.();
        const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
        this._noteAiAction(best, tick, 48);
        gap.assigned = true;
      }
    }
    const cutoff = Number.isFinite(this._cameraX) ? this._cameraX - 200 : null;
    this._gaps = this._gaps.filter(gap => {
      if (!gap) return false;
      if (!gap.assigned) return true;
      if (cutoff == null) return false;
      return gap.x + gap.width > cutoff;
    });
  }

  _processMidairBuilder() {
    const pending = this._pendingMidairBuilder;
    if (!pending) return;
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    const ground = this.level?.groundMask;
    const levelHeight = this.level?.height ?? 0;
    const maxDrop = Math.min(this.maxDrop, levelHeight);
    let target = null;

    if (Number.isFinite(pending.targetId)) {
      target = manager?.getLemming?.(pending.targetId) || null;
      const actionName = target?.action?.getActionName?.() || '';
      if (!target || target.removed || target.disabled || actionName !== 'falling') {
        pending.targetId = null;
        pending.dueTick = null;
        target = null;
      }
    }

    if (!target) {
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled) continue;
        const actionName = lem.action?.getActionName?.() || '';
        if (actionName !== 'falling') continue;
        pending.targetId = lem.id;
        pending.dueTick = tick + pending.delay;
        target = lem;
        break;
      }
    }

    if (!target || !Number.isFinite(pending.dueTick)) return;
    if (tick < pending.dueTick) return;
    if (!this._canSpend('builder')) return;

    const drop = ground && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? this._getDropAt(ground, Math.floor(target.x), Math.floor(target.y), maxDrop)
      : null;
    if (drop != null && drop <= 1) {
      this._refundBudget('builder');
      return;
    }

    if (manager.doLemmingAction(target, SkillTypes.BUILDER)) {
      this._noteAiAction(target, tick, 48);
      this._pendingMidairBuilder = null;
      return;
    }
    this._refundBudget('builder');
  }

  _applyBuilderToNextLemming(burst) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return false;
    if (Number.isFinite(burst?.edgeX)) {
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
        const actionName = lem.action?.getActionName?.() || '';
        if (actionName && actionName !== 'walking') continue;
        if (this._shouldSkipAiFor(lem, this.game?.getGameTimer?.().tickIndex ?? 0)) continue;
        if (burst.used?.has?.(lem.id)) continue;
        if (lem.x > burst.edgeX + 8) continue;
        const dist = Math.abs((lem.x ?? 0) - burst.edgeX);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (best && manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(best, tick, 48);
        burst.used?.add?.(best.id);
        return true;
      }
    }
    if (Number.isFinite(burst?.originX)) {
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
        const actionName = lem.action?.getActionName?.() || '';
        if (actionName && actionName !== 'walking') continue;
        if (this._shouldSkipAiFor(lem, this.game?.getGameTimer?.().tickIndex ?? 0)) continue;
        if (burst.used?.has?.(lem.id)) continue;
        const dist = Math.abs((lem.x ?? 0) - burst.originX);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (best && manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(best, tick, 48);
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
      const actionName = lem.action?.getActionName?.() || '';
      if (actionName && actionName !== 'walking') continue;
      this._builderCursorId = idx + 1;
      if (manager.doLemmingAction(lem, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(lem, tick, 48);
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
      if (this._shouldInsertGap()) {
        const gapWidth = this._pickGapWidth();
        const gapStart = this._groundEndX;
        this._gaps.push({
          x: gapStart,
          width: gapWidth,
          y: this._groundTopY,
          assigned: false
        });
        this._groundEndX = Math.min(levelWidth, this._groundEndX + gapWidth);
        this._gapCooldown = this._randInt(16, 40);
        continue;
      }
      const nextTop = this._pickNextTopY();
      const colorIndex = this._getNextColorIndex();
      this._paintGround(this._groundEndX, segmentWidth, nextTop, colorIndex);
      this._groundTopY = nextTop;
      this._groundEndX = Math.min(levelWidth, this._groundEndX + segmentWidth);
    }
  }

  _paintGround(startX, width, topY, colorIndex) {
    if (this.assets && this.stamper) {
      this._paintGroundPieces(startX, width, topY, colorIndex);
      return;
    }
    this._paintGroundPixels(startX, width, topY, colorIndex);
  }

  _paintGroundPixels(startX, width, topY, colorIndex) {
    if (!this.level) return;
    const levelWidth = this.level.width;
    const levelHeight = this.level.height;
    const x0 = Math.max(0, startX);
    const x1 = Math.min(levelWidth, startX + width);
    const top = Number.isFinite(topY) ? topY : levelHeight - this.groundHeight;
    const y0 = Math.max(0, Math.min(levelHeight - this.groundHeight, top));
    const y1 = Math.min(levelHeight, y0 + this.groundHeight);
    const paletteIndex = Number.isFinite(colorIndex)
      ? colorIndex
      : this.groundColorIndex;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.level.setGroundAt(x, y, paletteIndex);
      }
    }
  }

  _paintGroundPieces(startX, width, topY, colorIndex) {
    if (!this.level || !this.assets || !this.stamper) return;
    const levelWidth = this.level.width;
    const maxX = Math.min(levelWidth, startX + width);
    const floorY = (Number.isFinite(topY) ? topY : 0) + this.groundHeight - 1;
    let cursor = Math.max(0, startX);
    const decorBias = Number.isFinite(colorIndex) ? (colorIndex % 4) : 0;
    const structure = this._getStructurePlan();
    let repeatPiece = null;
    while (cursor < maxX) {
      const remaining = maxX - cursor;
      let surfaceY = this._nextSurfaceY(structure, floorY);
      const minHeight = structure?.type === 'pillar'
        ? Math.max(this.groundHeight * 3, 8)
        : this.groundHeight;
      const minWidth = structure?.type === 'shelf'
        ? Math.max(6, this.segmentMinWidth)
        : 1;
      const piece = repeatPiece && remaining >= repeatPiece.bounds.width
        ? repeatPiece
        : this.assets.pickGroundPiece(remaining, minHeight, minWidth);
      if (!piece?.bounds?.width) break;
      if (!repeatPiece || Math.random() < 0.25) {
        repeatPiece = piece;
      }
      const stamped = structure?.type === 'pillar'
        ? this._stampVerticalRun(cursor, surfaceY, piece)
        : this._stampHorizontalRun(cursor, surfaceY, piece, maxX, decorBias);
      cursor += stamped;
      if (cursor >= maxX) break;
    }
  }

  _stampHorizontalRun(cursorX, surfaceY, piece, maxX, decorBias) {
    const pieceWidth = Math.max(1, piece.bounds.width);
    const repeats = Math.max(1, Math.floor((maxX - cursorX) / pieceWidth));
    let stamped = 0;
    for (let i = 0; i < repeats; i++) {
      const destX = cursorX + stamped - piece.bounds.minX;
      const destY = this._clampSurfaceForEntrance(surfaceY, piece, cursorX + stamped) - piece.bounds.maxY;
      this.stamper.stamp(piece, destX, destY);
      if (Math.random() < (this.decorChance + decorBias * 0.01)) {
        this._placeDecoration(destX, destY, piece);
      }
      stamped += pieceWidth;
    }
    return stamped || pieceWidth;
  }

  _stampVerticalRun(cursorX, surfaceY, piece) {
    const pieceWidth = Math.max(1, piece.bounds.width);
    const pieceHeight = Math.max(1, piece.bounds.height);
    const repeats = Math.max(2, Math.ceil(this.groundHeight / pieceHeight));
    let topY = surfaceY;
    for (let i = 0; i < repeats; i++) {
      const destX = cursorX - piece.bounds.minX;
      const destY = topY - piece.bounds.maxY;
      this.stamper.stamp(piece, destX, destY);
      topY -= pieceHeight;
    }
    return pieceWidth;
  }

  _getStructurePlan() {
    if (!this._structurePlan || this._structurePlan.remaining <= 0) {
      this._structurePlan = this._seedStructurePlan();
    }
    return this._structurePlan;
  }

  _seedStructurePlan() {
    const roll = Math.random();
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
      direction: Math.random() < 0.5 ? -1 : 1,
      turnAt: Math.max(1, Math.floor(length / 2))
    };
  }

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
  }

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
  }

  _placeDecoration(baseX, baseY, basePiece) {
    if (!this.assets || !this.stamper) return;
    const decor = this.assets.pickDecorPiece(32);
    if (!decor?.bounds) return;
    const offsetX = basePiece?.bounds?.minX ?? 0;
    const destX = baseX + offsetX + this._randInt(-4, 6);
    const raise = this._randInt(6, 22);
    const destY = baseY - decor.bounds.height - raise;
    this.stamper.stamp(decor, destX, destY);
  }

  _pickSegmentWidth() {
    const min = Math.max(2, Math.floor(this.segmentMinWidth));
    const max = Math.max(min, Math.floor(this.segmentMaxWidth));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _pickGapWidth() {
    const min = Math.max(2, Math.floor(this.gapMinWidth));
    const max = Math.max(min, Math.floor(this.gapMaxWidth));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _shouldInsertGap() {
    if (this._gapCooldown > 0) {
      this._gapCooldown -= 1;
      return false;
    }
    if (Math.random() > this.gapChance) return false;
    return true;
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

  _initDebugOverlay() {
    if (!this.window?.document || this._aiDebug) return;
    const doc = this.window.document;
    const panel = doc.createElement('div');
    panel.className = 'procgen-debug';
    panel.textContent = 'AI: ready';
    doc.body.appendChild(panel);
    this._aiDebug = panel;
  }

  _updateDebugOverlay() {
    if (!this._aiDebug) return;
    const decision = this._aiLastDecision;
    if (!decision) return;
    const action = decision.action || 'none';
    const scan = decision.scan || {};
    const gap = scan.gap ? `gap dx=${scan.gap.dx} w=${scan.gap.width} drop=${scan.gap.drop}` : 'gap none';
    const wall = scan.wall ? `wall dx=${scan.wall.dx} h=${scan.wall.height}` : 'wall none';
    const hazard = scan.hazard ? `hazard dx=${scan.hazard.dx} type=${scan.hazard.type}` : 'hazard none';
    const budget = this._aiBudget
      ? Object.entries(this._aiBudget)
        .map(([key, value]) => `${key}:${value.toFixed(1)}`)
        .join(' ')
      : '';
    this._aiDebug.textContent = `AI ${action} | ${gap} | ${wall} | ${hazard} | ${budget}`;
  }
}

export { ProcgenController };
