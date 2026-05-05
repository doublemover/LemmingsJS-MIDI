import {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
} from './ProcgenControllerShared.js';
const procgenTerrainDirectorMethods = {
  getGroundExtentX() {
    return Math.max(1, Math.floor(this._groundEndX || 0));
  },

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
  },

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
  },

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
  },

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
  },

  _applyEdgeResponse(burst, tick) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length || !Number.isFinite(burst.edgeX)) return false;
    const edgeX = burst.edgeX + (burst.edgeAction === 'blocker' ? 2 : 0);
    let best = null;
    let bestDist = Infinity;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
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
  },

  _processGapBridges() {
    if (!this._gaps.length) return;
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    let leadX = null;
    if (lems.length) {
      const follow = this._getFollowLemming();
      const leadId = follow?.id ?? null;
      leadX = Number.isFinite(follow?.x) ? follow.x : null;
      this._advanceGapScanCursor(leadX);
      const maxTriggerX = Number.isFinite(leadX) ? leadX + this.gapTriggerDistance : Infinity;
      for (let i = this._gapScanStart; i < this._gaps.length; i += 1) {
        const gap = this._gaps[i];
        if (!gap || gap.assigned) continue;
        if (!Number.isFinite(gap.x) || !Number.isFinite(gap.width)) continue;
        if (gap.x > maxTriggerX) break;
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
    }
    this._pruneGapQueue(leadX);
  },

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
  },

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
  },

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
  },

  _paintGround(startX, width, topY, colorIndex) {
    if (this.assets && this.stamper) {
      this._paintGroundPieces(startX, width, topY, colorIndex);
      return;
    }
    this._paintGroundPixels(startX, width, topY, colorIndex);
  },

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
    if (typeof this.level.setGroundRect === 'function') {
      this.level.setGroundRect(x0, y0, x1 - x0, y1 - y0, paletteIndex, {
        recordHistory: false,
        invalidateMiniMap: true
      });
      return;
    }
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        this.level.setGroundAt(x, y, paletteIndex);
      }
    }
  },

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
      const repeatWidth = repeatPiece?.width ?? repeatPiece?.bounds?.width ?? 0;
      const piece = repeatPiece && remaining >= repeatWidth
        ? repeatPiece
        : this.assets.pickGroundPiece(remaining, minHeight, minWidth);
      if (!piece?.bounds?.width) break;
      if (!repeatPiece || this._rand() < 0.25) {
        repeatPiece = piece;
      }
      const stamped = structure?.type === 'pillar'
        ? this._stampVerticalRun(cursor, surfaceY, piece)
        : this._stampHorizontalRun(cursor, surfaceY, piece, maxX, decorBias);
      cursor += stamped;
      if (cursor >= maxX) break;
    }
  },

  _stampHorizontalRun(cursorX, surfaceY, piece, maxX, decorBias) {
    const pieceWidth = Math.max(1, piece.width || piece.bounds.width);
    const repeats = Math.max(1, Math.floor((maxX - cursorX) / pieceWidth));
    let stamped = 0;
    for (let i = 0; i < repeats; i++) {
      const destX = cursorX + stamped - piece.bounds.minX;
      const destY = this._clampSurfaceForEntrance(surfaceY, piece, cursorX + stamped) - piece.bounds.maxY;
      this.stamper.stamp(piece, destX, destY);
      if (this._rand() < (this.decorChance + decorBias * 0.01)) {
        this._placeDecoration(destX, destY, piece);
      }
      stamped += pieceWidth;
    }
    return stamped || pieceWidth;
  },

  _stampVerticalRun(cursorX, surfaceY, piece) {
    const pieceWidth = Math.max(1, piece.width || piece.bounds.width);
    const pieceHeight = Math.max(1, piece.height || piece.bounds.height);
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
};
export { procgenTerrainDirectorMethods };