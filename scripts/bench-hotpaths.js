import { DisplayImage } from '../js/render/DisplayImage.js';
import { Frame } from '../js/render/Frame.js';
import { Stage } from '../js/render/Stage.js';
import { GameGui } from '../js/game/GameGui.js';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { Level } from '../js/level/Level.js';
import { ObjectManager } from '../js/level/ObjectManager.js';
import { ActionDiggSystem } from '../js/actions/ActionDiggSystem.js';
import { Mask } from '../js/render/Mask.js';
import { MiniMap } from '../js/render/MiniMap.js';
import { GamepadInputController } from '../js/input/GamepadInputController.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../js/midi/MidiScheduler.js';
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

const runDirtyRectBench = ({ iterations, rectsPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(640, 360);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(640, 320);
  stage.updateStageSize();

  const display = stage.gameImgProps.display;
  const img = display.getImageData();
  const width = display.getWidth();
  const height = display.getHeight();
  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let r = 0; r < rectsPerIter; r += 1) {
        const rw = 4 + ((i + r) % 12);
        const rh = 3 + ((i + (r * 3)) % 10);
        const x = (i * 31 + r * 47) % Math.max(1, width - rw);
        const y = (i * 17 + r * 29) % Math.max(1, height - rh);
        display.markDirtyRect(x, y, rw, rh);
      }
      stage.draw(stage.gameImgProps, img);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const runTileCompositionBench = ({ iterations, tilesPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(960, 540);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(960, 512);
  stage.updateStageSize();

  const display = stage.gameImgProps.display;
  display.setDirtyTileSize(32);
  const img = display.getImageData();
  const width = display.getWidth();
  const height = display.getHeight();
  const tileSize = 32;

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let t = 0; t < tilesPerIter; t += 1) {
        const x = ((i * 37) + (t * 59)) % Math.max(1, width - tileSize);
        const y = ((i * 23) + (t * 43)) % Math.max(1, height - tileSize);
        display.markPresentDirtyRect(x, y, tileSize, tileSize);
      }
      stage.draw(stage.gameImgProps, img);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const runMarchingAntBench = ({ iterations, repeats }) => {
  const stage = {
    createImage(_display, width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    redraw() {},
    setGameViewPointPosition() {}
  };
  const display = new DisplayImage(stage);
  display.initSize(640, 360);
  display.clear(0);

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const offset = i & 15;
      display.drawMarchingAntRect(32, 24, 220, 120, 4, offset);
      display.drawMarchingAntRect(300, 32, 96, 52, 3, offset + 2);
      display.drawMarchingAntRect(120, 180, 300, 100, 5, offset + 4, 0xFF00FFFF, 0xFF0044AA);
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
};

const makeGuiDisplay = () => ({
  worldDataSize: { width: 320, height: 40 },
  stage: { updateStageSize() {} },
  onMouseDown: new EventHandler(),
  onMouseUp: new EventHandler(),
  onMouseRightDown: new EventHandler(),
  onMouseRightUp: new EventHandler(),
  onDoubleClick: new EventHandler(),
  onMouseMove: new EventHandler(),
  initSize(width, height) { this.worldDataSize = { width, height }; },
  setBackground() {},
  redraw() {},
  drawRect() {},
  drawFrame() {},
  drawFrameCovered() {},
  drawFrameResized() {},
  drawStippleRect() {},
  drawMarchingAntRect() {},
  drawHorizontalLine() {},
  setPixel() {}
});

const runGuiOverlayBench = ({ iterations, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();

  const skills = {
    onCountChanged: new EventHandler(),
    onSelectionChanged: new EventHandler(),
    getSelectedSkill() { return SkillTypes.BASHER; },
    getSkill() { return 5; },
    clearSelectedSkill() { return false; }
  };
  const timer = {
    speedFactor: 1,
    tickIndex: 99,
    eachGameSecond: new EventHandler(),
    isRunning() { return false; },
    getGameTime() { return 0; },
    getGameLeftTimeString() { return '1-00'; },
    getGameLeftTimeSString() { return '1-00'; }
  };
  const victory = {
    releaseRate: 20,
    getMinReleaseRate() { return 1; },
    getCurrentReleaseRate() { return this.releaseRate; },
    getMaxReleaseRate() { return 99; },
    getReleaseCount() { return 25; },
    getSurvivorPercentage() { return 75; }
  };
  const panelSprite = {
    width: 320,
    height: 40,
    getData() { return new Uint8ClampedArray(320 * 40 * 4); }
  };
  const sprites = {
    getPanelSprite() { return panelSprite; },
    getNumberSpriteEmpty() { return { id: 'empty' }; },
    getNumberSpriteLeft(v) { return { id: `L${v}` }; },
    getNumberSpriteRight(v) { return { id: `R${v}` }; },
    getLetterSprite(ch) { return { id: `G${ch}` }; }
  };
  const game = {
    queueCommand() {},
    showDebug: false,
    level: {
      width: 100,
      height: 50,
      mechanics: {},
      objects: [],
      screenPositionX: 0,
      getGroundMaskLayer() { return { countMaskInRect() { return 0; } }; }
    },
    gameDisplay: { hoverLemming: null },
    lemmingManager: { setMiniMap() {} },
    getLemmingManager() { return { spawnTotal: 20, getLemmings() { return []; } }; }
  };

  const gui = new GameGui(game, sprites, skills, timer, victory);
  gui.display = makeGuiDisplay();
  gui.backgroundChanged = true;
  gui.gameTimeChanged = true;
  gui.skillsCountChanged = true;
  gui.releaseRateChanged = true;

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      gui.nukePrepared = (i & 1) === 0;
      gui._hoverPanelIdx = gui.nukePrepared ? 11 : 10;
      gui.gameTimeChanged = true;
      gui.render();
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  gui.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const runOverlayPlaneBench = ({ iterations, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const stageCanvas = makeCanvas(640, 360);
  const stage = new Stage(stageCanvas);
  stage.setGuiEnabled(false);
  stage.gameImgProps.display.initSize(640, 320);
  stage.updateStageSize();
  stage.redraw(true);

  const overlay = stage.getGameOverlayDisplay();

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const offset = i & 15;
      overlay.clear(0x00000000);
      overlay.drawMarchingAntRect(32, 24, 220, 120, 4, offset);
      overlay.drawMarchingAntRect(300, 40, 96, 52, 3, offset + 2);
      stage.setGameOverlayVisible(true);
      stage.redraw();
    }
    overlay.clear(0x00000000);
    stage.setGameOverlayVisible(false);
    stage.redraw();
  };

  const measured = measureN(repeats + 1, runOnce);
  stage.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const makeScaleFrame = (size = 16) => {
  const width = Math.max(2, Math.trunc(size));
  const height = width;
  const pixels = new Uint32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const idx = row + x;
      const r = (x * 17 + y * 9) & 0xff;
      const g = (x * 11 + y * 13) & 0xff;
      const b = (x * 7 + y * 19) & 0xff;
      pixels[idx] = 0xFF000000 | (b << 16) | (g << 8) | r;
      mask[idx] = ((x + y) % 5) === 0 ? 0 : 1;
    }
  }
  return {
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    getBuffer() { return pixels; },
    getMask() { return mask; },
    _version: 1
  };
};

const runScaledBlitBench = ({ iterations, repeats }) => {
  const stage = {
    createImage(_display, width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    redraw() {},
    setGameViewPointPosition() {}
  };
  const display = new DisplayImage(stage);
  display.initSize(640, 360);
  display.clear(0);
  const frame = makeScaleFrame(16);
  const modes = ['nearest', 'xbrz', 'hqx'];

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const mode = modes[i % modes.length];
      const x = (i * 13) % 560;
      const y = (i * 7) % 280;
      display._blit(frame, x, y, {
        size: { width: 64, height: 64 },
        scaleMode: mode
      });
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations);
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations);
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
};

const makeMidiOutput = (channelCount = 16) => {
  const channels = {};
  for (let i = 1; i <= channelCount; i += 1) {
    channels[i] = {
      sendNoteOn() {},
      sendNoteOff() {},
      sendPitchBend() {},
      sendPitchBendRange() {},
      sendControlChange() {},
      sendAllNotesOff() {}
    };
  }
  return { channels };
};

const runMidiRouterBench = ({ iterations, eventsPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const router = new MidiEventRouter({
    enabled: true,
    noteRange: { min: 36, max: 96 },
    durationTicks: { min: 0, max: 0, default: 0 },
    timing: { bpmBase: 120, scheduleAheadMs: 0 },
    repeat: { enabled: false },
    limits: {
      maxPerTick: 128,
      maxPerSecond: 1000,
      maxBytesPerSecond: 100000000
    }
  });
  router.context = {
    game: {
      getGameTimer() {
        return { tps: 60, speedFactor: 1 };
      }
    }
  };
  router.setOutput(makeMidiOutput(16));

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      const tick = i + 1;
      for (let eventIndex = 0; eventIndex < eventsPerIter; eventIndex += 1) {
        router._onEvent({
          tick,
          sfxId: 1,
          x: (eventIndex * 7) % 320,
          y: (eventIndex * 11) % 200
        });
      }
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  router.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations * Math.max(1, eventsPerIter));
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations * Math.max(1, eventsPerIter));
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const runMidiSchedulerBench = ({ iterations, notesPerIter, repeats }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const scheduler = new MidiScheduler({
    defaultChannel: 1,
    limits: {
      maxActiveNotes: 32,
      maxEventsPerSecond: 1000,
      maxBytesPerSecond: 100000000
    },
    mpe: { enabled: false }
  });
  scheduler.setTickMs(1000 / 60);
  scheduler.setOutput(makeMidiOutput(16));

  const runOnce = () => {
    for (let i = 0; i < iterations; i += 1) {
      for (let noteIndex = 0; noteIndex < notesPerIter; noteIndex += 1) {
        scheduler.sendNote({
          note: 48 + ((i + noteIndex) % 24),
          velocity: 96,
          durationTicks: 0,
          channel: 1
        }, {
          sfxId: 1,
          priority: 1
        });
      }
    }
  };

  const measured = measureN(repeats + 1, runOnce);
  scheduler.dispose();
  const summary = summarizeSamples(measured.samplesMs.slice(1), iterations * Math.max(1, notesPerIter));
  const allocation = summarizeSamples(measured.allocationSamples.slice(1), iterations * Math.max(1, notesPerIter));
  summary.allocBytesAvg = Math.round(allocation.avgMs);
  summary.allocBytesP95 = Math.round(allocation.p95Ms);
  summary.allocBytesWorst = Math.round(allocation.worstMs);
  return summary;
});

const makeHistoryGame = (lemmingCount) => {
  const walkAction = { name: 'walk' };
  const lemmings = new Array(lemmingCount);
  for (let i = 0; i < lemmingCount; i += 1) {
    lemmings[i] = {
      id: i,
      x: 10 + (i % 80),
      y: 20 + Math.floor(i / 80),
      lookRight: (i & 1) === 0,
      frameIndex: i & 7,
      state: 0,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    };
  }
  const manager = {
    lemmings,
    activeLemmings: lemmings.slice(),
    actions: [walkAction],
    skillActions: [],
    actionTypeByAction: new Map([[walkAction, 0]]),
    selectedIndex: -1,
    spawnTotal: lemmingCount,
    releaseTickIndex: 0,
    mmTickCounter: 0,
    nextNukingLemmingsIndex: -1,
    _nukeTargets: null,
    getLemming(id) { return this.lemmings[id] || null; }
  };
  const timer = {
    speedFactor: 1,
    frameTime: 1000 / 60,
    tickIndex: 0
  };
  const skills = {
    selectedSkill: SkillTypes.BASHER,
    cheatMode: false,
    skills: [0, 20, 20, 20, 20, 20, 20, 20, 20]
  };
  const victory = {
    releaseRate: 50,
    minReleaseRate: 1,
    leftCount: lemmingCount,
    outCount: lemmingCount,
    survivorCount: 0,
    isFinalize: false
  };
  const level = {
    entrances: [],
    triggers: [],
    objects: [],
    groundMask: null,
    groundImage: null
  };
  const game = {
    level,
    finalGameState: 0,
    getLemmingManager() { return manager; },
    getGameTimer() { return timer; },
    getGameSkills() { return skills; },
    getVictoryCondition() { return victory; }
  };
  return { game, manager, timer, skills, victory };
};

const mutateHistoryLemmings = (manager, tick) => {
  const lems = manager.lemmings;
  const stride = Math.max(1, Math.floor(lems.length / 32));
  for (let i = tick % stride; i < lems.length; i += stride) {
    const lem = lems[i];
    if (!lem || lem.removed) continue;
    lem.x += ((tick + i) & 1) ? 1 : -1;
    lem.frameIndex = (lem.frameIndex + 1) & 15;
    if (((tick + i) % 17) === 0) {
      lem.lookRight = !lem.lookRight;
    }
  }
  manager.mmTickCounter += 1;
};

const runHistoryScenario = ({ lemmingCount, ticks, seekWindow, repeats }) => {
  const recordSamples = [];
  const applySamples = [];
  let lastMetrics = null;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const { game, manager, timer, skills } = makeHistoryGame(lemmingCount);
    const history = new HistoryStore({
      keyframeInterval: 60,
      enableHistoryCap: false,
      enableColdBlockCompression: false,
      enableColdBlockDedupe: false
    });
    history.game = game;
    history.timer = timer;
    history._recording = true;
    history.captureBaseline(game);
    const startRecord = process.hrtime.bigint();
    for (let tick = 0; tick < ticks; tick += 1) {
      history.beginTick(timer.tickIndex);
      mutateHistoryLemmings(manager, tick);
      if (tick > 0 && (tick % 90) === 0) {
        timer.speedFactor = timer.speedFactor === 1 ? 2 : 1;
        skills.selectedSkill = skills.selectedSkill === SkillTypes.BASHER
          ? SkillTypes.DIGGER
          : SkillTypes.BASHER;
      }
      timer.tickIndex += 1;
      history.endTick();
    }
    recordSamples.push(nsToMs(process.hrtime.bigint() - startRecord));

    const applyStartTick = Math.max(0, ticks - seekWindow);
    const startApply = process.hrtime.bigint();
    for (let tick = ticks - 1; tick >= applyStartTick; tick -= 1) {
      history.applyDeltaBackward(game, history.getDelta(tick));
    }
    for (let tick = applyStartTick; tick < ticks; tick += 1) {
      history.applyDeltaForward(game, history.getDelta(tick));
    }
    applySamples.push(nsToMs(process.hrtime.bigint() - startApply));

    if (repeat === repeats) {
      let deltaBytes = 0;
      let nonEmptyDeltas = 0;
      for (let tick = 0; tick < ticks; tick += 1) {
        const delta = history.getDelta(tick);
        if (!delta) continue;
        nonEmptyDeltas += 1;
        deltaBytes += history._packDeltaForStorage(delta).length;
      }
      let keyframeBytes = 0;
      for (const keyframe of history.keyframes) {
        if (keyframe) keyframeBytes += estimateBytes(keyframe);
      }
      lastMetrics = {
        retainedDeltaCount: history.getHistoryStats().deltaCount,
        nonEmptyDeltas,
        avgDeltaBytes: Number((deltaBytes / Math.max(1, nonEmptyDeltas)).toFixed(2)),
        keyframeBytes,
        replayHash: history.computeReplayHash()
      };
    }
  }
  const record = summarizeSamples(recordSamples.slice(1), ticks);
  const apply = summarizeSamples(applySamples.slice(1), seekWindow * 2);
  return {
    endTick: record,
    seekWindowApply: apply,
    ...lastMetrics
  };
};

