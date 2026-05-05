const HASH_OFFSET_BASIS = 2166136261;
const HASH_PRIME = 16777619;
const NUMBER_HASH_VIEW = new DataView(new ArrayBuffer(8));
const POINTER_EMPTY_PATH = Object.freeze([]);
const POINTER_INVALID_PATH = null;

/**
 * Parse an RFC6901 JSON pointer into path segments.
 * @param {string|null|undefined} pointer
 * @returns {string[]|null}
 */
const parseJsonPointer = (pointer) => {
  if (pointer == null || pointer === '') return POINTER_EMPTY_PATH;
  const source = String(pointer);
  if (source === '/') return [''];
  if (!source.startsWith('/')) return POINTER_INVALID_PATH;
  const decoded = [];
  for (const part of source.slice(1).split('/')) {
    if (/~(?:$|[^01])/.test(part)) {
      return POINTER_INVALID_PATH;
    }
    decoded.push(part.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return decoded;
};

/**
 * Resolve a value from an object using pointer segments or a pointer string.
 * @param {object} obj
 * @param {string|string[]|null} pointerOrPath
 * @returns {*}
 */
const readPointerValue = (obj, pointerOrPath) => {
  if (pointerOrPath === POINTER_INVALID_PATH) return undefined;
  const path = Array.isArray(pointerOrPath) ? pointerOrPath : parseJsonPointer(pointerOrPath);
  if (path === POINTER_INVALID_PATH) return undefined;
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
        if (typeof item === 'bigint') {
          hash = hashByte(hash, 16);
          hash = hashString(hash, item.toString());
        } else {
          hash = hashByte(hash, 17);
          hash = hashNumber(hash, Number(item));
        }
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

  if (value instanceof Date) {
    return {
      kind: 'date',
      value: value.getTime()
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      kind: 'arraybuffer',
      size: value.byteLength,
      hash: hashValue(value)
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      kind: 'arraybuffer-view',
      viewType: value.constructor?.name || 'view',
      size: value.byteLength || 0,
      hash: hashValue(value)
    };
  }

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
    : Object.keys(value).length;
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
  if (left.kind === 'date') return left.value === right.value;
  if (left.kind === 'null' || left.kind === 'undefined') return true;
  if (left.kind === 'arraybuffer-view') {
    return left.viewType === right.viewType && left.size === right.size && left.hash === right.hash;
  }
  return left.size === right.size && left.hash === right.hash;
};

/**
 * Create watch state for a JSON pointer against an initial source object.
 * @param {string} pointer
 * @param {object} source
 * @returns {{path:string[]|null,fingerprint:object}}
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
 * @param {{path:string[]|null,fingerprint:object}} state
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

export {
  parseJsonPointer,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState
};
