import { validateMappedBodyPreparation } from '../../../midi/content/PreparedSurface.js';
import { captureRevoiceLaneRouting } from './CausalLaneRouting.js';
import { validateEffectPerformance } from '../../../midi/content/EffectPerformance.js';
import { cloneJournalData, canonicalJournalText, freezeJournalData, journalError } from './CausalJournalCanonical.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { createCausalCoverageIndex, queryCausalCoverage } from './CausalCoverage.js';
import { createCausalViewWorkspace } from './CausalViewWorkspace.js';
import { retireCausalRead } from './CausalReadLeases.js';
import { validateCausalPerformanceChange, validateCausalPerformanceState } from './CausalPerformanceState.js';
import { routeDefinitionSignature } from './physical/RouteCoordinateAtlas.js';

const name = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const boundedKinds = value => Array.isArray(value) && value.length <= 128 && value.every(name) && new Set(value).size === value.length;
const validateCaptureProfile = value => {
  if (value?.version !== 1 || !name(value.id) || !boundedKinds(value.factKinds) || !boundedKinds(value.descriptorKinds) ||
      !boundedKinds(value.stateKinds)) throw new Error('A bounded, explicit causal capture profile is required.');
  return cloneJournalData(value);
};
const PHYSICAL_CAPTURE_PROFILE = freezeJournalData({ version: 1, id: 'physical-basic-v20',
  factKinds: ['ReleaseGestureRequested', 'ReleaseScheduleCommitted', 'CrewRouteOpened', 'CrewRouteConnected', 'CrewMemberArrived', 'RouteCompleted', 'RouteFailed', 'MotionCommitted', 'DirectionChanged', 'ContactResolved', 'ActionEntered', 'ActionExited', 'AbilityChanged',
    'ActionCycleCompleted', 'FlightArcStarted', 'FlightArcUpdated', 'FlightArcEnded', 'ActorTerminated', 'ActorBorn', 'BirthAdmissionMissed', 'ActorLaneTransferred', 'TerrainWorkCommitted', 'CommandApplied', 'CommandWaiting', 'CommandRejected', 'ContactSpanBegan', 'ContactSpanUpdated', 'ContactSpanEnded'],
  descriptorKinds: ['movement-path', 'work-phase-v2', 'topology-geometry-v1'], stateKinds: ['prepared-surfaces', 'effect-performance', 'voices', 'travel', 'contactSpans', 'timeline', 'instrument-performance', 'physical-domain', 'route-coordinate-history-v2', 'rhythmic-responses', 'action-admission', 'tonal-interpretation', 'encounters', 'motifs', 'activity', 'physical-feedback', 'cargo', 'swarm'] });

