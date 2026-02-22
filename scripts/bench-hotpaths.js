import { GameTimer } from '../js/game/GameTimer.js';
import { HistoryStore } from '../js/game/HistoryStore.js';

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
  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(nsToMs(process.hrtime.bigint() - start));
  }
  const total = samples.reduce((acc, value) => acc + value, 0);
  return {
    samplesMs: samples.map((value) => Number(value.toFixed(2))),
    avgMs: total / samples.length
  };
};

const setupTimerEnvironment = (measureEnabled) => {
  let now = 0;
  const listeners = new Map();
  globalThis.performance = {
    now: () => now,
    measure: measureEnabled ? () => {} : undefined
  };
  globalThis.document = {
    visibilityState: 'visible',
    hasFocus() { return true; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  globalThis.window = {
    requestAnimationFrame(cb) {
      globalThis.window._raf = cb;
      return 1;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.lemmings = {
    bench2: true,
    endless: false,
    performanceAPI: measureEnabled,
    perfMetrics: measureEnabled,
    logBenchCatchup: false
  };
  return {
    advance(ms) {
      now += ms;
      globalThis.window._raf(now);
    }
  };
};

const runTimerBench = ({ frames, frameStepMs, repeats }) => withGlobalStubs(() => {
  const run = (measureEnabled) => {
    const samples = measureN(repeats + 1, () => {
      const env = setupTimerEnvironment(measureEnabled);
      const timer = new GameTimer({ timeLimit: 1 });
      timer.continue();
      for (let i = 0; i < frames; i += 1) {
        env.advance(frameStepMs);
      }
      timer.stop();
    });
    const trimmed = samples.samplesMs.slice(1);
    const avg = trimmed.reduce((acc, value) => acc + value, 0) / Math.max(trimmed.length, 1);
    return {
      samplesMs: trimmed,
      avgMs: Number(avg.toFixed(2)),
      msPerFrame: Number((avg / frames).toFixed(6))
    };
  };
  return {
    noPerfMeasure: run(false),
    perfMeasure: run(true)
  };
});

const runHistoryBench = ({ deltas, boundedLoops, wideLoops, boundedBudget, wideBudget }) => {
  const seed = (history, count) => {
    for (let i = 0; i < count; i += 1) {
      history._setDelta(i, history._allocDelta(i));
    }
  };
  const run = (budget, loops) => {
    const history = new HistoryStore({
      deltaBlockSizeTicks: 1,
      coldBlockAgeTicks: 1,
      coldCompactionIntervalTicks: 1,
      coldCompactionMaxBlocksPerSweep: budget,
      enableColdBlockCompression: true
    });
    seed(history, deltas);
    const result = measureN(1, () => {
      for (let i = 0; i < loops; i += 1) {
        history._maybeCompactDeltaBlocks();
      }
    });
    const totalMs = result.avgMs;
    return {
      budget,
      loops,
      totalMs: Number(totalMs.toFixed(2)),
      msPerSweep: Number((totalMs / loops).toFixed(6)),
      coldBlocks: history._coldBlockCount
    };
  };
  return {
    bounded: run(boundedBudget, boundedLoops),
    wide: run(wideBudget, wideLoops)
  };
};

const args = parseArgs(process.argv.slice(2));
const frames = toPositiveInt(args.get('frames'), 300000);
const frameStepMs = toPositiveInt(args.get('step'), 120);
const repeats = toPositiveInt(args.get('repeats'), 5);
const deltas = toPositiveInt(args.get('history-deltas'), 5000);
const boundedLoops = toPositiveInt(args.get('history-bounded-loops'), 10000);
const wideLoops = toPositiveInt(args.get('history-wide-loops'), 100);
const boundedBudget = toPositiveInt(args.get('history-bounded-budget'), 4);
const wideBudget = toPositiveInt(args.get('history-wide-budget'), 100000);

const summary = {
  timer: runTimerBench({ frames, frameStepMs, repeats }),
  history: runHistoryBench({
    deltas,
    boundedLoops,
    wideLoops,
    boundedBudget,
    wideBudget
  })
};

console.log(JSON.stringify(summary, null, 2));
