import { hashData } from '../../../core/CanonicalData.js';
import { ORIGINAL_ACOUSTIC_MATERIALS } from '../../../midi/content/OriginalAcousticMaterialDefinitions.js';
import { validateInstrumentPatchV2 } from '../../../midi/content/InstrumentPatchV2.js';
import { validateSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { createMaterialPalette } from '../../../midi/content/MaterialPalette.js';

export async function createOriginalSceneMaterialPalette({ sourceHash, descriptor, signal } = {}) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash || '') || descriptor?.engineId !== 'native-modal' || descriptor.capabilities?.worldSpatialControl !== true || descriptor.capabilities.sharedAcousticZoneSends !== true) throw new TypeError('Original acoustic scores require the executing modal engine and its spatial/return capabilities.');
  const definitions = [], hashes = [];
  for (const raw of ORIGINAL_ACOUSTIC_MATERIALS.definitions) { signal?.throwIfAborted(); const definition = validateInstrumentPatchV2(raw, descriptor); definitions.push(definition); hashes.push(await hashData(definition)); }
  signal?.throwIfAborted(); const packHash = await hashData({ schema: 'lemmings-original-scene-material-palette/v1', sourceHash, sourceRecipeHash: ORIGINAL_ACOUSTIC_MATERIALS.sourceRecipeHash, compilerRevision: ORIGINAL_ACOUSTIC_MATERIALS.compilerRevision, definitionHashes: hashes }),
    engineRequirement = { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash };
  return createMaterialPalette(definitions.map((definition, index) => validateSoundContentReference({ schema: 'lemmings-sound-reference/v1', packHash, patchId: definition.id, revision: definition.revision, definitionHash: hashes[index], definition, assetHashes: [], engineRequirement })));
}
