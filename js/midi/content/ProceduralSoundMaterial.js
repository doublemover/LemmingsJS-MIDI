import { PROCEDURAL_BIOME_IDENTITIES } from './ProceduralBiomeIdentities.js';
import { PROCEDURAL_TACTILE_IDENTITIES } from './ProceduralTactileIdentities.js';
import { PROCEDURAL_IMPULSE_IDENTITIES } from './ProceduralImpulseIdentities.js';

const originals = Object.freeze([...PROCEDURAL_BIOME_IDENTITIES, ...PROCEDURAL_TACTILE_IDENTITIES, ...PROCEDURAL_IMPULSE_IDENTITIES]);
export function getProceduralSoundMaterial(file) {
  return originals.find(entry => entry.sha256 === file?.sha256 && entry.bytes === file.bytes && entry.path === file.path &&
    file.kind === (entry.kind || 'sample') && file.mediaType === 'audio/wav') || null;
}
export function getProceduralSoundById(id) {
  const entry = originals.find(entry => entry.id === id);
  if (!entry) throw new TypeError('Unknown original procedural sound.'); return entry;
}
