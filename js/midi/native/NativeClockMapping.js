export function createNativeClockMapping({ now, onRetire = () => {}, maximumUncertaintyUs = 25000, maximumLookaheadMs = 1950 } = {}) {
  const samples = []; let epoch = 1, revision = 0, mapping = null, reason = 'not-calibrated';
  const validForMs = 5000, historyMs = 30000, maximumRatePpm = 1000;
  const retire = nextReason => {
    if (mapping || samples.length) { const previousEpoch = epoch; epoch++; mapping = null; samples.length = 0; reason = nextReason; onRetire(Object.freeze({ previousEpoch, epoch, reason })); }
    else reason = nextReason;
  };
  const expire = at => { if (mapping && (at < mapping.observedMs || at - mapping.observedMs > validForMs)) retire(at < mapping.observedMs ? 'browser-monotonic-clock-regressed' : 'clock-correlation-expired'); };
  const policy = values => {
    if (!Number.isInteger(values.maximumUncertaintyUs) || values.maximumUncertaintyUs < 100 || values.maximumUncertaintyUs > 25000 || !Number.isInteger(values.maximumLookaheadMs) || values.maximumLookaheadMs < 25 || values.maximumLookaheadMs > 1950) throw new Error('Choose a clock uncertainty budget of100–25000µs and native lookahead of25–1950ms');
    maximumUncertaintyUs = values.maximumUncertaintyUs; maximumLookaheadMs = values.maximumLookaheadMs;
  };
  policy({ maximumUncertaintyUs, maximumLookaheadMs });
  const status = (at = now()) => {
    expire(at);
    if (!mapping) return Object.freeze({ status: 'unavailable', epoch, revision, reason, maximumUncertaintyUs, maximumLookaheadMs, domain: 'companion-steady-microseconds' });
    const ageMs = Math.max(0, at - mapping.observedMs), uncertaintyUs = mapping.uncertaintyUs + (ageMs + maximumLookaheadMs) * mapping.rateUncertaintyPpm / 1000;
    return Object.freeze({ ...mapping, epoch, revision, status: uncertaintyUs <= maximumUncertaintyUs ? 'synchronized' : 'uncertain', uncertaintyUs, maximumUncertaintyUs, maximumLookaheadMs,
      validUntilMs: mapping.observedMs + validForMs, sourceDomain: 'performance-ms', domain: 'companion-steady-microseconds', model: 'bounded-affine-roundtrip-estimate', oneWayLatency: 'unknown-within-roundtrip-bound', acousticTiming: 'not-measured' });
  };
  return Object.freeze({
    observe({ beforeMs, afterMs, nativeMonoUs }) {
      if (![beforeMs, afterMs].every(Number.isFinite) || afterMs < beforeMs || !Number.isSafeInteger(nativeMonoUs) || nativeMonoUs < 0) { retire('invalid-clock-observation'); throw new Error('Native monotonic clock observation is invalid'); }
      expire(afterMs);
      const midpointMs = (beforeMs + afterMs) * 0.5, uncertaintyUs = (afterMs - beforeMs) * 500, previous = samples.at(-1);
      if (previous) {
        const elapsed = midpointMs - previous.midpointMs, nativeDelta = nativeMonoUs - previous.nativeMonoUs;
        if (elapsed <= 0 || nativeDelta < 0 || Math.abs(nativeDelta - elapsed * 1000) > previous.uncertaintyUs + uncertaintyUs + Math.abs(elapsed) * maximumRatePpm / 1000 + 2000) retire('clock-domain-discontinuity');
      }
      const sample = Object.freeze({ midpointMs, nativeMonoUs, uncertaintyUs, observedMs: afterMs });
      samples.push(sample); while (samples.length > 16 || samples.length > 1 && afterMs - samples[0].observedMs > historyMs) samples.shift();
      const minimumRtt = Math.min(...samples.map(row => row.uncertaintyUs));
      const selected = samples.filter(row => row.uncertaintyUs <= minimumRtt + 2000);
      const origin = selected[0], spanMs = selected.at(-1).midpointMs - origin.midpointMs;
      let rate = 1000, rateUncertaintyPpm = maximumRatePpm;
      if (selected.length >= 3 && spanMs >= 5000) {
        let weight = 0, xMean = 0, yMean = 0;
        for (const row of selected) { const w = 1 / (row.uncertaintyUs + 250) ** 2; weight += w; xMean += w * (row.midpointMs - origin.midpointMs); yMean += w * (row.nativeMonoUs - origin.nativeMonoUs); }
        xMean /= weight; yMean /= weight; let numerator = 0, denominator = 0;
        for (const row of selected) { const w = 1 / (row.uncertaintyUs + 250) ** 2, x = row.midpointMs - origin.midpointMs - xMean; numerator += w * x * (row.nativeMonoUs - origin.nativeMonoUs - yMean); denominator += w * x * x; }
        const fitted = numerator / denominator;
        if (Number.isFinite(fitted) && Math.abs(fitted - 1000) <= maximumRatePpm / 1000) {
          rate = fitted; const envelope = Math.max(...selected.map(row => row.uncertaintyUs + Math.abs(row.nativeMonoUs - origin.nativeMonoUs - (row.midpointMs - origin.midpointMs) * rate)));
          rateUncertaintyPpm = Math.min(maximumRatePpm, Math.max(10, envelope * 2000 / spanMs));
        }
      }
      const best = selected.reduce((a, b) => a.uncertaintyUs < b.uncertaintyUs ? a : b), offsets = selected.map(row => row.nativeMonoUs - best.nativeMonoUs - (row.midpointMs - best.midpointMs) * rate);
      const residualUs = Math.max(...offsets.map(Math.abs));
      mapping = Object.freeze({ hostAnchorMs: best.midpointMs, nativeAnchorUs: best.nativeMonoUs, rateUsPerMs: rate, rate: rate / 1000, driftPpm: (rate / 1000 - 1) * 1000000, rateUncertaintyPpm,
        offsetUs: best.nativeMonoUs - best.midpointMs * rate, uncertaintyUs: Math.max(...selected.map(row => row.uncertaintyUs)) + residualUs, observedMs: afterMs, samples: selected.length, spanMs });
      revision++; reason = null; return status(afterMs);
    },
    status,
    project(targetMs) {
      const state = status(); if (state.status !== 'synchronized' || !Number.isFinite(targetMs)) throw new Error('Native clock is stale or exceeds the selected uncertainty budget');
      const deadlineUs = Math.round(state.nativeAnchorUs + (targetMs - state.hostAnchorMs) * state.rateUsPerMs);
      if (!Number.isSafeInteger(deadlineUs) || deadlineUs < 0) throw new Error('Native clock projection exceeds its integer time domain');
      return Object.freeze({ deadlineUs, mapping: state });
    },
    setPolicy(values) { policy({ maximumUncertaintyUs, maximumLookaheadMs, ...values }); retire('clock-operating-policy-changed'); return status(); },
    invalidate: retire,
    clear() { samples.length = 0; mapping = null; reason = 'not-calibrated'; epoch++; }
  });
}
