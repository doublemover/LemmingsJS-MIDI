const DEFAULT_WATCH_POLLING_CONFIG = Object.freeze({
  minMs: 0,
  activeMs: 250,
  maxMs: 2000,
  backoffFactor: 1.6,
  idleThreshold: 3,
  onDemandMinMs: 100
});

const HASH_OFFSET_BASIS = 2166136261;
const HASH_PRIME = 16777619;
const NUMBER_HASH_VIEW = new DataView(new ArrayBuffer(8));
const POINTER_EMPTY_PATH = Object.freeze([]);

/**
 * Parse an RFC6901 JSON pointer into path segments.
 * @param {string|null|undefined} pointer
 * @returns {string[]}
 */
const parseJsonPointer = (pointer) => {
  if (pointer == null || pointer === '') return POINTER_EMPTY_PATH;
  const source = String(pointer);
  if (source === '/') return [''];
  if (!source.startsWith('/')) return POINTER_EMPTY_PATH;
  return source
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
};

/**
 * Resolve a value from an object using pointer segments or a pointer string.
 * @param {object} obj
 * @param {string|string[]} pointerOrPath
 * @returns {*}
 */
const readPointerValue = (obj, pointerOrPath) => {
  const path = Array.isArray(pointerOrPath) ? pointerOrPath : parseJsonPointer(pointerOrPath);
  let current = obj;
  for (const part of path) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
};

const hashByte = (hash, byte) => Math.imul((hash ^ (byte & 0xff)) >>> 0, HASH_PRIME) >>> 0;

const hashUint32 = (hash, value) => {
  let next = hashByte(hash, value);
  next = hashByte(next, value >>> 8);
  next = hashByte(next, value >>> 16);
  next = hashByte(next, value >>> 24);
  return next >>> 0;
};

const hashString = (hash, value) => {
  let next = hash;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    next = hashByte(next, code);
    next = hashByte(next, code >>> 8);
  }
  return next >>> 0;
};

const hashNumber = (hash, value) => {
  NUMBER_HASH_VIEW.setFloat64(0, value, true);
  let next = hash;
  for (let i = 0; i < 8; i += 1) {
    next = hashByte(next, NUMBER_HASH_VIEW.getUint8(i));
  }
  return next >>> 0;
};

const hashValue = (value, seen = new WeakSet()) => {
  const type = typeof value;
  if (value === null) return hashByte(HASH_OFFSET_BASIS, 1);
  if (type === 'undefined') return hashByte(HASH_OFFSET_BASIS, 2);
  if (type === 'boolean') return hashByte(hashByte(HASH_OFFSET_BASIS, 3), value ? 1 : 0);
  if (type === 'number') return hashNumber(hashByte(HASH_OFFSET_BASIS, 4), value);
  if (type === 'string') return hashString(hashByte(HASH_OFFSET_BASIS, 5), value);
  if (type === 'bigint') return hashString(hashByte(HASH_OFFSET_BASIS, 6), value.toString());
  if (type === 'symbol') return hashString(hashByte(HASH_OFFSET_BASIS, 7), String(value.description ?? ''));
  if (type === 'function') return hashString(hashByte(HASH_OFFSET_BASIS, 8), value.name || '');
  if (seen.has(value)) return hashByte(HASH_OFFSET_BASIS, 250);
  seen.add(value);

  let hash = HASH_OFFSET_BASIS;
  if (Array.isArray(value)) {
    hash = hashByte(hash, 9);
    hash = hashUint32(hash, value.length);
    for (let i = 0; i < value.length; i += 1) {
      hash = hashUint32(hash, hashValue(value[i], seen));
    }
    seen.delete(value);
    return hash >>> 0;
  }

  if (value instanceof Map) {
    hash = hashByte(hash, 14);
    const entryHashes = [];
    for (const [entryKey, entryValue] of value.entries()) {
      let entryHash = HASH_OFFSET_BASIS;
      entryHash = hashUint32(entryHash, hashValue(entryKey, seen));
      entryHash = hashUint32(entryHash, hashValue(entryValue, seen));
      entryHashes.push(entryHash >>> 0);
    }
    entryHashes.sort((left, right) => left - right);
    hash = hashUint32(hash, entryHashes.length);
    for (const entryHash of entryHashes) {
      hash = hashUint32(hash, entryHash);
    }
    seen.delete(value);
    return hash >>> 0;
  }

  if (value instanceof Set) {
    hash = hashByte(hash, 15);
    const itemHashes = [];
    for (const item of value.values()) {
      itemHashes.push(hashValue(item, seen));
    }
    itemHashes.sort((left, right) => left - right);
    hash = hashUint32(hash, itemHashes.length);
    for (const itemHash of itemHashes) {
      hash = hashUint32(hash, itemHash);
    }
    seen.delete(value);
    return hash >>> 0;
  }

  if (value instanceof ArrayBuffer) {
    hash = hashByte(hash, 13);
    const bytes = new Uint8Array(value);
    hash = hashUint32(hash, bytes.byteLength);
    for (const byte of bytes) {
      hash = hashByte(hash, byte);
    }
    seen.delete(value);
    return hash >>> 0;
  }

  if (ArrayBuffer.isView(value)) {
    hash = hashByte(hash, 10);
    hash = hashUint32(hash, value.byteLength || 0);
    if (value instanceof DataView) {
      for (let i = 0; i < value.byteLength; i += 1) {
        hash = hashByte(hash, value.getUint8(i));
      }
    } else {
      for (const item of value) {
        hash = hashNumber(hash, Number(item));
      }
    }
    seen.delete(value);
    return hash >>> 0;
  }

  if (value instanceof Date) {
    hash = hashByte(hash, 11);
    hash = hashNumber(hash, value.getTime());
    seen.delete(value);
    return hash >>> 0;
  }

  hash = hashByte(hash, 12);
  const keys = Object.keys(value).sort();
  hash = hashUint32(hash, keys.length);
  for (const key of keys) {
    hash = hashString(hash, key);
    hash = hashUint32(hash, hashValue(value[key], seen));
  }
  seen.delete(value);
  return hash >>> 0;
};

