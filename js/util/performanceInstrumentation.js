const DEFAULT_MEASURE_RETENTION = 120;
const measureCounts = new Map();

const getPerformanceRef = (performanceRef = null) => (
  performanceRef || (typeof performance !== 'undefined' ? performance : null)
);

const canMeasurePerformance = (performanceRef = null) => {
  const perf = getPerformanceRef(performanceRef);
  return typeof perf?.now === 'function' && typeof perf?.measure === 'function';
};

const normalizeRetention = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MEASURE_RETENTION;
  return Math.max(0, Math.trunc(numeric));
};

const recordPerformanceMeasure = (
  name,
  measureOptions = {},
  { performanceRef = null, retention = DEFAULT_MEASURE_RETENTION } = {}
) => {
  const perf = getPerformanceRef(performanceRef);
  if (typeof perf?.measure !== 'function') return false;
  try {
    perf.measure(name, measureOptions);
    const keep = normalizeRetention(retention);
    if (keep > 0 && typeof perf.clearMeasures === 'function') {
      const count = (measureCounts.get(name) || 0) + 1;
      if (count >= keep) {
        perf.clearMeasures(name);
        measureCounts.set(name, 0);
      } else {
        measureCounts.set(name, count);
      }
    }
    return true;
  } catch {
    return false;
  }
};

const resetPerformanceMeasureCounts = () => {
  measureCounts.clear();
};

export {
  canMeasurePerformance,
  recordPerformanceMeasure,
  resetPerformanceMeasureCounts
};
