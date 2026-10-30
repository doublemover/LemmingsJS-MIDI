import { canonicalSurveyJson, hashSurveyValue, SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from './ProcgenSurveyCanonical.js';
import { compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
const checksum = value => typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const crewEvidenceProblems = result => {
  const crew = result.crew, accounting = result.accounting, scenario = result.scenario || {}, problems = [];
  if (!Array.isArray(crew) || result.evidence?.terminalRecordSchema !== 1) return ['unsupported-crew-evidence'];
  const cohort = new Set(Array.isArray(scenario?.designatedCohort) ? scenario.designatedCohort : []), tick = value => whole(value) && value <= result.lastTick;
  const optionalTick = value => value === null || tick(value);
  if (crew.length > scenario?.actorRecordLimit || new Set(crew.map(record => record?.id)).size !== crew.length ||
      new Set(crew.map(record => `${record?.generation}:${record?.actorId}`)).size !== crew.length || crew.some(record => !record || typeof record.id !== 'string' ||
        !whole(record.actorId) || !whole(record.generation) || !tick(record.birthTick) || !whole(record.birthLane) || record.birthLane >= scenario.physicalLaneCount || !whole(record.birthOrdinal) ||
        !['designated', 'scout', 'worker', 'guard', 'allowedClimb', 'allowedFloat'].every(key => typeof record[key] === 'boolean') || record.designated !== cohort.has(record.id) ||
        !['arrivalTick', 'qualifiedTick', 'deathTick', 'retiredTick'].every(key => optionalTick(record[key])) ||
        record.qualifiedTick !== null && (record.arrivalTick === null || record.qualifiedTick < record.arrivalTick) ||
        record.deathReason !== null && (typeof record.deathReason !== 'string' || !record.deathReason || record.deathTick === null) ||
        record.deathReason === null && record.deathTick !== null ||
        record.retired !== null && !['generation-reset', 'removed', 'missing'].includes(record.retired) ||
        (record.retired === null) !== (record.retiredTick === null) ||
        !Number.isFinite(record.x) || !Number.isFinite(record.y) || !whole(record.lane) || record.lane >= scenario.physicalLaneCount ||
        record.action !== null && typeof record.action !== 'string' ||
        record.terminal !== null && (!record.terminal || record.terminal.schemaVersion !== 1 || !tick(record.terminal.tick) || record.terminal.tick < record.birthTick ||
          record.terminal.causalSequence !== null && !whole(record.terminal.causalSequence) || typeof record.terminal.terminationReason !== 'string' ||
          !record.terminal.actor || record.terminal.actor.x !== record.x || record.terminal.actor.y !== record.y || record.terminal.actor.laneIndex !== record.lane || record.terminal.actor.action !== record.action))) problems.push('invalid-crew-records');
  if (!whole(result.evidence?.pendingLifecycles) || result.evidence.pendingLifecycles !== crew.filter(record => record?.terminal === null).length) problems.push('lifecycle-retention-not-bound');
  const countFields = ['designated', 'planned', 'admitted', 'suppressed', 'arrived', 'qualified', 'alive', 'deaths', 'unresolved', 'retired', 'ordinary', 'scouts', 'workers', 'guards', 'totalBirths', 'additionalBirths', 'allDeaths', 'resets', 'missingActors'];
  if (!accounting || typeof accounting !== 'object' || !countFields.every(key => whole(accounting[key]))) return [...problems, 'invalid-accounting'];
  const selected = crew.filter(record => record?.designated === true), deaths = selected.filter(record => record.deathReason), causes = {};
  for (const record of deaths) causes[record.deathReason] = (causes[record.deathReason] || 0) + 1;
  const expected = { designated: cohort.size, planned: cohort.size, admitted: selected.length, suppressed: cohort.size - selected.length,
    arrived: selected.filter(record => record.arrivalTick !== null).length, qualified: selected.filter(record => record.qualifiedTick !== null).length,
    deaths: deaths.length, retired: selected.filter(record => record.retired !== null).length,
    unresolved: cohort.size - selected.filter(record => record.arrivalTick !== null || record.deathReason).length,
    ordinary: selected.filter(record => !record.scout).length, scouts: selected.filter(record => record.scout).length,
    workers: selected.filter(record => record.worker).length, guards: selected.filter(record => record.guard).length,
    totalBirths: crew.length, additionalBirths: crew.length - selected.length, allDeaths: crew.filter(record => record?.deathReason).length,
    missingActors: crew.filter(record => record?.retired === 'missing').length };
  let causesMatch = false;
  try { causesMatch = canonicalSurveyJson(accounting.deathsByCause) === canonicalSurveyJson(causes); } catch { /* Invalid evidence is reported below. */ }
  if (Object.entries(expected).some(([key, value]) => accounting[key] !== value) || !causesMatch ||
      accounting.firstDeathTick !== deaths.reduce((first, record) => first === null ? record.deathTick : Math.min(first, record.deathTick), null) ||
      accounting.alive > accounting.admitted - accounting.deaths - accounting.retired || accounting.resets !== result.metrics?.resets) problems.push('crew-accounting-not-bound');
  const expectedStatus = accounting.qualified === accounting.designated ? 'completed' : accounting.deaths || accounting.retired ? 'failed' : 'timeout';
  if (result.status !== expectedStatus) problems.push('outcome-accounting-not-bound');
  if (!result.validity || !['accountingComplete', 'protectedTerrain', 'legitimateActions'].every(key => result.validity[key] === null || typeof result.validity[key] === 'boolean')) problems.push('invalid-validity-evidence');
  return problems;
};
const surveyReplayEvidenceProblems = result => {
  const problems = [];
  if (!result || typeof result !== 'object') return ['missing-result'];
  for (const key of ['trialId', 'scenarioId', 'candidateId']) if (typeof result[key] !== 'string' || !result[key]) problems.push(`missing-${key}`);
  if (result.schemaVersion !== 1) problems.push('unsupported-result-schema');
  if (result.provenance?.stateSchema !== SURVEY_STATE_SCHEMA) problems.push('legacy-or-unknown-state-schema');
  if (result.provenance?.canonicalSchema !== SURVEY_CANONICAL_SCHEMA) problems.push('legacy-or-unknown-canonical-schema');
  if (result.provenance?.harnessVersion !== 1) problems.push('unsupported-harness-version');
  for (const key of ['scenarioHash', 'budgetHash', 'sourceHash']) if (!/^[0-9a-f]{16}$/i.test(result.provenance?.[key] || '')) problems.push(`missing-${key}`);
  for (const key of ['initialStateHash', 'initialScenarioStateHash', 'finalStateHash', 'finalPhysicalStateHash', 'eventHash']) if (!checksum(result[key])) problems.push(`missing-${key}`);
  if (result.initialPhysicalStateHash !== undefined && !checksum(result.initialPhysicalStateHash)) problems.push('invalid-initialPhysicalStateHash');
  if (!Number.isSafeInteger(result.lastTick) || result.lastTick < 0) problems.push('invalid-last-tick');
  if (result.episodeComplete !== true || !['completed', 'failed', 'timeout'].includes(result.status)) problems.push('incomplete-episode');
  if (!Number.isSafeInteger(result.scenario?.horizonTicks) || result.scenario.horizonTicks < 1 || result.lastTick !== result.scenario.horizonTicks) problems.push('horizon-not-reached');
  if (result.scenario?.schemaVersion !== 1 || result.scenario?.stateSchema !== SURVEY_STATE_SCHEMA || !whole(result.scenario?.actorRecordLimit) ||
      result.scenario.actorRecordLimit < 1 || result.scenario.actorRecordLimit > 65536 || !whole(result.scenario?.physicalLaneCount) || result.scenario.physicalLaneCount < 1 || result.scenario.physicalLaneCount > 64 ||
      !Array.isArray(result.scenario?.designatedCohort) || !result.scenario.designatedCohort.length || result.scenario.designatedCohort.length > 4096 ||
      result.scenario.designatedCohort.some(id => typeof id !== 'string') || new Set(result.scenario.designatedCohort).size !== result.scenario.designatedCohort.length) problems.push('invalid-scenario-declaration');
  if (result.scenario?.id !== result.scenarioId || result.candidate?.id !== result.candidateId) problems.push('identity-mismatch');
  if (result.policySeed !== result.candidate?.configuration?.policySeed) problems.push('policy-seed-not-bound');
  if (result.terminationReason !== (result.status === 'completed' ? 'declared-goal-qualified' : 'declared-horizon')) problems.push('completion-reason-not-bound');
  if (result.scenario && result.candidate) {
    try {
      if (result.provenance?.scenarioHash !== hashSurveyValue(result.scenario)) problems.push('scenario-hash-not-bound');
      if (result.provenance?.budgetHash !== hashSurveyValue({ horizonTicks: result.scenario.horizonTicks, maxActors: result.scenario.maxActors, worldOptions: result.scenario.worldOptions })) problems.push('budget-hash-not-bound');
      if (result.provenance?.sourceHash !== hashSurveyValue({ engineCommit: result.scenario.engineCommit, assetHashes: result.scenario.assetHashes, generatorVersion: result.scenario.generatorVersion })) problems.push('source-hash-not-bound');
      if (result.trialId !== 'trial-' + hashSurveyValue({ harnessVersion: 1, stateSchema: SURVEY_STATE_SCHEMA, scenario: result.scenario, candidate: result.candidate })) problems.push('trial-identity-not-bound');
    } catch { problems.push('unsupported-identity-payload'); }
  }
  if (result.evidence?.truncated !== false) problems.push('truncated-or-unknown-evidence');
  if (result.evidence?.physicalBatchComplete !== true) problems.push('incomplete-physical-batch');
  if (!Array.isArray(result.milestones) || !result.milestones.length || result.milestones.length > 256 || result.milestones[0]?.tick !== 0 || result.milestones.at(-1)?.tick !== result.lastTick ||
      result.milestones.some((entry, index) => !Number.isSafeInteger(entry?.tick) || entry.tick < 0 || entry.tick > result.lastTick ||
        index > 0 && entry.tick <= result.milestones[index - 1]?.tick || !checksum(entry?.stateHash) || !checksum(entry?.physicalStateHash) || !checksum(entry?.eventHash))) problems.push('invalid-milestones');
  const milestones = Array.isArray(result.milestones) ? result.milestones : [];
  if (milestones[0]?.stateHash !== result.initialStateHash || milestones.at(-1)?.stateHash !== result.finalStateHash ||
      milestones.at(-1)?.eventHash !== result.eventHash || milestones[0]?.physicalStateHash !== (result.initialPhysicalStateHash ?? result.initialScenarioStateHash) || milestones.at(-1)?.physicalStateHash !== result.finalPhysicalStateHash) problems.push('milestone-boundary-mismatch');
  if (!Array.isArray(result.events) || result.events.length > 256 || !Number.isSafeInteger(result.evidence?.eventCount) || result.evidence.eventCount !== result.events.length ||
      result.evidence?.eventsOmitted !== 0 || result.evidence?.milestonesOmitted !== 0) problems.push('incomplete-retention-accounting');
  if (Array.isArray(result.events) && result.evidence?.eventsOmitted === 0) {
    if (result.events.some((event, index) => !event || typeof event.type !== 'string' || !event.type || !whole(event.tick) || event.tick > result.lastTick || index > 0 && event.tick < result.events[index - 1]?.tick)) problems.push('invalid-event-records');
    try {
      const eventHashes = [hashSurveyValue(['logical-events-v1'])];
      for (const event of result.events) eventHashes.push(hashSurveyValue([eventHashes.at(-1), event]));
      if (eventHashes.at(-1) !== result.eventHash) problems.push('event-hash-not-bound');
      if (milestones.some((entry, index) => !whole(entry?.telemetry?.eventCount) || entry.telemetry.eventCount > result.events.length ||
          index > 0 && entry.telemetry.eventCount < milestones[index - 1]?.telemetry?.eventCount || eventHashes[entry.telemetry.eventCount] !== entry.eventHash ||
          entry.telemetry.tick !== entry.tick || entry.telemetry.trialId !== result.trialId || entry.telemetry.scenarioId !== result.scenarioId || entry.telemetry.candidateId !== result.candidateId ||
          entry.telemetry.eventHash !== entry.eventHash)) problems.push('milestone-events-not-bound');
    } catch { problems.push('unsupported-event-payload'); }
  }
  problems.push(...crewEvidenceProblems(result));
  return problems;
};
const surveyReplayCoverage = (original, replay) => {
  const originalMilestones = (Array.isArray(original?.milestones) ? original.milestones : []).filter(entry => Number.isSafeInteger(entry?.tick));
  const replayMilestones = (Array.isArray(replay?.milestones) ? replay.milestones : []).filter(entry => Number.isSafeInteger(entry?.tick));
  const originalTicks = new Set(originalMilestones.map(entry => entry.tick));
  const commonTicks = [...new Set(replayMilestones.map(entry => entry.tick).filter(tick => originalTicks.has(tick)))].sort((a, b) => a - b);
  const replayByTick = new Map(replayMilestones.map(entry => [entry.tick, entry]));
  const differencesAt = key => originalMilestones.filter(entry => replayByTick.has(entry.tick) && entry[key] !== replayByTick.get(entry.tick)[key]).map(entry => entry.tick);
  const logicalMismatchedTicks = differencesAt('stateHash'), physicalMismatchedTicks = differencesAt('physicalStateHash'), eventMismatchedTicks = differencesAt('eventHash');
  const mismatchedTicks = [...new Set([...logicalMismatchedTicks, ...physicalMismatchedTicks, ...eventMismatchedTicks])].sort((a,b) => a - b);
  return { commonTicks, mismatchedTicks, intervals: commonTicks.slice(1).map((tick, index) => ({ fromTick: commonTicks[index], throughTick: tick,
    observation: 'endpoint-checksums; interior ticks not individually observed' })),
  logicalMismatchedTicks, physicalMismatchedTicks, eventMismatchedTicks, checksumDomains: ['logical-state', 'physical-state', 'logical-events'],
  truncated: original?.evidence?.truncated !== false || replay?.evidence?.truncated !== false,
  fromTick: commonTicks[0] ?? null, throughTick: commonTicks.at(-1) ?? null,
  originalMilestones: originalMilestones.length, replayMilestones: replayMilestones.length };
};
const compareSurveyReplay = (original, replay, { scope = 'exact deterministic replay' } = {}) => {
  const reasons = [...surveyReplayEvidenceProblems(original).map(reason => `original:${reason}`),
    ...surveyReplayEvidenceProblems(replay).map(reason => `replay:${reason}`)];
  if (scope !== 'exact deterministic replay') reasons.push('unsupported-comparison-scope');
  const coverage = surveyReplayCoverage(original, replay);
  if (!coverage.commonTicks.length) reasons.push('no-common-checkpoints');
  if (original?.trialId !== replay?.trialId) reasons.push('different-trial-identities');
  if (original?.provenance?.sourceHash !== replay?.provenance?.sourceHash) reasons.push('different-source-identities');
  const fields = ['scenarioId', 'candidateId', 'scenario', 'candidate', 'policySeed', 'status', 'terminationReason', 'lastTick', 'initialStateHash', 'initialScenarioStateHash', 'finalStateHash', 'finalPhysicalStateHash', 'eventHash', 'accounting', 'metrics', 'provenance', 'episodeComplete', 'events', 'crew'];
  if (original?.initialPhysicalStateHash !== undefined || replay?.initialPhysicalStateHash !== undefined) fields.push('initialPhysicalStateHash');
  const differences = fields.filter(key => {
    try { return canonicalSurveyJson(original?.[key]) !== canonicalSurveyJson(replay?.[key]); }
    catch { reasons.push('unsupported-canonical-field:' + key); return true; }
  });
  for (const key of ['accountingComplete', 'protectedTerrain', 'legitimateActions']) if (original?.validity?.[key] !== replay?.validity?.[key]) differences.push('validity.' + key);
  const invalid = reasons.length > 0, mismatch = differences.length > 0 || coverage.mismatchedTicks.length > 0;
  if (coverage.mismatchedTicks.length) reasons.push('checkpoint-hash-mismatch');
  return { schemaVersion: 3, originalTrialId: original?.trialId, replayTrialId: replay?.trialId,
    matched: !invalid && !mismatch, differences,
    validity: invalid ? 'invalid-or-incomplete' : mismatch ? 'mismatch' : 'qualified', reasons, coverage,
    originalFinalStateHash: original?.finalStateHash, replayFinalStateHash: replay?.finalStateHash,
    independentSample: false, scope };
};
const compareSurveyCompatibilityReplay = (original, replay, sourceVerification) => {
  const comparison = compareSurveyReplay(original, replay);
  const compatibilityMatch = comparison.matched;
  return { ...comparison, schemaVersion: 4, matched: false, compatibilityMatch,
    validity: compatibilityMatch ? 'execution-unbound' : comparison.validity,
    reasons: [...comparison.reasons, 'active-execution-unbound'], scope: 'current-runtime-compatibility',
    artifactIntegrity: { status: sourceVerification?.artifactIntegrity || 'unknown', codeDigest: sourceVerification?.codeDigest || null,
      codeStatus: sourceVerification?.codeArtifactIntegrity || 'unknown', assetStatus: sourceVerification?.assetIntegrity || 'unknown',
      policy: sourceVerification?.artifactPolicy || 'legacy-unspecified' },
    executionIdentity: { status: 'unbound', reason: sourceVerification?.executionReason || 'active-module-graph-not-proven' },
    replayConsistency: { status: compatibilityMatch ? 'matched' : 'mismatch', coverage: comparison.coverage } };
};
const compareSurveyBoundReplay = (original, replay, sourceVerification, recordedIdentity) => {
  const comparison = compareSurveyReplay(original, replay), active = compareActiveExecutionIdentity(sourceVerification?.executionIdentity), recorded = compareActiveExecutionIdentity(recordedIdentity);
  const bound = active.matched && recorded.matched && sourceVerification?.activeExecution === 'bound' && sourceVerification?.artifactIntegrity === 'verified' &&
    sourceVerification?.executionReason === 'owned-immutable-dedicated-worker' && sourceVerification?.executionIdentity?.realmId !== active.active.realmId;
  return { ...comparison, schemaVersion: 4, matched: bound && comparison.matched,
    validity: bound ? comparison.validity : 'execution-unbound',
    reasons: [...comparison.reasons, ...(!bound ? ['active-execution-unbound-or-mismatched'] : [])],
    artifactIntegrity: { status: sourceVerification?.artifactIntegrity || 'unknown', codeDigest: sourceVerification?.codeDigest || null },
    executionIdentity: { status: bound ? 'bound' : 'unbound', recorded: recordedIdentity || null, executing: sourceVerification?.executionIdentity || null },
    replayConsistency: { status: comparison.matched ? 'matched' : 'mismatch', coverage: comparison.coverage } };
};
const firstSurveyDivergence = (baseline, candidate) => {
  const other = new Map((candidate.milestones || []).map(entry => [entry.tick, entry])); let previousTick = 0;
  for (const entry of baseline.milestones || []) {
    const compared = other.get(entry.tick); if (!compared) continue;
    const physical = entry.physicalStateHash && compared.physicalStateHash ? entry.physicalStateHash !== compared.physicalStateHash :
      canonicalSurveyJson([entry.telemetry?.preview?.actors, entry.telemetry?.accounting, entry.telemetry?.excavatedPixels]) !== canonicalSurveyJson([compared.telemetry?.preview?.actors, compared.telemetry?.accounting, compared.telemetry?.excavatedPixels]);
    if (physical || entry.eventHash !== compared.eventHash) return { fromTick: previousTick, throughTick: entry.tick, exactTick: entry.tick === 0, physical, events: entry.eventHash !== compared.eventHash };
    previousTick = entry.tick;
  }
  return null;
};
export { compareSurveyReplay, compareSurveyCompatibilityReplay, compareSurveyBoundReplay, firstSurveyDivergence };