const buildPointerFingerprint = (value) => {
  if (value === null) return { kind: 'null' };
  const type = typeof value;
  if (type === 'undefined') return { kind: 'undefined' };
  if (type === 'boolean') return { kind: 'boolean', value };
  if (type === 'number') return { kind: 'number', value };
  if (type === 'string') return { kind: 'string', value };
  if (type === 'bigint') return { kind: 'bigint', value: value.toString() };
  if (type === 'symbol') return { kind: 'symbol', value: String(value.description ?? '') };
  if (type === 'function') return { kind: 'function', value: value.name || '' };

  if (value instanceof Map) {
    return {
      kind: 'map',
      size: value.size,
      hash: hashValue(value)
    };
  }
  if (value instanceof Set) {
    return {
      kind: 'set',
      size: value.size,
      hash: hashValue(value)
    };
  }

  const size = Array.isArray(value)
    ? value.length
    : (ArrayBuffer.isView(value) ? (value.byteLength || 0) : Object.keys(value).length);
  return {
    kind: Array.isArray(value) ? 'array' : 'object',
    size,
    hash: hashValue(value)
  };
};

const areFingerprintsEqual = (left, right) => {
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'number') return Object.is(left.value, right.value);
  if (left.kind === 'boolean' || left.kind === 'string' || left.kind === 'bigint' || left.kind === 'symbol' || left.kind === 'function') {
    return left.value === right.value;
  }
  if (left.kind === 'null' || left.kind === 'undefined') return true;
  return left.size === right.size && left.hash === right.hash;
};

/**
 * Create watch state for a JSON pointer against an initial source object.
 * @param {string} pointer
 * @param {object} source
 * @returns {{path:string[],fingerprint:object}}
 */
const createPointerWatchState = (pointer, source) => {
  const path = parseJsonPointer(pointer);
  return {
    path,
    fingerprint: buildPointerFingerprint(readPointerValue(source, path))
  };
};

/**
 * Update a watch state in place and report whether the pointer value changed.
 * @param {{path:string[],fingerprint:object}} state
 * @param {object} source
 * @returns {boolean}
 */
const updatePointerWatchState = (state, source) => {
  const next = buildPointerFingerprint(readPointerValue(source, state.path));
  if (areFingerprintsEqual(state.fingerprint, next)) {
    return false;
  }
  state.fingerprint = next;
  return true;
};

const toFiniteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeConfig = (config = {}) => {
  const minMs = Math.max(0, Math.trunc(toFiniteNumber(config.minMs, DEFAULT_WATCH_POLLING_CONFIG.minMs)));
  const activeMs = Math.max(minMs, Math.trunc(toFiniteNumber(config.activeMs, DEFAULT_WATCH_POLLING_CONFIG.activeMs)));
  const maxMs = Math.max(activeMs, Math.trunc(toFiniteNumber(config.maxMs, DEFAULT_WATCH_POLLING_CONFIG.maxMs)));
  const backoffFactor = Math.max(1, toFiniteNumber(config.backoffFactor, DEFAULT_WATCH_POLLING_CONFIG.backoffFactor));
  const idleThreshold = Math.max(1, Math.trunc(toFiniteNumber(config.idleThreshold, DEFAULT_WATCH_POLLING_CONFIG.idleThreshold)));
  const onDemandMinMs = Math.max(0, Math.trunc(toFiniteNumber(config.onDemandMinMs, DEFAULT_WATCH_POLLING_CONFIG.onDemandMinMs)));
  return {
    minMs,
    activeMs,
    maxMs,
    backoffFactor,
    idleThreshold,
    onDemandMinMs
  };
};

const clampDelay = (value, minMs, maxMs) => {
  if (!Number.isFinite(value)) return minMs;
  return Math.min(maxMs, Math.max(minMs, Math.trunc(value)));
};

