// @ts-check
import { SkillTypes } from '../SkillTypes.js';
import { Trigger } from '../../level/Trigger.js';
import {
  COLD_BLOCK_MAGIC,
  COLD_BLOCK_VERSION,
  COLD_DELTA_SENTINEL,
  DEFAULT_OPTIONS,
  DELTA_CODEC_VERSION,
  DELTA_FLAG_ENTRANCE,
  DELTA_FLAG_GROUND,
  DELTA_FLAG_LEMMING_ADDS,
  DELTA_FLAG_LEMMING_CHANGES,
  DELTA_FLAG_LEMMING_MANAGER,
  DELTA_FLAG_LEMMING_MUTATIONS,
  DELTA_FLAG_LEMMING_REMOVALS,
  DELTA_FLAG_MINIMAP_DEATHS,
  DELTA_FLAG_OBJECTS,
  DELTA_FLAG_SCALARS,
  DELTA_FLAG_SOUND_EVENTS,
  DELTA_FLAG_TRIGGERS,
  NULL_INT32,
  normalizeOptions,
  toI32
} from './HistoryShared.js';
import {
  BinaryReader,
  BinaryWriter,
  bytesEqual,
  fnv1aHashBytes,
  readTaggedValue,
  rleDecodeBytes,
  rleEncodeBytes,
  writeTaggedValue
} from './HistoryBinaryCodec.js';
import {
  applyLemmingSnapshot,
  cloneLemmingState,
  createLemmingState,
  ensureLemmingCapacity,
  snapshotLemming
} from './HistoryLemmingState.js';
import {
  computeDeltaFlags,
  createDelta,
  ensureDeltaFlags,
  isNoOpDelta,
  packLemmingChanges,
  packLemmingMutationList,
  packTimerStateForStorage,
  readPackedLemmingChanges,
  readPackedLemmingMutation,
  unpackLemmingChanges,
  unpackLemmingMutationList,
  unpackTimerStateFromStorage,
  writePackedLemmingChanges,
  writePackedLemmingMutation
} from './HistoryDeltaCodec.js';
import {
  MIDI_FLAG_OWNER_KIND,
  clonePlainObject,
  createMidiFlagTriggerOwner
} from './HistoryTriggerOwners.js';

