import { SkillTypes } from './SkillTypes.js';
import { Trigger } from '../level/Trigger.js';

const DEFAULT_OPTIONS = Object.freeze({
  keyframeInterval: 120,
  preserveFutureHistory: false,
  enableHistoryCap: true,
  historyCapTicks: 20000,
  historyWarnTicks: 15000,
  deltaPoolLimit: 64,
  deltaBlockSizeTicks: 256,
  coldBlockAgeTicks: 2048,
  coldCompactionIntervalTicks: 1,
  coldCompactionMaxBlocksPerSweep: 4,
  enableColdBlockCompression: true,
  enableColdBlockDedupe: true
});

const COLD_DELTA_SENTINEL = 1;

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

const toNonNegativeInt = (value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  const next = Math.trunc(value);
  return next >= 0 ? next : fallback;
};

const encodeUtf8 = (value) => {
  if (textEncoder) return textEncoder.encode(value);
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(bytes);
};

const decodeUtf8 = (bytes) => {
  if (textDecoder) return textDecoder.decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
};

const stableStringify = (value) => {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const key of keys) {
    pairs.push(`${JSON.stringify(key)}:${stableStringify(value[key])}`);
  }
  return `{${pairs.join(',')}}`;
};

const bytesEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const fnv1aHashBytes = (bytes) => {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const rleEncodeBytes = (bytes) => {
  if (!bytes || bytes.length <= 2) return bytes;
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const value = bytes[i];
    let run = 1;
    while ((i + run) < bytes.length && bytes[i + run] === value && run < 255) {
      run += 1;
    }
    out.push(run, value);
    i += run;
  }
  return Uint8Array.from(out);
};

const rleDecodeBytes = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const run = bytes[i];
    const value = bytes[i + 1];
    for (let j = 0; j < run; j += 1) {
      out.push(value);
    }
  }
  return Uint8Array.from(out);
};

const isNoOpDelta = (delta) => {
  if (!delta) return true;
  if (delta.lemChanges?.ids?.length) return false;
  if (delta.lemAdded?.length || delta.lemRemoved?.length) return false;
  if (delta.lemmingManagerChanges) return false;
  if (delta.groundChanges?.indices?.length || delta.groundChanges?.spans) return false;
  if (delta.entranceChanges?.indices?.length) return false;
  if (delta.triggerCooldownChanges?.ids?.length) return false;
  if (delta.triggerAdd?.length || delta.triggerRemove?.length) return false;
  if (delta.objectAnimChanges?.ids?.length) return false;
  if (delta.victoryChanges || delta.skillsChanges || delta.timerChanges || delta.gameChanges) return false;
  if (delta.soundEvents?.length || delta.minimapDeaths?.length) return false;
  return true;
};

const normalizeOptions = (options = {}) => {
  const keyframeInterval = Math.max(1, toNonNegativeInt(options.keyframeInterval, DEFAULT_OPTIONS.keyframeInterval));
  const deltaPoolLimit = toNonNegativeInt(options.deltaPoolLimit, DEFAULT_OPTIONS.deltaPoolLimit);
  const historyCapTicks = toNonNegativeInt(options.historyCapTicks, DEFAULT_OPTIONS.historyCapTicks);
  const deltaBlockSizeTicks = Math.max(1, toNonNegativeInt(options.deltaBlockSizeTicks, DEFAULT_OPTIONS.deltaBlockSizeTicks));
  const coldBlockAgeTicks = Math.max(0, toNonNegativeInt(options.coldBlockAgeTicks, DEFAULT_OPTIONS.coldBlockAgeTicks));
  const coldCompactionIntervalTicks = Math.max(1, toNonNegativeInt(
    options.coldCompactionIntervalTicks,
    DEFAULT_OPTIONS.coldCompactionIntervalTicks
  ));
  const coldCompactionMaxBlocksPerSweep = Math.max(1, toNonNegativeInt(
    options.coldCompactionMaxBlocksPerSweep,
    DEFAULT_OPTIONS.coldCompactionMaxBlocksPerSweep
  ));
  let historyWarnTicks = toNonNegativeInt(options.historyWarnTicks, DEFAULT_OPTIONS.historyWarnTicks);
  if (historyCapTicks > 0 && historyWarnTicks > historyCapTicks) {
    historyWarnTicks = historyCapTicks;
  }
  return {
    keyframeInterval,
    preserveFutureHistory: !!options.preserveFutureHistory,
    enableHistoryCap: options.enableHistoryCap !== false,
    historyCapTicks,
    historyWarnTicks,
    deltaPoolLimit,
    deltaBlockSizeTicks,
    coldBlockAgeTicks,
    coldCompactionIntervalTicks,
    coldCompactionMaxBlocksPerSweep,
    enableColdBlockCompression: options.enableColdBlockCompression !== false,
    enableColdBlockDedupe: options.enableColdBlockDedupe !== false
  };
};

const createLemmingState = (size) => ({
  capacity: size,
  present: new Uint8Array(size),
  x: new Int32Array(size),
  y: new Int32Array(size),
  lookRight: new Uint8Array(size),
  frameIndex: new Int32Array(size),
  state: new Int32Array(size),
  canClimb: new Uint8Array(size),
  hasParachute: new Uint8Array(size),
  removed: new Uint8Array(size),
  disabled: new Uint8Array(size),
  countdown: new Int32Array(size),
  hasExploded: new Uint8Array(size),
  lastTriggerType: new Int32Array(size),
  actionType: new Int32Array(size),
  countdownActive: new Uint8Array(size)
});

const cloneLemmingState = (state, length) => {
  const size = length ?? state.capacity;
  const copy = createLemmingState(size);
  copy.present.set(state.present.subarray(0, size));
  copy.x.set(state.x.subarray(0, size));
  copy.y.set(state.y.subarray(0, size));
  copy.lookRight.set(state.lookRight.subarray(0, size));
  copy.frameIndex.set(state.frameIndex.subarray(0, size));
  copy.state.set(state.state.subarray(0, size));
  copy.canClimb.set(state.canClimb.subarray(0, size));
  copy.hasParachute.set(state.hasParachute.subarray(0, size));
  copy.removed.set(state.removed.subarray(0, size));
  copy.disabled.set(state.disabled.subarray(0, size));
  copy.countdown.set(state.countdown.subarray(0, size));
  copy.hasExploded.set(state.hasExploded.subarray(0, size));
  copy.lastTriggerType.set(state.lastTriggerType.subarray(0, size));
  copy.actionType.set(state.actionType.subarray(0, size));
  copy.countdownActive.set(state.countdownActive.subarray(0, size));
  return copy;
};

const ensureLemmingCapacity = (state, size) => {
  if (state.capacity >= size) return state;
  const next = Math.max(size, state.capacity * 2, 1);
  const grown = createLemmingState(next);
  grown.present.set(state.present);
  grown.x.set(state.x);
  grown.y.set(state.y);
  grown.lookRight.set(state.lookRight);
  grown.frameIndex.set(state.frameIndex);
  grown.state.set(state.state);
  grown.canClimb.set(state.canClimb);
  grown.hasParachute.set(state.hasParachute);
  grown.removed.set(state.removed);
  grown.disabled.set(state.disabled);
  grown.countdown.set(state.countdown);
  grown.hasExploded.set(state.hasExploded);
  grown.lastTriggerType.set(state.lastTriggerType);
  grown.actionType.set(state.actionType);
  grown.countdownActive.set(state.countdownActive);
  return grown;
};

