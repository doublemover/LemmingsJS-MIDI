export function resolveOwnedArticulationPolicy(patch) {
  const parameters = patch?.parameters;
  if (!parameters || typeof parameters !== 'object') throw new TypeError('An admitted patch is required for articulation.');
  const releaseSeconds = parameters.releaseSeconds ?? 0.04, attack = parameters.attackSeconds ?? 0.008, decay = parameters.decaySeconds ?? 0.05;
  if (![releaseSeconds, attack, decay].every(value => Number.isFinite(value) && value >= 0 && value <= 4)) throw new RangeError('Patch articulation exceeds the owned local profile.');
  return Object.freeze({ version: 1, releaseSeconds, oneShotTailSeconds: Math.min(4, Math.max(0.04, attack + decay)),
    policy: 'owned-local-envelope-hold-v1', semanticEndsRewritten: false });
}