const runHistoryReplayBench = ({ ticks, seekWindow, repeats }) => ({
  lemmings50: runHistoryScenario({ lemmingCount: 50, ticks, seekWindow, repeats }),
  lemmings200: runHistoryScenario({ lemmingCount: 200, ticks, seekWindow, repeats }),
  lemmings1000: runHistoryScenario({ lemmingCount: 1000, ticks, seekWindow, repeats })
});

const makeBenchMask = (width = 16, height = 12, offsetX = -8, offsetY = -6) => {
  const mask = new Mask(null, width, height, offsetX, offsetY);
  mask.data = new Int8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask.data[(y * width) + x] = ((x + y) % 5) === 0 ? 0 : 1;
    }
  }
  return mask;
};

const makeTerrainLevel = ({ steel = false, arrows = false, runtimeStats = null } = {}) => {
  const width = 320;
  const height = 160;
  const level = new Level(width, height);
  level.setPalettes(makePalette(), makePalette());
  const img = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    level.groundMask.mask[i] = 1;
    const o = i * 4;
    img[o] = 64 + (i & 63);
    img[o + 1] = 120;
    img[o + 2] = 32;
    img[o + 3] = 255;
  }
  level.setGroundImage(img);
  level.groundMask.mask.fill(1);
  if (steel) {
    for (let y = 20; y < 140; y += 1) {
      for (let x = 30; x < 290; x += 1) {
        if (((x + y) & 3) !== 0) level.steelMask.setMaskAt(x, y);
      }
    }
  }
  if (arrows) {
    level.setArrowAreas([{ x: 20, y: 10, width: 280, height: 130, direction: 1 }]);
  }
  if (runtimeStats) {
    level.setRuntime({
      history: {
        recordGroundChange() { runtimeStats.historyRecords += 1; }
      },
      miniMap: {
        invalidateRegion() { runtimeStats.minimapInvalidations += 1; },
        onGroundChanged() { runtimeStats.minimapPixelUpdates += 1; }
      }
    });
  }
  return level;
};

