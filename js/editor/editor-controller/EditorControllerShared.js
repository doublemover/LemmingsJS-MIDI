import { EditorTools } from '../EditorTools.js';
import { EditorHistory } from '../EditorHistory.js';
import {
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  ensureEntryUid,
  setEntryProp,
  removeEntryAt
} from '../EditorEntryFactory.js';
import { findEntryAt, getEntryBounds } from '../EditorHitTest.js';
import { MIDI_FLAG_TRIGGER_MAX, clampMidiFlagId } from '../../midi/MidiFlagTriggers.js';

const DEFAULT_GRID = 4;
const MAX_ENTRANCES = 4;
const MAX_EXITS = 4;
const DEFAULT_HANDLE_SIZE = 2;
const MAX_BRUSH_SIZE = 64;
const MAX_MIDI_FLAG_ID = MIDI_FLAG_TRIGGER_MAX;
const snapValue = (value, gridSize) => {
  if (!Number.isFinite(gridSize) || gridSize <= 1) return Math.round(value);
  return Math.round(value / gridSize) * gridSize;
};
const clampSize = (value) => Math.max(1, Math.round(value));
const clampBrushSize = (value) => Math.min(MAX_BRUSH_SIZE, clampSize(value));
const selectionKey = (type, index) => `${type}:${index}`;
const isMidiFlagEnabled = (value) => value === true || value === 1 || value === '1';
const cloneEntry = (entry, options = {}) => {
  const props = entry?.props ? { ...entry.props } : {};
  const order = Array.isArray(entry?.order) ? entry.order.slice() : Object.keys(props);
  const unknownLines = Array.isArray(entry?.unknownLines) ? entry.unknownLines.slice() : [];
  const clone = { props, order, unknownLines };
  if (options.preserveUid && entry?.uid) {
    clone.uid = entry.uid;
  } else if (options.assignUid !== false) {
    ensureEntryUid(clone, options.prefix || 'e');
  }
  return clone;
};
const coerceEntryNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};
const normalizeBounds = (x1, y1, x2, y2) => {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};
const boundsIntersect = (a, b) => {
  if (!a || !b) return false;
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
};
const __test__ = {
  cloneEntry,
  normalizeBounds,
  boundsIntersect
};

export {
  DEFAULT_GRID,
  DEFAULT_HANDLE_SIZE,
  EditorHistory,
  EditorTools,
  MAX_BRUSH_SIZE,
  MAX_ENTRANCES,
  MAX_EXITS,
  MAX_MIDI_FLAG_ID,
  MIDI_FLAG_TRIGGER_MAX,
  __test__,
  boundsIntersect,
  clampBrushSize,
  clampMidiFlagId,
  clampSize,
  cloneEntry,
  coerceEntryNumber,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  ensureEntryUid,
  findEntryAt,
  getEntryBounds,
  isMidiFlagEnabled,
  normalizeBounds,
  removeEntryAt,
  selectionKey,
  setEntryProp,
  snapValue
};
