import {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
} from './ProcgenControllerShared.js';
const procgenAiDirectorMethods = {
  _initAiDirector() {
    this._aiDecisionInterval = Math.max(1, Math.floor(this.aiDecisionInterval));
    this._aiBudgetMax = {
      builder: 14,
      floater: 10,
      bash: 8,
      mine: 5,
      dig: 6,
      blocker: 6
    };
    this._aiBudget = {
      builder: 10,
      floater: 8,
      bash: 6,
      mine: 4,
      dig: 5,
      blocker: 5
    };
    this._aiBudgetRegen = {
      builder: 2.2,
      floater: 1.4,
      bash: 1.1,
      mine: 0.7,
      dig: 0.9,
      blocker: 0.8
    };
  },

  _updateAiBudget(deltaSeconds) {
    if (!this._aiBudget || !this._aiBudgetMax || !this._aiBudgetRegen) return;
    const delta = Math.max(0, deltaSeconds);
    for (const key of Object.keys(this._aiBudget)) {
      const next = this._aiBudget[key] + this._aiBudgetRegen[key] * delta;
      this._aiBudget[key] = Math.min(this._aiBudgetMax[key], next);
    }
  },

  _updateAiDirector() {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    if (!Number.isFinite(tick)) return;
    if (tick - this._aiLastDecisionTick < this._aiDecisionInterval) return;
    this._aiLastDecisionTick = tick;
    this._beginScanCacheWindow(tick);

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
  },

  _beginScanCacheWindow(tick) {
    const ground = this.level?.groundMask || null;
    if (this._scanCache &&
          this._scanCacheTick === tick &&
          this._scanCacheGround === ground) {
      return this._scanCache;
    }
    this._scanCacheTick = Number.isFinite(tick) ? tick : -Infinity;
    this._scanCacheGround = ground;
    this._scanCache = {
      drop: new Map(),
      wall: new Map(),
      gap: new Map(),
      hazard: new Map()
    };
    return this._scanCache;
  },

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
      const x = Number.isFinite(lem.x) ? Math.floor(lem.x) : null;
      const y = Number.isFinite(lem.y) ? Math.floor(lem.y) : null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const nearLeftEdge = x <= 2;
      const drop = this._getDropAt(ground, x - 1, y, this.maxDrop);
      if ((nearLeftEdge || drop > 0) && this._canSpend('blocker')) {
        if (manager.doLemmingAction(lem, SkillTypes.BLOCKER)) {
          this._noteAiAction(lem, tick, 32);
          return;
        }
        this._refundBudget('blocker');
      }
    }
  },

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
  },

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
  },

  _getDropAt(ground, x, y, maxDrop) {
    const cache = this._scanCacheGround === ground ? this._scanCache?.drop : null;
    const cacheKey = cache ? `${x}|${y}|${maxDrop}` : null;
    if (cache && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const height = this.level?.height ?? 0;
    const top = y + 1;
    if (top < 0 || top >= height) {
      if (cache) cache.set(cacheKey, 0);
      return 0;
    }
    const available = Math.max(1, Math.min(maxDrop + 2, height - top));
    const depth = ground.getColumnGapDepth(x, top, available);
    const drop = depth <= 1 ? 0 : depth - 1;
    if (cache) cache.set(cacheKey, drop);
    return drop;
  },

  _measureGapWidth(ground, startX, y, scanAhead, dir) {
    const cache = this._scanCacheGround === ground ? this._scanCache?.gap : null;
    const cacheKey = cache ? `${startX}|${y}|${scanAhead}|${dir}|${this.maxDrop}` : null;
    if (cache && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    let width = 0;
    for (let dx = 0; dx <= scanAhead; dx++) {
      const drop = this._getDropAt(ground, startX + dx * dir, y, this.maxDrop);
      if (drop <= 0) break;
      width += 1;
      if (width >= scanAhead) break;
    }
    if (cache) cache.set(cacheKey, width);
    return width;
  },

  _getWallHeight(ground, x, y, maxHeight, dir) {
    const height = Math.max(1, Math.floor(maxHeight));
    const cache = this._scanCacheGround === ground ? this._scanCache?.wall : null;
    const cacheKey = cache ? `${x}|${y}|${height}` : null;
    if (cache && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    const wall = typeof ground.getColumnWallHeight === 'function'
      ? ground.getColumnWallHeight(x, y, height)
      : (() => {
        let result = 0;
        for (let dy = 1; dy <= height; dy++) {
          if (ground.hasGroundAt(x, y - dy)) result = dy;
        }
        return result;
      })();
    if (cache) cache.set(cacheKey, wall);
    return wall;
  },

  _findHazardAhead(x, y, scanAhead, dir) {
    const triggerList = this.level?.triggers;
    const sourceSize = triggerList?.length ?? 0;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    const dueRefresh = tick - this._hazardIndexLastRefreshTick >= this.aiHazardIndexRefreshTicks;
    if (triggerList !== this._hazardTriggerSource ||
          sourceSize !== this._hazardTriggerSourceSize ||
          dueRefresh) {
      this._rebuildHazardIndex(tick);
    }
    const hazards = this._hazardTriggers;
    if (!hazards.length) return null;
    const hazardCache = this._scanCache?.hazard || null;
    const hazardCacheKey = hazardCache
      ? `${x}|${y}|${scanAhead}|${dir}|${this._hazardIndexLastRefreshTick}`
      : null;
    if (hazardCache && hazardCache.has(hazardCacheKey)) {
      return hazardCache.get(hazardCacheKey);
    }
    const maxDx = Math.max(1, Math.floor(scanAhead));
    const minX = dir >= 0 ? x + 1 : x - maxDx;
    const maxX = dir >= 0 ? x + maxDx : x - 1;
    let best = null;
    for (let i = 0; i < hazards.length; i += 1) {
      const trigger = hazards[i];
      if (trigger.x1 > maxX) break;
      if (trigger.x2 <= minX) continue;
      if (y < trigger.y1 || y >= trigger.y2) continue;
      const rightEdge = trigger.x2 - 1;
      const dx = dir >= 0
        ? (trigger.x1 <= x + 1 ? 1 : trigger.x1 - x)
        : (rightEdge >= x - 1 ? 1 : x - rightEdge);
      if (dx < 1 || dx > maxDx) continue;
      if (!best || dx < best.dx) {
        best = { dx, type: trigger.type };
        if (dx === 1) break;
      }
    }
    if (hazardCache) {
      hazardCache.set(hazardCacheKey, best);
    }
    return best;
  },

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
      if (scan.wall.height >= this.aiWallHeight + 4 || this._rand() < 0.15) {
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
  },

  _shouldSkipAiFor(lemming, tick) {
    if (!lemming || !Number.isFinite(tick)) return true;
    const last = this._aiLemmingCooldown.get(lemming.id);
    if (Number.isFinite(last) && tick < last) return true;
    return false;
  },

  _noteAiAction(lemming, tick, extraCooldown = 0) {
    const cooldown = Math.max(this.aiActionCooldown, extraCooldown || 0);
    this._aiLemmingCooldown.set(lemming.id, tick + cooldown);
  },

  _canSpend(key) {
    if (!this._aiBudget || !this._aiBudgetMax) return false;
    if (!Object.prototype.hasOwnProperty.call(this._aiBudget, key)) return false;
    if (this._aiBudget[key] < 1) return false;
    this._aiBudget[key] -= 1;
    return true;
  },

  _refundBudget(key) {
    if (!this._aiBudget || !this._aiBudgetMax) return;
    if (!Object.prototype.hasOwnProperty.call(this._aiBudget, key)) return;
    this._aiBudget[key] = Math.min(this._aiBudgetMax[key], this._aiBudget[key] + 1);
  },

  _maybeTriggerBomber() {
    if (this._bombCheckElapsed < 30) return;
    if (this._rand() < this._bombChance) {
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
  },

  _maybeTriggerNuke() {
    if (this._nukeElapsed < 60) return;
    if (this._rand() < 0.001) {
      const manager = this.game?.getLemmingManager?.();
      manager?.doNukeAllLemmings?.();
    }
    this._nukeElapsed = 0;
  },

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
};
export { procgenAiDirectorMethods };