const createCausalTakeRecorder = async ({ journal, takeId, takeName, documentId, sourceVersions, captureProfile = PHYSICAL_CAPTURE_PROFILE,
  boundaryState = {}, initialCheckpoint, mapping, assetRefs = [], existingWriter = null, prefixCoverage = null, sourceCursor = null } = {}) => {
  const profile = validateCaptureProfile(captureProfile), graph = validateCausalInstrumentGraph(mapping);
  const initialPerformance = initialCheckpoint?.engine?.performanceInputs ? validateCausalPerformanceState(initialCheckpoint.engine.performanceInputs) : null;
  if (existingWriter && (!['appendMany', 'append', 'manifest', 'status', 'checkpoint', 'stop'].every(key => typeof existingWriter[key] === 'function') ||
      existingWriter.status().state !== 'recording' || existingWriter.manifest().takeId !== takeId || !existingWriter.manifest().prefix ||
      existingWriter.status().admittedSequence !== existingWriter.manifest().prefix.throughSequence ||
      sourceCursor?.journalSequence !== existingWriter.manifest().prefix.throughSequence || !name(sourceCursor.worldId) ||
      !Number.isSafeInteger(sourceCursor.tick) || sourceCursor.tick < 0 || !Number.isSafeInteger(sourceCursor.generation) || sourceCursor.generation < 0 ||
      !Number.isSafeInteger(sourceCursor.lastCausalSequence) || sourceCursor.lastCausalSequence < 0 ||
      !Array.isArray(prefixCoverage?.gaps) || prefixCoverage.gaps.length > 4096 || !boundedKinds(prefixCoverage.observedFactKinds) ||
      !boundedKinds(prefixCoverage.intentKinds) || prefixCoverage.topologyRegions != null && (!Array.isArray(prefixCoverage.topologyRegions) || prefixCoverage.topologyRegions.length > 4096 || prefixCoverage.topologyRegions.some(region => !name(region?.id) || !Number.isSafeInteger(region.revision) || region.revision < 0)) || !Array.isArray(prefixCoverage.mappingRevisions) || prefixCoverage.mappingRevisions.length > 4096 ||
      prefixCoverage.mappingRevisions.some(revision => !Number.isSafeInteger(revision) || revision < 0) ||
      canonicalJournalText(existingWriter.manifest().captureProfile).text !== canonicalJournalText(profile).text)) throw new Error('A branch recorder requires its admitted writer and qualified clipped prefix cursor.');
  if (!existingWriter && (prefixCoverage || sourceCursor)) throw new Error('Inherited take coverage requires an existing branch writer.');
  const writer = existingWriter || await journal.createTake({ takeId, takeName, documentId, sourceVersions, captureProfile: profile, boundaryState,
    initialCheckpoint, mapping: graph, assetRefs });
  const observedFactKinds = new Set(prefixCoverage?.observedFactKinds || []), intentKinds = new Set(prefixCoverage?.intentKinds || []),
    mappingRevisions = new Set([...(prefixCoverage?.mappingRevisions || []), graph.revision]);
  const topologyRegions = new Map((prefixCoverage?.topologyRegions || []).map(region => [`${region.id}:${region.revision}`, region]));
  const observedStateKinds = new Set(profile.stateKinds.filter(kind => Object.hasOwn(boundaryState, kind) && boundaryState[kind] != null));
  observedStateKinds.delete('route-coordinate-history-v2');
  const routeBoundary = initialCheckpoint?.engine?.physicalDomain?.routes;
  const routeDefinitions = routeBoundary?.version === 2 && Array.isArray(routeBoundary.signatures) ? (graph.routes || []).filter(route => routeBoundary.signatures.some(([id, signature]) => id === route.id && signature === routeDefinitionSignature(route))).map(route => ({ id: route.id, revision: route.revision, signature: routeDefinitionSignature(route) })) : [];
  if (routeDefinitions.length && profile.stateKinds.includes('route-coordinate-history-v2')) observedStateKinds.add('route-coordinate-history-v2');
  if (initialPerformance && profile.stateKinds.includes('instrument-performance')) observedStateKinds.add('instrument-performance');
  const coverageIndex = createCausalCoverageIndex({ gaps: prefixCoverage?.gaps || [] }), batches = new Set(), order = [];
  let firstTick = prefixCoverage?.sourceRange?.firstTick ?? null, lastTick = sourceCursor?.tick ?? null,
    lastGeneration = sourceCursor?.generation ?? null, nextGenerationBoundary = null, lastSequence = sourceCursor?.lastCausalSequence ?? -1,
    worldId = sourceCursor?.worldId ?? null, stopped = false, stopRequest = null;
  const addGap = coverageIndex.add;
  const observeEffectCoverage = (outcomes, tick, generation) => {
    for (const outcome of outcomes) {
      if (outcome?.stage === 'effect-performance-capture' && outcome.status === 'rejected') addGap({ kind: 'effect-performance', firstTick: tick, lastTick: tick, generation, reason: 'effect-performance-capture-rejected' });
      else if (outcome?.schema === 'lemmings-effect-performance/v1') {
        if (profile.stateKinds.includes('effect-performance')) observedStateKinds.add('effect-performance');
        else addGap({ kind: 'effect-performance', firstTick: tick, lastTick: tick, generation, reason: 'effect-performance-not-in-capture-profile' });
      }
    }
  };
  const recordCommittedBatch = ({ batch, intents, deliveryOutcomes = [], probability = null, bodyCommands = [] } = {}) => {
    if (stopped) return Object.freeze({ status: 'rejected', reason: 'take-stopped' });
    if (batch?.version !== 1 || !name(batch.batchId) || !name(batch.worldId) || !Number.isSafeInteger(batch.tick) || batch.tick < 0 ||
        !Number.isSafeInteger(batch.generation) || batch.generation < 0 || !Array.isArray(batch.facts) || batch.facts.length > 8192 ||
        !Array.isArray(bodyCommands) || bodyCommands.length > 1024 || !Array.isArray(intents) || intents.length > 8192 || !Array.isArray(deliveryOutcomes) || deliveryOutcomes.length > 16384) throw new Error('Invalid canonical performance boundary.');
    if (batches.has(batch.batchId)) return Object.freeze({ status: 'duplicate', batchId: batch.batchId });
    if (worldId != null && worldId !== batch.worldId || lastTick != null && batch.tick < lastTick ||
        lastGeneration != null && batch.generation < lastGeneration) throw new Error('Take source requires a new boundary identity or branch.');
    let sequence = lastSequence;
    for (const fact of batch.facts) {
      if (!Number.isSafeInteger(fact.causalSequence) || fact.causalSequence <= sequence || !name(fact.eventId)) throw new Error('Unordered canonical physical facts.');
      sequence = fact.causalSequence;
    }
    for (const intent of intents) if (intent?.version !== 1 || !name(intent.kind) || typeof intent.intentId !== 'string' ||
        !['begin', 'update', 'end'].includes(intent.kind) || !Array.isArray(intent.sourceEventIds) || intent.batchId !== batch.batchId) throw new Error('Invalid canonical musical intent.');
    bodyCommands = bodyCommands.map(command => { const value = validateMappedBodyPreparation(command); if (value.batchId !== batch.batchId || value.sourceTick !== batch.tick) throw new Error('Prepared body command differs from its canonical batch.'); return value; });
    if (probability && (probability.version !== 1 || probability.batchId !== batch.batchId || !Number.isSafeInteger(probability.requested) || !Number.isSafeInteger(probability.omitted) || probability.omitted < 0 || !Array.isArray(probability.decisions) || probability.decisions.length > 8192 || probability.requested !== probability.decisions.length + probability.omitted || JSON.stringify(probability).length * 2 > 1050624)) throw new Error('Invalid bounded causal probability evidence.');
    const entries = [{ kind: 'physical-batch', tick: batch.tick, generation: batch.generation, payload: batch },
      { kind: 'musical-intents', tick: batch.tick, generation: batch.generation, payload: { batchId: batch.batchId, intents, ...(bodyCommands.length ? { bodyCommands } : {}), ...(probability ? { probability } : {}) } }];
    if (deliveryOutcomes.length) entries.push({ kind: 'sink-outcome', tick: batch.tick, generation: batch.generation,
      payload: { batchId: batch.batchId, outcomes: deliveryOutcomes } });
    const receipt = writer.appendMany(entries);
    if (receipt.status !== 'accepted') return receipt;
    observeEffectCoverage(deliveryOutcomes, batch.tick, batch.generation);
    if (lastTick != null && batch.tick > lastTick + 1) addGap({ kind: 'physical-facts', firstTick: lastTick + 1,
      lastTick: batch.tick - 1, generation: lastGeneration, reason: 'unobserved-source-ticks' });
    if (lastGeneration != null && batch.generation !== lastGeneration && batch.generation !== nextGenerationBoundary) addGap({
      kind: 'physical-facts', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'unobserved-generation-boundary' });
    nextGenerationBoundary = batch.terminalGenerationTransition?.to ?? null;
    batches.add(batch.batchId); order.push(batch.batchId); if (order.length > 2048) batches.delete(order.shift());
    worldId = batch.worldId; firstTick ??= batch.tick; lastTick = batch.tick; lastGeneration = batch.generation; lastSequence = sequence;
    if (batch.completeness?.status !== 'complete') addGap({ kind: 'physical-facts', firstTick: batch.tick, lastTick: batch.tick,
      generation: batch.generation, reason: 'incomplete-source-batch', dropped: batch.completeness?.dropped ?? null });
    const topology = batch.snapshot?.topology;
    if (!topology?.regions?.length || topology.regions.some(region => region.status !== 'complete' || !region.current || region.current.sourceRevision !== batch.snapshot.terrainRevision)) addGap({ kind: 'topology-geometry-v1', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'qualified-topology-not-captured' });
    else for (const region of topology.regions) { const result = region.current, key = `${region.regionId}:${region.regionRevision}`; if (topologyRegions.size < 4096 || topologyRegions.has(key)) topologyRegions.set(key, { id: region.regionId, revision: region.regionRevision, bounds: result.bounds, connectivity: result.connectivity, space: result.space }); else addGap({ kind: 'topology-geometry-v1', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'topology-inventory-capacity' }); }
    let missingMovementPath = false, missingWorkPhase = false;
    for (const fact of batch.facts) {
      if (fact.kind) observedFactKinds.add(fact.kind);
      if (fact.kind === 'TerrainWorkCommitted' && fact.workVersion !== 2) missingWorkPhase = true;
      if (fact.kind === 'MotionCommitted' && fact.physicalPayload?.pathEvidence !== 'committed-coordinate-write') missingMovementPath = true;
    }
    if (missingWorkPhase) addGap({ kind: 'work-phase-v2', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'legacy-operation-phase-not-action-frame' });
    if (missingMovementPath) addGap({ kind: 'movement-path', firstTick: batch.tick, lastTick: batch.tick,
      generation: batch.generation, reason: 'endpoint-only-evidence' });
    for (const intent of intents) intentKinds.add(intent.kind);
    return receipt;
  };
  const record = (kind, payload, { tick = lastTick ?? 0, generation = lastGeneration ?? 0 } = {}) => {
    if (stopped) return Object.freeze({ status: 'rejected', reason: 'take-stopped' });
    return writer.append({ kind, tick, generation, payload });
  };
  const stop = async ({ boundaryState: finalBoundary = {}, finalCheckpoint = null, reason = 'user-stop' } = {}) => {
    stopped = true;
    const gaps = coverageIndex.snapshot();
    stopRequest ||= { reason, boundaryState: cloneJournalData(finalBoundary),
      finalCheckpoint: finalCheckpoint == null ? null : { value: finalCheckpoint, tick: lastTick ?? 0, generation: lastGeneration ?? 0 },
      coverage: { status: gaps.some(gap => ['physical-facts', 'all'].includes(gap.kind)) ? 'partial' : 'complete',
        sourceRange: { firstTick, lastTick, worldId }, available: { factKinds: profile.factKinds, descriptorKinds: profile.descriptorKinds,
          stateKinds: [...observedStateKinds] }, observedFactKinds: [...observedFactKinds].sort(), intentKinds: [...intentKinds].sort(),
        mappingRevisions: [...mappingRevisions], topologyRegions: [...topologyRegions.values()], routeDefinitions, gaps: cloneJournalData(gaps) } };
    return writer.stop(stopRequest);
  };
  const recordMapping = (next, boundary) => {
    const validated = validateCausalInstrumentGraph(next);
    if (validated.revision <= Math.max(...mappingRevisions)) throw new Error('A take mapping change needs a new revision.');
    const receipt = record('mapping', validated, boundary);
    if (receipt.status === 'accepted') mappingRevisions.add(validated.revision);
    return receipt;
  };
  const markGap = gap => {
    if (stopped) return Object.freeze({ status: 'rejected', reason: 'take-stopped' });
    if (!name(gap?.kind) || !name(gap.reason) || !Number.isSafeInteger(gap.firstTick) || gap.firstTick < 0 ||
        !Number.isSafeInteger(gap.lastTick) || gap.lastTick < gap.firstTick || !Number.isSafeInteger(gap.generation) || gap.generation < 0) throw new Error('Invalid causal take coverage gap.');
    const value = { kind: gap.kind, firstTick: gap.firstTick, lastTick: gap.lastTick, generation: gap.generation, reason: gap.reason };
    addGap(value);
    return record('marker', { type: 'coverage-gap', gap: value }, { tick: value.firstTick, generation: value.generation });
  };
  const status = () => { const gaps = coverageIndex.snapshot(); return freezeJournalData({ ...writer.status(), sourceBoundary: { worldId, tick: lastTick, generation: lastGeneration }, coverage: {
    status: gaps.some(gap => ['physical-facts', 'all'].includes(gap.kind)) ? 'partial' : 'complete', gaps, index: coverageIndex.diagnostics() } }); };
  return { recordCommittedBatch, recordIntervention: (command, outcome, boundary) => record('intervention', { command, outcome }, boundary),
    recordPerformance: (change, boundary, nextMapping = null) => {
      if (!profile.stateKinds.includes('instrument-performance')) return Object.freeze({ status: 'rejected', reason: 'performance-inputs-not-in-capture-profile' });
      const validated = validateCausalPerformanceChange(change), mapping = nextMapping ? validateCausalInstrumentGraph(nextMapping) : null;
      if (mapping && mapping.revision <= Math.max(...mappingRevisions)) throw new Error('A take mapping change needs a new revision.');
      const receipt = record('input-observation', { version: 1, kind: 'instrument-performance', change: validated, ...(mapping ? { mapping } : {}) }, boundary);
      if (receipt.status === 'accepted') { observedStateKinds.add('instrument-performance'); if (mapping) mappingRevisions.add(mapping.revision); } return receipt;
    },
    recordInput: (observation, boundary) => record('input-observation', observation, boundary),
    recordTimeline: (timeline, boundary) => { const receipt = record('timeline', timeline, boundary); if (receipt.status === 'accepted') observedStateKinds.add('timeline'); return receipt; }, recordMapping,
    recordSinkOutcome: (outcome, boundary) => {
      if (outcome?.schema === 'lemmings-effect-performance/v1' && !profile.stateKinds.includes('effect-performance')) return Object.freeze({ status: 'rejected', reason: 'effect-performance-not-in-capture-profile' });
      const receipt = record('sink-outcome', outcome, boundary); if (receipt.status === 'accepted') observeEffectCoverage([outcome], boundary?.tick ?? lastTick ?? 0, boundary?.generation ?? lastGeneration ?? 0); return receipt;
    },
    mark: (marker, boundary) => record('marker', marker, boundary), markGap, checkpoint: writer.checkpoint,
    flush: writer.flush, status, canReplaceDocument: writer.canReplaceDocument, stop, manifest: writer.manifest,
    discardPending: writer.discardPending };
};

