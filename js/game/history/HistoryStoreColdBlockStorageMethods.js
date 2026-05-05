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

const historyStoreColdBlockStorageMethods = {
  _deltaBlockStart(tickIndex) {
    const size = this.options.deltaBlockSizeTicks || DEFAULT_OPTIONS.deltaBlockSizeTicks;
    return Math.floor(Math.trunc(tickIndex) / size) * size;
  },

  _deltaBlockEnd(startTick) {
    const size = this.options.deltaBlockSizeTicks || DEFAULT_OPTIONS.deltaBlockSizeTicks;
    return startTick + size - 1;
  },

  _ensureDeltaBlock(tickIndex) {
    const start = this._deltaBlockStart(tickIndex);
    let block = this._deltaBlocks.get(start);
    if (!block) {
      block = {
        startTick: start,
        endTick: this._deltaBlockEnd(start),
        cold: false,
        encoding: null,
        encodedBytes: null,
        encodedStoreKey: null,
        decoded: null
      };
      this._deltaBlocks.set(start, block);
    }
    return block;
  },

  _retainColdBytes(storeKey, bytes) {
    let bucket = this._coldBlockStore.get(storeKey);
    if (!bucket) {
      bucket = [];
      this._coldBlockStore.set(storeKey, bucket);
    }
    for (const entry of bucket) {
      if (bytesEqual(entry.bytes, bytes)) {
        entry.refs += 1;
        return entry.bytes;
      }
    }
    bucket.push({ bytes, refs: 1 });
    this._coldBlockBytes += bytes.length;
    return bytes;
  },

  _releaseColdBytes(storeKey, bytes) {
    if (!storeKey || !bytes) return;
    const bucket = this._coldBlockStore.get(storeKey);
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i += 1) {
      const entry = bucket[i];
      if (entry.bytes !== bytes) continue;
      entry.refs -= 1;
      if (entry.refs <= 0) {
        this._coldBlockBytes -= entry.bytes.length;
        bucket.splice(i, 1);
      }
      break;
    }
    if (!bucket.length) {
      this._coldBlockStore.delete(storeKey);
    }
  },

  _buildNoOpDelta(tickIndex) {
    return createDelta(Math.trunc(tickIndex));
  },

  _resolveColdDelta(tickIndex) {
    const tick = Math.trunc(tickIndex);
    const block = this._deltaBlocks.get(this._deltaBlockStart(tick));
    if (!block || !block.cold) return null;
    const decoded = this._decodeColdBlock(block);
    if (!decoded) return null;
    const offset = tick - block.startTick;
    if (decoded.deltaMap.has(offset)) {
      return decoded.deltaMap.get(offset);
    }
    for (const [start, len] of decoded.noOpRanges) {
      if (offset >= start && offset < (start + len)) {
        if (!decoded.noOpCache.has(offset)) {
          decoded.noOpCache.set(offset, this._buildNoOpDelta(tick));
        }
        return decoded.noOpCache.get(offset);
      }
    }
    return null;
  },

  _compactDeltaBlock(block) {
    if (!block || block.cold) return false;
    const payload = this._buildColdBlockPayload(block);
    if (!payload.deltaOffsets.length && !payload.noOpStarts.length) return false;
    const rawBytes = this._encodeColdBlockPayload(payload);
    const compressed = this.options.enableColdBlockCompression ? rleEncodeBytes(rawBytes) : rawBytes;
    const useCompressed = compressed.length < rawBytes.length;
    const encodedBytes = useCompressed ? compressed : rawBytes;
    const encoding = useCompressed ? 'rle' : 'raw';
    const hash = fnv1aHashBytes(encodedBytes);
    const storeKey = `${encoding}:${hash}:${encodedBytes.length}`;
    const sharedBytes = this.options.enableColdBlockDedupe
      ? this._retainColdBytes(storeKey, encodedBytes)
      : encodedBytes;
    if (!this.options.enableColdBlockDedupe) {
      this._coldBlockBytes += encodedBytes.length;
    }
    block.cold = true;
    block.encoding = encoding;
    block.encodedBytes = sharedBytes;
    block.encodedStoreKey = storeKey;
    block.decoded = null;
    this._coldBlockCount += 1;
  
    for (let tick = block.startTick; tick <= block.endTick; tick += 1) {
      const entry = this.deltas[tick];
      if (!entry || entry === COLD_DELTA_SENTINEL) continue;
      this._releaseDelta(entry);
      this.deltas[tick] = COLD_DELTA_SENTINEL;
    }
    return true;
  },

  _thawDeltaBlock(blockStart) {
    const block = this._deltaBlocks.get(blockStart);
    if (!block || !block.cold) return;
    for (let tick = block.startTick; tick <= block.endTick; tick += 1) {
      if (this.deltas[tick] !== COLD_DELTA_SENTINEL) continue;
      const delta = this._resolveColdDelta(tick);
      this.deltas[tick] = delta || undefined;
      if (!delta) {
        this.deltaCount = Math.max(0, this.deltaCount - 1);
      }
    }
    if (this.options.enableColdBlockDedupe) {
      this._releaseColdBytes(block.encodedStoreKey, block.encodedBytes);
    } else if (block.encodedBytes) {
      this._coldBlockBytes -= block.encodedBytes.length;
    }
    block.cold = false;
    block.encoding = null;
    block.encodedBytes = null;
    block.encodedStoreKey = null;
    block.decoded = null;
    this._coldBlockCount = Math.max(0, this._coldBlockCount - 1);
  },

  _cleanupDeltaBlock(blockStart) {
    const block = this._deltaBlocks.get(blockStart);
    if (!block) return;
    let hasEntries = false;
    for (let tick = block.startTick; tick <= block.endTick; tick += 1) {
      if (this.deltas[tick]) {
        hasEntries = true;
        break;
      }
    }
    if (hasEntries) return;
    if (block.cold) {
      if (this.options.enableColdBlockDedupe) {
        this._releaseColdBytes(block.encodedStoreKey, block.encodedBytes);
      } else if (block.encodedBytes) {
        this._coldBlockBytes -= block.encodedBytes.length;
      }
      this._coldBlockCount = Math.max(0, this._coldBlockCount - 1);
    }
    this._deltaBlocks.delete(blockStart);
  },

  _maybeCompactDeltaBlocks() {
    const age = this.options.coldBlockAgeTicks ?? 0;
    if (age <= 0 || this.maxDeltaTick == null || this.minDeltaTick == null) return;
    const interval = this.options.coldCompactionIntervalTicks || DEFAULT_OPTIONS.coldCompactionIntervalTicks;
    if (interval > 1 && (this.maxDeltaTick % interval) !== 0) return;
    const cutoff = this.maxDeltaTick - age;
    const firstStart = this._deltaBlockStart(this.minDeltaTick);
    const lastStart = this._deltaBlockStart(cutoff);
    if (lastStart < firstStart) return;
  
    if (!Number.isFinite(this._coldCompactionCursor)
          || this._coldCompactionCursor < firstStart
          || this._coldCompactionCursor > lastStart) {
      this._coldCompactionCursor = firstStart;
    }
  
    const budget = this.options.coldCompactionMaxBlocksPerSweep
        || DEFAULT_OPTIONS.coldCompactionMaxBlocksPerSweep;
    const stride = this.options.deltaBlockSizeTicks || DEFAULT_OPTIONS.deltaBlockSizeTicks;
    let cursor = this._coldCompactionCursor;
    let remaining = budget;
    while (remaining > 0) {
      const block = this._deltaBlocks.get(cursor);
      if (block && !block.cold && block.endTick <= cutoff) {
        this._compactDeltaBlock(block);
      }
      remaining -= 1;
      cursor += stride;
      if (cursor > lastStart) {
        cursor = firstStart;
      }
      if (cursor === this._coldCompactionCursor) break;
    }
    this._coldCompactionCursor = cursor;
  },
};

export { historyStoreColdBlockStorageMethods };
