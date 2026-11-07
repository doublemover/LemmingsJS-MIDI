import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { validateSoundContentReference, resolveSoundContentReference } from './SoundContentReference.js';
import { ORIGINAL_MATERIAL_PATCH_IDS } from './MaterialResponseMap.js';

const fail = message => { throw new TypeError('Material palette: ' + message); };
export function validateMaterialPalette(raw) {
  const value = cloneData(raw, { maxBytes: 262144, maxNodes: 32768 });
  if (value?.schema !== 'lemmings-material-palette/v1' || Object.keys(value).some(key => !['schema', 'id', 'revision', 'sourcePackHash', 'identityHash', 'references'].includes(key)) || typeof value.id !== 'string' || !/^material-palette[.][a-f0-9]{24}$/.test(value.id) || value.revision !== 1 || ![value.sourcePackHash, value.identityHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || value.id !== 'material-palette.' + value.identityHash.slice(0, 24) || !Array.isArray(value.references) || value.references.length !== 5) fail('Keep the exact five-body immutable palette and its complete content identity.');
  value.references = value.references.map(validateSoundContentReference).sort((a, b) => a.patchId < b.patchId ? -1 : a.patchId > b.patchId ? 1 : 0);
  if (new Set(value.references.map(reference => reference.patchId)).size !== 5 || value.references.some(reference => !ORIGINAL_MATERIAL_PATCH_IDS.includes(reference.patchId) || reference.packHash !== value.sourcePackHash || reference.definition.engineId !== 'native-modal' || reference.definition.sampleRefs.length || reference.assetHashes.length || !['mass', 'hardness', 'damping', 'hollow'].every(id => reference.definition.macros.some(macro => macro.id === id)))) fail('Prepare all original modal bodies, including unclassified, with their four authored controls and no missing PCM.');
  return freezeData(value);
}
export async function createMaterialPalette(references) {
  if (!Array.isArray(references) || references.length !== 5) fail('Choose the complete original material family.');
  const ordered = references.map(validateSoundContentReference).sort((a, b) => a.patchId < b.patchId ? -1 : a.patchId > b.patchId ? 1 : 0), sourcePackHash = ordered[0].packHash,
    identityHash = await hashData({ schema: 'lemmings-material-palette/v1', revision: 1, sourcePackHash, references: ordered }, { maxBytes: 262144, maxNodes: 32768 });
  return validateMaterialPalette({ schema: 'lemmings-material-palette/v1', id: 'material-palette.' + identityHash.slice(0, 24), revision: 1, sourcePackHash, identityHash, references: ordered });
}
export async function verifyMaterialPalette(raw, { descriptors, signal } = {}) {
  const value = validateMaterialPalette(raw), { id, identityHash, ...content } = value;
  if (await hashData(content, { maxBytes: 262144, maxNodes: 32768 }) !== identityHash) fail('The saved palette identity changed.');
  for (const reference of value.references) { signal?.throwIfAborted(); if (await hashData(reference.definition) !== reference.definitionHash) fail('A material definition changed.'); const resolved = await resolveSoundContentReference(reference, { engineDescriptors: descriptors, availableHashes: [], signal }); if (resolved.status !== 'ready') fail('The exact current-build material body is unavailable: ' + resolved.status); }
  return value;
}
export function materialArticulationControls(state) {
  if (!state || !['hard', 'soft', 'muted'].includes(state.articulation) || !Number.isFinite(state.site01) || state.site01 < 0 || state.site01 > 1) fail('Choose explicit hardness/damping and normalized strike-site controls.');
  return freezeData({ hardness: state.articulation === 'soft' ? 0.15 : 0.85, ...(state.articulation === 'muted' ? { damping: 1 } : {}), hollow: state.site01 });
}
