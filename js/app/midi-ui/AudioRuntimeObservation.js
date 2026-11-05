const fields = ['underrunDuration', 'underrunEvents', 'totalDuration', 'averageLatency', 'minimumLatency', 'maximumLatency'];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const property = (target, name) => { try { return target?.[name]; } catch { return undefined; } };
const copyStats = stats => {
  const result = Object.fromEntries(fields.map(key => [key, property(stats, key)]));
  if (fields.some(key => number(result[key]) === null) || !Number.isSafeInteger(result.underrunEvents) || result.underrunEvents > 0xffffffff ||
      result.underrunDuration > result.totalDuration + 1e-9 || result.minimumLatency > result.averageLatency + 1e-9 || result.averageLatency > result.maximumLatency + 1e-9) return null;
  return Object.freeze(result);
};
export function createAudioRuntimeObservation({ nowMs = () => globalThis.performance?.now?.() ?? Date.now(), document = globalThis.document } = {}) {
  let context = null, epoch = 0, series = 0, routeRevision = 0, latencyRevision = 0, sampledLatencyRevision = 0, statsObject = null, metrics = null, previous = null;
  let lastRead = -Infinity, lastRefresh = -Infinity, status = 'not-observed', sampledAt = null, changedAt = null, dirty = true, disposed = false, documentListening = false, cached = null, lastState = null, lastVisibility = null;
  const invalidate = () => { dirty = true; };
  const routeChanged = () => { routeRevision++; series++; previous = null; metrics = null; statsObject = null; changedAt = null; status = 'not-observed'; dirty = true; };
  const detach = () => { context?.removeEventListener?.('statechange', invalidate); context?.removeEventListener?.('sinkchange', routeChanged); };
  return Object.freeze({
    read(next, nextEpoch, config) {
      if (disposed) return cached;
      if (!documentListening) { document?.addEventListener?.('visibilitychange', invalidate); documentListening = true; }
      if (next !== context || nextEpoch !== epoch) {
        detach(); context = next; epoch = nextEpoch; series++; routeRevision = 0; latencyRevision = sampledLatencyRevision = 0; metrics = previous = statsObject = null;
        lastRead = lastRefresh = -Infinity; sampledAt = changedAt = cached = null; status = 'not-observed'; dirty = true;
        context?.addEventListener?.('statechange', invalidate); context?.addEventListener?.('sinkchange', routeChanged);
      }
      const host = nowMs(), validHost = typeof host === 'number' && Number.isFinite(host) && host >= 0;
      const state = property(context, 'state') || 'not-created', visibility = document?.visibilityState === 'visible' ? 'visible' : 'unknown-or-hidden';
      const due = validHost && (host < lastRefresh || host - lastRefresh >= 1000), statsDue = validHost && host >= lastRead && host - lastRead >= 1000;
      if (!dirty && !due && validHost && state === lastState && visibility === lastVisibility) return cached;
      lastState = state; lastVisibility = visibility; dirty = false; if (validHost) lastRefresh = host;
      let availability = status, freshness = 'not-observed';
      if (!context) availability = 'no-context';
      else if (state !== 'running') freshness = 'stale-context-not-running';
      else if (visibility !== 'visible') freshness = 'stale-hidden-or-unknown';
      else if (!validHost) freshness = 'invalid-observation-clock';
      else if (host < lastRead) freshness = 'stale-observation-clock-regressed';
      else if (statsDue) {
        lastRead = host; sampledAt = host;
        const stats = property(context, 'playbackStats');
        if (!stats || typeof stats !== 'object') { availability = 'unavailable'; metrics = previous = statsObject = null; }
        else {
          const observed = copyStats(stats); availability = observed ? 'available' : 'invalid';
          if (observed) {
            const replaced = statsObject && stats !== statsObject, reset = previous && ['underrunDuration', 'underrunEvents', 'totalDuration'].some(key => observed[key] < previous[key]);
            if (replaced || reset) { series++; previous = null; changedAt = null; }
            const changed = !previous || fields.some(key => observed[key] !== previous[key]);
            if (changed) changedAt = host;
            freshness = changed ? 'observed-no-browser-timestamp' : 'unchanged-no-browser-timestamp';
            metrics = previous = observed; statsObject = stats; sampledLatencyRevision = latencyRevision;
          } else { metrics = null; statsObject = null; }
        }
      } else freshness = 'waiting-collection-interval';
      status = availability;
      const sink = property(context, 'sinkId'), baseLatency = number(property(context, 'baseLatency')), outputLatency = number(property(context, 'outputLatency'));
      cached = Object.freeze({ schema: 'lemmings-audio-runtime-observation/v1', contextEpoch: epoch, series, routeRevision, latencyRevision,
        config: Object.freeze({ latencyProfile: config.latencyProfile, preferredSampleRate: config.preferredSampleRate, sinkPreference: config.sinkPreference ? 'explicit-device' : 'default' }),
        actualSampleRate: number(property(context, 'sampleRate')), contextState: state, visibility,
        baseLatencySeconds: baseLatency, outputLatencySeconds: outputLatency, estimatesAreAdditive: false, acousticMeasurement: false,
        outputSelection: Object.freeze({ setSinkIdAvailable: typeof property(context, 'setSinkId') === 'function', actualSink: typeof sink === 'string' ? sink ? 'explicit-device' : 'default' : property(sink, 'type') === 'none' ? 'silent' : 'unknown',
          preferenceObserved: typeof sink === 'string' ? sink === config.sinkPreference : null }),
        playbackStats: Object.freeze({ availability, freshness, sampledAtHostMs: sampledAt, lastChangedAtHostMs: changedAt, minimumCollectionIntervalMs: 1000, latencyRevision, metricsLatencyRevision: sampledLatencyRevision, latencyIntervalPending: sampledLatencyRevision !== latencyRevision,
          cumulativeScope: 'context-lifetime-not-route-or-latency-reset', units: 'seconds-except-underrun-event-count', metrics, hasReportedPlaybackDuration: metrics ? metrics.totalDuration > 0 : null, browserTimestampAvailable: false,
          interpretation: 'digital-playback-path-not-application-only-glitches-or-acoustic-latency' }) });
      return cached;
    },
    resetLatency() {
      if (disposed || !context || typeof property(statsObject, 'resetLatency') !== 'function') return false;
      try { statsObject.resetLatency(); } catch { return false; }
      latencyRevision++; dirty = true; return true;
    },
    dispose() { if (disposed) return; disposed = true; detach(); if (documentListening) document?.removeEventListener?.('visibilitychange', invalidate); context = statsObject = previous = metrics = null; cached = null; }
  });
}
