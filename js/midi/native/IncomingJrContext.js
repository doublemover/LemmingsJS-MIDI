const PERIOD = 65536, TICK_US = 32, MAXIMUM_CLOCK_AGE_US = 500000, MAXIMUM_CONTEXT_DISTANCE_TICKS = 7813;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const nearestDelta = (value, anchor) => (value - anchor + PERIOD + PERIOD / 2) % PERIOD - PERIOD / 2;

export function createIncomingJrContext({ configured = null, evidence = 'unknown' } = {}) {
  let epoch = 1, clock = null, stamp = null, lastArrivalUs = null, resets = 0, reason = 'not-observed';
  const offsets = [];
  const reset = why => { clock = stamp = null; offsets.length = 0; lastArrivalUs = null; epoch++; resets++; reason = why; };
  const summary = () => Object.freeze({ epoch, configured, evidence, reason, resets, clock16: clock?.raw ?? null, timestamp16: stamp?.raw ?? null });
  return Object.freeze({
    configure(enabled, source) {
      if (enabled !== null && typeof enabled !== 'boolean' || typeof source !== 'string' || source.length > 128) throw new Error('Invalid incoming JR policy');
      if (configured !== enabled || evidence !== source) { configured = enabled; evidence = source; reset('incoming-jr-configuration-changed'); }
    },
    reset,
    observe(packet, arrivalMonoUs) {
      if (!safe(arrivalMonoUs)) { reset('invalid-native-arrival'); return Object.freeze({ ...summary(), status: 'unknown', sourceTimeUs: null }); }
      if (lastArrivalUs != null && arrivalMonoUs < lastArrivalUs) reset('native-arrival-regressed');
      lastArrivalUs = arrivalMonoUs;
      const utility = packet.kind === 'utility', isClock = utility && packet.status === 'jrClock', isStamp = utility && packet.status === 'jrTimestamp';
      if (clock && arrivalMonoUs - clock.arrivalUs > MAXIMUM_CLOCK_AGE_US) { reset('jr-clock-context-expired'); lastArrivalUs = arrivalMonoUs; }
      if (isClock) {
        const delta = clock ? (packet.data - clock.raw + PERIOD) % PERIOD : 0;
        if (clock && delta > PERIOD / 2) { reset('jr-clock-regressed-or-wrap-ambiguous'); lastArrivalUs = arrivalMonoUs; }
        const tick = clock ? clock.tick + delta : packet.data;
        clock = { raw: packet.data, tick, arrivalUs: arrivalMonoUs };
        offsets.push(arrivalMonoUs - tick * TICK_US); if (offsets.length > 8) offsets.shift();
        reason = configured === true ? 'jr-clock-observed' : configured === false ? 'jr-not-enabled-by-endpoint' : 'jr-configuration-unknown';
      } else if (isStamp) {
        const tick = clock ? clock.tick + nearestDelta(packet.data, clock.raw) : null;
        const close = tick != null && Math.abs(tick - clock.tick) <= MAXIMUM_CONTEXT_DISTANCE_TICKS;
        const ordered = stamp?.tick == null || tick != null && tick >= stamp.tick;
        const usable = configured === true && close && ordered;
        stamp = { raw: packet.data, tick: usable ? tick : null, sequence: (stamp?.sequence || 0) + 1, usable };
        reason = !clock ? 'timestamp-without-jr-clock' : configured !== true ? 'jr-not-negotiated' : !close ? 'timestamp-outside-bounded-reconstruction-window' : !ordered ? 'jr-timestamp-order-regressed' : 'bounded-sender-time-reconstructed';
      }
      if (!isClock && !isStamp && !clock && !stamp) return null;
      const usable = configured === true && !!clock && !!stamp?.usable && stamp.tick != null;
      const low = offsets.length ? Math.min(...offsets) : null, high = offsets.length ? Math.max(...offsets) : null;
      return Object.freeze({ ...summary(), status: isClock ? 'clock-observation' : usable ? 'bounded-reconstruction' : 'unknown', tickNanoseconds: 32000,
        sourceDomain: 'endpoint-jr-sender-clock', sourceEpoch: epoch, sourceTimeUs: usable ? stamp.tick * TICK_US : null,
        timestampSequence: stamp?.sequence ?? null, clockAgeUs: clock ? arrivalMonoUs - clock.arrivalUs : null,
        nativeEstimateUs: usable ? stamp.tick * TICK_US + low : null, nativeEstimateDomain: 'companion-steady-microseconds',
        observedJitterRangeUs: low == null ? null : high - low + TICK_US, absoluteMappingUncertaintyUs: null, oneWayTransportDelay: 'unknown',
        reconstructionWindowTicks: MAXIMUM_CONTEXT_DISTANCE_TICKS, claim: 'read-only-bounded-JR-context-not-qualified-render-or-physical-time' });
    },
    state: summary
  });
}
