const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isUnsafeObjectKey = (key) => UNSAFE_OBJECT_KEYS.has(String(key));

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const createNullObject = () => Object.create(null);

const safeObjectEntries = (value) => {
  if (!isPlainObject(value)) return [];
  return Object.entries(value).filter(([key]) => !isUnsafeObjectKey(key));
};

const cloneSafeObject = (value, depth = 0, maxDepth = 12) => {
  if (depth > maxDepth) return undefined;
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      const next = cloneSafeObject(value[i], depth + 1, maxDepth);
      if (next !== undefined) out.push(next);
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out = createNullObject();
    for (const [key, entry] of safeObjectEntries(value)) {
      const next = cloneSafeObject(entry, depth + 1, maxDepth);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
};

const mergeDeepSafe = (target, source) => {
  const out = createNullObject();
  for (const [key, value] of safeObjectEntries(target)) {
    out[key] = value;
  }
  for (const [key, value] of safeObjectEntries(source)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeDeepSafe(out[key], value);
    } else {
      const cloned = cloneSafeObject(value);
      if (cloned !== undefined) out[key] = cloned;
    }
  }
  return out;
};

export {
  UNSAFE_OBJECT_KEYS,
  isUnsafeObjectKey,
  isPlainObject,
  createNullObject,
  safeObjectEntries,
  cloneSafeObject,
  mergeDeepSafe
};
