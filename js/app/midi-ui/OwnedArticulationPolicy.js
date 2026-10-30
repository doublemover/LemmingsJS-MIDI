export function resolveOwnedArticulationPolicy(patch) {
  const parameters = patch?.parameters;
  if (!parameters || typeof parameters !== 'object') throw new TypeError('An admitted patch is required for articulation.');
  const releaseSeconds = parameters.releaseSeconds ?? 0.04, attack = parameters.attackSeconds ?? 0.008, decay = parameters.decaySeconds ?? 0.05;
  if (![releaseSeconds, attack, decay].every(value => Number.isFinite(value) && value >= 0 && value <= 4)) throw new RangeError('Patch articulation exceeds the owned local profile.');
  let holdSeconds = attack + decay;
  if (patch.engineId === 'worklet-texture') holdSeconds = Math.max(holdSeconds, (parameters.textureBodySeconds ?? 0.05) * 1.5, 0.08);
  if (patch.engineId === 'worklet-seed-layers') {
    const material = patch.seedLayers?.components?.[0];
    if (!material || !Number.isSafeInteger(material.sourceFrames) || !Number.isSafeInteger(material.sourceRate) || material.sourceFrames < 2 || material.sourceRate < 8000) throw new RangeError('Layered articulation requires the complete original component clock.');
    holdSeconds = Math.max(holdSeconds, material.sourceFrames / material.sourceRate);
  }
  if (patch.engineId === 'worklet-granular') {
    const milliseconds = parameters.grainMilliseconds ?? 70;
    if (!Number.isFinite(milliseconds) || milliseconds < 20 || milliseconds > 140) throw new RangeError('Invalid grain duration profile.');
    holdSeconds = Math.max(holdSeconds, milliseconds / 1000);
  }
  if (patch.engineId === 'worklet-spectrum') {
    const t60 = parameters.partialDecaySeconds ?? 0;
    if (!Number.isFinite(t60) || t60 < 0 || t60 > 4) throw new RangeError('Invalid partial decay profile.');
    holdSeconds = Math.max(holdSeconds, t60 * 1.5);
  }
  if (patch.engineId === 'worklet-pluck') {
    const stringT60 = parameters.stringT60Seconds ?? 0.9, bodyT60 = parameters.bodyT60Seconds ?? 0.3;
    if (!Number.isFinite(stringT60) || stringT60 < 0.1 || stringT60 > 4 || !Number.isFinite(bodyT60) || bodyT60 < 0.05 || bodyT60 > 2) throw new RangeError('Invalid pluck articulation profile.');
    holdSeconds = Math.max(holdSeconds, stringT60 * 1.5, bodyT60 * 1.5);
  }
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
