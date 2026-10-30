import { validatePreparedSurfaceDefinitions, createPreparedSurfaceMapping } from './physical/PreparedSurfaceMapping.js';
import { validatePreparedBodyStrike } from '../../../midi/content/PreparedBodyStrike.js';
import { captureCircularContactCoordinate } from '../../../midi/content/CircularSpectrum.js';
import { registerPhysicalGraphAdmission } from '../PhysicalGraphAdmission.js';
import { createCausalObserverResources } from './CausalObserverResources.js';
import { estimateJournalBytes } from './CausalJournalCanonical.js';
import { validateSwarmReducer, createSwarmReducer } from './physical/SwarmReducer.js';
import { validatePhraseCargoStations, createPhraseCargoObserver } from './physical/PhraseCargo.js';
import { validatePhysicalFeedback } from './physical/PhysicalFeedbackSchema.js';
import { validateActivityWindows, createActivityWindowObserver } from './physical/ActivityWindows.js';
import { validatePhysicalMotifs, createPhysicalMotifObserver } from './physical/PhysicalMotifs.js';
import { freeze as freezePhysical } from './physical/PhysicalSchema.js';
import { validateEncounterDomain, createEncounterObserver } from './physical/Encounters.js';
import { validateTopologyRegions, bindTopologyFact, validateTopologyResult } from './physical/TopologyInstrumentRegion.js';
import { validateTonalDomain, createTonalInterpretation } from './physical/TonalInterpretation.js';
import { validateActionVoicePolicy, validateVoiceTransferPolicy, createActionVoiceAdmission, actionExpression, actionVoiceName } from './physical/ActionVoicePolicy.js';
import { createRhythmicResponses, validateRhythmicResponse, RHYTHMIC_SOURCE_KINDS } from './physical/RhythmicResponses.js';
import { createPhysicalMusicDomain, validatePhysicalDomain, DERIVED_PHYSICAL_KINDS } from './physical/PhysicalMusicDomain.js';
import { validateInstrumentControls, captureInstrumentCause, INSTRUMENT_PHYSICAL_SOURCE_KINDS } from '../../../midi/content/InstrumentPerformance.js';
import { validateCausalProbabilityPolicy, validateCausalSeedSet, causalNamespaceSeed, createCausalProbabilityContext, causalPolicyDecision } from './CausalProbabilityPolicy.js';
import { createTravelAccumulator, validateArticulationField } from './TravelAccumulator.js';
import { validateCausalPerformanceState } from './CausalPerformanceState.js';

const SOURCE_KINDS = new Set(['TerrainWorkCommitted', 'ContactResolved', 'MotionCommitted', 'ActionEntered', 'ContactSpanBegan', 'EncounterResponse', 'MotifResponse', 'CadenceResponse', 'CargoDelivery', ...DERIVED_PHYSICAL_KINDS, ...RHYTHMIC_SOURCE_KINDS]);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const voiceIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

const sourceLaneIncluded = (instrument, lane) => {
  if (!instrument.sourceLanes) return true;
  let low = 0, high = instrument.sourceLanes.length;
  while (low < high) { const middle = low + high >>> 1; if (instrument.sourceLanes[middle] < lane) low = middle + 1; else high = middle; }
  return instrument.sourceLanes[low] === lane;
};

// A graph is content, not code. Validation happens before any live state is
// changed, and the resulting descriptors contain only bounded primitives.
const validateCausalInstrumentGraph = value => {
  if (!plain(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.instruments) || value.instruments.length > 256) throw new Error('Unsupported causal instrument graph.');
  const preparedSurfaces = validatePreparedSurfaceDefinitions(value.preparedSurfaces);
  const domain = validatePhysicalDomain(value), tonal = validateTonalDomain(value, domain), topologyRegions = validateTopologyRegions(value.topologyRegions), encounterDefinitions = validateEncounterDomain(value, domain), activityDefinitions = validateActivityWindows(value, { ...domain, topologyRegions }), motifDefinitions = validatePhysicalMotifs(value, { ...domain, encounters: encounterDefinitions, activityWindows: activityDefinitions });
  const cargoStations = validatePhraseCargoStations(value.cargoStations, { ...domain, encounters: encounterDefinitions });
  const swarm = validateSwarmReducer(value.swarm), randomSeeds = validateCausalSeedSet(value.randomSeeds, ['musical-response', 'physical-route']);
  const feedback = validatePhysicalFeedback(value.feedback, { ...domain, motifs: motifDefinitions, cargoStations });
  const ids = new Set();
  const instruments = value.instruments.map(input => {
    if (!plain(input) || !nonempty(input.id) || ids.has(input.id) || !SOURCE_KINDS.has(input.sourceKind) ||
        !Number.isFinite(input.pitchCents) || Math.abs(input.pitchCents) > 24000 ||
        !Number.isFinite(input.velocity01) || input.velocity01 < 0 || input.velocity01 > 1 ||
        !nonempty(input.route) || !nonempty(input.role)) throw new Error('Invalid causal instrument.');
    ids.add(input.id);
    const preparedBodyStrike = input.preparedBodyStrike == null ? null : validatePreparedBodyStrike(input.preparedBodyStrike);
    if (preparedBodyStrike ? input.route !== 'prepared-body' || !['ContactResolved', 'ContactSpanBegan'].includes(input.sourceKind) || !preparedSurfaces.some(surface => surface.id === preparedBodyStrike.surfaceId && surface.revision === preparedBodyStrike.surfaceRevision) || input.articulation || input.response || input.actionVoicePolicy || input.topologyRegionId || input.formationId || input.harmonicFields || input.voiceTransfer || input.sampleGesture || input.sampleKitId || swarm || feedback : input.route === 'prepared-body') throw new Error('Finite body strikes require a saved current surface, direct contact intent and fixed prepared-body tuning.');
    if (input.topologyRegionId && (!topologyRegions.some(r => r.id === input.topologyRegionId) || !['TerrainWorkCommitted', 'ContactResolved', 'ContactSpanBegan'].includes(input.sourceKind) || input.harmonicFields || input.formationId || input.response || input.articulation)) throw new Error('Unsupported topology instrument composition.');
    if (input.activityWindowId && !activityDefinitions.some(value => value.id === input.activityWindowId)) throw new Error('Unresolved instrument activity window.');
    if (input.cargoRole != null && (input.sourceKind !== 'CargoDelivery' || !nonempty(input.cargoRole) || input.cargoRole.length > 64)) throw new Error('Invalid cargo role mapping.');
    if (input.sourceKind === 'CargoDelivery' && !cargoStations.some(station => station.id === input.cargoStationId && station.kind === 'delivery')) throw new Error('Cargo instruments require an actual delivery station.');
    if (input.sourceKind === 'CadenceResponse' && (!activityDefinitions.some(value => value.id === input.activityWindowId && value.completionPolicy.kind === 'crew-route') || activityDefinitions.find(value => value.id === input.activityWindowId).completionPolicy.intervals.some(offset => Math.abs(input.pitchCents + offset) > 24000))) throw new Error('Cadence needs an authored physical completion policy.');
    if (input.sourceKind === 'MotifResponse' && (!motifDefinitions.some(value => value.id === input.motifId) || motifDefinitions.find(value => value.id === input.motifId).completionMapping.intervals.some(offset => Math.abs(input.pitchCents + offset) > 24000))) throw new Error('Motif response needs a valid bounded completion mapping.');
    if (input.sourceKind === 'EncounterResponse' && (!encounterDefinitions.some(value => value.id === input.encounterId) || encounterDefinitions.find(value => value.id === input.encounterId).response.intervals.some(offset => Math.abs(input.pitchCents + offset) > 24000))) throw new Error('Encounter response instrument needs a valid encounter reference.');
    if (input.formationId && !tonal.formations.some(value => value.id === input.formationId)) throw new Error('Unknown formation harmony.');
    if (input.sourceKind === 'PickupCrossing' && !domain.pickups.some(pickup => pickup.id === input.pickupId)) throw new Error('Pickup instrument needs a valid pickup reference.');
    if (input.sourceKind === 'RouteLap' && !domain.routes.some(route => route.id === input.routeId)) throw new Error('Route instrument needs a valid route reference.');
    if (input.ensembleId && !domain.ensembles.some(ensemble => ensemble.id === input.ensembleId)) throw new Error('Instrument ensemble reference is unavailable.');
    if (RHYTHMIC_SOURCE_KINDS.includes(input.sourceKind) && !input.response) throw new Error('Rhythmic instruments require an explicit response contract.');
    const response = input.response ? validateRhythmicResponse(input.response, input.sourceKind) : null;
    if (response?.pickupId && !domain.pickups.some(pickup => pickup.id === response.pickupId) || response?.routeId && !domain.routes.some(route => route.id === response.routeId) || response?.ensembleId && !domain.ensembles.some(ensemble => ensemble.id === response.ensembleId)) throw new Error('Physical response references an unavailable object.');
    if (input.actionVoicePolicy && input.sourceKind !== 'ActionEntered') throw new Error('Action voice policies require action-entry sources.');
    const actionVoicePolicy = input.actionVoicePolicy ? validateActionVoicePolicy(input.actionVoicePolicy) : null;
    const voiceTransfer = input.voiceTransfer ? validateVoiceTransferPolicy(input.voiceTransfer) : null;
    if (input.sourceKind === 'ActionEntered' && !actionVoicePolicy && !nonempty(input.action)) throw new Error('Action instrument needs an action.');
    if (input.sourceKind === 'MotionCommitted' && !input.articulation && (!Number.isFinite(input.gateX) || Math.abs(input.gateX) > 1000000000 ||
        !['either', 'positive', 'negative'].includes(input.crossingDirection ?? 'either'))) throw new Error('Motion instrument needs a valid gate.');
    if (input.articulation?.metric === 'qualified-route-arc-pixels' && !domain.routes.some(route => route.id === input.articulation.routeId)) throw new Error('Directed travel requires an existing qualified route atlas definition.');
    const contactTravel = input.contactTravel == null ? null : validateArticulationField(input.contactTravel);
    if (contactTravel && (input.sourceKind !== 'ContactSpanBegan' || input.route !== 'local' || input.causeKind !== 'support' || contactTravel.lifetimeScope !== 'contactSpan' || !['segment-path', 'endpoint-chord'].includes(contactTravel.metric) || contactTravel.orientation !== 'unsigned' || contactTravel.phaseMode !== 'contact-stroke' || contactTravel.sustain !== true || input.articulation || input.preparedBodyStrike || input.topologyRegionId || input.actionVoicePolicy || input.response || input.voiceTransfer || input.formationId || input.harmonicFields)) throw new Error('Contact travel requires one local support-contact voice and its bounded unsigned contact path.');
    if (input.articulation && input.sourceKind !== 'MotionCommitted') throw new Error('Travel articulation requires committed motion.');
    if (input.sourceLanes !== undefined && (!Array.isArray(input.sourceLanes) || !input.sourceLanes.length || input.sourceLanes.length > 1024 || input.sourceLanes.some(lane => !Number.isInteger(lane) || lane < 0 || lane >= 1024) || new Set(input.sourceLanes).size !== input.sourceLanes.length)) throw new Error('Instrument source lanes must be unique physical source indices.');
    const probability = validateCausalProbabilityPolicy(input.probability);
    if (input.workChangePolicy != null && (input.sourceKind !== 'TerrainWorkCommitted' || !['solid', 'appearance', 'attempt'].includes(input.workChangePolicy))) throw new Error('Work change policy requires an explicit actual operation source.');
    if (input.sourceKind === 'TerrainWorkCommitted' && input.operationKind != null && !nonempty(input.operationKind)) throw new Error('Invalid work operation.');
    if (['ContactResolved', 'ContactSpanBegan'].includes(input.sourceKind) && input.causeKind != null && !nonempty(input.causeKind)) throw new Error('Invalid contact cause.');
    if ([input.sampleGesture, input.sampleKitId].some(value => value != null && (typeof value !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)))) throw new Error('Invalid authored sample gesture or kit identity.');
    return Object.freeze({ id: input.id, ...(input.sourceLanes ? { sourceLanes: Object.freeze([...input.sourceLanes].sort((a, b) => a - b)) } : {}), ...(input.topologyRegionId ? { topologyRegionId: input.topologyRegionId } : {}), ...(input.formationId ? { formationId: input.formationId } : {}), ...(input.harmonicFields ? { harmonicFields: true } : {}), sourceKind: input.sourceKind, ...(response ? { response } : {}), ...(actionVoicePolicy ? { actionVoicePolicy } : {}), ...(voiceTransfer ? { voiceTransfer } : {}), action: input.action ?? null,
      ...(input.cargoRole ? { cargoRole: input.cargoRole } : {}), ...(input.cargoStationId ? { cargoStationId: input.cargoStationId } : {}), ...(input.activityWindowId ? { activityWindowId: input.activityWindowId } : {}), ...(input.motifId ? { motifId: input.motifId } : {}), ...(input.encounterId ? { encounterId: input.encounterId } : {}), ...(input.pickupId ? { pickupId: input.pickupId } : {}), ...(input.routeId ? { routeId: input.routeId } : {}),
      ...(input.ensembleId ? { ensembleId: input.ensembleId } : {}), ...(preparedBodyStrike ? { preparedBodyStrike } : {}),
      ...(input.workChangePolicy ? { workChangePolicy: input.workChangePolicy } : {}), operationKind: input.operationKind ?? null, causeKind: input.causeKind ?? null,
      gateX: input.sourceKind === 'MotionCommitted' ? input.gateX : null,
      articulation: input.articulation ? validateArticulationField(input.articulation) : null, ...(contactTravel ? { contactTravel } : {}),
      ...(probability ? { probability } : {}), probability01: input.probability01 == null ? 1 : Number.isFinite(input.probability01) ? Math.min(1, Math.max(0, input.probability01)) : 0,
      crossingDirection: input.crossingDirection ?? 'either',
      changedOnly: input.changedOnly === true, pitchCents: input.pitchCents, velocity01: input.velocity01,
      ...(input.sampleGesture != null ? { sampleGesture: input.sampleGesture } : {}), ...(input.sampleKitId != null ? { sampleKitId: input.sampleKitId } : {}),
      route: input.route, role: input.role, mute: input.mute === true, solo: input.solo === true });
  });
  if (value.seed != null && !Number.isSafeInteger(value.seed)) throw new Error('Invalid causal graph seed.');
  return Object.freeze({ version: 1, ...(randomSeeds ? { randomSeeds } : {}), ...(swarm ? { swarm } : {}), ...(feedback ? { feedback } : {}), revision: value.revision, seed: value.seed ?? 0, instruments: Object.freeze(instruments),
    ...(value.preparedSurfaces ? { preparedSurfaces } : {}), ...(value.cargoStations ? { cargoStations } : {}), ...(value.activityWindows ? { activityWindows: activityDefinitions } : {}), ...(value.motifs ? { motifs: motifDefinitions } : {}), ...(value.encounters ? { encounters: encounterDefinitions } : {}), ...(value.topologyRegions ? { topologyRegions } : {}), ...(value.harmonicFields ? { harmonicFields: tonal.harmonicFields } : {}), ...(value.formations ? { formations: tonal.formations } : {}), ...(tonal.editCommandId ? { editCommandId: tonal.editCommandId } : {}),
    ...(value.pickups ? { pickups: domain.pickups } : {}), ...(value.ensembles ? { ensembles: domain.ensembles } : {}), ...(value.routes ? { routes: domain.routes } : {}) });
};