const graphCaptureRequirements = graph => {
  const valid = validateCausalInstrumentGraph(graph), requirements = new Map();
  const add = (kind, owner, type) => requirements.set(`${type}:${kind}`, { kind, owner, type });
  if (valid.routes?.length) { add('route-coordinate-history-v2', 'route-atlas', 'state'); add('MotionCommitted', 'route-atlas', 'fact'); }
  for (const rule of [...(valid.feedback?.conductors || []), ...(valid.feedback?.layers || []).flatMap(layer => layer.rules)]) { add('physical-feedback', rule.id, 'state'); for (const kind of ['CommandApplied', 'CommandRejected', 'CommandWaiting', 'ActorBorn', 'ActorTerminated']) add(kind, rule.id, 'fact'); if (['PickupCrossing', 'RouteLap', 'EncounterBegan', 'RendezvousCompleted', 'MotifCompleted', 'RestStarted', 'RestEnded', 'CargoDelivered'].includes(rule.source.kind)) { add('MotionCommitted', rule.id, 'fact'); add('physical-domain', rule.id, 'state'); } else add(rule.source.kind, rule.id, 'fact'); }
  if (valid.swarm) { add('swarm', 'swarm-reducer', 'state'); add('voices', 'swarm-reducer', 'state'); }
  for (const surface of valid.preparedSurfaces || []) { add('prepared-surfaces', surface.id, 'state'); add('contactSpans', surface.id, 'state'); for (const kind of ['ContactSpanBegan', 'ContactSpanUpdated', 'ContactSpanEnded', 'ActorTerminated']) add(kind, surface.id, 'fact'); }
  for (const station of valid.cargoStations || []) { add('cargo', station.id, 'state'); add('ActorTerminated', station.id, 'fact'); add('ActorLaneTransferred', station.id, 'fact'); if (station.source.kind === 'contact') add('ContactResolved', station.id, 'fact'); else { add('MotionCommitted', station.id, 'fact'); add('physical-domain', station.id, 'state'); } if (station.source.kind === 'encounter') add('encounters', station.id, 'state'); }
  for (const definition of valid.encounters || []) { add('encounters', definition.id, 'state'); if (definition.pickupId || definition.routeId || definition.participants.leftEnsembleId || definition.participants.rightEnsembleId) add('physical-domain', definition.id, 'state'); for (const kind of ['ActorBorn', 'ActorTerminated', 'MotionCommitted']) add(kind, definition.id, 'fact'); }
  for (const definition of valid.activityWindows || []) { add('activity', definition.id, 'state'); add('voices', definition.id, 'state'); if (definition.scope.ensembleId || definition.scope.routeId) add('physical-domain', definition.id, 'state'); if (definition.scope.topologyRegionId) add('topology-geometry-v1', definition.id, 'descriptor'); for (const kind of definition.physicalKinds) { if (['PickupCrossing', 'RouteLap'].includes(kind)) { add('physical-domain', definition.id, 'state'); add('MotionCommitted', definition.id, 'fact'); } else if (['EncounterBegan', 'EncounterEnded', 'RendezvousCompleted'].includes(kind)) { add('encounters', definition.id, 'state'); add('MotionCommitted', definition.id, 'fact'); } else add(kind, definition.id, 'fact'); } if (definition.completionPolicy.kind === 'crew-route') for (const kind of ['CrewRouteOpened', 'CrewRouteConnected', 'CrewMemberArrived', 'RouteCompleted', 'RouteFailed']) add(kind, definition.id, 'fact'); }
  for (const definition of valid.motifs || []) {
    add('motifs', definition.id, 'state'); if (definition.roles.some(role => role.ensembleId)) add('physical-domain', definition.id, 'state');
    for (const clause of definition.clauses) { const kind = clause.predicate.kind; if (['EncounterBegan', 'EncounterEnded', 'RendezvousCompleted'].includes(kind)) { add('encounters', definition.id, 'state'); add('MotionCommitted', definition.id, 'fact'); } else if (['PickupCrossing', 'RouteLap'].includes(kind)) { add('physical-domain', definition.id, 'state'); add('MotionCommitted', definition.id, 'fact'); } else if (['RestStarted', 'RestEnded'].includes(kind)) add('activity', definition.id, 'state'); else add(kind, definition.id, 'fact'); }
  }
  for (const instrument of valid.instruments) {
    if (instrument.topologyRegionId) add('topology-geometry-v1', instrument.id, 'descriptor');
    if (instrument.harmonicFields || instrument.formationId) { add('tonal-interpretation', instrument.id, 'state'); add('MotionCommitted', instrument.id, 'fact'); if (valid.ensembles?.length) add('physical-domain', instrument.id, 'state'); }
    if (instrument.actionVoicePolicy) { add('action-admission', instrument.id, 'state'); add('ActionExited', instrument.id, 'fact'); add('MotionCommitted', instrument.id, 'fact'); if (instrument.actionVoicePolicy.beginCondition === 'contact') add('ContactResolved', instrument.id, 'fact'); }
    if (instrument.voiceTransfer) add('ActorLaneTransferred', instrument.id, 'fact');
    if (instrument.response) {
      add('rhythmic-responses', instrument.id, 'state');
      const sources = instrument.response.type === 'crowdInterval' ? ['MotionCommitted', 'ActorBorn'] : instrument.response.type === 'flightArc' ? ['FlightArcStarted', 'FlightArcUpdated', 'FlightArcEnded'] : instrument.response.type === 'workCycle' ? ['TerrainWorkCommitted', 'ActionCycleCompleted', 'ActionExited'] : ['ContactResolved', 'ActorTerminated'];
      for (const source of sources) add(source, instrument.id, 'fact');
      if (instrument.response.type === 'crowdInterval') add('physical-domain', instrument.id, 'state');
      if (instrument.response.type === 'workCycle') add('work-phase-v2', instrument.id, 'descriptor');
    } else if (instrument.sourceKind === 'CargoDelivery') { add('cargo', instrument.id, 'state'); } else if (instrument.sourceKind === 'CadenceResponse') { add('activity', instrument.id, 'state'); } else if (instrument.sourceKind === 'MotifResponse') { add('motifs', instrument.id, 'state'); } else if (instrument.sourceKind === 'EncounterResponse') { add('encounters', instrument.id, 'state'); add('MotionCommitted', instrument.id, 'fact'); } else if (['PickupCrossing', 'RouteLap'].includes(instrument.sourceKind)) { add('MotionCommitted', instrument.id, 'fact'); if (valid.ensembles?.length) add('physical-domain', instrument.id, 'state'); }
    else add(instrument.sourceKind, instrument.id, 'fact');
    if (instrument.ensembleId) { add('physical-domain', instrument.id, 'state'); add('ActorBorn', instrument.id, 'fact'); }
    if (instrument.sourceKind === 'ActionEntered' || instrument.sourceKind === 'ContactSpanBegan' || instrument.sourceKind === 'PickupCrossing' || instrument.articulation?.sustain || instrument.response?.sustain || instrument.response?.mode === 'scrape') add('voices', instrument.id, 'state');
    if (instrument.articulation) {
      add('travel', instrument.id, 'state');
      if (instrument.articulation.metric === 'qualified-route-arc-pixels') { add('physical-domain', instrument.id, 'state'); add('MotionCommitted', instrument.id, 'fact'); }
      if (instrument.articulation.metric === 'segment-path') add('movement-path', instrument.id, 'descriptor');
      if (instrument.articulation.lifetimeScope === 'contactSpan') add('contactSpans', instrument.id, 'state');
    }
  }
  return [...requirements.values()];
};
const planCausalReinterpretation = ({ manifest, graph, range = null, verifiedReconstruction = null } = {}) => {
  if (manifest?.schema !== 'lemmings-causal-take' || manifest.version !== 1) throw new Error('Unsupported semantic take.');
  const requested = range || manifest.coverage?.sourceRange;
  if (!requested || !Number.isSafeInteger(requested.firstTick) || !Number.isSafeInteger(requested.lastTick) || requested.lastTick < requested.firstTick) throw new Error('Reinterpretation needs a known source range.');
  const profile = validateCaptureProfile(manifest.captureProfile), coverage = manifest.coverage || {}, available = coverage.available || profile;
  const reconstruction = verifiedReconstruction?.verified === true && verifiedReconstruction.sourceTakeId === manifest.takeId &&
    verifiedReconstruction.sourceCanonicalHash === manifest.canonicalHash &&
    canonicalJournalText(verifiedReconstruction.sourceVersions ?? null).text === canonicalJournalText(manifest.sourceVersions).text &&
    canonicalJournalText(verifiedReconstruction.assetRefs ?? null).text === canonicalJournalText(manifest.assetRefs).text ? verifiedReconstruction : null;
  const results = graphCaptureRequirements(graph).map(requirement => {
    const keys = requirement.type === 'fact' ? 'factKinds' : requirement.type === 'state' ? 'stateKinds' : 'descriptorKinds';
    const queried = queryCausalCoverage({ coverage, kind: requirement.kind, range: requested });
    const missing = [...queried.missingRanges, ...queried.unknownRanges];
    const outside = missing.some(gap => gap.reason === 'outside-captured-range');
    const captured = available[keys]?.includes(requirement.kind) === true;
    if (requirement.kind === 'topology-geometry-v1') { const wanted = validateCausalInstrumentGraph(graph).topologyRegions || []; if (wanted.some(region => !coverage.topologyRegions?.some(captured => captured.id === region.id && captured.revision === region.revision && captured.connectivity === region.connectivity && captured.space === region.space && canonicalJournalText(captured.bounds).text === canonicalJournalText(region.bounds).text))) return { ...requirement, status: 'unavailable', reason: 'topology-region-not-captured' }; }
    if (requirement.kind === 'route-coordinate-history-v2' && validateCausalInstrumentGraph(graph).routes.some(route => !coverage.routeDefinitions?.some(value => value.id === route.id && value.revision === route.revision && value.signature === routeDefinitionSignature(route)))) return { ...requirement, status: 'unavailable', reason: 'route-definition-history-not-captured' };
    if (captured && queried.status === 'known-covered') return { ...requirement, status: 'supported-directly' };
    if (reconstruction?.coverage?.[keys]?.includes(requirement.kind) && reconstruction.firstTick <= requested.firstTick && reconstruction.lastTick >= requested.lastTick) {
      return { ...requirement, status: 'supported-by-verified-reconstruction', artifactId: reconstruction.artifactId };
    }
    return { ...requirement, status: queried.status === 'unknown' ? 'unknown' : 'unavailable', coverageStatus: queried.status,
      reason: outside ? 'outside-captured-range' : queried.status === 'unknown' ? 'coverage-unknown' : missing.length ? 'coverage-gap' : 'not-captured', missingRanges: missing,
      reconstructionCandidate: !!manifest.initialCheckpoint && !!manifest.sourceVersions && Array.isArray(manifest.assetRefs) };
  });
  return freezeJournalData({ version: 1, takeId: manifest.takeId, takeRevision: manifest.revision, sourceCanonicalHash: manifest.canonicalHash,
    operation: 'causal-reinterpretation', range: requested, mappingRevision: graph.revision,
    supported: results.every(result => result.status.startsWith('supported-')), requirements: results,
    originalRecordMutated: false });
};

