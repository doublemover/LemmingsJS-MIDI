import { createRhythmicResponses, validateRhythmicResponse, RHYTHMIC_SOURCE_KINDS } from './physical/RhythmicResponses.js';
import { createPhysicalMusicDomain, validatePhysicalDomain, DERIVED_PHYSICAL_KINDS } from './physical/PhysicalMusicDomain.js';
import { validateInstrumentControls, captureInstrumentCause, INSTRUMENT_PHYSICAL_SOURCE_KINDS } from '../../../midi/content/InstrumentPerformance.js';
import { causalRandomDecision } from './CausalRandom.js';
import { createTravelAccumulator, validateArticulationField } from './TravelAccumulator.js';
import { validateCausalPerformanceState } from './CausalPerformanceState.js';

const SOURCE_KINDS = new Set(['TerrainWorkCommitted', 'ContactResolved', 'MotionCommitted', 'ActionEntered', 'ContactSpanBegan', ...DERIVED_PHYSICAL_KINDS, ...RHYTHMIC_SOURCE_KINDS]);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const voiceIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

// A graph is content, not code. Validation happens before any live state is
// changed, and the resulting descriptors contain only bounded primitives.
const validateCausalInstrumentGraph = value => {
  if (!plain(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.instruments) || value.instruments.length > 256) throw new Error('Unsupported causal instrument graph.');
  const domain = validatePhysicalDomain(value);
  const ids = new Set();
  const instruments = value.instruments.map(input => {
    if (!plain(input) || !nonempty(input.id) || ids.has(input.id) || !SOURCE_KINDS.has(input.sourceKind) ||
        !Number.isFinite(input.pitchCents) || Math.abs(input.pitchCents) > 24000 ||
        !Number.isFinite(input.velocity01) || input.velocity01 < 0 || input.velocity01 > 1 ||
        !nonempty(input.route) || !nonempty(input.role)) throw new Error('Invalid causal instrument.');
    ids.add(input.id);
    if (input.sourceKind === 'PickupCrossing' && !domain.pickups.some(pickup => pickup.id === input.pickupId)) throw new Error('Pickup instrument needs a valid pickup reference.');
    if (input.sourceKind === 'RouteLap' && !domain.routes.some(route => route.id === input.routeId)) throw new Error('Route instrument needs a valid route reference.');
    if (input.ensembleId && !domain.ensembles.some(ensemble => ensemble.id === input.ensembleId)) throw new Error('Instrument ensemble reference is unavailable.');
    if (RHYTHMIC_SOURCE_KINDS.includes(input.sourceKind) && !input.response) throw new Error('Rhythmic instruments require an explicit response contract.');
    const response = input.response ? validateRhythmicResponse(input.response, input.sourceKind) : null;
    if (response?.pickupId && !domain.pickups.some(pickup => pickup.id === response.pickupId) || response?.routeId && !domain.routes.some(route => route.id === response.routeId) || response?.ensembleId && !domain.ensembles.some(ensemble => ensemble.id === response.ensembleId)) throw new Error('Physical response references an unavailable object.');
    if (input.sourceKind === 'ActionEntered' && !nonempty(input.action)) throw new Error('Action instrument needs an action.');
    if (input.sourceKind === 'MotionCommitted' && !input.articulation && (!Number.isFinite(input.gateX) || Math.abs(input.gateX) > 1000000000 ||
        !['either', 'positive', 'negative'].includes(input.crossingDirection ?? 'either'))) throw new Error('Motion instrument needs a valid gate.');
    if (input.articulation && input.sourceKind !== 'MotionCommitted') throw new Error('Travel articulation requires committed motion.');
    if (input.probability01 != null && (!Number.isFinite(input.probability01) || input.probability01 < 0 || input.probability01 > 1)) throw new Error('Invalid response probability.');
    if (input.sourceKind === 'TerrainWorkCommitted' && input.operationKind != null && !nonempty(input.operationKind)) throw new Error('Invalid work operation.');
    if (['ContactResolved', 'ContactSpanBegan'].includes(input.sourceKind) && input.causeKind != null && !nonempty(input.causeKind)) throw new Error('Invalid contact cause.');
    if ([input.sampleGesture, input.sampleKitId].some(value => value != null && (typeof value !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)))) throw new Error('Invalid authored sample gesture or kit identity.');
    return Object.freeze({ id: input.id, sourceKind: input.sourceKind, ...(response ? { response } : {}), action: input.action ?? null,
      ...(input.pickupId ? { pickupId: input.pickupId } : {}), ...(input.routeId ? { routeId: input.routeId } : {}),
      ...(input.ensembleId ? { ensembleId: input.ensembleId } : {}),
      operationKind: input.operationKind ?? null, causeKind: input.causeKind ?? null,
      gateX: input.sourceKind === 'MotionCommitted' ? input.gateX : null,
      articulation: input.articulation ? validateArticulationField(input.articulation) : null,
      probability01: input.probability01 ?? 1,
      crossingDirection: input.crossingDirection ?? 'either',
      changedOnly: input.changedOnly === true, pitchCents: input.pitchCents, velocity01: input.velocity01,
      ...(input.sampleGesture != null ? { sampleGesture: input.sampleGesture } : {}), ...(input.sampleKitId != null ? { sampleKitId: input.sampleKitId } : {}),
      route: input.route, role: input.role, mute: input.mute === true, solo: input.solo === true });
  });
  if (value.seed != null && !Number.isSafeInteger(value.seed)) throw new Error('Invalid causal graph seed.');
  return Object.freeze({ version: 1, revision: value.revision, seed: value.seed ?? 0, instruments: Object.freeze(instruments),
    ...(value.pickups ? { pickups: domain.pickups } : {}), ...(value.ensembles ? { ensembles: domain.ensembles } : {}), ...(value.routes ? { routes: domain.routes } : {}) });
};

