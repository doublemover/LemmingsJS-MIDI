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

const historyStoreStatsMethods = {
  setPreserveFutureHistory(enabled) {
    this.options.preserveFutureHistory = !!enabled;
  },

  configureRetention(policy = {}) {
    this.options = normalizeOptions({ ...this.options, ...policy });
    this._coldCompactionCursor = null;
    this._historyWarned = false;
    return this.getRetentionPolicy();
  },

  getRetentionPolicy() {
    return {
      preserveFutureHistory: !!this.options.preserveFutureHistory,
      enableHistoryCap: !!this.options.enableHistoryCap,
      historyCapTicks: this.options.historyCapTicks ?? 0,
      historyWarnTicks: this.options.historyWarnTicks ?? 0
    };
  },

  getDelta(tickIndex) {
    if (!Number.isFinite(tickIndex)) return null;
    const tick = Math.trunc(tickIndex);
    const entry = this.deltas[tick];
    if (!entry) return null;
    if (entry === COLD_DELTA_SENTINEL) {
      return this._resolveColdDelta(tick);
    }
    return entry;
  },

  getKeyframe(tickIndex) {
    if (!Number.isFinite(tickIndex)) return null;
    return this.keyframes[Math.trunc(tickIndex)] || null;
  },

  getHistoryStats() {
    const min = this.minDeltaTick;
    const max = this.maxDeltaTick;
    const span = (min == null || max == null) ? 0 : (max - min + 1);
    return {
      minTick: min,
      maxTick: max,
      deltaCount: this.deltaCount,
      keyframeCount: this.keyframeCount,
      spanTicks: span,
      coldBlockCount: this._coldBlockCount,
      coldBlockBytes: this._coldBlockBytes,
      retention: this.getRetentionPolicy()
    };
  },

  computeReplayHash(fromTick = null, toTick = null) {
    if (this.minDeltaTick == null || this.maxDeltaTick == null) return null;
    const start = Number.isFinite(fromTick) ? Math.max(this.minDeltaTick, Math.trunc(fromTick)) : this.minDeltaTick;
    const end = Number.isFinite(toTick) ? Math.min(this.maxDeltaTick, Math.trunc(toTick)) : this.maxDeltaTick;
    if (start > end) return null;
    let hash = 2166136261;
    const pushByte = (value) => {
      hash ^= value & 0xff;
      hash = Math.imul(hash, 16777619);
    };
    const pushAscii = (value) => {
      const text = String(value);
      for (let i = 0; i < text.length; i += 1) {
        pushByte(text.charCodeAt(i));
      }
      pushByte(124); // '|'
    };
    for (let tick = start; tick <= end; tick += 1) {
      const delta = this.getDelta(tick);
      if (!delta) continue;
      pushAscii(tick);
      pushAscii(isNoOpDelta(delta) ? 1 : 0);
      pushAscii(delta.lemChanges?.ids?.length || 0);
      pushAscii(delta.lemAdded?.length || 0);
      pushAscii(delta.lemRemoved?.length || 0);
      pushAscii(delta.groundChanges?.indices?.length || 0);
      pushAscii(delta.entranceChanges?.indices?.length || 0);
      pushAscii(delta.triggerCooldownChanges?.ids?.length || 0);
      pushAscii(delta.triggerAdd?.length || 0);
      pushAscii(delta.triggerRemove?.length || 0);
      pushAscii(delta.objectAnimChanges?.ids?.length || 0);
      pushAscii(delta.soundEvents?.length || 0);
      pushAscii(delta.minimapDeaths?.length || 0);
      pushByte(10); // '\n'
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
};

export { historyStoreStatsMethods };
