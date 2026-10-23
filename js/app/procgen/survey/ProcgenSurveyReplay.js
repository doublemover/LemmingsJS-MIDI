import { canonicalSurveyJson, SURVEY_STATE_SCHEMA } from './ProcgenSurveyCanonical.js';
const surveyReplayEvidenceProblems = result => {
  const problems = [];
  if (!result || typeof result !== 'object') return ['missing-result'];
  for (const key of ['trialId', 'scenarioId', 'candidateId']) if (typeof result[key] !== 'string' || !result[key]) problems.push(`missing-${key}`);
  if (result.schemaVersion !== 1) problems.push('unsupported-result-schema');
  if (result.provenance?.stateSchema !== SURVEY_STATE_SCHEMA) problems.push('legacy-or-unknown-state-schema');
  for (const key of ['scenarioHash', 'budgetHash', 'sourceHash']) if (!/^[0-9a-f]{16}$/i.test(result.provenance?.[key] || '')) problems.push(`missing-${key}`);
  for (const key of ['initialStateHash', 'finalStateHash', 'eventHash']) if (!/^[0-9a-f]{16}$/i.test(result[key] || '')) problems.push(`missing-${key}`);
  if (!Number.isSafeInteger(result.lastTick) || result.lastTick < 0) problems.push('invalid-last-tick');
  if (result.episodeComplete !== true || !['completed', 'failed', 'timeout'].includes(result.status)) problems.push('incomplete-episode');
  if (!Number.isSafeInteger(result.scenario?.horizonTicks) || result.scenario.horizonTicks < 1 || result.lastTick !== result.scenario.horizonTicks) problems.push('horizon-not-reached');
  if (result.scenario?.id !== result.scenarioId || result.candidate?.id !== result.candidateId) problems.push('identity-mismatch');
  if (result.evidence?.truncated !== false) problems.push('truncated-or-unknown-evidence');
  if (!Array.isArray(result.milestones) || !result.milestones.length || result.milestones.at(-1)?.tick !== result.lastTick ||
      result.milestones.some(entry => !Number.isSafeInteger(entry.tick) || !/^[0-9a-f]{16}$/i.test(entry.stateHash || ''))) problems.push('invalid-milestones');
  return problems;
};
const surveyReplayCoverage = (original, replay) => {
  const originalTicks = new Set((original?.milestones || []).map(entry => entry.tick));
  const commonTicks = [...new Set((replay?.milestones || []).map(entry => entry.tick).filter(tick => originalTicks.has(tick)))].sort((a, b) => a - b);
  const replayByTick = new Map((replay?.milestones || []).map(entry => [entry.tick, entry]));
  const mismatchedTicks = (original?.milestones || []).filter(entry => replayByTick.has(entry.tick) &&
    (entry.stateHash !== replayByTick.get(entry.tick).stateHash || entry.eventHash !== replayByTick.get(entry.tick).eventHash)).map(entry => entry.tick);
  return { commonTicks, mismatchedTicks, fromTick: commonTicks[0] ?? null, throughTick: commonTicks.at(-1) ?? null,
    originalMilestones: original?.milestones?.length ?? 0, replayMilestones: replay?.milestones?.length ?? 0 };
};
const compareSurveyReplay = (original, replay, { scope = 'exact deterministic replay' } = {}) => {
  const reasons = [...surveyReplayEvidenceProblems(original).map(reason => `original:${reason}`),
    ...surveyReplayEvidenceProblems(replay).map(reason => `replay:${reason}`)];
  if (scope !== 'exact deterministic replay') reasons.push('unsupported-comparison-scope');
  const coverage = surveyReplayCoverage(original, replay);
  if (!coverage.commonTicks.length) reasons.push('no-common-checkpoints');
  if (coverage.mismatchedTicks.length) reasons.push('checkpoint-hash-mismatch');
  const fields = ['scenarioId', 'candidateId', 'scenario', 'candidate', 'status', 'lastTick', 'initialStateHash', 'finalStateHash', 'eventHash', 'accounting', 'metrics', 'provenance', 'episodeComplete', 'events'];
  const differences = fields.filter(key => canonicalSurveyJson(original?.[key]) !== canonicalSurveyJson(replay?.[key]));
  return { schemaVersion: 2, originalTrialId: original?.trialId, replayTrialId: replay?.trialId,
    matched: !reasons.length && original.trialId === replay.trialId && differences.length === 0, differences,
    validity: reasons.length ? 'invalid-or-incomplete' : 'qualified', reasons, coverage,
    originalFinalStateHash: original?.finalStateHash, replayFinalStateHash: replay?.finalStateHash,
    independentSample: false, scope };
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
export { compareSurveyReplay, firstSurveyDivergence };
