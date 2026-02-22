const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

const hashString32 = (value, seed = FNV_OFFSET_BASIS_32) => {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
};

const normalizeSeed = (seedLike, fallback = FNV_OFFSET_BASIS_32) => {
  if (Number.isFinite(seedLike)) {
    return (Math.trunc(seedLike) >>> 0);
  }
  if (typeof seedLike === 'string') {
    const trimmed = seedLike.trim();
    if (!trimmed) return fallback >>> 0;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return (Number.parseInt(trimmed, 16) >>> 0);
    }
    if (/^[+-]?\d+$/.test(trimmed)) {
      return (Number.parseInt(trimmed, 10) >>> 0);
    }
    return hashString32(trimmed);
  }
  return fallback >>> 0;
};

const deriveSeed = (seedLike, scope) => {
  const base = normalizeSeed(seedLike);
  if (!scope) return base;
  return hashString32(String(scope), base);
};

const createSeededRandom = (seedLike) => {
  let state = normalizeSeed(seedLike, 0x6d2b79f5);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export {
  hashString32,
  normalizeSeed,
  deriveSeed,
  createSeededRandom
};
