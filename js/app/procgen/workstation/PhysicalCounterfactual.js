import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validatePhysicalMusicGoal } from './PhysicalMusicGoal.js';
const text = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 32768 }).text;
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export function physicalCounterfactualPolicy(raw = {}) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['alignment', 'anchorMappingId', 'maximumPairs'].includes(key)) || !['fixed-origin', 'phrase-aligned'].includes(raw.alignment || 'fixed-origin') || raw.anchorMappingId != null && !id(raw.anchorMappingId) ||
      !Number.isSafeInteger(raw.maximumPairs ?? 2048) || (raw.maximumPairs ?? 2048) < 1 || (raw.maximumPairs ?? 2048) > 4096) throw new Error('Choose a bounded fixed-origin or explicitly phrase-aligned physical comparison.');
  return freezeData({ alignment: raw.alignment || 'fixed-origin', anchorMappingId: raw.anchorMappingId || null, maximumPairs: raw.maximumPairs ?? 2048 });
}
export function compilePhysicalCounterfactualRequest(raw) {
  const request = JSON.parse(text(raw));
  if (request.schema !== 'lemmings-physical-counterfactual/v1' || !id(request.id) || !Number.isSafeInteger(request.revision) || request.revision < 1 ||
      Object.keys(request).some(key => !['schema', 'id', 'revision', 'proposedEdits', 'horizonTicks', 'crewConstraints', 'skillInventory', 'budgets', 'comparisonPolicy'].includes(key)) ||
      !Array.isArray(request.proposedEdits) || request.proposedEdits.some(edit => !Array.isArray(edit.values) || edit.values.length !== 1)) throw new Error('Compare one concrete proposed wall/pickup/shared-skill patch with the unchanged actual source.');
  const goal = validatePhysicalMusicGoal({ schema: 'lemmings-physical-music-goal/v1', id: request.id, revision: request.revision, observationOnly: true, timeDomain: 'ticks', targetOnsets: [], periodGoals: [], periodRatios: [], requiredCauseKinds: [], forbiddenCauses: [],
    allowedEdits: request.proposedEdits, crewConstraints: request.crewConstraints, skillInventory: request.skillInventory, horizon: request.horizonTicks,
    budgets: { ...request.budgets, maximumCandidates: 2, finalists: 1 } });
  return freezeData({ goal, comparisonPolicy: physicalCounterfactualPolicy(request.comparisonPolicy || {}) });
}
export function summarizePhysicalCounterfactual(study, rawPolicy = {}) {
  if (study?.schema !== 'lemmings-physical-music-study/v1' || study.mode !== 'comparison') throw new Error('Compare actual isolated physical branches from one admitted source.');
  const policy = physicalCounterfactualPolicy(rawPolicy), a = study.rows.find(row => row.reference), b = study.rows.find(row => !row.reference), inherited = new Set(study.constraints?.actorIds || []);
  const branches = [a, b].map((row, index) => ({ id: index ? 'B' : 'A', label: index ? 'B proposed' : 'A original', candidateId: row?.id || null, status: row?.status || 'untested', completed: row?.completed || false,
    traceHash: row?.traceHash || null, patchHash: row?.patchHash || null, safetyFailures: row?.trace?.safetyFailures || [], rejectedInputs: row?.trace?.rejectedInputs || [], frames: row?.trace?.frames || [], projectionFailures: row?.trace?.projectionFailures || [] }));
  const pair = (left, right, signature, time, source) => {
    const records = [left, right].map((events, branch) => { const counts = new Map(); return events.map(event => { const actor = event.actorId, root = inherited.has(actor) ? ['initial-actor', actor] : ['unmatched-branch', branch, actor], base = text([root, signature(event)]), ordinal = counts.get(base) || 0; counts.set(base, ordinal + 1); return { key: base + ':' + ordinal, event }; }); }),
      rightByKey = new Map(records[1].map(record => [record.key, record.event])), matches = [], missing = [], used = new Set(); let matchCount = 0;
    for (const record of records[0]) { const other = rightByKey.get(record.key); if (!other) { if (missing.length < policy.maximumPairs) missing.push(source(record.event, 'A')); continue; } used.add(record.key); matchCount++;
      if (matches.length < policy.maximumPairs) matches.push({ key: record.key, a: source(record.event, 'A'), b: source(other, 'B'), aTick: time(record.event), bTick: time(other), deltaTicks: time(other) - time(record.event) }); }
    const added = records[1].filter(record => !used.has(record.key));
    return { matches, missing, added: added.slice(0, policy.maximumPairs).map(record => source(record.event, 'B')), matchedCount: matchCount,
      missingCount: records[0].length - matchCount, addedCount: added.length, omittedMatchedRecords: Math.max(0, matchCount - matches.length), completeRecordList: matchCount <= policy.maximumPairs && records[0].length - matchCount <= policy.maximumPairs && added.length <= policy.maximumPairs };
  };
  const onsets = pair(a?.trace?.onsets || [], b?.trace?.onsets || [], event => [event.mappingId, event.sourceKind, event.laneId], event => event.timeTicks,
    (event, branch) => ({ branch, eventId: event.intentId, actorId: event.actorId, mappingId: event.mappingId, sourceEventIds: event.sourceEventIds, tick: event.timeTicks, pitchCents: event.pitchCents }));
  const causes = pair(a?.trace?.causeObservations || [], b?.trace?.causeObservations || [], event => event.identity, event => event.tick,
    (event, branch) => ({ branch, eventId: event.eventId, actorId: event.actorId, kind: event.kind, tick: event.tick, position: event.position, sourceEventIds: event.sourceEventIds }));
  const observedPeriods = row => { const groups = new Map(); for (const onset of row?.trace?.onsets || []) { const key = text([onset.actorId, onset.mappingId]); if (!groups.has(key)) groups.set(key, { actorId: onset.actorId, mappingId: onset.mappingId, times: [] }); groups.get(key).times.push(onset.timeTicks); }
    return [...groups.values()].map(group => { group.times.sort((a, b) => a - b); const intervals = group.times.slice(1).map((value, index) => value - group.times[index]);
      return { actorId: group.actorId, mappingId: group.mappingId, observations: group.times.length, meanTicks: intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null,
        minimumTicks: intervals.length ? Math.min(...intervals) : null, maximumTicks: intervals.length ? Math.max(...intervals) : null, intervals: intervals.slice(0, 64), omittedIntervals: Math.max(0, intervals.length - 64) }; }); };
  const aPeriods = observedPeriods(a), bPeriods = observedPeriods(b), periods = aPeriods.map(left => { const right = inherited.has(left.actorId) ? bPeriods.find(value => value.actorId === left.actorId && value.mappingId === left.mappingId) : null;
    return { actorId: left.actorId, mappingId: left.mappingId, a: left, b: right, deltaMeanTicks: right?.meanTicks != null && left.meanTicks != null ? right.meanTicks - left.meanTicks : null }; });
  const anchor = onsets.matches.find(match => !policy.anchorMappingId || match.a.mappingId === policy.anchorMappingId), phraseOffsetTicks = anchor?.deltaTicks ?? null,
    changed = causes.matches.filter(match => match.deltaTicks || text(match.a.position) !== text(match.b.position)), firstDownstream = changed.filter(match => !['CommandApplied', 'CommandRejected', 'CommandWaiting'].includes(match.a.kind)).sort((left, right) => Math.min(left.aTick, left.bTick) - Math.min(right.aTick, right.bTick))[0] || null;
  return freezeData({ schema: 'lemmings-physical-counterfactual-result/v1', comparisonId: (study.sourceIdentity?.baseContinuationHash || 'unsupported') + ':' + study.goal.id + ':r' + study.goal.revision + ':' + (b?.patchHash || 'unavailable'), operationEpoch: study.operationEpoch || 0, sourceIdentity: study.sourceIdentity, base: study.base, policy, branches,
    correspondence: { version: 'initial-actor-typed-occurrence-v1', inheritedActorIds: [...inherited], scope: 'correspondence-not-causal-equality;future-IDs-are-branch-qualified', onsets, causes },
    firstDownstreamDifference: firstDownstream, firstDifferenceCoverage: causes.completeRecordList ? 'complete-typed-occurrence-list' : 'retained-typed-occurrences-only',
    firstMusicalDifference: onsets.matches.find(match => match.deltaTicks || match.a.pitchCents !== match.b.pitchCents) || null, observedPeriods: { groups: periods.slice(0, 128), omittedGroups: Math.max(0, periods.length - 128), unmatchedB: bPeriods.filter(value => !aPeriods.some(other => inherited.has(value.actorId) && other.actorId === value.actorId && other.mappingId === value.mappingId)).slice(0, 128), scope: 'actual-inter-onset-intervals-within-this-horizon;not-travel-distance-or-a-universal-period-law' },
    displacement: { a: a?.metrics?.semanticMetrics?.displacement || null, b: b?.metrics?.semanticMetrics?.displacement || null }, phraseAlignment: { status: phraseOffsetTicks == null ? 'unavailable-no-corresponding-onset' : 'explicit-view-only-offset', shiftBTicks: phraseOffsetTicks == null ? 0 : -phraseOffsetTicks, sourceTimesUnchanged: true },
    emptyDifference: a?.completed === true && b?.completed === true && a.traceHash === b.traceHash, work: study.work, coverage: study.coverage,
    auditionPolicy: 'explicit-independent-owned-reference;fixed-origin-source-time;no-live-or-hardware-output', audioPrepared: false, liveWorldUnchanged: true });
}
