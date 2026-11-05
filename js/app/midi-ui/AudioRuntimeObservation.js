// @ts-check
import { audioRuntimeSinkMatches } from './AudioRuntimeConfig.js';
/** @typedef {import('./AudioRuntimeContracts.js').AudioPlaybackMetrics} AudioPlaybackMetrics */
/** @typedef {import('./AudioRuntimeContracts.js').AudioRuntimeSnapshot} AudioRuntimeSnapshot */
/** @type {ReadonlyArray<keyof AudioPlaybackMetrics>} */
const fields = ['underrunDuration', 'underrunEvents', 'totalDuration', 'averageLatency', 'minimumLatency', 'maximumLatency'];
/** @param {unknown} value @returns {number | null} */
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
/** @param {unknown} target @param {string} name @returns {unknown} */
const property = (target, name) => { try { return Reflect.get(Object(target), name); } catch { return undefined; } };
/** @param {object} stats @returns {AudioPlaybackMetrics | null} */
const copyStats = stats => {
  const underrunDuration = number(property(stats, 'underrunDuration')), underrunEvents = number(property(stats, 'underrunEvents')),
    totalDuration = number(property(stats, 'totalDuration')), averageLatency = number(property(stats, 'averageLatency')),
    minimumLatency = number(property(stats, 'minimumLatency')), maximumLatency = number(property(stats, 'maximumLatency'));
  if (underrunDuration === null || underrunEvents === null || totalDuration === null || averageLatency === null || minimumLatency === null || maximumLatency === null ||
      !Number.isSafeInteger(underrunEvents) || underrunEvents > 0xffffffff || underrunDuration > totalDuration + 1e-9 ||
      minimumLatency > averageLatency + 1e-9 || averageLatency > maximumLatency + 1e-9) return null;
  return Object.freeze({ underrunDuration, underrunEvents, totalDuration, averageLatency, minimumLatency, maximumLatency });
};
/** @param {import('./AudioRuntimeContracts.js').AudioRuntimeObserverOptions} [options] @returns {import('./AudioRuntimeContracts.js').AudioRuntimeObserver} */
export function createAudioRuntimeObservation({ nowMs = () => globalThis.performance?.now?.() ?? Date.now(), document = globalThis.document } = {}) {
  /** @type {import('./AudioRuntimeContracts.js').AudioRuntimeContext | null} */
  let context = null;
  /** @type {unknown} */
  let statsObject = null;
  /** @type {AudioPlaybackMetrics | null} */
  let metrics = null, previous = null;
  let epoch = 0, series = 0, routeRevision = 0, latencyRevision = 0, sampledLatencyRevision = 0;
  /** @type {import('./AudioRuntimeContracts.js').AudioStatsAvailability} */
  let status = 'not-observed';
  /** @type {AudioRuntimeSnapshot | null} */
  let cached = null;
  /** @type {number | null} */
  let sampledAt = null, changedAt = null;
  let lastRead = -Infinity, lastRefresh = -Infinity, dirty = true, disposed = false, documentListening = false, lastState = null, lastVisibility = null;
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
      const reportedState = property(context, 'state'), state = typeof reportedState === 'string' ? reportedState : 'not-created', visibility = document?.visibilityState === 'visible' ? 'visible' : 'unknown-or-hidden';
      const due = validHost && (host < lastRefresh || host - lastRefresh >= 1000), statsDue = validHost && host >= lastRead && host - lastRead >= 1000;
      if (!dirty && !due && validHost && state === lastState && visibility === lastVisibility) return cached;
      lastState = state; lastVisibility = visibility; dirty = false; if (validHost) lastRefresh = host;
      let availability = status;
      /** @type {import('./AudioRuntimeContracts.js').AudioStatsFreshness} */
      let freshness = 'not-observed';
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
          preferenceObserved: audioRuntimeSinkMatches(sink, config.sinkPreference) }),
        playbackStats: Object.freeze({ availability, freshness, sampledAtHostMs: sampledAt, lastChangedAtHostMs: changedAt, minimumCollectionIntervalMs: 1000, latencyRevision, metricsLatencyRevision: sampledLatencyRevision, latencyIntervalPending: sampledLatencyRevision !== latencyRevision,
          cumulativeScope: 'context-lifetime-not-route-or-latency-reset', units: 'seconds-except-underrun-event-count', metrics, hasReportedPlaybackDuration: metrics ? metrics.totalDuration > 0 : null, browserTimestampAvailable: false,
          interpretation: 'digital-playback-path-not-application-only-glitches-or-acoustic-latency' }) });
      return cached;
    },
    resetLatency() {
      const reset = property(statsObject, 'resetLatency');
      if (disposed || !context || typeof reset !== 'function') return false;
      try { Reflect.apply(reset, statsObject, []); } catch { return false; }
      latencyRevision++; dirty = true; return true;
    },
    dispose() { if (disposed) return; disposed = true; detach(); if (documentListening) document?.removeEventListener?.('visibilitychange', invalidate); context = statsObject = previous = metrics = null; cached = null; }
  });
}
