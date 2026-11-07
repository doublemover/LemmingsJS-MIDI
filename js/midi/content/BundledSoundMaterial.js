import { getProceduralSoundMaterial, getProceduralSoundById } from './ProceduralSoundMaterial.js';
import { FIELD_RECORDING_IDENTITIES } from './FieldRecordingIdentities.js';

export function getBundledSoundMaterial(file) {
  return getProceduralSoundMaterial(file) || FIELD_RECORDING_IDENTITIES.find(entry => entry.sha256 === file?.sha256 && entry.bytes === file.bytes &&
    entry.path === file.path && file.kind === 'sample' && file.mediaType === 'audio/wav') || null;
}
export function getBundledSoundById(id) {
  return FIELD_RECORDING_IDENTITIES.find(entry => entry.id === id) || getProceduralSoundById(id);
}
