export function resolveOwnedArticulationPolicy(patch) {
  const parameters = patch?.parameters;
  if (!parameters || typeof parameters !== 'object') throw new TypeError('An admitted patch is required for articulation.');
  const releaseSeconds = parameters.releaseSeconds ?? 0.04, attack = parameters.attackSeconds ?? 0.008, decay = parameters.decaySeconds ?? 0.05;
  if (![releaseSeconds, attack, decay].every(value => Number.isFinite(value) && value >= 0 && value <= 4)) throw new RangeError('Patch articulation exceeds the owned local profile.');
  let holdSeconds = attack + decay;
  if (patch.engineId === 'native-modal') {
    const bodyT60 = parameters.bodyT60Seconds ?? 0.5, modeCount = parameters.modeCount ?? 4;
    if (!Number.isInteger(modeCount) || modeCount < 4 || modeCount > 8 || !Number.isFinite(bodyT60) || bodyT60 < 0.02 || bodyT60 > 2.5) throw new RangeError('Invalid modal articulation profile.');
    let longest = 0;
    for (let index = 0; index < modeCount; index++) { const scale = parameters['mode' + index + 'T60Scale'] ?? 1;
      if (!Number.isFinite(scale) || scale < 0.01 || scale > 1) throw new RangeError('Invalid mode T60 scale.'); longest = Math.max(longest, bodyT60 * scale); }
    holdSeconds = Math.max(holdSeconds, longest * 1.5);
  }
  return Object.freeze({ version: 1, releaseSeconds, oneShotTailSeconds: Math.min(4, Math.max(0.04, holdSeconds)),
    policy: 'owned-local-envelope-hold-v1', semanticEndsRewritten: false });
}
