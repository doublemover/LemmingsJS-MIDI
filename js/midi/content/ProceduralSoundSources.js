import { generateProceduralBiomeSource, BIOME_GENERATOR_REVISION } from './ProceduralBiomeSources.js';
import { generateProceduralTactileSource, TACTILE_GENERATOR_REVISION } from './ProceduralTactileSources.js';

export function generateProceduralSoundSource(identity) {
  if (identity.generatorRevision === BIOME_GENERATOR_REVISION) return generateProceduralBiomeSource(identity.id);
  if (identity.generatorRevision === TACTILE_GENERATOR_REVISION) return generateProceduralTactileSource(identity.id);
  throw new TypeError('Unknown original sound generator revision.');
}