const querySoundOnlyRevoiceOwned = async ({ journal, takeId, takeRevision, soundPatch, firstTick, lastTick, generation,
  firstSequence = 1, includeEffects = false, limit = 4096, maxIntents = 65536, maxBytes = 4194304, executionEpoch, resourceBudget = null, jobs, signal } = {}) => {
  if (typeof includeEffects !== 'boolean' || !name(executionEpoch) || typeof takeId !== 'string' || !takeId || takeId.length > 256 || !soundPatch || typeof soundPatch !== 'object' || Array.isArray(soundPatch) ||
      !Number.isSafeInteger(firstSequence) || firstSequence < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 65536 ||
      !Number.isSafeInteger(maxIntents) || maxIntents < 1 || maxIntents > 262144 || !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 32 * 1048576 ||
      takeRevision != null && (!Number.isSafeInteger(takeRevision) || takeRevision < 1) || generation != null && (!Number.isSafeInteger(generation) || generation < 0))
    throw new Error('Revoice needs bounded source, intent and sound-patch identities with a fresh playback execution epoch.');
  let workspace = null, operationError = null;
  try {
    workspace = createCausalViewWorkspace({ journal, resourceBudget, jobs, signal, ownerId: 'sound-only-revoice',
      baseBytes: 65536 + limit * 128 + maxIntents * 32 + maxBytes * 4 });
    const patch = cloneJournalData(soundPatch, { maxBytes: Math.min(maxBytes, 262144), maxNodes: 16384 });
    const manifest = await workspace.take(takeId);
    if (takeRevision != null && manifest.revision !== takeRevision) throw journalError('stale-revision', 'Revoice source revision has changed.');
    const range = { firstTick: firstTick ?? manifest.coverage?.sourceRange?.firstTick, lastTick: lastTick ?? manifest.coverage?.sourceRange?.lastTick };
    const coverage = queryCausalCoverage({ coverage: manifest.coverage, range, kind: 'musical-intents', generation });
    const slice = await workspace.page({ takeId, takeRevision: manifest.revision, ...range, generation, firstSequence, kinds: ['musical-intents', 'input-observation', ...(includeEffects ? ['sink-outcome'] : [])], limit, signal });
    let count = 0;
    for (const record of slice.records) {
      if (record.kind !== 'musical-intents') continue;
      if (!Array.isArray(record.payload?.intents) || record.payload.intents.length > 8192) throw journalError('invalid-intent-source', 'The captured intent record is malformed.');
      count += record.payload.intents.length;
      if (count > maxIntents) throw journalError('revoice-capacity', 'This revoice window contains too many intents; narrow its source range or page size.');
    }
    const intents = new Array(count), bodyCommands = []; let offset = 0;
    for (const record of slice.records) if (record.kind === 'musical-intents') for (const intent of record.payload.intents) intents[offset++] = intent;
    for (const record of slice.records) if (record.kind === 'musical-intents' && record.payload.bodyCommands != null) {
      if (!Array.isArray(record.payload.bodyCommands) || record.payload.bodyCommands.length > 1024 || bodyCommands.length + record.payload.bodyCommands.length > 65536) throw journalError('prepared-body-command-capacity', 'Prepared body commands exceed this revoice window.');
      for (const command of record.payload.bodyCommands) bodyCommands.push(validateMappedBodyPreparation(command));
    }
    const effectEvents = [];
    if (includeEffects) for (const record of slice.records) if (record.kind === 'sink-outcome') for (const outcome of Array.isArray(record.payload?.outcomes) ? record.payload.outcomes : [record.payload]) {
      if (outcome?.schema === 'lemmings-effect-performance/v1') { if (effectEvents.length >= 8192) throw journalError('effect-performance-capacity', 'Captured effect commands exceed the render window.'); effectEvents.push(validateEffectPerformance(outcome)); }
    }
    const initialBoundary = firstSequence === 1 && generation == null && !manifest.prefix && range.firstTick === manifest.coverage?.sourceRange?.firstTick;
    const laneRouting = initialBoundary ? captureRevoiceLaneRouting(slice.records, manifest.boundaryState?.['instrument-performance'] || manifest.initialCheckpoint?.engine?.performanceInputs, manifest.coverage?.available?.stateKinds?.includes('instrument-performance') === true && queryCausalCoverage({ coverage: manifest.coverage, range, kind: 'instrument-performance', generation }).status === 'known-covered' && queryCausalCoverage({ coverage: manifest.coverage, range, kind: 'input-observation', generation }).status === 'known-covered') : null;
    return await workspace.publish({ version: 1, operation: 'sound-only-revoice', takeId, takeRevision: slice.takeRevision,
      sourceCanonicalHash: manifest.canonicalHash, sourceVersions: manifest.sourceVersions, sourceState: manifest.state, sourceComplete: manifest.complete,
      finalBoundaryState: manifest.stopBoundaryState || null, executionEpoch, soundPatch: patch,
      ...(includeEffects ? { effectEvents, effectCoverage: { captured: manifest.coverage?.available?.stateKinds?.includes('effect-performance') === true, gaps: (manifest.coverage?.gaps || []).filter(gap => ['effect-performance', 'all'].includes(gap.kind)) } } : {}),
      ...(laneRouting ? { laneRouting } : {}), ...(bodyCommands.length ? { bodyCommands, bodyPreparationPolicy: includeEffects ? 'captured-effect-commands-required;no-remapping-physical-facts' : 'source-only-revoice-excludes-prepared-body-output' } : {}), intents, intentCount: count, nextSequence: slice.nextSequence, range, generation: generation ?? null, coverage,
      boundary: { status: initialBoundary ? 'captured-initial-state' : 'requires-state-reconstruction',
        state: initialBoundary ? manifest.boundaryState : null, sourceOnsetsSynthesized: false },
      sourceRecords: { firstSequence: slice.records[0]?.sequence ?? null, lastSequence: slice.records.at(-1)?.sequence ?? null, count: slice.records.length },
      originalRecordMutated: false, inspection: { paused: true, hardware: false, recording: false, thru: false } },
    { sourceRevision: manifest.canonicalHash, maxBytes });
  } catch (error) { operationError = error; throw error; }
  finally {
    if (workspace) {
      const receipt = workspace.dispose(); await receipt.completion;
      if (receipt.outcome !== 'complete') throw journalError('view-retirement-unknown', 'Revoice source cleanup is unresolved.', { cause: operationError, retirement: receipt });
    }
  }
};
const querySoundOnlyRevoice = async options => {
  const loan = await querySoundOnlyRevoiceOwned(options);
  try { return loan.value; } finally { retireCausalRead(loan); }
};
const compareCausalRecords = (expected, actual) => {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    const left = expected[index], right = actual[index];
    if (canonicalJournalText(left ?? null).text !== canonicalJournalText(right ?? null).text) {
      const leftFacts = left?.payload?.facts || [], rightFacts = right?.payload?.facts || [];
      let factIndex = 0;
      while (factIndex < Math.max(leftFacts.length, rightFacts.length) &&
        canonicalJournalText(leftFacts[factIndex] ?? null).text === canonicalJournalText(rightFacts[factIndex] ?? null).text) factIndex++;
      return freezeJournalData({ equal: false,
        firstDivergence: { sequence: left?.sequence ?? right?.sequence ?? index + 1, tick: left?.tick ?? right?.tick ?? null,
          causeId: leftFacts[factIndex]?.eventId ?? rightFacts[factIndex]?.eventId ?? null,
          expectedKind: left?.kind ?? null, actualKind: right?.kind ?? null } });
    }
  }
  return Object.freeze({ equal: true, comparedRecords: length });
};

export { PHYSICAL_CAPTURE_PROFILE, validateCaptureProfile, createCausalTakeRecorder, graphCaptureRequirements,
  planCausalReinterpretation, querySoundOnlyRevoice, querySoundOnlyRevoiceOwned, compareCausalRecords };
