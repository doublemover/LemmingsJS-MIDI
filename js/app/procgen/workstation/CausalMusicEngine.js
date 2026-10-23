import { causalRandomDecision } from './CausalRandom.js';
import { createTravelAccumulator, validateArticulationField } from './TravelAccumulator.js';

const SOURCE_KINDS = new Set(['TerrainWorkCommitted', 'ContactResolved', 'MotionCommitted', 'ActionEntered', 'ContactSpanBegan']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const voiceIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

// A graph is content, not code. Validation happens before any live state is
// changed, and the resulting descriptors contain only bounded primitives.
const validateCausalInstrumentGraph = value => {
  if (!plain(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.instruments) || value.instruments.length > 256) throw new Error('Unsupported causal instrument graph.');
  const ids = new Set();
  const instruments = value.instruments.map(input => {
    if (!plain(input) || !nonempty(input.id) || ids.has(input.id) || !SOURCE_KINDS.has(input.sourceKind) ||
        !Number.isFinite(input.pitchCents) || Math.abs(input.pitchCents) > 24000 ||
        !Number.isFinite(input.velocity01) || input.velocity01 < 0 || input.velocity01 > 1 ||
        !nonempty(input.route) || !nonempty(input.role)) throw new Error('Invalid causal instrument.');
    ids.add(input.id);
    if (input.sourceKind === 'ActionEntered' && !nonempty(input.action)) throw new Error('Action instrument needs an action.');
    if (input.sourceKind === 'MotionCommitted' && !input.articulation && (!Number.isFinite(input.gateX) || Math.abs(input.gateX) > 1000000000 ||
        !['either', 'positive', 'negative'].includes(input.crossingDirection ?? 'either'))) throw new Error('Motion instrument needs a valid gate.');
    if (input.articulation && input.sourceKind !== 'MotionCommitted') throw new Error('Travel articulation requires committed motion.');
    if (input.probability01 != null && (!Number.isFinite(input.probability01) || input.probability01 < 0 || input.probability01 > 1)) throw new Error('Invalid response probability.');
    if (input.sourceKind === 'TerrainWorkCommitted' && input.operationKind != null && !nonempty(input.operationKind)) throw new Error('Invalid work operation.');
    if (['ContactResolved', 'ContactSpanBegan'].includes(input.sourceKind) && input.causeKind != null && !nonempty(input.causeKind)) throw new Error('Invalid contact cause.');
    return Object.freeze({ id: input.id, sourceKind: input.sourceKind, action: input.action ?? null,
      operationKind: input.operationKind ?? null, causeKind: input.causeKind ?? null,
      gateX: input.sourceKind === 'MotionCommitted' ? input.gateX : null,
      articulation: input.articulation ? validateArticulationField(input.articulation) : null,
      probability01: input.probability01 ?? 1,
      crossingDirection: input.crossingDirection ?? 'either',
      changedOnly: input.changedOnly === true, pitchCents: input.pitchCents, velocity01: input.velocity01,
      route: input.route, role: input.role, mute: input.mute === true, solo: input.solo === true });
  });
  if (value.seed != null && !Number.isSafeInteger(value.seed)) throw new Error('Invalid causal graph seed.');
  return Object.freeze({ version: 1, revision: value.revision, seed: value.seed ?? 0, instruments: Object.freeze(instruments) });
};

const createCausalMusicEngine = ({ getGraph, deliver = () => {}, scoreTimeline = null,
  maxBeginsPerBatch = 512, maxVoices = 512, traceLimit = 1024 } = {}) => {
  if (typeof getGraph !== 'function' || (scoreTimeline && typeof scoreTimeline.map !== 'function')) throw new Error('A causal graph provider and valid score timeline are required.');
  const active = new Map(), seen = new Set(), seenOrder = [], trace = [];
  const travel = createTravelAccumulator({ maxEntries: Math.max(1, maxVoices) }), decisions = [];
  let generation = null, graph = null, graphSource = null, graphFingerprint = null, liveIds = null, indexed = null, errors = 0, rejected = 0;
  let cursor = { worldId: null, generation: null, tick: -1, lastSequence: -1, batchId: null };
  const accepted = new Map(), rejectedByInstrument = new Map();
  const remember = intent => { if (traceLimit > 0) { trace.push(intent); if (trace.length > traceLimit) trace.shift(); } };
  const intentFor = (batch, fact, instrument, kind, voiceId, reason = null, voiceGeneration = batch.generation, expression = {}) => Object.freeze({
    version: 1, intentId: `${batch.batchId}:${instrument.id}:${voiceId}:${fact?.eventId || 'boundary'}:${kind}`,
    worldId: batch.worldId, batchId: batch.batchId, generation: voiceGeneration,
    kind, onsetId: voiceId, voiceId, actorId: fact?.actorId ?? null, laneId: fact?.laneId ?? null,
    sourceEventIds: Object.freeze(fact?.eventId ? [fact.eventId] : []),
    causalSequence: fact?.causalSequence ?? null, mappingId: instrument.id,
    actionInstanceId: fact?.actionInstanceId ?? null,
    scoreTime: Object.freeze({ ...(scoreTimeline?.map({ simTick: batch.tick, subTick: fact?.subTick ?? 0,
      precision: fact?.precision ?? 'tick' }) || { simTick: batch.tick, subTick: fact?.subTick ?? 0,
      precision: fact?.precision ?? 'tick' }), sourceTimeMs: batch.sourceTimeMs ?? null }),
    pitch: Object.freeze({ cents: instrument.pitchCents, referenceHz: 440 }), velocity01: instrument.velocity01,
    expression: Object.freeze(expression), role: instrument.role, route: instrument.route, terminationReason: reason
  });
  const publish = (batch, intents) => {
    const sealed = Object.freeze(intents);
    for (const intent of sealed) remember(intent);
    try { deliver(sealed, batch); } catch { errors++; }
    return sealed;
  };
  const endVoice = (batch, record, fact, reason, output) => {
    active.delete(record.voiceId);
    output.push(intentFor(batch, fact || { actorId: record.actorId, laneId: record.laneId }, record.instrument, 'end', record.voiceId, reason, record.generation));
  };
  const endMatching = (batch, predicate, fact, reason, output) => {
    for (const record of [...active.values()]) if (predicate(record)) endVoice(batch, record, fact, reason, output);
  };
  const getCurrentGraph = () => {
    const source = getGraph();
    if (source !== graphSource || source?.revision !== graph?.revision) {
      const next = validateCausalInstrumentGraph(source);
      const fingerprint = JSON.stringify(next);
      if (graph && next.revision === graph.revision && fingerprint !== graphFingerprint) throw new Error('Causal graph changed without a new revision.');
      const solo = next.instruments.some(instrument => instrument.solo && !instrument.mute);
      const live = next.instruments.filter(instrument => !instrument.mute && (!solo || instrument.solo));
      const nextIndex = new Map();
      for (const instrument of live) {
        let group = nextIndex.get(instrument.sourceKind);
        if (!group) { group = []; nextIndex.set(instrument.sourceKind, group); }
        group.push(instrument);
      }
      graph = next; graphSource = source; graphFingerprint = fingerprint; liveIds = new Set(live.map(instrument => instrument.id)); indexed = nextIndex;
    }
    return graph;
  };
  const processBatch = batch => {
    if (batch?.version !== 1 || !nonempty(batch.batchId) || !nonempty(batch.worldId) || !Number.isSafeInteger(batch.generation) ||
        !Number.isSafeInteger(batch.tick) || !Array.isArray(batch.facts) || batch.facts.length > 8192 || !plain(batch.completeness) ||
        !['complete', 'incomplete'].includes(batch.completeness.status) || !Number.isSafeInteger(batch.completeness.dropped) ||
        batch.completeness.dropped < 0) throw new Error('Invalid physical batch.');
    const current = getCurrentGraph();
    let previousSequence = -1;
    for (const fact of batch.facts) {
      if (!plain(fact) || !Number.isSafeInteger(fact.causalSequence) || fact.causalSequence <= previousSequence) throw new Error('Unordered physical facts.');
      previousSequence = fact.causalSequence;
    }
    if (seen.has(batch.batchId)) return Object.freeze([]);
    if (cursor.worldId === batch.worldId && (batch.tick < cursor.tick || batch.generation < cursor.generation ||
        batch.facts.length && batch.facts[0].causalSequence <= cursor.lastSequence)) throw new Error('Stale physical batch requires an explicit checkpoint restore.');
    // Reject an uncovered source batch before touching active voices or the
    // duplicate ledger. Never substitute the transport's lookahead beat.
    if (scoreTimeline) {
      scoreTimeline.map({ simTick: batch.tick });
      for (const fact of batch.facts) scoreTimeline.map({ simTick: batch.tick,
        subTick: fact.subTick ?? 0, precision: fact.precision ?? 'tick' });
    }
    seen.add(batch.batchId); seenOrder.push(batch.batchId);
    if (seenOrder.length > 1024) seen.delete(seenOrder.shift());
    const output = [];
    if (generation !== null && (generation !== batch.generation || cursor.worldId !== batch.worldId)) {
      endMatching(batch, () => true, null, 'generation-change', output); travel.reset();
    }
    cursor = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick,
      lastSequence: batch.facts.at(-1)?.causalSequence ?? (cursor.worldId === batch.worldId ? cursor.lastSequence : -1), batchId: batch.batchId };
    generation = batch.generation;
    endMatching(batch, record => !liveIds.has(record.instrument.id) || record.graphRevision !== current.revision,
      null, 'mapping-changed', output);
    travel.release(record => record.graphRevision !== current.revision || !liveIds.has(record.instrumentId));
    if (batch.completeness.status !== 'complete') {
      endMatching(batch, () => true, null, 'incomplete-source', output);
      travel.reset();
      return publish(batch, output);
    }
    let begins = 0;
    const responds = (instrument, fact, stableCauseId = fact.eventId) => {
      const decision = causalRandomDecision({ seed: current.seed, mappingId: instrument.id, generation: batch.generation,
        stableCauseId, probability01: instrument.probability01 });
      if (traceLimit > 0) { decisions.push(decision); if (decisions.length > traceLimit) decisions.shift(); }
      return decision.accepted;
    };
    const reject = instrument => { rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); };
    for (const fact of batch.facts) {
      travel.observeLifecycle(batch, fact);
      if (fact.kind === 'ActionExited') endMatching(batch, record => record.actionInstanceId === fact.actionInstanceId && record.actorId === fact.actorId &&
        (!record.lifetimeScope || record.lifetimeScope === 'actionInstance'), fact, 'action-exited', output);
      if (fact.kind === 'ActorTerminated') endMatching(batch, record => record.actorId === fact.actorId, fact, fact.terminationReason || 'actor-terminated', output);
      if (fact.kind === 'ContactSpanEnded') endMatching(batch, record => record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId, fact, fact.reason || 'contact-ended', output);
      if (fact.kind === 'ContactSpanUpdated') for (const record of active.values()) {
        if (record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId && record.actorId === fact.actorId) {
          output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation,
            { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision, observedTick: fact.observedTick }));
        }
      }
      for (const instrument of indexed.get(fact.kind) || []) {
        if (fact.actorId == null || !nonempty(fact.eventId)) continue;
        if (instrument.action && fact.action !== instrument.action) continue;
        if (instrument.operationKind && fact.operationKind !== instrument.operationKind) continue;
        if (instrument.causeKind && fact.causeKind !== instrument.causeKind) continue;
        if (instrument.articulation) {
          let result;
          try { result = travel.consume(batch, fact, instrument.id, instrument.articulation, current.revision); }
          catch { reject(instrument); continue; }
          if (result.status !== 'accepted') {
            reject(instrument);
            endMatching(batch, record => record.instrument.id === instrument.id && record.actorId === fact.actorId, fact, result.reason, output);
            continue;
          }
          const state = result.state;
          const expression = Object.freeze({ travelPhase01: result.phase01, pathDistancePixels: state.pathDistancePixels,
            signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels });
          if (instrument.articulation.sustain && result.distancePixels > 0) {
            const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:travel:${state.scopeInstanceId}`;
            const existing = active.get(voiceId);
            if (existing) output.push(intentFor(batch, fact, instrument, 'update', voiceId, null, batch.generation, expression));
            else if (begins < maxBeginsPerBatch && active.size < maxVoices && responds(instrument, fact, `${fact.eventId}:sustain`)) {
              output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, expression)); begins++;
              active.set(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
                actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId,
                lifetimeScope: state.lifetimeScope, scopeInstanceId: state.scopeInstanceId });
            }
          }
          for (const crossing of result.crossings) {
            if (!responds(instrument, fact, `${fact.eventId}:travel:${crossing.ordinal}`)) continue;
            if (begins >= maxBeginsPerBatch) { reject(instrument); continue; }
            const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:${fact.eventId}:travel:${crossing.ordinal}`;
            const crossingExpression = { ...expression, crossing: Object.freeze(crossing) };
            output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, crossingExpression));
            output.push(intentFor(batch, fact, instrument, 'end', voiceId, 'one-shot')); begins++;
            accepted.set(instrument.id, (accepted.get(instrument.id) || 0) + 1);
          }
          continue;
        }
        if (instrument.sourceKind === 'MotionCommitted') {
          const before = fact.positionBefore?.x, after = fact.positionAfter?.x;
          const positive = Number.isFinite(before) && Number.isFinite(after) && before < instrument.gateX && after >= instrument.gateX;
          const negative = Number.isFinite(before) && Number.isFinite(after) && before > instrument.gateX && after <= instrument.gateX;
          if (!(positive && instrument.crossingDirection !== 'negative' || negative && instrument.crossingDirection !== 'positive')) continue;
        }
        if (instrument.changedOnly && !((fact.physicalPayload?.changedSolidCells || 0) > 0 || (fact.physicalPayload?.changedAppearanceCells || 0) > 0)) continue;
        if (!responds(instrument, fact)) continue;
        if (begins >= maxBeginsPerBatch || (['ActionEntered', 'ContactSpanBegan'].includes(fact.kind) && active.size >= maxVoices)) {
          rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); continue;
        }
        const sourceId = fact.kind === 'ActionEntered' ? fact.actionInstanceId : fact.kind === 'ContactSpanBegan' ? fact.spanId : fact.eventId;
        if (!nonempty(sourceId)) continue;
        const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:${sourceId}`;
        if (active.has(voiceId)) continue;
        output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation,
          fact.kind === 'ContactSpanBegan' ? { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision,
            observedTick: fact.observedTick } : {})); begins++;
        accepted.set(instrument.id, (accepted.get(instrument.id) || 0) + 1);
        if (fact.kind === 'ActionEntered' || fact.kind === 'ContactSpanBegan') active.set(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
          actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId,
          ...(fact.kind === 'ContactSpanBegan' ? { lifetimeScope: 'contactSpan', scopeInstanceId: fact.spanId } : {}) });
        else output.push(intentFor(batch, fact, instrument, 'end', voiceId, 'one-shot'));
      }
    }
    return publish(batch, output);
  };
  const snapshot = () => { getCurrentGraph(); return Object.freeze({ version: 1, generation, graphRevision: graph.revision, travel: travel.snapshot(), physicalCursor: Object.freeze({ ...cursor }),
    active: Object.freeze([...active.values()].map(record => Object.freeze({ voiceId: record.voiceId,
      instrumentId: record.instrument.id, graphRevision: record.graphRevision, generation: record.generation, actorId: record.actorId,
      laneId: record.laneId, actionInstanceId: record.actionInstanceId,
      ...(record.lifetimeScope ? { lifetimeScope: record.lifetimeScope, scopeInstanceId: record.scopeInstanceId } : {}) }))) }); };
  const restore = value => {
    const current = getCurrentGraph();
    if (value?.version !== 1 || value.graphRevision !== current.revision || !Array.isArray(value.active) || value.active.length > maxVoices) throw new Error('Incompatible causal engine checkpoint.');
    const nextCursor = value.physicalCursor ?? { worldId: null, generation: value.generation, tick: -1, lastSequence: -1, batchId: null };
    if (!plain(nextCursor) || (nextCursor.worldId != null && !nonempty(nextCursor.worldId)) ||
        !Number.isSafeInteger(nextCursor.tick) || nextCursor.tick < -1 || !Number.isSafeInteger(nextCursor.lastSequence) || nextCursor.lastSequence < -1 ||
        nextCursor.generation !== value.generation || (nextCursor.batchId != null && !nonempty(nextCursor.batchId))) throw new Error('Invalid causal source cursor checkpoint.');
    const next = new Map();
    for (const record of value.active) {
      const instrument = current.instruments.find(item => item.id === record.instrumentId);
      if (!plain(record) || !instrument || !voiceIdentity(record.voiceId) || (!record.lifetimeScope && !nonempty(record.actionInstanceId)) || next.has(record.voiceId) ||
          record.lifetimeScope && (!nonempty(record.scopeInstanceId) || record.lifetimeScope !== (instrument.articulation?.lifetimeScope ??
            (instrument.sourceKind === 'ContactSpanBegan' ? 'contactSpan' : null))) ||
          !Number.isSafeInteger(record.actorId) || !Number.isSafeInteger(record.generation) || record.generation !== value.generation ||
          record.graphRevision !== current.revision) throw new Error('Invalid causal voice checkpoint.');
      next.set(record.voiceId, { ...record, instrument });
    }
    if (value.travel) travel.restore(value.travel); else travel.reset();
    active.clear(); for (const [id, record] of next) active.set(id, record);
    seen.clear(); seenOrder.length = 0; generation = value.generation; cursor = { ...nextCursor };
    if (cursor.batchId) { seen.add(cursor.batchId); seenOrder.push(cursor.batchId); }
  };
  const diagnostics = () => Object.freeze({ activeVoices: active.size, deliveryErrors: errors, rejectedBegins: rejected,
    accepted: Object.freeze(Object.fromEntries(accepted)), rejected: Object.freeze(Object.fromEntries(rejectedByInstrument)),
    trace: Object.freeze([...trace]), decisions: Object.freeze([...decisions]) });
  return { processBatch, snapshot, restore, diagnostics };
};

export { createCausalMusicEngine, validateCausalInstrumentGraph };
