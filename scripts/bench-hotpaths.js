import {
  fileURLToPath,
  parseArgs,
  path,
  toPositiveInt
} from './bench-hotpaths/shared.js';
import {
  runDirtyRectBench,
  runTileCompositionBench,
  runMarchingAntBench,
  runGuiOverlayBench,
  runOverlayPlaneBench,
  runScaledBlitBench
} from './bench-hotpaths/renderScenarios.js';
import {
  runMidiRouterBench,
  runMidiSchedulerBench
} from './bench-hotpaths/midiScenarios.js';
import {
  runHistoryScenario,
  runHistoryReplayBench
} from './bench-hotpaths/historyScenarios.js';
import {
  runTerrainCheckScenario,
  runTerrainClearScenario,
  runDigRowScenario,
  runTerrainMaskBench
} from './bench-hotpaths/terrainScenarios.js';
import {
  runObjectCullingScenario,
  runObjectCullingBench
} from './bench-hotpaths/objectScenarios.js';
import {
  runMiniMapScenario,
  runMiniMapIdleBench,
  runGamepadIdleBench
} from './bench-hotpaths/idleScenarios.js';
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