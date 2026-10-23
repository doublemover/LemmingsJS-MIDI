import { cloneJournalData, journalError } from './CausalJournalCanonical.js';
import { queryCausalCoverage } from './CausalCoverage.js';

const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const tick = value => Number.isSafeInteger(value) && value >= 0;
const AXES = new Set(['physical-source-time', 'causal-order', 'musical-score-time']);
const SCORE_KINDS = ['physical-batch', 'musical-intents', 'sink-outcome', 'timeline', 'intervention', 'marker'];
const glyphKind = fact => {
  if (fact.kind === 'TerrainWorkCommitted') return 'work-cycle';
  if (fact.kind === 'ContactResolved') return 'encounter';
  if (fact.kind?.startsWith('ContactSpan')) return 'contact-span';
  if (fact.kind === 'ActionEntered' || fact.kind === 'ActionExited') return 'action-span';
  if (fact.kind === 'MotionCommitted') return ['falling', 'jumping', 'floating', 'flying'].includes(fact.action) ? 'flight' : 'travel';
  if (fact.kind === 'DirectionChanged') return 'direction-change';
  if (fact.kind === 'ActorTerminated') return 'lifecycle';
  if (fact.kind === 'CommandApplied' || fact.kind === 'CommandRejected') return 'intervention';
  return 'source-event';
};
const axisValue = (domain, fact, batch, intents) => {
  if (domain === 'causal-order') return { status: 'known', value: fact.causalSequence, unit: 'causal-sequence' };
  if (domain === 'physical-source-time') return Number.isFinite(batch.sourceTimeMs)
    ? { status: 'known', value: batch.sourceTimeMs, unit: 'milliseconds', precision: fact.precision || 'tick' }
    : { status: 'unknown', value: null, unit: 'milliseconds', reason: 'source-time-unavailable' };
  const times = intents.filter(intent => Number.isFinite(intent.scoreTime?.beat)).map(intent => intent.scoreTime);
  if (!times.length) return { status: 'unknown', value: null, unit: 'beats', reason: 'captured-score-time-unavailable' };
  const first = times[0];
  if (times.some(time => time.epoch !== first.epoch || time.beat !== first.beat)) return { status: 'unknown', value: null, unit: 'beats', reason: 'multiple-interpretation-times' };
  return { status: 'known', value: first.beat, unit: 'beats', epoch: first.epoch || null, precision: first.precision || 'tick' };
};

