const normalizeText = (value) => String(value ?? '').trim();

const parseNumber = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeRotation = (value) => {
  const num = parseNumber(value);
  if (num == null) return null;
  const normalized = ((num % 360) + 360) % 360;
  const snapped = Math.round(normalized / 90) * 90;
  return ((snapped % 360) + 360) % 360;
};

const formatRotation = (value) => {
  const num = parseNumber(value);
  if (num == null) return '';
  const normalized = ((num % 360) + 360) % 360;
  return String(normalized);
};

const formatValue = (value) => (value == null ? '' : String(value));

const sanitizeFileName = (name) => String(name || 'level')
  .trim()
  .replace(/[^a-z0-9_-]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60) || 'level';

export {
  formatRotation,
  formatValue,
  normalizeRotation,
  normalizeText,
  parseNumber,
  sanitizeFileName
};
