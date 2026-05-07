import { toFiniteNumber } from '../../core/numberParsing.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
const normalizeText = (value) => String(value ?? '').trim();

/**
 * @param {unknown} value
 * @returns {number|null}
 */
const parseNumber = (value) => {
  if (value == null || value === '') return null;
  return toFiniteNumber(value, null);
};

/**
 * @param {unknown} value
 * @returns {number|null}
 */
const normalizeRotation = (value) => {
  const num = parseNumber(value);
  if (num == null) return null;
  const normalized = ((num % 360) + 360) % 360;
  const snapped = Math.round(normalized / 90) * 90;
  return ((snapped % 360) + 360) % 360;
};

/**
 * @param {unknown} value
 * @returns {string}
 */
const formatRotation = (value) => {
  const num = parseNumber(value);
  if (num == null) return '';
  const normalized = ((num % 360) + 360) % 360;
  return String(normalized);
};

/**
 * @param {unknown} value
 * @returns {string}
 */
const formatValue = (value) => (value == null ? '' : String(value));

/**
 * @param {unknown} name
 * @returns {string}
 */
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
