import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { createResolvedPatchRecipeSource, compileSoundContent } from './SoundContentCompiler.js';
import { PATCH_FORK_PROVENANCE_SCHEMA, validatePatchForkProvenance } from './PatchForkProvenance.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'PatchForkError', code }); };
export async function revisePatchCandidate({ candidate, descriptor, name = candidate?.name, macroDefaults = {}, signal, isCurrent = () => true, compile = compileSoundContent } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) fail('stale-source', 'The candidate revision source changed.'); };
  check();
  if (candidate?.state !== 'compiled' || !candidate.compiled?.prepared || typeof name !== 'string' || !name.trim() || name.length > 160)
    fail('invalid-fork-input', 'Choose a compiled exact candidate and a bounded nonempty name.');
  const reference = candidate.reference; let defaults;
  if (reference?.definition?.schemaVersion !== 2) fail('unsupported-parent-schema', 'A future patch schema is read-only; choose a supported parent explicitly.');
  try { defaults = cloneData(macroDefaults, { maxBytes: 4096, maxNodes: 128 }); } catch { fail('invalid-fork-input', 'Use bounded finite macro data.'); }
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || Object.keys(defaults).some(id => !reference.definition.macros.some(macro => macro.id === id)) ||
      Object.values(defaults).some(value => !Number.isFinite(value) || value < 0 || value > 1)) fail('invalid-fork-input', 'Use existing macro IDs and values between zero and one.');
  const artifact = candidate.compiled.prepared.pack.compilation.artifacts.find(entry => entry.id === reference.patchId && entry.revision === reference.revision);
  const neighborhood = artifact?.neighborhood || artifact?.fork?.neighborhood;
  if (!neighborhood || reference.revision >= 2147483647) fail('unsupported-fork', 'This candidate has no editable authored ancestry or has exhausted its revision identity.');
  const changes = { name: name === reference.definition.name ? null : { previous: reference.definition.name, value: name },
    macros: reference.definition.macros.filter(macro => Object.hasOwn(defaults, macro.id) && defaults[macro.id] !== macro.default01)
      .map(macro => ({ id: macro.id, previous01: macro.default01, value01: defaults[macro.id] })) };
  const algorithmRevision = 'explicit-name-and-macro-revision-v1', revision = reference.revision + 1;
  const branchId = 'variation-edit.' + await hashData({ algorithmRevision, parentPackHash: reference.packHash, parentDefinitionHash: reference.definitionHash, revision, changes }); check();
  const fork = { schema: PATCH_FORK_PROVENANCE_SCHEMA, algorithmRevision, branchId, revision,
    parentReference: reference, neighborhood, changes };
  await validatePatchForkProvenance(fork, { engineRequirement: reference.engineRequirement, signal }); check();
  const macros = reference.definition.macros.map(macro => Object.hasOwn(defaults, macro.id) ? { ...macro, default01: defaults[macro.id] } : macro);
  const source = await createResolvedPatchRecipeSource({ prepared: candidate.compiled.prepared, reference, descriptor, candidateId: branchId,
    revision, name, parameters: reference.definition.parameters, performanceMacros: macros, fork, signal }); check();
  const compiled = await compile(source, { targets: [{ descriptor }], signal }); check(); const patch = compiled.prepared.patches[0];
  if (patch?.state !== 'definition-admitted') fail('revision-prepare-refused', patch?.reason || 'The revised definition could not prepare.');
  return freezeData({ id: branchId, slot: candidate.slot, name, state: 'compiled', provenance: neighborhood, fork,
    duplicateLike: compiled.artifacts[0].renderKey === artifact.renderKey, compiled, qualification: 'compiled-data-not-render-qualified',
    reference: { schema: reference.schema, packHash: compiled.prepared.contentHash, patchId: branchId, revision, definitionHash: patch.definitionHash,
      engineRequirement: patch.engineRequirement, assetHashes: [...patch.dependencies].sort(), definition: patch.archivedDefinition } });
}
