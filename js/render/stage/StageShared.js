import { DisplayImage, drawMarchingAntRect } from '../DisplayImage.js';
import { Position2D } from '../../util/Position2D.js';
import { StageImageProperties } from '../StageImageProperties.js';
import { UserInputManager } from '../../input/UserInputManager.js';
import { ViewPoint } from '../ViewPoint.js';
import { getDependency } from '../../core/dependencies.js';
import { toFiniteNumber } from '../../core/numberParsing.js';
import {
  detectRuntimeCapabilities,
  resolveRenderExperimentState
} from '../../core/capabilityMatrix.js';

const COLOR_FN_RE = /^rgba?\(/i;
const COLOR_RE = /^rgba?\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*(?:,\s*([-+]?\d*\.?\d+)\s*)?\)$/i;
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function toChannel(value) {
  if (!Number.isFinite(value)) return 255;
  return clamp(Math.round(value), 0, 255);
}
function toAlpha(value) {
  if (!Number.isFinite(value)) return 1;
  return clamp(value, 0, 1);
}
function colorStringTo32(str) {
  if (typeof str !== 'string') return 0xffffffff;
  if (!COLOR_FN_RE.test(str)) return 0xffffffff;
  const m = COLOR_RE.exec(str.trim());
  if (!m) return 0xffffffff;
  const r = toChannel(toFiniteNumber(m[1], NaN));
  const g = toChannel(toFiniteNumber(m[2], NaN));
  const b = toChannel(toFiniteNumber(m[3], NaN));
  const a = toAlpha(toFiniteNumber(m[4], 1));
  return ((Math.round(a * 255) & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}
const perfNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};
const DIRTY_RECT_FULL_BLIT_THRESHOLD = 24;
const DIRTY_RECT_FULL_BLIT_AREA_RATIO = 0.4;
const DAMAGE_FULL_REDRAW_REGION_THRESHOLD = 48;
const DAMAGE_FULL_REDRAW_AREA_RATIO = 0.55;
const DIRTY_UNION_BLIT_RATIO = 1.25;
const PERF_SAMPLE_WINDOW = 240;
const percentile = (samples, p) => {
  if (!Array.isArray(samples) || samples.length < 1) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * clamped)));
  return sorted[index] || 0;
};
const summarizeSamples = (samples) => {
  const clean = Array.isArray(samples)
    ? samples.filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (!clean.length) {
    return { p50: 0, p95: 0, p99: 0, worst: 0 };
  }
  return {
    p50: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    p99: percentile(clean, 0.99),
    worst: percentile(clean, 1)
  };
};

export {
  COLOR_FN_RE,
  COLOR_RE,
  DAMAGE_FULL_REDRAW_AREA_RATIO,
  DAMAGE_FULL_REDRAW_REGION_THRESHOLD,
  DIRTY_RECT_FULL_BLIT_AREA_RATIO,
  DIRTY_RECT_FULL_BLIT_THRESHOLD,
  DIRTY_UNION_BLIT_RATIO,
  DisplayImage,
  PERF_SAMPLE_WINDOW,
  Position2D,
  StageImageProperties,
  UserInputManager,
  ViewPoint,
  clamp,
  colorStringTo32,
  detectRuntimeCapabilities,
  drawMarchingAntRect,
  getDependency,
  percentile,
  perfNow,
  resolveRenderExperimentState,
  summarizeSamples,
  toAlpha,
  toChannel,
  toFiniteNumber
};