const createCausalMusicEngine = ({ getGraph, deliver = () => {}, scoreTimeline = null, onIntentProvenance = null,
  getLaneState = () => ({ available: true }), getActivityOutputState = () => ({ status: 'unobserved' }), getOnsetControls = () => undefined, getPhysicalControlKinds = () => [], getPerformanceState = () => null,
  maxBeginsPerBatch = 512, maxVoices = 512, maxPhysicalUpdatesPerBatch = 2048, traceLimit = 1024, resourceBudget = null, world = null } = {}) => {
  if (typeof getGraph !== 'function' || (scoreTimeline && typeof scoreTimeline.map !== 'function')) throw new Error('A causal graph provider and valid score timeline are required.');
  if (onIntentProvenance !== null && typeof onIntentProvenance !== 'function') throw new TypeError('Invalid intent provenance observer.');
  if (!Number.isSafeInteger(traceLimit) || traceLimit < 0 || traceLimit > 8192 || !Number.isSafeInteger(maxBeginsPerBatch) || maxBeginsPerBatch < 0 || maxBeginsPerBatch > 4096 || !Number.isSafeInteger(maxVoices) || maxVoices < 0 || maxVoices > 4096) throw new Error('Invalid bounded causal engine owner capacity.');
  if (!Number.isSafeInteger(maxPhysicalUpdatesPerBatch) || maxPhysicalUpdatesPerBatch < 0 || maxPhysicalUpdatesPerBatch > 4096) throw new Error('Invalid physical control budget.');
  const resourceOwner = createCausalObserverResources({ resourceBudget, maxVoices, maxBeginsPerBatch, traceLimit });
  let disposed = false, disposalError = null, snapshotCache = null, traceBytes = 0, traceOmitted = 0; const traceSizes = [];
  let bodyPreparations = createPreparedSurfaceMapping(), latestBodyPreparations = null;
  let tones = createTonalInterpretation(); const onsetPlans = new Map();
  let swarm = createSwarmReducer();
  let cargo = createPhraseCargoObserver(), activity = createActivityWindowObserver(), motifs = createPhysicalMotifObserver(), encounters = createEncounterObserver(), latestPhysicalAnalysis = null;
  let physical = createPhysicalMusicDomain(), rhythmic = createRhythmicResponses(), actionAdmission = createActionVoiceAdmission({ maxPending: Math.max(maxVoices, 4096) });
  const instrumentEpochs = new Map();
  const active = new Map(), suppressed = new Map(), byActor = new Map(), seen = new Set(), seenOrder = [], trace = [];
  const validControlKinds = kinds => Array.isArray(kinds) && kinds.length <= INSTRUMENT_PHYSICAL_SOURCE_KINDS.length && new Set(kinds).size === kinds.length && kinds.every(kind => INSTRUMENT_PHYSICAL_SOURCE_KINDS.includes(kind));
  const addVoice = (voiceId, record, restoring = false) => {
    if (!Object.hasOwn(record, 'definitionRevision')) record.definitionRevision = instrumentEpochs.get(record.instrument.id) ?? null;
    const kinds = restoring ? record.physicalSourceKinds || [] : getPhysicalControlKinds(record.laneId);
    if (!validControlKinds(kinds)) throw new Error('Invalid held physical control sources.');
    if (!restoring && onsetPlans.has(voiceId)) { const onset = onsetPlans.get(voiceId); record.basePitchCents = onset.baseCents; record.onsetPitch = onset.pitch; record.tonalState = onset.tonalState; record.rootedSourceEventIds = record.rootedSourceEventIds || onset.sourceEventIds; record.tonalOffset = 0; }
    record.physicalSourceKinds = Object.freeze([...kinds].sort()); active.set(voiceId, record);
    if (!kinds.length && !record.instrument.actionVoicePolicy?.expressionMappings.length && !record.instrument.contactTravel) return;
    let records = byActor.get(record.actorId);
    if (!records) { records = new Set(); byActor.set(record.actorId, records); } records.add(record);
  };
  let travel = createTravelAccumulator({ maxEntries: Math.max(4096, maxVoices) }); const decisions = [];
  let generation = null, graph = null, graphSource = null, graphFingerprint = null, liveIds = null, indexed = null, errors = 0, rejected = 0;
  let recoveryRequired = false, probabilityAnalysis = null, probabilityCount = 0, probabilityBytes = 0; const batchDecisions = [], onsetDecisions = new Map();
  let provenanceCount = 0, provenanceDropped = 0;
  let cursor = { worldId: null, generation: null, tick: -1, lastSequence: -1, batchId: null };
  const accepted = new Map(), rejectedByInstrument = new Map();
  const remember = intent => { if (traceLimit <= 0) return; let bytes; try { bytes = estimateJournalBytes(intent, { maxBytes: 32768, maxNodes: 8192 }); } catch { traceOmitted++; return; }
    if (bytes > 8 * 1048576) { traceOmitted++; return; }
    while (trace.length && (trace.length >= traceLimit || traceBytes + bytes > 8 * 1048576)) { trace.shift(); traceBytes -= traceSizes.shift(); traceOmitted++; }
    trace.push(intent); traceSizes.push(bytes); traceBytes += bytes; };
  const timeFor = (batch, fact) => fact?.derivedObservation ? { simTick: fact.subTick >= 1 ? batch.tick : Math.max(0, batch.tick - 1), subTick: fact.subTick >= 1 ? 0 : fact.subTick ?? 0, precision: 'interpolated' } : { simTick: batch.tick, subTick: fact?.subTick ?? 0, precision: fact?.precision ?? 'tick' };
  const basePitchFor = (instrument, fact) => fact?.topologyBinding?.status === 'complete' ? fact.topologyBinding.pitchCents : (fact?.derivedObservation || fact?.derivedResponse) && Number.isFinite(fact.pitchCents) ? fact.pitchCents : instrument.pitchCents + ((fact?.derivedObservation || fact?.derivedResponse) && Number.isFinite(fact.pitchOffsetCents) ? fact.pitchOffsetCents : 0);
  const intentFor = (batch, fact, instrument, kind, voiceId, reason = null, voiceGeneration = batch.generation, expression = {}, articulationState = null, definitionRevision = undefined) => {
    const qualifiedBodyContact = !instrument.preparedBodyStrike || fact?.kind !== 'ContactSpanBegan' || fact.physicalPayload?.evidence === 'completed-support-cell' && fact.causeKind === 'support';
    const contactCoordinate = kind === 'begin' && qualifiedBodyContact ? captureCircularContactCoordinate(batch, fact, instrument.id, graph?.revision ?? 0) : null;
    if (contactCoordinate) articulationState = { ...articulationState, contactCoordinate };
    const baseCents = basePitchFor(instrument, fact);
    const tonal = kind === 'begin' && (instrument.formationId || instrument.harmonicFields) ? tones.resolve(instrument, fact?.actorId, baseCents) : null;
    const pitch = tonal?.pitch || { cents: baseCents, referenceHz: 440 };
    if (kind === 'begin' && tonal) onsetPlans.set(voiceId, { baseCents, pitch, tonalState: tonal.state, sourceEventIds: fact?.sourceEventIds || (fact?.eventId ? [fact.eventId] : []) });
    const tonalOffset = !fact?.tonalExpression ? active.get(voiceId)?.tonalOffset || 0 : 0;
    const intent = Object.freeze({
      version: 1, intentId: `${batch.batchId}:${instrument.id}:${voiceId}:${fact?.eventId || 'boundary'}:${kind}`,
      worldId: batch.worldId, batchId: batch.batchId, generation: voiceGeneration,
      kind, physicalSourceKind: fact?.kind || instrument.sourceKind, physicalAction: fact?.action ?? null, onsetId: voiceId, voiceId, actorId: fact?.actorId ?? null, laneId: fact?.laneId ?? null,
      sourceEventIds: Object.freeze(fact?.sourceEventIds ? [...fact.sourceEventIds] : fact?.eventId ? [fact.eventId] : []),
      ...(fact?.topologyBinding ? { topologyBinding: fact.topologyBinding } : {}),
      ...(fact?.voiceTransition ? { voiceTransition: Object.freeze(fact.voiceTransition) } : {}),
      ...(fact?.responseDescriptor ? { responseDescriptor: Object.freeze(fact.responseDescriptor) } : {}),
      ...(Number.isFinite(fact?.gateTicks) ? { responseGateTicks: fact.gateTicks } : {}),
      ...(fact?.derivedObservation ? { observationId: fact.observationId, observation: Object.freeze({ kind: fact.kind, gateId: fact.gateId ?? null, gateRevision: fact.gateRevision ?? null, routeId: fact.routeId ?? null, routeRevision: fact.routeRevision ?? null, local01: fact.local01 ?? null, direction: fact.direction ?? null, periodTicks: fact.periodTicks ?? null, precision: fact.observationPrecision || fact.precision }) } : {}),
      causalSequence: fact?.causalSequence ?? null, mappingId: instrument.id,
      actionInstanceId: fact?.actionInstanceId ?? null,
      scoreTime: Object.freeze({ ...(scoreTimeline?.map(timeFor(batch, fact)) || timeFor(batch, fact)), sourceTimeMs: batch.sourceTimeMs ?? null,
        sourceTickDurationMs: Number.isFinite(batch.tickDurationMs) && batch.tickDurationMs > 0 ? batch.tickDurationMs : null }),
      pitch: Object.freeze(pitch), ...(tonal?.state ? { tonalState: tonal.state } : {}),
      ...(fact?.tonalSourceBatchId ? { tonalSourceBatchId: fact.tonalSourceBatchId } : {}), ...(fact?.mappingEdit ? { mappingEdit: Object.freeze(fact.mappingEdit) } : {}), velocity01: Number.isFinite(fact?.velocity01) ? fact.velocity01 : Math.min(1, instrument.velocity01 * (Number.isFinite(fact?.velocityScale) ? fact.velocityScale : 1)),
      expression: Object.freeze({ ...expression, ...(Number.isFinite(expression.pitchOffsetCents) && tonalOffset ? { pitchOffsetCents: expression.pitchOffsetCents + tonalOffset } : {}) }), role: instrument.role, route: instrument.route, terminationReason: reason,
      ...(instrument.preparedBodyStrike ? { preparedBodyStrike: instrument.preparedBodyStrike, graphRevision: graph.revision } : {}),
      ...(fact?.sampleGesture != null ? { sampleGesture: fact.sampleGesture } : instrument.sampleGesture != null ? { sampleGesture: instrument.sampleGesture } : {}), ...(instrument.sampleKitId != null ? { sampleKitId: instrument.sampleKitId } : {}),
      ...(articulationState ? { articulationState: Object.freeze(articulationState) } : {}),
      ...(kind === 'begin' && onsetDecisions.has(`${instrument.id}:${fact?.observationId || fact?.eventId}`) ? { probabilityDecision: onsetDecisions.get(`${instrument.id}:${fact?.observationId || fact?.eventId}`) } : {}),
      ...(kind === 'begin' ? { performanceControls: validateInstrumentControls(fact?.topologyBinding?.dampingMacroId ? { ...getOnsetControls(fact?.laneId), macros: { ...getOnsetControls(fact?.laneId)?.macros, [fact.topologyBinding.dampingMacroId]: fact.topologyBinding.damping01 } } : getOnsetControls(fact?.laneId)), performanceCause: captureInstrumentCause(fact?.physicalCauseFact || fact) } : {})
    });
    if (onIntentProvenance && provenanceCount < 512) {
      provenanceCount++;
      const held = active.get(voiceId) || suppressed.get(voiceId), revision = definitionRevision !== undefined ? definitionRevision : held ? held.definitionRevision : instrumentEpochs.get(instrument.id) ?? null;
      try { onIntentProvenance(Object.freeze({ version: 1, intentId: intent.intentId, batchId: intent.batchId, generation: intent.generation,
        mappingId: instrument.id, graphRevision: graph?.revision ?? null, mappingRevision: revision, evidence: 'canonical-intent-construction' })); } catch {}
    } else if (onIntentProvenance) provenanceDropped++;
    return intent;
  };
  const publish = (batch, intents) => {
    if (onIntentProvenance && provenanceDropped) { try { onIntentProvenance(Object.freeze({ version: 1, kind: 'omitted', batchId: batch.batchId, generation: batch.generation, count: provenanceDropped })); } catch {} }
    provenanceCount = 0; provenanceDropped = 0;
    onsetPlans.clear(); onsetDecisions.clear();
    probabilityAnalysis = freezePhysical({ version: 1, batchId: batch.batchId, requested: probabilityCount, omitted: probabilityCount - batchDecisions.length, coverage: probabilityCount === batchDecisions.length ? 'complete' : 'capped', decisions: [...batchDecisions] });
    const reduction = swarm.reduce(batch, intents), sealed = reduction.intents;
    if (latestPhysicalAnalysis?.batchId === batch.batchId) latestPhysicalAnalysis = freezePhysical({ ...latestPhysicalAnalysis, swarm: reduction.summary, probability: probabilityAnalysis });
    latestBodyPreparations = Object.freeze({ batchId: batch.batchId, ...bodyPreparations.consume(batch, { allowNew: !recoveryRequired, scoreTimeFor: (source, fact) => Object.freeze({ ...(scoreTimeline?.map(timeFor(source, fact)) || timeFor(source, fact)), sourceTimeMs: source.sourceTimeMs ?? null, sourceTickDurationMs: source.tickDurationMs ?? null }) }) });
    for (const intent of sealed) remember(intent);
    try { deliver(sealed, batch, latestBodyPreparations.commands); } catch { errors++; }
    return sealed;
  };
  const endVoice = (batch, record, fact, reason, output) => {
    active.delete(record.voiceId);
    const records = byActor.get(record.actorId); records?.delete(record); if (!records?.size) byActor.delete(record.actorId);
    output.push(intentFor(batch, fact || { actorId: record.actorId, laneId: record.laneId }, record.instrument, 'end', record.voiceId, reason, record.generation, {}, null, record.definitionRevision));
  };
  const endMatching = (batch, predicate, fact, reason, output) => {
    for (const record of [...active.values()]) if (predicate(record)) endVoice(batch, record, fact, reason, output);
    for (const record of suppressed.values()) if (predicate(record)) suppressed.delete(record.voiceId);
  };
  const getCurrentGraph = () => {
    resourceOwner.check();
    const source = getGraph();
    if (source !== graphSource || source?.revision !== graph?.revision) {
      estimateJournalBytes(source, { maxBytes: 2 * 1048576, maxNodes: 131072 });
      const next = validateCausalInstrumentGraph(source);
      const fingerprint = JSON.stringify(next);
      if (graph && next.revision === graph.revision && fingerprint !== graphFingerprint) throw new Error('Causal graph changed without a new revision.');
      resourceOwner.admitGraph(next); snapshotCache = null;
      const solo = next.instruments.some(instrument => instrument.solo && !instrument.mute);
      const live = next.instruments.filter(instrument => !instrument.mute && (!solo || instrument.solo));
      const nextIndex = new Map();
      for (const instrument of live) {
        let group = nextIndex.get(instrument.sourceKind);
        if (!group) { group = []; nextIndex.set(instrument.sourceKind, group); }
        group.push(instrument);
      }
      const previousById = new Map((graph?.instruments || []).map(instrument => [instrument.id, instrument]));
      const dependencies = (source, instrument) => JSON.stringify([source?.activityWindows?.find(value => value.id === instrument?.activityWindowId), source?.motifs?.find(value => value.id === instrument?.motifId), source?.encounters?.find(value => value.id === instrument?.encounterId), source?.pickups?.find(value => value.id === (instrument?.pickupId || instrument?.response?.pickupId)), source?.routes?.find(value => value.id === (instrument?.articulation?.routeId || instrument?.routeId || instrument?.response?.routeId)), source?.ensembles?.find(value => value.id === (instrument?.ensembleId || instrument?.response?.ensembleId)), source?.ensembles?.find(value => value.id === source?.pickups?.find(pickup => pickup.id === (instrument?.pickupId || instrument?.response?.pickupId))?.ensembleId)]);
      const unchanged = new Set(next.instruments.filter(instrument => graph?.seed === next.seed && JSON.stringify(previousById.get(instrument.id)) === JSON.stringify(instrument) && dependencies(graph, previousById.get(instrument.id)) === dependencies(next, instrument)).map(instrument => instrument.id));
      for (const id of instrumentEpochs.keys()) if (!next.instruments.some(instrument => instrument.id === id)) instrumentEpochs.delete(id);
      for (const instrument of next.instruments) if (!unchanged.has(instrument.id) || !instrumentEpochs.has(instrument.id)) instrumentEpochs.set(instrument.id, next.revision);
      for (const record of [...active.values(), ...suppressed.values()]) if (unchanged.has(record.instrument.id)) record.graphRevision = next.revision;
      travel.rebaseGraph(next.revision, record => unchanged.has(record.instrumentId));
      bodyPreparations.configure(next.preparedSurfaces); swarm.configure(next.swarm); cargo.configure(next.cargoStations || []); activity.configure(next.activityWindows || [], next); motifs.configure(next.motifs || [], next); encounters.configure(next.encounters || []); tones.configure(next); physical.configure(next); rhythmic.configure(next.instruments); actionAdmission.configure(next.instruments);
      graph = next; graphSource = source; graphFingerprint = fingerprint; liveIds = new Set(live.map(instrument => instrument.id)); indexed = nextIndex;
    }
    return graph;
  };
  const processBatch = batch => {
    provenanceCount = 0; provenanceDropped = 0;
    if (batch?.version !== 1 || !nonempty(batch.batchId) || !nonempty(batch.worldId) || !Number.isSafeInteger(batch.generation) ||
        !Number.isSafeInteger(batch.tick) || !Array.isArray(batch.facts) || batch.facts.length > 8192 || !plain(batch.completeness) ||
        !['complete', 'incomplete'].includes(batch.completeness.status) || !Number.isSafeInteger(batch.completeness.dropped) ||
        batch.completeness.dropped < 0) throw new Error('Invalid physical batch.');
    const current = getCurrentGraph(), sourceBeginLimit = current.swarm ? 4096 : maxBeginsPerBatch, sourceVoiceLimit = current.swarm ? 4096 : maxVoices;
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
    snapshotCache = null; seen.add(batch.batchId); seenOrder.push(batch.batchId);
    if (seenOrder.length > 1024) seen.delete(seenOrder.shift());
    const output = []; batchDecisions.length = 0; probabilityCount = 0; probabilityBytes = 0; onsetDecisions.clear();
    if (generation !== null && (generation !== batch.generation || cursor.worldId !== batch.worldId)) {
      endMatching(batch, () => true, null, 'generation-change', output); travel.reset(); physical.reset(); encounters.reset(); motifs.reset(); activity.reset(); cargo.reset(); latestPhysicalAnalysis = null; rhythmic.reset(); actionAdmission.reset(); tones.reset();
    }
    cursor = { worldId: batch.worldId, generation: batch.generation, tick: batch.tick,
      lastSequence: batch.facts.at(-1)?.causalSequence ?? (cursor.worldId === batch.worldId ? cursor.lastSequence : -1), batchId: batch.batchId };
    generation = batch.generation;
    endMatching(batch, record => !liveIds.has(record.instrument.id) || record.graphRevision !== current.revision,
      null, 'mapping-changed', output);
    travel.release(record => record.graphRevision !== current.revision || !liveIds.has(record.instrumentId));
    if (batch.completeness.status !== 'complete') {
      endMatching(batch, () => true, null, 'incomplete-source', output);
      travel.reset(); physical.reset(); encounters.reset(); motifs.reset(); activity.reset(); cargo.reset(); latestPhysicalAnalysis = null; rhythmic.reset(); actionAdmission.reset(); tones.reset(); recoveryRequired = true;
      return publish(batch, output);
    }
    if (recoveryRequired) return publish(batch, output);
    const actionAdmissions = actionAdmission.prepare(batch);
    const observations = physical.observe(batch);
    try { tones.observe(batch, physical); } catch { endMatching(batch, () => true, null, 'incomplete-tonal-observation', output); recoveryRequired = true; return publish(batch, output); }
    const responses = rhythmic.expand(batch, [...batch.facts, ...observations.facts].sort((a, b) => a.causalSequence - b.causalSequence || (a.subTick || 0) - (b.subTick || 0)), physical);
    if (observations.completeness.status !== 'complete' || responses.completeness.status !== 'complete' || actionAdmissions.completeness.status !== 'complete') { endMatching(batch, () => true, null, 'incomplete-physical-observation', output); recoveryRequired = true; return publish(batch, output); }
    const relationships = encounters.observe(batch, [...batch.facts, ...observations.facts], physical);
    const cargoResult = cargo.observe(batch, [...batch.facts, ...observations.facts, ...relationships.facts]);
    let outputObservation; try { outputObservation = getActivityOutputState(); } catch { outputObservation = { status: 'unobserved' }; }
    const activityResult = activity.observe(batch, [...batch.facts, ...observations.facts, ...relationships.facts], physical, { heldVoices: [...active.values()], relationships: relationships.completeness.status, getLaneState, output: outputObservation });
    const activityById = new Map(activityResult.windows.map(value => [value.id, value]));
    endMatching(batch, record => activityById.get(record.instrument.activityWindowId)?.releasesHeldVoices, null, 'physical-activity-policy', output);
    const recognized = motifs.observe(batch, [...batch.facts, ...observations.facts, ...relationships.facts, ...activityResult.facts], physical, { activity: activityResult.completeness.status, encounters: relationships.completeness.status });
    latestPhysicalAnalysis = freezePhysical({ batchId: batch.batchId, tick: batch.tick, generation: batch.generation, ensembles: observations.ensembles || [], facts: Object.freeze([...observations.facts, ...relationships.facts, ...cargoResult.facts, ...recognized.facts, ...activityResult.facts]), windows: activityResult.windows, completeness: { status: cargoResult.completeness.status === 'complete' && relationships.completeness.status === 'complete' && recognized.completeness.status === 'complete' && activityResult.completeness.status === 'complete' ? 'complete' : 'censored', cargo: cargoResult.completeness, encounters: relationships.completeness, motifs: recognized.completeness, activity: activityResult.completeness } });
    endMatching(batch, record => { if (!record.instrument.ensembleId) return false; const member = physical.membership(record.instrument.ensembleId, record.actorId); return member.status !== 'complete' || !member.includes; }, null, 'ensemble-membership-ended', output);
    endMatching(batch, record => record.instrument.actionVoicePolicy && batch.tick - record.startedTick >= record.instrument.actionVoicePolicy.maximumHoldTicks, null, 'maximum-hold', output);
    endMatching(batch, record => record.instrument.articulation?.metric === 'qualified-route-arc-pixels' && physical.routeCoordinate(record.actorId, record.instrument.articulation.routeId)?.status !== 'qualified', null, 'route-coordinate-unavailable', output);
    let begins = 0, physicalUpdates = 0;
    for (const record of [...active.values()]) if (record.topologyBinding) {
      const region = current.topologyRegions?.find(r => r.id === record.instrument.topologyRegionId), result = batch.snapshot?.topology?.regions?.find(r => r.regionId === region?.id)?.current;
      if (result?.status === 'complete') { try { validateTopologyResult(result); } catch { endVoice(batch, record, null, 'invalid-topology-descriptor', output); continue; } }
      const component = result?.status === 'complete' && result.worldId === batch.worldId && result.generation === batch.generation && result.sourceRevision === batch.snapshot?.terrainRevision && result.regionRevision === region.revision ? result.components.find(c => c.id === record.topologyBinding.componentId) : null;
      if (!component || component.musical.status !== 'complete' || result.sourceRevision !== record.topologyBinding.boundTopologyRevision && (component.lineage.kind !== 'unchanged' || region.heldPolicy === 'release-on-change' && component.geometryChanged)) { endVoice(batch, record, null, 'topology-component-changed', output); continue; }
      if (region.heldPolicy === 'retune-stable' && component.musical.pitchCents !== record.topologyPitchCents) {
        const offset = component.musical.pitchCents - record.topologyBinding.pitchCents;
        if (Math.abs(offset) > 24000 || physicalUpdates >= maxPhysicalUpdatesPerBatch) { endVoice(batch, record, null, 'topology-pitch-range', output); continue; }
        output.push(intentFor(batch, { actorId: record.actorId, laneId: record.laneId }, record.instrument, 'update', record.voiceId, null, batch.generation, { pitchOffsetCents: offset }, { slewSeconds: 0.03, topology: { componentId: component.id, boundTopologyRevision: result.sourceRevision } })); record.topologyPitchCents = component.musical.pitchCents; physicalUpdates++;
      }
    }
    const sourceFacts = [...batch.facts, ...observations.facts, ...responses.facts, ...actionAdmissions.facts, ...relationships.responses, ...cargoResult.responses, ...recognized.responses, ...activityResult.responses].sort((a, b) => a.causalSequence - b.causalSequence || (a.subTick || 0) - (b.subTick || 0) || (a.observationId || '').localeCompare(b.observationId || ''));
    const probabilityContext = current.instruments.some(instrument => instrument.probability && (instrument.probability.identity !== 'cause' || instrument.probability.conditions.length)) ? createCausalProbabilityContext(batch) : () => ({});
    const responds = (instrument, fact, stableCauseId = fact.eventId) => {
      const decision = causalPolicyDecision({ policy: instrument.probability, seed: causalNamespaceSeed(current.randomSeeds, 'musical-response', current.seed), mappingId: instrument.id, generation: batch.generation,
        stableCauseId: stableCauseId || fact.observationId, probability01: instrument.probability01, context: probabilityContext(fact) });
      probabilityCount++; const size = JSON.stringify(decision).length * 2;
      if (batchDecisions.length < 8192 && probabilityBytes + size <= 1048576) { batchDecisions.push(decision); probabilityBytes += size; }
      if (decision.accepted) { const key = `${instrument.id}:${fact.observationId || fact.eventId}`; if (onsetDecisions.size < 4096 || onsetDecisions.has(key)) onsetDecisions.set(key, decision); }
      if (traceLimit > 0) { decisions.push(decision); if (decisions.length > traceLimit) decisions.shift(); }
      return decision.accepted;
    };
    const reject = instrument => { rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); };
    const transitions = new Map();
    const actionEntries = new Map(); for (const entry of sourceFacts) if (entry.kind === 'ActionEntered') { if (!actionEntries.has(entry.actorId)) actionEntries.set(entry.actorId, []); actionEntries.get(entry.actorId).push(entry); }
    const motionCounts = new Map(), motionOrdinals = new Map();
    for (const fact of sourceFacts) if (fact.kind === 'MotionCommitted') motionCounts.set(fact.actorId, (motionCounts.get(fact.actorId) || 0) + 1);
    for (const originalFact of sourceFacts) {
      if (originalFact.kind === 'MotionCommitted') motionOrdinals.set(originalFact.actorId, (motionOrdinals.get(originalFact.actorId) || 0) + 1);
      let fact = originalFact;
      if (fact.kind === 'PickupCrossing' && fact.transition === 'exit') endMatching(batch, record => record.lifetimeScope === 'pickupOccupancy' && record.scopeInstanceId === `${fact.gateId}:${fact.actorId}`, fact, fact.reason || 'pickup-exit', output);
      travel.observeLifecycle(batch, fact);
      if (fact.kind === 'ActionExited') {
        const entries = actionEntries.get(fact.actorId) || [];
        for (const record of [...active.values()]) {
          if (record.actorId !== fact.actorId || record.actionInstanceId !== fact.actionInstanceId || record.lifetimeScope && record.lifetimeScope !== 'actionInstance') continue;
          const policy = record.instrument.actionVoicePolicy, nextAction = entries.find(entry => entry.causalSequence > fact.causalSequence && (policy?.beginCondition === 'enter' || entry.policyAdmission && entry.targetMappingId === record.instrument.id)), compatible = policy && nextAction && policy.matchActions.includes(actionVoiceName(nextAction.action)) &&
            (actionVoiceName(nextAction.action) !== actionVoiceName(fact.action) || policy.sameActionReentry === 'legato');
          if (compatible && policy.transitionPolicy === 'legato') { transitions.set(`${record.instrument.id}/${fact.actorId}`, { record, fromActionInstanceId: record.actionInstanceId, policy: 'legato' }); continue; }
          if (compatible && policy.transitionPolicy === 'crossfade') {
            const transition = { kind: 'crossfade', seconds: policy.crossfadeSeconds, fromVoiceId: record.voiceId, fromActionInstanceId: record.actionInstanceId, toActionInstanceId: nextAction.actionInstanceId };
            transitions.set(`${record.instrument.id}/${fact.actorId}`, { transition, policy: 'crossfade' });
            endVoice(batch, record, { ...fact, voiceTransition: transition }, 'action-crossfade', output);
          } else endVoice(batch, record, fact, 'action-exited', output);
        }
        for (const record of suppressed.values()) if (record.actorId === fact.actorId && record.actionInstanceId === fact.actionInstanceId && (!record.lifetimeScope || record.lifetimeScope === 'actionInstance')) suppressed.delete(record.voiceId);
      }
      if (fact.kind === 'ActorLaneTransferred') for (const record of [...active.values()]) {
        if (record.actorId !== fact.actorId || record.laneId === fact.laneId) continue;
        if (!sourceLaneIncluded(record.instrument, fact.laneId)) { endVoice(batch, record, fact, 'transfer-left-instrument-source-lanes', output); continue; }
        const policy = record.instrument.voiceTransfer || validateVoiceTransferPolicy(), previousLaneId = record.laneId;
        const transfer = { policy: policy.policy, previousLaneId, laneId: fact.laneId, sourceEventId: fact.eventId, previousVoiceId: record.voiceId };
        let destination; try { destination = getLaneState(fact.laneId); } catch { destination = null; }
        if (policy.policy === 'carry' && destination && destination.available !== false) {
          record.laneId = fact.laneId; output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation, {}, { transfer })); continue;
        }
        const destinationAvailable = !!destination && destination.available !== false;
        const transition = policy.policy === 'revoice' && destinationAvailable ? { kind: 'crossfade', seconds: policy.crossfadeSeconds, fromVoiceId: record.voiceId } : null;
        endVoice(batch, record, { ...fact, ...(transition ? { voiceTransition: transition } : {}) }, destinationAvailable ? 'voice-transfer' : 'transfer-destination-unavailable', output);
        if (policy.policy === 'silentHandoff' || !destination || destination.available === false) { suppressed.set(record.voiceId, { ...record, laneId: fact.laneId }); continue; }
        if (begins >= sourceBeginLimit || active.size + suppressed.size >= sourceVoiceLimit || tones.resolve(record.instrument, fact.actorId, record.instrument.pitchCents).status !== 'complete') { reject(record.instrument); continue; }
        const rootVoiceId = record.rootVoiceId || record.voiceId, voiceId = `${rootVoiceId}:handoff:${fact.causalSequence}`;
        if (!voiceIdentity(voiceId)) { reject(record.instrument); continue; }
        output.push(intentFor(batch, { ...fact, ...(transition ? { voiceTransition: transition } : {}) }, record.instrument, 'begin', voiceId, null, batch.generation, {}, { transfer })); begins++;
        addVoice(voiceId, { ...record, voiceId, rootVoiceId, laneId: fact.laneId, graphRevision: current.revision });
      }
      if (fact.kind === 'ActorTerminated') endMatching(batch, record => record.actorId === fact.actorId, fact, fact.terminationReason || 'actor-terminated', output);
      if (fact.kind === 'ContactSpanEnded') endMatching(batch, record => record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId, fact, fact.reason || 'contact-ended', output);
      if (fact.kind === 'ContactSpanUpdated') for (const record of active.values()) {
        if (record.lifetimeScope === 'contactSpan' && record.scopeInstanceId === fact.spanId && record.actorId === fact.actorId) {
          output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation, {},
            { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision, observedTick: fact.observedTick }));
        }
      }
      if (fact.kind === 'MotionCommitted') for (const record of [...(byActor.get(fact.actorId) || [])]) {
        if (record.instrument.contactTravel) {
          if (physicalUpdates >= maxPhysicalUpdatesPerBatch || fact.contactSpanId !== record.scopeInstanceId || motionCounts.get(fact.actorId) > 128) { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, 'contact-travel-budget-or-scope', output); continue; }
          let observed;
          try { observed = travel.consume(batch, fact, record.instrument.id, record.instrument.contactTravel, current.revision); } catch { observed = { status: 'rejected', reason: 'contact-travel-evidence' }; }
          if (observed.status !== 'accepted') { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, observed.reason, output); travel.release(member => member.instrumentId === record.instrument.id && member.actorId === fact.actorId); continue; }
          const state = observed.state, observation = Object.freeze({ ...observed.observation, sourceSequence: fact.causalSequence + 1, segmentOrdinal: motionOrdinals.get(fact.actorId) - 1, segmentCount: motionCounts.get(fact.actorId),
            completedTickDurationMs: Number.isFinite(batch.tickDurationMs) && batch.tickDurationMs > 0 ? batch.tickDurationMs : null, timing: 'completed-tick-equal-segments-v1' });
          output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation, {}, { travelPhase01: observed.phase01, pathDistancePixels: state.pathDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels, travel: observation })); physicalUpdates++; continue;
        }
        const policy = record.instrument.actionVoicePolicy; if (!policy || batch.tick - (record.lastExpressionTick ?? -Infinity) < policy.updateEveryTicks) continue;
        const expression = actionExpression(policy, fact), changed = Object.entries(expression).some(([key, value]) => Math.abs(value - (record.lastExpression?.[key] ?? Infinity)) >= policy.expressionDeadband);
        if (!changed) continue;
        if (physicalUpdates >= maxPhysicalUpdatesPerBatch) { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, 'action-expression-budget', output); continue; }
        output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation, expression)); physicalUpdates++; record.lastExpression = expression; record.lastExpressionTick = batch.tick;
      }
      const cause = byActor.has(fact.actorId) ? captureInstrumentCause(fact) : null;
      if (cause) for (const record of [...byActor.get(fact.actorId)]) {
        if (record.instrument.contactTravel && fact.kind === 'MotionCommitted' || !record.physicalSourceKinds.includes(cause.sourceKind)) continue;
        if (physicalUpdates >= maxPhysicalUpdatesPerBatch) { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, 'physical-control-budget', output); continue; }
        const intent = intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation);
        output.push(Object.freeze({ ...intent, intentId: intent.intentId + ':physical', performanceCause: cause })); physicalUpdates++;
      }
      for (const instrument of indexed.get(fact.kind) || []) {
        fact = originalFact;
        if (!sourceLaneIncluded(instrument, fact.laneId)) continue;
        if (instrument.cargoStationId && instrument.cargoStationId !== fact.stationId || instrument.cargoRole && instrument.cargoRole !== fact.cargoRole) continue;
        if ((instrument.formationId || instrument.harmonicFields) && tones.resolve(instrument, fact.actorId, basePitchFor(instrument, fact)).status !== 'complete') continue;
        if (fact.actorId == null || !nonempty(fact.eventId) && !fact.editRetrigger) continue;
        if (fact.targetMappingId && fact.targetMappingId !== instrument.id || instrument.response && !fact.derivedResponse) continue;
        if (instrument.actionVoicePolicy) {
          const policy = instrument.actionVoicePolicy; if (!policy.matchActions.includes(actionVoiceName(fact.action)) || policy.beginCondition !== 'enter' && !fact.policyAdmission) continue;
          const transition = transitions.get(`${instrument.id}/${fact.actorId}`);
          if (transition?.policy === 'legato') { const record = transition.record; record.actionInstanceId = fact.actionInstanceId; output.push(intentFor(batch, fact, instrument, 'update', record.voiceId, null, batch.generation, {}, { transitionPolicy: 'legato', fromActionInstanceId: transition.fromActionInstanceId, toActionInstanceId: fact.actionInstanceId })); transitions.delete(`${instrument.id}/${fact.actorId}`); continue; }
          if (transition?.transition) fact = { ...fact, voiceTransition: transition.transition };
        }
        if (fact.lifecycle && fact.responseScope) {
          const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:${fact.responseScope}`;
          const existing = active.get(voiceId);
          if (fact.lifecycle === 'end') { if (existing) endVoice(batch, existing, fact, fact.reason || 'response-ended', output); suppressed.delete(voiceId); continue; }
          if (fact.lifecycle === 'update') { if (existing && physicalUpdates < maxPhysicalUpdatesPerBatch) { output.push(intentFor(batch, fact, instrument, 'update', voiceId, null, batch.generation, fact.expression || {})); physicalUpdates++; } else if (existing) { suppressed.set(voiceId, existing); endVoice(batch, existing, fact, 'physical-control-budget', output); } continue; }
          if (existing || suppressed.has(voiceId)) continue;
          const member = physical.membership(instrument.ensembleId, fact.actorId); if (member.status !== 'complete' || !member.includes) continue;
          if (begins >= sourceBeginLimit || active.size + suppressed.size >= sourceVoiceLimit || !responds(instrument, fact)) { reject(instrument); continue; }
          output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, fact.expression || {})); begins++;
          addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation, actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId, lifetimeScope: fact.lifetimeScope || 'actorJourney', scopeInstanceId: fact.responseScope });
          continue;
        }
        if (instrument.activityWindowId && activityById.get(instrument.activityWindowId)?.releasesHeldVoices || instrument.sourceKind === 'CadenceResponse' && instrument.activityWindowId !== fact.activityWindowId) continue;
        if (instrument.motifId && instrument.motifId !== fact.motifId) continue;
        if (instrument.encounterId && instrument.encounterId !== fact.encounterId) continue;
        if (instrument.pickupId && instrument.pickupId !== fact.gateId || instrument.routeId && instrument.routeId !== fact.routeId || fact.occupancy && fact.transition === 'exit') continue;
        const member = physical.membership(instrument.ensembleId, fact.actorId); if (member.status !== 'complete' || !member.includes) continue;
        if (instrument.action && fact.action !== instrument.action) continue;
        if (instrument.operationKind && fact.operationKind !== instrument.operationKind) continue;
        if (instrument.causeKind && fact.causeKind !== instrument.causeKind) continue;
        if (instrument.articulation) {
          const routeTravel = instrument.articulation.metric === 'qualified-route-arc-pixels';
          if (routeTravel && motionOrdinals.get(fact.actorId) !== motionCounts.get(fact.actorId)) continue;
          let result;
          try { result = travel.consume(batch, fact, instrument.id, instrument.articulation, current.revision, routeTravel ? physical.routeCoordinate(fact.actorId, instrument.articulation.routeId) : null); }
          catch { reject(instrument); continue; }
          if (result.status !== 'accepted') {
            reject(instrument);
            endMatching(batch, record => record.instrument.id === instrument.id && record.actorId === fact.actorId, fact, result.reason, output);
            continue;
          }
          const state = result.state;
          const articulationState = Object.freeze({ travelPhase01: result.phase01, pathDistancePixels: state.pathDistancePixels,
            signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels,
            travel: Object.freeze({ ...result.observation, sourceSequence: fact.causalSequence + (routeTravel ? 0 : 1), segmentOrdinal: routeTravel ? 0 : motionOrdinals.get(fact.actorId) - 1, segmentCount: routeTravel ? 1 : motionCounts.get(fact.actorId),
              completedTickDurationMs: Number.isFinite(batch.tickDurationMs) && batch.tickDurationMs > 0 ? batch.tickDurationMs : null, timing: 'completed-tick-equal-segments-v1' }) });
          if (instrument.articulation.sustain) {
            const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:travel:${state.scopeInstanceId}`;
            const existing = active.get(voiceId);
            if (existing) output.push(intentFor(batch, fact, instrument, 'update', voiceId, null, batch.generation, {}, articulationState));
            else if (result.distancePixels > 0 && !suppressed.has(voiceId) && begins < sourceBeginLimit && active.size + suppressed.size < sourceVoiceLimit && responds(instrument, fact, `${fact.eventId}:sustain`)) {
              output.push(intentFor(batch, fact, instrument, 'begin', voiceId, null, batch.generation, {}, articulationState)); begins++;
              addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
                actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId,
                lifetimeScope: state.lifetimeScope, scopeInstanceId: state.scopeInstanceId });
            }
            continue;
          }
          for (const crossing of result.crossings) {
            if (!responds(instrument, fact, `${fact.eventId}:travel:${crossing.ordinal}`)) continue;
            if (begins >= sourceBeginLimit) { reject(instrument); continue; }
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
        if (instrument.workChangePolicy === 'solid' && !(fact.physicalPayload?.changedSolidCells > 0) || instrument.workChangePolicy === 'appearance' && !(fact.physicalPayload?.changedAppearanceCells > 0)) continue;
        if (instrument.changedOnly && !((fact.physicalPayload?.changedSolidCells || 0) > 0 || (fact.physicalPayload?.changedAppearanceCells || 0) > 0)) continue;
        let topologyBinding = null;
        if (instrument.topologyRegionId) {
          if (fact.kind === 'TerrainWorkCommitted' && !(fact.physicalPayload?.changedSolidCells > 0)) continue;
          const region = current.topologyRegions.find(r => r.id === instrument.topologyRegionId); try { topologyBinding = bindTopologyFact(region, batch, fact); } catch { reject(instrument); continue; }
          if (topologyBinding.status !== 'complete' || topologyBinding.dampingMacroId && new Set([...Object.keys(getOnsetControls(fact.laneId)?.macros || {}), topologyBinding.dampingMacroId]).size > 4) { reject(instrument); continue; }
        }
        const voiceFact = topologyBinding ? { ...fact, topologyBinding } : fact;
        if (!responds(instrument, fact)) continue;
        if (begins >= sourceBeginLimit || ((['ActionEntered', 'ContactSpanBegan'].includes(fact.kind) || fact.occupancy) && active.size + suppressed.size >= sourceVoiceLimit)) {
          rejected++; rejectedByInstrument.set(instrument.id, (rejectedByInstrument.get(instrument.id) || 0) + 1); continue;
        }
        const sourceId = fact.occupancy ? `occupancy:${fact.gateId}:${fact.actorId}` : fact.observationId || (fact.kind === 'ActionEntered' ? fact.actionInstanceId : fact.kind === 'ContactSpanBegan' ? fact.spanId : fact.eventId);
        if (!voiceIdentity(sourceId)) continue;
        const voiceId = `${batch.worldId}:${batch.generation}:${instrument.id}:r${instrumentEpochs.get(instrument.id)}:${sourceId}`;
        if (active.has(voiceId) || suppressed.has(voiceId)) continue;
        output.push(intentFor(batch, voiceFact, instrument, 'begin', voiceId, null, batch.generation, {},
          fact.kind === 'ContactSpanBegan' ? { contactAnchor: Object.freeze({ ...fact.anchor }), surfaceRevision: fact.surfaceRevision,
            observedTick: fact.observedTick } : null)); begins++;
        accepted.set(instrument.id, (accepted.get(instrument.id) || 0) + 1);
        if (fact.kind === 'ActionEntered' || fact.kind === 'ContactSpanBegan' || fact.occupancy) addVoice(voiceId, { voiceId, instrument, graphRevision: current.revision, generation: batch.generation,
          actorId: fact.actorId, laneId: fact.laneId, actionInstanceId: fact.actionInstanceId, startedTick: batch.tick, ...(topologyBinding ? { topologyBinding, topologyPitchCents: topologyBinding.pitchCents } : {}),
          ...(fact.occupancy ? { lifetimeScope: 'pickupOccupancy', scopeInstanceId: `${fact.gateId}:${fact.actorId}` } : fact.kind === 'ContactSpanBegan' ? { lifetimeScope: 'contactSpan', scopeInstanceId: fact.spanId } : {}) });
        else output.push(intentFor(batch, fact, instrument, 'end', voiceId, 'one-shot'));
      }
    }
    for (const record of [...active.values()]) {
      if (!record.onsetPitch || !(record.instrument.formationId || record.instrument.harmonicFields)) continue;
      const target = tones.resolve(record.instrument, record.actorId, record.basePitchCents ?? record.instrument.pitchCents);
      if (target.status !== 'complete') { suppressed.set(record.voiceId, record); endVoice(batch, record, null, 'tonal-membership-unavailable', output); continue; }
      const prior = record.tonalState, removed = prior?.fieldId && !current.harmonicFields?.some(field => field.id === prior.fieldId);
      if (removed && prior.deletionPolicy === 'release') { suppressed.set(record.voiceId, record); endVoice(batch, record, null, 'field-deleted', output); continue; }
      const heldPolicy = !target.state.fieldId && prior?.fieldId ? prior.heldPolicy : target.state.heldPolicy;
      if (removed && prior.deletionPolicy === 'retain' || heldPolicy === 'retain-onset') continue;
      const cents = target.pitch.cents - record.onsetPitch.cents + 1200 * Math.log2(target.pitch.referenceHz / record.onsetPitch.referenceHz);
      if (Math.abs(cents - (record.tonalOffset || 0)) < 1e-9) continue;
      const source = tones.cause(record), edit = target.state.edit;
      if (!source && !edit) continue;
      const fact = { ...(source || {}), actorId: record.actorId, laneId: record.laneId, tonalExpression: true,
        sourceEventIds: source?.sourceEventIds || record.rootedSourceEventIds, ...(edit ? { mappingEdit: edit } : {}) };
      if (heldPolicy === 'release-retrigger') {
        if (begins >= sourceBeginLimit || !record.rootedSourceEventIds?.length || edit && !edit.commandId) continue;
        const rootVoiceId = record.rootVoiceId || record.voiceId, voiceId = `${rootVoiceId}:tonal:${batch.tick}`;
        if (!voiceIdentity(voiceId)) continue;
        endVoice(batch, record, fact, edit ? 'field-edit-rearticulation' : 'field-boundary-rearticulation', output);
        output.push(intentFor(batch, { ...fact, sourceEventIds: [...new Set([...record.rootedSourceEventIds, ...(fact.sourceEventIds || [])])], actionInstanceId: record.actionInstanceId }, record.instrument, 'begin', voiceId)); begins++;
        addVoice(voiceId, { ...record, voiceId, rootVoiceId, tonalOffset: 0 });
      } else {
        if (physicalUpdates >= maxPhysicalUpdatesPerBatch || Math.abs(cents + (record.lastExpression?.pitchOffsetCents || 0)) > 24000) { suppressed.set(record.voiceId, record); endVoice(batch, record, fact, 'tonal-expression-capacity', output); continue; }
        output.push(intentFor(batch, fact, record.instrument, 'update', record.voiceId, null, batch.generation,
          { pitchOffsetCents: cents + (record.lastExpression?.pitchOffsetCents || 0) }, { tonal: target.state, pitch: target.pitch, slewSeconds: target.state.slewSeconds })); physicalUpdates++;
        record.tonalOffset = cents; record.tonalState = target.state;
      }
    }
    return publish(batch, output);
  };
  const serializeVoices = records => Object.freeze([...records.values()].map(record => Object.freeze({ voiceId: record.voiceId,
    instrumentId: record.instrument.id, graphRevision: record.graphRevision, generation: record.generation, actorId: record.actorId,
    laneId: record.laneId, actionInstanceId: record.actionInstanceId,
    ...(record.topologyBinding ? { topologyBinding: record.topologyBinding, topologyPitchCents: record.topologyPitchCents } : {}),
    ...(record.onsetPitch ? { basePitchCents: record.basePitchCents, onsetPitch: record.onsetPitch, tonalState: record.tonalState, rootedSourceEventIds: record.rootedSourceEventIds, tonalOffset: record.tonalOffset } : {}),
    ...(record.rootVoiceId ? { rootVoiceId: record.rootVoiceId } : {}),
    ...(record.startedTick != null ? { startedTick: record.startedTick } : {}), ...(record.lastExpression ? { lastExpression: Object.freeze({ ...record.lastExpression }), lastExpressionTick: record.lastExpressionTick } : {}),
    ...(record.physicalSourceKinds.length ? { physicalSourceKinds: record.physicalSourceKinds } : {}),
    ...(record.lifetimeScope ? { lifetimeScope: record.lifetimeScope, scopeInstanceId: record.scopeInstanceId } : {}) })));
  const snapshot = () => { getCurrentGraph(); const performance = getPerformanceState(); if (snapshotCache && snapshotCache.performanceKey === JSON.stringify(performance)) return snapshotCache.value;
    const value = resourceOwner.stage('causal-observer-snapshot-copy', () => Object.freeze({ version: 1, ...(graph.preparedSurfaces?.length || bodyPreparations.diagnostics().heldPreparations ? { preparedSurfaces: bodyPreparations.snapshot() } : {}), swarm: swarm.snapshot(), generation, graphRevision: graph.revision, recoveryRequired, ...(graph.cargoStations?.length ? { cargo: cargo.snapshot() } : {}), ...(graph.activityWindows?.length ? { activity: activity.snapshot() } : {}), ...(graph.motifs?.length ? { motifs: motifs.snapshot() } : {}), ...(graph.encounters?.length ? { encounters: encounters.snapshot() } : {}), ...(tones.enabled() ? { tonalInterpretation: tones.snapshot() } : {}), instrumentEpochs: Object.freeze(Object.fromEntries(instrumentEpochs)), travel: travel.snapshot(), ...(graph.instruments.some(instrument => instrument.actionVoicePolicy) ? { actionAdmission: actionAdmission.snapshot() } : {}), ...(graph.instruments.some(instrument => instrument.response) ? { rhythmicResponses: rhythmic.snapshot() } : {}), ...(graph.pickups?.length || graph.ensembles?.length || graph.routes?.length ? { physicalDomain: physical.snapshot() } : {}), physicalCursor: Object.freeze({ ...cursor }),
      ...(performance ? { performanceInputs: validateCausalPerformanceState(performance) } : {}),
      active: serializeVoices(active), ...(suppressed.size ? { suppressed: serializeVoices(suppressed) } : {}) }));
    snapshotCache = { value, performanceKey: JSON.stringify(performance) }; return value; };
  const restore = value => {
    const current = getCurrentGraph();
    return resourceOwner.stage('causal-observer-restore-old-plus-new', () => {
      estimateJournalBytes(value, { maxBytes: 64 * 1048576, maxNodes: 1048576 });
      if (value?.performanceInputs && JSON.stringify(validateCausalPerformanceState(value.performanceInputs)) !== JSON.stringify(validateCausalPerformanceState(getPerformanceState())))
        throw new Error('Causal performance inputs differ from the checkpoint.');
      if (value?.version !== 1 || value.graphRevision !== current.revision || !Array.isArray(value.active) || !Array.isArray(value.suppressed ?? []) || value.active.length + (value.suppressed?.length || 0) > Math.max(4096, maxVoices)) throw new Error('Incompatible causal engine checkpoint.');
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
          record.onsetPitch && (!Number.isFinite(record.basePitchCents) || Math.abs(record.basePitchCents) > 24000 || !Number.isFinite(record.onsetPitch.cents) || Math.abs(record.onsetPitch.cents) > 24000 || !Number.isFinite(record.onsetPitch.referenceHz) || record.onsetPitch.referenceHz <= 0 || !Number.isFinite(record.tonalOffset) || Math.abs(record.tonalOffset) > 24000 || !plain(record.tonalState) || !Array.isArray(record.rootedSourceEventIds) || record.rootedSourceEventIds.length > 128 || record.rootedSourceEventIds.some(id => !nonempty(id))) ||
          record.topologyBinding && (!instrument.topologyRegionId || !plain(record.topologyBinding) || record.topologyBinding.status !== 'complete' || !voiceIdentity(record.topologyBinding.componentId) || !Number.isFinite(record.topologyPitchCents) || Math.abs(record.topologyPitchCents) > 24000 || !Number.isFinite(record.topologyBinding.pitchCents)) ||
          record.rootVoiceId != null && !voiceIdentity(record.rootVoiceId) ||
          instrument.actionVoicePolicy && (!Number.isSafeInteger(record.startedTick) || record.startedTick < 0 || record.startedTick > nextCursor.tick) ||
          record.lastExpression && (!plain(record.lastExpression) || Object.entries(record.lastExpression).some(([key, value]) => !['pitchOffsetCents', 'pressure01', 'pan01'].includes(key) || !Number.isFinite(value)) || !Number.isSafeInteger(record.lastExpressionTick)) ||
          !Number.isSafeInteger(record.actorId) || !Number.isSafeInteger(record.generation) || record.generation !== value.generation ||
          record.graphRevision !== current.revision || !validControlKinds(record.physicalSourceKinds || [])) throw new Error('Invalid causal voice checkpoint.');
          seenVoices.add(record.voiceId); next.set(record.voiceId, { ...record, instrument, definitionRevision: value.instrumentEpochs && Object.hasOwn(value.instrumentEpochs, instrument.id) ? value.instrumentEpochs[instrument.id] : null, physicalSourceKinds: Object.freeze([...(record.physicalSourceKinds || [])].sort()) });
        } return next;
      };
      if (value.instrumentEpochs != null && (!plain(value.instrumentEpochs) || Object.entries(value.instrumentEpochs).some(([id, epoch]) => !current.instruments.some(instrument => instrument.id === id) || !Number.isSafeInteger(epoch) || epoch < 0 || epoch > current.revision))) throw new Error('Invalid instrument owner epochs.');
      const next = readVoices(value.active), nextSuppressed = readVoices(value.suppressed || []);
      if (current.instruments.some(instrument => instrument.response) && !value.rhythmicResponses || (current.pickups?.length || current.ensembles?.length || current.routes?.length) && !value.physicalDomain) throw new Error('Physical interpretation boundary state is missing.');
      const nextBodyPreparations = createPreparedSurfaceMapping(); nextBodyPreparations.configure(current.preparedSurfaces);
      if (value.preparedSurfaces) { nextBodyPreparations.restore(value.preparedSurfaces); const frontier = value.preparedSurfaces.cursor; if (frontier.worldId !== nextCursor.worldId || frontier.generation !== nextCursor.generation || frontier.tick !== nextCursor.tick || frontier.sequence !== nextCursor.lastSequence) throw new Error('Prepared surface continuation differs from the physical boundary.'); }
      else if (current.preparedSurfaces?.length) throw new Error('Prepared surface continuation is missing.');
      const nextSwarm = createSwarmReducer(); nextSwarm.configure(current.swarm); if (value.swarm) nextSwarm.restore(value.swarm); else if (current.swarm || value.active.length) throw new Error('Swarm continuation state missing.');
      if (value.swarm && (value.swarm.held.some(([id]) => !next.has(id)) || value.swarm.cursor.worldId !== nextCursor.worldId || value.swarm.cursor.generation !== nextCursor.generation || value.swarm.cursor.tick !== nextCursor.tick || value.swarm.cursor.batchId !== nextCursor.batchId)) throw new Error('Swarm ownership differs from the physical engine boundary.');
      const nextCargo = createPhraseCargoObserver(); nextCargo.configure(current.cargoStations || []); if (value.cargo) nextCargo.restore(value.cargo); else if (current.cargoStations?.length) throw new Error('Physical cargo boundary missing.');
      const nextActivity = createActivityWindowObserver(); nextActivity.configure(current.activityWindows || [], current); if (value.activity) nextActivity.restore(value.activity); else if (current.activityWindows?.length) throw new Error('Physical activity boundary missing.');
      const nextMotifs = createPhysicalMotifObserver(); nextMotifs.configure(current.motifs || [], current); if (value.motifs) nextMotifs.restore(value.motifs); else if (current.motifs?.length) throw new Error('Motif interpretation boundary missing.');
      const nextEncounters = createEncounterObserver(); nextEncounters.configure(current.encounters || []); if (value.encounters) nextEncounters.restore(value.encounters); else if (current.encounters?.length) throw new Error('Encounter interpretation boundary missing.');
      const nextTones = createTonalInterpretation(); nextTones.configure(current); if (value.tonalInterpretation) nextTones.restore(value.tonalInterpretation); else if (nextTones.enabled()) throw new Error('Tonal interpretation boundary missing.');
      const nextAdmission = createActionVoiceAdmission({ maxPending: Math.max(maxVoices, 4096) }); nextAdmission.configure(current.instruments); if (value.actionAdmission) nextAdmission.restore(value.actionAdmission); else if (current.instruments.some(instrument => instrument.actionVoicePolicy)) throw new Error('Action admission boundary missing.');
      const nextRhythmic = createRhythmicResponses(), nextPhysical = createPhysicalMusicDomain(), nextTravel = createTravelAccumulator({ maxEntries: Math.max(4096, maxVoices) });
      nextRhythmic.configure(current.instruments); nextPhysical.configure(current);
      if (value.rhythmicResponses) nextRhythmic.restore(value.rhythmicResponses);
      if (value.physicalDomain) nextPhysical.restore(value.physicalDomain);
      if (value.travel) nextTravel.restore(value.travel);
      snapshotCache = null; bodyPreparations = nextBodyPreparations; latestBodyPreparations = null; swarm = nextSwarm; cargo = nextCargo; activity = nextActivity; motifs = nextMotifs; encounters = nextEncounters; latestPhysicalAnalysis = null; tones = nextTones; actionAdmission = nextAdmission; rhythmic = nextRhythmic; physical = nextPhysical; travel = nextTravel;
      active.clear(); byActor.clear(); suppressed.clear(); for (const [id, record] of next) addVoice(id, record, true);
      for (const [id, record] of nextSuppressed) suppressed.set(id, record);
      if (value.instrumentEpochs) { instrumentEpochs.clear(); for (const [id, epoch] of Object.entries(value.instrumentEpochs)) instrumentEpochs.set(id, epoch); }
      recoveryRequired = value.recoveryRequired === true;
      probabilityAnalysis = null; batchDecisions.length = 0; onsetDecisions.clear();
      seen.clear(); seenOrder.length = 0; generation = value.generation; cursor = { ...nextCursor };
      if (cursor.batchId) { seen.add(cursor.batchId); seenOrder.push(cursor.batchId); }
    });
  };
  const diagnostics = () => disposed ? Object.freeze({ disposed, resources: resourceOwner.diagnostics(), activeVoices: 0 }) : Object.freeze({ resources: resourceOwner.diagnostics(), traceBytes, traceOmitted, preparedSurfaces: bodyPreparations.diagnostics(), swarm: swarm.diagnostics(), cargo: cargo.diagnostics(), activity: activity.diagnostics(), motifs: motifs.diagnostics(), encounters: encounters.diagnostics(), tonal: tones.diagnostics(), actionAdmission: actionAdmission.diagnostics(), physical: physical.diagnostics(), rhythmic: rhythmic.diagnostics(), recoveryRequired, recoveryAction: recoveryRequired ? 'restore-complete-boundary-or-explicit-rearm' : null, activeVoices: active.size, suppressedVoices: suppressed.size, deliveryErrors: errors, rejectedBegins: rejected,
    accepted: Object.freeze(Object.fromEntries(accepted)), rejected: Object.freeze(Object.fromEntries(rejectedByInstrument)),
    trace: Object.freeze([...trace]), decisions: Object.freeze([...decisions]) });
  const prepareGraph = source => { resourceOwner.check(); estimateJournalBytes(source, { maxBytes: 2 * 1048576, maxNodes: 131072 }); const next = validateCausalInstrumentGraph(source); bodyPreparations.validateConfiguration(next.preparedSurfaces); return resourceOwner.prepareGraph(next); };
  let releaseGraphAdmission = null;
  try { if (world) releaseGraphAdmission = registerPhysicalGraphAdmission(world, prepareGraph); } catch (error) { resourceOwner.dispose(); throw error; }
  const dispose = () => { if (disposalError) throw disposalError; if (disposed) return false;
    releaseGraphAdmission?.(); releaseGraphAdmission = null;
    for (const collection of [onsetPlans, instrumentEpochs, active, suppressed, byActor, seen, accepted, rejectedByInstrument, onsetDecisions]) collection.clear();
    seenOrder.length = trace.length = traceSizes.length = decisions.length = batchDecisions.length = 0; traceBytes = 0;
    graph = graphSource = graphFingerprint = liveIds = indexed = snapshotCache = latestPhysicalAnalysis = probabilityAnalysis = null;
    latestBodyPreparations = null; bodyPreparations = tones = swarm = cargo = activity = motifs = encounters = physical = rhythmic = actionAdmission = travel = null;
    disposed = true; try { resourceOwner.dispose(); } catch (error) { disposalError = error; throw error; } return true; };
  const activeVoiceView = ({ limit = 64, instrumentIds = null } = {}) => {
    resourceOwner.check(); getCurrentGraph();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096 || instrumentIds !== null && (!Array.isArray(instrumentIds) || instrumentIds.length > 512 || instrumentIds.some(id => typeof id !== 'string' || !id || id.length > 128))) throw new TypeError('Voice inspection requires bounded identities and count.');
    const selected = instrumentIds && new Set(instrumentIds), result = [];
    for (const record of active.values()) { if (selected && !selected.has(record.instrument.id)) continue;
      result.push(Object.freeze({ voiceId: record.voiceId, instrumentId: record.instrument.id, generation: record.generation, actorId: record.actorId, laneId: record.laneId })); if (result.length === limit) break;
    }
    return Object.freeze(result);
  };
  return { processBatch, snapshot, bodyPreparations: () => latestBodyPreparations, activeVoiceView, restore, diagnostics, dispose, prepareGraph, physicalAnalysis: () => latestPhysicalAnalysis, routePeriods: () => physical.routePeriods(), probabilityAnalysis: () => probabilityAnalysis, rearm({ discardUnknownHeldState = false } = {}) {
    resourceOwner.check(); snapshotCache = null;
    if (!discardUnknownHeldState || active.size || suppressed.size) throw new Error('Rearming requires explicit discard of unknown held state at an empty boundary.');
    bodyPreparations.reset({ worldId: cursor.worldId, generation: cursor.generation, tick: cursor.tick, sequence: cursor.lastSequence }); latestBodyPreparations = null; recoveryRequired = false; return Object.freeze({ status: 'rearmed', resumesHeldVoices: false, sourceBoundary: Object.freeze({ ...cursor }) });
  } };
};

export { createCausalMusicEngine, validateCausalInstrumentGraph };