const runTerrainCheckScenario = ({ iterations, repeats, kind }) => {
  const mask = makeBenchMask();
  const samples = [];
  let truthy = 0;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const level = makeTerrainLevel({
      steel: kind === 'denseSteel',
      arrows: kind === 'arrow'
    });
    const start = process.hrtime.bigint();
    let hits = 0;
    for (let i = 0; i < iterations; i += 1) {
      const x = 12 + ((i * 13) % 280);
      const y = 10 + ((i * 7) % 130);
      if (kind === 'arrow') {
        if (level.hasArrowUnderMask(mask, x, y, 0)) hits += 1;
      } else if (level.hasSteelUnderMask(mask, x, y)) {
        hits += 1;
      }
    }
    samples.push(nsToMs(process.hrtime.bigint() - start));
    truthy = hits;
  }
  const summary = summarizeSamples(samples.slice(1), iterations);
  summary.truthy = truthy;
  return summary;
};

const runTerrainClearScenario = ({ iterations, repeats, noop = false }) => {
  const mask = makeBenchMask(18, 14, -9, -7);
  const samples = [];
  let metrics = null;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const runtimeStats = {
      historyRecords: 0,
      minimapInvalidations: 0,
      minimapPixelUpdates: 0
    };
    const level = makeTerrainLevel({ runtimeStats });
    if (noop) {
      level.clearGroundWithMaskCount(mask, 80, 60);
    }
    let removed = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) {
      const x = noop ? 80 : 20 + ((i * 19) % 260);
      const y = noop ? 60 : 12 + ((i * 11) % 130);
      removed += level.clearGroundWithMaskCount(mask, x, y);
    }
    samples.push(nsToMs(process.hrtime.bigint() - start));
    metrics = {
      removedPixels: removed,
      historyRecords: runtimeStats.historyRecords,
      minimapInvalidations: runtimeStats.minimapInvalidations,
      minimapPixelUpdates: runtimeStats.minimapPixelUpdates,
      dirtyRectCount: level._groundDirtyRects?.length ?? 0,
      dirtyTileCount: level._groundDirtyTiles?.size ?? 0
    };
  }
  return {
    ...summarizeSamples(samples.slice(1), iterations),
    ...metrics
  };
};

