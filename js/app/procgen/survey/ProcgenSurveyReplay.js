import { canonicalSurveyJson } from './ProcgenSurveyCanonical.js';
const compareSurveyReplay = (original, replay) => {
  const fields = ['status', 'lastTick', 'initialStateHash', 'finalStateHash', 'eventHash', 'accounting', 'metrics', 'provenance', 'episodeComplete'];
  const differences = fields.filter(key => canonicalSurveyJson(original[key]) !== canonicalSurveyJson(replay[key]));
  return { schemaVersion: 1, originalTrialId: original.trialId, replayTrialId: replay.trialId,
    matched: original.trialId === replay.trialId && differences.length === 0, differences,
    originalFinalStateHash: original.finalStateHash, replayFinalStateHash: replay.finalStateHash,
    independentSample: false, scope: 'exact deterministic replay' };
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
