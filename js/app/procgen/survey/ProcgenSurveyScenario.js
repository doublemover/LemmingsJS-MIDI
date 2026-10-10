import { canonicalSurveyJson, freezeSurveyData, hashSurveyValue, SURVEY_STATE_SCHEMA } from './ProcgenSurveyCanonical.js';
import { normalizeProcgenPolicyConfig } from '../ProcgenPolicyConfig.js';
import { LemmingStateType as State } from '../../../lemmings/LemmingStateType.js';
import { TriggerTypes } from '../../../level/TriggerTypes.js';
import { MAX_LANE_HEIGHT } from '../ProcgenLaneGeometry.js';

const integer = (value, fallback, minimum, maximum, name) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`Invalid scenario ${name}`);
  return result;
};
const rectangle = (value, name = 'rectangle') => {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(value[key])) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1 || value.width > 16384 || value.height > 16384) throw new Error(`Invalid scenario ${name}`);
  return { x: value.x, y: value.y, width: value.width, height: value.height };
};
const normalizeSurveyScenario = (raw = {}) => {
  canonicalSurveyJson(raw);
  const mode = raw.mode ?? raw.kind ?? 'controlled';
  if (!['controlled', 'generated'].includes(mode)) throw new Error('Invalid survey mode');
  const physicalLaneCount = integer(raw.physicalLaneCount ?? raw.physicalLanes, 1, 1, 64, 'physicalLaneCount');
  const laneHeight = integer(raw.laneHeight, 96, 96, MAX_LANE_HEIGHT, 'laneHeight');
  const horizonTicks = integer(raw.horizonTicks, 600, 1, 100000, 'horizonTicks');
  const cohortSize = integer(raw.cohort?.size, 8, 1, 4096, 'cohort size');
  const birthInterval = integer(raw.cohort?.birthInterval, 4, 0, horizonTicks, 'birth interval');
  const maxActors = integer(raw.maxActors ?? raw.worldOptions?.maxActors, Math.max(256, cohortSize), physicalLaneCount, 4096, 'maxActors');
  const environmentSeed = integer(raw.environmentSeed ?? raw.seed, 42, 0, 0xffffffff, 'environmentSeed');
  const worldOptions = JSON.parse(JSON.stringify(raw.worldOptions || {}));
  const allowed = ['assists', 'speed', 'cohorts', 'maxActors', 'stallPolicy', 'populationPolicy', 'workerLimits', 'spawnSpreadTicks'];
  for (const key of Object.keys(worldOptions)) if (!allowed.includes(key)) throw new Error(`Unsupported survey world setting: ${key}`);
  if (worldOptions.speed != null && (!(worldOptions.speed > 0) || !Number.isFinite(worldOptions.speed))) throw new Error('Invalid survey speed');
  const height = physicalLaneCount * laneHeight;
  const geometry = { solid: (raw.geometry?.solid || Array.from({ length: physicalLaneCount }, (_, lane) => ({ x: 8, y: (lane + 1) * laneHeight - 24, width: 1024, height: 24 }))).map(value => rectangle(value, 'solid')),
    steel: (raw.geometry?.steel || []).map(value => rectangle(value, 'steel')), hazards: (raw.geometry?.hazards || []).map((value, index) => {
      const bounds = rectangle(value, 'hazard'), type = typeof value.type === 'string' ? TriggerTypes[value.type] : value.type;
      if (![TriggerTypes.TRAP, TriggerTypes.DROWN, TriggerTypes.KILL, TriggerTypes.FRYING].includes(type)) throw new Error('Unsupported controlled hazard');
      return { ...bounds, type, id: String(value.id ?? index), cooldownTicks: integer(value.cooldownTicks, 0, 0, horizonTicks, 'hazard cooldown') };
    }) };
  for (const value of [...geometry.solid, ...geometry.steel, ...geometry.hazards]) if (value.y + value.height > height) throw new Error('Scenario rectangle is outside its physical lanes');
  const admissions = mode === 'controlled' ? (raw.admissions || Array.from({ length: cohortSize }, (_, index) => {
    const lane = index % physicalLaneCount;
    return { id: `crew-${index}`, tick: Math.floor(index / physicalLaneCount) * birthInterval, lane, x: 36, y: lane * laneHeight + laneHeight - 24, state: 'WALKING' };
  })).map((value, index) => {
    const lane = integer(value.lane, 0, 0, physicalLaneCount - 1, 'admission lane'), state = value.state ?? 'WALKING';
    if (!['WALKING', 'FALLING', 'BLOCKING'].includes(state) || State[state] == null) throw new Error('Invalid admission state');
    return { id: String(value.id ?? `crew-${index}`), tick: integer(value.tick, 0, 0, horizonTicks - 1, 'admission tick'), lane,
      x: integer(value.x, 36, 8, 0x3ffffffe, 'admission x'), y: integer(value.y, lane * laneHeight + laneHeight - 24, 0, height - 1, 'admission y'), state,
      lookRight: value.lookRight !== false, canClimb: value.canClimb === true, hasParachute: value.hasParachute === true };
  }).sort((a, b) => a.tick - b.tick) : [];
  if (admissions.length > 4096 || new Set(admissions.map(value => value.id)).size !== admissions.length) throw new Error('Invalid admission identities');
  const cohort = raw.designatedCohort || (mode === 'controlled' ? admissions.map(value => value.id) : Array.from({ length: cohortSize }, (_, index) => `1:${index % physicalLaneCount}:${Math.floor(index / physicalLaneCount)}`));
  if (!Array.isArray(cohort) || !cohort.length || cohort.length > 4096 || cohort.some(value => typeof value !== 'string') || new Set(cohort).size !== cohort.length || mode === 'controlled' && cohort.some(id => !admissions.some(value => value.id === id))) throw new Error('Invalid designated cohort');
  const goal = { ...rectangle(raw.goal || { x: 160, y: 0, width: 64, height }, 'goal'),
    requireWalking: raw.goal?.requireWalking !== false, postArrivalTicks: integer(raw.goal?.postArrivalTicks, 0, 0, horizonTicks, 'post-arrival ticks') };
  const scenario = { schemaVersion: 1, stateSchema: SURVEY_STATE_SCHEMA, id: String(raw.id || `${mode}-${environmentSeed}`), mode,
    engineCommit: String(raw.engineCommit || 'unrecorded'), assetHashes: JSON.parse(JSON.stringify(raw.assetHashes || {})), generatorVersion: String(raw.generatorVersion || 'procgen-v1'),
    environmentSeed, physicalLaneCount, laneHeight, horizonTicks, maxActors, worldOptions, geometry, admissions, designatedCohort: [...cohort], goal,
    pack: String(raw.pack || 'lemmings_ohNo'), groundSet: integer(raw.groundSet, 0, 0, 255, 'ground set'),
    bounds: rectangle(raw.bounds || { x: 8, y: 0, width: 1024, height }, 'bounds'),
    checkpointEvery: integer(raw.checkpointEvery, 128, 1, 100000, 'checkpoint interval'),
    actorRecordLimit: integer(raw.actorRecordLimit, 8192, 1, 65536, 'actor record limit'),
    policyMemory: 'fresh', corpus: raw.corpus || 'development', clusterId: String(raw.clusterId || raw.id || environmentSeed) };
  return freezeSurveyData(scenario);
};
const normalizeSurveyCandidate = (raw = {}) => {
  const configuration = normalizeProcgenPolicyConfig(raw.configuration ?? raw.policyConfig ?? {});
  return freezeSurveyData({ id: String(raw.id || 'baseline'), kind: raw.kind || 'baseline', family: raw.family || 'balanced', configuration });
};
const surveyTrialIdentity = (scenario, candidate) => 'trial-' + hashSurveyValue({ harnessVersion: 1, stateSchema: SURVEY_STATE_SCHEMA, scenario, candidate });
export { normalizeSurveyScenario, normalizeSurveyCandidate, surveyTrialIdentity };