class WatchPollingController {
  constructor({
    hasWatchesFn,
    pollFn,
    setTimerFn = setTimeout,
    clearTimerFn = clearTimeout,
    nowFn = Date.now,
    config
  } = {}) {
    if (typeof hasWatchesFn !== 'function') {
      throw new Error('WatchPollingController requires hasWatchesFn');
    }
    if (typeof pollFn !== 'function') {
      throw new Error('WatchPollingController requires pollFn');
    }
    this.hasWatchesFn = hasWatchesFn;
    this.pollFn = pollFn;
    this.setTimerFn = setTimerFn;
    this.clearTimerFn = clearTimerFn;
    this.nowFn = nowFn;
    this.config = normalizeConfig(config);
    this.running = false;
    this.polling = false;
    this.pendingImmediate = false;
    this.idlePolls = 0;
    this.delayMs = this.config.activeMs;
    this.lastPollAtMs = null;
    this.timerHandle = null;
    this.nextRunAtMs = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.idlePolls = 0;
    this.delayMs = this.config.activeMs;
    this.pendingImmediate = false;
    this._schedule(0);
  }

  stop() {
    this.running = false;
    this.pendingImmediate = false;
    this._clearTimer();
  }

  request({ immediate = false } = {}) {
    if (!this.running || !this.hasWatchesFn()) return;
    if (immediate) {
      this.pendingImmediate = true;
      if (!this.polling) {
        this._schedule(0);
      }
      return;
    }
    if (!this.polling) {
      this._schedule(Math.min(this.delayMs, this.config.activeMs));
    }
  }

  async tickNow() {
    if (!this.running || !this.hasWatchesFn()) return null;
    if (this.polling) {
      this.pendingImmediate = true;
      return null;
    }
    const now = this.nowFn();
    if (Number.isFinite(this.lastPollAtMs) && (now - this.lastPollAtMs) < this.config.onDemandMinMs) {
      return null;
    }
    return this._runPollCycle();
  }

  getSnapshot() {
    return {
      running: this.running,
      polling: this.polling,
      pendingImmediate: this.pendingImmediate,
      idlePolls: this.idlePolls,
      delayMs: this.delayMs,
      lastPollAtMs: this.lastPollAtMs,
      nextRunAtMs: this.nextRunAtMs
    };
  }

  async _onTimer() {
    this.timerHandle = null;
    this.nextRunAtMs = 0;
    try {
      await this._runPollCycle();
    } catch (error) {
      // Ignore timer poll errors and let future polls continue.
    }
  }

  async _runPollCycle() {
    if (!this.running || !this.hasWatchesFn()) return null;
    if (this.polling) return null;
    this.polling = true;
    let outcome = null;
    let failed = false;
    try {
      outcome = await this.pollFn();
    } catch (error) {
      failed = true;
      outcome = null;
    } finally {
      this.polling = false;
      this.lastPollAtMs = this.nowFn();
    }

    this._applyOutcome(outcome, failed);

    if (!this.running || !this.hasWatchesFn()) {
      this._clearTimer();
      return outcome;
    }
    if (this.pendingImmediate) {
      this.pendingImmediate = false;
      this._schedule(this.config.minMs);
      return outcome;
    }
    this._schedule(this.delayMs);
    return outcome;
  }

  _applyOutcome(outcome, failed) {
    if (failed) {
      this.idlePolls += 1;
      this.delayMs = clampDelay(
        Math.round(this.delayMs * this.config.backoffFactor),
        this.config.activeMs,
        this.config.maxMs
      );
      return;
    }

    const triggeredCount = Math.max(0, Math.trunc(toFiniteNumber(outcome?.triggeredCount, 0)));
    if (triggeredCount > 0) {
      this.idlePolls = 0;
      this.delayMs = this.config.activeMs;
      return;
    }

    this.idlePolls += 1;
    if (this.idlePolls < this.config.idleThreshold) {
      return;
    }
    this.delayMs = clampDelay(
      Math.round(this.delayMs * this.config.backoffFactor),
      this.config.activeMs,
      this.config.maxMs
    );
  }

  _schedule(delayMs) {
    if (!this.running) return;
    const normalized = clampDelay(delayMs, this.config.minMs, this.config.maxMs);
    const dueAt = this.nowFn() + normalized;
    if (this.timerHandle && this.nextRunAtMs > 0 && this.nextRunAtMs <= dueAt) {
      return;
    }
    this._clearTimer();
    this.nextRunAtMs = dueAt;
    this.timerHandle = this.setTimerFn(() => {
      void this._onTimer();
    }, normalized);
  }

  _clearTimer() {
    if (this.timerHandle) {
      this.clearTimerFn(this.timerHandle);
    }
    this.timerHandle = null;
    this.nextRunAtMs = 0;
  }
}

export {
  DEFAULT_WATCH_POLLING_CONFIG,
  WatchPollingController,
  parseJsonPointer,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState
};