const historyStoreLifecycleMethods = {
  _allocDelta(tickIndex) {
    const tick = Math.trunc(tickIndex);
    const delta = this._deltaPool.pop();
    if (!delta) return createDelta(tick);
    this._resetDelta(delta, tick);
    return delta;
  },

  _resetDelta(delta, tickIndex) {
    delta.tick = Math.trunc(tickIndex);
    delta.flags = 0;
    delta.lemChanges.ids.length = 0;
    delta.lemChanges.fields.length = 0;
    delta.lemChanges.prev.length = 0;
    delta.lemChanges.next.length = 0;
    delta.lemAdded.length = 0;
    delta.lemRemoved.length = 0;
    delta.lemmingManagerChanges = null;
    delta.groundChanges.indices.length = 0;
    delta.groundChanges.spans = null;
    delta.groundChanges.prevMask.length = 0;
    delta.groundChanges.prevR.length = 0;
    delta.groundChanges.prevG.length = 0;
    delta.groundChanges.prevB.length = 0;
    delta.groundChanges.nextMask.length = 0;
    delta.groundChanges.nextR.length = 0;
    delta.groundChanges.nextG.length = 0;
    delta.groundChanges.nextB.length = 0;
    delta.entranceChanges.indices.length = 0;
    delta.entranceChanges.prev.length = 0;
    delta.entranceChanges.next.length = 0;
    delta.triggerCooldownChanges.ids.length = 0;
    delta.triggerCooldownChanges.prev.length = 0;
    delta.triggerCooldownChanges.next.length = 0;
    delta.triggerAdd.length = 0;
    delta.triggerRemove.length = 0;
    delta.objectAnimChanges.ids.length = 0;
    delta.objectAnimChanges.prevFirst.length = 0;
    delta.objectAnimChanges.prevFinished.length = 0;
    delta.objectAnimChanges.nextFirst.length = 0;
    delta.objectAnimChanges.nextFinished.length = 0;
    delta.victoryChanges = null;
    delta.skillsChanges = null;
    delta.timerChanges = null;
    delta.gameChanges = null;
    delta.soundEvents.length = 0;
    delta.minimapDeaths.length = 0;
  },

  _releaseDelta(delta) {
    if (!delta || delta === COLD_DELTA_SENTINEL || typeof delta !== 'object') return;
    const limit = this.options.deltaPoolLimit ?? DEFAULT_OPTIONS.deltaPoolLimit;
    if (this._deltaPool.length >= limit) return;
    this._resetDelta(delta, 0);
    this._deltaPool.push(delta);
  },

  attach(game, { captureBaseline = true } = {}) {
    if (!game) return;
    this.game = game;
    this.timer = game.getGameTimer?.() || null;
    this._bindTimer();
    if (captureBaseline) {
      this.start();
    }
  },

  detach() {
    if (this.timer?.onBeforeGameTick && this._beforeTick) {
      this.timer.onBeforeGameTick.off(this._beforeTick);
    }
    if (this.timer?.onGameTick && this._afterTick) {
      this.timer.onGameTick.off(this._afterTick);
    }
    this._beforeTick = null;
    this._afterTick = null;
    this._recording = false;
    this.game = null;
    this.timer = null;
  },

  start() {
    if (!this.game) return;
    this.captureBaseline(this.game);
    this._recording = true;
    const tickIndex = this.timer?.tickIndex ?? 0;
    if (!this.keyframes[tickIndex]) {
      this._setKeyframe(tickIndex, this._captureKeyframe(this.game, tickIndex));
    }
  },

  captureReplayBaseline(game = this.game) {
    if (!game) return;
    this.captureBaseline(game);
    const tickIndex = game.getGameTimer?.()?.tickIndex ?? this.timer?.tickIndex ?? 0;
    this._setKeyframe(tickIndex, this._captureKeyframe(game, tickIndex));
  },

  pause() {
    this._recording = false;
    this._currentDelta = null;
    this._currentTick = null;
  },

  resume() {
    if (!this.game) return;
    this.captureBaseline(this.game);
    this._groundDirty = true;
    this._recording = true;
  },

  getKeyframeAtOrBefore(tickIndex) {
    if (!Number.isFinite(tickIndex)) return null;
    const ticks = this.keyframeTicks;
    if (!ticks.length) return null;
    const target = Math.max(0, Math.trunc(tickIndex));
    if (target < ticks[0]) return null;
    let lo = 0;
    let hi = ticks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] <= target) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const tick = ticks[Math.max(0, hi)];
    return this.keyframes[tick] || null;
  },

  truncateAfter(tickIndex) {
    if (!Number.isFinite(tickIndex)) return;
    if (this.options.preserveFutureHistory) return;
    const cutoff = Math.max(0, Math.trunc(tickIndex));
    this._truncateDeltasAfter(cutoff);
    this._truncateKeyframesAfter(cutoff);
  },

  _setDelta(tickIndex, delta) {
    const tick = Math.trunc(tickIndex);
    const block = this._ensureDeltaBlock(tick);
    if (block.cold) {
      this._thawDeltaBlock(block.startTick);
    }
    const prev = this.deltas[tick];
    if (!prev) {
      this.deltaCount += 1;
    } else if (prev !== COLD_DELTA_SENTINEL) {
      this._releaseDelta(prev);
    }
    this.deltas[tick] = delta;
    if (this.minDeltaTick == null || tick < this.minDeltaTick) {
      this.minDeltaTick = tick;
    }
    if (this.maxDeltaTick == null || tick > this.maxDeltaTick) {
      this.maxDeltaTick = tick;
    }
  },

  _setKeyframe(tickIndex, keyframe) {
    const tick = Math.trunc(tickIndex);
    if (!this.keyframes[tick]) {
      this.keyframeCount += 1;
      this._insertKeyframeTick(tick);
    }
    this.keyframes[tick] = keyframe;
    this._lastKeyframe = keyframe;
    if (this.minKeyframeTick == null || tick < this.minKeyframeTick) {
      this.minKeyframeTick = tick;
    }
    if (this.maxKeyframeTick == null || tick > this.maxKeyframeTick) {
      this.maxKeyframeTick = tick;
    }
  },

  _insertKeyframeTick(tickIndex) {
    const tick = Math.trunc(tickIndex);
    const list = this.keyframeTicks;
    const last = list[list.length - 1];
    if (last == null || tick > last) {
      list.push(tick);
      return;
    }
    if (tick === last) return;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < tick) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (list[lo] !== tick) list.splice(lo, 0, tick);
  },

  _truncateDeltasAfter(cutoff) {
    if (this.maxDeltaTick == null) return;
    const touchedBlocks = this._scratchTouchedBlocks;
    touchedBlocks.clear();
    for (let tick = this.maxDeltaTick; tick > cutoff; tick -= 1) {
      const delta = this.deltas[tick];
      if (!delta) continue;
      const blockStart = this._deltaBlockStart(tick);
      touchedBlocks.add(blockStart);
      if (delta === COLD_DELTA_SENTINEL) {
        this._thawDeltaBlock(blockStart);
      }
      const current = this.deltas[tick];
      this.deltas[tick] = undefined;
      this.deltaCount -= 1;
      this._releaseDelta(current);
    }
    for (const blockStart of touchedBlocks) {
      this._cleanupDeltaBlock(blockStart);
    }
    touchedBlocks.clear();
    let nextMax = Math.min(this.maxDeltaTick, cutoff);
    while (nextMax >= this.minDeltaTick && !this.deltas[nextMax]) {
      nextMax -= 1;
    }
    if (nextMax < this.minDeltaTick) {
      this.minDeltaTick = null;
      this.maxDeltaTick = null;
      this.deltaCount = 0;
      return;
    }
    this.maxDeltaTick = nextMax;
  },

  _truncateKeyframesAfter(cutoff) {
    if (this.maxKeyframeTick == null) return;
    for (let tick = this.maxKeyframeTick; tick > cutoff; tick -= 1) {
      if (!this.keyframes[tick]) continue;
      this.keyframes[tick] = undefined;
      this.keyframeCount -= 1;
    }
    while (this.keyframeTicks.length &&
          this.keyframeTicks[this.keyframeTicks.length - 1] > cutoff) {
      this.keyframeTicks.pop();
    }
    if (!this.keyframeTicks.length) {
      this.minKeyframeTick = null;
      this.maxKeyframeTick = null;
      this._lastKeyframe = null;
      return;
    }
    this.minKeyframeTick = this.keyframeTicks[0];
    this.maxKeyframeTick = this.keyframeTicks[this.keyframeTicks.length - 1];
    this._lastKeyframe = this.keyframes[this.maxKeyframeTick] || null;
  },

  _truncateBefore(cutoff) {
    if (this.minDeltaTick == null || this.maxDeltaTick == null) return;
    const start = Math.max(0, Math.trunc(cutoff));
    const touchedBlocks = this._scratchTouchedBlocks;
    touchedBlocks.clear();
    for (let tick = this.minDeltaTick; tick < start; tick += 1) {
      const delta = this.deltas[tick];
      if (!delta) continue;
      const blockStart = this._deltaBlockStart(tick);
      touchedBlocks.add(blockStart);
      if (delta === COLD_DELTA_SENTINEL) {
        this._thawDeltaBlock(blockStart);
      }
      const current = this.deltas[tick];
      this.deltas[tick] = undefined;
      this.deltaCount -= 1;
      this._releaseDelta(current);
    }
    for (const blockStart of touchedBlocks) {
      this._cleanupDeltaBlock(blockStart);
    }
    touchedBlocks.clear();
    let nextMin = Math.max(this.minDeltaTick, start);
    while (nextMin <= this.maxDeltaTick && !this.deltas[nextMin]) {
      nextMin += 1;
    }
    if (nextMin > this.maxDeltaTick) {
      this.minDeltaTick = null;
      this.maxDeltaTick = null;
      this.deltaCount = 0;
    } else {
      this.minDeltaTick = nextMin;
    }
  
    if (!this.keyframeTicks.length) return;
    const keyframeTicks = this.keyframeTicks;
    let removeCount = 0;
    const total = keyframeTicks.length;
    while (removeCount < total && keyframeTicks[removeCount] < start) {
      const tick = keyframeTicks[removeCount];
      if (this.keyframes[tick]) {
        this.keyframes[tick] = undefined;
        this.keyframeCount -= 1;
      }
      removeCount += 1;
    }
    if (removeCount > 0) {
      keyframeTicks.splice(0, removeCount);
    }
    if (!keyframeTicks.length) {
      this.minKeyframeTick = null;
      this.maxKeyframeTick = null;
      this._lastKeyframe = null;
      return;
    }
    this.minKeyframeTick = keyframeTicks[0];
    this.maxKeyframeTick = keyframeTicks[keyframeTicks.length - 1];
    this._lastKeyframe = this.keyframes[this.maxKeyframeTick] || null;
  },

  _compressGroundChanges(changes) {
    const indices = changes?.indices;
    if (!indices || indices.length < 2) return;
    const starts = [];
    const lengths = [];
    let runStart = indices[0];
    let runLength = 1;
    for (let i = 1; i < indices.length; i++) {
      const idx = indices[i];
      if (idx === indices[i - 1] + 1) {
        runLength += 1;
      } else {
        starts.push(runStart);
        lengths.push(runLength);
        runStart = idx;
        runLength = 1;
      }
    }
    starts.push(runStart);
    lengths.push(runLength);
    changes.spans = { starts, lengths };
    indices.length = 0;
  },

  _maybeWarnHistory() {
    const warn = this.options.historyWarnTicks;
    if (!warn || warn <= 0 || this._historyWarned) return;
    if (this.minDeltaTick == null || this.maxDeltaTick == null) return;
    const span = this.maxDeltaTick - this.minDeltaTick + 1;
    if (span < warn) return;
    this._historyWarned = true;
    console.warn(`HistoryStore: ${span} ticks retained (warn threshold ${warn}).`);
  },

  _enforceHistoryCap() {
    if (!this.options.enableHistoryCap) return;
    const cap = this.options.historyCapTicks ?? 0;
    if (!Number.isFinite(cap) || cap <= 0) return;
    if (this.minDeltaTick == null || this.maxDeltaTick == null) return;
    const span = this.maxDeltaTick - this.minDeltaTick + 1;
    if (span <= cap) return;
    let cutoff = this.maxDeltaTick - cap + 1;
    const frame = this.getKeyframeAtOrBefore(cutoff);
    if (frame?.tickIndex != null) {
      cutoff = Math.min(cutoff, frame.tickIndex);
    }
    if (cutoff <= this.minDeltaTick) return;
    this._truncateBefore(cutoff);
  },
};

export { historyStoreLifecycleMethods };
