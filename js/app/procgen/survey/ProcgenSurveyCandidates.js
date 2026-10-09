import { DEFAULT_PROCGEN_POLICY_CONFIG, normalizeProcgenPolicyConfig } from '../ProcgenPolicyConfig.js';
import { canonicalSurveyJson, hashSurveyValue, semanticSurveyRandom } from './ProcgenSurveyCanonical.js';

const SURVEY_CANDIDATE_VERSION = 1;
const SURVEY_FAMILIES = freezeSurveyValue([
  { id: 'balanced', ranges: { builderBias: [0, 4], minerBias: [-6, -2], learningRate: [0.5, 1.5], explorationStrength: [0.5, 1.5] } },
  { id: 'build-preserving', ranges: { builderBias: [2, 6], minerBias: [-7, -4], learningRate: [0.5, 1.5], explorationStrength: [0.5, 1.5] } },
  { id: 'exploratory', ranges: { builderBias: [0, 4], minerBias: [-6, -2], learningRate: [0.5, 1.5], explorationStrength: [1.5, 3] } }
]);

function freezeSurveyValue(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSurveyValue(child);
    Object.freeze(value);
  }
  return value;
}
function surveyCopy(value) {
  canonicalSurveyJson(value);
  const copy = item => {
    if (Array.isArray(item)) return item.map(copy);
    if (item && typeof item === 'object') {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('Survey manifests must contain plain data');
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, copy(entry)]));
    }
    return item;
  };
  return copy(value);
}
function uintSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Survey sampling seed must be an unsigned 32-bit integer');
  return seed;
}
function dimensionPermutation(seed, family, dimension, count) {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const target = Math.floor(semanticSurveyRandom(seed, 'candidate-design-v1', family, dimension, 'permutation', index) * (index + 1));
    [order[index], order[target]] = [order[target], order[index]];
  }
  return order;
}

function generateProcgenSurveyCandidates({ count = 16, samplingSeed = 1 } = {}) {
  if (![16, 64].includes(count)) throw new RangeError('Survey candidate count must be 16 or 64');
  uintSeed(samplingSeed);
  const candidates = [], seen = new Set();
  const add = (kind, family, configuration, sampling) => {
    const normalized = normalizeProcgenPolicyConfig(configuration), signature = canonicalSurveyJson(normalized);
    if (seen.has(signature)) throw new Error('Duplicate normalized survey candidate');
    seen.add(signature);
    candidates.push({ id: `${kind}-${hashSurveyValue(normalized)}`, kind, family, configuration: normalized, sampling });
  };
  add('baseline', 'current', DEFAULT_PROCGEN_POLICY_CONFIG, { method: 'anchor', version: SURVEY_CANDIDATE_VERSION });
  add('no-learning', 'current', { ...DEFAULT_PROCGEN_POLICY_CONFIG, learningEnabled: false }, { method: 'explicit-ablation', version: SURVEY_CANDIDATE_VERSION });
  const mixedCount = count - 2;
  for (let familyIndex = 0; familyIndex < SURVEY_FAMILIES.length; familyIndex++) {
    const family = SURVEY_FAMILIES[familyIndex], familyCount = Math.floor(mixedCount / SURVEY_FAMILIES.length) + (familyIndex < mixedCount % SURVEY_FAMILIES.length ? 1 : 0);
    const permutations = Object.fromEntries(Object.keys(family.ranges).map(key => [key, dimensionPermutation(samplingSeed, family.id, key, familyCount)]));
    for (let index = 0; index < familyCount; index++) {
      const configuration = { ...DEFAULT_PROCGEN_POLICY_CONFIG, randomMode: 'semantic' }, coordinates = {}, strata = {};
      for (const [key, [low, high]] of Object.entries(family.ranges)) {
        const stratum = permutations[key][index], coordinate = (stratum + semanticSurveyRandom(samplingSeed, 'candidate-design-v1', family.id, key, 'jitter', index)) / familyCount;
        configuration[key] = low + coordinate * (high - low);
        coordinates[key] = coordinate; strata[key] = stratum;
      }
      add('sample', family.id, configuration, { method: 'within-family-latin-hypercube', version: SURVEY_CANDIDATE_VERSION, samplingSeed, familyCount, coordinates, strata });
    }
  }
  return freezeSurveyValue(candidates);
}

function createProcgenSurveyExperiment({ scenarios, candidates, developmentScenarioIds, holdoutScenarioIds, sourceManifest, budgetPolicy, criteria = {} }) {
  if (!Array.isArray(scenarios) || !scenarios.length || !Array.isArray(candidates) || !candidates.length) throw new Error('Survey experiment needs scenarios and candidates');
  const scenarioIds = new Set(scenarios.map(scenario => scenario.id)), candidateIds = new Set(candidates.map(candidate => candidate.id));
  if (scenarioIds.size !== scenarios.length || candidateIds.size !== candidates.length || scenarioIds.has(undefined) || candidateIds.has(undefined)) throw new Error('Survey manifest identities must be unique');
  if (!sourceManifest || !budgetPolicy) throw new Error('Survey experiment needs pinned source and budget manifests');
  const development = new Set(developmentScenarioIds || []), holdout = new Set(holdoutScenarioIds || []);
  if (!development.size || !holdout.size || development.size !== developmentScenarioIds.length || holdout.size !== holdoutScenarioIds.length) throw new Error('Declare unique development and untouched holdout scenario IDs');
  for (const id of [...development, ...holdout]) if (!scenarioIds.has(id)) throw new Error(`Unknown corpus scenario: ${id}`);
  for (const id of development) if (holdout.has(id)) throw new Error('Development and holdout scenarios must be disjoint');
  const developmentSeeds = new Set(scenarios.filter(scenario => development.has(scenario.id)).map(scenario => scenario.environmentSeed).filter(Number.isInteger));
  for (const scenario of scenarios) if (holdout.has(scenario.id) && developmentSeeds.has(scenario.environmentSeed)) throw new Error('Holdout worlds must not reuse development environment seeds');
  for (const candidate of candidates) normalizeProcgenPolicyConfig(candidate.configuration);
  const declaration = surveyCopy({ schemaVersion: 1, candidateVersion: SURVEY_CANDIDATE_VERSION, scenarios, candidates, developmentScenarioIds: [...development].sort(), holdoutScenarioIds: [...holdout].sort(), sourceManifest, budgetPolicy, criteria });
  declaration.scenarioSetHash = hashSurveyValue(declaration.scenarios);
  declaration.candidateSetHash = hashSurveyValue(declaration.candidates);
  declaration.experimentId = `survey-${hashSurveyValue(declaration)}`;
  return freezeSurveyValue(declaration);
}

export { SURVEY_CANDIDATE_VERSION, SURVEY_FAMILIES, freezeSurveyValue, surveyCopy, generateProcgenSurveyCandidates, createProcgenSurveyExperiment };
