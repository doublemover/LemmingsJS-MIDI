const SOURCE_KINDS = new Set(['TerrainWorkCommitted', 'ContactResolved', 'MotionCommitted', 'ActionEntered']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
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
    if (input.sourceKind === 'MotionCommitted' && (!Number.isFinite(input.gateX) || Math.abs(input.gateX) > 1000000000 ||
        !['either', 'positive', 'negative'].includes(input.crossingDirection ?? 'either'))) throw new Error('Motion instrument needs a valid gate.');
    if (input.sourceKind === 'TerrainWorkCommitted' && input.operationKind != null && !nonempty(input.operationKind)) throw new Error('Invalid work operation.');
    if (input.sourceKind === 'ContactResolved' && input.causeKind != null && !nonempty(input.causeKind)) throw new Error('Invalid contact cause.');
    return Object.freeze({ id: input.id, sourceKind: input.sourceKind, action: input.action ?? null,
      operationKind: input.operationKind ?? null, causeKind: input.causeKind ?? null,
      gateX: input.sourceKind === 'MotionCommitted' ? input.gateX : null,
      crossingDirection: input.crossingDirection ?? 'either',
      changedOnly: input.changedOnly === true, pitchCents: input.pitchCents, velocity01: input.velocity01,
      route: input.route, role: input.role, mute: input.mute === true, solo: input.solo === true });
  });
  return Object.freeze({ version: 1, revision: value.revision, instruments: Object.freeze(instruments) });
};

