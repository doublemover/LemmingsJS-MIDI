import { cloneJournalData, canonicalJournalText, freezeJournalData, journalError } from './CausalJournalCanonical.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { createCausalCoverageIndex, queryCausalCoverage } from './CausalCoverage.js';

const name = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const boundedKinds = value => Array.isArray(value) && value.length <= 128 && value.every(name) && new Set(value).size === value.length;
const validateCaptureProfile = value => {
  if (value?.version !== 1 || !name(value.id) || !boundedKinds(value.factKinds) || !boundedKinds(value.descriptorKinds) ||
      !boundedKinds(value.stateKinds)) throw new Error('A bounded, explicit causal capture profile is required.');
  return cloneJournalData(value);
};
const PHYSICAL_CAPTURE_PROFILE = freezeJournalData({ version: 1, id: 'physical-basic-v1',
  factKinds: ['MotionCommitted', 'DirectionChanged', 'ContactResolved', 'ActionEntered', 'ActionExited', 'AbilityChanged',
    'ActorTerminated', 'TerrainWorkCommitted', 'CommandApplied', 'CommandRejected', 'ContactSpanBegan', 'ContactSpanUpdated', 'ContactSpanEnded'],
  descriptorKinds: ['movement-path'], stateKinds: ['voices', 'travel', 'contactSpans', 'timeline'] });

const createCausalTakeRecorder = async ({ journal, takeId, takeName, documentId, sourceVersions, captureProfile = PHYSICAL_CAPTURE_PROFILE,
  boundaryState = {}, initialCheckpoint, mapping, assetRefs = [], existingWriter = null, prefixCoverage = null, sourceCursor = null } = {}) => {
  const profile = validateCaptureProfile(captureProfile), graph = validateCausalInstrumentGraph(mapping);
  if (existingWriter && (!['appendMany', 'append', 'manifest', 'status', 'checkpoint', 'stop'].every(key => typeof existingWriter[key] === 'function') ||
      existingWriter.status().state !== 'recording' || existingWriter.manifest().takeId !== takeId || !existingWriter.manifest().prefix ||
      existingWriter.status().admittedSequence !== existingWriter.manifest().prefix.throughSequence ||
      sourceCursor?.journalSequence !== existingWriter.manifest().prefix.throughSequence || !name(sourceCursor.worldId) ||
      !Number.isSafeInteger(sourceCursor.tick) || sourceCursor.tick < 0 || !Number.isSafeInteger(sourceCursor.generation) || sourceCursor.generation < 0 ||
      !Number.isSafeInteger(sourceCursor.lastCausalSequence) || sourceCursor.lastCausalSequence < 0 ||
      !Array.isArray(prefixCoverage?.gaps) || prefixCoverage.gaps.length > 4096 || !boundedKinds(prefixCoverage.observedFactKinds) ||
      !boundedKinds(prefixCoverage.intentKinds) || !Array.isArray(prefixCoverage.mappingRevisions) || prefixCoverage.mappingRevisions.length > 4096 ||
      prefixCoverage.mappingRevisions.some(revision => !Number.isSafeInteger(revision) || revision < 0) ||
      canonicalJournalText(existingWriter.manifest().captureProfile).text !== canonicalJournalText(profile).text)) throw new Error('A branch recorder requires its admitted writer and qualified clipped prefix cursor.');
  if (!existingWriter && (prefixCoverage || sourceCursor)) throw new Error('Inherited take coverage requires an existing branch writer.');
  const writer = existingWriter || await journal.createTake({ takeId, takeName, documentId, sourceVersions, captureProfile: profile, boundaryState,
    initialCheckpoint, mapping: graph, assetRefs });
  const observedFactKinds = new Set(prefixCoverage?.observedFactKinds || []), intentKinds = new Set(prefixCoverage?.intentKinds || []),
    mappingRevisions = new Set([...(prefixCoverage?.mappingRevisions || []), graph.revision]);
  const observedStateKinds = new Set(profile.stateKinds.filter(kind => Object.hasOwn(boundaryState, kind) && boundaryState[kind] != null));
  const coverageIndex = createCausalCoverageIndex({ gaps: prefixCoverage?.gaps || [] }), batches = new Set(), order = [];
  let firstTick = prefixCoverage?.sourceRange?.firstTick ?? null, lastTick = sourceCursor?.tick ?? null,
    lastGeneration = sourceCursor?.generation ?? null, nextGenerationBoundary = null, lastSequence = sourceCursor?.lastCausalSequence ?? -1,
    worldId = sourceCursor?.worldId ?? null, stopped = false, stopRequest = null;
  const addGap = coverageIndex.add;
  const recordCommittedBatch = ({ batch, intents, deliveryOutcomes = [] } = {}) => {
    if (stopped) return Object.freeze({ status: 'rejected', reason: 'take-stopped' });
    if (batch?.version !== 1 || !name(batch.batchId) || !name(batch.worldId) || !Number.isSafeInteger(batch.tick) || batch.tick < 0 ||
        !Number.isSafeInteger(batch.generation) || batch.generation < 0 || !Array.isArray(batch.facts) || batch.facts.length > 8192 ||
        !Array.isArray(intents) || intents.length > 8192 || !Array.isArray(deliveryOutcomes) || deliveryOutcomes.length > 16384) throw new Error('Invalid canonical performance boundary.');
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
    const entries = [{ kind: 'physical-batch', tick: batch.tick, generation: batch.generation, payload: batch },
      { kind: 'musical-intents', tick: batch.tick, generation: batch.generation, payload: { batchId: batch.batchId, intents } }];
    if (deliveryOutcomes.length) entries.push({ kind: 'sink-outcome', tick: batch.tick, generation: batch.generation,
      payload: { batchId: batch.batchId, outcomes: deliveryOutcomes } });
    const receipt = writer.appendMany(entries);
    if (receipt.status !== 'accepted') return receipt;
    if (lastTick != null && batch.tick > lastTick + 1) addGap({ kind: 'physical-facts', firstTick: lastTick + 1,
      lastTick: batch.tick - 1, generation: lastGeneration, reason: 'unobserved-source-ticks' });
    if (lastGeneration != null && batch.generation !== lastGeneration && batch.generation !== nextGenerationBoundary) addGap({
      kind: 'physical-facts', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'unobserved-generation-boundary' });
    nextGenerationBoundary = batch.terminalGenerationTransition?.to ?? null;
    batches.add(batch.batchId); order.push(batch.batchId); if (order.length > 2048) batches.delete(order.shift());
    worldId = batch.worldId; firstTick ??= batch.tick; lastTick = batch.tick; lastGeneration = batch.generation; lastSequence = sequence;
    if (batch.completeness?.status !== 'complete') addGap({ kind: 'physical-facts', firstTick: batch.tick, lastTick: batch.tick,
      generation: batch.generation, reason: 'incomplete-source-batch', dropped: batch.completeness?.dropped ?? null });
    let missingMovementPath = false;
    for (const fact of batch.facts) {
      if (fact.kind) observedFactKinds.add(fact.kind);
      if (fact.kind === 'MotionCommitted' && fact.physicalPayload?.pathEvidence !== 'committed-coordinate-write') missingMovementPath = true;
    }
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
        mappingRevisions: [...mappingRevisions], gaps: cloneJournalData(gaps) } };
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
    recordInput: (observation, boundary) => record('input-observation', observation, boundary),
    recordTimeline: (timeline, boundary) => { const receipt = record('timeline', timeline, boundary); if (receipt.status === 'accepted') observedStateKinds.add('timeline'); return receipt; }, recordMapping,
    recordSinkOutcome: (outcome, boundary) => record('sink-outcome', outcome, boundary),
    mark: (marker, boundary) => record('marker', marker, boundary), markGap, checkpoint: writer.checkpoint,
    flush: writer.flush, status, canReplaceDocument: writer.canReplaceDocument, stop, manifest: writer.manifest,
    discardPending: writer.discardPending };
};

