export function installBrowserWorkObservation(scope = globalThis) {
  const key = '__LEMMINGS_BENCH_OBSERVATION__';
  scope[key]?.dispose();
  if (typeof scope.performance?.now !== 'function' || typeof scope.PerformanceObserver !== 'function' ||
      typeof scope.requestAnimationFrame !== 'function' || typeof scope.__E2E__?.getState !== 'function') {
    throw new Error('Completed-work observation requires browser clocks, frames and performance measures.');
  }
  const maximumValues = 16384;
  let frameGapsMs = [], tickExecutionMs = [], renderExecutionMs = [], overflow = false, disposed = false;
  let frameId = null, previousFrame = null;
  const append = (values, value) => {
    if (!Number.isFinite(value) || value < 0 || values.length >= maximumValues) overflow = true;
    else values.push(value);
  };
  const measures = entries => {
    for (const entry of entries) {
      if (entry.name === 'Game runGameLogic') append(tickExecutionMs, entry.duration);
      else if (entry.name === 'GameDisplay render') append(renderExecutionMs, entry.duration);
    }
  };
  const observer = new scope.PerformanceObserver(list => measures(list.getEntries()));
  observer.observe({ type: 'measure', buffered: false });
  const frame = timestamp => {
    if (disposed) return;
    if (previousFrame != null) append(frameGapsMs, timestamp - previousFrame);
    previousFrame = timestamp;
    frameId = scope.requestAnimationFrame(frame);
  };
  const snapshot = () => {
    const state = scope.__E2E__.getState(), game = state?.game, timer = game?.timer;
    const metrics = scope.__E2E__.getBenchMetrics?.();
    return { observedAtMs: scope.performance.now(), tick: timer?.tickIndex, running: timer?.running === true,
      ready: state?.ready === true, activeActors: game?.lemmingManager?.activeCount,
      entrances: game?.level?.entrances?.length, reverse: game?.timeTravel?.isReversing === true,
      targetFrameMs: timer?.frameTime, targetTps: timer?.tps, speedFactor: timer?.speedFactor,
      maxTicksPerFrame: timer?.maxTicksPerFrame, pendingCatchupTicks: timer?.pendingCatchupTicks,
      bench: { active: metrics?.active === true, mode: metrics?.mode, benchMaxSpeed: metrics?.benchMaxSpeed } };
  };
  let previous = snapshot();
  frameId = scope.requestAnimationFrame(frame);
  const api = {
    sample() {
      if (disposed) throw new Error('Completed-work observation is disposed.');
      measures(observer.takeRecords());
      const current = snapshot(), elapsedMs = current.observedAtMs - previous.observedAtMs;
      const completedTicks = (current.tick - previous.tick) * (current.reverse ? -1 : 1);
      const sample = { ...current, startTick: previous.tick, completedTicks, measurementElapsedMs: elapsedMs,
        tps: completedTicks * 1000 / elapsedMs, frameGapsMs, tickExecutionMs, renderExecutionMs,
        overflow, continuousDirection: previous.reverse === current.reverse };
      previous = current;
      frameGapsMs = []; tickExecutionMs = []; renderExecutionMs = []; overflow = false;
      return sample;
    },
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect();
      if (frameId != null) scope.cancelAnimationFrame(frameId);
      frameGapsMs = []; tickExecutionMs = []; renderExecutionMs = [];
      if (scope[key] === api) delete scope[key];
    }
  };
  scope[key] = api;
  return { startedAtMs: previous.observedAtMs };
}
