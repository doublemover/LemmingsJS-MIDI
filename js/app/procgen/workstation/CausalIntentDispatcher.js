import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { retainSampleSelectionReceipt } from '../../../midi/content/SampleInstrumentMap.js';

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
        typeof sink.route !== 'string' || !sink.route || !sink.backend || sink.enabled != null && typeof sink.enabled !== 'function' ||
        sink.timeDomain != null && (typeof sink.timeDomain !== 'string' || !sink.timeDomain || sink.timeDomain.length > 64))) throw new Error('Invalid causal intent dispatch configuration.');
  const routes = new Map(), ids = new Set();
  for (const sink of sinks) {
    if (ids.has(sink.id)) throw new Error('Duplicate causal output sink.');
    ids.add(sink.id);
    if (!routes.has(sink.route)) routes.set(sink.route, []);
    routes.get(sink.route).push(sink);
  }
  const history = [], executions = new Map();
  let disposed = false;
  const retirement = createProcgenRetirementScope();
  const record = receipt => {
    const sealed = Object.freeze(receipt);
    if (historyLimit > 0) { history.push(sealed); if (history.length > historyLimit) history.shift(); }
    try { onReceipt(sealed); } catch { /* Diagnostics cannot change admission. */ }
    return sealed;
  };
  const retireCurrent = (sink, current, cancel = false) => {
    current.closed = true;
    current.retirementScope ||= createProcgenRetirementScope();
    return current.retirementScope.retire([
      ...(cancel ? [{ name: sink.id + '-cancel', run: () => {
        const result = sink.backend.cancelGenerationWithReceipt ? sink.backend.cancelGenerationWithReceipt(current.generation, current.execution) :
          sink.backend.cancelGeneration?.(current.generation, current.execution);
        return result?.retirement?.schema === 'lemmings-retirement/v1' ? result.retirement : result;
      } }] : []),
      { name: sink.id + '-execution', run: () => sink.backend.retireExecution?.(current.execution) }
    ]);
  };
  const executionFor = (sink, epoch, generation) => {
    if (typeof sink.backend.registerExecution !== 'function') return { execution: epoch };
    let current = executions.get(sink.id);
    const incarnation = sink.backend.executionIncarnation?.() ?? 0;
    if (current && (current.epoch !== epoch || current.generation !== generation || !current.closed && current.incarnation !== incarnation)) {
      if (retireCurrent(sink, current).outcome !== 'complete') return { status: 'rejected', reason: 'sink-retirement-unknown' };
      executions.delete(sink.id); current = null;
    }
    if (current) return current.closed ? { status: 'rejected', reason: 'execution-retired' } : current;
    const registered = sink.backend.registerExecution({ executionEpoch: epoch, generation });
    if (registered.status !== 'accepted') return registered;
    current = { epoch, generation, execution: registered.execution, incarnation, closed: false };
    executions.set(sink.id, current); return current;
  };
  const dispatch = (intents, batch) => {
    if (disposed) return Object.freeze([]);
    if (!Array.isArray(intents) || intents.length > 8192 || !batch || !Number.isSafeInteger(batch.generation)) throw new Error('Invalid causal intent batch.');
    const receipts = [], rawEpoch = executionEpoch(), epoch = typeof rawEpoch === 'string' && rawEpoch ? rawEpoch : null;
    for (const intent of intents) {
      const targets = routes.get(intent?.route) || [null];
      for (const sink of targets) {
        if (sink?.enabled) { let enabled = false; try { enabled = sink.enabled() === true; } catch {} if (!enabled) continue; }
        const base = { intentId: intent?.intentId ?? null, batchId: batch.batchId, generation: intent?.generation ?? null,
          voiceId: intent?.voiceId ?? null, sourceEventIds: Object.freeze(Array.isArray(intent?.sourceEventIds) ? [...intent.sourceEventIds] : []),
          sinkId: sink?.id ?? intent?.route ?? null, executionEpoch: epoch,
          ...(sink?.timeDomain ? { targetTimeDomain: sink.timeDomain } : {}) };
        if (!epoch) { receipts.push(record({ ...base, status: 'rejected', stage: 'none', reason: 'execution-epoch-unavailable' })); continue; }
        if (intent?.version !== 1 || intent.generation !== batch.generation || typeof intent.intentId !== 'string' || !intent.intentId ||
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
        const physicalDuration = Number.isFinite(intent.responseGateTicks) && Number.isFinite(intent.scoreTime?.sourceTickDurationMs) ? intent.responseGateTicks * intent.scoreTime.sourceTickDurationMs / 1000 : null;
        const durationLoss = physicalDuration != null && physicalDuration > 4 ? Object.freeze({ kind: 'gate-duration-cap', requestedSeconds: physicalDuration, representedSeconds: 4 }) : null;
        try {
          const identity = executionFor(sink, epoch, intent.generation);
          if (!identity.execution) outcome = identity;
          else if (intent.kind === 'begin') outcome = sink.backend.begin(intent, frame, identity.execution);
          else if (intent.kind === 'update' && intent.articulationState?.transfer && typeof sink.backend.transferVoiceLane === 'function') outcome = sink.backend.transferVoiceLane(intent.voiceId, intent.laneId, frame, identity.execution);
          else if (intent.kind === 'update' && intent.articulationState?.travel && typeof sink.backend.updateCanonicalTravel === 'function') outcome = sink.backend.updateCanonicalTravel(intent.voiceId, intent, frame, identity.execution);
          else if (intent.kind === 'update' && intent.articulationState?.travel && typeof sink.backend.updateSampleTravel === 'function') outcome = sink.backend.updateSampleTravel(intent.voiceId, intent, frame, identity.execution);
          else if (intent.kind === 'update' && intent.performanceCause) outcome = typeof sink.backend.updatePhysical === 'function'
            ? sink.backend.updatePhysical(intent.voiceId, intent.performanceCause, frame, identity.execution)
            : { status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-continuous-binding' };
          else if (intent.kind === 'update') outcome = intent.expression && Object.getPrototypeOf(intent.expression) === Object.prototype && Object.keys(intent.expression).length === 0 && intent.articulationState
            ? { status: 'accepted', stage: 'semantic-observation', outputRequested: false }
            : sink.backend.update(intent.voiceId, intent.expression, frame, identity.execution, intent.articulationState?.slewSeconds, intent);
          else if (intent.kind === 'end') outcome = sink.backend.end(intent.voiceId, intent.terminationReason === 'one-shot'
            ? { mode: 'one-shot', tailSeconds: physicalDuration == null ? oneShotTailSeconds : Math.min(4, Math.max(0, physicalDuration)), seconds: releaseSeconds, ...(physicalDuration != null ? { durationSource: 'physical-interval' } : {}) }
            : { seconds: intent.voiceTransition?.kind === 'crossfade' ? intent.voiceTransition.seconds : releaseSeconds, ...(intent.voiceTransition ? { transitionPolicy: 'crossfade' } : {}) }, frame, identity.execution, intent);
          else outcome = { status: 'rejected', reason: 'unsupported-intent-kind' };
        } catch { outcome = { status: 'rejected', reason: 'sink-exception' }; }
        if (outcome?.losses != null && (!Array.isArray(outcome.losses) || outcome.losses.length > 32)) outcome = { status: 'rejected', reason: 'invalid-sink-loss-receipt' };
        const losses = durationLoss || outcome?.losses?.length ? Object.freeze([...(durationLoss ? [durationLoss] : []), ...(outcome?.losses || [])].map(loss => Object.freeze({ ...loss }))) : null;
        const status = ['accepted', 'rejected', 'degraded'].includes(outcome?.status) ? outcome.status : 'rejected';
        const selectedSource = intent.kind === 'begin' && status === 'accepted' ? retainSampleSelectionReceipt(outcome) : null;
        receipts.push(record({ ...base, status, stage: status === 'rejected' ? 'none' : outcome.stage || 'accepted',
          reason: status === 'accepted' ? null : outcome?.reason || 'invalid-sink-receipt', targetFrame: frame,
          sourceTargetFrame, repair, ...(losses ? { losses } : {}), ...(typeof outcome?.outputId === 'string' ? { outputId: outcome.outputId } : {}),
          ...(Number.isInteger(outcome?.channel) ? { channel: outcome.channel } : {}), ...(selectedSource ? { selectedSource } : {}), ...(outcome?.bodyStrike ? { bodyStrike: outcome.bodyStrike } : {}), ...(outcome?.circularTravel ? { circularTravel: outcome.circularTravel } : {}), ...(outcome?.frictionTravel ? { frictionTravel: outcome.frictionTravel } : {}), ...(outcome?.textureTravel ? { textureTravel: outcome.textureTravel } : {}), ...(outcome?.sampleTraversal ? { sampleTraversal: outcome.sampleTraversal } : {}), ...(outcome?.outputRequested === false ? { outputRequested: false } : {}) }));
      }
    }
    return Object.freeze(receipts);
  };
  const cancelGeneration = (generation, epoch = executionEpoch()) => {
    const actions = [];
    for (const sink of sinks) {
      const current = executions.get(sink.id);
      if (current?.epoch === epoch && current.generation === generation) {
        actions.push({ name: sink.id, run: () => retireCurrent(sink, current, true) });
      } else if (typeof sink.backend.registerExecution !== 'function') actions.push({ name: sink.id + '-cancel', run: () => sink.backend.cancelGeneration?.(generation, String(epoch)) });
    }
    return createProcgenRetirementScope().retire(actions);
  };
  const diagnostics = () => Object.freeze({ disposed, receiptCount: history.length, receipts: Object.freeze([...history]) });
  const renewExecutionLease = (generation, epoch, untilFrame) => {
    if (disposed || !Number.isSafeInteger(untilFrame) || untilFrame < 0) return Object.freeze({ status: 'rejected', reason: 'invalid-execution-lease' });
    const outcomes = [];
    for (const sink of sinks) {
      if (sink.executionLease === false) continue;
      try { const identity = executionFor(sink, epoch, generation); outcomes.push(identity.execution && sink.backend.renewExecutionLease ?
        sink.backend.renewExecutionLease(generation, identity.execution, untilFrame) : { status: 'rejected', reason: identity.reason || 'sink-lease-unavailable' }); }
      catch { outcomes.push({ status: 'rejected', reason: 'sink-lease-failed' }); }
    }
    return Object.freeze({ status: outcomes.every(outcome => outcome?.status === 'accepted') ? 'accepted' : 'rejected', outcomes: Object.freeze(outcomes) });
  };
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
    return retirement.retire(sinks.flatMap(sink => {
      const current = executions.get(sink.id);
      return current ? [{ name: sink.id + '-execution', run: () => retireCurrent(sink, current) }] : [];
    }).concat({ name: 'dispatch-state', run: () => { executions.clear(); history.length = 0; } }));
  };
  const observeDisplaySamples = (sinkId, listener, options = {}) => {
    const sink = sinks.find(candidate => candidate.id === sinkId), current = executions.get(sinkId);
    if (disposed || !current || current.closed || current.epoch !== options.identity?.executionEpoch || current.generation !== options.identity?.generation ||
        typeof sink?.backend.observeDisplaySamples !== 'function') throw new Error('The display sink has no active owned execution.');
    return sink.backend.observeDisplaySamples(listener, { ...options, execution: current.execution });
  };
  return { dispatch, cancelGeneration, renewExecutionLease, observeDisplaySamples, diagnostics, dispose };
};

export { createCausalIntentDispatcher, createStrictLiveFramePolicy };