const runDigRowScenario = ({ iterations, repeats }) => {
  const samples = [];
  let metrics = null;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const runtimeStats = {
      historyRecords: 0,
      minimapInvalidations: 0,
      minimapPixelUpdates: 0
    };
    const level = makeTerrainLevel({ runtimeStats });
    const dig = new ActionDiggSystem({ getAnimation() { return null; } });
    const lem = { id: 1, x: 40, y: 40 };
    let removedRows = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) {
      lem.x = 10 + ((i * 7) % 280);
      const y = 8 + ((i * 3) % 140);
      if (dig.digRow(level, lem, y)) removedRows += 1;
    }
    samples.push(nsToMs(process.hrtime.bigint() - start));
    metrics = {
      rowsWithRemoval: removedRows,
      historyRecords: runtimeStats.historyRecords,
      minimapInvalidations: runtimeStats.minimapInvalidations,
      minimapPixelUpdates: runtimeStats.minimapPixelUpdates,
      dirtyRectCount: level._groundDirtyRects?.length ?? 0,
      dirtyTileCount: level._groundDirtyTiles?.size ?? 0
    };
  }
  return {
    ...summarizeSamples(samples.slice(1), iterations),
    ...metrics
  };
};

const runTerrainMaskBench = ({ iterations, clearIterations, digIterations, repeats }) => ({
  noSteelSteelCheck: runTerrainCheckScenario({ iterations, repeats, kind: 'noSteel' }),
  denseSteelCheck: runTerrainCheckScenario({ iterations, repeats, kind: 'denseSteel' }),
  arrowCheck: runTerrainCheckScenario({ iterations, repeats, kind: 'arrow' }),
  clearGroundWithMaskCount: runTerrainClearScenario({ iterations: clearIterations, repeats }),
  repeatedNoopClear: runTerrainClearScenario({ iterations: clearIterations, repeats, noop: true }),
  digRow: runDigRowScenario({ iterations: digIterations, repeats })
});

