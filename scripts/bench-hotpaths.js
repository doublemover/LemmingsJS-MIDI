import { DisplayImage } from '../js/render/DisplayImage.js';
import { Stage } from '../js/render/Stage.js';
import { GameGui } from '../js/game/GameGui.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { EventHandler } from '../js/util/EventHandler.js';
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

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : fallback;
};

const nsToMs = (value) => Number(value) / 1e6;

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
    .map((value) => Number(value))
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

  return {
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
