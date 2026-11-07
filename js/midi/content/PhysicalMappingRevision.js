import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { validateSoundContentReference } from './SoundContentReference.js';
import { validateEngineDescriptor, validateInstrumentPatchV2 } from './InstrumentPatchV2.js';
import { validateInstrumentBindings } from './InstrumentPerformance.js';
import { prepareSoundContentPack, planSoundContentSelection } from './SoundContentPack.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'physical-mapping-revision-invalid' }); };
export async function preparePhysicalMappingRevision({ prepared, reference: raw, descriptor, bindings, signal } = {}) {
  signal?.throwIfAborted();
  const reference = validateSoundContentReference(raw), engine = validateEngineDescriptor(descriptor);
  if (!reference || reference.definition.schemaVersion !== 2 || reference.drumKit || prepared?.contentHash !== reference.packHash ||
      !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => reference.engineRequirement[key] === engine[key]))
    fail('Edit an exact supported installed instrument with its executing parameter schema. Complete drum kits need a separate compound edit.');
  const parent = prepared.patches.find(entry => entry.identity === reference.patchId + '@' + reference.revision);
  if (parent?.state !== 'definition-admitted' || parent.definitionHash !== reference.definitionHash ||
      await hashData(reference.definition, { maxBytes: 65536, maxNodes: 8192 }) !== reference.definitionHash)
    fail('The installed parent definition differs from the pinned mapping source.');
  const causalBindings = validateInstrumentBindings(bindings, engine.parameters);
  if (canonicalDataText(causalBindings).text === canonicalDataText(parent.definition.causalBindings).text)
    return Object.freeze({ state: 'unchanged', reference });
  if (reference.revision >= 2147483647) fail('The immutable patch revision identity is exhausted.');
  const revision = reference.revision + 1, id = 'physical-mapping.' + await hashData({ algorithm: 'typed-physical-binding-edit-v1',
    parentPackHash: reference.packHash, parentDefinitionHash: reference.definitionHash, revision, causalBindings });
  signal?.throwIfAborted();
  const definition = validateInstrumentPatchV2({ ...reference.definition, id, revision, causalBindings }, engine);
  const selected = planSoundContentSelection(prepared, [parent.identity]), licenseHashes = new Set(selected.credits.map(entry => entry.rights.licenseTextHash).filter(Boolean));
  const pack = { ...prepared.pack, id, version: '1.0.0', name: definition.name,
    origin: { id: prepared.pack.id, version: prepared.pack.version, contentHash: prepared.contentHash },
    modifications: [...prepared.pack.modifications.slice(-30), 'Explicit typed physical bindings; parent ' + parent.identity + ' / ' + reference.definitionHash + '; typed-physical-binding-edit-v1'],
    files: selected.files, licenses: prepared.pack.licenses.filter(license => licenseHashes.has(license.sha256)),
    patches: [{ definition, engineRequirement: reference.engineRequirement, dependencies: [...parent.dependencies], rights: parent.rights }] };
  delete pack.compilation;
  const next = await prepareSoundContentPack(pack, { engineDescriptors: [engine], signal }); signal?.throwIfAborted();
  const patch = next.patches[0]; if (patch?.state !== 'definition-admitted') fail('The revised mapping could not prepare with the executing engine.');
  return freezeData({ state: 'prepared', prepared: next, parentReference: reference, mappingOrder: causalBindings.map(binding => binding.id),
    qualification: 'typed-definition-validated;live-admission-and-render-evidence-separate',
    reference: { schema: reference.schema, packHash: next.contentHash, patchId: id, revision, definitionHash: patch.definitionHash,
      engineRequirement: patch.engineRequirement, assetHashes: [...patch.dependencies].sort(), definition: patch.archivedDefinition } });
}
