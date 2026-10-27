// Score beats, host milliseconds and render frames stay separate. Sampling the
// host/audio correlation once per epoch avoids changing an event's frame merely
// because a callback arrived later.
export function createAudioClockBridge({ getContext, nowMs, presentationDelayMs = 0, maxHorizonMs = 5000 } = {}) {
  if (typeof getContext !== 'function' || typeof nowMs !== 'function' ||
      !Number.isFinite(presentationDelayMs) || presentationDelayMs < 0 || presentationDelayMs > 1000 ||
      !Number.isFinite(maxHorizonMs) || maxHorizonMs < 1 || maxHorizonMs > 60000) throw new Error('Invalid audio clock bridge.');
  let anchor = null, anchorContext = null, rebases = 0, rejected = 0, displayCorrelations = 0, displayRejected = 0;
  const currentFrame = () => {
    const context = getContext();
    return context?.state === 'running' && Number.isFinite(context.currentTime) && Number.isFinite(context.sampleRate)
      ? Math.round(context.currentTime * context.sampleRate) : null;
  };
  const rebase = ({ executionEpoch, scoreEpoch, beat, hostMs, bpm, reason = 'start' }) => {
    const context = getContext();
    if (typeof executionEpoch !== 'string' || !executionEpoch || typeof scoreEpoch !== 'string' || !scoreEpoch ||
        !Number.isFinite(beat) || beat < 0 || !Number.isFinite(hostMs) ||
        !Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000 ||
        context?.state !== 'running' || !Number.isFinite(context.currentTime) ||
        !Number.isFinite(context.sampleRate) || context.sampleRate <= 0 || typeof reason !== 'string') {
      throw new Error('Cannot anchor the audio clock.');
    }
    const before = nowMs(), contextSeconds = context.currentTime, after = nowMs();
    if (!Number.isFinite(before) || !Number.isFinite(after) || after < before || after - before > 100) throw new Error('Uncertain audio clock sample.');
    anchor = Object.freeze({ executionEpoch, scoreEpoch, beat, hostMs, bpm,
      contextSeconds, correlationHostMs: (before + after) / 2, sampleRate: context.sampleRate,
      uncertaintyMs: (after - before) / 2, presentationDelayMs, reason });
    anchorContext = context;
    rebases++;
    return anchor;
  };
  const isAnchored = (executionEpoch, scoreEpoch, bpm) => {
    const context = getContext();
    return !!anchor && anchor.executionEpoch === executionEpoch && anchor.scoreEpoch === scoreEpoch && anchor.bpm === bpm &&
      context === anchorContext && context?.state === 'running' && context.sampleRate === anchor.sampleRate;
  };
  const toTargetFrame = (scoreTime, executionEpoch) => {
    const context = getContext();
    if (!anchor || executionEpoch !== anchor.executionEpoch || scoreTime?.epoch !== anchor.scoreEpoch ||
        !Number.isFinite(scoreTime.beat) || scoreTime.beat < 0 || context?.state !== 'running' ||
        context !== anchorContext || context.sampleRate !== anchor.sampleRate) { rejected++; return null; }
    const targetHostMs = anchor.hostMs + (scoreTime.beat - anchor.beat) * 60000 / anchor.bpm + presentationDelayMs;
    const currentHostMs = nowMs();
    if (!Number.isFinite(targetHostMs) || !Number.isFinite(currentHostMs) || targetHostMs - currentHostMs > maxHorizonMs) {
      rejected++; return null;
    }
    const targetSeconds = anchor.contextSeconds + (targetHostMs - anchor.correlationHostMs) / 1000;
    const frame = Math.round(targetSeconds * anchor.sampleRate);
    if (!Number.isSafeInteger(frame) || frame < 0) { rejected++; return null; }
    return frame;
  };
  const correlateDisplay = ({ executionEpoch, contextEpoch } = {}) => {
    const context = getContext();
    const fail = () => { displayRejected++; return null; };
    if (!anchor || context !== anchorContext || context?.state !== 'running' || executionEpoch !== anchor.executionEpoch ||
        !Number.isSafeInteger(contextEpoch) || contextEpoch < 0 || context.sampleRate !== anchor.sampleRate) return fail();
    try {
      const before = nowMs(), seconds = context.currentTime, stamp = context.getOutputTimestamp?.(), after = nowMs();
      if (![before, after, seconds].every(Number.isFinite) || after < before || after - before > 50) return fail();
      let audioFrame, presentationMs, outputLatencyMs, method;
      if (Number.isFinite(stamp?.contextTime) && stamp.contextTime >= 0 && Number.isFinite(stamp?.performanceTime) && stamp.performanceTime >= 0 &&
          Math.abs(after - stamp.performanceTime) <= 2000 && stamp.contextTime <= seconds + 0.1 && seconds - stamp.contextTime <= 2) {
        audioFrame = Math.round(stamp.contextTime * context.sampleRate); presentationMs = stamp.performanceTime; outputLatencyMs = 0; method = 'output-timestamp';
      } else {
        if (!Number.isFinite(context.baseLatency) || context.baseLatency < 0 || context.baseLatency > 1 ||
            !Number.isFinite(context.outputLatency) || context.outputLatency < 0 || context.outputLatency > 1) return fail();
        audioFrame = Math.round(seconds * context.sampleRate); presentationMs = (before + after) / 2;
        outputLatencyMs = (context.baseLatency + context.outputLatency) * 1000; method = 'context-correlation-with-reported-latency';
      }
      if (!Number.isSafeInteger(audioFrame) || audioFrame < 0) return fail(); displayCorrelations++;
      return Object.freeze({ executionEpoch, contextEpoch, audioFrame, presentationMs, sampleRate: context.sampleRate,
        outputLatencyMs, uncertaintyMs: (after - before) / 2 + 1000 / context.sampleRate, method, acousticReceipt: false });
    } catch { return fail(); }
  };
  const diagnostics = () => {
    const context = getContext();
    let outputCorrelation = null;
    try {
      const stamp = context?.getOutputTimestamp?.();
      if (Number.isFinite(stamp?.contextTime) && Number.isFinite(stamp?.performanceTime)) {
        outputCorrelation = Object.freeze({ contextSeconds: stamp.contextTime, hostMs: stamp.performanceTime });
      }
    } catch { /* An output timestamp is optional diagnostic data. */ }
    return Object.freeze({ anchor, rebases, rejected, displayCorrelations, displayRejected, presentationDelayMs, maxHorizonMs,
      currentFrame: currentFrame(), baseLatencySeconds: Number.isFinite(context?.baseLatency) ? context.baseLatency : null,
      outputLatencySeconds: Number.isFinite(context?.outputLatency) ? context.outputLatency : null,
      outputCorrelation });
  };
  const invalidate = () => { anchor = null; anchorContext = null; };
  return { rebase, isAnchored, toTargetFrame, currentFrame, correlateDisplay, diagnostics, invalidate, getAnchor: () => anchor };
}