const graphCaptureRequirements = graph => {
  const valid = validateCausalInstrumentGraph(graph), requirements = new Map();
  const add = (kind, owner, type) => requirements.set(`${type}:${kind}`, { kind, owner, type });
  for (const instrument of valid.instruments) {
    add(instrument.sourceKind, instrument.id, 'fact');
    if (instrument.sourceKind === 'ActionEntered' || instrument.sourceKind === 'ContactSpanBegan' || instrument.articulation?.sustain) add('voices', instrument.id, 'state');
    if (instrument.articulation) {
      add('travel', instrument.id, 'state');
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

const querySoundOnlyRevoice = async ({ journal, takeId, soundPatch, firstTick = 0, lastTick = Number.MAX_SAFE_INTEGER,
  firstSequence = 1, limit = 4096, executionEpoch } = {}) => {
  if (!name(executionEpoch) || !soundPatch || typeof soundPatch !== 'object') throw new Error('Revoice needs a sound patch and a fresh playback execution epoch.');
  const slice = await journal.query({ takeId, firstTick, lastTick, firstSequence, kinds: ['musical-intents'], limit });
  return freezeJournalData({ version: 1, operation: 'sound-only-revoice', takeId, takeRevision: slice.takeRevision, executionEpoch,
    soundPatch: cloneJournalData(soundPatch), intents: slice.records.flatMap(record => record.payload.intents),
    nextSequence: slice.nextSequence, inspection: { paused: true, hardware: false, recording: false, thru: false } });
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
  planCausalReinterpretation, querySoundOnlyRevoice, compareCausalRecords };
