import {
  SkillTypes,
  SoundEventTypes
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
    this._frontierLemmingState.clear();
    this._gaps.length = 0;
    this._gapScanStart = 0;
    this._scanCache = null;
    this._scanCacheGround = null;
    this._scanCacheTick = -Infinity;
    this._lastNoopAssist = null;
    this._recentAssists.length = 0;
    this._recentChunks.length = 0;
    this._recentPieces.length = 0;
    this._recentDecor.length = 0;
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
    this._recordGeneratedChunk?.({
      type: 'initial-ground',
      x: startX,
      y: this._groundTopY,
      width: this.initialGroundWidth,
      height: this.groundHeight,
      endX: startX + this.initialGroundWidth
    });
  },

  _onTick() {
    if (!this._running) return;
    this._updateTimers();
    const frontier = this._getFrontierLemming();
    const frontierX = Number.isFinite(frontier?.x) ? frontier.x : null;
    const guideX = Number.isFinite(frontierX) ? frontierX : this._getRightmostX();
    if (!Number.isFinite(guideX)) return;
    this._ensureGround(guideX);
    this._processBuilderBurst();
    this._processGapBridges();
    this._processMidairBuilder();
    this._updateAiDirector();
    this._updateCamera(Number.isFinite(frontierX) ? frontierX : guideX);
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

  _getSelectedTheme() {
    return this._selectedTheme ||
      this._themeContract?.selectedTheme ||
      this.assets?.styleName ||
      this.level?.styleName ||
      null;
  },

  _trimRecentList(list, maxLength) {
    if (!Array.isArray(list) || list.length <= maxLength) return;
    list.splice(0, list.length - maxLength);
  },

  _pruneGeneratedTracking(referenceX = null) {
    const anchorX = Number.isFinite(referenceX) ? referenceX : this._getRightmostX();
    if (!Number.isFinite(anchorX)) return;
    const cutoff = anchorX - this.generatedTrackingPruneDistance;
    const keepRecent = entry => {
      const endX = Number(entry?.endX ?? ((entry?.x ?? entry?.startX) + entry?.width));
      return !Number.isFinite(endX) || endX >= cutoff;
    };
    if (Array.isArray(this._recentChunks)) {
      for (let i = this._recentChunks.length - 1; i >= 0; i -= 1) {
        if (keepRecent(this._recentChunks[i])) continue;
        this._recentChunks.splice(i, 1);
      }
      this._trimRecentList(this._recentChunks, this.recentChunkLimit);
    }
    if (Array.isArray(this._recentPieces)) {
      for (let i = this._recentPieces.length - 1; i >= 0; i -= 1) {
        if (keepRecent(this._recentPieces[i])) continue;
        this._recentPieces.splice(i, 1);
      }
      this._trimRecentList(this._recentPieces, this.recentPieceLimit);
    }
  },

  _trackGeneratedChunk(chunk) {
    if (!chunk) return;
    const startX = Number(chunk.startX ?? chunk.x);
    const endX = Number(chunk.endX ?? (startX + Number(chunk.width)));
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return;
    this._recentChunkSerial += 1;
    this._recentChunks.push({
      serial: this._recentChunkSerial,
      type: chunk.type || 'terrain',
      theme: this._getSelectedTheme(),
      startX,
      endX,
      width: Math.max(0, endX - startX),
      y: Number.isFinite(chunk.y) ? chunk.y : null,
      topY: Number.isFinite(chunk.topY) ? chunk.topY : null,
      colorIndex: Number.isFinite(chunk.colorIndex) ? chunk.colorIndex : null
    });
    this._trimRecentList(this._recentChunks, this.recentChunkLimit);
  },

  _recordGeneratedChunk(chunk) {
    this._trackGeneratedChunk(chunk);
  },

  _trackGeneratedPiece(piece, destX, destY, role = 'ground', rect = null) {
    if (!piece?.bounds) return;
    if (!Number.isFinite(destX) || !Number.isFinite(destY)) return;
    const x = Number.isFinite(rect?.x) ? rect.x : destX + piece.bounds.minX;
    const y = Number.isFinite(rect?.y) ? rect.y : destY + piece.bounds.minY;
    const width = Number.isFinite(rect?.width) ? rect.width : piece.bounds.width;
    const height = Number.isFinite(rect?.height) ? rect.height : piece.bounds.height;
    this._recentPieceSerial += 1;
    this._recentPieces.push({
      serial: this._recentPieceSerial,
      role,
      theme: piece.styleName || piece.theme || this._getSelectedTheme(),
      pieceId: piece.id ?? null,
      x,
      y,
      endX: x + width,
      width,
      height,
      bounds: {
        minX: piece.bounds.minX,
        minY: piece.bounds.minY,
        maxX: piece.bounds.maxX,
        maxY: piece.bounds.maxY,
        width: piece.bounds.width,
        height: piece.bounds.height
      }
    });
    this._trimRecentList(this._recentPieces, this.recentPieceLimit);
  },

  _summarizeScan(scan) {
    if (!scan) return null;
    return {
      direction: scan.direction ?? null,
      gap: scan.gap ? {
        dx: scan.gap.dx,
        width: scan.gap.width,
        drop: scan.gap.drop
      } : null,
      wall: scan.wall ? {
        dx: scan.wall.dx,
        height: scan.wall.height
      } : null,
      hazard: scan.hazard ? {
        dx: scan.hazard.dx,
        type: scan.hazard.type
      } : null
    };
  },

  _getSkillName(skillType) {
    for (const [name, value] of Object.entries(SkillTypes)) {
      if (value === skillType) return name.toLowerCase();
    }
    return null;
  },

  _recordAssistDecision(entry = {}) {
    const timer = this.game?.getGameTimer?.();
    const fallbackTick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    const tick = Number.isFinite(entry.tick) ? entry.tick : fallbackTick;
    const lemming = entry.lemming || null;
    const type = entry.type || (entry.skillType != null ? 'skill' : 'noop');
    const reason = entry.reason || type;
    if (type === 'noop') {
      const bucketX = Number.isFinite(lemming?.x) ? Math.floor(lemming.x / 32) : null;
      const key = `${lemming?.id ?? 'none'}:${bucketX}:${reason}`;
      if (
        this._lastNoopAssist &&
        this._lastNoopAssist.key === key &&
        tick - this._lastNoopAssist.tick < this.aiNoopDebugIntervalTicks
      ) {
        return;
      }
      this._lastNoopAssist = { key, tick };
    }
    const skillType = entry.skillType ?? entry.skill ?? null;
    this._recentAssists.push({
      tick,
      type,
      reason,
      action: entry.action || entry.key || null,
      skillType,
      skillName: entry.skillName || this._getSkillName(skillType),
      spent: entry.spent === true,
      success: entry.success !== false,
      targetX: Number.isFinite(entry.targetX) ? entry.targetX : null,
      lemming: lemming ? {
        id: lemming.id ?? null,
        x: Number.isFinite(lemming.x) ? lemming.x : null,
        y: Number.isFinite(lemming.y) ? lemming.y : null,
        lookRight: !!lemming.lookRight,
        action: this._getLemmingActionName(lemming) || null
      } : null,
      scan: this._summarizeScan(entry.scan)
    });
    this._trimRecentList(this._recentAssists, 32);
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
