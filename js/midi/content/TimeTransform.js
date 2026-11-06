import { cloneData } from '../../core/CanonicalData.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'TimeTransformError', code }); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const MODES = ['literal', 'buffered', 'attract', 'swingField', 'ratioFold'];
export const TIME_TRANSFORM_SCHEMA = 'lemmings-time-transform/v1';
export function validateTimeTransform(raw) {
  if (raw == null) return null;
  const value = cloneData(raw, { maxBytes: 32768, maxNodes: 1024 });
  if (value.schema !== TIME_TRANSFORM_SCHEMA || Object.keys(value).some(key => !['schema', 'id', 'revision', 'mode', 'strength01', 'gridBeats', 'originBeat', 'swingRatio', 'ratioNumerator', 'ratioDenominator', 'maxDisplacementMs', 'causalLatencyMs', 'orderPolicy', 'endPolicy', 'scope'].includes(key)) ||
      !text(value.id) || !natural(value.revision) || !MODES.includes(value.mode) || !finite(value.strength01, 0, 1) || !finite(value.gridBeats, 1 / 64, 16) ||
      !finite(value.originBeat, 0, 1e9) || !finite(value.swingRatio, 0.5, 0.75) || !natural(value.ratioNumerator) || value.ratioNumerator < 1 || value.ratioNumerator > 16 ||
      !natural(value.ratioDenominator) || value.ratioDenominator < 1 || value.ratioDenominator > 16 || !finite(value.maxDisplacementMs, 0, 2000) || !finite(value.causalLatencyMs, 0, 2000) ||
      value.orderPolicy !== 'monotone;equal-time-causal-order;minimum-separation-zero' || value.endPolicy !== 'preserve-onset-time-offset' || !value.scope ||
      Object.keys(value.scope).some(key => !['kind', 'regionIds'].includes(key)) || !['lane', 'regions'].includes(value.scope.kind) ||
      !Array.isArray(value.scope.regionIds) || value.scope.regionIds.length > 32 || new Set(value.scope.regionIds).size !== value.scope.regionIds.length ||
      value.scope.regionIds.some(id => !text(id)) || (value.scope.kind === 'lane' ? value.scope.regionIds.length !== 0 : value.scope.regionIds.length === 0)) fail('invalid-time-transform', 'Choose a bounded named groove, scope, grid, displacement and causal buffering policy.');
  return value;
}
export function defaultTimeTransform(id = 'physical-groove') {
  return validateTimeTransform({ schema: TIME_TRANSFORM_SCHEMA, id, revision: 1, mode: 'literal', strength01: 0, gridBeats: 0.5, originBeat: 0, swingRatio: 2 / 3,
    ratioNumerator: 1, ratioDenominator: 1, maxDisplacementMs: 120, causalLatencyMs: 0, orderPolicy: 'monotone;equal-time-causal-order;minimum-separation-zero',
    endPolicy: 'preserve-onset-time-offset', scope: { kind: 'lane', regionIds: [] } });
}
const anchor = (beat, policy) => {
  const relative = beat - policy.originBeat;
  if (policy.mode === 'swingField') {
    const cycle = policy.gridBeats * 2, first = Math.floor(relative / cycle) * cycle;
    const candidates = [first, first + cycle * policy.swingRatio, first + cycle];
    let nearest = candidates[0];
    for (const candidate of candidates) if (Math.abs(candidate - relative) <= Math.abs(nearest - relative)) nearest = candidate;
    return Math.max(0, nearest + policy.originBeat);
  }
  const grid = policy.mode === 'ratioFold' ? policy.gridBeats * policy.ratioNumerator / policy.ratioDenominator : policy.gridBeats;
  return Math.max(0, policy.originBeat + Math.floor(relative / grid + 0.5) * grid);
};
const sourceMilliseconds = time => {
  if (!Number.isFinite(time?.sourceTimeMs) || time.sourceTimeMs < 0 || !finite(time.subTick ?? 0, 0, 1) || (time.subTick ?? 0) >= 1 ||
      (time.subTick ?? 0) && !finite(time.sourceTickDurationMs, Number.MIN_VALUE, 60000)) fail('time-transform-source-clock', 'Groove requires the committed physical timestamp and fractional-tick duration.');
  const value = time.sourceTimeMs + (time.subTick ?? 0) * (time.sourceTickDurationMs ?? 0);
  if (!Number.isFinite(value)) fail('time-transform-overflow', 'The physical timestamp cannot be represented.'); return value;
};
const covers = (policy, intent) => policy.scope.kind === 'lane' || policy.scope.regionIds.includes(intent.preparedBodyStrike?.surfaceId ?? intent.topologyBinding?.regionInstanceId ?? intent.regionInstanceId ?? intent.articulationState?.contactCoordinate?.regionInstanceId ?? intent.performanceCause?.regionInstanceId);
const voiceKey = (intent, execution) => JSON.stringify([execution, intent.worldId ?? null, intent.generation, intent.voiceId]);
const actorKey = (intent, execution) => JSON.stringify([execution, intent.worldId ?? null, intent.generation, null, intent.actorId ?? intent.voiceId]);
export function createTimeTransformOwner({ mode = 'live', maxVoices = 4096, maxActors = 4096, cacheLimit = 8192, retainReceipts = true } = {}) {
  if (!['live', 'offline'].includes(mode) || ![maxVoices, maxActors, cacheLimit].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 65536)) throw new TypeError('Invalid time-transform owner limits.');
  const voices = new Map(), actors = new Map(), cache = new Map(), policies = new WeakMap();
  let scope = null, count = 0, transformed = 0, sumSquares = 0, desiredSquares = 0, maximumMs = 0, maximumDesiredMs = 0, maximumPositiveOutputDelayMs = 0, buffered = 0, orderRepairs = 0;
  const validate = raw => {
    if (raw == null) return null;
    let value = policies.get(raw); if (!value) { value = validateTimeTransform(raw); if (Object.isFrozen(raw)) policies.set(raw, value); } return value;
  };
  const apply = (intent, rawPolicy, { tempoBpm, executionEpoch = 'offline' } = {}) => {
    if (!intent || !['begin', 'update', 'end'].includes(intent.kind) || !text(intent.intentId) || !text(intent.voiceId) || !natural(intent.generation) || !text(executionEpoch)) fail('invalid-time-transform-intent', 'Timing transforms consume an existing immutable musical lifecycle.');
    const nextScope = JSON.stringify([executionEpoch, intent.worldId ?? null, intent.generation]);
    if (scope !== nextScope) { voices.clear(); actors.clear(); cache.clear(); scope = nextScope; }
    const cached = cache.get(intent.intentId); if (cached) return cached;
    const actor = actorKey(intent, executionEpoch);
    const key = voiceKey(intent, executionEpoch), held = voices.get(key), policy = held ? held.policy : validate(rawPolicy), time = intent.scoreTime;
    const identity = !held && (!policy || policy.mode === 'literal' || (policy.mode === 'buffered' ? policy.causalLatencyMs === 0 : policy.strength01 === 0) || !covers(policy, intent));
    if (identity && !actors.has(actor)) { count++; return Object.freeze({ scoreTime: time, receipt: null }); }
    if (!time || !text(time.epoch) || !finite(time.beat, 0, 1e12) || !finite(tempoBpm, 0.001, 1000000)) fail('time-transform-score-clock', 'A current declared score clock and tempo are required.');
    const originalMs = sourceMilliseconds(time), previous = actors.get(actor);
    if (identity && previous && originalMs >= previous.scheduledMs) { actors.delete(actor); count++; return Object.freeze({ scoreTime: time, receipt: null }); }
    if (previous && previous.scoreEpoch !== time.epoch) fail('time-transform-epoch-change', 'Retire the previous timing owner before changing its score epoch.');
    if (previous && originalMs < previous.originalMs) fail('time-transform-order', 'Physical events must arrive in their committed per-actor order.');
    if (intent.kind === 'begin' && held) fail('time-transform-duplicate-begin', 'A timing owner cannot replace a held source onset.');
    const active = !identity, millisecondsPerBeat = 60000 / tempoBpm;
    let desiredMs = originalMs, latencyMs = 0, scheduledMs = originalMs, reason = null, orderRepaired = false;
    if (held) {
      desiredMs += held.desiredOffsetMs; scheduledMs += held.outputOffsetMs; latencyMs = held.causalLatencyMs;
      reason = 'preserved-onset-time-offset';
    } else if (active) {
      const wanted = policy.mode === 'buffered' ? 0 : (anchor(time.beat, policy) - time.beat) * millisecondsPerBeat * policy.strength01;
      const displacement = Math.max(-policy.maxDisplacementMs, Math.min(policy.maxDisplacementMs, wanted));
      desiredMs = Math.max(0, originalMs + displacement); latencyMs = mode === 'live' ? policy.causalLatencyMs : 0;
      scheduledMs = desiredMs + latencyMs;
      if (mode === 'live' && scheduledMs < originalMs) { scheduledMs = originalMs; reason = 'earlier-target-needs-more-explicit-buffer-latency'; }
      if (Math.abs(wanted) > policy.maxDisplacementMs) reason = 'authored-displacement-clamp';
    }
    if (previous && scheduledMs < previous.scheduledMs) { scheduledMs = previous.scheduledMs; reason = 'preserved-per-actor-lifecycle-order'; orderRepaired = true; }
    if (!Number.isFinite(scheduledMs) || scheduledMs < 0 || mode === 'live' && scheduledMs < originalMs) fail('time-transform-noncausal', 'Live output cannot precede its committed physical event.');
    const outputOffsetMs = scheduledMs - originalMs, desiredOffsetMs = desiredMs - originalMs;
    if (intent.kind === 'begin' && (active || outputOffsetMs || desiredOffsetMs) && voices.size >= maxVoices) fail('time-transform-voice-capacity', 'The held timing-owner limit is full.');
    if (!actors.has(actor) && actors.size >= maxActors) {
      for (const [id, frontier] of actors) if (frontier.scheduledMs + 4000 <= originalMs) actors.delete(id);
      if (actors.size >= maxActors) fail('time-transform-actor-capacity', 'The physical timing frontier limit is full.');
    }
    const scoreTime = outputOffsetMs === 0 ? time : Object.freeze({ ...time, beat: time.beat + outputOffsetMs / millisecondsPerBeat });
    if (!finite(scoreTime.beat, 0, 1e12)) fail('time-transform-score-overflow', 'The transformed score time exceeds its bounded domain.');
    const receipt = retainReceipts ? cloneData({ schema: 'lemmings-time-transform-decision/v1', intentId: intent.intentId, voiceId: intent.voiceId, executionEpoch,
      transformId: policy?.id ?? null, transformRevision: policy?.revision ?? null, mode, policyMode: policy?.mode ?? 'literal', originalTime: time,
      originalSourceTimeMs: originalMs, desiredSourceTimeMs: desiredMs, scheduledSourceTimeMs: scheduledMs, originalBeat: time.beat,
      transformedBeat: time.beat + desiredOffsetMs / millisecondsPerBeat, scheduledBeat: scoreTime.beat, desiredDisplacementMs: desiredOffsetMs,
      outputDisplacementMs: outputOffsetMs, causalLatencyMs: latencyMs, minimumSeparationMs: 0, endPolicy: 'preserve-onset-time-offset',
      reason, sourcePrecision: time.precision ?? 'tick', physicalTruthChanged: false }, { maxBytes: 8192, maxNodes: 1024 }) : null;
    const decision = Object.freeze({ scoreTime, receipt, scheduledSourceTimeMs: scheduledMs });
    actors.set(actor, { originalMs, scheduledMs, scoreEpoch: time.epoch });
    if (intent.kind === 'begin' && (active || outputOffsetMs || desiredOffsetMs)) voices.set(key, { policy, desiredOffsetMs, outputOffsetMs, causalLatencyMs: latencyMs });
    if (intent.kind === 'end') voices.delete(key);
    cache.set(intent.intentId, decision); if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
    count++; if (orderRepaired) orderRepairs++; if (outputOffsetMs || desiredOffsetMs) transformed++; if (latencyMs) buffered++;
    sumSquares += outputOffsetMs * outputOffsetMs; desiredSquares += desiredOffsetMs * desiredOffsetMs;
    maximumPositiveOutputDelayMs = Math.max(maximumPositiveOutputDelayMs, outputOffsetMs); maximumMs = Math.max(maximumMs, Math.abs(outputOffsetMs)); maximumDesiredMs = Math.max(maximumDesiredMs, Math.abs(desiredOffsetMs));
    return decision;
  };
  return Object.freeze({ apply,
    snapshot({ completedSourceTimeMs = null } = {}) {
      if (completedSourceTimeMs !== null && !finite(completedSourceTimeMs, 0, Number.MAX_VALUE)) fail('time-transform-cut-frontier', 'A timing cut requires a finite completed source frontier.');
      return cloneData({ schema: 'lemmings-time-transform-state/v1', mode, scope: scope === null ? null : JSON.parse(scope),
        voices: [...voices], actors: [...actors].filter(([, frontier]) => completedSourceTimeMs === null || frontier.scheduledMs > completedSourceTimeMs),
        statistics: { count, transformed, sumSquares, desiredSquares, maximumMs, maximumDesiredMs, maximumPositiveOutputDelayMs, buffered, orderRepairs },
        cache: 'not-retained;canonical-intent-deduplication-remains-with-source-owner' }, { maxBytes: 2 * 1048576, maxNodes: 262144 });
    },
    restore(raw, { executionEpoch } = {}) {
      if (scope !== null || voices.size || actors.size || cache.size || count) fail('fresh-time-transform-owner-required', 'Restore timing state only into a fresh unpublished owner.');
      const state = cloneData(raw, { maxBytes: 2 * 1048576, maxNodes: 262144 }), saved = state.scope, stats = state.statistics;
      if (state.schema !== 'lemmings-time-transform-state/v1' || state.mode !== mode || !text(executionEpoch) ||
          saved !== null && (!Array.isArray(saved) || saved.length !== 3 || !text(saved[0]) || executionEpoch === saved[0] || saved[1] !== null && !text(saved[1]) || !natural(saved[2])) ||
          !Array.isArray(state.voices) || state.voices.length > maxVoices || !Array.isArray(state.actors) || state.actors.length > maxActors ||
          !stats || ['count', 'transformed', 'buffered', 'orderRepairs'].some(key => !natural(stats[key])) || stats.transformed > stats.count || stats.buffered > stats.count || stats.orderRepairs > stats.count ||
          !finite(stats.sumSquares, 0, stats.count * 16000000 + 1) || !finite(stats.desiredSquares, 0, stats.count * 4000000 + 1) ||
          !finite(stats.maximumMs, 0, 4000) || !finite(stats.maximumDesiredMs, 0, 2000) || !finite(stats.maximumPositiveOutputDelayMs, 0, 4000) ||
          saved === null && (state.voices.length || state.actors.length)) fail('invalid-time-transform-state', 'The timing image has a foreign clock, owner, inventory or displacement domain.');
      const nextVoices = new Map(), nextActors = new Map();
      const rekey = (key, length) => {
        let parts; try { parts = JSON.parse(key); } catch { fail('invalid-time-transform-key', 'Invalid timing ownership identity.'); }
        if (!Array.isArray(parts) || parts.length !== length || parts[0] !== saved?.[0] || parts[1] !== saved?.[1] || parts[2] !== saved?.[2] ||
            parts.slice(3).some(value => !(value === null || text(value) || natural(value))) || length === 4 && !text(parts[3]) || length === 5 && !(text(parts[4]) || natural(parts[4]))) fail('invalid-time-transform-key', 'Timing state does not share its declared execution scope.');
        parts[0] = executionEpoch; return JSON.stringify(parts);
      };
      for (const pair of state.voices) {
        if (!Array.isArray(pair) || pair.length !== 2) fail('invalid-time-transform-voice', 'Invalid held timing record.');
        const key = rekey(pair[0], 4), value = pair[1];
        if (nextVoices.has(key) || !value || !finite(value.desiredOffsetMs, -2000, 2000) || !finite(value.outputOffsetMs, mode === 'live' ? 0 : -2000, 4000) ||
            !finite(value.causalLatencyMs, 0, mode === 'live' ? 2000 : 0) || value.outputOffsetMs + 1e-7 < value.desiredOffsetMs + value.causalLatencyMs) fail('invalid-time-transform-voice', 'Invalid held onset timing offset.');
        nextVoices.set(key, { policy: validateTimeTransform(value.policy), desiredOffsetMs: value.desiredOffsetMs, outputOffsetMs: value.outputOffsetMs, causalLatencyMs: value.causalLatencyMs });
      }
      for (const pair of state.actors) {
        if (!Array.isArray(pair) || pair.length !== 2) fail('invalid-time-transform-frontier', 'Invalid actor timing frontier.');
        const key = rekey(pair[0], 5), value = pair[1];
        if (nextActors.has(key) || !value || !finite(value.originalMs, 0, Number.MAX_VALUE) || !finite(value.scheduledMs, 0, Number.MAX_VALUE) ||
            !finite(value.scheduledMs - value.originalMs, mode === 'live' ? 0 : -2000, 4000) || !text(value.scoreEpoch)) fail('invalid-time-transform-frontier', 'Invalid actor timing displacement or score epoch.');
        nextActors.set(key, { ...value });
      }
      scope = saved === null ? null : JSON.stringify([executionEpoch, saved[1], saved[2]]);
      for (const [key, value] of nextVoices) voices.set(key, value);
      for (const [key, value] of nextActors) actors.set(key, value);
      ({ count, transformed, sumSquares, desiredSquares, maximumMs, maximumDesiredMs, maximumPositiveOutputDelayMs, buffered, orderRepairs } = stats);
      return Object.freeze({ restoredVoices: voices.size, actorFrontiers: actors.size, freshExecutionEpoch: executionEpoch, outputRequested: false });
    },
    reset() { scope = null; voices.clear(); actors.clear(); cache.clear(); },
    diagnostics: () => Object.freeze({ scope: 'canonical-intent-timing-decisions;not-output-acceptance', mode, count, transformed, buffered, orderRepairs, activeVoices: voices.size, actorFrontiers: actors.size,
      maximumPositiveOutputDelayMs, maximumOutputDisplacementMs: maximumMs, rmsOutputDisplacementMs: count ? Math.sqrt(sumSquares / count) : 0,
      maximumDesiredDisplacementMs: maximumDesiredMs, rmsDesiredDisplacementMs: count ? Math.sqrt(desiredSquares / count) : 0,
      minimumSeparationMs: 0, literalDefault: true, precisionPolicy: 'retained-source-tick-precision;no-inferred-subtick' }) });
}
