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
export {
  makeObjectFrame,
  runObjectCullingScenario,
  runObjectCullingBench
};