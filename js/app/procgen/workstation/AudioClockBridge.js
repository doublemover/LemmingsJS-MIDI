// Score beats, host milliseconds and render frames stay separate. Sampling the
// host/audio correlation once per epoch avoids changing an event's frame merely
// because a callback arrived later.
/** @overload @param {import('./AudioClockContracts.js').AudioClockBridgeOptions} options @returns {import('./AudioClockContracts.js').AudioClockBridge} */
/** @param {Partial<import('./AudioClockContracts.js').AudioClockBridgeOptions>} options */
export function createAudioClockBridge({ getContext, nowMs, presentationDelayMs = /** @type {import('./AudioClockContracts.js').DurationMilliseconds} */ (0), maxHorizonMs = /** @type {import('./AudioClockContracts.js').DurationMilliseconds} */ (5000) } = {}) {
  if (typeof getContext !== 'function' || typeof nowMs !== 'function' ||
      !Number.isFinite(presentationDelayMs) || presentationDelayMs < 0 || presentationDelayMs > 1000 ||
      !Number.isFinite(maxHorizonMs) || maxHorizonMs < 1 || maxHorizonMs > 60000) throw new Error('Invalid audio clock bridge.');
  /** @type {import('./AudioClockContracts.js').AudioClockAnchor | null} */
  let anchor = null;
  /** @type {import('./AudioClockContracts.js').NativeAudioClockContext | null} */
  let anchorContext = null;
  let rebases = 0, rejected = 0, displayCorrelations = 0, displayRejected = 0;
  /** @param {import('./AudioClockContracts.js').NativeAudioClockContext | null} context @returns {context is import('./AudioClockContracts.js').NativeAudioClockContext} */
  const runningContext = context => context?.state === 'running' && Number.isFinite(context.currentTime) && context.currentTime >= 0 && Number.isFinite(context.sampleRate) && context.sampleRate > 0 && Number.isSafeInteger(Math.round(context.currentTime * context.sampleRate));
  /** @returns {import('./AudioClockContracts.js').AudioFrame | null} */
  const currentFrame = () => {
    const context = getContext();
    if (!runningContext(context)) return null;
    const frame = Math.round(context.currentTime * context.sampleRate);
    return Number.isSafeInteger(frame) && frame >= 0 ? /** @type {import('./AudioClockContracts.js').AudioFrame} */ (frame) : null;
  };
  /** @param {import('./AudioClockContracts.js').AudioClockAnchorInput} input */
  const rebase = ({ executionEpoch, scoreEpoch, beat, hostMs, bpm, reason = 'start' }) => {
    const context = getContext();
    if (typeof executionEpoch !== 'string' || !executionEpoch || typeof scoreEpoch !== 'string' || !scoreEpoch ||
        !Number.isFinite(beat) || beat < 0 || !Number.isFinite(hostMs) ||
        !Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000 ||
        !runningContext(context) || typeof reason !== 'string') {
      throw new Error('Cannot anchor the audio clock.');
    }
    const before = nowMs(), contextSeconds = /** @type {import('./AudioClockContracts.js').AudioSeconds} */ (context.currentTime), after = nowMs();
    if (!Number.isFinite(before) || !Number.isFinite(after) || after < before || after - before > 100) throw new Error('Uncertain audio clock sample.');
    anchor = Object.freeze({ executionEpoch, scoreEpoch, beat, hostMs, bpm,
      contextSeconds, correlationHostMs: /** @type {import('./AudioClockContracts.js').HostMilliseconds} */ ((before + after) / 2), sampleRate: /** @type {import('./AudioClockContracts.js').SampleRateHz} */ (context.sampleRate),
      uncertaintyMs: /** @type {import('./AudioClockContracts.js').DurationMilliseconds} */ ((after - before) / 2), presentationDelayMs, reason });
    anchorContext = context;
    rebases++;
    return anchor;
  };
  /** @param {import('./AudioClockContracts.js').ExecutionEpoch} executionEpoch @param {import('./AudioClockContracts.js').ScoreEpoch} scoreEpoch @param {import('./AudioClockContracts.js').TempoBpm} bpm */
  const isAnchored = (executionEpoch, scoreEpoch, bpm) => {
    const context = getContext();
    return !!anchor && anchor.executionEpoch === executionEpoch && anchor.scoreEpoch === scoreEpoch && anchor.bpm === bpm &&
      context === anchorContext && runningContext(context) && context.sampleRate === anchor.sampleRate;
  };
  /** @param {{epoch: import('./AudioClockContracts.js').ScoreEpoch, beat: import('./AudioClockContracts.js').ScoreBeats}} scoreTime @param {import('./AudioClockContracts.js').ExecutionEpoch} executionEpoch @returns {import('./AudioClockContracts.js').AudioFrame | null} */
  const toTargetFrame = (scoreTime, executionEpoch) => {
    const context = getContext();
    if (!anchor || executionEpoch !== anchor.executionEpoch || scoreTime?.epoch !== anchor.scoreEpoch ||
        !Number.isFinite(scoreTime.beat) || scoreTime.beat < 0 || !runningContext(context) ||
        context !== anchorContext || context.sampleRate !== anchor.sampleRate) { rejected++; return null; }
    const targetHostMs = anchor.hostMs + (scoreTime.beat - anchor.beat) * 60000 / anchor.bpm + presentationDelayMs;
    const currentHostMs = nowMs();
    if (!Number.isFinite(targetHostMs) || !Number.isFinite(currentHostMs) || targetHostMs - currentHostMs > maxHorizonMs) {
      rejected++; return null;
    }
    const targetSeconds = anchor.contextSeconds + (targetHostMs - anchor.correlationHostMs) / 1000;
    const frame = Math.round(targetSeconds * anchor.sampleRate);
    if (!Number.isSafeInteger(frame) || frame < 0) { rejected++; return null; }
    return /** @type {import('./AudioClockContracts.js').AudioFrame} */ (frame);
  };
  /** @param {Partial<import('./AudioClockContracts.js').DisplayClockRequest>} request @returns {import('./AudioClockContracts.js').DisplayClockCorrelation | null} */
  const correlateDisplay = ({ executionEpoch, contextEpoch } = {}) => {
    const context = getContext();
    const fail = () => { displayRejected++; return null; };
    if (!anchor || context !== anchorContext || !runningContext(context) || executionEpoch !== anchor.executionEpoch ||
        !Number.isSafeInteger(contextEpoch) || contextEpoch < 0 || context.sampleRate !== anchor.sampleRate) return fail();
    try {
      const before = nowMs(), seconds = context.currentTime, stamp = context.getOutputTimestamp?.(), after = nowMs();
      if (![before, after, seconds].every(Number.isFinite) || after < before || after - before > 50) return fail();
      let audioFrame, presentationMs, outputLatencyMs;
      /** @type {import('./AudioClockContracts.js').DisplayClockCorrelation['method']} */
      let method;
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
      return Object.freeze({ executionEpoch, contextEpoch, audioFrame: /** @type {import('./AudioClockContracts.js').AudioFrame} */ (audioFrame),
        presentationMs: /** @type {import('./AudioClockContracts.js').HostMilliseconds} */ (presentationMs), sampleRate: /** @type {import('./AudioClockContracts.js').SampleRateHz} */ (context.sampleRate),
        outputLatencyMs: /** @type {import('./AudioClockContracts.js').DurationMilliseconds} */ (outputLatencyMs), uncertaintyMs: /** @type {import('./AudioClockContracts.js').DurationMilliseconds} */ ((after - before) / 2 + 1000 / context.sampleRate), method, acousticReceipt: false });
    } catch { return fail(); }
  };
  /** @returns {import('./AudioClockContracts.js').AudioClockDiagnostics} */
  const diagnostics = () => {
    const context = getContext();
    let outputCorrelation = null;
    try {
      const stamp = context?.getOutputTimestamp?.();
      if (Number.isFinite(stamp?.contextTime) && Number.isFinite(stamp?.performanceTime)) {
        outputCorrelation = Object.freeze({ contextSeconds: /** @type {import('./AudioClockContracts.js').AudioSeconds} */ (stamp.contextTime), hostMs: /** @type {import('./AudioClockContracts.js').HostMilliseconds} */ (stamp.performanceTime) });
      }
    } catch { /* An output timestamp is optional diagnostic data. */ }
    return Object.freeze({ anchor, rebases, rejected, displayCorrelations, displayRejected, presentationDelayMs, maxHorizonMs,
      currentFrame: currentFrame(), baseLatencySeconds: Number.isFinite(context?.baseLatency) ? /** @type {import('./AudioClockContracts.js').AudioSeconds} */ (context.baseLatency) : null,
      outputLatencySeconds: Number.isFinite(context?.outputLatency) ? /** @type {import('./AudioClockContracts.js').AudioSeconds} */ (context.outputLatency) : null,
      outputCorrelation });
  };
  const invalidate = () => { anchor = null; anchorContext = null; };
  return { rebase, isAnchored, toTargetFrame, currentFrame, correlateDisplay, diagnostics, invalidate, getAnchor: () => anchor };
}
