// Score beats, host milliseconds and render frames stay separate. Sampling the
// host/audio correlation once per epoch avoids changing an event's frame merely
// because a callback arrived later.
export function createAudioClockBridge({ getContext, nowMs, presentationDelayMs = 0, maxHorizonMs = 5000 } = {}) {
  if (typeof getContext !== 'function' || typeof nowMs !== 'function' ||
      !Number.isFinite(presentationDelayMs) || presentationDelayMs < 0 || presentationDelayMs > 1000 ||
      !Number.isFinite(maxHorizonMs) || maxHorizonMs < 1 || maxHorizonMs > 60000) throw new Error('Invalid audio clock bridge.');
  let anchor = null, rebases = 0, rejected = 0;
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
      uncertaintyMs: (after - before) / 2, reason });
    rebases++;
    return anchor;
  };
  const toTargetFrame = (scoreTime, executionEpoch) => {
    const context = getContext();
    if (!anchor || executionEpoch !== anchor.executionEpoch || scoreTime?.epoch !== anchor.scoreEpoch ||
        !Number.isFinite(scoreTime.beat) || scoreTime.beat < 0 || context?.state !== 'running' ||
        context.sampleRate !== anchor.sampleRate) { rejected++; return null; }
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
  const diagnostics = () => {
    const context = getContext();
    let outputCorrelation = null;
    try {
      const stamp = context?.getOutputTimestamp?.();
      if (Number.isFinite(stamp?.contextTime) && Number.isFinite(stamp?.performanceTime)) {
        outputCorrelation = Object.freeze({ contextSeconds: stamp.contextTime, hostMs: stamp.performanceTime });
      }
    } catch { /* An output timestamp is optional diagnostic data. */ }
    return Object.freeze({ anchor, rebases, rejected, presentationDelayMs, maxHorizonMs,
      currentFrame: currentFrame(), baseLatencySeconds: Number.isFinite(context?.baseLatency) ? context.baseLatency : null,
      outputLatencySeconds: Number.isFinite(context?.outputLatency) ? context.outputLatency : null,
      outputCorrelation });
  };
  const invalidate = () => { anchor = null; };
  return { rebase, toTargetFrame, currentFrame, diagnostics, invalidate };
}
