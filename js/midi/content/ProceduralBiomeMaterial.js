import { PROCEDURAL_BIOME_IDENTITIES } from './ProceduralBiomeIdentities.js';

export function getProceduralBiomeMaterial(file) {
  return PROCEDURAL_BIOME_IDENTITIES.find(entry => entry.sha256 === file?.sha256 && entry.bytes === file.bytes &&
    entry.path === file.path && file.kind === 'sample' && file.mediaType === 'audio/wav') || null;
}
export function getProceduralBiomeById(id) {
  const entry = PROCEDURAL_BIOME_IDENTITIES.find(entry => entry.id === id);
  if (!entry) throw new TypeError('Unknown original procedural source.'); return entry;
}