const snapshotLemming = (lem, actionType, countdownActive) => ({
  id: lem.id,
  x: lem.x,
  y: lem.y,
  lookRight: lem.lookRight ? 1 : 0,
  frameIndex: lem.frameIndex,
  state: lem.state ?? 0,
  canClimb: lem.canClimb ? 1 : 0,
  hasParachute: lem.hasParachute ? 1 : 0,
  removed: lem.removed ? 1 : 0,
  disabled: lem.disabled ? 1 : 0,
  countdown: lem.countdown ?? 0,
  hasExploded: lem.hasExploded ? 1 : 0,
  lastTriggerType: Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1,
  actionType: Number.isFinite(actionType) ? actionType : -1,
  countdownActive: countdownActive ? 1 : 0
});

const applyLemmingSnapshot = (lem, snapshot, action, countdownAction) => {
  lem.id = snapshot.id;
  lem.x = snapshot.x;
  lem.y = snapshot.y;
  lem.lookRight = !!snapshot.lookRight;
  lem.frameIndex = snapshot.frameIndex;
  lem.state = snapshot.state;
  lem.canClimb = !!snapshot.canClimb;
  lem.hasParachute = !!snapshot.hasParachute;
  lem.removed = !!snapshot.removed;
  lem.disabled = !!snapshot.disabled;
  lem.countdown = snapshot.countdown;
  lem.hasExploded = !!snapshot.hasExploded;
  lem.lastTriggerType = snapshot.lastTriggerType >= 0 ? snapshot.lastTriggerType : null;
  lem.action = action || null;
  lem.countdownAction = snapshot.countdownActive ? countdownAction : null;
};

const createDelta = (tick) => ({
  tick,
  lemChanges: { ids: [], fields: [], prev: [], next: [] },
  lemAdded: [],
  lemRemoved: [],
  lemmingManagerChanges: null,
  groundChanges: {
    indices: [],
    spans: null,
    prevMask: [],
    prevR: [],
    prevG: [],
    prevB: [],
    nextMask: [],
    nextR: [],
    nextG: [],
    nextB: []
  },
  entranceChanges: { indices: [], prev: [], next: [] },
  triggerCooldownChanges: { ids: [], prev: [], next: [] },
  triggerAdd: [],
  triggerRemove: [],
  objectAnimChanges: { ids: [], prevFirst: [], prevFinished: [], nextFirst: [], nextFinished: [] },
  victoryChanges: null,
  skillsChanges: null,
  timerChanges: null,
  gameChanges: null,
  soundEvents: [],
  minimapDeaths: []
});

class HistoryStore {
  constructor(options = {}) {
    this.options = normalizeOptions({ ...DEFAULT_OPTIONS, ...options });
    this.keyframes = [];
    this.keyframeTicks = [];
    this.deltas = [];
    this.minDeltaTick = null;
    this.maxDeltaTick = null;
    this.minKeyframeTick = null;
    this.maxKeyframeTick = null;
    this.deltaCount = 0;
    this.keyframeCount = 0;
    this._deltaPool = [];
    this._deltaBlocks = new Map();
    this._coldBlockStore = new Map();
    this._coldBlockCount = 0;
    this._coldBlockBytes = 0;
    this._coldCompactionCursor = null;
    this._historyWarned = false;
    this._recording = false;
    this._currentTick = null;
    this._currentDelta = null;
    this._lemmingState = createLemmingState(0);
    this._lemmingManagerState = null;
    this._entranceOpened = new Uint8Array(0);
    this._skillsState = null;
    this._victoryState = null;
    this._timerState = null;
    this._gameState = null;
    this._nextTriggerId = 1;
    this._triggerIds = new Map();
    this._triggerById = new Map();
    this._nextObjectId = 1;
    this._objectIds = new Map();
    this._objectById = new Map();
    this.game = null;
    this.timer = null;
    this._beforeTick = null;
    this._afterTick = null;
    this._groundDirty = true;
    this._lastKeyframe = null;
    this._scratchTouchedBlocks = new Set();
    this._scratchStaticTriggers = new Set();
    this._scratchRemoveOwners = new Set();
  }

  setPreserveFutureHistory(enabled) {
    this.options.preserveFutureHistory = !!enabled;
  }

  configureRetention(policy = {}) {
    this.options = normalizeOptions({ ...this.options, ...policy });
    this._coldCompactionCursor = null;
    this._historyWarned = false;
    return this.getRetentionPolicy();
  }

  getRetentionPolicy() {
    return {
      preserveFutureHistory: !!this.options.preserveFutureHistory,
      enableHistoryCap: !!this.options.enableHistoryCap,
      historyCapTicks: this.options.historyCapTicks ?? 0,
      historyWarnTicks: this.options.historyWarnTicks ?? 0
    };
  }

  getDelta(tickIndex) {
    if (!Number.isFinite(tickIndex)) return null;
    const tick = Math.trunc(tickIndex);
    const entry = this.deltas[tick];
    if (!entry) return null;
    if (entry === COLD_DELTA_SENTINEL) {
      return this._resolveColdDelta(tick);
    }
    return entry;
  }