const createPhysicalScoreProjection = ({ journal, maxRecords = 4096, maxSourceFacts = 16384, maxGlyphs = 2048,
  maxStrands = 512, maxEvidence = 4096, maxBytes = 4194304 } = {}) => {
  if (!journal || typeof journal.openTake !== 'function' || typeof journal.query !== 'function' ||
      ![maxRecords, maxSourceFacts, maxGlyphs, maxStrands, maxEvidence, maxBytes].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxRecords > 65536 || maxSourceFacts > 262144 || maxGlyphs > 16384 || maxStrands > 4096 || maxEvidence > 65536 || maxBytes > 32 * 1048576) throw new Error('Invalid PhysicalScore projection bounds.');
  const requests = new Map();
  const begin = (requestId, signal) => {
    if (!boundedId(requestId) || !requests.has(requestId) && requests.size >= 64) throw new Error('A bounded PhysicalScore request identity is required.');
    const token = {};
    requests.set(requestId, token);
    return { check: () => {
      if (signal?.aborted || requests.get(requestId) !== token) throw journalError('cancelled', 'PhysicalScore request canceled or superseded.', { requestId });
    }, close: () => { if (requests.get(requestId) === token) requests.delete(requestId); } };
  };
  const queryPhysicalScore = async ({ takeId, takeRevision, generation, coverageRange, timeDomain = 'physical-source-time',
    actorOrRoleFilter = {}, glyphKinds = [], sourceSelection = null, resolution = { mode: 'exact' }, requestId, signal, cursor = null } = {}) => {
    const range = coverageRange, actors = actorOrRoleFilter.actorIds || [], roles = actorOrRoleFilter.roles || [];
    if (!boundedId(takeId) || !Number.isSafeInteger(takeRevision) || takeRevision < 1 || !tick(generation) ||
        !tick(range?.firstTick) || !tick(range.lastTick) || range.lastTick < range.firstTick || !AXES.has(timeDomain) ||
        !Array.isArray(actors) || actors.length > 256 || actors.some(actor => !Number.isSafeInteger(actor) || actor < 0) ||
        !Array.isArray(roles) || roles.length > 128 || roles.some(role => !boundedId(role)) ||
        !Array.isArray(glyphKinds) || glyphKinds.length > 32 || glyphKinds.some(kind => !boundedId(kind)) ||
        !['exact', 'aggregate'].includes(resolution.mode) || resolution.mode === 'aggregate' &&
          (!Number.isSafeInteger(resolution.bucketTicks) || resolution.bucketTicks < 1 || resolution.bucketTicks > 1000000) ||
        cursor && (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 1 || !tick(cursor.factOffset)) ||
        sourceSelection && (!Number.isSafeInteger(sourceSelection.first?.sequence) || sourceSelection.first.sequence < 1 ||
          !tick(sourceSelection.first.factOffset) || !Number.isSafeInteger(sourceSelection.last?.sequence) ||
          sourceSelection.last.sequence < sourceSelection.first.sequence || !tick(sourceSelection.last.factOffset) ||
          sourceSelection.first.sequence === sourceSelection.last.sequence && sourceSelection.last.factOffset < sourceSelection.first.factOffset)) throw new Error('Invalid PhysicalScore query.');
    const request = begin(requestId, signal);
    try {
      request.check();
      const manifest = await journal.openTake(takeId);
      request.check();
      if (manifest.revision !== takeRevision) throw journalError('stale-revision', 'PhysicalScore request refers to a stale take revision.', { requestId });
      const page = await journal.query({ takeId, takeRevision, generation, firstTick: range.firstTick, lastTick: range.lastTick,
        firstSequence: cursor?.sequence || sourceSelection?.first.sequence || 1, lastSequence: sourceSelection ? Math.min(Number.MAX_SAFE_INTEGER, sourceSelection.last.sequence + 2) : Number.MAX_SAFE_INTEGER,
        kinds: SCORE_KINDS, limit: maxRecords, signal });
      request.check();
      const intentsByCause = new Map(), evidenceByIntent = new Map(), allIntents = [], timelines = [], interventions = [];
      let evidenceCount = 0, missingEvidenceCount = 0;
      const addEvidence = outcome => {
        if (!boundedId(outcome?.intentId)) { missingEvidenceCount++; return; }
        if (++evidenceCount > maxEvidence) throw journalError('score-capacity', 'PhysicalScore evidence window is too dense; request a smaller source range.', { requestId });
        if (!evidenceByIntent.has(outcome.intentId)) evidenceByIntent.set(outcome.intentId, []);
        evidenceByIntent.get(outcome.intentId).push(outcome);
      };
      for (const record of page.records) {
        request.check();
        if (record.kind === 'musical-intents') for (const intent of record.payload.intents || []) {
          if (allIntents.length >= maxSourceFacts) throw journalError('score-capacity', 'PhysicalScore intent window is too dense; request a smaller source range.', { requestId });
          allIntents.push(intent);
          for (const causeId of intent.sourceEventIds || []) {
            if (!intentsByCause.has(causeId)) intentsByCause.set(causeId, []);
            intentsByCause.get(causeId).push(intent);
          }
        }
        else if (record.kind === 'sink-outcome') {
          if (Array.isArray(record.payload.outcomes)) for (const outcome of record.payload.outcomes) addEvidence(outcome);
          else addEvidence(record.payload);
        } else if (record.kind === 'timeline') timelines.push({ sequence: record.sequence, tick: record.tick, value: record.payload });
        else if (record.kind === 'intervention') interventions.push({ sequence: record.sequence, tick: record.tick, value: record.payload });
      }
      const glyphs = [], strands = new Map(), aggregates = new Map();
      let sourceFacts = 0, selectedFacts = 0, continuation = null, physicalBatches = 0;
      const actorSet = new Set(actors), roleSet = new Set(roles);
      outer: for (const record of page.records) {
        if (record.kind !== 'physical-batch') continue;
        if (sourceSelection && record.sequence > sourceSelection.last.sequence) continue;
        physicalBatches++;
        const batch = record.payload;
        const first = cursor || sourceSelection?.first;
        for (let factIndex = record.sequence === first?.sequence ? first.factOffset : 0; factIndex < batch.facts.length; factIndex++) {
          request.check();
          if (record.sequence === sourceSelection?.last.sequence && factIndex > sourceSelection.last.factOffset) break;
          if (sourceFacts >= maxSourceFacts || resolution.mode === 'exact' && glyphs.length >= maxGlyphs) {
            continuation = { sequence: record.sequence, factOffset: factIndex }; break outer;
          }
          const fact = batch.facts[factIndex], intents = intentsByCause.get(fact.eventId) || [];
          sourceFacts++;
          if (actorSet.size && !actorSet.has(fact.actorId) || roleSet.size && !intents.some(intent => roleSet.has(intent.role)) ||
              glyphKinds.length && !glyphKinds.includes(glyphKind(fact))) continue;
          selectedFacts++;
          const strandId = JSON.stringify([batch.worldId, generation, fact.actorId ?? null]);
          if (!strands.has(strandId)) {
            if (strands.size >= maxStrands) throw journalError('score-capacity', 'PhysicalScore strand capacity reached; narrow the actor filter.', { requestId });
            strands.set(strandId, { strandId, worldId: batch.worldId, generation, actorId: fact.actorId ?? null, laneHistory: [], voiceIds: new Set(), roles: new Set() });
          }
          const strand = strands.get(strandId);
          if (!strand.laneHistory.length || strand.laneHistory.at(-1).laneId !== (fact.laneId ?? null)) strand.laneHistory.push({ tick: record.tick, causalSequence: fact.causalSequence, laneId: fact.laneId ?? null });
          for (const intent of intents) { strand.voiceIds.add(intent.voiceId); if (intent.role) strand.roles.add(intent.role); }
          const source = { sequence: record.sequence, factOffset: factIndex, eventId: fact.eventId, batchId: batch.batchId,
            causalSequence: fact.causalSequence, tick: record.tick, sourceTimeMs: batch.sourceTimeMs ?? null,
            precision: fact.precision || 'tick', parentCauseIds: fact.parentCauseIds || [], commandId: fact.commandId || null };
          const joined = intents.map(intent => ({ intentId: intent.intentId, voiceId: intent.voiceId, kind: intent.kind, role: intent.role,
            mappingId: intent.mappingId || null, scoreTime: intent.scoreTime, sinkEvidence: evidenceByIntent.get(intent.intentId) || [],
            evidenceStatus: evidenceByIntent.has(intent.intentId) ? 'observed-in-window' : 'unknown' }));
          const glyph = { glyphId: fact.eventId, kind: glyphKind(fact), strandId, source, actorId: fact.actorId ?? null,
            actionInstanceId: fact.actionInstanceId || null, spanId: fact.spanId || null, factKind: fact.kind || fact.type || 'unknown',
            axis: axisValue(timeDomain, fact, batch, intents), fact, intents: joined };
          if (resolution.mode === 'exact') glyphs.push(glyph);
          else {
            const bucket = Math.floor(record.tick / resolution.bucketTicks), key = JSON.stringify([strandId, glyph.kind, bucket]);
            let aggregate = aggregates.get(key);
            if (!aggregate) {
              if (aggregates.size >= maxGlyphs) { continuation = { sequence: record.sequence, factOffset: factIndex }; selectedFacts--; sourceFacts--; break outer; }
              aggregate = { glyphId: `${takeId}:${takeRevision}:${key}`, kind: 'aggregate', sourceKind: glyph.kind, strandId,
                eventCount: 0, firstSource: source, lastSource: source, firstAxis: glyph.axis, lastAxis: glyph.axis,
                intentCount: 0, evidenceCount: 0, unknownEvidenceCount: 0, precisionCounts: {},
                uncertainty: 'display-only-aggregation', expansion: { takeId, takeRevision, generation, coverageRange: { firstTick: record.tick, lastTick: record.tick },
                  actorOrRoleFilter: { actorIds: fact.actorId == null ? [] : [fact.actorId], roles }, glyphKinds: [glyph.kind],
                  sourceSelection: { first: { sequence: record.sequence, factOffset: factIndex }, last: { sequence: record.sequence, factOffset: factIndex } },
                  resolution: { mode: 'exact' } } };
              aggregates.set(key, aggregate);
            }
            aggregate.eventCount++; aggregate.lastSource = source; aggregate.lastAxis = glyph.axis;
            aggregate.intentCount += joined.length;
            aggregate.evidenceCount += joined.reduce((sum, intent) => sum + intent.sinkEvidence.length, 0);
            aggregate.unknownEvidenceCount += joined.filter(intent => intent.evidenceStatus === 'unknown').length;
            aggregate.precisionCounts[source.precision] = (aggregate.precisionCounts[source.precision] || 0) + 1;
            aggregate.expansion.coverageRange.lastTick = record.tick;
            aggregate.expansion.sourceSelection.last = { sequence: record.sequence, factOffset: factIndex };
          }
        }
      }
      if (resolution.mode === 'aggregate') glyphs.push(...aggregates.values());
      const queriedCoverage = queryCausalCoverage({ coverage: manifest.coverage, range, generation });
      const unknownRegions = [...queriedCoverage.missingRanges, ...queriedCoverage.unknownRanges];
      continuation ||= page.nextSequence == null ? null : { sequence: page.nextSequence, factOffset: 0 };
      if (continuation) unknownRegions.push({ kind: 'query-window', reason: 'bounded-continuation', firstSequence: continuation.sequence, factOffset: continuation.factOffset });
      const voices = new Map();
      for (const strand of strands.values()) for (const voiceId of strand.voiceIds) {
        if (voices.size >= maxSourceFacts) throw journalError('score-capacity', 'PhysicalScore voice strand capacity reached.', { requestId });
        if (!voices.has(voiceId)) voices.set(voiceId, { voiceId, actorStrandId: strand.strandId, generation });
      }
      const result = { schema: 'lemmings-physical-score', version: 1, takeId, takeRevision, requestId, generation, timeDomain,
        requestedCoverage: range, sourceCoverage: manifest.coverage, unknownRegions, resolution, glyphs,
        actorStrands: [...strands.values()].map(strand => ({ ...strand, voiceIds: [...strand.voiceIds], roles: [...strand.roles] })),
        voiceStrands: [...voices.values()], clockSegments: { boundary: manifest.boundaryState?.timeline || null, observedWindow: timelines,
          coverage: 'captured-boundary-and-query-window' }, interventions, evidenceCoverage: { scope: 'query-window', observed: evidenceCount, unjoinable: missingEvidenceCount },
        counts: { physicalBatches, sourceFacts, selectedFacts, glyphs: glyphs.length,
          representedEvents: glyphs.reduce((sum, glyph) => sum + (glyph.eventCount || 1), 0) }, continuation,
        inspection: { paused: true, hardware: false, recording: false, thru: false, physicalLayers: false } };
      request.check();
      try { return cloneJournalData(result, { maxBytes, maxNodes: 1000000 }); }
      catch (error) { throw journalError('score-capacity', 'PhysicalScore result exceeds its bounded data window; request a smaller range.', { requestId, detail: error.message }); }
    } finally { request.close(); }
  };
  const queryCausalParent = async ({ takeId, takeRevision, generation, sourceSequence, eventId, requestId, signal } = {}) => {
    if (!boundedId(eventId) || !tick(generation) || !Number.isSafeInteger(sourceSequence) || sourceSequence < 1) throw new Error('Causal lookup requires an indexed source pointer.');
    const request = begin(requestId, signal);
    try {
      request.check();
      const page = await journal.query({ takeId, takeRevision, generation, firstSequence: sourceSequence, lastSequence: sourceSequence,
        kinds: ['physical-batch'], limit: 1, signal });
      request.check();
      const record = page.records[0], fact = record?.payload.facts.find(value => value.eventId === eventId);
      return cloneJournalData({ schema: 'lemmings-causal-parent', version: 1, takeId, takeRevision: page.takeRevision, eventId,
        status: fact ? 'found' : 'unavailable-at-pointer', sourceSequence, fact: fact || null,
        parentCauseIds: fact?.parentCauseIds || [], commandId: fact?.commandId || null,
        inspection: { paused: true, hardware: false, recording: false } }, { maxBytes });
    } finally { request.close(); }
  };
  return { queryPhysicalScore, queryCausalParent, cancel: requestId => requests.delete(requestId) };
};

export { createPhysicalScoreProjection };