const makeObjectFrame = (width = 24, height = 18) => {
  const frame = new Frame(width, height);
  frame.fill(20, 160, 80);
  return frame;
};

const runObjectCullingScenario = ({ objectCount, iterations, repeats, fullView = false }) => {
  const frame = makeObjectFrame();
  const samples = [];
  let drawn = 0;
  let candidates = 0;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const manager = new ObjectManager({ getGameTicks() { return 1; } });
    const objects = [];
    for (let i = 0; i < objectCount; i += 1) {
      objects.push({
        x: (i * 37) % 2400,
        y: (i * 17) % 360,
        drawProperties: null,
        animation: {
          frames: [frame],
          getFrame() { return frame; }
        }
      });
    }
    manager.addRange(objects);
    const gameDisplay = {
      stage: {
        getGameViewRect() {
          return fullView ? null : { x: 320, y: 40, w: 640, h: 240 };
        }
      },
      drawFrameFlags() { drawn += 1; }
    };
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) {
      manager.render(gameDisplay);
      candidates += manager._bucketScratch?.length || manager.objects.length;
    }
    samples.push(nsToMs(process.hrtime.bigint() - start));
    manager.dispose();
  }
  const summary = summarizeSamples(samples.slice(1), iterations);
  summary.objects = objectCount;
  summary.drawn = drawn;
  summary.candidatesConsidered = candidates;
  return summary;
};

