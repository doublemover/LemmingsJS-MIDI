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
export {
  makeBenchMask,
  makeTerrainLevel,
  runTerrainCheckScenario,
  runTerrainClearScenario,
  runDigRowScenario,
  runTerrainMaskBench
};