import { cloneData, hashData } from '../../core/CanonicalData.js';
import { createInstrumentPatchRegistry } from './InstrumentPatchV2.js';
import { validateDrumKitBinding } from './DrumKitDefinition.js';

const limits = { maxBytes: 65536, maxNodes: 8192, domain: 'Saved sound reference' }, references = new WeakSet();
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });

export const getSupportedInstrumentDefinition = reference => reference?.definition?.schemaVersion === 2 ? reference.definition : null;

export function validateSoundContentReference(raw) {
  if (raw == null) return null; if (references.has(raw)) return raw;
  const reference = cloneData(raw, limits), requirement = reference.engineRequirement, patch = reference.definition;
  if (reference.schema !== 'lemmings-sound-reference/v1' || !hash(reference.packHash) || !id(reference.patchId) ||
      !Number.isSafeInteger(reference.revision) || reference.revision < 1 || reference.revision > 2147483647 || !hash(reference.definitionHash) ||
      !requirement || !id(requirement.engineId) || !Number.isInteger(requirement.engineVersion) || requirement.engineVersion < 1 || requirement.engineVersion > 65535 ||
      !hash(requirement.artifactHash) || !hash(requirement.parameterSchemaHash) || !Array.isArray(reference.assetHashes) || reference.assetHashes.length > 512 ||
      reference.assetHashes.some(value => !hash(value)) || new Set(reference.assetHashes).size !== reference.assetHashes.length ||
      !patch || patch.id !== reference.patchId || patch.revision !== reference.revision || patch.engineId !== requirement.engineId || patch.engineVersion !== requirement.engineVersion)
    throw failure('invalid-sound-reference', 'Saved sound reference does not pin a complete immutable patch definition.');
  if (reference.drumKit !== undefined) {
    if (!reference.drumKit || Object.keys(reference.drumKit).some(key => !['hash', 'definition'].includes(key)) || !hash(reference.drumKit.hash) || !reference.assetHashes.includes(reference.drumKit.hash)) throw failure('invalid-drum-kit-reference', 'Percussion must retain its exact declared kit data as an immutable source dependency.');
    validateDrumKitBinding(reference.drumKit.definition, reference.definition);
  }
  references.add(reference); return reference;
}

export async function resolveSoundContentReference(raw, { engineDescriptors = [], availableHashes = [], signal } = {}) {
  signal?.throwIfAborted(); const reference = validateSoundContentReference(raw);
  if (!reference) throw failure('invalid-sound-reference', 'No sound reference was supplied.');
  if (await hashData(reference.definition, limits) !== reference.definitionHash) throw failure('content-mismatch', 'Saved instrument definition differs from its immutable hash.'); signal?.throwIfAborted();
  const drumKit = reference.drumKit ? validateDrumKitBinding(reference.drumKit.definition, reference.definition) : null;
  if (drumKit && await hashData(drumKit, limits) !== reference.drumKit.hash) throw failure('content-mismatch', 'Saved drum-kit definition differs from its immutable source hash.'); signal?.throwIfAborted();
  if (reference.definition.schemaVersion !== 2) return Object.freeze({ status: 'patch-schema-unavailable', reference });
  const descriptor = engineDescriptors.find(engine => engine.engineId === reference.engineRequirement.engineId && engine.engineVersion === reference.engineRequirement.engineVersion);
  if (!descriptor) return Object.freeze({ status: 'engine-unavailable', reference });
  if (descriptor.artifactHash !== reference.engineRequirement.artifactHash || descriptor.parameterSchemaHash !== reference.engineRequirement.parameterSchemaHash)
    return Object.freeze({ status: 'engine-revision-mismatch', reference });
  const registry = createInstrumentPatchRegistry(); registry.register(reference.definition, descriptor);
  const missing = reference.assetHashes.filter(hash => !availableHashes.includes(hash));
  if (missing.length) return Object.freeze({ status: 'asset-missing', reference, missingHashes: Object.freeze(missing) });
  return Object.freeze({ ...registry.resolve(reference.patchId, reference.revision, { engineDescriptors: [descriptor], assetHashes: availableHashes }), reference, ...(drumKit ? { drumKit } : {}) });
}