const runObjectCullingBench = ({ iterations, repeats }) => ({
  viewport100: runObjectCullingScenario({ objectCount: 100, iterations, repeats }),
  viewport1000: runObjectCullingScenario({ objectCount: 1000, iterations, repeats }),
  viewport5000: runObjectCullingScenario({ objectCount: 5000, iterations, repeats }),
  fullBlit1000: runObjectCullingScenario({ objectCount: 1000, iterations, repeats, fullView: true })
});

const makeMiniMapLevel = () => {
  const width = 640;
  const height = 160;
  const mask = { mask: new Uint8Array(width * height) };
  mask.mask.fill(1);
  return {
    width,
    height,
    screenPositionX: 0,
    objects: [],
    groundMask: mask,
    getGroundMaskLayer() {
      return {
        countMaskInRect(x, y, w, h) {
          return ((Math.trunc(x + y + w + h) % 9) + 1);
        }
      };
    }
  };
};

const makeMiniMapGuiDisplay = () => ({
  worldDataSize: { width: 320, height: 40 },
  drawCalls: 0,
  onMouseDown: new EventHandler(),
  onMouseUp: new EventHandler(),
  onMouseMove: new EventHandler(),
  drawFrame() { this.drawCalls += 1; }
});

const runMiniMapScenario = ({ iterations, repeats, mode }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const samples = [];
  let diagnostics = null;
  let drawCalls = 0;
  let subarrayFallbacks = 0;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    const level = makeMiniMapLevel();
    const guiDisplay = makeMiniMapGuiDisplay();
    const runtime = {
      performanceContext: {
        stage: {
          getGameViewRect() {
            return { x: level.screenPositionX, y: 0, w: 160, h: 120 };
          }
        }
      }
    };
    const miniMap = new MiniMap({}, level, guiDisplay, runtime);
    const liveDots = new Uint8Array(512);
    for (let i = 0; i < liveDots.length; i += 2) {
      liveDots[i] = (i * 3) % miniMap.width;
      liveDots[i + 1] = (i * 5) % miniMap.height;
    }
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) {
      if (mode === 'liveDots') {
        const active = 160 + ((i % 32) * 2);
        if (miniMap.setLiveDots.length >= 2) {
          miniMap.setLiveDots(liveDots, active);
        } else {
          subarrayFallbacks += 1;
          miniMap.setLiveDots(liveDots.subarray(0, active));
        }
      } else if (mode === 'deaths') {
        if ((i % 12) === 0) miniMap.addDeath(i % level.width, (i * 3) % level.height);
      } else if (mode === 'viewport') {
        level.screenPositionX = (i * 5) % 400;
      }
      miniMap.render();
    }
    samples.push(nsToMs(process.hrtime.bigint() - start));
    diagnostics = miniMap.getRenderDiagnostics();
    drawCalls = guiDisplay.drawCalls;
    miniMap.dispose();
  }
  const summary = summarizeSamples(samples.slice(1), iterations);
  summary.drawCalls = drawCalls;
  summary.composes = diagnostics?.composes ?? 0;
  summary.reuses = diagnostics?.reuses ?? 0;
  summary.subarrayFallbacks = subarrayFallbacks;
  return summary;
});

