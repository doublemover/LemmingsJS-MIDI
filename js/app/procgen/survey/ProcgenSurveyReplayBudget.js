import { createResourceBudget } from '../../resources/ResourceBudget.js';
import { normalizeSurveyScenario } from './ProcgenSurveyScenario.js';

export const browserSurveyReplayBudget = createResourceBudget();
export const estimateBrowserSurveyReplayBytes = raw => {
  const scenario = normalizeSurveyScenario(raw); let slots = 1;
  while (slots < Math.min(1024, Math.ceil(scenario.maxActors / scenario.physicalLaneCount / 2) + 4)) slots *= 2;
  const collision = scenario.physicalLaneCount * slots * Math.ceil(256 * scenario.laneHeight / 32) * 8;
  const estimate = 192 * 1048576 + collision * 3 + scenario.maxActors * 16384 + scenario.actorRecordLimit * 1024;
  if (!Number.isSafeInteger(estimate) || estimate > 512 * 1048576 || scenario.actorRecordLimit > 16384) throw new Error('This survey exceeds the isolated browser replay resource profile.');
  return estimate;
};
