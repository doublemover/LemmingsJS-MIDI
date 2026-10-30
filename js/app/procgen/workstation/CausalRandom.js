const CAUSAL_RANDOM_VERSION = 'fnv1a32-avalanche-v1';
const CAUSAL_RANDOM_NAMESPACES = Object.freeze(['terrain', 'population', 'physical-route', 'musical-response']);
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

// Version 1 hashes the UTF-16 code units of this canonical tuple. No mutable
// PRNG cursor is shared by actors, instruments, sinks, or mute decisions.
const causalRandomDecision = ({ seed = 0, algorithmVersion = CAUSAL_RANDOM_VERSION,
  namespace = 'musical-response', mappingId, generation, stableCauseId, drawPurpose = 'respond', probability01 = 1 } = {}) => {
  if (algorithmVersion !== CAUSAL_RANDOM_VERSION || !CAUSAL_RANDOM_NAMESPACES.includes(namespace) ||
      !(Number.isSafeInteger(seed) || boundedId(seed)) || !boundedId(mappingId) ||
      !Number.isSafeInteger(generation) || generation < 0 || !boundedId(stableCauseId) || !boundedId(drawPurpose)) {
    throw new Error('Invalid causal random identity.');
  }
  const tuple = JSON.stringify([algorithmVersion, seed, namespace, mappingId, generation, stableCauseId, drawPurpose]);
  let hash = 2166136261;
  for (let index = 0; index < tuple.length; index++) hash = Math.imul(hash ^ tuple.charCodeAt(index), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  const drawUint32 = (hash ^ (hash >>> 16)) >>> 0;
  const threshold = Number.isFinite(probability01) ? Math.max(0, Math.min(1, probability01)) : 0;
  return Object.freeze({ version: 1, algorithmVersion, seed, namespace, mappingId, generation, stableCauseId,
    drawPurpose, probability01: threshold, drawUint32, draw01: drawUint32 / 4294967296,
    accepted: drawUint32 / 4294967296 < threshold });
};

export { CAUSAL_RANDOM_VERSION, CAUSAL_RANDOM_NAMESPACES, causalRandomDecision };