  getKeyframe(tickIndex) {
    if (!Number.isFinite(tickIndex)) return null;
    return this.keyframes[Math.trunc(tickIndex)] || null;
  }

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
  }

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
  }

  _deltaBlockStart(tickIndex) {
    const size = this.options.deltaBlockSizeTicks || DEFAULT_OPTIONS.deltaBlockSizeTicks;
    return Math.floor(Math.trunc(tickIndex) / size) * size;
  }

  _deltaBlockEnd(startTick) {
    const size = this.options.deltaBlockSizeTicks || DEFAULT_OPTIONS.deltaBlockSizeTicks;
    return startTick + size - 1;
  }

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
  }

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
  }

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
  }

  _buildColdBlockPayload(block) {
    const noOpRanges = [];
    const deltaEntries = [];
    let runStart = -1;
    let runLen = 0;
    for (let tick = block.startTick; tick <= block.endTick; tick += 1) {
      const entry = this.deltas[tick];
      if (!entry || entry === COLD_DELTA_SENTINEL) {
        if (runLen > 0) {
          noOpRanges.push([runStart, runLen]);
          runStart = -1;
          runLen = 0;
        }
        continue;
      }
      const offset = tick - block.startTick;
      if (isNoOpDelta(entry)) {
        if (runLen === 0) {
          runStart = offset;
          runLen = 1;
        } else if (offset === (runStart + runLen)) {
          runLen += 1;
        } else {
          noOpRanges.push([runStart, runLen]);
          runStart = offset;
          runLen = 1;
        }
      } else {
        if (runLen > 0) {
          noOpRanges.push([runStart, runLen]);
          runStart = -1;
          runLen = 0;
        }
        const packed = this._packDeltaForStorage(entry);
        deltaEntries.push([offset, packed]);
      }
    }
    if (runLen > 0) {
      noOpRanges.push([runStart, runLen]);
    }
    return {
      noOpRanges,
      deltaEntries
    };
  }

  _decodeColdBlock(block) {
    if (!block?.cold || !block.encodedBytes) return null;
    if (block.decoded) return block.decoded;
    const bytes = block.encoding === 'rle'
      ? rleDecodeBytes(block.encodedBytes)
      : block.encodedBytes;
    const payload = JSON.parse(decodeUtf8(bytes));
    const deltaMap = new Map();
    for (const [offset, delta] of payload.deltaEntries || []) {
      const tick = block.startTick + offset;
      deltaMap.set(offset, this._unpackDeltaFromStorage(delta, tick));
    }
    block.decoded = {
      noOpRanges: payload.noOpRanges || [],
      deltaMap,
      noOpCache: new Map()
    };
    return block.decoded;
  }

  _packDeltaForStorage(delta) {
    const packed = JSON.parse(JSON.stringify(delta));
    delete packed.tick;
    if (packed.timerChanges?.prev && Number.isFinite(delta?.tick)) {
      if (Number.isFinite(packed.timerChanges.prev.tickIndex)) {
        packed.timerChanges.prev.tickIndex -= delta.tick;
      }
    }
    if (packed.timerChanges?.next && Number.isFinite(delta?.tick)) {
      if (Number.isFinite(packed.timerChanges.next.tickIndex)) {
        packed.timerChanges.next.tickIndex -= delta.tick;
      }
    }
    return packed;
  }

  _unpackDeltaFromStorage(packed, tick) {
    const delta = { ...packed, tick };
    if (delta.timerChanges?.prev && Number.isFinite(delta.timerChanges.prev.tickIndex)) {
      delta.timerChanges.prev.tickIndex += tick;
    }
    if (delta.timerChanges?.next && Number.isFinite(delta.timerChanges.next.tickIndex)) {
      delta.timerChanges.next.tickIndex += tick;
    }
    return delta;
  }

  _buildNoOpDelta(tickIndex) {
    return createDelta(Math.trunc(tickIndex));
  }

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
  }

  _compactDeltaBlock(block) {
    if (!block || block.cold) return false;
    const payload = this._buildColdBlockPayload(block);
    if (!payload.deltaEntries.length && !payload.noOpRanges.length) return false;
    const rawBytes = encodeUtf8(stableStringify(payload));
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
  }

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
  }

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
  }

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
  }

  _allocDelta(tickIndex) {
    const tick = Math.trunc(tickIndex);
    const delta = this._deltaPool.pop();
    if (!delta) return createDelta(tick);
    this._resetDelta(delta, tick);
    return delta;
  }

  _resetDelta(delta, tickIndex) {
    delta.tick = Math.trunc(tickIndex);
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
  }

  _releaseDelta(delta) {
    if (!delta || delta === COLD_DELTA_SENTINEL || typeof delta !== 'object') return;
    const limit = this.options.deltaPoolLimit ?? DEFAULT_OPTIONS.deltaPoolLimit;
    if (this._deltaPool.length >= limit) return;
    this._resetDelta(delta, 0);
    this._deltaPool.push(delta);
  }

  attach(game, { captureBaseline = true } = {}) {
    if (!game) return;
    this.game = game;
    this.timer = game.getGameTimer?.() || null;
    this._bindTimer();
    if (captureBaseline) {
      this.start();
    }
  }

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
  }

  start() {
    if (!this.game) return;
    this.captureBaseline(this.game);
    this._recording = true;
    const tickIndex = this.timer?.tickIndex ?? 0;
    if (!this.keyframes[tickIndex]) {
      this._setKeyframe(tickIndex, this._captureKeyframe(this.game, tickIndex));
    }
  }

  pause() {
    this._recording = false;
    this._currentDelta = null;
    this._currentTick = null;
  }

  resume() {
    if (!this.game) return;
    this.captureBaseline(this.game);
    this._groundDirty = true;
    this._recording = true;
  }

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
  }

  truncateAfter(tickIndex) {
    if (!Number.isFinite(tickIndex)) return;
    if (this.options.preserveFutureHistory) return;
    const cutoff = Math.max(0, Math.trunc(tickIndex));
    this._truncateDeltasAfter(cutoff);
    this._truncateKeyframesAfter(cutoff);
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
    while (this.keyframeTicks.length && this.keyframeTicks[0] < start) {
      const tick = this.keyframeTicks.shift();
      if (this.keyframes[tick]) {
        this.keyframes[tick] = undefined;
        this.keyframeCount -= 1;
      }
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
  }

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
  }

  _maybeWarnHistory() {
    const warn = this.options.historyWarnTicks;
    if (!warn || warn <= 0 || this._historyWarned) return;
    if (this.minDeltaTick == null || this.maxDeltaTick == null) return;
    const span = this.maxDeltaTick - this.minDeltaTick + 1;
    if (span < warn) return;
    this._historyWarned = true;
    console.warn(`HistoryStore: ${span} ticks retained (warn threshold ${warn}).`);
  }

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
  }

  _bindTimer() {
    if (!this.timer) return;
    this._beforeTick = (tick) => this.beginTick(tick);
    this._afterTick = () => this.endTick();
    this.timer.onBeforeGameTick?.on(this._beforeTick);
    this.timer.onGameTick?.on(this._afterTick);
  }

  beginTick(tick) {
    if (!this._recording) return;
    this._currentTick = tick;
    this._currentDelta = this._allocDelta(tick);
  }

  endTick() {
    if (!this._recording || !this.game || !this._currentDelta) return;
    const tick = this._currentTick;
    const tickIndex = this.timer?.tickIndex ?? (tick + 1);
    this._diffState(this.game, this._currentDelta);
    this._compressGroundChanges(this._currentDelta.groundChanges);
    this._setDelta(tick, this._currentDelta);
    if ((tickIndex % this.options.keyframeInterval) === 0) {
      this._setKeyframe(tickIndex, this._captureKeyframe(this.game, tickIndex));
    }
    this._maybeWarnHistory();
    this._enforceHistoryCap();
    this._maybeCompactDeltaBlocks();
    this._currentDelta = null;
  }

  captureBaseline(game) {
    if (!game) return;
    this._captureScalarState(game);
    const manager = game.getLemmingManager?.();
    this._captureLemmingState(manager);
    this._lemmingManagerState = this._readLemmingManager(manager);
    this._captureEntrances(game.level);
  }

  recordSoundEvent(event) {
    if (!this._currentDelta) return;
    this._currentDelta.soundEvents.push(event);
  }

  recordGroundChange(index, prevMask, prevR, prevG, prevB, nextMask, nextR, nextG, nextB) {
    if (!this._currentDelta) return;
    this._groundDirty = true;
    const changes = this._currentDelta.groundChanges;
    changes.indices.push(index);
    changes.prevMask.push(prevMask);
    changes.prevR.push(prevR);
    changes.prevG.push(prevG);
    changes.prevB.push(prevB);
    changes.nextMask.push(nextMask);
    changes.nextR.push(nextR);
    changes.nextG.push(nextG);
    changes.nextB.push(nextB);
  }

  recordEntranceChange(index, prev, next) {
    if (!this._currentDelta) return;
    const changes = this._currentDelta.entranceChanges;
    changes.indices.push(index);
    changes.prev.push(prev ? 1 : 0);
    changes.next.push(next ? 1 : 0);
  }

  recordTriggerCooldown(trigger, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    const changes = this._currentDelta.triggerCooldownChanges;
    changes.ids.push(id);
    changes.prev.push(prev);
    changes.next.push(next);
  }

  recordTriggerAdd(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerAdd.push({ id, ...snapshot });
  }

  recordTriggerRemove(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerRemove.push({ id, ...snapshot });
  }

  recordObjectAnimation(obj, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureObjectId(obj);
    const changes = this._currentDelta.objectAnimChanges;
    changes.ids.push(id);
    changes.prevFirst.push(prev.firstFrameIndex);
    changes.prevFinished.push(prev.isFinished ? 1 : 0);
    changes.nextFirst.push(next.firstFrameIndex);
    changes.nextFinished.push(next.isFinished ? 1 : 0);
  }

  recordMinimapDeath(entry) {
    if (!this._currentDelta) return;
    this._currentDelta.minimapDeaths.push(entry);
  }

  _ensureTriggerId(trigger) {
    if (!trigger) return 0;
    if (trigger.__historyId) return trigger.__historyId;
    const id = this._nextTriggerId++;
    trigger.__historyId = id;
    this._triggerIds.set(trigger, id);
    this._triggerById.set(id, trigger);
    return id;
  }

  _ensureObjectId(obj) {
    if (!obj) return 0;
    if (obj.__historyId) return obj.__historyId;
    const id = this._nextObjectId++;
    obj.__historyId = id;
    this._objectIds.set(obj, id);
    this._objectById.set(id, obj);
    return id;
  }

  _captureKeyframe(game, tickIndex) {
    const lemmingManager = game.getLemmingManager?.();
    const lemmings = lemmingManager?.lemmings || [];
    const lemmingState = cloneLemmingState(this._lemmingState, lemmings.length || 0);
    const lemmingManagerState = this._readLemmingManager(lemmingManager);
    const entrances = game.level?.entrances || [];
    const entranceOpened = new Uint8Array(entrances.length);
    for (let i = 0; i < entrances.length; i++) {
      entranceOpened[i] = entrances[i]?._opened ? 1 : 0;
    }
    const triggerState = this._readTriggerState(game);
    const objectState = this._readObjectState(game.level);
    const minimapState = this._readMinimapState(lemmingManager?.miniMap);
    const victory = this._readVictory(game.getVictoryCondition?.());
    const skills = this._readSkills(game.getGameSkills?.());
    const timer = this._readTimer(game.getGameTimer?.());
    const gameState = this._readGameState(game);
    const level = game.level || null;
    let groundMask = null;
    let groundImage = null;
    if (level?.groundMask?.mask && level?.groundImage) {
      if (!this._groundDirty &&
          this._lastKeyframe?.groundMask &&
          this._lastKeyframe?.groundImage) {
        groundMask = this._lastKeyframe.groundMask;
        groundImage = this._lastKeyframe.groundImage;
      } else {
        groundMask = new Uint8Array(level.groundMask.mask);
        groundImage = new Uint8ClampedArray(level.groundImage);
      }
    }
    this._groundDirty = false;
    return {
      tickIndex,
      lemmingState,
      lemmingManagerState,
      entranceOpened,
      triggerState,
      objectState,
      minimapState,
      victory,
      skills,
      timer,
      gameState,
      groundMask,
      groundImage
    };
  }

  _diffState(game, delta) {
    const manager = game.getLemmingManager?.();
    this._diffLemmings(manager, delta);
    this._diffLemmingManager(manager, delta);
    this._diffEntrances(game.level, delta);
    this._diffScalarState(game, delta);
  }

  _captureLemmingState(manager) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    this._lemmingState = ensureLemmingCapacity(this._lemmingState, lems.length);
    for (let i = 0; i < lems.length; i++) {
      const lem = lems[i];
      if (!lem) {
        this._lemmingState.present[i] = 0;
        continue;
      }
      const actionType = this._getActionType(manager, lem.action);
      const countdownActive = !!lem.countdownAction;
      this._writeLemmingState(this._lemmingState, i, lem, actionType, countdownActive);
    }
  }

  _diffLemmings(manager, delta) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    this._lemmingState = ensureLemmingCapacity(this._lemmingState, lems.length);
    const prev = this._lemmingState;
    for (let i = 0; i < lems.length; i++) {
      const lem = lems[i];
      if (!lem) {
        if (prev.present[i]) {
          const snap = {
            id: i,
            x: prev.x[i],
            y: prev.y[i],
            lookRight: prev.lookRight[i],
            frameIndex: prev.frameIndex[i],
            state: prev.state[i],
            canClimb: prev.canClimb[i],
            hasParachute: prev.hasParachute[i],
            removed: prev.removed[i],
            disabled: prev.disabled[i],
            countdown: prev.countdown[i],
            hasExploded: prev.hasExploded[i],
            lastTriggerType: prev.lastTriggerType[i],
            actionType: prev.actionType[i],
            countdownActive: prev.countdownActive[i]
          };
          delta.lemRemoved.push(snap);
          prev.present[i] = 0;
        }
        continue;
      }

      const actionType = this._getActionType(manager, lem.action);
      const countdownActive = !!lem.countdownAction;
      if (!prev.present[i]) {
        delta.lemAdded.push(snapshotLemming(lem, actionType, countdownActive));
        this._writeLemmingState(prev, i, lem, actionType, countdownActive);
        continue;
      }

      this._diffLemmingField(delta, i, 0, prev.x[i], lem.x, prev.x);
      this._diffLemmingField(delta, i, 1, prev.y[i], lem.y, prev.y);
      this._diffLemmingField(delta, i, 2, prev.lookRight[i], lem.lookRight ? 1 : 0, prev.lookRight);
      this._diffLemmingField(delta, i, 3, prev.frameIndex[i], lem.frameIndex, prev.frameIndex);
      this._diffLemmingField(delta, i, 4, prev.state[i], lem.state ?? 0, prev.state);
      this._diffLemmingField(delta, i, 5, prev.canClimb[i], lem.canClimb ? 1 : 0, prev.canClimb);
      this._diffLemmingField(delta, i, 6, prev.hasParachute[i], lem.hasParachute ? 1 : 0, prev.hasParachute);
      this._diffLemmingField(delta, i, 7, prev.removed[i], lem.removed ? 1 : 0, prev.removed);
      this._diffLemmingField(delta, i, 8, prev.disabled[i], lem.disabled ? 1 : 0, prev.disabled);
      this._diffLemmingField(delta, i, 9, prev.countdown[i], lem.countdown ?? 0, prev.countdown);
      this._diffLemmingField(delta, i, 10, prev.hasExploded[i], lem.hasExploded ? 1 : 0, prev.hasExploded);
      this._diffLemmingField(delta, i, 11, prev.lastTriggerType[i], Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1, prev.lastTriggerType);
      this._diffLemmingField(delta, i, 12, prev.actionType[i], actionType, prev.actionType);
      this._diffLemmingField(delta, i, 13, prev.countdownActive[i], countdownActive ? 1 : 0, prev.countdownActive);
      prev.present[i] = 1;
    }

    for (let i = lems.length; i < prev.present.length; i++) {
      if (prev.present[i]) {
        const snap = {
          id: i,
          x: prev.x[i],
          y: prev.y[i],
          lookRight: prev.lookRight[i],
          frameIndex: prev.frameIndex[i],
          state: prev.state[i],
          canClimb: prev.canClimb[i],
          hasParachute: prev.hasParachute[i],
          removed: prev.removed[i],
          disabled: prev.disabled[i],
          countdown: prev.countdown[i],
          hasExploded: prev.hasExploded[i],
          lastTriggerType: prev.lastTriggerType[i],
          actionType: prev.actionType[i],
          countdownActive: prev.countdownActive[i]
        };
        delta.lemRemoved.push(snap);
        prev.present[i] = 0;
      }
    }
  }

  _diffLemmingManager(manager, delta) {
    const next = this._readLemmingManager(manager);
    if (this._lemmingManagerState && next && !this._lemmingManagerEqual(this._lemmingManagerState, next)) {
      delta.lemmingManagerChanges = { prev: this._lemmingManagerState, next };
    }
    this._lemmingManagerState = next;
  }

  _readLemmingManager(manager) {
    if (!manager) return null;
    const sourceTargets = manager._nukeTargets;
    let targets = null;
    if (Array.isArray(sourceTargets)) {
      targets = new Array(sourceTargets.length);
      for (let i = 0; i < sourceTargets.length; i += 1) {
        targets[i] = sourceTargets[i]?.id ?? null;
      }
    }
    return {
      selectedIndex: manager.selectedIndex,
      spawnTotal: manager.spawnTotal,
      releaseTickIndex: manager.releaseTickIndex,
      mmTickCounter: manager.mmTickCounter,
      nextNukingLemmingsIndex: manager.nextNukingLemmingsIndex,
      nukeTargets: targets
    };
  }

  _lemmingManagerEqual(a, b) {
    if (!a || !b) return false;
    if (a.selectedIndex !== b.selectedIndex) return false;
    if (a.spawnTotal !== b.spawnTotal) return false;
    if (a.releaseTickIndex !== b.releaseTickIndex) return false;
    if (a.mmTickCounter !== b.mmTickCounter) return false;
    if (a.nextNukingLemmingsIndex !== b.nextNukingLemmingsIndex) return false;
    const aa = a.nukeTargets || [];
    const bb = b.nukeTargets || [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  _diffLemmingField(delta, id, field, prevValue, nextValue, store) {
    if (prevValue === nextValue) return;
    delta.lemChanges.ids.push(id);
    delta.lemChanges.fields.push(field);
    delta.lemChanges.prev.push(prevValue);
    delta.lemChanges.next.push(nextValue);
    store[id] = nextValue;
  }

  _writeLemmingState(state, index, lem, actionType, countdownActive) {
    state.present[index] = 1;
    state.x[index] = lem.x;
    state.y[index] = lem.y;
    state.lookRight[index] = lem.lookRight ? 1 : 0;
    state.frameIndex[index] = lem.frameIndex;
    state.state[index] = lem.state ?? 0;
    state.canClimb[index] = lem.canClimb ? 1 : 0;
    state.hasParachute[index] = lem.hasParachute ? 1 : 0;
    state.removed[index] = lem.removed ? 1 : 0;
    state.disabled[index] = lem.disabled ? 1 : 0;
    state.countdown[index] = lem.countdown ?? 0;
    state.hasExploded[index] = lem.hasExploded ? 1 : 0;
    state.lastTriggerType[index] = Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1;
    state.actionType[index] = Number.isFinite(actionType) ? actionType : -1;
    state.countdownActive[index] = countdownActive ? 1 : 0;
  }

  _getActionType(manager, action) {
    if (!action || !manager) return -1;
    if (manager.actionTypeByAction?.has(action)) {
      return manager.actionTypeByAction.get(action);
    }
    const actions = manager.actions || [];
    for (let i = 0; i < actions.length; i++) {
      if (actions[i] === action) return i;
    }
    return -1;
  }

  _captureEntrances(level) {
    const entrances = level?.entrances || [];
    this._entranceOpened = new Uint8Array(entrances.length);
    for (let i = 0; i < entrances.length; i++) {
      this._entranceOpened[i] = entrances[i]?._opened ? 1 : 0;
    }
  }

  _diffEntrances(level, delta) {
    const entrances = level?.entrances || [];
    if (this._entranceOpened.length !== entrances.length) {
      this._captureEntrances(level);
      return;
    }
    for (let i = 0; i < entrances.length; i++) {
      const opened = entrances[i]?._opened ? 1 : 0;
      if (this._entranceOpened[i] !== opened) {
        delta.entranceChanges.indices.push(i);
        delta.entranceChanges.prev.push(this._entranceOpened[i]);
        delta.entranceChanges.next.push(opened);
        this._entranceOpened[i] = opened;
      }
    }
  }

  _captureScalarState(game) {
    this._skillsState = this._readSkills(game.getGameSkills?.());
    this._victoryState = this._readVictory(game.getVictoryCondition?.());
    this._timerState = this._readTimer(game.getGameTimer?.());
    this._gameState = this._readGameState(game);
  }

  _diffScalarState(game, delta) {
    const nextSkills = this._readSkills(game.getGameSkills?.());
    if (this._skillsState && nextSkills && !this._skillsEqual(this._skillsState, nextSkills)) {
      delta.skillsChanges = { prev: this._skillsState, next: nextSkills };
    }
    this._skillsState = nextSkills;

    const nextVictory = this._readVictory(game.getVictoryCondition?.());
    if (this._victoryState && nextVictory && !this._victoryEqual(this._victoryState, nextVictory)) {
      delta.victoryChanges = { prev: this._victoryState, next: nextVictory };
    }
    this._victoryState = nextVictory;

    const nextTimer = this._readTimer(game.getGameTimer?.());
    if (this._timerState && nextTimer && !this._timerEqual(this._timerState, nextTimer)) {
      delta.timerChanges = { prev: this._timerState, next: nextTimer };
    }
    this._timerState = nextTimer;

    const nextGame = this._readGameState(game);
    if (this._gameState && nextGame && !this._gameStateEqual(this._gameState, nextGame)) {
      delta.gameChanges = { prev: this._gameState, next: nextGame };
    }
    this._gameState = nextGame;
  }

  _readSkills(skills) {
    if (!skills) return null;
    const values = Array.isArray(skills.skills) ? skills.skills.slice() : [];
    return {
      selectedSkill: skills.selectedSkill,
      cheatMode: !!skills.cheatMode,
      skills: values
    };
  }

  _skillsEqual(a, b) {
    if (!a || !b) return false;
    if (a.selectedSkill !== b.selectedSkill) return false;
    if (!!a.cheatMode !== !!b.cheatMode) return false;
    const aa = a.skills || [];
    const bb = b.skills || [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  _readVictory(victory) {
    if (!victory) return null;
    return {
      releaseRate: victory.releaseRate,
      minReleaseRate: victory.minReleaseRate,
      leftCount: victory.leftCount,
      outCount: victory.outCount,
      survivorCount: victory.survivorCount,
      isFinalize: !!victory.isFinalize
    };
  }

  _victoryEqual(a, b) {
    if (!a || !b) return false;
    return a.releaseRate === b.releaseRate
      && a.minReleaseRate === b.minReleaseRate
      && a.leftCount === b.leftCount
      && a.outCount === b.outCount
      && a.survivorCount === b.survivorCount
      && !!a.isFinalize === !!b.isFinalize;
  }

  _readTimer(timer) {
    if (!timer) return null;
    return {
      speedFactor: timer.speedFactor,
      frameTime: timer.frameTime,
      tickIndex: timer.tickIndex
    };
  }

  _timerEqual(a, b) {
    if (!a || !b) return false;
    return a.speedFactor === b.speedFactor
      && a.frameTime === b.frameTime
      && a.tickIndex === b.tickIndex;
  }

  _readGameState(game) {
    if (!game) return null;
    return { finalGameState: game.finalGameState };
  }

  _gameStateEqual(a, b) {
    if (!a || !b) return false;
    return a.finalGameState === b.finalGameState;
  }

  applyKeyframe(game, keyframe) {
    if (!game || !keyframe) return;
    const manager = game.getLemmingManager?.();
    if (manager && keyframe.lemmingState) {
      const state = keyframe.lemmingState;
      const lems = manager.lemmings || [];
      if (lems.length !== state.present.length) {
        manager.lemmings = new Array(state.present.length);
      }
      const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
      for (let i = 0; i < state.present.length; i++) {
        if (!state.present[i]) {
          manager.lemmings[i] = null;
          continue;
        }
        let lem = manager.lemmings[i];
        if (!lem) {
          const ctor = manager._lemmingCtor || globalThis.lemmings?.Lemming || null;
          lem = ctor ? new ctor(state.x[i], state.y[i], i) : { id: i };
          manager.lemmings[i] = lem;
        }
        const action = state.actionType[i] >= 0 ? manager.actions?.[state.actionType[i]] : null;
        const snap = {
          id: i,
          x: state.x[i],
          y: state.y[i],
          lookRight: state.lookRight[i],
          frameIndex: state.frameIndex[i],
          state: state.state[i],
          canClimb: state.canClimb[i],
          hasParachute: state.hasParachute[i],
          removed: state.removed[i],
          disabled: state.disabled[i],
          countdown: state.countdown[i],
          hasExploded: state.hasExploded[i],
          lastTriggerType: state.lastTriggerType[i],
          actionType: state.actionType[i],
          countdownActive: state.countdownActive[i]
        };
        applyLemmingSnapshot(lem, snap, action, countdownAction);
      }
      this._rebuildActiveLemmings(manager);
    }

    if (manager && keyframe.lemmingManagerState) {
      const state = keyframe.lemmingManagerState;
      manager.selectedIndex = state.selectedIndex ?? -1;
      manager.spawnTotal = state.spawnTotal ?? 0;
      manager.releaseTickIndex = state.releaseTickIndex ?? 0;
      manager.mmTickCounter = state.mmTickCounter ?? 0;
      manager.nextNukingLemmingsIndex = state.nextNukingLemmingsIndex ?? -1;
      manager._nukeTargets = this._resolveNukeTargets(manager, state.nukeTargets);
    }

    if (game.level && keyframe.entranceOpened) {
      const entrances = game.level.entrances || [];
      for (let i = 0; i < entrances.length; i++) {
        entrances[i]._opened = !!keyframe.entranceOpened[i];
      }
    }

    if (game.triggerManager && keyframe.triggerState) {
      this._applyTriggerState(game, keyframe.triggerState);
    }

    if (game.level && keyframe.objectState) {
      this._applyObjectState(game.level, keyframe.objectState);
    }

    if (manager?.miniMap && keyframe.minimapState) {
      const miniMap = manager.miniMap;
      miniMap.deadDots = new Uint8Array(keyframe.minimapState.deadDots || []);
      miniMap.deadTTLs = new Uint8Array(keyframe.minimapState.deadTTLs || []);
      miniMap.deadCount = keyframe.minimapState.deadCount ?? 0;
    }

    if (game.level?.groundMask && keyframe.groundMask) {
      game.level.groundMask.mask = new Uint8Array(keyframe.groundMask);
    }
    if (game.level && keyframe.groundImage) {
      game.level.groundImage = new Uint8ClampedArray(keyframe.groundImage);
    }

    if (keyframe.victory) {
      const victory = game.getVictoryCondition?.();
      if (victory) {
        victory.releaseRate = keyframe.victory.releaseRate;
        victory.minReleaseRate = keyframe.victory.minReleaseRate;
        victory.leftCount = keyframe.victory.leftCount;
        victory.outCount = keyframe.victory.outCount;
        victory.survivorCount = keyframe.victory.survivorCount;
        victory.isFinalize = !!keyframe.victory.isFinalize;
      }
    }

    if (keyframe.skills) {
      const skills = game.getGameSkills?.();
      if (skills) {
        skills.selectedSkill = keyframe.skills.selectedSkill;
        skills.cheatMode = !!keyframe.skills.cheatMode;
        skills.skills = keyframe.skills.skills.slice();
      }
    }

    if (keyframe.timer) {
      const timer = game.getGameTimer?.();
      if (timer) {
        const ignoreSpeed = !!game?.timeTravel?.isReversing &&
          !!game?.timeTravel?.ignoreSpeedOnReverse;
        if (!ignoreSpeed) {
          timer.speedFactor = keyframe.timer.speedFactor;
        }
        timer.tickIndex = keyframe.timer.tickIndex;
      }
    }

    if (keyframe.gameState) {
      game.finalGameState = keyframe.gameState.finalGameState;
    }

    this.captureBaseline(game);
  }

  applyDeltaForward(game, delta) {
    this._applyDelta(game, delta, true);
  }

  applyDeltaBackward(game, delta) {
    this._applyDelta(game, delta, false);
  }

  _applyDelta(game, delta, useNext) {
    if (!game || !delta) return;
    const manager = game.getLemmingManager?.();
    if (manager) {
      if (useNext) {
        this._applyLemmingAdds(manager, delta.lemAdded);
      } else {
        this._applyLemmingAdds(manager, delta.lemRemoved);
      }
      this._applyLemmingChanges(manager, delta.lemChanges, useNext);
      if (useNext) {
        this._applyLemmingRemovals(manager, delta.lemRemoved);
      } else {
        this._applyLemmingRemovals(manager, delta.lemAdded);
      }
      this._applyLemmingManagerState(manager, delta.lemmingManagerChanges, useNext);
      this._rebuildActiveLemmings(manager);
      this._applyMinimapDeaths(manager, delta.minimapDeaths, useNext);
    }

    this._applyEntranceChanges(game.level, delta.entranceChanges, useNext);
    this._applyGroundChanges(game.level, delta.groundChanges, useNext);
    this._applyTriggerChanges(game, delta, useNext);
    this._applyObjectChanges(game.level, delta.objectAnimChanges, useNext);
    this._applyScalarChanges(game, delta, useNext);
  }

  _applyLemmingAdds(manager, list) {
    if (!manager || !Array.isArray(list) || !list.length) return;
    const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
    if (!Array.isArray(manager.lemmings)) manager.lemmings = [];
    for (const snap of list) {
      if (snap == null || !Number.isFinite(snap.id)) continue;
      let lem = manager.lemmings[snap.id];
      if (!lem) {
        const ctor = manager._lemmingCtor || globalThis.lemmings?.Lemming || null;
        lem = ctor ? new ctor(snap.x, snap.y, snap.id) : { id: snap.id };
        manager.lemmings[snap.id] = lem;
      }
      const action = snap.actionType >= 0 ? manager.actions?.[snap.actionType] : null;
      applyLemmingSnapshot(lem, snap, action, countdownAction);
    }
  }

  _applyLemmingRemovals(manager, list) {
    if (!manager || !Array.isArray(list) || !list.length) return;
    for (const snap of list) {
      if (snap == null || !Number.isFinite(snap.id)) continue;
      manager.lemmings[snap.id] = null;
    }
  }

  _applyLemmingChanges(manager, changes, useNext) {
    if (!manager || !changes?.ids?.length) return;
    const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
    for (let i = 0; i < changes.ids.length; i++) {
      const id = changes.ids[i];
      const field = changes.fields[i];
      const value = useNext ? changes.next[i] : changes.prev[i];
      const lem = manager.lemmings?.[id];
      if (!lem) continue;
      switch (field) {
      case 0: lem.x = value; break;
      case 1: lem.y = value; break;
      case 2: lem.lookRight = !!value; break;
      case 3: lem.frameIndex = value; break;
      case 4: lem.state = value; break;
      case 5: lem.canClimb = !!value; break;
      case 6: lem.hasParachute = !!value; break;
      case 7: lem.removed = !!value; break;
      case 8: lem.disabled = !!value; break;
      case 9: lem.countdown = value; break;
      case 10: lem.hasExploded = !!value; break;
      case 11: lem.lastTriggerType = value >= 0 ? value : null; break;
      case 12: lem.action = value >= 0 ? manager.actions?.[value] : null; break;
      case 13: lem.countdownAction = value ? countdownAction : null; break;
      default: break;
      }
    }
  }

  _applyLemmingManagerState(manager, changes, useNext) {
    if (!manager || !changes) return;
    const state = useNext ? changes.next : changes.prev;
    if (!state) return;
    manager.selectedIndex = state.selectedIndex ?? -1;
    manager.spawnTotal = state.spawnTotal ?? 0;
    manager.releaseTickIndex = state.releaseTickIndex ?? 0;
    manager.mmTickCounter = state.mmTickCounter ?? 0;
    manager.nextNukingLemmingsIndex = state.nextNukingLemmingsIndex ?? -1;
    manager._nukeTargets = this._resolveNukeTargets(manager, state.nukeTargets);
  }

  _resolveNukeTargets(manager, ids) {
    if (!manager || !Array.isArray(ids)) return null;
    const lems = manager.lemmings || [];
    const resolved = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (!Number.isFinite(id)) continue;
      const lem = lems[id];
      if (lem) resolved.push(lem);
    }
    return resolved;
  }

  _rebuildActiveLemmings(manager) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    const active = Array.isArray(manager.activeLemmings) ? manager.activeLemmings : [];
    active.length = 0;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed) continue;
      lem._activeIndex = active.length;
      active.push(lem);
    }
    manager.activeLemmings = active;
    manager._activeDirty = false;
  }

  _applyEntranceChanges(level, changes, useNext) {
    if (!level || !changes?.indices?.length) return;
    for (let i = 0; i < changes.indices.length; i++) {
      const idx = changes.indices[i];
      const val = useNext ? changes.next[i] : changes.prev[i];
      if (level.entrances?.[idx]) {
        level.entrances[idx]._opened = !!val;
      }
    }
  }

  _applyGroundChanges(level, changes, useNext) {
    if (!level || !changes) return;
    const mask = level.groundMask?.mask;
    const img = level.groundImage;
    if (!mask || !img) return;
    const maskValues = useNext ? changes.nextMask : changes.prevMask;
    const redValues = useNext ? changes.nextR : changes.prevR;
    const greenValues = useNext ? changes.nextG : changes.prevG;
    const blueValues = useNext ? changes.nextB : changes.prevB;
    if (!maskValues || !redValues || !greenValues || !blueValues) return;
    const spans = changes.spans;
    if (spans?.starts?.length) {
      const starts = spans.starts;
      const lengths = spans.lengths;
      let valueIndex = 0;
      for (let i = 0; i < starts.length; i += 1) {
        let index = starts[i];
        let imgIndex = index << 2;
        const valueEnd = valueIndex + lengths[i];
        for (; valueIndex < valueEnd; valueIndex += 1, index += 1, imgIndex += 4) {
          mask[index] = maskValues[valueIndex];
          img[imgIndex] = redValues[valueIndex];
          img[imgIndex + 1] = greenValues[valueIndex];
          img[imgIndex + 2] = blueValues[valueIndex];
        }
      }
      return;
    }
    const indices = changes.indices;
    if (!indices?.length) return;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      const imgIndex = index << 2;
      mask[index] = maskValues[i];
      img[imgIndex] = redValues[i];
      img[imgIndex + 1] = greenValues[i];
      img[imgIndex + 2] = blueValues[i];
    }
  }

  _applyTriggerChanges(game, delta, useNext) {
    const triggerManager = game?.triggerManager;
    if (!triggerManager || !delta) return;
    const adds = useNext ? delta.triggerAdd : delta.triggerRemove;
    const removes = useNext ? delta.triggerRemove : delta.triggerAdd;
    for (const snap of removes || []) {
      const trig = this._findTriggerById(triggerManager, snap.id);
      if (trig && trig.owner) {
        triggerManager.removeByOwner(trig.owner);
      }
    }
    for (const snap of adds || []) {
      const owner = Number.isFinite(snap.ownerId)
        ? game.getLemmingManager?.()?.getLemming?.(snap.ownerId)
        : null;
      const trig = new Trigger(
        snap.type,
        snap.x1,
        snap.y1,
        snap.x2,
        snap.y2,
        snap.disableTicksCount,
        snap.soundIndex,
        owner
      );
      trig.disabledUntilTick = snap.disabledUntilTick ?? 0;
      trig.__historyId = snap.id;
      triggerManager.add(trig);
      this._triggerById.set(snap.id, trig);
    }
    if (delta.triggerCooldownChanges?.ids?.length) {
      for (let i = 0; i < delta.triggerCooldownChanges.ids.length; i++) {
        const id = delta.triggerCooldownChanges.ids[i];
        const trig = this._findTriggerById(triggerManager, id);
        if (!trig) continue;
        const value = useNext
          ? delta.triggerCooldownChanges.next[i]
          : delta.triggerCooldownChanges.prev[i];
        trig.disabledUntilTick = value;
      }
    }
  }

  _findTriggerById(triggerManager, id) {
    if (!triggerManager || !id) return null;
    if (this._triggerById.has(id)) return this._triggerById.get(id);
    for (const trig of triggerManager._triggers || []) {
      if (trig?.__historyId === id) {
        this._triggerById.set(id, trig);
        return trig;
      }
    }
    return null;
  }

  _applyObjectChanges(level, changes, useNext) {
    if (!level || !changes?.ids?.length) return;
    for (let i = 0; i < changes.ids.length; i++) {
      const id = changes.ids[i];
      let obj = this._objectById.get(id);
      if (!obj) {
        const objects = level.objects || [];
        for (const entry of objects) {
          if (!entry?.animation) continue;
          const entryId = this._ensureObjectId(entry);
          if (entryId === id) {
            obj = entry;
            break;
          }
        }
      }
      if (!obj?.animation) continue;
      const first = useNext ? changes.nextFirst[i] : changes.prevFirst[i];
      const finished = useNext ? changes.nextFinished[i] : changes.prevFinished[i];
      obj.animation.firstFrameIndex = first;
      obj.animation.isFinished = !!finished;
    }
  }

  _applyScalarChanges(game, delta, useNext) {
    if (delta.victoryChanges) {
      const victory = game.getVictoryCondition?.();
      const state = useNext ? delta.victoryChanges.next : delta.victoryChanges.prev;
      if (victory && state) {
        victory.releaseRate = state.releaseRate;
        victory.minReleaseRate = state.minReleaseRate;
        victory.leftCount = state.leftCount;
        victory.outCount = state.outCount;
        victory.survivorCount = state.survivorCount;
        victory.isFinalize = !!state.isFinalize;
      }
    }
    if (delta.skillsChanges) {
      const skills = game.getGameSkills?.();
      const state = useNext ? delta.skillsChanges.next : delta.skillsChanges.prev;
      if (skills && state) {
        skills.selectedSkill = state.selectedSkill;
        skills.cheatMode = !!state.cheatMode;
        skills.skills = state.skills.slice();
      }
    }
    if (delta.timerChanges) {
      const timer = game.getGameTimer?.();
      const state = useNext ? delta.timerChanges.next : delta.timerChanges.prev;
      if (timer && state) {
        const ignoreSpeed = !useNext && !!game?.timeTravel?.ignoreSpeedOnReverse;
        if (!ignoreSpeed) {
          timer.speedFactor = state.speedFactor;
        }
        timer.tickIndex = state.tickIndex;
      }
    }
    if (delta.gameChanges) {
      const state = useNext ? delta.gameChanges.next : delta.gameChanges.prev;
      if (state) game.finalGameState = state.finalGameState;
    }
  }

  _applyMinimapDeaths(manager, entries, useNext) {
    const miniMap = manager?.miniMap;
    if (!miniMap || !entries?.length) return;
    if (useNext) {
      for (const entry of entries) {
        const idx = entry.prevCount ?? miniMap.deadCount ?? 0;
        const neededDots = (idx + 1) * 2;
        if (miniMap.deadDots.length < neededDots) {
          const next = Math.max(4, miniMap.deadDots.length * 2, neededDots);
          const coords = new Uint8Array(next);
          coords.set(miniMap.deadDots);
          miniMap.deadDots = coords;
        }
        if (miniMap.deadTTLs.length < idx + 1) {
          const next = Math.max(4, miniMap.deadTTLs.length * 2, idx + 1);
          const ttls = new Uint8Array(next);
          ttls.set(miniMap.deadTTLs);
          miniMap.deadTTLs = ttls;
        }
        miniMap.deadDots[idx * 2] = entry.x ?? 0;
        miniMap.deadDots[idx * 2 + 1] = entry.y ?? 0;
        miniMap.deadTTLs[idx] = entry.ttl ?? 0;
        miniMap.deadCount = Math.max(miniMap.deadCount ?? 0, idx + 1);
      }
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const prevCount = entry.prevCount ?? 0;
      miniMap.deadCount = prevCount;
    }
  }

  _readTriggerState(game) {
    const triggerManager = game?.triggerManager;
    const level = game?.level;
    if (!triggerManager || !level) return null;
    const staticTriggers = [];
    const dynamicTriggers = [];
    const levelTriggers = level.triggers || [];
    const staticSet = this._scratchStaticTriggers;
    staticSet.clear();
    for (let i = 0; i < levelTriggers.length; i += 1) {
      staticSet.add(levelTriggers[i]);
    }
    for (let i = 0; i < levelTriggers.length; i++) {
      const trig = levelTriggers[i];
      if (!trig) continue;
      const id = this._ensureTriggerId(trig);
      staticTriggers.push({ id, disabledUntilTick: trig.disabledUntilTick });
    }
    for (const trig of triggerManager._triggers || []) {
      if (!trig || staticSet.has(trig)) continue;
      const ownerId = Number.isFinite(trig.owner?.id) ? trig.owner.id : null;
      if (ownerId == null) continue;
      const id = this._ensureTriggerId(trig);
      dynamicTriggers.push({
        id,
        ownerId,
        type: trig.type,
        x1: trig.x1,
        y1: trig.y1,
        x2: trig.x2,
        y2: trig.y2,
        disableTicksCount: trig.disableTicksCount,
        soundIndex: trig.soundIndex,
        disabledUntilTick: trig.disabledUntilTick
      });
    }
    staticSet.clear();
    return { staticTriggers, dynamicTriggers };
  }

  _applyTriggerState(game, state) {
    const triggerManager = game.triggerManager;
    const level = game.level;
    if (!triggerManager || !level || !state) return;
    const levelTriggers = level.triggers || [];
    for (let i = 0; i < levelTriggers.length; i++) {
      const trig = levelTriggers[i];
      const entry = state.staticTriggers?.[i] || null;
      if (!trig || !entry) continue;
      trig.disabledUntilTick = entry.disabledUntilTick;
      this._ensureTriggerId(trig);
    }

    const dynamic = state.dynamicTriggers || [];
    if (dynamic.length) {
      const removeOwners = this._scratchRemoveOwners;
      removeOwners.clear();
      for (const trig of triggerManager._triggers || []) {
        const ownerId = Number.isFinite(trig.owner?.id) ? trig.owner.id : null;
        if (ownerId != null) removeOwners.add(ownerId);
      }
      for (const ownerId of removeOwners) {
        const owner = game.getLemmingManager?.()?.getLemming?.(ownerId) ?? null;
        if (owner) triggerManager.removeByOwner(owner);
      }
      removeOwners.clear();
      for (const snap of dynamic) {
        const owner = game.getLemmingManager?.()?.getLemming?.(snap.ownerId) ?? null;
        const trig = new Trigger(
          snap.type,
          snap.x1,
          snap.y1,
          snap.x2,
          snap.y2,
          snap.disableTicksCount,
          snap.soundIndex,
          owner
        );
        trig.disabledUntilTick = snap.disabledUntilTick;
        trig.__historyId = snap.id;
        triggerManager.add(trig);
      }
    }
  }

  _readObjectState(level) {
    const objects = level?.objects || [];
    const out = [];
    for (const obj of objects) {
      if (!obj?.animation) continue;
      const id = this._ensureObjectId(obj);
      out.push({
        id,
        firstFrameIndex: obj.animation.firstFrameIndex,
        isFinished: obj.animation.isFinished
      });
    }
    return out;
  }

  _applyObjectState(level, state) {
    for (const entry of state || []) {
      let obj = this._objectById.get(entry.id);
      if (!obj) {
        const objects = level?.objects || [];
        for (const candidate of objects) {
          if (!candidate?.animation) continue;
          const candidateId = this._ensureObjectId(candidate);
          if (candidateId === entry.id) {
            obj = candidate;
            break;
          }
        }
      }
      if (!obj?.animation) continue;
      obj.animation.firstFrameIndex = entry.firstFrameIndex;
      obj.animation.isFinished = !!entry.isFinished;
    }
  }

  _readMinimapState(miniMap) {
    if (!miniMap) return null;
    return {
      deadDots: new Uint8Array(miniMap.deadDots || []),
      deadTTLs: new Uint8Array(miniMap.deadTTLs || []),
      deadCount: miniMap.deadCount ?? 0
    };
  }
}

const __test__ = {
  createLemmingState,
  cloneLemmingState,
  ensureLemmingCapacity,
  snapshotLemming,
  applyLemmingSnapshot,
  isNoOpDelta
};

export { HistoryStore, __test__ };
