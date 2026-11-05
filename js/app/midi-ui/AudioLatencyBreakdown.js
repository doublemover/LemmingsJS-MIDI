// @ts-check
/** @param {unknown} value @returns {number | null} */
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** @param {import('./AudioRuntimeContracts.js').AudioLatencyBreakdownInput} input @returns {import('./AudioRuntimeContracts.js').AudioLatencyBreakdown} */
export function createAudioLatencyBreakdown({ observation, observedAtHostMs, tickDurationMs, speed, paused, physical, masterLookaheadMs }) {
  const host = duration(observedAtHostMs), tick = duration(tickDurationMs), factor = duration(speed);
  const quantization = tick !== null && tick > 0 && factor !== null && factor > 0 ? duration(tick / factor) : null;
  const running = observation?.contextState === 'running', visible = observation?.visibility === 'visible';
  const sameContext = !!observation && physical?.contextEpoch === observation.contextEpoch;
  const correlation = sameContext && running && visible ? physical?.correlation : null;
  const stamp = duration(correlation?.presentationMs), uncertainty = duration(correlation?.uncertaintyMs);
  const age = host !== null && stamp !== null && stamp <= host ? host - stamp : null;
  const correlated = age !== null && age <= 2000 && uncertainty !== null;
  const effects = sameContext ? physical?.effects : null;
  const frames = effects?.unresolved ? null : duration(effects?.latencyFrames), sampleRate = duration(physical?.sampleRate);
  const effectMs = frames !== null && sampleRate !== null && sampleRate > 0 ? duration(frames * 1000 / sampleRate) : null;
  return Object.freeze({ schema: 'lemmings-audio-latency-breakdown/v1', observedAtHostMs: host,
    contextEpoch: observation?.contextEpoch ?? null, estimatesAreAdditive: false, acousticMeasurement: false,
    simulation: Object.freeze({ quantizationMs: quantization, state: paused ? 'paused' : quantization === null ? 'unavailable' : 'advancing', scope: 'configured-tick-upper-bound-not-observed-scheduling-delay' }),
    queue: Object.freeze({ configuredLeadMs: duration(physical?.presentationDelayMs), scope: 'physical-browser-audio-presentation-hold-not-midi-clock-lookahead' }),
    dsp: Object.freeze({ masterLookaheadMs: duration(masterLookaheadMs), effectLatencyMs: effectMs,
      effectState: !effects || effectMs === null ? 'unknown' : effects.routes === 0 ? 'no-effect-route' : 'declared', retainedEffectRoutes: effects?.routes ?? null,
      scope: 'declared-parallel-effect-path-maximum-not-measured-dsp-or-total' }),
    correlation: Object.freeze({ freshness: !running ? 'context-not-running' : !visible ? 'hidden-or-unknown' : !sameContext ? 'context-changed-or-unavailable' : !correlation ? 'unavailable' : correlated ? 'available' : 'stale-or-invalid',
      method: correlated ? correlation?.method ?? null : null, ageMs: correlated ? age : null, uncertaintyMs: correlated ? uncertainty : null }) });
}
