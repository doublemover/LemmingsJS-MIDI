import { canonicalSurveyJson, hashSurveyValue, SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from './ProcgenSurveyCanonical.js';
const surveyReplayEvidenceProblems = result => {
  const problems = [];
  if (!result || typeof result !== 'object') return ['missing-result'];
  for (const key of ['trialId', 'scenarioId', 'candidateId']) if (typeof result[key] !== 'string' || !result[key]) problems.push(`missing-${key}`);
  if (result.schemaVersion !== 1) problems.push('unsupported-result-schema');
  if (result.provenance?.stateSchema !== SURVEY_STATE_SCHEMA) problems.push('legacy-or-unknown-state-schema');
  if (result.provenance?.canonicalSchema !== SURVEY_CANONICAL_SCHEMA) problems.push('legacy-or-unknown-canonical-schema');
  if (result.provenance?.harnessVersion !== 1) problems.push('unsupported-harness-version');
  for (const key of ['scenarioHash', 'budgetHash', 'sourceHash']) if (!/^[0-9a-f]{16}$/i.test(result.provenance?.[key] || '')) problems.push(`missing-${key}`);
  for (const key of ['initialStateHash', 'finalStateHash', 'eventHash']) if (!/^[0-9a-f]{16}$/i.test(result[key] || '')) problems.push(`missing-${key}`);
  if (!Number.isSafeInteger(result.lastTick) || result.lastTick < 0) problems.push('invalid-last-tick');
  if (result.episodeComplete !== true || !['completed', 'failed', 'timeout'].includes(result.status)) problems.push('incomplete-episode');
  if (!Number.isSafeInteger(result.scenario?.horizonTicks) || result.scenario.horizonTicks < 1 || result.lastTick !== result.scenario.horizonTicks) problems.push('horizon-not-reached');
  if (result.scenario?.id !== result.scenarioId || result.candidate?.id !== result.candidateId) problems.push('identity-mismatch');
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
  if (!Array.isArray(result.milestones) || !result.milestones.length || result.milestones[0]?.tick !== 0 || result.milestones.at(-1)?.tick !== result.lastTick ||
      result.milestones.some((entry, index) => !Number.isSafeInteger(entry?.tick) || entry.tick < 0 || entry.tick > result.lastTick ||
        index > 0 && entry.tick <= result.milestones[index - 1]?.tick || !/^[0-9a-f]{16}$/i.test(entry?.stateHash || '') || !/^[0-9a-f]{16}$/i.test(entry?.eventHash || ''))) problems.push('invalid-milestones');
  const milestones = Array.isArray(result.milestones) ? result.milestones : [];
  if (milestones[0]?.stateHash !== result.initialStateHash || milestones.at(-1)?.stateHash !== result.finalStateHash ||
      milestones.at(-1)?.eventHash !== result.eventHash) problems.push('milestone-boundary-mismatch');
  if (!Array.isArray(result.events) || !Number.isSafeInteger(result.evidence?.eventCount) || result.evidence.eventCount !== result.events.length ||
      result.evidence?.eventsOmitted !== 0 || result.evidence?.milestonesOmitted !== 0) problems.push('incomplete-retention-accounting');
  return problems;
};
const surveyReplayCoverage = (original, replay) => {
  const originalMilestones = (Array.isArray(original?.milestones) ? original.milestones : []).filter(entry => Number.isSafeInteger(entry?.tick));
  const replayMilestones = (Array.isArray(replay?.milestones) ? replay.milestones : []).filter(entry => Number.isSafeInteger(entry?.tick));
  const originalTicks = new Set(originalMilestones.map(entry => entry.tick));
  const commonTicks = [...new Set(replayMilestones.map(entry => entry.tick).filter(tick => originalTicks.has(tick)))].sort((a, b) => a - b);
  const replayByTick = new Map(replayMilestones.map(entry => [entry.tick, entry]));
  const mismatchedTicks = originalMilestones.filter(entry => replayByTick.has(entry.tick) &&
    (entry.stateHash !== replayByTick.get(entry.tick).stateHash || entry.eventHash !== replayByTick.get(entry.tick).eventHash)).map(entry => entry.tick);
  return { commonTicks, mismatchedTicks, intervals: commonTicks.slice(1).map((tick, index) => ({ fromTick: commonTicks[index], throughTick: tick,
    observation: 'endpoint-checksums; interior ticks not individually observed' })),
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
  const fields = ['scenarioId', 'candidateId', 'scenario', 'candidate', 'status', 'lastTick', 'initialStateHash', 'finalStateHash', 'eventHash', 'accounting', 'metrics', 'provenance', 'episodeComplete', 'events'];
  const differences = fields.filter(key => {
    try { return canonicalSurveyJson(original?.[key]) !== canonicalSurveyJson(replay?.[key]); }
    catch { reasons.push('unsupported-canonical-field:' + key); return true; }
  });
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
  return { ...comparison, schemaVersion: 3, matched: false, compatibilityMatch,
    validity: compatibilityMatch ? 'execution-unbound' : comparison.validity,
    reasons: [...comparison.reasons, 'active-execution-unbound'], scope: 'current-runtime-compatibility',
    artifactIntegrity: { status: sourceVerification?.artifactIntegrity || 'unknown', codeDigest: sourceVerification?.codeDigest || null },
    executionIdentity: { status: 'unbound', reason: sourceVerification?.executionReason || 'active-module-graph-not-proven' },
    replayConsistency: { status: compatibilityMatch ? 'matched' : 'mismatch', coverage: comparison.coverage } };
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
export { compareSurveyReplay, compareSurveyCompatibilityReplay, firstSurveyDivergence };