const createCausalMusicEngine = ({ getGraph, deliver = () => {}, scoreTimeline = null,
  getOnsetControls = () => undefined, getPhysicalControlKinds = () => [], getPerformanceState = () => null,
  maxBeginsPerBatch = 512, maxVoices = 512, maxPhysicalUpdatesPerBatch = 2048, traceLimit = 1024 } = {}) => {
  if (typeof getGraph !== 'function' || (scoreTimeline && typeof scoreTimeline.map !== 'function')) throw new Error('A causal graph provider and valid score timeline are required.');
  if (!Number.isSafeInteger(maxPhysicalUpdatesPerBatch) || maxPhysicalUpdatesPerBatch < 0 || maxPhysicalUpdatesPerBatch > 4096) throw new Error('Invalid physical control budget.');
  let physical = createPhysicalMusicDomain(), rhythmic = createRhythmicResponses();
  const instrumentEpochs = new Map();
  const active = new Map(), suppressed = new Map(), byActor = new Map(), seen = new Set(), seenOrder = [], trace = [];
  const validControlKinds = kinds => Array.isArray(kinds) && kinds.length <= INSTRUMENT_PHYSICAL_SOURCE_KINDS.length && new Set(kinds).size === kinds.length && kinds.every(kind => INSTRUMENT_PHYSICAL_SOURCE_KINDS.includes(kind));
  const addVoice = (voiceId, record, restoring = false) => {
    const kinds = restoring ? record.physicalSourceKinds || [] : getPhysicalControlKinds(record.laneId);
    if (!validControlKinds(kinds)) throw new Error('Invalid held physical control sources.');
    record.physicalSourceKinds = Object.freeze([...kinds].sort()); active.set(voiceId, record);
    if (!kinds.length) return;
    let records = byActor.get(record.actorId);
    if (!records) { records = new Set(); byActor.set(record.actorId, records); } records.add(record);
  };
  let travel = createTravelAccumulator({ maxEntries: Math.max(1, maxVoices) }); const decisions = [];
  let generation = null, graph = null, graphSource = null, graphFingerprint = null, liveIds = null, indexed = null, errors = 0, rejected = 0;
  let recoveryRequired = false;
  let cursor = { worldId: null, generation: null, tick: -1, lastSequence: -1, batchId: null };
  const accepted = new Map(), rejectedByInstrument = new Map();
  const remember = intent => { if (traceLimit > 0) { trace.push(intent); if (trace.length > traceLimit) trace.shift(); } };
  const timeFor = (batch, fact) => fact?.derivedObservation ? { simTick: fact.subTick >= 1 ? batch.tick : Math.max(0, batch.tick - 1), subTick: fact.subTick >= 1 ? 0 : fact.subTick ?? 0, precision: 'interpolated' } : { simTick: batch.tick, subTick: fact?.subTick ?? 0, precision: fact?.precision ?? 'tick' };
  const intentFor = (batch, fact, instrument, kind, voiceId, reason = null, voiceGeneration = batch.generation, expression = {}, articulationState = null) => Object.freeze({
    version: 1, intentId: `${batch.batchId}:${instrument.id}:${voiceId}:${fact?.eventId || 'boundary'}:${kind}`,
    worldId: batch.worldId, batchId: batch.batchId, generation: voiceGeneration,
    kind, onsetId: voiceId, voiceId, actorId: fact?.actorId ?? null, laneId: fact?.laneId ?? null,
    sourceEventIds: Object.freeze(fact?.sourceEventIds ? [...fact.sourceEventIds] : fact?.eventId ? [fact.eventId] : []),
    ...(fact?.responseDescriptor ? { responseDescriptor: Object.freeze(fact.responseDescriptor) } : {}),
    ...(Number.isFinite(fact?.gateTicks) ? { responseGateTicks: fact.gateTicks } : {}),
    ...(fact?.derivedObservation ? { observationId: fact.observationId, observation: Object.freeze({ kind: fact.kind, gateId: fact.gateId ?? null, gateRevision: fact.gateRevision ?? null, routeId: fact.routeId ?? null, routeRevision: fact.routeRevision ?? null, local01: fact.local01 ?? null, direction: fact.direction ?? null, periodTicks: fact.periodTicks ?? null, precision: fact.observationPrecision || fact.precision }) } : {}),
    causalSequence: fact?.causalSequence ?? null, mappingId: instrument.id,
    actionInstanceId: fact?.actionInstanceId ?? null,
    scoreTime: Object.freeze({ ...(scoreTimeline?.map(timeFor(batch, fact)) || timeFor(batch, fact)), sourceTimeMs: batch.sourceTimeMs ?? null,
      sourceTickDurationMs: Number.isFinite(batch.tickDurationMs) && batch.tickDurationMs > 0 ? batch.tickDurationMs : null }),
    pitch: Object.freeze({ cents: (fact?.derivedObservation || fact?.derivedResponse) && Number.isFinite(fact.pitchCents) ? fact.pitchCents : instrument.pitchCents, referenceHz: 440 }), velocity01: Number.isFinite(fact?.velocity01) ? fact.velocity01 : instrument.velocity01,
    expression: Object.freeze(expression), role: instrument.role, route: instrument.route, terminationReason: reason,
    ...(fact?.sampleGesture != null ? { sampleGesture: fact.sampleGesture } : instrument.sampleGesture != null ? { sampleGesture: instrument.sampleGesture } : {}), ...(instrument.sampleKitId != null ? { sampleKitId: instrument.sampleKitId } : {}),
    ...(articulationState ? { articulationState: Object.freeze(articulationState) } : {}),
    ...(kind === 'begin' ? { performanceControls: validateInstrumentControls(getOnsetControls(fact?.laneId)), performanceCause: captureInstrumentCause(fact?.physicalCauseFact || fact) } : {})
  });
  const publish = (batch, intents) => {
    const sealed = Object.freeze(intents);
    for (const intent of sealed) remember(intent);
    try { deliver(sealed, batch); } catch { errors++; }
    return sealed;
  };
  const endVoice = (batch, record, fact, reason, output) => {
    active.delete(record.voiceId);
    const records = byActor.get(record.actorId); records?.delete(record); if (!records?.size) byActor.delete(record.actorId);
    output.push(intentFor(batch, fact || { actorId: record.actorId, laneId: record.laneId }, record.instrument, 'end', record.voiceId, reason, record.generation));
  };
  const endMatching = (batch, predicate, fact, reason, output) => {
    for (const record of [...active.values()]) if (predicate(record)) endVoice(batch, record, fact, reason, output);
    for (const record of suppressed.values()) if (predicate(record)) suppressed.delete(record.voiceId);
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
      const previousById = new Map((graph?.instruments || []).map(instrument => [instrument.id, instrument]));
      const dependencies = (source, instrument) => JSON.stringify([source?.pickups?.find(value => value.id === (instrument?.pickupId || instrument?.response?.pickupId)), source?.routes?.find(value => value.id === (instrument?.routeId || instrument?.response?.routeId)), source?.ensembles?.find(value => value.id === (instrument?.ensembleId || instrument?.response?.ensembleId)), source?.ensembles?.find(value => value.id === source?.pickups?.find(pickup => pickup.id === (instrument?.pickupId || instrument?.response?.pickupId))?.ensembleId)]);
      const unchanged = new Set(next.instruments.filter(instrument => graph?.seed === next.seed && JSON.stringify(previousById.get(instrument.id)) === JSON.stringify(instrument) && dependencies(graph, previousById.get(instrument.id)) === dependencies(next, instrument)).map(instrument => instrument.id));
      for (const id of instrumentEpochs.keys()) if (!next.instruments.some(instrument => instrument.id === id)) instrumentEpochs.delete(id);
      for (const instrument of next.instruments) if (!unchanged.has(instrument.id) || !instrumentEpochs.has(instrument.id)) instrumentEpochs.set(instrument.id, next.revision);
      for (const record of [...active.values(), ...suppressed.values()]) if (unchanged.has(record.instrument.id)) record.graphRevision = next.revision;
      travel.rebaseGraph(next.revision, record => unchanged.has(record.instrumentId));
      physical.configure(next); rhythmic.configure(next.instruments);
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
      endMatching(batch, () => true, null, 'generation-change', output); travel.reset(); physical.reset(); rhythmic.reset();
    }
    cursor = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick,
      lastSequence: batch.facts.at(-1)?.causalSequence ?? (cursor.worldId === batch.worldId ? cursor.lastSequence : -1), batchId: batch.batchId };
    generation = batch.generation;
    endMatching(batch, record => !liveIds.has(record.instrument.id) || record.graphRevision !== current.revision,
      null, 'mapping-changed', output);
    travel.release(record => record.graphRevision !== current.revision || !liveIds.has(record.instrumentId));
    if (batch.completeness.status !== 'complete') {
      endMatching(batch, () => true, null, 'incomplete-source', output);
      travel.reset(); physical.reset(); rhythmic.reset(); recoveryRequired = true;
      return publish(batch, output);
    }
    if (recoveryRequired) return publish(batch, output);
    const observations = physical.observe(batch);
    const responses = rhythmic.expand(batch, [...batch.facts, ...observations.facts].sort((a, b) => a.causalSequence - b.causalSequence || (a.subTick || 0) - (b.subTick || 0)), physical);
    if (observations.completeness.status !== 'complete' || responses.completeness.status !== 'complete') { endMatching(batch, () => true, null, 'incomplete-physical-observation', output); recoveryRequired = true; return publish(batch, output); }
    endMatching(batch, record => { if (!record.instrument.ensembleId) return false; const member = physical.membership(record.instrument.ensembleId, record.actorId); return member.status !== 'complete' || !member.includes; }, null, 'ensemble-membership-ended', output);
    const sourceFacts = [...batch.facts, ...observations.facts, ...responses.facts].sort((a, b) => a.causalSequence - b.causalSequence || (a.subTick || 0) - (b.subTick || 0) || (a.observationId || '').localeCompare(b.observationId || ''));
    let begins = 0, physicalUpdates = 0;
    const responds = (instrument, fact, stableCauseId = fact.eventId) => {
      const decision = causalRandomDecision({ seed: current.seed, mappingId: instrument.id, generation: batch.generation,
        stableCauseId: stableCauseId || fact.observationId, probability01: instrument.probability01 });
      if (traceLimit > 0) { decisions.push(decision); if (decisions.length > traceLimit) decisions.shift(); }
      return decision.accepted;
    };
    const reject = instrument => { rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); };
    for (const fact of sourceFacts) {
      if (fact.kind === 'PickupCrossing' && fact.transition === 'exit') endMatching(batch, record => record.lifetimeScope === 'pickupOccupancy' && record.scopeInstanceId === `${fact.gateId}:${fact.actorId}`, fact, fact.reason || 'pickup-exit', output);
      travel.observeLifecycle(batch, fact);
      if (fact.kind === 'ActionExited') endMatching(batch, record => record.actionInstanceId === fact.actionInstanceId && record.actorId === fact.actorId &&
        (!record.lifetimeScope || record.lifetimeScope === 'actionInstance'), fact, 'action-exited', output);
      if (fact.kind === 'ActorTerminated') endMatching(batch, record => record.actorId === fact.actorId, fact, fact.terminationReason || 'actor-terminated', output);
      if (fact.kind === 'ContactSpanEnded') endMatching(batch, record => record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId, fact, fact.reason || 'contact-ended', output);
      if (fact.kind === 'ContactSpanUpdated') for (const record of active.values()) {
        if (record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId && record.actorId === fact.actorId) {
          output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation, {},
            { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision, observedTick: fact.observedTick }));
        }
      }
      const cause = byActor.has(fact.actorId) ? captureInstrumentCause(fact) : null;
      if (cause) for (const record of [...byActor.get(fact.actorId)]) {
        if (!record.physicalSourceKinds.includes(cause.sourceKind)) continue;
        if (physicalUpdates >= maxPhysicalUpdatesPerBatch) { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, 'physical-control-budget', output); continue; }
        const intent = intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation);
        output.push(Object.freeze({ ...intent, intentId: intent.intentId + ':physical', performanceCause: cause })); physicalUpdates++;
      }
      for (const instrument of indexed.get(fact.kind) || []) {
        if (fact.actorId == null || !nonempty(fact.eventId) && !fact.editRetrigger) continue;
        if (fact.targetMappingId && fact.targetMappingId !== instrument.id || instrument.response && !fact.derivedResponse) continue;
        if (fact.lifecycle && fact.responseScope) {
          const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:${fact.responseScope}`;
          const existing = active.get(voiceId);
          if (fact.lifecycle === 'end') { if (existing) endVoice(batch, existing, fact, fact.reason || 'response-ended', output); suppressed.delete(voiceId); continue; }
          if (fact.lifecycle === 'update') { if (existing && physicalUpdates < maxPhysicalUpdatesPerBatch) { output.push(intentFor(batch, fact, instrument, 'update', voiceId, null, batch.generation, fact.expression || {})); physicalUpdates++; } else if (existing) { suppressed.set(voiceId, existing); endVoice(batch, existing, fact, 'physical-control-budget', output); } continue; }
          if (existing || suppressed.has(voiceId)) continue;
          const member = physical.membership(instrument.ensembleId, fact.actorId); if (member.status !== 'complete' || !member.includes) continue;
          if (begins >= maxBeginsPerBatch || active.size + suppressed.size >= maxVoices || !responds(instrument, fact)) { reject(instrument); continue; }
          output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, fact.expression || {})); begins++;
          addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation, actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId, lifetimeScope: fact.lifetimeScope || 'actorJourney', scopeInstanceId: fact.responseScope });
          continue;
        }
        if (instrument.pickupId && instrument.pickupId !== fact.gateId || instrument.routeId && instrument.routeId !== fact.routeId || fact.occupancy && fact.transition === 'exit') continue;
        const member = physical.membership(instrument.ensembleId, fact.actorId); if (member.status !== 'complete' || !member.includes) continue;
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
          const articulationState = Object.freeze({ travelPhase01: result.phase01, pathDistancePixels: state.pathDistancePixels,
            signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels });
          if (instrument.articulation.sustain && result.distancePixels > 0) {
            const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:travel:${state.scopeInstanceId}`;
            const existing = active.get(voiceId);
            if (existing) output.push(intentFor(batch, fact, instrument, 'update', voiceId, null, batch.generation, {}, articulationState));
            else if (!suppressed.has(voiceId) && begins < maxBeginsPerBatch && active.size + suppressed.size < maxVoices && responds(instrument, fact, `${fact.eventId}:sustain`)) {
              output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, {}, articulationState)); begins++;
              addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
                actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId,
                lifetimeScope: state.lifetimeScope, scopeInstanceId: state.scopeInstanceId });
            }
          }
          for (const crossing of result.crossings) {
            if (!responds(instrument, fact, `${fact.eventId}:travel:${crossing.ordinal}`)) continue;
            if (begins >= maxBeginsPerBatch) { reject(instrument); continue; }
            const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:${fact.eventId}:travel:${crossing.ordinal}`;
            const crossingState = { ...articulationState, crossing: Object.freeze(crossing) };
            output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, {}, crossingState));
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
        if (begins >= maxBeginsPerBatch || ((['ActionEntered', 'ContactSpanBegan'].includes(fact.kind) || fact.occupancy) && active.size + suppressed.size >= maxVoices)) {
          rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); continue;
        }
        const sourceId = fact.occupancy ? `occupancy:${fact.gateId}:${fact.actorId}` : fact.observationId || (fact.kind === 'ActionEntered' ? fact.actionInstanceId : fact.kind === 'ContactSpanBegan' ? fact.spanId : fact.eventId);
        if (!voiceIdentity(sourceId)) continue;
        const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:${sourceId}`;
        if (active.has(voiceId) || suppressed.has(voiceId)) continue;
        output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, {},
          fact.kind === 'ContactSpanBegan' ? { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision,
            observedTick: fact.observedTick } : null)); begins++;
        accepted.set(instrument.id, (accepted.get(instrument.id) || 0) + 1);
        if (fact.kind === 'ActionEntered' || fact.kind === 'ContactSpanBegan' || fact.occupancy) addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
          actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId,
          ...(fact.occupancy ? { lifetimeScope: 'pickupOccupancy', scopeInstanceId: `${fact.gateId}:${fact.actorId}` } : fact.kind === 'ContactSpanBegan' ? { lifetimeScope: 'contactSpan', scopeInstanceId: fact.spanId } : {}) });
        else output.push(intentFor(batch, fact, instrument, 'end', voiceId, 'one-shot'));
      }
    }
    return publish(batch, output);
  };
  const serializeVoices = records => Object.freeze([...records.values()].map(record => Object.freeze({ voiceId: record.voiceId,
    instrumentId: record.instrument.id, graphRevision: record.graphRevision, generation: record.generation, actorId: record.actorId,
    laneId: record.laneId, actionInstanceId: record.actionInstanceId,
    ...(record.physicalSourceKinds.length ? { physicalSourceKinds: record.physicalSourceKinds } : {}),
    ...(record.lifetimeScope ? { lifetimeScope: record.lifetimeScope, scopeInstanceId: record.scopeInstanceId } : {}) })));
  const snapshot = () => { getCurrentGraph(); const performance = getPerformanceState(); return Object.freeze({ version: 1, generation, graphRevision: graph.revision, recoveryRequired, instrumentEpochs: Object.freeze(Object.fromEntries(instrumentEpochs)), travel: travel.snapshot(), ...(graph.instruments.some(instrument => instrument.response) ? { rhythmicResponses: rhythmic.snapshot() } : {}), ...(graph.pickups?.length || graph.ensembles?.length || graph.routes?.length ? { physicalDomain: physical.snapshot() } : {}), physicalCursor: Object.freeze({ ...cursor }),
    ...(performance ? { performanceInputs: validateCausalPerformanceState(performance) } : {}),
    active: serializeVoices(active), ...(suppressed.size ? { suppressed: serializeVoices(suppressed) } : {}) }); };
  const restore = value => {
    const current = getCurrentGraph();
    if (value?.performanceInputs && JSON.stringify(validateCausalPerformanceState(value.performanceInputs)) !== JSON.stringify(validateCausalPerformanceState(getPerformanceState())))
      throw new Error('Causal performance inputs differ from the checkpoint.');
    if (value?.version !== 1 || value.graphRevision !== current.revision || !Array.isArray(value.active) || !Array.isArray(value.suppressed ?? []) || value.active.length + (value.suppressed?.length || 0) > maxVoices) throw new Error('Incompatible causal engine checkpoint.');
    const nextCursor = value.physicalCursor ?? { worldId: null, generation: value.generation, tick: -1, lastSequence: -1, batchId: null };
    if (!plain(nextCursor) || (nextCursor.worldId != null && !nonempty(nextCursor.worldId)) ||
        !Number.isSafeInteger(nextCursor.tick) || nextCursor.tick < -1 || !Number.isSafeInteger(nextCursor.lastSequence) || nextCursor.lastSequence < -1 ||
        nextCursor.generation !== value.generation || (nextCursor.batchId != null && !nonempty(nextCursor.batchId))) throw new Error('Invalid causal source cursor checkpoint.');
    const seenVoices = new Set(), readVoices = records => {
      const next = new Map();
      for (const record of records) {
        const instrument = plain(record) ? current.instruments.find(item => item.id === record.instrumentId) : null;
        if (!plain(record) || !instrument || !voiceIdentity(record.voiceId) || (!record.lifetimeScope && !nonempty(record.actionInstanceId)) || seenVoices.has(record.voiceId) ||
          record.lifetimeScope && (!voiceIdentity(record.scopeInstanceId) || record.lifetimeScope !== (instrument.articulation?.lifetimeScope ??
            (instrument.response ? record.lifetimeScope === 'actionInstance' ? 'actionInstance' : 'actorJourney' : instrument.sourceKind === 'PickupCrossing' ? 'pickupOccupancy' : instrument.sourceKind === 'ContactSpanBegan' ? 'contactSpan' : null))) ||
          !Number.isSafeInteger(record.actorId) || !Number.isSafeInteger(record.generation) || record.generation !== value.generation ||
          record.graphRevision !== current.revision || !validControlKinds(record.physicalSourceKinds || [])) throw new Error('Invalid causal voice checkpoint.');
        seenVoices.add(record.voiceId); next.set(record.voiceId, { ...record, instrument, physicalSourceKinds: Object.freeze([...(record.physicalSourceKinds || [])].sort()) });
      } return next;
    };
    if (value.instrumentEpochs != null && (!plain(value.instrumentEpochs) || Object.entries(value.instrumentEpochs).some(([id, epoch]) => !current.instruments.some(instrument => instrument.id === id) || !Number.isSafeInteger(epoch) || epoch < 0 || epoch > current.revision))) throw new Error('Invalid instrument owner epochs.');
    const next = readVoices(value.active), nextSuppressed = readVoices(value.suppressed || []);
    if (current.instruments.some(instrument => instrument.response) && !value.rhythmicResponses || (current.pickups?.length || current.ensembles?.length || current.routes?.length) && !value.physicalDomain) throw new Error('Physical interpretation boundary state is missing.');
    const nextRhythmic = createRhythmicResponses(), nextPhysical = createPhysicalMusicDomain(), nextTravel = createTravelAccumulator({ maxEntries: Math.max(1, maxVoices) });
    nextRhythmic.configure(current.instruments); nextPhysical.configure(current);
    if (value.rhythmicResponses) nextRhythmic.restore(value.rhythmicResponses);
    if (value.physicalDomain) nextPhysical.restore(value.physicalDomain);
    if (value.travel) nextTravel.restore(value.travel);
    rhythmic = nextRhythmic; physical = nextPhysical; travel = nextTravel;
    active.clear(); byActor.clear(); suppressed.clear(); for (const [id, record] of next) addVoice(id, record, true);
    for (const [id, record] of nextSuppressed) suppressed.set(id, record);
    if (value.instrumentEpochs) { instrumentEpochs.clear(); for (const [id, epoch] of Object.entries(value.instrumentEpochs)) instrumentEpochs.set(id, epoch); }
    recoveryRequired = value.recoveryRequired === true;
    seen.clear(); seenOrder.length = 0; generation = value.generation; cursor = { ...nextCursor };
    if (cursor.batchId) { seen.add(cursor.batchId); seenOrder.push(cursor.batchId); }
  };
  const diagnostics = () => Object.freeze({ physical: physical.diagnostics(), rhythmic: rhythmic.diagnostics(), recoveryRequired, recoveryAction: recoveryRequired ? 'restore-complete-boundary-or-explicit-rearm' : null, activeVoices: active.size, suppressedVoices: suppressed.size, deliveryErrors: errors, rejectedBegins: rejected,
    accepted: Object.freeze(Object.fromEntries(accepted)), rejected: Object.freeze(Object.fromEntries(rejectedByInstrument)),
    trace: Object.freeze([...trace]), decisions: Object.freeze([...decisions]) });
  return { processBatch, snapshot, restore, diagnostics, rearm({ discardUnknownHeldState = false } = {}) {
    if (!discardUnknownHeldState || active.size || suppressed.size) throw new Error('Rearming requires explicit discard of unknown held state at an empty boundary.');
    recoveryRequired = false; return Object.freeze({ status: 'rearmed', resumesHeldVoices: false, sourceBoundary: Object.freeze({ ...cursor }) });
  } };
};

export { createCausalMusicEngine, validateCausalInstrumentGraph };
