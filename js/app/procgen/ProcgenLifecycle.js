import {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
} from './ProcgenControllerShared.js';
const procgenLifecycleMethods = {
  start() {
    if (this._running) return;
    if (!this.game || !this.level) return;
    this._running = true;
    this._initGround();
    this._initAiDirector();
    this._rebuildHazardIndex(0);
    if (this.aiDebugOverlay) {
      this._initDebugOverlay();
    }
    const stage = this.view?.stage || null;
    if (stage?.gameImgProps?.viewPoint) {
      this._cameraX = stage.gameImgProps.viewPoint.x || 0;
    }
    this._bindTimer();
    this._bindSoundEvents();
  },

  stop() {
    if (!this._running) return;
    this._running = false;
    this._unbindTimer();
    this._unbindSoundEvents();
    this._destroyDebugOverlay();
    this._builderBurst = null;
    this._pendingMidairBuilder = null;
    this._seenFalls.clear();
    this._aiLemmingCooldown.clear();
    this._aiStallState.clear();
    this._gaps.length = 0;
    this._gapScanStart = 0;
    this._scanCache = null;
    this._scanCacheGround = null;
    this._scanCacheTick = -Infinity;
  },

  _bindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.on) return;
    this._tickHandler = () => this._onTick();
    timer.onGameTick.on(this._tickHandler);
  },

  _unbindTimer() {
    const timer = this.game?.getGameTimer?.();
    if (!timer?.onGameTick?.off || !this._tickHandler) return;
    timer.onGameTick.off(this._tickHandler);
    this._tickHandler = null;
  },

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
      const timer = this.game?.getGameTimer?.();
      const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
      if (Number.isFinite(lemmingId)) {
        const seenAtTick = this._seenFalls.get(lemmingId);
        if (Number.isFinite(seenAtTick) && tick - seenAtTick <= this.fallEventMemoryTicks) {
          return;
        }
        this._seenFalls.set(lemmingId, tick);
      }
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
  },

  _unbindSoundEvents() {
    const bus = this.game?.soundEvents;
    if (bus?.onEvent?.off && this._soundHandler) {
      bus.onEvent.off(this._soundHandler);
    }
    this._soundHandler = null;
  },

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
  },

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
  },

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
    this._trackerPruneElapsed += delta;
    this._updateAiBudget(delta);
    this._maybeTriggerBomber();
    this._maybeTriggerNuke();
    if (this._trackerPruneElapsed >= this.aiTrackerPruneIntervalSeconds) {
      this._trackerPruneElapsed = 0;
      this._pruneTrackingState(tick);
    }
  },

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
  },

  _initDebugOverlay() {
    if (!this.window?.document || this._aiDebug) return;
    const doc = this.window.document;
    const panel = doc.createElement('div');
    panel.className = 'procgen-debug';
    panel.textContent = 'AI: ready';
    doc.body.appendChild(panel);
    this._aiDebug = panel;
  },

  _destroyDebugOverlay() {
    if (!this._aiDebug) return;
    this._aiDebug.remove();
    this._aiDebug = null;
  },

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
};
export { procgenLifecycleMethods };