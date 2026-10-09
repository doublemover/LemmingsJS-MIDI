const MAX_PROCGEN_WORKERS = 16;
const DEFAULT_PROCGEN_WORKER_LIMITS = Object.freeze({ bashers: 4, diggers: 4, builders: 8 });
const normalizeWorkerLimits = (next = {}, current = DEFAULT_PROCGEN_WORKER_LIMITS) => {
  const result = {};
  for (const kind of Object.keys(DEFAULT_PROCGEN_WORKER_LIMITS)) {
    const value = Number(next[kind] ?? current[kind]);
    result[kind] = Number.isFinite(value) ? Math.max(0, Math.min(MAX_PROCGEN_WORKERS, Math.trunc(value))) : current[kind];
  }
  return result;
};
export { MAX_PROCGEN_WORKERS, DEFAULT_PROCGEN_WORKER_LIMITS, normalizeWorkerLimits };
