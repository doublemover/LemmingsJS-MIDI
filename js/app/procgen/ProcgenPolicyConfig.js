const DEFAULT_PROCGEN_POLICY_CONFIG = Object.freeze({ learningEnabled: true, learningRate: 1, preferenceBound: 3, decayTicks: 256,
  explorationStrength: 1, builderBias: 2, minerBias: -4, troubleBuilderBonus: 4, randomMode: 'legacy', policySeed: 1 });
const POLICY_RANGES = Object.freeze({ learningRate: [0, 2], preferenceBound: [0, 3], decayTicks: [64, 2048],
  explorationStrength: [0, 3], builderBias: [-2, 6], minerBias: [-7, 1], troubleBuilderBonus: [0, 6], policySeed: [0, 0xffffffff] });

const normalizeProcgenPolicyConfig = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Policy configuration must be an object');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_PROCGEN_POLICY_CONFIG, key)) throw new Error(`Unknown policy setting: ${key}`);
  const result = { ...DEFAULT_PROCGEN_POLICY_CONFIG, ...input };
  if (typeof result.learningEnabled !== 'boolean') throw new Error('learningEnabled must be boolean');
  if (!['legacy', 'semantic'].includes(result.randomMode)) throw new Error('Invalid policy randomMode');
  for (const [key, [minimum, maximum]] of Object.entries(POLICY_RANGES)) {
    const value = result[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum ||
        ['decayTicks', 'policySeed'].includes(key) && !Number.isInteger(value)) throw new Error(`Invalid policy setting: ${key}`);
  }
  return Object.freeze(result);
};
export { DEFAULT_PROCGEN_POLICY_CONFIG, normalizeProcgenPolicyConfig, POLICY_RANGES };
