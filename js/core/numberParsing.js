const toFiniteNumber = (value, fallback = null) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseInt10 = (value, fallback = null) => {
  if (value == null) return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampNumber = (value, min = -Infinity, max = Infinity) => Math.min(Math.max(value, min), max);

const parseBoundedNumber = (value, {
  fallback = null,
  min = -Infinity,
  max = Infinity,
  multiplier = 1,
  integer = false
} = {}) => {
  const parsed = toFiniteNumber(value, null);
  if (parsed == null) return fallback;
  if (parsed < min || parsed > max) return fallback;
  const scaled = parsed * multiplier;
  if (!Number.isFinite(scaled)) return fallback;
  return integer ? Math.trunc(scaled) : scaled;
};

export {
  clampNumber,
  parseBoundedNumber,
  parseInt10,
  toFiniteNumber
};
