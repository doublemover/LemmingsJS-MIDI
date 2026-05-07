import {
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
} from './shared.js';
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
export {
  makeMiniMapLevel,
  makeMiniMapGuiDisplay,
  runMiniMapScenario,
  runMiniMapIdleBench,
  runGamepadIdleBench
};