const runMiniMapIdleBench = ({ iterations, repeats }) => ({
  pausedIdle: runMiniMapScenario({ iterations, repeats, mode: 'idle' }),
  manyLiveDots: runMiniMapScenario({ iterations, repeats, mode: 'liveDots' }),
  deathDots: runMiniMapScenario({ iterations, repeats, mode: 'deaths' }),
  viewportMovement: runMiniMapScenario({ iterations, repeats, mode: 'viewport' })
});

const runGamepadIdleBench = ({ iterations, repeats }) => {
  const samples = [];
  let polls = 0;
  for (let repeat = 0; repeat < repeats + 1; repeat += 1) {
    let now = 0;
    const rafCallbacks = [];
    let getGamepadsCalls = 0;
    const windowStub = {
      requestAnimationFrame(callback) {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {}
    };
    const navigatorStub = {
      getGamepads() {
        getGamepadsCalls += 1;
        return [];
      }
    };
    const prevPerformance = globalThis.performance;
    globalThis.performance = {
      now() { return now; },
      measure() {}
    };
    const start = process.hrtime.bigint();
    const controller = new GamepadInputController({
      mode: 'gameplay',
      window: windowStub,
      navigator: navigatorStub,
      storage: null
    });
    for (let i = 0; i < iterations; i += 1) {
      now += 16.67;
      const cb = rafCallbacks.shift();
      if (typeof cb === 'function') cb();
    }
    controller.dispose();
    samples.push(nsToMs(process.hrtime.bigint() - start));
    polls = getGamepadsCalls;
    globalThis.performance = prevPerformance;
  }
  const summary = summarizeSamples(samples.slice(1), iterations);
  summary.getGamepadsCalls = polls;
  summary.pollsPerFrame = Number((polls / Math.max(1, iterations)).toFixed(4));
  return summary;
};

const buildHotpathSummary = (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const smokeRequested = args.has('smoke') || process.env.BENCH_SMOKE === '1';
  const repeats = toPositiveInt(args.get('repeats'), smokeRequested ? 4 : 6);
  const dirtyIterations = toPositiveInt(args.get('dirty-iterations'), smokeRequested ? 1500 : 3000);
  const dirtyRectsPerIter = toPositiveInt(args.get('dirty-rects'), smokeRequested ? 6 : 8);
  const tileIterations = toPositiveInt(args.get('tile-iterations'), smokeRequested ? 1200 : 2800);
  const tilePerIter = toPositiveInt(args.get('tile-per-iter'), smokeRequested ? 6 : 10);
  const antsIterations = toPositiveInt(args.get('ants-iterations'), smokeRequested ? 3000 : 6000);
  const guiIterations = toPositiveInt(args.get('gui-iterations'), smokeRequested ? 1000 : 2000);
  const overlayIterations = toPositiveInt(args.get('overlay-iterations'), smokeRequested ? 700 : 1800);
  const scaledIterations = toPositiveInt(args.get('scaled-iterations'), smokeRequested ? 1600 : 3800);
  const midiRouterIterations = toPositiveInt(args.get('midi-router-iterations'), smokeRequested ? 700 : 1600);
  const midiRouterEvents = toPositiveInt(args.get('midi-router-events'), smokeRequested ? 12 : 24);
  const midiSchedulerIterations = toPositiveInt(args.get('midi-scheduler-iterations'), smokeRequested ? 700 : 1600);
  const midiSchedulerNotes = toPositiveInt(args.get('midi-scheduler-notes'), smokeRequested ? 12 : 24);
  const historyTicks = toPositiveInt(args.get('history-ticks'), smokeRequested ? 80 : 180);
  const historySeekWindow = toPositiveInt(args.get('history-seek-window'), smokeRequested ? 24 : 60);
  const terrainIterations = toPositiveInt(args.get('terrain-iterations'), smokeRequested ? 1000 : 2500);
  const terrainClearIterations = toPositiveInt(args.get('terrain-clear-iterations'), smokeRequested ? 180 : 500);
  const terrainDigIterations = toPositiveInt(args.get('terrain-dig-iterations'), smokeRequested ? 220 : 700);
  const objectIterations = toPositiveInt(args.get('object-iterations'), smokeRequested ? 25 : 80);
  const minimapIterations = toPositiveInt(args.get('minimap-iterations'), smokeRequested ? 900 : 2200);
  const gamepadIterations = toPositiveInt(args.get('gamepad-iterations'), smokeRequested ? 360 : 1200);

  return {
    historyReplayDelta: runHistoryReplayBench({
      ticks: historyTicks,
      seekWindow: historySeekWindow,
      repeats
    }),
    terrainMasks: runTerrainMaskBench({
      iterations: terrainIterations,
      clearIterations: terrainClearIterations,
      digIterations: terrainDigIterations,
      repeats
    }),
    dirtyRectUpload: runDirtyRectBench({
      iterations: dirtyIterations,
      rectsPerIter: dirtyRectsPerIter,
      repeats
    }),
    tileComposition: runTileCompositionBench({
      iterations: tileIterations,
      tilesPerIter: tilePerIter,
      repeats
    }),
    marchingAnts: runMarchingAntBench({
      iterations: antsIterations,
      repeats
    }),
    guiOverlay: runGuiOverlayBench({
      iterations: guiIterations,
      repeats
    }),
    overlayPlane: runOverlayPlaneBench({
      iterations: overlayIterations,
      repeats
    }),
    scaledBlit: runScaledBlitBench({
      iterations: scaledIterations,
      repeats
    }),
    objectCulling: runObjectCullingBench({
      iterations: objectIterations,
      repeats
    }),
    minimapIdle: runMiniMapIdleBench({
      iterations: minimapIterations,
      repeats
    }),
    gamepadIdle: runGamepadIdleBench({
      iterations: gamepadIterations,
      repeats
    }),
    midiRouter: runMidiRouterBench({
      iterations: midiRouterIterations,
      eventsPerIter: midiRouterEvents,
      repeats
    }),
    midiScheduler: runMidiSchedulerBench({
      iterations: midiSchedulerIterations,
      notesPerIter: midiSchedulerNotes,
      repeats
    })
  };
};

const main = (argv = process.argv.slice(2)) => {
  const summary = buildHotpathSummary(argv);
  console.log(JSON.stringify(summary, null, 2));
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}

export { buildHotpathSummary };