const createCausalMusicEngine = ({ getGraph, deliver = () => {}, scoreTimeline = null,
  maxBeginsPerBatch = 512, maxVoices = 512, traceLimit = 1024 } = {}) => {
  if (typeof getGraph !== 'function' || (scoreTimeline && typeof scoreTimeline.map !== 'function')) throw new Error('A causal graph provider and valid score timeline are required.');
  const active = new Map(), seen = new Set(), seenOrder = [], trace = [];
  let generation = null, graph = null, graphSource = null, graphFingerprint = null, liveIds = null, indexed = null, errors = 0, rejected = 0;
  const accepted = new Map(), rejectedByInstrument = new Map();
  const remember = intent => { if (traceLimit > 0) { trace.push(intent); if (trace.length > traceLimit) trace.shift(); } };
  const intentFor = (batch, fact, instrument, kind, voiceId, reason = null, voiceGeneration = batch.generation) => Object.freeze({
    version: 1, intentId: `${batch.batchId}:${instrument.id}:${voiceId}:${kind}`,
    worldId: batch.worldId, batchId: batch.batchId, generation: voiceGeneration,
    kind, onsetId: voiceId, voiceId, actorId: fact?.actorId ?? null, laneId: fact?.laneId ?? null,
    sourceEventIds: Object.freeze(fact?.eventId ? [fact.eventId] : []),
    scoreTime: Object.freeze({ ...(scoreTimeline?.map({ simTick: batch.tick, subTick: fact?.subTick ?? 0,
      precision: fact?.precision ?? 'tick' }) || { simTick: batch.tick, subTick: fact?.subTick ?? 0,
      precision: fact?.precision ?? 'tick' }), sourceTimeMs: batch.sourceTimeMs ?? null }),
    pitch: Object.freeze({ cents: instrument.pitchCents, referenceHz: 440 }), velocity01: instrument.velocity01,
    expression: Object.freeze({}), role: instrument.role, route: instrument.route, terminationReason: reason
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
    // Reject an uncovered source batch before touching active voices or the
    // duplicate ledger. Never substitute the transport's lookahead beat.
    if (scoreTimeline) {
      scoreTimeline.map({ simTick: batch.tick });
      for (const fact of batch.facts) scoreTimeline.map({ simTick: batch.tick,
        subTick: fact.subTick ?? 0, precision: fact.precision ?? 'tick' });
    }
    if (seen.has(batch.batchId)) return Object.freeze([]);
    seen.add(batch.batchId); seenOrder.push(batch.batchId);
    if (seenOrder.length > 1024) seen.delete(seenOrder.shift());
    const output = [];
    if (generation !== null && generation !== batch.generation) endMatching(batch, () => true, null, 'generation-change', output);
    generation = batch.generation;
    endMatching(batch, record => !liveIds.has(record.instrument.id) || record.graphRevision !== current.revision,
      null, 'mapping-changed', output);
    if (batch.completeness.status !== 'complete') {
      endMatching(batch, () => true, null, 'incomplete-source', output);
      return publish(batch, output);
    }
    let begins = 0;
    for (const fact of batch.facts) {
      if (fact.kind === 'ActionExited') endMatching(batch, record => record.actionInstanceId === fact.actionInstanceId && record.actorId === fact.actorId, fact, 'action-exited', output);
      if (fact.kind === 'ActorTerminated') endMatching(batch, record => record.actorId === fact.actorId, fact, fact.terminationReason || 'actor-terminated', output);
      for (const instrument of indexed.get(fact.kind) || []) {
        if (fact.actorId == null || !nonempty(fact.eventId)) continue;
        if (instrument.action && fact.action !== instrument.action) continue;
        if (instrument.operationKind && fact.operationKind !== instrument.operationKind) continue;
        if (instrument.causeKind && fact.causeKind !== instrument.causeKind) continue;
        if (instrument.sourceKind === 'MotionCommitted') {
          const before = fact.positionBefore?.x, after = fact.positionAfter?.x;
          const positive = Number.isFinite(before) && Number.isFinite(after) && before < instrument.gateX && after >= instrument.gateX;
          const negative = Number.isFinite(before) && Number.isFinite(after) && before > instrument.gateX && after <= instrument.gateX;
          if (!(positive && instrument.crossingDirection !== 'negative' || negative && instrument.crossingDirection !== 'positive')) continue;
        }
        if (instrument.changedOnly && !((fact.physicalPayload?.changedSolidCells || 0) > 0 || (fact.physicalPayload?.changedAppearanceCells || 0) > 0)) continue;
        if (begins >= maxBeginsPerBatch || (fact.kind === 'ActionEntered' && active.size >= maxVoices)) {
          rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); continue;
        }
        const sourceId = fact.kind === 'ActionEntered' ? fact.actionInstanceId : fact.eventId;
        if (!nonempty(sourceId)) continue;
        const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:${sourceId}`;
        if (active.has(voiceId)) continue;
        output.push(intentFor(batch, fact, instrument, 'begin', voiceId)); begins++;
        accepted.set(instrument.id, (accepted.get(instrument.id) || 0) + 1);
        if (fact.kind === 'ActionEntered') active.set(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
          actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId });
        else output.push(intentFor(batch, fact, instrument, 'end', voiceId, 'one-shot'));
      }
    }
    return publish(batch, output);
  };
  const snapshot = () => { getCurrentGraph(); return Object.freeze({ version: 1, generation, graphRevision: graph.revision,
    active: Object.freeze([...active.values()].map(record => Object.freeze({ voiceId: record.voiceId,
      instrumentId: record.instrument.id, graphRevision: record.graphRevision, generation: record.generation, actorId: record.actorId,
      laneId: record.laneId, actionInstanceId: record.actionInstanceId }))) }); };
  const restore = value => {
    const current = getCurrentGraph();
    if (value?.version !== 1 || value.graphRevision !== current.revision || !Array.isArray(value.active) || value.active.length > maxVoices) throw new Error('Incompatible causal engine checkpoint.');
    const next = new Map();
    for (const record of value.active) {
      const instrument = current.instruments.find(item => item.id === record.instrumentId);
      if (!plain(record) || !instrument || !voiceIdentity(record.voiceId) || !nonempty(record.actionInstanceId) || next.has(record.voiceId) ||
          !Number.isSafeInteger(record.actorId) || !Number.isSafeInteger(record.generation) || record.generation !== value.generation ||
          record.graphRevision !== current.revision) throw new Error('Invalid causal voice checkpoint.');
      next.set(record.voiceId, { ...record, instrument });
    }
    active.clear(); for (const [id, record] of next) active.set(id, record);
    seen.clear(); seenOrder.length = 0; generation = value.generation;
  };
  const diagnostics = () => Object.freeze({ activeVoices: active.size, deliveryErrors: errors, rejectedBegins: rejected,
    accepted: Object.freeze(Object.fromEntries(accepted)), rejected: Object.freeze(Object.fromEntries(rejectedByInstrument)),
    trace: Object.freeze([...trace]) });
  return { processBatch, snapshot, restore, diagnostics };
};

export { createCausalMusicEngine, validateCausalInstrumentGraph };
