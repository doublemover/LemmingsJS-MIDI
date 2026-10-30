export function installProcgenSoakProbe({ scope = globalThis, capacity = 4096, now = () => scope.performance.now() } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 16 || capacity > 16384) throw new RangeError('Invalid soak observation capacity.');
  const studio = scope.__PROCGEN_STUDIO__, lanes = scope.__PROCGEN_LANES__, world = lanes?.world, renderer = lanes?.renderer;
  if (!world?.workstationEnabled || typeof world.step !== 'function' || typeof renderer?.render !== 'function' || typeof studio?.play !== 'function') throw new Error('The actual ProcGen workstation adapter is unavailable.');
  const generation = world.generation, step = world.step, render = renderer.render, streams = {};
  for (const kind of ['step', 'render', 'raf', 'longTask']) streams[kind] = { values: new Float64Array(capacity), count: 0, sum: 0, maximum: 0 };
  let closed = false, completedTicks = 0, failedSteps = 0, frame = null, previousFrame = null, observer = null, baseline = null;
  const check = () => {
    if (closed || scope.__PROCGEN_STUDIO__ !== studio || scope.__PROCGEN_LANES__ !== lanes || lanes.world !== world || world.generation !== generation || !Number.isSafeInteger(world.tickIndex) || world.tickIndex < baseline.tick)
      throw new Error('ProcGen soak ownership changed; observations are not comparable.');
  };
  const add = (kind, value) => { if (!Number.isFinite(value) || value < 0) throw new Error('Invalid completed-work observation.'); const stream = streams[kind]; stream.values[stream.count++ % capacity] = value; stream.sum += value; stream.maximum = Math.max(stream.maximum, value); };
  const snapshot = () => ({ tick: world.tickIndex, generation, activeCount: world.activeCount, totalCount: world.actors.length, spawnTotal: world.spawnedTotal,
    observationTime: now(), memory: scope.performance.memory ? { usedJSHeapSize: scope.performance.memory.usedJSHeapSize,
      totalJSHeapSize: scope.performance.memory.totalJSHeapSize, jsHeapSizeLimit: scope.performance.memory.jsHeapSizeLimit } : null });
  baseline = snapshot();
  const measuredStep = function(...args) {
    if (closed) return step.apply(this, args);
    const before = now(), tick = world.tickIndex;
    try { const value = step.apply(this, args); const delta = world.tickIndex - tick; if (delta !== 1) throw new Error('A completed physical step must advance exactly one tick.'); completedTicks++; return value; }
    catch (error) { failedSteps++; throw error; }
    finally { add('step', now() - before); }
  };
  const measuredRender = function(...args) { if (closed) return render.apply(this, args); const before = now(); try { return render.apply(this, args); } finally { add('render', now() - before); } };
  const observeFrame = stamp => { if (closed) return; if (previousFrame !== null) add('raf', stamp - previousFrame); previousFrame = stamp; frame = scope.requestAnimationFrame(observeFrame); };
  world.step = measuredStep; renderer.render = measuredRender;
  try {
    frame = scope.requestAnimationFrame(observeFrame);
    if (scope.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      observer = new scope.PerformanceObserver(list => { for (const entry of list.getEntries()) if (!closed && (entry.startTime ?? baseline.observationTime) >= baseline.observationTime) add('longTask', entry.duration); }); observer.observe({ type: 'longtask' });
    }
  } catch (error) { world.step = step; renderer.render = render; if (frame !== null) scope.cancelAnimationFrame(frame); observer?.disconnect(); throw error; }
  const distribution = stream => {
    const retained = Math.min(capacity, stream.count), sorted = Array.from(stream.values.subarray(0, retained)).sort((a, b) => a - b);
    const percentile = fraction => retained ? sorted[Math.min(retained - 1, Math.floor((retained - 1) * fraction))] : null;
    return { samples: stream.count, retainedSamples: retained, overwritten: Math.max(0, stream.count - retained), p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
      maximum: stream.count ? stream.maximum : null, mean: stream.count ? stream.sum / stream.count : null, percentileScope: stream.count > capacity ? 'last-bounded-window' : 'all-observations' };
  };
  const dispose = () => { if (closed) return; closed = true; if (world.step === measuredStep) world.step = step; if (renderer.render === measuredRender) renderer.render = render;
    if (frame !== null) scope.cancelAnimationFrame(frame); observer?.disconnect(); };
  return Object.freeze({ sample() { check(); return { ...snapshot(), completedTicks, failedSteps, observedStepCalls: streams.step.count, renderCalls: streams.render.count, rafIntervals: streams.raf.count, longTasks: streams.longTask.count }; },
    resetWindow() { check(); baseline = snapshot(); completedTicks = failedSteps = 0; previousFrame = null; for (const stream of Object.values(streams)) { stream.values.fill(0); stream.count = stream.sum = stream.maximum = 0; } },
    report() { check(); const end = snapshot(); return { schema: 'procgen-completed-work-probe/v1', capacity, baseline, end, completedTicks, failedSteps,
      worldTickDelta: end.tick - baseline.tick, observedStepCalls: streams.step.count, clock: 'browser-performance-now',
      stepMs: distribution(streams.step), renderMs: distribution(streams.render), rafIntervalMs: distribution(streams.raf), longTaskMs: distribution(streams.longTask),
      scope: 'actual-completed-world-step-and-all-render-call-durations;RAF-gaps-are-observed;percentiles-use-explicit-bounded-window;no-input-or-audio-latency-claim' }; }, dispose });
}
