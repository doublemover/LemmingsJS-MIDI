const createStrictLiveFramePolicy = ({ nowFrame } = {}) => {
  if (typeof nowFrame !== 'function') throw new Error('A sink frame clock is required.');
  return ({ intent, targetFrame, sink }) => {
    const current = nowFrame(sink);
    if (!Number.isSafeInteger(current) || current < 0) return { status: 'rejected', reason: 'clock-unavailable' };
    if (targetFrame > current) return { status: 'accepted', targetFrame };
    if (intent.kind === 'end') return { status: 'accepted', targetFrame: current, repair: 'late-release' };
    return { status: 'rejected', reason: intent.kind === 'begin' ? 'late-attack' : 'stale-expression' };
  };
};

const createCausalIntentDispatcher = ({ sinks = [], toTargetFrame, executionEpoch = () => 'live', latePolicy = null,
  onReceipt = () => {}, oneShotTailSeconds = 0.08, releaseSeconds = 0.04, historyLimit = 1024 } = {}) => {
  if (typeof toTargetFrame !== 'function' || typeof executionEpoch !== 'function' ||
      (latePolicy != null && typeof latePolicy !== 'function') ||
      !Array.isArray(sinks) || sinks.some(sink => typeof sink?.id !== 'string' || !sink.id ||
        typeof sink.route !== 'string' || !sink.route || !sink.backend)) throw new Error('Invalid causal intent dispatch configuration.');
  const routes = new Map(), ids = new Set();
  for (const sink of sinks) {
    if (ids.has(sink.id)) throw new Error('Duplicate causal output sink.');
    ids.add(sink.id);
    if (!routes.has(sink.route)) routes.set(sink.route, []);
    routes.get(sink.route).push(sink);
  }
  const history = [];
  let disposed = false;
  const record = receipt => {
    const sealed = Object.freeze(receipt);
    if (historyLimit > 0) { history.push(sealed); if (history.length > historyLimit) history.shift(); }
    try { onReceipt(sealed); } catch { /* Diagnostics cannot change admission. */ }
    return sealed;
  };
  const dispatch = (intents, batch) => {
    if (disposed) return Object.freeze([]);
    if (!Array.isArray(intents) || intents.length > 8192 || !batch || !Number.isSafeInteger(batch.generation)) throw new Error('Invalid causal intent batch.');
    const receipts = [], rawEpoch = executionEpoch(), epoch = typeof rawEpoch === 'string' && rawEpoch ? rawEpoch : null;
    for (const intent of intents) {
      const targets = routes.get(intent?.route) || [null];
      for (const sink of targets) {
        const base = { intentId: intent?.intentId ?? null, batchId: batch.batchId, generation: intent?.generation ?? null,
          voiceId: intent?.voiceId ?? null, sourceEventIds: Object.freeze(Array.isArray(intent?.sourceEventIds) ? [...intent.sourceEventIds] : []),
          sinkId: sink?.id ?? intent?.route ?? null, executionEpoch: epoch };
        if (!epoch) { receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'execution-epoch-unavailable' })); continue; }
        if (intent?.version !== 1 || typeof intent.intentId !== 'string' || !intent.intentId ||
            typeof intent.voiceId !== 'string' || !intent.voiceId || !Array.isArray(intent.sourceEventIds)) {
          receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'invalid-intent' })); continue;
        }
        if (!sink) { receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'route-unavailable' })); continue; }
        let frame;
        try { frame = toTargetFrame(intent.scoreTime, batch, intent, sink); } catch { frame = null; }
        if (!Number.isSafeInteger(frame) || frame < 0) { receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'clock-unavailable' })); continue; }
        const sourceTargetFrame = frame;
        let repair = null;
        if (latePolicy) {
          let decision;
          try { decision = latePolicy({ intent, targetFrame: frame, sink, batch }); } catch { decision = null; }
          if (decision?.status === 'rejected') {
            receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: decision.reason || 'late-policy-rejected',
              sourceTargetFrame })); continue;
          }
          if (decision?.status !== 'accepted' || !Number.isSafeInteger(decision.targetFrame) || decision.targetFrame < 0) {
            receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'invalid-late-policy', sourceTargetFrame })); continue;
          }
          frame = decision.targetFrame; repair = decision.repair || null;
        }
        let outcome;
        try {
          if (intent.kind === 'begin') outcome = sink.backend.begin(intent, frame, epoch);
          else if (intent.kind === 'update') outcome = sink.backend.update(intent.voiceId, intent.expression, frame, epoch);
          else if (intent.kind === 'end') outcome = sink.backend.end(intent.voiceId, intent.terminationReason === 'one-shot'
            ? { mode: 'one-shot', tailSeconds: oneShotTailSeconds, seconds: releaseSeconds }
            : { seconds: releaseSeconds }, frame, epoch);
          else outcome = { status: 'rejected', reason: 'unsupported-intent-kind' };
        } catch { outcome = { status: 'rejected', reason: 'sink-exception' }; }
        const status = ['accepted', 'rejected', 'degraded'].includes(outcome?.status) ? outcome.status : 'rejected';
        receipts.push(record({ ...base, status, stage: status === 'rejected' ? 'none' : outcome.stage || 'accepted',
          reason: status === 'accepted' ? null : outcome?.reason || 'invalid-sink-receipt', targetFrame: frame,
          sourceTargetFrame, repair }));
      }
    }
    return Object.freeze(receipts);
  };
  const cancelGeneration = (generation, epoch = executionEpoch()) => {
    for (const sink of sinks) {
      try { sink.backend.cancelGeneration?.(generation, String(epoch)); } catch { /* One sink cannot prevent other cleanup. */ }
    }
  };
  const diagnostics = () => Object.freeze({ disposed, receiptCount: history.length, receipts: Object.freeze([...history]) });
  const dispose = () => { disposed = true; history.length = 0; };
  return { dispatch, cancelGeneration, diagnostics, dispose };
};

export { createCausalIntentDispatcher, createStrictLiveFramePolicy };
