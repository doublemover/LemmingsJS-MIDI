import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { validateSoundContentReference } from './SoundContentReference.js';
import { validatePatchNeighborhoodProvenance } from './PatchNeighborhoodProvenance.js';

const limits = { maxBytes: 262144, maxNodes: 32768, domain: 'Exact patch revision' };
const fail = message => { throw Object.assign(new Error(message), { name: 'PatchForkError', code: 'invalid-fork-revision' }); };
const requireValue = (condition, message) => { if (!condition) fail(message); };
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export const PATCH_FORK_PROVENANCE_SCHEMA = 'lemmings-patch-fork-revision/v1';

export async function validatePatchForkProvenance(raw, { definition = null, engineRequirement = null, signal } = {}) {
  signal?.throwIfAborted(); const value = cloneData(raw, limits);
  requireValue(keys(value, ['schema', 'algorithmRevision', 'branchId', 'revision', 'parentReference', 'neighborhood', 'changes']) &&
    value.schema === PATCH_FORK_PROVENANCE_SCHEMA && value.algorithmRevision === 'explicit-name-and-macro-revision-v1' &&
    typeof value.branchId === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value.branchId) && !['constructor', 'prototype', '__proto__'].includes(value.branchId), 'Invalid exact patch revision identity.');
  const parent = validateSoundContentReference(value.parentReference);
  requireValue(parent && !parent.drumKit && value.branchId !== parent.patchId && Number.isSafeInteger(value.revision) && value.revision <= 2147483647 &&
    value.revision === parent.revision + 1 && await hashData(parent.definition, { maxBytes: 65536, maxNodes: 8192 }) === parent.definitionHash,
  'The revision must retain an exact immutable prior definition.');
  const requirement = engineRequirement || parent.engineRequirement;
  requireValue(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => parent.engineRequirement[key] === requirement[key]), 'Editing cannot change an engine artifact or parameter schema.');
  const neighborhood = validatePatchNeighborhoodProvenance(value.neighborhood, { engineRequirement: requirement });
  requireValue(keys(value.changes, ['name', 'macros']) && Array.isArray(value.changes.macros) && value.changes.macros.length <= 4 &&
    new Set(value.changes.macros.map(change => change?.id)).size === value.changes.macros.length, 'Invalid bounded revision changes.');
  const changes = value.changes, expected = { ...parent.definition, id: value.branchId, revision: value.revision };
  if (changes.name !== null) {
    requireValue(keys(changes.name, ['previous', 'value']) && changes.name.previous === parent.definition.name && typeof changes.name.value === 'string' &&
      changes.name.value.trim().length > 0 && changes.name.value.length <= 160 && changes.name.value !== changes.name.previous, 'Invalid explicit revision name.');
    expected.name = changes.name.value;
  }
  requireValue(changes.name !== null || changes.macros.length > 0, 'Choose a changed name or macro value before creating a revision.');
  const macros = new Map(parent.definition.macros.map(macro => [macro.id, macro]));
  for (const change of changes.macros) {
    const macro = macros.get(change?.id);
    requireValue(keys(change, ['id', 'previous01', 'value01']) && macro && change.previous01 === macro.default01 && Number.isFinite(change.value01) &&
      change.value01 >= 0 && change.value01 <= 1 && change.previous01 !== change.value01, 'A revision can edit only existing bounded macro defaults.');
    requireValue(!neighborhood.locks.macros.includes(change.id) && !macro.targets.some(target => neighborhood.locks.parameters.includes(target.parameter)),
      'This macro targets a locked field. Generate an unlocked candidate before editing it.');
  }
  expected.macros = parent.definition.macros.map(macro => {
    const change = changes.macros.find(entry => entry.id === macro.id); return change ? { ...macro, default01: change.value01 } : macro;
  });
  if (definition) requireValue(canonicalDataText(expected, limits).text === canonicalDataText(definition, limits).text,
    'A name/macro revision cannot silently change parameters, assets, mappings, bindings, policy or other definition fields.');
  signal?.throwIfAborted(); return freezeData(value);
}
