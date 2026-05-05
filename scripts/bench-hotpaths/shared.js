import { DisplayImage } from '../../js/render/DisplayImage.js';
import { Frame } from '../../js/render/Frame.js';
import { Stage } from '../../js/render/Stage.js';
import { GameGui } from '../../js/game/GameGui.js';
import { HistoryStore } from '../../js/game/HistoryStore.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { Level } from '../../js/level/Level.js';
import { ObjectManager } from '../../js/level/ObjectManager.js';
import { ActionDiggSystem } from '../../js/actions/ActionDiggSystem.js';
import { Mask } from '../../js/render/Mask.js';
import { MiniMap } from '../../js/render/MiniMap.js';
import { GamepadInputController } from '../../js/input/GamepadInputController.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const parseArgs = (argv) => {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    out.set(key, value ?? 'true');
  }
  return out;
};
const toNumberOrNaN = (value) => {
  try {
    return Number(value);
  } catch {
    return Number.NaN;
  }
};
const toPositiveInt = (value, fallback) => {
  const parsed = toNumberOrNaN(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : fallback;
};
const nsToMs = (value) => toNumberOrNaN(value) / 1e6;
const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * clamped)));
  return sorted[index];
};
const withGlobalStubs = (fn) => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevPerformance = globalThis.performance;
  const prevLemmings = globalThis.lemmings;
  const hadLemmings = Object.prototype.hasOwnProperty.call(globalThis, 'lemmings');
  try {
    return fn();
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.performance = prevPerformance;
    if (hadLemmings) {
      globalThis.lemmings = prevLemmings;
    } else {
      delete globalThis.lemmings;
    }
  }
};
const measureN = (iterations, fn) => {
  const samples = [];
  const allocationSamples = [];
  for (let i = 0; i < iterations; i += 1) {
    const beforeHeap = typeof process?.memoryUsage === 'function'
      ? process.memoryUsage().heapUsed
      : NaN;
    const start = process.hrtime.bigint();
    fn();
    samples.push(nsToMs(process.hrtime.bigint() - start));
    const afterHeap = typeof process?.memoryUsage === 'function'
      ? process.memoryUsage().heapUsed
      : NaN;
    if (Number.isFinite(beforeHeap) && Number.isFinite(afterHeap)) {
      allocationSamples.push(Math.max(0, afterHeap - beforeHeap));
    }
  }
  const total = samples.reduce((acc, value) => acc + value, 0);
  return {
    samplesMs: samples,
    avgMs: total / samples.length,
    allocationSamples
  };
};
const summarizeSamples = (samplesMs, iterations) => {
  const clean = samplesMs
    .map((value) => toNumberOrNaN(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const avg = clean.reduce((acc, value) => acc + value, 0) / Math.max(1, clean.length);
  const p50 = percentile(clean, 0.5);
  const p95 = percentile(clean, 0.95);
  const p99 = percentile(clean, 0.99);
  const worst = percentile(clean, 1);
  return {
    samplesMs: clean.map((value) => Number(value.toFixed(2))),
    avgMs: Number(avg.toFixed(2)),
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    p99Ms: Number(p99.toFixed(2)),
    worstMs: Number(worst.toFixed(2)),
    usPerIteration: Number(((avg * 1000) / Math.max(1, iterations)).toFixed(4))
  };
};
const estimateBytes = (value, seen = new Set()) => {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let total = 0;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) total += estimateBytes(value[i], seen);
    return total;
  }
  for (const entry of Object.values(value)) total += estimateBytes(entry, seen);
  return total;
};
const makePalette = () => ({
  getR(index) { return (index * 3) & 0xff; },
  getG(index) { return (index * 5) & 0xff; },
  getB(index) { return (index * 7) & 0xff; },
  getColor(index) {
    const r = this.getR(index);
    const g = this.getG(index);
    const b = this.getB(index);
    return 0xFF000000 | (b << 16) | (g << 8) | r;
  }
});
const makeContext = (canvas) => ({
  canvas,
  imageSmoothingEnabled: false,
  globalAlpha: 1,
  fillStyle: '#000',
  strokeStyle: '#000',
  lineWidth: 1,
  lineDashOffset: 0,
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
  putImageData() {},
  getImageData(_x, _y, width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
  fillRect() {},
  drawImage() {},
  strokeRect() {},
  setLineDash() {},
  fillText() {}
});
const makeCanvas = (width, height) => {
  const canvas = {
    width,
    height,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext() { return this._ctx; }
  };
  canvas._ctx = makeContext(canvas);
  return canvas;
};
const setupRenderEnvironment = () => {
  globalThis.performance = {
    now: () => Date.now(),
    measure() {}
  };
  globalThis.window = {
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement() { return makeCanvas(16, 16); }
  };
  globalThis.lemmings = {
    bench: false,
    bench2: false,
    benchReverse: false,
    benchSequence: false,
    performanceAPI: false,
    perfMetrics: false,
    endless: false
  };
};

export {
  ActionDiggSystem,
  DisplayImage,
  EventHandler,
  Frame,
  GameGui,
  GamepadInputController,
  HistoryStore,
  Level,
  Mask,
  MidiEventRouter,
  MidiScheduler,
  MiniMap,
  ObjectManager,
  SkillTypes,
  Stage,
  estimateBytes,
  fileURLToPath,
  makeCanvas,
  makeContext,
  makePalette,
  measureN,
  nsToMs,
  parseArgs,
  path,
  percentile,
  setupRenderEnvironment,
  summarizeSamples,
  toNumberOrNaN,
  toPositiveInt,
  withGlobalStubs
};
