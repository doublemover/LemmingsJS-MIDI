import { cloneData, freezeData } from '../../core/CanonicalData.js';
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function retainSoundRealizationDecision(raw) {
  if (raw == null) return null;
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 128 }), engine = value.engineRequirement;
  if (value.schema !== 'lemmings-sound-realization-admission/v1' || Object.keys(value).some(key => !['schema', 'groupId', 'requestedProfileId', 'effectiveProfileId', 'definitionHash', 'engineRequirement', 'reason', 'automatic'].includes(key)) ||
      ![value.groupId, value.requestedProfileId, value.effectiveProfileId, value.reason].every(id) || !hash(value.definitionHash) || typeof value.automatic !== 'boolean' ||
      !engine || Object.keys(engine).some(key => !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].includes(key)) || !id(engine.engineId) ||
      !Number.isSafeInteger(engine.engineVersion) || engine.engineVersion < 1 || engine.engineVersion > 65535 || !hash(engine.artifactHash) || !hash(engine.parameterSchemaHash))
    throw new TypeError('A realization decision must pin requested/effective profiles and the actual admitted engine artifact.');
  return freezeData(value);
}
